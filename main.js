const { app, Tray, Menu, dialog } = require("electron");
const path = require("path");
const AutoLaunch = require("auto-launch");
const express = require("express");
const Client = require("ssh2-sftp-client");
const FTP = require("ftp");
const cors = require("cors");
const fs = require("fs");

// Add this at the top of your server code
const DEBUG_MODE = process.env.NODE_ENV !== "production"; // or set manually

const logger = {
  info: (...args) => {},
  error: (...args) => {
    // Always log errors, but with timestamp
  },
  debug: (...args) => {
    if (DEBUG_MODE) console.debug(new Date().toISOString(), ...args);
  },
};

// Simple settings storage
const settingsPath = path.join(app.getPath("userData"), "settings.json");
const settings = {
  load() {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      return { autoLaunch: true, firstRun: true };
    }
  },
  save(data) {
    fs.writeFileSync(settingsPath, JSON.stringify(data));
  },
};

// Initialize auto-launcher
const autoLauncher = new AutoLaunch({
  name: "FTP Viewer",
  path: app.getPath("exe"),
});

let tray = null;
let serverRunning = false;
let server = null;

// Your existing server code
function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  function cleanServerUrl(url) {
    url = url.replace(/^(sftp|ftp):\/\//, "");
    url = url.replace(/^.*@/, "");
    url = url.split("/")[0];
    return url;
  }

  async function checkFileExists(protocol, client, path) {
    try {
      if (protocol === "sftp") {
        return await client.exists(path);
      } else {
        return new Promise((resolve) => {
          client.list(path, (err, list) => {
            resolve(!err && list);
          });
        });
      }
    } catch (err) {
      return false;
    }
  }

  app.post("/connect", async (req, res) => {
    try {
      const { serverUrl, username, password, protocol, path } = req.body;
      logger.info("Connection attempt:", {
        protocol,
        path,
        host: cleanServerUrl(serverUrl),
        user: username,
      });

      const cleanUrl = cleanServerUrl(serverUrl);
      if (!serverUrl || !username || !password) {
        throw new Error("Missing required credentials");
      }

      if (protocol === "sftp") {
        const sftp = new Client();
        try {
          await sftp.connect({
            host: cleanUrl,
            username: username,
            password: password,
            port: 22,
          });
          const directoryPath = path || "/";
          const list = await sftp.list(directoryPath);
          await sftp.end();
          res.json(list);
        } catch (err) {
          logger.error("SFTP Error:", err.message);
          res.status(500).json({
            message: err.message,
            ...(DEBUG_MODE && { stack: err.stack }),
          });
        } finally {
          await sftp.end();
        }
      } else {
        const ftp = new FTP();
        await new Promise((resolve, reject) => {
          ftp.on("ready", () => {
            const directoryPath = path || "/";
            ftp.list(directoryPath, (err, list) => {
              if (err) {
                reject(err);
                return;
              }
              ftp.end();
              res.json(list);
              resolve();
            });
          });
          ftp.on("error", (err) => {
            reject(err);
          });
          ftp.connect({
            host: cleanUrl,
            user: username,
            password: password,
            port: 21,
          });
        });
      }
    } catch (err) {
      logger.error("General Error:", err.message);
      res.status(500).json({
        error: err.name,
        message: err.message,
        ...(DEBUG_MODE && { stack: err.stack }),
      });
    }
  });

  app.post("/download", async (req, res) => {
    let sftp = null;
    let ftp = null;

    try {
      const { serverUrl, username, password, protocol, path, filename } =
        req.body;

      const cleanUrl = cleanServerUrl(serverUrl);
      const fullPath = path === "/" ? `/${filename}` : `${path}/${filename}`;

      if (!serverUrl || !username || !password || !filename) {
        throw new Error("Missing required parameters");
      }

      if (protocol === "sftp") {
        sftp = new Client();
        try {
          await sftp.connect({
            host: cleanUrl,
            username: username,
            password: password,
            port: 22,
          });

          // Get file size first
          const stats = await sftp.stat(fullPath);

          // Set headers before starting the download
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`
          );
          res.setHeader("Content-Length", stats.size);

          // Read file in chunks and buffer it (instead of streaming)
          let fileBuffer = await sftp.get(fullPath);
          res.end(fileBuffer); // Send the entire file as response

          // Close the SFTP connection
          sftp.end();
        } catch (err) {
          if (!res.headersSent) {
            res.status(500).json({
              error: "SFTP Download Error",
              message: err.message,
            });
          }
          if (sftp) await sftp.end();
        }
      } else {
        ftp = new FTP();

        await new Promise((resolve, reject) => {
          ftp.on("ready", () => {
            ftp.get(fullPath, (err, stream) => {
              if (err) {
                reject(err);
                return;
              }

              // Set headers for download
              res.setHeader("Content-Type", "application/octet-stream");
              res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`
              );

              // Buffer the file content instead of streaming directly
              let fileBuffer = [];
              stream.on("data", (chunk) => fileBuffer.push(chunk));
              stream.on("end", () => {
                // Concatenate all chunks and send the file
                const buffer = Buffer.concat(fileBuffer);
                res.end(buffer); // Send the entire file as response
                ftp.end();
                resolve();
              });

              stream.on("error", (err) => {
                ftp.end();
                reject(err);
              });
            });
          });

          ftp.on("error", (err) => {
            reject(err);
          });

          ftp.connect({
            host: cleanUrl,
            user: username,
            password: password,
            port: 21,
            connTimeout: 20000,
            pasvTimeout: 20000,
          });
        });
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: "Download Error",
          message: err.message,
        });
      }
    } finally {
      // Clean up connections
      if (sftp) {
        try {
          await sftp.end();
        } catch (err) {
          console.error("Error closing SFTP connection:", err);
        }
      }
      if (ftp) {
        try {
          ftp.end();
        } catch (err) {
          console.error("Error closing FTP connection:", err);
        }
      }
    }
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/delete", async (req, res) => {
    let sftp = null;
    let ftp = null;

    try {
      const { serverUrl, username, password, protocol, path, filename } =
        req.body;

      const cleanUrl = cleanServerUrl(serverUrl);
      const fullPath = path === "/" ? `/${filename}` : `${path}/${filename}`;

      if (!serverUrl || !username || !password || !filename) {
        throw new Error("Missing required parameters");
      }

      if (protocol === "sftp") {
        sftp = new Client();
        await sftp.connect({
          host: cleanUrl,
          username: username,
          password: password,
          port: 22,
        });

        await sftp.delete(fullPath);
        console.log("SFTP deletion completed");
        res.json({ message: "File deleted successfully" });
      } else {
        ftp = new FTP();
        await new Promise((resolve, reject) => {
          ftp.on("ready", () => {
            ftp.delete(fullPath, (err) => {
              if (err) {
                reject(err);
                return;
              }
              console.log("FTP deletion completed");
              res.json({ message: "File deleted successfully" });
              resolve();
            });
          });

          ftp.on("error", (err) => {
            reject(err);
          });

          ftp.connect({
            host: cleanUrl,
            user: username,
            password: password,
            port: 21,
          });
        });
      }
    } catch (err) {
      console.error("Deletion error:", err);
      res.status(500).json({
        error: "Deletion Error",
        message: err.message,
      });
    } finally {
      if (sftp) {
        try {
          await sftp.end();
        } catch (err) {
          console.error("Error closing SFTP connection:", err);
        }
      }
      if (ftp) {
        try {
          ftp.end();
        } catch (err) {
          console.error("Error closing FTP connection:", err);
        }
      }
    }
  });

  // Modified upload endpoint
  app.post("/checkFile", async (req, res) => {
    let sftp = null;
    let ftp = null;
    try {
      const { serverUrl, username, password, protocol, path, filename } =
        req.body;
      const cleanUrl = cleanServerUrl(serverUrl);
      const fullPath = path === "/" ? `/${filename}` : `${path}/${filename}`;

      if (protocol === "sftp") {
        sftp = new Client();
        await sftp.connect({
          host: cleanUrl,
          username: username,
          password: password,
          port: 22,
        });
        const exists = await checkFileExists(protocol, sftp, fullPath);
        res.json({ exists });
      } else {
        ftp = new FTP();
        await new Promise((resolve, reject) => {
          ftp.on("ready", async () => {
            const exists = await checkFileExists(protocol, ftp, fullPath);
            res.json({ exists });
            resolve();
          });
          ftp.connect({
            host: cleanUrl,
            user: username,
            password: password,
            port: 21,
          });
        });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (sftp) await sftp.end();
      if (ftp) ftp.end();
    }
  });

  app.post("/upload", async (req, res) => {
    let sftp = null;
    let ftp = null;

    try {
      console.log("Received upload request");

      const {
        serverUrl,
        username,
        password,
        protocol,
        path,
        fileData,
        filename,
        overwrite,
      } = req.body;

      // Validate all required fields
      const missingFields = [];
      if (!serverUrl) missingFields.push("serverUrl");
      if (!username) missingFields.push("username");
      if (!password) missingFields.push("password");
      if (!protocol) missingFields.push("protocol");
      if (!path) missingFields.push("path");
      if (!filename) missingFields.push("filename");
      if (!fileData) missingFields.push("fileData");

      if (missingFields.length > 0) {
        throw new Error(
          `Missing required parameters: ${missingFields.join(", ")}`
        );
      }

      console.log("Uploading file:", {
        protocol,
        path,
        filename,
        fileDataLength: fileData ? fileData.length : 0,
      });

      const cleanUrl = cleanServerUrl(serverUrl);
      const fullPath = path === "/" ? `/${filename}` : `${path}/${filename}`;

      // Convert base64 to buffer
      const fileBuffer = Buffer.from(fileData, "base64");

      console.log("File buffer created, size:", fileBuffer.length);

      if (protocol === "sftp") {
        sftp = new Client();
        await sftp.connect({
          host: cleanUrl,
          username: username,
          password: password,
          port: 22,
        });

        await sftp.put(fileBuffer, fullPath);
        console.log("SFTP upload completed");
        res.json({ message: "File uploaded successfully" });
      } else {
        ftp = new FTP();
        await new Promise((resolve, reject) => {
          ftp.on("ready", () => {
            ftp.put(fileBuffer, fullPath, (err) => {
              if (err) {
                reject(err);
                return;
              }
              console.log("FTP upload completed");
              res.json({ message: "File uploaded successfully" });
              resolve();
            });
          });

          ftp.on("error", (err) => {
            reject(err);
          });

          ftp.connect({
            host: cleanUrl,
            user: username,
            password: password,
            port: 21,
          });
        });
      }
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({
        error: "Upload Error",
        message: err.message,
      });
    } finally {
      if (sftp) {
        try {
          await sftp.end();
        } catch (err) {
          console.error("Error closing SFTP connection:", err);
        }
      }
      if (ftp) {
        try {
          ftp.end();
        } catch (err) {
          console.error("Error closing FTP connection:", err);
        }
      }
    }
  });

  return app;
}

