// main.js

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const crypto = require('crypto'); // Required for Google Auth
const http = require('http');

// Declare variables outside the async function
let store;
let nodeFetch;
let mainWindow;
let uuidv4;

async function initializeDependencies() {
  const { default: Store } = await import('electron-store');
  const { default: fetch } = await import('node-fetch');
  const { v4 } = await import('uuid');
  
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
  await initializeDependencies();
  app.commandLine.appendSwitch('disable-site-isolation-trials');

  function createWindow() {
    const isDark = store.get('isDarkMode');
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      icon: path.join(__dirname, './System.ico'),
      backgroundColor: isDark ? '#111827' : '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false, // Allow file:// to make cross-origin requests (fixes "check internet connection")
      },
    });

    mainWindow.removeMenu();
    mainWindow.maximize();
    mainWindow.show();

    // Intercept the Google Sign-In popup to set a custom title
    mainWindow.webContents.on('did-create-window', (childWindow) => {
        childWindow.setTitle('PSA Kalinga HireTrack - Google Sign In');
        const iconPath = path.join(__dirname, 'System.ico');
        if (fs.existsSync(iconPath)) {
            childWindow.setIcon(iconPath);
        }
        childWindow.on('page-title-updated', (e) => {
            e.preventDefault(); // Prevent Google from changing the title back
        });
    });

    mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
        const rawServerIp = store.get('serverIpAddress') || '127.0.0.1';
        let serverIp = rawServerIp;
        let serverPort = 3001;

        // Handle custom ports in the IP address (e.g., 192.168.1.50:8080)
        if (rawServerIp.includes(':') && !rawServerIp.includes('[')) { 
             const parts = rawServerIp.split(':');
             serverIp = parts[0];
             serverPort = parts[1];
        }

        const responseHeaders = details.responseHeaders ? Object.assign({}, details.responseHeaders) : {};

        // Remove existing headers that might conflict (case-insensitive) to ensure our permissive policy wins
        Object.keys(responseHeaders).forEach((key) => {
            const lowerKey = key.toLowerCase();
            if ([
                'content-security-policy', 
                'cross-origin-opener-policy', 
                'cross-origin-opener-policy-report-only',
                'cross-origin-embedder-policy',
                'cross-origin-resource-policy',
                'x-frame-options'
            ].includes(lowerKey)) {
                delete responseHeaders[key];
            }
        });

        // Only inject our App's CSP if it is a local request.
        // Injecting it into accounts.google.com breaks the Google Sign-In page.
        const isLocal = details.url.startsWith('file://') || 
                        details.url.startsWith('http://localhost') || 
                        details.url.startsWith('http://127.0.0.1');

        if (isLocal) {
            const scriptSrc = "'self' 'unsafe-inline' blob: https://apis.google.com https://www.gstatic.com https://www.google.com https://www.googleapis.com https://*.firebaseapp.com";
            responseHeaders['Content-Security-Policy'] = [
                `default-src 'self' 'unsafe-inline' data: blob:; script-src ${scriptSrc}; connect-src 'self' http://localhost:3001 http://127.0.0.1:3001 http://${serverIp}:${serverPort} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://sheets.googleapis.com https://firebasestorage.googleapis.com https://www.googleapis.com https://apis.google.com https://*.firebaseapp.com; frame-src 'self' https://*.firebaseapp.com https://apis.google.com https://accounts.google.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com;`
            ];
            responseHeaders['Cross-Origin-Resource-Policy'] = ['cross-origin'];
        }

        callback({ responseHeaders });
    });

    // --- CLEANUP: remove existing handlers to avoid "second handler" errors when we recreate the window ---
    const ipcHandleChannels = [
      'get-login-state','set-login-state','clear-login-state','session-expired',
      'get-dark-mode','set-dark-mode',
      'get-server-ip','set-server-ip','restart-app','get-local-ip','get-app-version',
      'fetch-user-details', // Add new handler
      'login','prepare-download','save-file','open-file', 
      'check-for-updates', 'download-and-install-update',
      'backup-database','restore-database','save-csv-file'
    ];
    ipcHandleChannels.forEach(ch => {
      try { ipcMain.removeHandler(ch); } catch (e) { /* ignore if none */ }
    });
    // remove any plain listeners added with ipcMain.on
    try { ipcMain.removeAllListeners('get-dark-mode-sync'); } catch (e) { /* ignore */ }

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

    // --- Google Sheets Service Account Logic ---
    ipcMain.handle('fetch-user-details', async (event, email) => {
        // Cache configuration
        const CACHE_FILE = path.join(app.getPath('userData'), 'user_cache.json');
        const CACHE_TTL = 10 * 24 * 60 * 60 * 1000; // 10 days in milliseconds
        let cache = {};

        // 1. Try to read from cache first
        try {
            if (fs.existsSync(CACHE_FILE)) {
                cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                const cachedUser = cache[email];
                if (cachedUser && cachedUser.timestamp && (Date.now() - cachedUser.timestamp < CACHE_TTL)) {
                    return cachedUser.data;
                }
            }
        } catch (err) {
            console.error('Error reading user cache:', err);
        }

        // TODO: PASTE YOUR SERVICE ACCOUNT CREDENTIALS HERE
        // Open the JSON file you downloaded from Google Cloud Console.
        const SERVICE_ACCOUNT = {
            client_email: "digitallogbook@digital-logbook-484909.iam.gserviceaccount.com",
            // REPLACE THIS STRING with the "private_key" from your JSON file.
            // It looks like "-----BEGIN PRIVATE KEY-----\nMIIEv..."
            private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDO8eoHHNBAJaD+\njzFDU2ExEb2fDXt2dT92Kcl3HaB13M4IABJkwSIJb+Jg5spGoZ9B4nlnegsgZuPw\naG0H78SYZlgAw+JbVCAzc0yOArkF9BHaNRZdR5GWQ7aBBJOlG288vqe3ebryzBz9\nv/wTLYJPCkCNEfmqWbk1cYKAzWkxkcC9vcW9dPefSpSu2FQFYfxxE7mqY0gnpdFJ\nM19zD24XUyNY3/rn66sBXM9LGeDjlMYIGhCfLp6sfmKxUkXR4wbQxwkRMDosx7vX\n/lyNXHpVpIGhfx4/giFSZekabBt6msiMxUnDFZvYZHzxPp4+G7ECiFjgCJWxcPw5\nRWy29C87AgMBAAECggEAMFdIUMMFToa7tdsjKdP3VywKvHW8ym4XFfYq7p1IF2At\n7KZ/pXOMDOJK4lHnHFqyxgQuUeKraLVAN69dEMaMiQEXO46GeMkNAJfFYUL3j5F0\n/iD6iW2nb49/uWGlT6M599mdefmAlyjg+NF5A83Uq7v8WjfBt25gGkDauFXDZeV3\ns0RzbvDQRssgTlispogUN2eU67eXKl20W1VwfF0euZZCGFrEPdCZ5N10fW+fsBfg\nymKuMRt/d34ao7682IvsgXUDCbItr9G1VHpcusOEP/7jiLIMF+MiZ1Ni5KQNs/Ko\neUPihnDt7eZG9E5REKRyz6s/mVmtbReXY5fZIx/6oQKBgQDow0nCi1UFGrnfDd6B\nlOoW/+Wb9m8e9xErDTBi0rWNlOm5BmHY50GsDH2f6XJkSlx4H9Vo9I5/9rBhfgrt\nQZ9X0QzzWsogb+TmsE3yO0oNAjd0DaTahQcbDxgnm4f78XW6acYbM8KyRdcDbNA4\n9MgXTA836Mmqy+xNL4K1uGZXUQKBgQDjmsy6jE2ty9QZJsDzLYz4bjCz2LNY/83g\nmB7zB/fmc2D51qrN9sAbhuae2nhci/u0fleKlxUZStcMlzRF1HYZoUV0u5zPI+Nd\ngTEBZ0nPiyASas5+5IQu8Ldi4Y2L8hZQ4FHGufDuTsYum98HtbHJ+Jd5nelFLvqE\nV+H5HUVSywKBgQDJwAOd6bEexISZTucvAElK+DEn1xmICHTMERmAfsy41HslUd/b\n5s6odwcoZWsufLnbsRQEbf1Z8xP83QhRj5CyyFNmV6pdJT+NqQFW1Ycg8WvpXq4m\nbimzjYjNQ+VBPpBhrK73Aw1eAmUU5esxgxIwB1AlkNPEBA9k86pjIlsqkQKBgQCG\nX8onCNaDmScrgjnAWFA2C7gtNe8MyFmgE6+SBE5TfCLw3dARsXBR0B8wAgO1f9+m\n/EBqzi/istCr2kk+QOVI1HHRLUKy+JkvhyqLjZOCOL1ColQvjnKL1AoxEsEislaC\ngS1Gili4GUHgGp5eSuMgPugPIS+rbMTyhYAgNyvKaQKBgQDWFaeKgBEN8MkO5UhU\nltFdRscw7UtbMeghS1Us362ZBUf1laXaEio0qyeMdlxjIUvmd7gUHR5VAFRmoxeq\nu1DpsBfaQKW0qJRBrnLPesvxS1slQQGcAGgNLbfC/I/KHIbunT/w4D/uHAavFukD\n28oh88gkDLL6CZ7egw+rJZlwug==\n-----END PRIVATE KEY-----\n"
        };

        const SHEET_ID = "1V7Ab3v8fvNbeLaduOPLXbV9_nANLSgVVq6I8DSYBs1E";
        const RANGE = "User_Permissions!A:J";

        try {
            // 2. Generate JWT for Google Auth (if cache missed)
            const header = { alg: 'RS256', typ: 'JWT' };
            const now = Math.floor(Date.now() / 1000);
            const claim = {
                iss: SERVICE_ACCOUNT.client_email,
                scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
                aud: 'https://oauth2.googleapis.com/token',
                exp: now + 3600,
                iat: now
            };

            const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const encodedClaim = Buffer.from(JSON.stringify(claim)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            
            const signer = crypto.createSign('RSA-SHA256');
            signer.update(encodedHeader + '.' + encodedClaim);
            const signature = signer.sign(SERVICE_ACCOUNT.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const jwt = `${encodedHeader}.${encodedClaim}.${signature}`;

            // 3. Exchange JWT for Access Token
            const tokenRes = await nodeFetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
            });
            const tokenData = await tokenRes.json();
            
            if (!tokenData.access_token) {
                console.error('Failed to get Google access token:', tokenData);
                return { role: 'User', status: 'Active' }; // Default on error
            }

            // 4. Fetch Sheet Data
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}`;
            const sheetRes = await nodeFetch(url, {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            const data = await sheetRes.json();

            // 5. Parse Data
            let role = 'User';
            let status = 'Active';
            let first_name = '';

            if (data.values && data.values.length > 0) {
                const headers = data.values[0];
                const emailIndex = headers.findIndex(h => h && h.trim().toLowerCase() === 'email');
                const statusIndex = headers.findIndex(h => h && h.trim().toLowerCase() === 'status');
                const roleIndex = headers.findIndex(h => h && h.trim() === 'HireTrack_Role');
                const firstNameIndex = headers.findIndex(h => h && h.trim().toLowerCase() === 'first name');

                const eIdx = emailIndex !== -1 ? emailIndex : 0;
                const sIdx = statusIndex !== -1 ? statusIndex : 8;
                const rIdx = roleIndex !== -1 ? roleIndex : 9;
                const fnIdx = firstNameIndex !== -1 ? firstNameIndex : 2; // Column C is index 2

                const userRow = data.values.find(row => row[eIdx] && row[eIdx].toLowerCase() === email.toLowerCase());
                if (userRow) {
                    role = userRow[rIdx] || 'User';
                    status = userRow[sIdx] || 'Active';
                    first_name = userRow[fnIdx] || '';
                }
            }

            const result = { role, status, first_name };

            // 6. Save to cache
            try {
                cache[email] = { timestamp: Date.now(), data: result };
                fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
            } catch (writeErr) {
                console.error('Error writing user cache:', writeErr);
            }

            return result;

        } catch (error) {
            console.error('Google Sheet Auth Error:', error);
            return { role: 'User', status: 'Active', first_name: '' };
        }
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
    ipcMain.on('get-dark-mode-sync', (event) => {
        event.returnValue = store.get('isDarkMode');
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
    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
    });

    ipcMain.handle('check-for-updates', async () => {
        // TODO: Verify your GitHub details here
        const GITHUB_OWNER = "Syano18"; 
        const GITHUB_REPO = "PSA-HireTrack";
        
        try {
            const response = await nodeFetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
            if (!response.ok) return { updateAvailable: false, error: 'Failed to fetch releases' };
            
            const data = await response.json();
            const latestVersion = data.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
            const currentVersion = app.getVersion();
            
            // Simple version comparison (semver-like)
            const v1 = latestVersion.split('.').map(Number);
            const v2 = currentVersion.split('.').map(Number);
            let updateAvailable = false;
            
            for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
                const n1 = v1[i] || 0;
                const n2 = v2[i] || 0;
                if (n1 > n2) { updateAvailable = true; break; }
                if (n1 < n2) { break; }
            }

            if (updateAvailable) {
                const asset = data.assets.find(a => a.name.endsWith('.exe'));
                return {
                    updateAvailable: true,
                    version: data.tag_name,
                    downloadUrl: asset ? asset.browser_download_url : null,
                    releaseNotes: data.body
                };
            }
            return { updateAvailable: false };
        } catch (err) {
            console.error('Update check failed:', err);
            return { updateAvailable: false, error: err.message };
        }
    });

    ipcMain.handle('download-and-install-update', async (event, downloadUrl) => {
        try {
            const response = await nodeFetch(downloadUrl);
            if (!response.ok) throw new Error('Failed to download file');
            
            const tempDir = app.getPath('temp');
            const fileName = 'PSA-HireTrack-Update.exe';
            const filePath = path.join(tempDir, fileName);
            
            const fileStream = fs.createWriteStream(filePath);
            await new Promise((resolve, reject) => {
                response.body.pipe(fileStream);
                response.body.on("error", reject);
                fileStream.on("finish", resolve);
            });
            
            shell.openPath(filePath);
            setTimeout(() => app.quit(), 1000); // Quit app to allow installer to run
            return { success: true };
        } catch (err) {
            return { success: false, message: err.message };
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
            const errorData = await response.json();
            throw new Error(errorData.message || 'Backend failed to generate the file.');
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
            const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: fileName,
            filters: [{ name: 'CSV Files', extensions: ['csv'] }]
            });

            if (canceled || !filePath) {
            return { status: 'cancelled' };
            }
            try {
            fs.writeFileSync(filePath, content);
            } catch (writeErr) {
            if (writeErr.code === 'EBUSY' || writeErr.code === 'EPERM') {
                throw new Error('The file is currently open.');
            }
            throw writeErr;
            }

            return { 
            status: 'completed', 
            message: 'File saved successfully!',
            path: filePath 
            };
        } catch (err) {
            console.error('Failed to save CSV file:', err);
            return { status: 'failed', message: err.message };
        }
    });

    const isDev = !app.isPackaged;

    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        // Serve static files via HTTP server to fix Firebase Auth "unauthorized-domain" error
        // Firebase Auth does not support file:// protocol for signInWithPopup
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        const buildPath = path.join(__dirname, 'psahiretrack/build');
        const serverPort = 4173;

        const server = http.createServer((req, res) => {
            const urlPath = req.url.split('?')[0];
            const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
            let filePath = path.join(buildPath, safePath === '/' || safePath === '\\' ? 'index.html' : safePath);
            
            const extname = String(path.extname(filePath)).toLowerCase();
            const contentType = mimeTypes[extname] || 'application/octet-stream';

            fs.readFile(filePath, (error, content) => {
                if (error) {
                    // SPA Fallback: serve index.html
                    fs.readFile(path.join(buildPath, 'index.html'), (err, indexContent) => {
                        if (err) { res.writeHead(500); res.end('Error'); }
                        else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(indexContent, 'utf-8'); }
                    });
                } else {
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(content, 'utf-8');
                }
            });
        });

        server.listen(serverPort, 'localhost', () => {
            mainWindow.loadURL(`http://localhost:${serverPort}`);
        });

        app.on('will-quit', () => {
            server.close();
        });
    }
  }

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  //mainWindow.webContents.openDevTools();
}

startApp();