const { contextBridge, ipcRenderer } = require('electron');
const { webUtils } = require('electron');

contextBridge.exposeInMainWorld('videoPreview', {
  selectVideos: () => ipcRenderer.invoke('select-videos'),
  selectFolderVideos: () => ipcRenderer.invoke('select-folder-videos'),
  selectTempDirectory: () => ipcRenderer.invoke('select-temp-directory'),
  classifyVideoInputs: (paths) => ipcRenderer.invoke('classify-video-inputs', paths),
  generatePreviews: (filePaths) => ipcRenderer.invoke('generate-previews', filePaths),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getInitialFiles: () => ipcRenderer.invoke('get-initial-files'),
  getQuickCommands: (paths) => ipcRenderer.invoke('get-quick-commands', paths),
  copyText: (value) => ipcRenderer.invoke('copy-text', value),
  getRecentLog: () => ipcRenderer.invoke('get-recent-log'),
  getActiveJobs: () => ipcRenderer.invoke('get-active-jobs'),
  clearLog: () => ipcRenderer.invoke('clear-log'),
  showLogFile: () => ipcRenderer.invoke('show-log-file'),
  installContextMenu: () => ipcRenderer.invoke('install-context-menu'),
  uninstallContextMenu: () => ipcRenderer.invoke('uninstall-context-menu'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('generation-progress', listener);
    return () => ipcRenderer.removeListener('generation-progress', listener);
  },
  onLogUpdate: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('log-updated', listener);
    return () => ipcRenderer.removeListener('log-updated', listener);
  }
});
