const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pullOrders: () => ipcRenderer.invoke('pull-orders'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printLabels: (data) => ipcRenderer.invoke('print-labels', data),
  savePdf: (data) => ipcRenderer.invoke('save-pdf', data),
  autoSavePdf: (data) => ipcRenderer.invoke('auto-save-pdf', data),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  chooseCsvFile: () => ipcRenderer.invoke('choose-csv-file'),
  getLogoDataUrl: () => ipcRenderer.invoke('get-logo-data-url'),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  onScheduledPull: (callback) => ipcRenderer.on('scheduled-pull', callback)
});
