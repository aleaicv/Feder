const { contextBridge, ipcRenderer } = require('electron');
const { webUtils } = require('electron'); // Optional, if needed for drag-drop path

contextBridge.exposeInMainWorld('electronAPI', {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    readDir: (path) => ipcRenderer.invoke('fs:readDir', path),
    readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
    readFileBuffer: (path) => ipcRenderer.invoke('fs:readFileBuffer', path),
    writeFile: (path, data) => ipcRenderer.invoke('fs:writeFile', { path, data }),
    createDir: (path) => ipcRenderer.invoke('fs:createDir', path),
    delete: (path) => ipcRenderer.invoke('fs:delete', path),
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', { oldPath, newPath }),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    exportPdf: (data) => ipcRenderer.invoke('export:pdf', data),
    isElectron: true
});

