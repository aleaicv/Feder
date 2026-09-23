
// Custom "Handle" adapter for Electron to mimic FileSystemAccess API

export const getElectronHandle = (path, name) => {
    return createDirHandle(path, name || path.split(/[\\/]/).pop());
};

const createDirHandle = (path, name) => {
    return {
        kind: 'directory',
        name: name,
        path: path, // Internal custom property
        async getFileHandle(name, opts) {
            const filePath = `${path}\\${name}`; // Windows specific, but better use slash? Electron handles both usually.
            // Check if exists if create is false?
            // For simplicity, we assume we return a handle pointing to that path.
            // If create: true, we might want to ensure it exists or just rely on write.
            return createFileHandle(filePath, name);
        },
        async getDirectoryHandle(name, opts) {
            const dirPath = `${path}\\${name}`;
            if (opts?.create) {
                await window.electronAPI.createDir(dirPath);
            }
            return createDirHandle(dirPath, name);
        },
        async *values() {
            const entries = await window.electronAPI.readDir(path);
            for (const entry of entries) {
                if (entry.kind === 'directory') {
                    yield createDirHandle(`${path}\\${entry.name}`, entry.name);
                } else {
                    yield createFileHandle(`${path}\\${entry.name}`, entry.name);
                }
            }
        },
        async move(destination, newName) {
            let targetPath;
            if (typeof destination === 'string') {
                const pathParts = path.split(/[\\/]/);
                pathParts.pop();
                targetPath = [...pathParts, destination].join('\\');
            } else {
                targetPath = `${destination.path}\\${newName || name}`;
            }
            await window.electronAPI.rename(path, targetPath);
        },
        async removeEntry(name, opts) {
            const targetPath = `${path}\\${name}`;
            await window.electronAPI.delete(targetPath);
        },
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted'
    };
};

const createFileHandle = (path, name) => {
    return {
        kind: 'file',
        name: name,
        path: path,
        async getFile() {
            // In browser API, getFile returns a Blob/File object.
            // We need to mimic that.
            // For text files, we can read string. For images, buffer.
            // But the app expects `file.text()` and `file.arrayBuffer()`.
            return {
                name: name,
                lastModified: Date.now(), // Mocked
                text: async () => await window.electronAPI.readFile(path),
                arrayBuffer: async () => {
                    const buf = await window.electronAPI.readFileBuffer(path);
                    if (!buf) return new ArrayBuffer(0);
                    // Safe slice to avoid returning the entire shared underlying buffer pool
                    const offset = buf.byteOffset || 0;
                    const length = buf.byteLength || buf.length || 0;
                    if (buf.buffer instanceof ArrayBuffer) {
                        return buf.buffer.slice(offset, offset + length);
                    }
                    return new Uint8Array(buf).buffer;
                }
            };
        },
        async createWritable() {
            return {
                write: async (content) => {
                    // Content might be string or buffer
                    await window.electronAPI.writeFile(path, content);
                },
                close: async () => { }
            };
        },
        async move(destination, newName) {
            let targetPath;
            if (typeof destination === 'string') {
                const pathParts = path.split(/[\\/]/);
                pathParts.pop();
                targetPath = [...pathParts, destination].join('\\');
            } else {
                targetPath = `${destination.path}\\${newName || name}`;
            }
            await window.electronAPI.rename(path, targetPath);
        },
        async remove() {
            await window.electronAPI.delete(path);
        },
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted'
    };
};
