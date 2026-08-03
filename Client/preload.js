// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Login-related handlers
  getLoginState: () => ipcRenderer.invoke('get-login-state'),
  setLoginState: (state) => ipcRenderer.invoke('set-login-state', state),
  clearLoginState: () => ipcRenderer.invoke('clear-login-state'),
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  loginGoogleLoopback: () => ipcRenderer.invoke('login-google-loopback'),
  loginGoogleSilent: () => ipcRenderer.invoke('login-google-silent'),
  clearGoogleRefreshToken: () => ipcRenderer.invoke('clear-google-refresh-token'),
  hasGoogleRefreshToken: () => ipcRenderer.invoke('has-google-refresh-token'),

  handleSessionExpired: () => ipcRenderer.invoke('session-expired'),

  getServerIp: () => ipcRenderer.invoke('get-server-ip'),
  setServerIp: (ip) => ipcRenderer.invoke('set-server-ip', ip),
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'), 
  
  // Dark mode handlers
  getDarkMode: () => ipcRenderer.invoke('get-dark-mode'),
  setDarkMode: (value) => ipcRenderer.invoke('set-dark-mode', value),
  
  // Download handlers for certificate generation
  prepareDownload: (payload) => ipcRenderer.invoke('prepare-download', payload),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  autoSaveCertificate: (payload) => ipcRenderer.invoke('auto-save-certificate', payload),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  saveCsvFile: (args) => ipcRenderer.invoke('save-csv-file', args),
  savePDF: (pdfData, fileName, folderName = 'Pre-Assessment Report') => ipcRenderer.invoke('save-pdf', pdfData, fileName, folderName),

  // Backup/Restore handlers
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),

  // Restart handlers
  onShowRestartPrompt: (callback) => ipcRenderer.on('ip-saved-show-restart-prompt', callback),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // Auto Update handlers
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),
  onUpdateAvailable: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('update-available', subscription);
    return () => ipcRenderer.removeListener('update-available', subscription);
  },
  onUpdateNotAvailable: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('update-not-available', subscription);
    return () => ipcRenderer.removeListener('update-not-available', subscription);
  },
  onUpdateError: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('update-error', subscription);
    return () => ipcRenderer.removeListener('update-error', subscription);
  },
  onUpdateProgress: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('update-progress', subscription);
    return () => ipcRenderer.removeListener('update-progress', subscription);
  },
  onUpdateDownloaded: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('update-downloaded', subscription);
    return () => ipcRenderer.removeListener('update-downloaded', subscription);
  },

  // Listeners
  onLoginStateChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('onLoginStateChange', listener);
    return () => ipcRenderer.removeListener('onLoginStateChange', listener);
  },
  onDarkModeChange: (callback) => {
    const listener = (event, value) => callback(value);
    ipcRenderer.on('onDarkModeChange', listener);
    return () => ipcRenderer.removeListener('onDarkModeChange', listener);
  },
});