function startServer() {
  if (!serverRunning) {
    const app = createServer();
    server = app.listen(3000, "0.0.0.0", () => {
      serverRunning = true;
      updateTrayMenu();

      tray.displayBalloon({
        title: "FTP Viewer",
        content: "Server is running on port 3000",
      });
    });
  }
}

function stopServer() {
  if (serverRunning && server) {
    server.close(() => {
      serverRunning = false;
      updateTrayMenu();

      tray.displayBalloon({
        title: "FTP Viewer",
        content: "Server has been stopped",
      });
    });
  }
}

function updateTrayMenu() {
  const currentSettings = settings.load();
  const contextMenu = Menu.buildFromTemplate([
    {
      label: serverRunning ? "Server: Running (Port 3000)" : "Server: Stopped",
      enabled: false,
    },
    {
      type: "separator",
    },
    {
      label: serverRunning ? "Stop Server" : "Start Server",
      click: serverRunning ? stopServer : startServer,
    },
    {
      type: "separator",
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: currentSettings.autoLaunch,
      click: async () => {
        const newSettings = settings.load();
        try {
          if (newSettings.autoLaunch) {
            await autoLauncher.disable();
          } else {
            await autoLauncher.enable();
          }
          newSettings.autoLaunch = !newSettings.autoLaunch;
          settings.save(newSettings);
          updateTrayMenu();
        } catch (err) {
          dialog.showErrorBox("Error", "Failed to update startup settings");
        }
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => {
        stopServer();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(
    serverRunning ? "FTP Viewer: Running" : "FTP Viewer: Stopped"
  );
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    dialog.showMessageBox({
      type: "info",
      title: "FTP Viewer",
      message: "Application is already running in system tray",
    });
  });
}

app.whenReady().then(async () => {
  // Setup auto-launch on first run
  const currentSettings = settings.load();
  if (currentSettings.firstRun) {
    await autoLauncher.enable();
    currentSettings.firstRun = false;
    settings.save(currentSettings);
  }

  // Create tray
  tray = new Tray(path.join(__dirname, "icon.png"));
  updateTrayMenu();

  // Start server automatically
  startServer();
});

// Prevent app from closing on all windows closed
app.on("window-all-closed", (e) => {
  e.preventDefault();
});
