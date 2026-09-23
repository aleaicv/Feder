/**
 * Maps image file extensions to standard MIME types
 */
export function getMimeType(filename) {
    if (!filename) return 'application/octet-stream';
    const ext = filename.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'svg': return 'image/svg+xml';
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'webp': return 'image/webp';
        case 'gif': return 'image/gif';
        case 'bmp': return 'image/bmp';
        case 'ico': return 'image/x-icon';
        case 'tiff':
        case 'tif': return 'image/tiff';
        case 'avif': return 'image/avif';
        default: return 'application/octet-stream';
    }
}

/**
 * Detects MIME type from file magic bytes or falls back to filename extension
 */
export function detectMimeType(bytes, filename) {
    if (bytes && bytes.length >= 4) {
        // PNG: 89 50 4E 47
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
            return 'image/png';
        }
        // JPEG: FF D8 FF
        if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
            return 'image/jpeg';
        }
        // GIF: 47 49 46 38
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
            return 'image/gif';
        }
        // WebP: RIFF .... WEBP
        if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            return 'image/webp';
        }
        // SVG: XML or <svg
        if (bytes[0] === 0x3C) {
            return 'image/svg+xml';
        }
    }
    return getMimeType(filename);
}

/**
 * Converts a binary ArrayBuffer or Uint8Array to a base64 Data URL.
 * Uses chunked processing to safely convert large images without stack overflow.
 */
export function arrayBufferToDataUrl(input, mimeType = 'image/png') {
    if (!input) return '';
    let bytes;
    if (input instanceof Uint8Array) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
    } else if (input?.buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength || input.length);
    } else {
        bytes = new Uint8Array(input);
    }

    if (!bytes || bytes.length === 0) {
        return '';
    }

    if (!mimeType || mimeType === 'application/octet-stream') {
        mimeType = detectMimeType(bytes);
    }

    if (typeof Buffer !== 'undefined') {
        const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
        return `data:${mimeType};base64,${base64}`;
    }

    let binary = '';
    const len = bytes.length;
    const CHUNK_SZ = 0x8000; // 32KB chunks
    for (let i = 0; i < len; i += CHUNK_SZ) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SZ, len)));
    }
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
}

/**
 * Normalizes path segments by resolving '.' and '..' relative to root.
 * Returns a clean forward-slash relative path without leading or trailing slashes.
 */
export function normalizePathSegments(pathStr) {
    if (!pathStr) return '';
    const norm = pathStr.replace(/\\/g, '/');
    const parts = norm.split('/');
    const stack = [];
    for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (stack.length > 0 && stack[stack.length - 1] !== '..') {
                stack.pop();
            }
        } else {
            stack.push(part);
        }
    }
    return stack.join('/');
}

/**
 * Recursively searches a DirectoryHandle for a file matching targetFilename (case-insensitive)
 */
async function searchFileRecursively(dirHandle, targetFilename, depth = 0) {
    if (!dirHandle || depth > 5) return null;
    try {
        const lowerTarget = targetFilename.toLowerCase();
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase() === lowerTarget) {
                return entry;
            }
            if (entry.kind === 'directory') {
                const lower = entry.name.toLowerCase();
                if (lower === '.git' || lower === 'node_modules' || lower === 'dist' || lower === 'build') continue;
                const found = await searchFileRecursively(entry, targetFilename, depth + 1);
                if (found) return found;
            }
        }
    } catch (e) {
        // Access or traversal error
    }
    return null;
}

/**
 * Resolves an image path by checking multiple likely locations in priority order:
 * 1. Markdown document directory (resolving standard relative paths like ../figures/foo.png or ./foo.png)
 * 2. Document's local figures folder: [docDir]/[figuresFolder]/[clean]
 * 3. Project root: [clean]
 * 4. Project's root figures folder: [figuresFolder]/[clean] & [figuresFolder]/[filename]
 * 5. Common asset folders: images/, assets/, img/
 * 6. Recursive project search fallback
 *
 * Returns { buffer, file, mimeType, candidate, fullPath } or null if not found.
 */
