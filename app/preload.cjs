const { contextBridge, ipcRenderer } = require('electron');
let cachedState;

contextBridge.exposeInMainWorld('gitCloner', {
  getState: async () => { cachedState = await ipcRenderer.invoke('state:get'); return cachedState; },
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  chooseDirectory: () => ipcRenderer.invoke('directory:choose'),
  runBackup: () => ipcRenderer.invoke('backup:run'),
  pauseBackup: () => ipcRenderer.invoke('backup:pause'),
  resumeBackup: () => ipcRenderer.invoke('backup:resume'),
  discardBackup: () => ipcRenderer.invoke('backup:discard'),
  preview: input => ipcRenderer.invoke('backup:preview',input),
  openChanges: options => ipcRenderer.invoke('changes:open',options),
  listChanges: options => ipcRenderer.invoke('changes:list',options),
  changesFile: options => ipcRenderer.invoke('changes:file',options),
  closeChanges: () => ipcRenderer.invoke('changes:close'),
  locateDrives: () => ipcRenderer.invoke('drives:locate'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  ignoreUpdate: () => ipcRenderer.invoke('updates:ignore'),
  resetUpdate: () => ipcRenderer.invoke('updates:reset'),
  saveToken: (token, accountId = 'default') => ipcRenderer.invoke('token:save', token, accountId),
  unlockEncryption: options => ipcRenderer.invoke('encryption:unlock', options),
  beginLogin: id => ipcRenderer.invoke('auth:begin', id),
  cancelLogin: () => ipcRenderer.invoke('auth:cancel'),
  copyDeviceCode: () => ipcRenderer.invoke('auth:copy-code'),
  verifyBackup: options => ipcRenderer.invoke('backup:verify', options),
  chooseArchive: () => ipcRenderer.invoke('archive:choose'),
  restoreBackup: options => ipcRenderer.invoke('backup:restore', options),
  browseOpen: options => ipcRenderer.invoke('restore:browse-open',options),
  browseList: options => ipcRenderer.invoke('restore:browse-list',options),
  browseClose: id => ipcRenderer.invoke('restore:browse-close',id),
  restoreSelection: options => ipcRenderer.invoke('restore:selection',options),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  openLink: name => ipcRenderer.invoke('link:open', name),
  openDestination: id => ipcRenderer.invoke('destination:open', id),
  onState: callback => {
    const listener = (_event, patch) => { cachedState = { ...cachedState, ...patch }; callback(cachedState); };
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  }
});
