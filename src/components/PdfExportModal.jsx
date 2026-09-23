import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, FileText, Download, Search, Folder, FolderOpen, ChevronDown, ChevronRight, Check } from 'lucide-react';

// Folders to exclude from PDF export file picker
const EXCLUDED_FOLDERS = new Set(['notes', 'references', 'ideas', 'figures']);

/**
 * Recursively scans directory handle for all .md files, excluding system/special folders.
 */
async function scanProjectFiles(handle, currentPath = '') {
    const results = [];
    try {
        for await (const entry of handle.values()) {
            if (entry.name.startsWith('.')) continue; // ignore hidden (.git, .vscode, etc.)

            if (entry.kind === 'file') {
                if (entry.name.toLowerCase().endsWith('.md')) {
                    const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                    results.push({
                        name: entry.name,
                        path: relativePath,
                        dirPath: currentPath || 'Root',
                        handle: entry
                    });
                }
            } else if (entry.kind === 'directory') {
                const lower = entry.name.toLowerCase();
                if (EXCLUDED_FOLDERS.has(lower)) continue;
                if (lower === 'node_modules' || lower === 'dist' || lower === 'build') continue;

                const subPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                const subResults = await scanProjectFiles(entry, subPath);
                results.push(...subResults);
            }
        }
    } catch (e) {
        console.error('Directory scan error at', currentPath, e);
    }
    return results;
}

/**
 * Modal that lets the user pick any eligible .md file to export as PDF.
 * Scans root and all subdirectories (excluding figures/, references/, notes/, ideas/).
 * Displays a directory dropdown filter and a collapsible accordion list of directories.
 */