export async function resolveImageFile(rawSrc, dirHandle, filePath = '', projectMetadata = null) {
    if (!rawSrc || !dirHandle) return null;

    // Skip remote or already embedded data/blob URLs
    if (rawSrc.startsWith('http://') || rawSrc.startsWith('https://') || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) {
        return null;
    }

    // Clean up rawSrc (strip angle brackets, quotes, query params, hash, markdown title)
    let clean = rawSrc.trim();
    clean = clean.replace(/^<|>$/g, '');
    clean = clean.replace(/^["']|["']$/g, '');
    const titleMatch = clean.match(/^(\S+)\s+["'].*["']$/);
    if (titleMatch) clean = titleMatch[1];
    clean = clean.split('?')[0].split('#')[0];
    try {
        clean = decodeURIComponent(clean);
    } catch (e) {
        // decode error
    }
    clean = clean.replace(/\\/g, '/');
    // Strip leading ./ or /
    clean = clean.replace(/^(\.\/|\/)+/, '');

    const filename = clean.split('/').pop();
    if (!filename) return null;

    // Normalize document path to extract its directory (strip leading slashes)
    const normFilePath = filePath ? filePath.replace(/\\/g, '/').replace(/^\/+/, '') : '';
    const fileDir = normFilePath.includes('/')
        ? normFilePath.substring(0, normFilePath.lastIndexOf('/'))
        : '';

    const figuresFolder = projectMetadata?.figuresFolder || 'figures';

    // Build candidate paths in order of priority
    const candidates = [];
    const seen = new Set();
    const addCandidate = (p) => {
        if (!p) return;
        const norm = normalizePathSegments(p);
        if (!norm) return;
        const lower = norm.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            candidates.push(norm);
        }
    };

    // 1. Standard markdown document-relative paths (e.g. "../figures/image.png" from "chapters/c1.md")
    if (fileDir) {
        addCandidate(`${fileDir}/${clean}`);
        addCandidate(`${fileDir}/${figuresFolder}/${clean}`);
        addCandidate(`${fileDir}/${filename}`);
        addCandidate(`${fileDir}/${figuresFolder}/${filename}`);

        // If clean starts with figures/ or figuresFolder, user in a subfolder likely means project root figures!
        if (clean.startsWith(`${figuresFolder}/`) || clean.startsWith('figures/')) {
            addCandidate(clean);
        }

        // Relative parent directory traversal from subfolder up to project root
        const depth = fileDir.split('/').filter(Boolean).length;
        const up = '../'.repeat(depth);
        addCandidate(`${fileDir}/${up}${clean}`);
        addCandidate(`${fileDir}/${up}${figuresFolder}/${filename}`);
    }

    // 2. Project root relative paths (e.g. "figures/image.png" or "image.png")
    addCandidate(clean);
    addCandidate(`${figuresFolder}/${clean}`);
    addCandidate(filename);
    addCandidate(`${figuresFolder}/${filename}`);

    // 3. Common image directories
    for (const folder of ['images', 'assets', 'img']) {
        if (fileDir) {
            addCandidate(`${fileDir}/${folder}/${filename}`);
        }
        addCandidate(`${folder}/${clean}`);
        addCandidate(`${folder}/${filename}`);
    }

    const mimeType = getMimeType(filename);

    // Try Electron direct filesystem read if available
    if (typeof window !== 'undefined' && window.electronAPI && dirHandle?.path) {
        const rootPath = dirHandle.path.replace(/[/\\]+$/, '');
        const sep = rootPath.includes('\\') ? '\\' : '/';

        for (const candidate of candidates) {
            try {
                const fullPath = `${rootPath}${sep}${candidate.replace(/[/\\]+/g, sep)}`;
                const buffer = await window.electronAPI.readFileBuffer(fullPath);
                if (buffer && (buffer.length > 0 || buffer.byteLength > 0)) {
                    // Always make a safe copy to eliminate Node buffer pool offset issues
                    const safeUint8 = new Uint8Array(buffer);
                    return {
                        buffer: safeUint8,
                        candidate,
                        mimeType: detectMimeType(safeUint8, filename),
                        fullPath
                    };
                }
            } catch (e) {
                // Not found, try next
            }
        }
    }

    // Try DirectoryHandle traversal (Browser File System Access API or Electron proxy)
    for (const candidate of candidates) {
        try {
            const parts = candidate.split('/').filter(Boolean);
            let current = dirHandle;
            for (let i = 0; i < parts.length - 1; i++) {
                current = await current.getDirectoryHandle(parts[i]);
            }
            const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
            const file = await fileHandle.getFile();
            const buffer = await file.arrayBuffer();
            if (buffer && buffer.byteLength > 0) {
                const uint8 = new Uint8Array(buffer);
                return {
                    buffer: uint8,
                    file,
                    candidate,
                    mimeType: detectMimeType(uint8, filename)
                };
            }
        } catch (e) {
            // Not found, try next
        }
    }

    // Fallback: Recursive search throughout project
    try {
        const foundHandle = await searchFileRecursively(dirHandle, filename);
        if (foundHandle) {
            if (typeof window !== 'undefined' && window.electronAPI && foundHandle.path) {
                const buffer = await window.electronAPI.readFileBuffer(foundHandle.path);
                if (buffer && (buffer.length > 0 || buffer.byteLength > 0)) {
                    const safeUint8 = new Uint8Array(buffer);
                    return {
                        buffer: safeUint8,
                        candidate: filename,
                        mimeType: detectMimeType(safeUint8, filename),
                        fullPath: foundHandle.path
                    };
                }
            }
            const file = await foundHandle.getFile();
            const buffer = await file.arrayBuffer();
            const safeUint8 = new Uint8Array(buffer);
            return {
                buffer: safeUint8,
                file,
                candidate: filename,
                mimeType: detectMimeType(safeUint8, filename)
            };
        }
    } catch (e) {
        // Search error
    }

    return null;
}
