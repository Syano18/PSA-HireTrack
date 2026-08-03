// main.js

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const http = require('http');
require('dotenv').config();

// Declare variables outside the async function
let store;
let nodeFetch;
let mainWindow;
let uuidv4;
let autoUpdater;

async function initializeDependencies() {
  const { default: Store } = await import('electron-store');
  const { default: fetch } = await import('node-fetch');
  const { v4 } = await import('uuid');
  
  // Lazy load electron-updater to speed up initial script execution
  autoUpdater = require('electron-updater').autoUpdater;
  
  store = new Store();
  nodeFetch = fetch;
  uuidv4 = v4;
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

async function startApp() {
  // Start loading dependencies in parallel with app startup
  const initPromise = initializeDependencies();

  async function createWindow() {
    await initPromise; // Wait for dependencies to be ready

    const isDev = !app.isPackaged;
    const isDark = store.get('isDarkMode');
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      title: 'PSA Kalinga HireTrack',
      icon: path.join(__dirname, './System.ico'),
      backgroundColor: isDark ? '#111827' : '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    mainWindow.removeMenu();
    
    // Enable Ctrl+R to refresh the page (works for login and all other pages)
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.key.toLowerCase() === 'r' && input.type === 'keyDown') {
        event.preventDefault();
        mainWindow.reload();
      }
    });

    mainWindow.once('ready-to-show', () => {
      mainWindow.maximize();
      mainWindow.show();
    });

    // Allow Firebase/Google API & Clerk certificate errors (handles corporate SSL inspection proxies)
    mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
      const trustedHosts = [
        'identitytoolkit.googleapis.com',
        'securetoken.googleapis.com',
        'www.googleapis.com',
        'firebaseio.com',
        'firebaseapp.com',
        'googleapis.com',
        'clerk.accounts.dev',
        'clerk.dev',
        'clerk.com',
        'clerk-telemetry.com'
      ];
      const isTrusted = trustedHosts.some(h => request.hostname === h || request.hostname.endsWith('.' + h));
      // 0 = success (trust), -2 = use default verification
      callback(isTrusted ? 0 : -2);
    });

    // Set Content Security Policy (CSP) to fix security warning
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      const serverIp = store.get('serverIpAddress') || '192.168.169.180';
      const serverPort = 3001;
      
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            `default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ""} https://*.clerk.accounts.dev; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.clerk.dev https://img.clerk.com; font-src 'self' data:; connect-src 'self' http://localhost:${serverPort} http://127.0.0.1:${serverPort} http://${serverIp}:${serverPort} https://*.clerk.accounts.dev wss://*.clerk.accounts.dev https://clerk-telemetry.com; worker-src 'self' blob:;`
          ]
        }
      });
    });

    // --- CLEANUP: remove existing handlers to avoid "second handler" errors when we recreate the window ---
    const ipcHandleChannels = [
      'get-login-state','set-login-state','clear-login-state','session-expired',
      'get-dark-mode','set-dark-mode', 'has-google-refresh-token',
      'login-google-loopback', 'login-google-silent', 'clear-google-refresh-token',
      'get-server-ip','set-server-ip','restart-app','get-local-ip',
      'login','prepare-download','save-file','open-file','auto-save-certificate',
      'backup-database','restore-database','save-csv-file',
      'get-app-version'
    ];
    ipcHandleChannels.forEach(ch => {
      try { ipcMain.removeHandler(ch); } catch (e) { /* ignore if none */ }
    });
    // remove any plain listeners added with ipcMain.on
    try { ipcMain.removeAllListeners('check-for-updates'); } catch (e) { /* ignore */ }
    try { ipcMain.removeAllListeners('quit-and-install'); } catch (e) { /* ignore */ }

    // --- Existing Login and Dark Mode Handlers ---
    ipcMain.handle('get-login-state', () => store.get('loginState'));
    ipcMain.handle('set-login-state', (event, state) => {
        store.set('loginState', state);
        if (mainWindow) mainWindow.webContents.send('onLoginStateChange');
    });
    ipcMain.handle('clear-login-state', () => {
        store.delete('loginState');
        if (mainWindow) mainWindow.webContents.send('onLoginStateChange');
    });

    let sessionWatcherInterval = null;

    // =================================================================
    // REFACTORED CODE STARTS HERE
    // =================================================================

    /**
     * Creates and displays a themed, global modal for session expiration.
     * This function acts like a self-contained component.
     * @param {BrowserWindow} parentWindow The main window to attach the modal to.
     * @returns {Promise<void>} A promise that resolves when the user closes the modal.
     */
    function showSessionExpiredModal(parentWindow) {
        return new Promise((resolve) => {
            const isDark = !!store.get('isDarkMode');
            const modalBg = isDark ? '#111827' : '#ffffff';
            const textColor = isDark ? '#e5e7eb' : '#111827';
            const buttonBg = isDark ? '#374151' : '#f3f4f6';
            const buttonText = isDark ? '#e5e7eb' : '#111827';
            
            const modal = new BrowserWindow({
                parent: parentWindow,
                modal: true,
                show: false,
                width: 480,
                height: 180,
                resizable: false,
                minimizable: false,
                maximizable: false,
                frame: false,
                backgroundColor: modalBg,
                webPreferences: {
                    contextIsolation: false,
                    nodeIntegration: false,
                },
            });
            
            const html = `
                <!doctype html><html><head><meta charset="utf-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
                <style>html,body{height:100%;margin:0;font-family:system-ui,Segoe UI,Roboto,-apple-system;background:${modalBg};color:${textColor}}
                .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:18px;box-sizing:border-box}
                .title{font-weight:600;font-size:16px;margin-bottom:6px}.msg{font-size:13px;margin-bottom:16px;text-align:center;max-width:420px}
                button{padding:8px 16px;border-radius:6px;border:0;background:${buttonBg};color:${buttonText};cursor:pointer}
                .close-x{position:absolute;right:10px;top:8px;color:${buttonText};cursor:pointer;font-size:14px}</style></head>
                <body><div class="wrap"><div style="position:relative;width:100%;max-width:440px">
                <div class="close-x" id="x">✕</div><div class="title">Session Expired</div>
                <div class="msg">Your account was logged in on another computer. You will be logged out and returned to the login screen.</div>
                <div style="text-align:center"><button id="ok">OK</button></div></div></div>
                <script>document.getElementById('ok').addEventListener('click',()=>window.close());
                document.getElementById('x').addEventListener('click',()=>window.close());
                document.addEventListener('keydown',e=>{if(e.key==='Escape')window.close();});</script></body></html>
            `;
            
            modal.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
            modal.once('ready-to-show', () => modal.show());
            
            // This promise resolves when the modal's `window.close()` is called from its script.
            modal.once('closed', resolve);
        });
    }

    /**
     * Handles the complete force logout process.
     * It shows the modal and then performs a full application restart.
     */
    async function forceLogout() {
        // Stop the session watcher immediately to prevent multiple triggers
        if (sessionWatcherInterval) {
            clearInterval(sessionWatcherInterval);
            sessionWatcherInterval = null;
        }

        // Show the modal and wait for the user to close it.
        // We ensure the main window exists before trying to show a modal on top of it.
        if (mainWindow && !mainWindow.isDestroyed()) {
            await showSessionExpiredModal(mainWindow);
        }

        // Clear the stored login state from disk.
        store.delete('loginState');
        
        // Use the robust relaunch logic, same as the IP address change.
        app.relaunch();
        app.exit();
    }

    // =================================================================
    // REFACTORED CODE ENDS HERE
    // =================================================================

    // -------------------------------
    // Polling watcher (fallback)
    // -------------------------------
    function startSessionWatcher(intervalMs = 5000) {
      // clear any existing watcher
      if (sessionWatcherInterval) {
        clearInterval(sessionWatcherInterval);
        sessionWatcherInterval = null;
      }

      sessionWatcherInterval = setInterval(async () => {
        try {
          const loginState = store.get('loginState');
          if (!loginState || !loginState.token) return; // not logged in

          const serverIp = store.get('serverIpAddress') || '127.0.0.1';
          const serverPort = process.env.API_PORT || '3001';
          const url = `http://${serverIp}:${serverPort}/api/session/validate`; // implement this endpoint server-side

          const res = await nodeFetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${loginState.token}` },
            // short timeout so we don't hang
            signal: AbortSignal.timeout(3000),
          });

          // if server says unauthorized or invalid session, force logout immediately
          if (res.status === 401 || res.status === 403) {
            await forceLogout(); // This now calls the refactored function
          }
        } catch (err) {
          // Network errors (server unreachable, timeout, etc.): force logout
          // This ensures the app logs out when there's no internet or cannot reach the server
          await forceLogout();
        }
      }, intervalMs);
    }

    // start watcher when window is created
    startSessionWatcher(5000);

    // stop watcher when window closed (helps avoid duplicates when recreate)
    mainWindow.on('closed', () => {
      if (sessionWatcherInterval) {
        clearInterval(sessionWatcherInterval);
        sessionWatcherInterval = null;
      }
    });

    // reuse forceLogout for ipc handler
    ipcMain.handle('session-expired', async () => {
      await forceLogout();
      return { success: true };
    });
    ipcMain.handle('get-dark-mode', () => store.get('isDarkMode'));
    ipcMain.handle('set-dark-mode', (event, value) => {
        store.set('isDarkMode', value);
        if (mainWindow) {
            mainWindow.setBackgroundColor(value ? '#111827' : '#ffffff');
            mainWindow.webContents.send('onDarkModeChange', value);
        }
    });

    // --- IP address handlers ---
    ipcMain.handle('get-server-ip', () => {
      return store.get('serverIpAddress') || '127.0.0.1';
    });
    ipcMain.handle('set-server-ip', (event, ip) => {
        store.set('serverIpAddress', ip);
        mainWindow.webContents.send('ip-saved-show-restart-prompt');
    });
    ipcMain.handle('restart-app', () => {
        app.relaunch();
        app.exit();
    });
    ipcMain.handle('get-local-ip', () => {
      return getLocalIP();
    });

    // --- Google Loopback Login Handler (Python Strategy) ---
    ipcMain.handle('login-google-loopback', async () => {
      let credentials;
      try {
        // Look for client_secret.json in the same directory as main.js
        const secretPath = path.join(__dirname, 'client_secret.json');
        if (!fs.existsSync(secretPath)) {
          return { error: 'client_secret.json not found in Client folder.' };
        }
        const content = fs.readFileSync(secretPath);
        credentials = JSON.parse(content);
      } catch (err) {
        return { error: `Failed to load client_secret.json: ${err.message}` };
      }

      // Support both "installed" and "web" formats
      const { client_id, client_secret } = credentials.installed || credentials.web;
      
      return new Promise((resolve) => {
        let serverPort = null;
        let isProcessed = false;

        const server = http.createServer(async (req, res) => {
          try {
            // Use captured serverPort to avoid "Cannot read properties of null" if server closes
            const portToUse = serverPort || (server.address() ? server.address().port : null);
            const urlParams = new URL(req.url, `http://127.0.0.1:${portToUse}`);
            
            const code = urlParams.searchParams.get('code');
            const error = urlParams.searchParams.get('error');

            if (code || error) {
              if (isProcessed) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Authentication already processed.</h1><p>You can close this window.</p>');
                return;
              }
              isProcessed = true;

              if (error) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`<h1>Authentication Failed</h1><p>Error: ${error}</p><p>You can close this window and try again.</p>`);
                server.close();
                resolve({ error: `Google OAuth Error: ${error}` });
                return;
              }

              // 2. Show success message to user
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<h1>Authentication successful!</h1><p>You can close this window and return to the app.</p><script>window.close()</script>');
              server.close();

              // 3. Exchange code for tokens
              const tokenResponse = await nodeFetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  code,
                  client_id,
                  client_secret,
                  redirect_uri: `http://127.0.0.1:${portToUse}`,
                  grant_type: 'authorization_code'
                })
              });

              const tokens = await tokenResponse.json();
              if (tokens.id_token) {
                // Store refresh token if provided (happens with access_type=offline)
                if (tokens.refresh_token) {
                  store.set('googleRefreshToken', tokens.refresh_token);
                }
                resolve({ idToken: tokens.id_token, accessToken: tokens.access_token, clientId: client_id });
              } else {
                resolve({ error: tokens.error_description || 'Failed to retrieve ID token from Google.' });
              }
            } else {
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end('Not Found');
            }
          } catch (err) {
            resolve({ error: err.message });
            if (server.listening) server.close();
          }
        });

        server.listen(0, '127.0.0.1', () => {
          serverPort = server.address().port;
          // Removed prompt=consent because it can cause users to get stuck on the "Review Terms" screen 
          // if they already consented previously.
          const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${client_id}&redirect_uri=http://127.0.0.1:${serverPort}&scope=openid%20email%20profile&access_type=offline&prompt=select_account`;
          shell.openExternal(authUrl);
        });
      });
    });

    // --- Google Silent Login Handler (Uses Refresh Token) ---
    ipcMain.handle('login-google-silent', async () => {
      const refreshToken = store.get('googleRefreshToken');
      if (!refreshToken) {
        return { error: 'No refresh token available' };
      }

      let credentials;
      try {
        const secretPath = path.join(__dirname, 'client_secret.json');
        const content = fs.readFileSync(secretPath);
        credentials = JSON.parse(content);
      } catch (err) {
        return { error: 'Failed to load client credentials' };
      }

      const { client_id, client_secret } = credentials.installed || credentials.web;

      try {
        const tokenResponse = await nodeFetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id,
            client_secret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
          })
        });

        const tokens = await tokenResponse.json();
        if (tokens.id_token) {
          // Update stored refresh token if a new one is returned
          if (tokens.refresh_token) {
            store.set('googleRefreshToken', tokens.refresh_token);
          }
          return { idToken: tokens.id_token, accessToken: tokens.access_token, clientId: client_id };
        } else {
          // If refresh fails (e.g. revoked), clear the stored token so we force a new login next time
          store.delete('googleRefreshToken');
          return { error: tokens.error_description || 'Failed to refresh token' };
        }
      } catch (err) {
        return { error: err.message };
      }
    });

    // --- Check for Google Refresh Token ---
    ipcMain.handle('has-google-refresh-token', () => !!store.get('googleRefreshToken'));

    // --- Clear Google Refresh Token Handler ---
    // This allows users to disconnect their Google account
    ipcMain.handle('clear-google-refresh-token', async () => {
      try {
        store.delete('googleRefreshToken');
        return { 
          success: true, 
          message: 'Google account has been disconnected. You can now sign in with a different Google account.' 
        };
      } catch (err) {
        return { 
          success: false, 
          message: 'Failed to disconnect Google account: ' + err.message 
        };
      }
    });
    
    // --- Login handler ---
    ipcMain.handle('login', async (event, { username, password }) => {
      const serverIp = store.get('serverIpAddress') || '127.0.0.1';
      const serverUrl = `http://${serverIp}:3001/api/login`;

      try {
        const response = await nodeFetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          const data = await response.json();
          store.set('loginState', data);
          mainWindow.webContents.send('onLoginStateChange');
          return { success: true, user: data.user, token: data.token };
        } else {
          const errorData = await response.json().catch(() => ({ message: 'Failed to parse error.' }));
          return { error: errorData.error || errorData.message || 'Invalid credentials' };
        }
      } catch (error) {
        console.error(`Failed to connect to ${serverUrl}:`, error.message, error.code);
        
        // Provide specific error messages based on error type
        let errorMessage = 'Server unreachable. Please check the IP address and your network connection.';
        let errorCode = 'CONNECTION_ERROR';
        
        if (error.code === 'ENOTFOUND') {
          errorMessage = `Cannot resolve server address: ${serverIp}. Please check the Server IP Address.`;
          errorCode = 'DNS_FAILED';
        } else if (error.code === 'ECONNREFUSED') {
          errorMessage = `Connection refused by ${serverIp}:3001. Server may be offline or not listening.`;
          errorCode = 'CONNECTION_REFUSED';
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = `Connection timeout to ${serverIp}:3001. Server is not responding. Check IP address and network.`;
          errorCode = 'TIMEOUT';
        } else if (error.code === 'EHOSTUNREACH') {
          errorMessage = `Host ${serverIp} is unreachable. Check your network connection and IP address.`;
          errorCode = 'HOST_UNREACHABLE';
        } else if (error.code === 'ENETUNREACH') {
          errorMessage = 'Network is unreachable. Please check your internet connection.';
          errorCode = 'NETWORK_UNREACHABLE';
        } else if (error.name === 'AbortError') {
          errorMessage = `Request timeout when connecting to ${serverIp}:3001. Server is not responding.`;
          errorCode = 'REQUEST_TIMEOUT';
        }
        
        return { error: errorMessage, errorCode };
      }
    });
    ipcMain.handle('prepare-download', async (event, { url, payload, fileType }) => {
        try {
          const response = await nodeFetch(url, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              'Authorization': payload.headers.Authorization 
            },
            body: JSON.stringify(payload.body),
          });
  
          if (!response.ok) {
            // Try to parse as JSON, but handle HTML/text responses gracefully
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const errorData = await response.json();
              throw new Error(errorData.message || errorData.error || 'Backend failed to generate the file.');
            } else {
              // Server returned non-JSON (likely HTML error page)
              const errorText = await response.text();
              console.error('Server returned non-JSON response:', errorText.substring(0, 200));
              throw new Error(`Server error (${response.status}): ${response.statusText || 'Endpoint not found or server error'}`);
            }
          }
  
          const tempDir = path.join(app.getPath('temp'), 'psahired-downloads');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
  
          const downloadId = uuidv4();
          const extension = fileType; 
          const tempFilePath = path.join(tempDir, `${downloadId}.${extension}`);
          
          const fileStream = fs.createWriteStream(tempFilePath);
          await new Promise((resolve, reject) => {
              response.body.pipe(fileStream);
              response.body.on("error", reject);
              fileStream.on("finish", resolve);
          });
  
          return { success: true, downloadId };
        } catch (error) {
          console.error('File preparation failed:', error);
          return { success: false, message: error.message };
        }
      });
  
      ipcMain.handle('save-file', async (event, { downloadId, fileName, fileType }) => {
          const tempDir = path.join(app.getPath('temp'), 'psahired-downloads');
          const extension = fileType;
          const tempFilePath = path.join(tempDir, `${downloadId}.${extension}`);
  
          if (!fs.existsSync(tempFilePath)) {
              console.error(`File not found at path: ${tempFilePath}`);
              return { status: 'failed', message: 'Temporary file not found. Path mismatch may have occurred.' };
          }
  
          const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
              defaultPath: fileName,
          });
  
          if (canceled || !filePath) {
            fs.unlinkSync(tempFilePath);
            return { status: 'cancelled', message: 'Download was cancelled.' };
          }
  
          fs.renameSync(tempFilePath, filePath);
          
          return { 
            status: 'completed', 
            message: `File downloaded successfully!`,
            path: filePath
          };
        });
  
      ipcMain.handle('open-file', (event, filePath) => {
        shell.openPath(filePath);
      });
              
    ipcMain.handle('backup-database', async () => {
        const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Encrypted Database Backup',
            defaultPath: `psahired_backup_${new Date().toISOString().split('T')[0]}.zip`,
            filters: [{ name: 'ZIP Archives', extensions: ['zip'] }]
        });

        if (canceled || !filePath) {
            return { success: false, message: 'Backup cancelled.' };
        }

        try {
            const serverIp = store.get('serverIpAddress') || '127.0.0.1';
            const serverPort = process.env.API_PORT || '3001';
            
            const response = await nodeFetch(`http://${serverIp}:${serverPort}/api/database/backup`, {
                method: 'POST'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Server failed to create backup.');
            }

            const fileStream = fs.createWriteStream(filePath);
            await new Promise((resolve, reject) => {
                response.body.pipe(fileStream);
                response.body.on("error", reject);
                fileStream.on("finish", resolve);
            });

            return { success: true, message: `Encrypted backup successfully saved!` };
        } catch (err) {
            return { success: false, message: `Backup failed: ${err.message}` };
        }
    });

    ipcMain.handle('restore-database', async () => {
        const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Encrypted Backup File to Restore',
            properties: ['openFile'],
            filters: [{ name: 'ZIP Archives', extensions: ['zip'] }]
        });

        if (canceled || !filePaths || filePaths.length === 0) {
            return { success: false, message: 'Restore cancelled.' };
        }
        const filePath = filePaths[0];

        try {
            const serverIp = store.get('serverIpAddress') || '127.0.0.1';
            const serverPort = process.env.API_PORT || '3001';
            const fileStream = fs.createReadStream(filePath);

            const response = await nodeFetch(`http://${serverIp}:${serverPort}/api/database/restore`, {
                method: 'POST',
                body: fileStream,
                headers: { 'Content-Type': 'application/zip' }
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Server failed to restore database.');

            return { success: true, message: result.message };
        } catch (err) {
            return { success: false, message: `Restore failed: ${err.message}` };
        }
    });

    ipcMain.handle('save-csv-file', async (event, { content, fileName }) => {
        try {
            // Define the target directory
            const targetDir = path.join('C:\\', 'HireTrack PDFs', 'Employee Records');
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            // Set the file path directly (auto-save without dialog)
            const filePath = path.join(targetDir, fileName);
            
            try {
                fs.writeFileSync(filePath, content);
            } catch (writeErr) {
                if (writeErr.code === 'EBUSY' || writeErr.code === 'EPERM') {
                    throw new Error('The file is currently open.');
                }
                throw writeErr;
            }

            // Auto-open the file
            await shell.openPath(filePath);

            return { 
                status: 'completed', 
                message: 'File saved to C:\\HireTrack PDFs\\Employee Records and opened!',
                path: filePath 
            };
        } catch (err) {
            console.error('Failed to save CSV file:', err);
            return { status: 'failed', message: err.message };
        }
    });

    ipcMain.handle('save-pdf', async (event, pdfData, fileName, folderName = 'Pre-Assessment Report') => {
        try {
            // Get the custom PDF folder path
            const pdfFolderPath = path.join('C:', 'HireTrack PDFs', folderName);
            
            // Create the folder if it doesn't exist
            if (!fs.existsSync(pdfFolderPath)) {
                fs.mkdirSync(pdfFolderPath, { recursive: true });
            }
            
            const filePath = path.join(pdfFolderPath, fileName);

            // Convert base64 to buffer
            const buffer = Buffer.from(pdfData, 'base64');

            // Write file to the specified folder
            fs.writeFileSync(filePath, buffer);

            // Open the file with system default PDF reader
            await shell.openPath(filePath);

            return { status: 'success', path: filePath };
        } catch (err) {
            console.error('Failed to save or open PDF:', err);
            return { status: 'failed', message: err.message };
        }
    });

    // --- Auto Save Certificate Handler ---
    // Auto-saves certificates to predefined folders without user prompt
    ipcMain.handle('auto-save-certificate', async (event, { downloadId, fileName, certificateType }) => {
        try {
            const tempDir = path.join(app.getPath('temp'), 'psahired-downloads');
            const extension = 'pdf';
            const tempFilePath = path.join(tempDir, `${downloadId}.${extension}`);

            if (!fs.existsSync(tempFilePath)) {
                console.error(`Temp file not found at path: ${tempFilePath}`);
                return { status: 'failed', message: 'Temporary file not found.' };
            }

            // Determine the target folder based on certificate type
            let targetFolder;
            if (certificateType === 'training') {
              targetFolder = path.join('C:', 'HireTrack PDFs', 'Training Certificate');
            } else if (certificateType === 'employment') {
              targetFolder = path.join('C:', 'HireTrack PDFs', 'Employment Certificate');
            } else if (certificateType === 'external') {
              // New: save to External folder for external partner certificates
              targetFolder = path.join('C:', 'HireTrack PDFs', 'External');
            } else {
              return { status: 'failed', message: 'Invalid certificate type.' };
            }

            // Create the folder if it doesn't exist
            if (!fs.existsSync(targetFolder)) {
              fs.mkdirSync(targetFolder, { recursive: true });
            }

            const finalFilePath = path.join(targetFolder, `${fileName}.${extension}`);

            // Move the file from temp to target folder
            fs.renameSync(tempFilePath, finalFilePath);

            // Auto-open the saved file with default PDF viewer
            try {
              await shell.openPath(finalFilePath);
            } catch (openErr) {
              console.error('Auto-open failed:', openErr?.message || openErr);
            }

            return { 
              status: 'completed', 
              message: `Certificate saved to ${targetFolder}`,
              path: finalFilePath
            };
        } catch (err) {
            console.error('Failed to auto-save certificate:', err);
            return { status: 'failed', message: `Auto-save failed: ${err.message}` };
        }
    });

    // --- Auto Updater Logic ---
    function setupAutoUpdater() {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowPrerelease = false;
      
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'Syano18',
        repo: 'PSA-HireTrack',
      });

      // Logging for troubleshooting
      autoUpdater.logger = console;

      // Clean up previous listeners and add new ones once
      autoUpdater.removeAllListeners();
      
      // Forward all auto-updater events to the renderer process
      const events = ['update-available', 'update-not-available', 'update-error', 'download-progress', 'update-downloaded'];
      events.forEach(eventName => {
        autoUpdater.on(eventName, (...args) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(eventName, ...args);
          }
        });
      });

      // Perform a silent background check 5 seconds after launch
      setTimeout(() => {
        if (!isDev) {
          autoUpdater.checkForUpdates().catch(err => console.log('Silent background update check failed:', err.message));
        }
      }, 5000);
    }

    // Call setup once
    setupAutoUpdater();

    // --- Auto Updater Handlers ---
    ipcMain.handle('get-app-version', () => app.getVersion());

    ipcMain.on('check-for-updates', () => {
      // Since setupAutoUpdater already configured it, we just need to trigger
      autoUpdater.checkForUpdates();
    });

    ipcMain.on('quit-and-install', () => {
      autoUpdater.quitAndInstall();
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'psahiretrack/build/index.html'));
    }
  }

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

startApp();