export function PdfExportModal({ dirHandle, mode, onExport, onClose, currentFilename }) {
    const [files, setFiles] = useState([]);
    const [selected, setSelected] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedDir, setSelectedDir] = useState('ALL');
    const [openDirs, setOpenDirs] = useState({});

    // Scan project files on mount
    useEffect(() => {
        let isCancelled = false;
        const scan = async () => {
            if (!dirHandle) { setLoading(false); return; }
            setLoading(true);
            try {
                const allFiles = await scanProjectFiles(dirHandle);
                if (isCancelled) return;

                setFiles(allFiles);

                // Auto-expand all directories by default
                const initialOpen = {};
                for (const f of allFiles) {
                    initialOpen[f.dirPath] = true;
                }
                setOpenDirs(initialOpen);

                // Pre-select current active file
                if (allFiles.length > 0) {
                    const match = allFiles.find(f =>
                        f.path === currentFilename ||
                        f.name === currentFilename ||
                        (currentFilename && currentFilename.endsWith(f.path)) ||
                        (currentFilename && f.path.endsWith(currentFilename))
                    );
                    if (match) {
                        setSelected(match.path);
                        setOpenDirs(prev => ({ ...prev, [match.dirPath]: true }));
                    } else {
                        setSelected(allFiles[0].path);
                    }
                }
            } catch (e) {
                console.error('PdfExportModal scan error', e);
            } finally {
                if (!isCancelled) setLoading(false);
            }
        };
        scan();
        return () => { isCancelled = true; };
    }, [dirHandle, currentFilename]);

    // Group files by directory
    const grouped = useMemo(() => {
        const map = {};
        for (const f of files) {
            if (!map[f.dirPath]) map[f.dirPath] = [];
            map[f.dirPath].push(f);
        }
        return map;
    }, [files]);

    // List of directories in predictable order: 'Root' first, then alphabetical
    const directories = useMemo(() => {
        const dirs = Object.keys(grouped);
        return dirs.sort((a, b) => {
            if (a === 'Root') return -1;
            if (b === 'Root') return 1;
            return a.localeCompare(b);
        });
    }, [grouped]);

    // Filtered files based on search & selected directory filter
    const filteredGrouped = useMemo(() => {
        const query = search.trim().toLowerCase();
        const res = {};

        for (const dir of directories) {
            if (selectedDir !== 'ALL' && dir !== selectedDir) continue;

            const dirFiles = grouped[dir] || [];
            const matchingFiles = query
                ? dirFiles.filter(f => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query))
                : dirFiles;

            if (matchingFiles.length > 0) {
                res[dir] = matchingFiles;
            }
        }
        return res;
    }, [directories, grouped, search, selectedDir]);

    // Auto-expand directories when searching
    useEffect(() => {
        if (search.trim()) {
            const nextOpen = {};
            for (const dir of Object.keys(filteredGrouped)) {
                nextOpen[dir] = true;
            }
            setOpenDirs(prev => ({ ...prev, ...nextOpen }));
        }
    }, [search, filteredGrouped]);

    const toggleDir = useCallback((dir) => {
        setOpenDirs(prev => ({ ...prev, [dir]: !prev[dir] }));
    }, []);

    const areAllOpen = useMemo(() => {
        const visibleDirs = Object.keys(filteredGrouped);
        if (visibleDirs.length === 0) return false;
        return visibleDirs.every(d => openDirs[d]);
    }, [filteredGrouped, openDirs]);

    const toggleAllDirs = useCallback(() => {
        const visibleDirs = Object.keys(filteredGrouped);
        const shouldOpen = !areAllOpen;
        const next = { ...openDirs };
        for (const d of visibleDirs) {
            next[d] = shouldOpen;
        }
        setOpenDirs(next);
    }, [filteredGrouped, areAllOpen, openDirs]);

    const handleExport = () => {
        const file = files.find(f => f.path === selected);
        if (file) onExport(file);
    };

    const totalVisibleFiles = useMemo(() => {
        return Object.values(filteredGrouped).reduce((sum, list) => sum + list.length, 0);
    }, [filteredGrouped]);

    return (
        <>
            <style>{`
                .pdf-modal-overlay {
                    position: fixed; inset: 0;
                    background: rgba(0,0,0,0.55);
                    backdrop-filter: blur(6px);
                    z-index: 9000;
                    display: flex; align-items: center; justify-content: center;
                    animation: fadeInOverlay 0.2s ease;
                }
                @keyframes fadeInOverlay { from { opacity: 0; } to { opacity: 1; } }

                .pdf-export-modal-box {
                    background: var(--bg-panel);
                    border: 1px solid var(--border-color);
                    border-radius: 20px;
                    width: 530px;
                    max-width: 95vw;
                    box-shadow: 0 32px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05);
                    overflow: hidden;
                    animation: slideUpModal 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
                    display: flex;
                    flex-direction: column;
                    max-height: 88vh;
                }
                @keyframes slideUpModal { from { opacity: 0; transform: translateY(24px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

                .pdf-modal-header {
                    padding: 24px 28px 0;
                    display: flex; justify-content: space-between; align-items: flex-start;
                    flex-shrink: 0;
                }
                .pdf-modal-title { font-size: 1.25rem; font-weight: 800; margin: 0 0 4px; color: var(--text-primary); }
                .pdf-modal-subtitle { font-size: 0.85rem; color: var(--text-secondary); }

                .pdf-modal-close {
                    background: var(--bg-app); border: 1px solid var(--border-color);
                    color: var(--text-secondary); width: 34px; height: 34px;
                    border-radius: 10px; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s; flex-shrink: 0;
                }
                .pdf-modal-close:hover { background: var(--hover-bg); color: var(--text-primary); }

                .pdf-modal-body {
                    padding: 16px 28px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    min-height: 0;
                }

                .pdf-controls-wrap {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-bottom: 12px;
                    flex-shrink: 0;
                }

                .pdf-filter-row {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .pdf-dir-select-wrap {
                    position: relative;
                    flex: 1;
                    display: flex;
                    align-items: center;
                }

                .pdf-dir-select-icon {
                    position: absolute;
                    left: 11px;
                    color: var(--text-secondary);
                    pointer-events: none;
                }

                .pdf-dir-select {
                    width: 100%;
                    padding: 8px 12px 8px 34px;
                    background: var(--bg-app);
                    border: 1px solid var(--border-color);
                    border-radius: 9px;
                    color: var(--text-primary);
                    font-size: 0.84rem;
                    font-weight: 500;
                    outline: none;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }
                .pdf-dir-select:focus { border-color: var(--accent-color); }

                .pdf-toggle-all-btn {
                    background: var(--bg-app);
                    border: 1px solid var(--border-color);
                    color: var(--text-secondary);
                    font-size: 0.76rem;
                    font-weight: 600;
                    padding: 8px 12px;
                    border-radius: 9px;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: all 0.2s;
                }
                .pdf-toggle-all-btn:hover {
                    color: var(--text-primary);
                    border-color: var(--accent-color);
                }

                .pdf-search-wrap { position: relative; }
                .pdf-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); pointer-events: none; }
                .pdf-search-input {
                    width: 100%; padding: 8px 12px 8px 34px;
                    background: var(--bg-app); border: 1px solid var(--border-color);
                    border-radius: 9px; color: var(--text-primary); font-size: 0.85rem;
                    outline: none; transition: border-color 0.2s;
                }
                .pdf-search-input:focus { border-color: var(--accent-color); }

                .pdf-directory-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    overflow-y: auto;
                    padding-right: 4px;
                    flex: 1;
                }

                .pdf-dir-accordion {
                    border: 1px solid var(--border-color);
                    border-radius: 11px;
                    background: var(--bg-app);
                    overflow: hidden;
                    transition: border-color 0.15s;
                }
                .pdf-dir-accordion:hover { border-color: rgba(var(--accent-color-rgb), 0.3); }

                .pdf-dir-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 9px 12px;
                    background: var(--bg-panel);
                    cursor: pointer;
                    user-select: none;
                    font-size: 0.84rem;
                    font-weight: 600;
                    color: var(--text-primary);
                    border-bottom: 1px solid transparent;
                    transition: background 0.15s;
                }
                .pdf-dir-header:hover { background: var(--hover-bg); }
                .pdf-dir-accordion.open .pdf-dir-header {
                    border-bottom-color: var(--border-color);
                }

                .pdf-dir-badge {
                    margin-left: auto;
                    font-size: 0.72rem;
                    font-weight: 500;
                    color: var(--text-secondary);
                    background: var(--bg-app);
                    padding: 2px 7px;
                    border-radius: 6px;
                    border: 1px solid var(--border-color);
                }

                .pdf-dir-files {
                    padding: 6px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .pdf-file-btn {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 10px;
                    border-radius: 8px;
                    border: 1px solid transparent;
                    background: transparent;
                    cursor: pointer;
                    text-align: left;
                    transition: all 0.15s;
                    color: var(--text-primary);
                    width: 100%;
                }
                .pdf-file-btn:hover {
                    background: var(--hover-bg);
                }
                .pdf-file-btn.selected {
                    border-color: var(--accent-color);
                    background: rgba(var(--accent-color-rgb), 0.08);
                }

                .pdf-file-info { flex: 1; min-width: 0; }
                .pdf-file-name {
                    font-weight: 600;
                    font-size: 0.86rem;
                    margin: 0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .pdf-file-path {
                    font-size: 0.71rem;
                    color: var(--text-secondary);
                    margin-top: 1px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .pdf-check-indicator {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    border: 1.5px solid var(--border-color);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    transition: all 0.15s;
                }
                .pdf-file-btn.selected .pdf-check-indicator {
                    border-color: var(--accent-color);
                    background: var(--accent-color);
                    color: white;
                }

                .pdf-empty {
                    text-align: center;
                    padding: 32px 16px;
                    color: var(--text-secondary);
                    font-size: 0.88rem;
                }

                .pdf-modal-footer {
                    padding: 14px 28px 22px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-top: 1px solid var(--border-color);
                    flex-shrink: 0;
                }
                .pdf-footer-status {
                    font-size: 0.8rem;
                    color: var(--text-secondary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    max-width: 250px;
                }
                .pdf-footer-status strong {
                    color: var(--text-primary);
                }
                .pdf-footer-actions {
                    display: flex;
                    gap: 8px;
                }

                .pdf-btn-cancel {
                    background: transparent;
                    border: 1px solid var(--border-color);
                    color: var(--text-secondary);
                    padding: 8px 18px;
                    border-radius: 9px;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 0.84rem;
                    transition: all 0.2s;
                }
                .pdf-btn-cancel:hover { background: var(--hover-bg); color: var(--text-primary); }

                .pdf-btn-export {
                    background: var(--accent-color);
                    border: none;
                    color: white;
                    padding: 8px 24px;
                    border-radius: 9px;
                    font-weight: 700;
                    cursor: pointer;
                    font-size: 0.84rem;
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    transition: all 0.2s;
                }
                .pdf-btn-export:hover:not(:disabled) {
                    opacity: 0.88;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(var(--accent-color-rgb), 0.4);
                }
                .pdf-btn-export:disabled { opacity: 0.45; cursor: not-allowed; }
            `}</style>

            <div className="pdf-modal-overlay" onClick={onClose}>
                <div className="pdf-export-modal-box" onClick={e => e.stopPropagation()}>
                    {/* Header */}
                    <div className="pdf-modal-header">
                        <div>
                            <p className="pdf-modal-title">Export as PDF</p>
                            <p className="pdf-modal-subtitle">Choose any markdown file from your project to export</p>
                        </div>
                        <button className="pdf-modal-close" onClick={onClose} title="Close">
                            <X size={17} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="pdf-modal-body">
                        {/* Directory Dropdown and Search Controls */}
                        <div className="pdf-controls-wrap">
                            <div className="pdf-filter-row">
                                <div className="pdf-dir-select-wrap">
                                    <Folder size={14} className="pdf-dir-select-icon" />
                                    <select
                                        className="pdf-dir-select"
                                        value={selectedDir}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setSelectedDir(val);
                                            if (val !== 'ALL') {
                                                setOpenDirs(prev => ({ ...prev, [val]: true }));
                                            }
                                        }}
                                        disabled={loading || directories.length === 0}
                                        title="Filter by Directory"
                                    >
                                        <option value="ALL">📁 All Directories ({files.length} files)</option>
                                        {directories.map(dir => (
                                            <option key={dir} value={dir}>
                                                {dir === 'Root' ? '📁 Root /' : `📁 ${dir}/`} ({grouped[dir]?.length || 0})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    className="pdf-toggle-all-btn"
                                    onClick={toggleAllDirs}
                                    disabled={loading || Object.keys(filteredGrouped).length === 0}
                                    title={areAllOpen ? 'Collapse All Folders' : 'Expand All Folders'}
                                >
                                    {areAllOpen ? 'Collapse All' : 'Expand All'}
                                </button>
                            </div>

                            <div className="pdf-search-wrap">
                                <Search size={14} className="pdf-search-icon" />
                                <input
                                    type="text"
                                    className="pdf-search-input"
                                    placeholder="Search documents by name or path..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>

                        {/* File Tree / Accordion */}
                        {loading ? (
                            <div className="pdf-empty">Scanning project directories…</div>
                        ) : totalVisibleFiles === 0 ? (
                            <div className="pdf-empty">
                                {search ? `No files matching "${search}"` : 'No eligible markdown files found'}
                            </div>
                        ) : (
                            <div className="pdf-directory-list">
                                {Object.entries(filteredGrouped).map(([dir, dirFiles]) => {
                                    const isOpen = !!openDirs[dir];
                                    const dirLabel = dir === 'Root' ? 'Root' : `${dir}/`;
                                    return (
                                        <div key={dir} className={`pdf-dir-accordion ${isOpen ? 'open' : ''}`}>
                                            <div
                                                className="pdf-dir-header"
                                                onClick={() => toggleDir(dir)}
                                                title={`Click to ${isOpen ? 'collapse' : 'expand'} ${dirLabel}`}
                                            >
                                                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                {isOpen ? <FolderOpen size={16} color="var(--accent-color)" /> : <Folder size={16} />}
                                                <span>{dirLabel}</span>
                                                <span className="pdf-dir-badge">{dirFiles.length} file{dirFiles.length !== 1 ? 's' : ''}</span>
                                            </div>

                                            {isOpen && (
                                                <div className="pdf-dir-files">
                                                    {dirFiles.map(file => {
                                                        const isSelected = selected === file.path;
                                                        return (
                                                            <button
                                                                key={file.path}
                                                                className={`pdf-file-btn ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => setSelected(file.path)}
                                                                onDoubleClick={handleExport}
                                                                title={`Select ${file.path}`}
                                                            >
                                                                <FileText
                                                                    size={16}
                                                                    color={isSelected ? 'var(--accent-color)' : 'var(--text-secondary)'}
                                                                    style={{ flexShrink: 0 }}
                                                                />
                                                                <div className="pdf-file-info">
                                                                    <p className="pdf-file-name">{file.name}</p>
                                                                    {file.dirPath !== 'Root' && (
                                                                        <p className="pdf-file-path">{file.path}</p>
                                                                    )}
                                                                </div>
                                                                <div className="pdf-check-indicator">
                                                                    {isSelected && <Check size={10} />}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="pdf-modal-footer">
                        <div className="pdf-footer-status">
                            {selected ? (
                                <span>Selected: <strong>{selected.split('/').pop()}</strong></span>
                            ) : (
                                <span>No file selected</span>
                            )}
                        </div>
                        <div className="pdf-footer-actions">
                            <button className="pdf-btn-cancel" onClick={onClose}>Cancel</button>
                            <button
                                className="pdf-btn-export"
                                onClick={handleExport}
                                disabled={!selected || loading}
                            >
                                <Download size={15} />
                                Export PDF
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
