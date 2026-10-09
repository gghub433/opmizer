'use strict';
// Sandboxed preload: the page gets exactly one function, nothing from Node or Electron leaks through.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ginnDesktop', {
  call: (method, args) => ipcRenderer.invoke('ginn', method, args)
});
