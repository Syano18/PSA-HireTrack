// main.js

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');

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
      },
    });

    mainWindow.removeMenu();
    mainWindow.maximize();
    mainWindow.show();

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        const serverIp = store.get('serverIpAddress') || '127.0.0.1';
        const serverPort = 3001;

        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:${serverPort} http://127.0.0.1:${serverPort} http://${serverIp}:${serverPort}`
                ]
            }
        });
    });

    // --- CLEANUP: remove existing handlers to avoid "second handler" errors when we recreate the window ---
    const ipcHandleChannels = [
      'get-login-state','set-login-state','clear-login-state','session-expired',
      'get-dark-mode','set-dark-mode',
      'get-server-ip','set-server-ip','restart-app','get-local-ip',
      'login','prepare-download','save-file','open-file',
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
          // network errors: ignore or log; do not force logout on transient network failure
          // console.error('session watcher error', err.message);
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
        console.error(`Failed to connect to ${serverUrl}:`, error.message);
        return { error: 'Server unreachable. Please check the IP address and your network connection.' };
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