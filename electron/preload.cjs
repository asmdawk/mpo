const { contextBridge, ipcRenderer, webUtils } = require('electron');
const subscribe = (channel, fn) => {
  if (typeof fn !== 'function') return () => {};
  const listener = (_event, value) => fn(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('zigzak', Object.freeze({
  getInitialState: () => ipcRenderer.invoke('state:get'),
  openFiles: () => ipcRenderer.invoke('files:open'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  importPlaylist: () => ipcRenderer.invoke('playlist:import'),
  exportPlaylist: tracks => ipcRenderer.invoke('playlist:export', tracks),
  importDropped: files => ipcRenderer.invoke('files:import', Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  saveState: state => ipcRenderer.invoke('state:save', state),
  windowAction: action => ipcRenderer.send('window:action', action),
  onFiles: callback => subscribe('files:added', callback),
  onFullscreen: callback => subscribe('window:fullscreen', callback),
  onBeforeClose: callback => subscribe('window:before-close', callback)
}));
