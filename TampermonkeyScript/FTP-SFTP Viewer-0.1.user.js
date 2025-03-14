// ==UserScript==
// @name FTP/SFTP Viewer
// @namespace http://tampermonkey.net/
// @version 0.5
// @description View FTP/SFTP contents
// @match https://erp.digitecgalaxus.ch/*/DataSourceProduct/*
// @match https://erp.galaxus.eu/*/DataSourceProduct/*
// @match https://erp.digitecgalaxus.ch/DataSourceProduct/*
// @match https://erp.galaxus.eu/DataSourceProduct/*

// @downloadURL  https://migros.sharepoint.com/:u:/r/sites/DGCMStorage/Platforms/Portfolio%20Development/Product%20Data%20Integration%20Gilde/pdi_Tools/FTP%20Fetcher/FTP-SFTP%20Viewer-0.1.user.js
// @updateURL https://migros.sharepoint.com/:u:/r/sites/DGCMStorage/Platforms/Portfolio%20Development/Product%20Data%20Integration%20Gilde/pdi_Tools/FTP%20Fetcher/FTP-SFTP%20Viewer-0.1.user.js
// @grant GM.xmlHttpRequest
// ==/UserScript==

/*
0.1 - initial releaase
0.2 - changed protocol selector 
0.3 - added better url tracking
0.4 - fetching credential for internal:// links
0.5 - added drag & drop for upload, delete, overwrite check
*/
(function () {
    'use strict';

    const DEBUG_MODE = true;

    let currentPath = '/';

    const log = {
        info: (...args) => {
            if (DEBUG_MODE) console.log('[FTP Viewer]', ...args);
        },
        error: (...args) => {
            console.error('[FTP Viewer]', ...args);
        },
        debug: (...args) => {
            if (DEBUG_MODE) console.debug('[FTP Viewer]', ...args);
        }
    };

    function showToast(message = 'Downloading...') {
        // Container for all toasts if it doesn't exist yet
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            Object.assign(toastContainer.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: '9999',
                display: 'flex',
                flexDirection: 'column-reverse',
                gap: '10px'
            });
            document.body.appendChild(toastContainer);
        }

        // Create and style the toast
        const toast = document.createElement('div');
        toast.textContent = message;
        Object.assign(toast.style, {
            padding: '10px 20px',
            backgroundColor: 'rgb(0, 123, 255)',
            color: '#fff',
            borderRadius: '5px',
            opacity: '1',
            transform: 'translateY(0)',
            transition: 'opacity 0.2s ease, transform 0.2s ease'
        });

        // Add toast to container immediately visible
        toastContainer.appendChild(toast);

        // Hide and remove the toast after 2 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                toast.remove();
                if (toastContainer.children.length === 0) {
                    toastContainer.remove();
                }
            }, 200);
        }, 2000);
    }

    async function getInternalCreds(partnerUrl){
        try {
            const response = await fetch(partnerUrl, {
                "headers": {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                    "accept-language": "en-US,en;q=0.9,bs;q=0.8,sr;q=0.7,es;q=0.6",
                    "cache-control": "no-cache",
                    "pragma": "no-cache",
                    "priority": "u=0, i",
                    "sec-ch-ua": "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "sec-fetch-dest": "document",
                    "sec-fetch-mode": "navigate",
                    "sec-fetch-site": "same-origin",
                    "sec-fetch-user": "?1",
                    "upgrade-insecure-requests": "1"
                },
                "referrer": "https://erp.digitecgalaxus.ch/en/DataSourceProduct/Show?dataSourceProduct=8490",
                "referrerPolicy": "same-origin",
                "body": null,
                "method": "GET",
                "mode": "cors",
                "credentials": "include"
            });

            if(!response.ok){
                throw new Error(`HTTP error! Status: ${response.status}`);

            }
            const htmlText = await response.text();

            const parser = new DOMParser();

            const doc = parser.parseFromString(htmlText, "text/html");

            const creds = {
                serverUrl: null,
                username: doc.querySelector('#ProviderFileStorageCredentials tr td').textContent,
                password: doc.querySelectorAll('span.toggle-button')[0].dataset.password || doc.querySelectorAll('span.toggle-button'),
                protocol: null
            };

            for (let el of doc.querySelectorAll('div.index')){
                el.textContent.includes('URL') ? creds.serverUrl = el.nextElementSibling.textContent : console.log()
            }

            for (let el of doc.querySelectorAll('div.index')){
                el.textContent.includes('URL') ? creds.protocol = el.nextElementSibling.textContent.split('://')[0] : console.log(/*'ERROR WITH SELECTOR: ' + el.textContent*/)
            }

            console.log('Internal Credentials check:', {
                hasServerUrl: !!creds.serverUrl,
                creds: creds.serverUrl,
                hasUsername: !!creds.username,
                hasPassword: !!creds.password,
                protocol: creds.protocol,
                serverUrl: creds.serverUrl // Be careful with logging sensitive info in production
            });

            return creds;

        }
        catch(error){
            console.log(error)
        }
    }


    function getERPCredentials() {

        const creds = {
            serverUrl: $('div.index:contains("URL")').last().next().text().trim().includes('internal') ? $('div.index:contains("URL")').last().next().text().trim().split('://').map(el => el.includes('internal') ? el = 'sftp://'+'ftp-partner.digitecgalaxus.ch/' : el).join('') : $('div.index:contains("URL")').last().next().text().trim(),
            username: $('div:contains("User name")').last().next().text().trim() ? $('div:contains("User name")').last().next().text().trim() : $('div:contains("Nutzername")').last().next().text().trim(),
            password: $('div:contains("Password")').last().next().text().trim() ? $('div:contains("Password")').last().next().text().trim() : $('div:contains("Passwort")').last().next().text().trim(),
            protocol: $('div.index:contains("URL")').last().next().text().split('://')[0].trim().includes('internal') || $('div.index:contains("URL")').last().next().text().split('://')[0].trim().includes('sftp') ? 'sftp' : 'ftp'
        };

        console.log('THIS IS THE SERVERURL ' + creds.serverUrl)

        // Debug log credentials (mask password)
        if (DEBUG_MODE) {
            log.debug('Credentials:', {
                ...creds,
                password: '****',
            });
        }

        console.log('Credentials check:', {
            hasServerUrl: !!creds.serverUrl,
            creds: creds.serverUrl,
            hasUsername: !!creds.username,
            hasPassword: !!creds.password,
            protocol: creds.protocol,
            serverUrl: creds.serverUrl // Be careful with logging sensitive info in production
        });

        return creds;

    }

    const wrapper = document.createElement('div');
    wrapper.style.top = '200px'; // adjust as needed
    wrapper.style.left = '400px'; // adjust as needed
    wrapper.style.overflow = 'hidden';
    wrapper.style.width = '0';
    wrapper.style.transition = 'width 0.3s ease-in-out';

    const container = document.createElement('div');
    container.style.background = 'white';
    container.style.padding = '10px';
    container.style.zIndex = '9999';
    container.style.maxHeight = '80vh';
    container.style.overflowY = 'auto';
    container.style.width = '300px'; // Fixed width
    container.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    container.style.whiteSpace = 'nowrap';

    // Create drop overlay
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'drop-overlay';
    const dropMessage = document.createElement('div');
    dropMessage.className = 'drop-message';
    dropMessage.textContent = 'Drop file here to upload';
    dropOverlay.appendChild(dropMessage);
    document.body.appendChild(dropOverlay);

    // Add drag and drop event listeners
    container.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.add('drag-over');
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.add('drag-over');
    });

    container.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drag-over');
    });

    // Add document-wide drag and drop handlers
    /*document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropOverlay.style.display = 'flex';
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropOverlay.style.display = 'flex';
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.relatedTarget === null) {
            dropOverlay.style.display = 'none';
        }
    });*/

    /*async function handleDeletion(e){
        e.preventDefault();
        e.preventPropagation();

        let fileName


        let deletionConfirmation = window.confirm(`Do you really want to delete the following file: ${fileName}?`);


        if(deletionConfirmation){
            try {
                // Get credentials
                const configuredUrl = $('div.index:contains("URL")').last().next().text().trim().includes('internal');
                let creds = null;
                if(configuredUrl) {
                    const partnerUrl = document.querySelector('[data-viewcomponent="ErpSupplierName"]').parentElement.href;
                    creds = await getInternalCreds(partnerUrl);
                } else {
                    creds = await getERPCredentials();
                }

                const deletionData = {
                    serverUrl: creds.serverUrl,
                    username: creds.username,
                    password: creds.password,
                    protocol: creds.protocol || 'sftp',
                    path: currentPath || '/ProductData',
                    filename: fileName
                };

            } catch(errror){

            }
        } else {
            return;
            showToast('Deletion cancelled!')
        }
    } */

    // Handle file drop
    async function handleFileDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drag-over');
        dropOverlay.style.display = 'none';

        const files = e.dataTransfer.files;
        if (files.length === 0) return;
        const file = files[0];

        try {
            // Get credentials first (you need creds for the check)
            const configuredUrl = $('div.index:contains("URL")').last().next().text().trim().includes('internal');
            let creds = null;
            if(configuredUrl) {
                const partnerUrl = document.querySelector('[data-viewcomponent="ErpSupplierName"]').parentElement.href;
                creds = await getInternalCreds(partnerUrl);
            } else {
                creds = await getERPCredentials();
            }

            // First request - Check file
            const fileExists = await new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'POST',
                    url: 'http://localhost:3000/checkFile',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify({
                        ...creds,
                        path: currentPath,
                        filename: file.name
                    }),
                    onload: function(response) {
                        const result = JSON.parse(response.responseText);
                        resolve(result.exists);
                    },
                    onerror: reject
                });
            });

            console.log(fileExists);

            let oWpermission = false;
            if (fileExists) {
                oWpermission = await window.confirm(`Do you want to overwrite the file ${file.name}?`);
                if (!oWpermission) {
                    showToast('Upload cancelled');
                    return;
                }
            }

            showToast(`Preparing to upload ${file.name}...`);

            // Read file as base64
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result.split(',')[1]; // Remove data URL prefix
                    resolve(base64);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });

            console.log('File read successfully, preparing upload...');

            const uploadData = {
                serverUrl: creds.serverUrl,
                username: creds.username,
                password: creds.password,
                protocol: creds.protocol || 'sftp',
                path: currentPath || '/ProductData',
                filename: file.name,
                fileData: base64Data,
                overwrite: oWpermission
            };

            // Verify data before sending
            console.log('Upload data prepared:', {
                ...uploadData,
                fileData: `[BASE64 string length: ${base64Data.length}]`,
                password: '***'
            });

            showToast(`Uploading ${file.name}...`);

            await new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'POST',
                    url: 'http://localhost:3000/upload',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    data: JSON.stringify(uploadData),
                    onload: function(response) {
                        console.log('Server response:', {
                            status: response.status,
                            statusText: response.statusText,
                            response: response.responseText
                        });

                        if (response.status === 200) {
                            showToast(`Successfully uploaded ${file.name}`);
                            fetchFiles(currentPath);
                            resolve();
                        } else {
                            let errorMessage;
                            try {
                                const errorData = JSON.parse(response.responseText);
                                errorMessage = errorData.message || errorData.error || 'Unknown error';
                            } catch (e) {
                                errorMessage = response.responseText || 'Unknown error';
                            }
                            showToast(`Failed to upload ${file.name}: ${errorMessage}`);
                            console.error('Upload failed:', errorMessage);
                            reject(new Error(errorMessage));
                        }
                    },
                    onerror: function(error) {
                        console.error('Upload request failed:', error);
                        showToast(`Failed to upload ${file.name}: Network error`);
                        reject(error);
                    }
                });
            });

        } catch (error) {
            console.error('Upload error:', error);
            showToast(`Failed to upload ${file.name}: ${error.message}`);
        }
    }
    container.addEventListener('drop', handleFileDrop);
    document.addEventListener('drop', handleFileDrop);

    wrapper.appendChild(container);


    let toggledFolder = false;
    let openFolder = '📂 Show Files';
    let closedFolder = '📁 Show Files';

    const button = document.createElement('button');
    button.innerHTML = '📁 Show Files';
    button.style.top = '160px'; // adjust as needed
    button.style.left = '400px'; // adjust as needed
    button.style.zIndex = '10000';
    button.style.padding = '5px 10px';
    button.style.cursor = 'pointer';

    let isOpen = false;

    // Add back button
    const backButton = document.createElement('button');
    backButton.innerHTML = '← Back';
    backButton.style.marginBottom = '10px';
    backButton.style.display = 'none';
    backButton.onclick = () => {
        currentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
        fetchFiles(currentPath);
    };



    async function fetchFiles(path) {
        try {
            const loaderCSS = `<div style="width:30px;height:15px;border-radius:0 0 38px 38px;border:2px solid #538a2d;border-top:0;box-sizing:border-box;background:radial-gradient(farthest-side at top,#0000 calc(100% - 2px),#e7ef9d calc(100% - 1.5px)),radial-gradient(1px 1.5px,#5c4037 89%,#0000) 0 0/6px 4.5px,#ff1643;--c:radial-gradient(farthest-side,#000 94%,#0000);-webkit-mask:linear-gradient(#0000 0 0),var(--c) 4.5px -3px,var(--c) 11px -3px,var(--c) 17px -2.2px,var(--c) 8.2px -0.7px,var(--c) 12.7px 2.2px,var(--c) 7.8px 2.2px,linear-gradient(#000 0 0);-webkit-mask-composite:destination-out;-webkit-mask-repeat:no-repeat;animation:l8 3s infinite" class="loader"></div><style>.loader{animation:l8 3s infinite}@keyframes l8{0%{-webkit-mask-size:auto,0 0,0 0,0 0,0 0,0 0,0 0}15%{-webkit-mask-size:auto,7.5px 7.5px,0 0,0 0,0 0,0 0,0 0}30%{-webkit-mask-size:auto,7.5px 7.5px,7.5px 7.5px,0 0,0 0,0 0,0 0}45%{-webkit-mask-size:auto,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,0 0,0 0,0 0}60%{-webkit-mask-size:auto,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,0 0,0 0}75%{-webkit-mask-size:auto,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,0 0}90%,to{-webkit-mask-size:auto,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px,7.5px 7.5px}}</style>`;
            container.innerHTML = `<span style="display:flex;justify-content:center;font-weight:bold;">Loading${loaderCSS}</span>`;

            const configuredUrl = $('div.index:contains("URL")').last().next().text().trim().includes('internal')
            let creds = null;

            if(configuredUrl){
                const partnerUrl = document.querySelector('[data-viewcomponent="ErpSupplierName"]').parentElement.href;
                creds = await getInternalCreds(partnerUrl);
            } else {
                creds = await getERPCredentials();
            }

            // Add path to credentials
            creds.path = path;
            // onsole.log('THIS IS THE PATH!' + path + '  ' + creds.path)

            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'POST',
                    url: 'http://localhost:3000/connect',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify(creds),
                    onload: function (response) {
                        if (response.status === 200) {
                            const files = JSON.parse(response.responseText);
                            console.log(files)
                            container.innerHTML = '';
                            // Show back button if we're not at root
                            backButton.style.display = path === '/' ? 'none' : 'block';
                            container.appendChild(backButton);

                            // Add current path indicator
                            const pathDiv = document.createElement('div');
                            pathDiv.textContent = `Current Path: ${path || '/'}`;
                            pathDiv.style.borderBottom = '1px solid #eee';
                            pathDiv.style.padding = '5px';
                            pathDiv.style.marginBottom = '10px';
                            container.appendChild(pathDiv);

                            // Add protocol indicator
                            const protocolDiv = document.createElement('div');
                            protocolDiv.textContent = `Connection: ${creds.protocol.toUpperCase()}`;
                            protocolDiv.style.borderBottom = '1px solid #eee';
                            protocolDiv.style.padding = '5px';
                            protocolDiv.style.marginBottom = '10px';
                            container.appendChild(protocolDiv);

                            files.forEach(file => {
                                const fileDiv = document.createElement('div');
                                const isDirectory = file.type === 'd';
                                console.log(file)



                                // Add some CSS to enhance button appearance
                                const style = document.createElement('style');
                                style.textContent = `
                                    .file-card {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-around;
        padding: 5px;
        margin-bottom: 10px;
        margin: 10px;
        background-color: #f9f9f9;
        border: 1px solid #ddd;
        border-radius: 8px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
        transition: transform 0.3s ease;
    }
    .file-card:hover {
        transform: scale(1.05);
    }
    .file-info {
        display: flex;
        width: 100%;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
    }
    .file-modified {
        flex: 1;
    }
    .file-name {
        font-weight: bold;
        justify-content: space-around;
        font-size: 14px;
    }
    .file-size {
        font-size: 12px;
        color: #555;
        padding-left: 5px;
    }
    .download-button {
        align-self: flex-start;
        padding: 6px 12px;
        margin-bottom: 10px;
        background-color: #4CAF50;
        color: white;
        font-size: 14px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        transition: background-color 0.3s ease;
    }
    .download-button:hover {
        background-color: #45a049;
    }
    .download-button:disabled {
        background-color: #ccc;
        cursor: not-allowed;
    }

    /* Add the new drag and drop styles here */
    .drag-over {
        background-color: rgba(0, 123, 255, 0.1) !important;
        border: 2px dashed #007bff !important;
    }
    .drop-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    }
    .drop-message {
        background-color: white;
        padding: 20px;
        border-radius: 10px;
        font-size: 20px;
        box-shadow: 0 0 10px rgba(0,0,0,0.3);
    }
                                    .file-card {
                                        display: flex;
                                        flex-wrap: wrap;
                                        align-items: center;
                                        justify-content: space-around;
                                        padding: 5px;
                                        margin-bottom: 10px;
                                        margin: 10px;
                                        background-color: #f9f9f9;
                                        border: 1px solid #ddd;
                                        border-radius: 8px;
                                        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                                        transition: transform 0.3s ease;
                                    }
                                
                                    .file-card:hover {
                                        transform: scale(1.05);
                                    }
                                
                                    .file-info {
                                        display: flex;
                                        width: 100%;
                                        flex-wrap: wrap;
                                        justify-content: space-between;
                                        align-items: center;
                                    }

                                    .file-modified {
                                    flex: 1;
                                    }
                                
                                    .file-name {
                                        font-weight: bold;
                                        justify-content: space-around;
                                        font-size: 14px;
                                    }
                                
                                    .file-size {
                                        font-size: 12px;
                                        color: #555;
                                        padding-left: 5px;
                                    }
                                
                                    .deletion-button {
                                    align-self: flex-start;
                                        padding: 6px 12px;
                                        margin-bottom: 10px;
                                        background-color: #9d1518e6;
                                        color: white;
                                        font-size: 14px;
                                        border: none;
                                        border-radius: 5px;
                                        cursor: pointer;
                                        transition: background-color 0.3s ease;
                                    }
                                
                                    .deletion-button:hover {
                                        background-color: #9b0e12;
                                    }
                                
                                    .deletion-button:disabled {
                                        background-color: #ccc;
                                        cursor: not-allowed;
                                    }
                                `;

                            document.head.appendChild(style);

                            // Add the file info section and download button
                            if (!isDirectory) {
                                const fileCard = document.createElement('div');
                                fileCard.classList.add('file-card');

                                // File info section
                                const fileInfo = document.createElement('div');
                                fileInfo.classList.add('file-info');

                                const nameSpan = document.createElement('span');
                                nameSpan.classList.add('file-name');
                                nameSpan.textContent = file.name;

                                const sizeSpan = document.createElement('span');
                                sizeSpan.classList.add('file-size');
                                sizeSpan.textContent = `Size: ${Math.round(file.size / 1000)} KB`; // File size in kilobytes

                                const modificationDate = document.createElement('span');
                                modificationDate.classList.add('file-modified');
                                modificationDate.textContent = 'Last modified: ' + new Date(file.modifyTime).toLocaleString('de-eu'); // File size in kilobytes

                                fileInfo.appendChild(nameSpan);
                                fileInfo.appendChild(sizeSpan);
                                fileInfo.appendChild(modificationDate);

                                // Download button section
                                const downloadButton = document.createElement('button');
                                downloadButton.classList.add('download-button');
                                downloadButton.textContent = '⬇️';

                                const deletionButton = document.createElement('button');
                                deletionButton.classList.add('deletion-button');
                                deletionButton.textContent = '🗑️';

                                // Add the Download button click behavior
                                downloadButton.onclick = (e) => {
                                    e.stopPropagation();
                                    downloadButton.disabled = true; // Disable the button to prevent further clicks

                                    showToast(`Trying to download ${file.name}...`);

                                    GM.xmlHttpRequest({
                                        method: 'POST',
                                        url: 'http://localhost:3000/download',
                                        headers: {
                                            'Content-Type': 'application/json'
                                        },
                                        responseType: 'blob',
                                        data: JSON.stringify({
                                            ...creds,
                                            path: currentPath,
                                            filename: file.name
                                        }),
                                        onload: function (response) {
                                            if (response.status === 200) {
                                                const blob = new Blob([response.response], { type: 'application/octet-stream' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = file.name;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                                URL.revokeObjectURL(url);
                                            } else {
                                                console.error('Download failed:', response);
                                                alert('Download failed');
                                            }
                                        },
                                        onerror: function (error) {
                                            console.error('Download error:', error);
                                            alert('Download failed: ' + error.message);
                                        },
                                        onloadend: function () {
                                            // Re-enable the button after download
                                            downloadButton.disabled = false;
                                        }
                                    });
                                };

                                deletionButton.onclick = (e) => {
                                    e.stopPropagation();

                                    deletionButton.disabled = true;

                                    GM.xmlHttpRequest({
                                        method: 'POST',
                                        url: 'http://localhost:3000/delete',
                                        headers: {
                                            'Content-Type': 'application/json'
                                        },
                                        data: JSON.stringify({
                                            ...creds,
                                            path: currentPath,
                                            filename: file.name
                                        }),
                                        onload: function (response) {
                                            if (response.status === 200) {
                                                showToast(`File ${file.name} has been successfully deleted.`)
                                            } else {
                                                console.error('Deletion failed:', response);
                                                alert('Deletion failed');
                                            }
                                        },
                                        onerror: function (error) {
                                            console.error('Deletion error:', error);
                                            alert('Deletion failed: ' + error.message);
                                        },
                                        onloadend: function () {
                                            // Re-enable the button after download
                                            deletionButton.disabled = false;
                                        }
                                    });
                                }


                                // Append the content (file info + download button) to the file card
                                fileCard.appendChild(fileInfo);
                                fileCard.appendChild(downloadButton);
                                fileCard.appendChild(deletionButton);

                                // Add the file card to the container
                                container.appendChild(fileCard);
                            }

                            // Create container for file name and download button
                            const contentDiv = document.createElement('div');
                            contentDiv.style.display = 'flex';
                            contentDiv.style.justifyContent = 'space-between';
                            contentDiv.style.alignItems = 'center';
                            contentDiv.style.width = '100%';



                            if (isDirectory) {
                                // File name/folder part
                                const nameSpan = document.createElement('span');
                                nameSpan.classList.add('file-name');
                                nameSpan.textContent = `${file.name}${isDirectory ? ' 📁' : ''} ${Math.round(file.size / 1000)} Kilobytes`;
                                contentDiv.appendChild(nameSpan);

                                fileDiv.appendChild(contentDiv);
                                fileDiv.style.padding = '5px';
                                fileDiv.style.cursor = isDirectory ? 'pointer' : 'default';
                                fileDiv.style.borderBottom = '1px solid #eee';

                                fileDiv.onclick = () => {
                                    const oldPath = currentPath; // Store old path for debugging
                                    currentPath = path === '/' ? '/' + file.name : path + '/' + file.name;
                                    console.log('Path Update:', {
                                        oldPath,
                                        newPath: currentPath,
                                        fileName: file.name,
                                        inputPath: path
                                    });
                                    fetchFiles(currentPath);
                                };
                            }

                            fileDiv.onmouseover = () => fileDiv.style.backgroundColor = '#f0f0f0';
                            fileDiv.onmouseout = () => fileDiv.style.backgroundColor = 'transparent';

                            container.appendChild(fileDiv);
                        });
                    } else {
                        console.error('Server response:', response);
                        let errorMessage = 'Unknown error';
                        try {
                            const errorData = JSON.parse(response.responseText);
                            errorMessage = `Error: ${errorData.error}\nMessage: ${errorData.message}`;
                            console.error('Detailed error:', errorData);
                        } catch (e) {
                            errorMessage = response.responseText;
                        }
                        container.innerHTML = `<div style="color: red; padding: 10px;">
                <strong>Connection Error:</strong><br>
                ${errorMessage}
            </div>`;
                        reject(new Error(errorMessage));
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                },
                onerror: function (error) {
                    console.error('Request Error:', error);
                    container.innerHTML = `<div style="color: red; padding: 10px;">
            <strong>Request Failed:</strong><br>
            ${error.message || 'Unable to connect to server'}
        </div>`;
                    reject(error);
                }
            });
        });
    } catch (error) {
        console.error('Error:', error);
        container.innerHTML = `Error: ${error.message}`;
    }
}

    button.onclick = () => {
        if (!toggledFolder) {
            toggledFolder = true
            button.innerHTML = openFolder;
        } else {
            toggledFolder = false
            button.innerHTML = closedFolder;
        }

        isOpen = !isOpen;
        wrapper.style.width = isOpen ? '320px' : '0'; // 320px to account for padding and border
        if (isOpen) {
            console.log('Initial load - currentPath:', currentPath);
            fetchFiles(currentPath);
        }
    };

    const aside = document.querySelector('aside')

    const divic = document.createElement('div')

    divic.classList.add('widget')
    divic.classList.add('closed')


    divic.append(button, wrapper)

    aside.append(divic);
})();
