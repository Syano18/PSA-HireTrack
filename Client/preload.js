// preload.js

const { contextBridge, ipcRenderer } = require('electron');

// Make a synchronous call to the main process to get the theme setting
const initialDarkMode = ipcRenderer.sendSync('get-dark-mode-sync');

contextBridge.exposeInMainWorld('electronAPI', {
  // Login-related handlers
  getLoginState: () => ipcRenderer.invoke('get-login-state'),
  setLoginState: (state) => ipcRenderer.invoke('set-login-state', state),
  clearLoginState: () => ipcRenderer.invoke('clear-login-state'),
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  fetchUserDetails: (email) => ipcRenderer.invoke('fetch-user-details', email),

  // ADD THIS LINE
  handleSessionExpired: () => ipcRenderer.invoke('session-expired'),

  getServerIp: () => ipcRenderer.invoke('get-server-ip'),
  setServerIp: (ip) => ipcRenderer.invoke('set-server-ip', ip),
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'), 
  
  // Dark mode handlers
  getDarkMode: () => ipcRenderer.invoke('get-dark-mode'),
  setDarkMode: (value) => ipcRenderer.invoke('set-dark-mode', value),

  // Expose initial dark mode state
  initialDarkMode,
  
  // Download handlers for certificate generation
  prepareDownload: (payload) => ipcRenderer.invoke('prepare-download', payload),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  saveCsvFile: (args) => ipcRenderer.invoke('save-csv-file', args),

  // Backup/Restore handlers
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),

  // Restart handlers
  onShowRestartPrompt: (callback) => ipcRenderer.on('ip-saved-show-restart-prompt', callback),
  restartApp: () => ipcRenderer.invoke('restart-app'),

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