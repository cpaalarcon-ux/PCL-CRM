const { contextBridge, ipcRenderer } = require('electron');

const actions=['login','view','activity','signout','sync','save','retryEntry','discard','openERP'];
contextBridge.exposeInMainWorld('pclOffline',Object.fromEntries(
  actions.map(action=>[action,(...args)=>ipcRenderer.invoke('offline:'+action,...args)])
));
