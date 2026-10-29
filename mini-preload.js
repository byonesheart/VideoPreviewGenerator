const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniPreview', {
  state: () => ipcRenderer.invoke('mini-state'),
  cancel: (id, inputIndex) => ipcRenderer.invoke('mini-cancel', id, inputIndex),
  cancelAll: () => ipcRenderer.invoke('mini-cancel-all'),
  setToggle: (key, value) => ipcRenderer.invoke('mini-set-toggle', key, value)
});
