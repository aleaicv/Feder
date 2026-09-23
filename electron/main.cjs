const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, '../public/feder.ico'),
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: 'rgba(0, 0, 0, 0)',
            symbolColor: '#74b1be',
            height: 30
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    win.setMenu(null); // Remove the top menu bar

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
        win.loadURL(devUrl);
        win.webContents.openDevTools();
    } else {
        // Basic dev handling
        if (!app.isPackaged) {
            win.loadURL('http://localhost:5173');
            win.webContents.openDevTools();
        } else {
            win.loadFile(path.join(__dirname, '../dist/index.html'));
        }
    }

    // Zoom Handling
    win.webContents.on('did-finish-load', () => {
        win.webContents.setZoomFactor(1.2); // Set initial zoom to 120%
    });

    win.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.type === 'keyDown') {
            const currentZoom = win.webContents.getZoomFactor();
            if (input.key === '=' || input.key === '+') {
                win.webContents.setZoomFactor(currentZoom + 0.1);
                event.preventDefault();
            } else if (input.key === '-') {
                if (currentZoom > 0.5) {
                    win.webContents.setZoomFactor(currentZoom - 0.1);
                }
                event.preventDefault();
            } else if (input.key === '0') {
                win.webContents.setZoomFactor(1.2); // Reset to custom default
                event.preventDefault();
            }
        }
    });
}

// IPC Handlers for File System
ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('fs:readDir', async (_, dirPath) => {
    try {
        const dirents = await fs.readdir(dirPath, { withFileTypes: true });
        return dirents.map(dirent => ({
            name: dirent.name,
            kind: dirent.isDirectory() ? 'directory' : 'file'
        }));
    } catch (e) {
        console.error('fs:readDir error', e);
        throw e;
    }
});

ipcMain.handle('fs:readFile', async (_, filePath) => {
    return await fs.readFile(filePath, 'utf-8'); // Assuming text for MD/JSON. For binary/images we might need base64 or buffer.
});

ipcMain.handle('fs:readFileBuffer', async (_, filePath) => {
    const buffer = await fs.readFile(filePath);
    return buffer; // Electron handles buffer serialization
});

ipcMain.handle('fs:writeFile', async (_, { path, data }) => {
    return await fs.writeFile(path, data);
});

ipcMain.handle('fs:createDir', async (_, dirPath) => {
    return await fs.mkdir(dirPath, { recursive: true });
});

ipcMain.handle('fs:delete', async (_, targetPath) => {
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
        return await fs.rm(targetPath, { recursive: true, force: true });
    } else {
        return await fs.unlink(targetPath);
    }
});
ipcMain.handle('fs:rename', async (_, { oldPath, newPath }) => {
    return await fs.rename(oldPath, newPath);
});

ipcMain.handle('export:pdf', async (event, { html, defaultFilename }) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(parentWin, {
        title: 'Export PDF',
        defaultPath: defaultFilename || 'document.pdf',
        filters: [
            { name: 'PDF Documents', extensions: ['pdf'] }
        ]
    });

    if (canceled || !filePath) {
        return { canceled: true };
    }

    const tempPath = path.join(app.getPath('temp'), `feder_print_${Date.now()}_${Math.random().toString(36).slice(2)}.html`);
    const printWin = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    try {
        await fs.writeFile(tempPath, html, 'utf-8');
        await printWin.loadFile(tempPath);

        // Wait for document and fonts to settle
        await printWin.webContents.executeJavaScript(`
            Promise.all([
                document.fonts ? document.fonts.ready : Promise.resolve(),
                new Promise(resolve => setTimeout(resolve, 300))
            ])
        `).catch(() => {});

        const pdfBuffer = await printWin.webContents.printToPDF({
            pageSize: 'A4',
            printBackground: true,
            margins: {
                top: 0.4,
                bottom: 0.4,
                left: 0.4,
                right: 0.4
            }
        });

        await fs.writeFile(filePath, pdfBuffer);
        return { success: true, filePath };
    } catch (err) {
        console.error('Failed to export PDF:', err);
        throw err;
    } finally {
        printWin.close();
        await fs.unlink(tempPath).catch(() => {});
    }
});
// End IPC Handlers


ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
});

ipcMain.handle('shell:openExternal', async (_, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
});

ipcMain.handle('shell:openPath', async (_, dirPath) => {
    const { shell } = require('electron');
    await shell.openPath(dirPath);
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, we should focus our window.
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length) {
            if (allWindows[0].isMinimized()) allWindows[0].restore();
            allWindows[0].focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
