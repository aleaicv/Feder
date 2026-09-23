import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import './components/MarkdownSections.css';
import yaml from 'js-yaml';
import { Layout } from './components/Layout';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { ModeSwitcher } from './components/ModeSwitcher';
import { MetadataForm } from './components/MetadataForm';
import { FileExplorer } from './components/FileExplorer';
import { ImageViewer } from './components/ImageViewer';
import { ResizablePanels } from './components/ResizablePanels';
import { useFileSystem } from './hooks/useFileSystem';
import { generateLatex } from './utils/latexExport';
import { requestTextImprovement } from './utils/aiSuggestions';
import { saveProjectHandle, getProjectHandle, saveRecentProject, getRecentProjects, saveSettings, getSettings, saveRecentList } from './utils/db';
import { WelcomeScreen } from './components/WelcomeScreen';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { PdfExportModal } from './components/PdfExportModal';
import { DocumentTabs } from './components/DocumentTabs';
import { Feather } from 'lucide-react';
import { preloadFigures, preloadBibData, buildPrintHtmlDocument, executePdfExport } from './utils/pdfExport';
import { MarkdownPreview } from './components/Preview';

const isElectron = /Electron/i.test(navigator.userAgent);

const DEFAULT_COMMENT_TAGS = {
  major: [
    { id: 'methodological', label: 'Methodological', color: '#ff4d4d' },
    { id: 'conceptual', label: 'Conceptual', color: '#ff944d' },
    { id: 'overreaching', label: 'Overreaching', color: '#ffcc4d' },
    { id: 'ethical', label: 'Ethical concerns', color: '#e60000' }
  ],
  minor: [
    { id: 'clarification', label: 'Clarification request', color: '#3399ff' },
    { id: 'data_presentation', label: 'Data presentation', color: '#33ccff' },
    { id: 'missing_reference', label: 'Missing reference', color: '#5c5cff' }
  ],
  minor_formal: [
    { id: 'journal_guidelines', label: 'Journal guidelines', color: '#2eb8b8' },
    { id: 'structure', label: 'Structure (move paragraph)', color: '#20c997' },
  ]
};

const EMPTY_OBJECT = {};
const EMPTY_ARRAY = [];

function countWords(str) {
  if (!str) return 0;
  let count = 0;
  let inWord = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 32) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

function App() {
  const [theme, setTheme] = useState('light'); // 'light' | 'semi-dark' | 'dark'
  const [mode, setMode] = useState('journalist');
  const [content, setContent] = useState(''); // Stores markdown or bib content
  const [previewContent, setPreviewContent] = useState(''); // Buffered content for preview (updates on save)
  const [metadata, setMetadata] = useState({});
  const [projectMetadata, setProjectMetadata] = useState({ name: 'Untitled Project' });
  const [currentFile, setCurrentFile] = useState({ name: '', kind: 'md', handle: null, src: null });
  const [openTabs, setOpenTabs] = useState([]);
  const currentBlobUrlRef = useRef(null);

  useEffect(() => {
    if (currentFile?.src) {
      if (currentBlobUrlRef.current && currentBlobUrlRef.current !== currentFile.src) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
      currentBlobUrlRef.current = currentFile.src;
    } else if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
  }, [currentFile]);

  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
      }
    };
  }, []);
  const [showMetadata, setShowMetadata] = useState(true);
  const [showExplorer, setShowExplorer] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [viewState, setViewState] = useState('welcome'); // 'welcome' | 'editor'
  const [recentProjects, setRecentProjects] = useState([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);

  const [paperView, setPaperView] = useState(false);
  const [hasNotesDir, setHasNotesDir] = useState(false);
  const [notesList, setNotesList] = useState([]);
  const [hasIdeasDir, setHasIdeasDir] = useState(false);
  const [bibFiles, setBibFiles] = useState([]);

  // PDF Export state
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const [printData, setPrintData] = useState({ content: '', metadata: {}, filename: 'export.pdf' });

  // Right Panel Tabs State
  const [rightPanelTab, setRightPanelTab] = useState('visualization'); // 'visualization', 'improvements', 'comments'
  const [improvementData, setImprovementData] = useState({
    status: 'idle',
    originalText: '',
    improvedText: '',
    type: '',
    error: null
  });

  const [editorSelection, setEditorSelection] = useState('');
  const [commentPositions, setCommentPositions] = useState([]);
  const [editorScrollTop, setEditorScrollTop] = useState(0);

  const [settings, setSettings] = useState({

    name: '',
    affiliation: '',
    company: '',
    profession: '',
    email: '',
    phone: '',
    ai: {
      enabled: false,
      // API Keys are stored here. Config is now in projectMetadata.aiConfig
      openai: { apiKey: '' },
      gemini: { apiKey: '' },
      ollama: { baseUrl: 'http://localhost:11434' }
    }
  });

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const cancelAiRef = React.useRef(null);
  const jumpToWordRef = React.useRef(null);

  const {
    fileHandle,
    dirHandle,
    openFile,
    saveFile,
    saveFileAs,
    openDirectory,
    createSubDir,
    writeFileInDir,
    setFileHandle,
    setDirHandle,
    readFile
  } = useFileSystem();

  const latestStateRef = useRef({});
  const handleRefresh = useCallback(() => setRefreshTrigger(prev => prev + 1), []);

  // Helper to convert hex to RGB
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : '9, 132, 227';
  };

  // Sync projectMetadata visual customisations to document element and state
  useEffect(() => {
    const acc = projectMetadata?.accentColor || '#0984e3';
    document.documentElement.style.setProperty('--accent-color', acc);
    document.documentElement.style.setProperty('--accent-color-rgb', hexToRgb(acc));

    const linkCol = projectMetadata?.linkColor || '#0984e3';
    document.documentElement.style.setProperty('--link-color', linkCol);

    const fSize = projectMetadata?.editorFontSize || 14;
    document.documentElement.style.setProperty('--editor-font-size', `${fSize}px`);

    if (projectMetadata?.theme && projectMetadata.theme !== theme) {
      setTheme(projectMetadata.theme);
    }
  }, [projectMetadata]);

  // Theme Toggle Logic
  useEffect(() => {
    document.documentElement.classList.remove('dark', 'semi-dark', 'semi-light');
    if (theme !== 'light') {
      document.documentElement.classList.add(theme);
    }
  }, [theme]);

  // Desktop detection
  useEffect(() => {
    if (isElectron) {
      document.body.classList.add('is-desktop');
    } else {
      document.body.classList.remove('is-desktop');
    }
  }, []);

  const toggleTheme = () => {
    setTheme(prev => {
      let next = 'light';
      if (prev === 'light') next = 'semi-light';
      else if (prev === 'semi-light') next = 'semi-dark';
      else if (prev === 'semi-dark') next = 'dark';

      // Persist theme toggle directly in project settings if project is loaded
      if (dirHandle) {
        handleUpdateProjectSettings({ ...projectMetadata, theme: next });
      }
      return next;
    });
  };

  // Load project metadata if dirHandle changes
  // Load project metadata if dirHandle changes
  useEffect(() => {
    const loadProjectMeta = async () => {
      if (!dirHandle) return;
      try {
        await saveProjectHandle(dirHandle); // Persist handle

        const handle = await dirHandle.getFileHandle('project_metadata.json');
        const file = await handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        setProjectMetadata(data);
      } catch (e) {
        // No metadata file, maybe create default?
      }
    };
    loadProjectMeta();
  }, [dirHandle]);

  const scanNotesDir = useCallback(async () => {
    if (!dirHandle || projectMetadata?.plugins?.notes === false) {
      setHasNotesDir(false);
      setNotesList([]);
      return;
    }
    try {
      let notesDirHandle = null;
      try {
        notesDirHandle = await dirHandle.getDirectoryHandle('notes');
      } catch (e) {
        setHasNotesDir(false);
        setNotesList([]);
        return;
      }

      if (notesDirHandle) {
        setHasNotesDir(true);
        const list = [];

        const recurse = async (handle, pathPrefix = '') => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.md')) {
              const relPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
              try {
                const file = await entry.getFile();
                const text = await file.text();
                let frontmatter = {};
                if (text.trim().startsWith('---')) {
                  const parts = text.split('---');
                  if (parts.length >= 3) {
                    frontmatter = yaml.load(parts[1]) || {};
                  }
                }
                list.push({
                  name: entry.name,
                  relPath,
                  handle: entry,
                  frontmatter,
                  title: frontmatter.title || entry.name.replace(/\.md$/, ''),
                  links: frontmatter.links || [],
                  tags: frontmatter.tags || [],
                  color: frontmatter.color || null,
                  folder: pathPrefix || 'root'
                });
              } catch (readErr) {
                console.error('Failed to parse note:', relPath, readErr);
              }
            } else if (entry.kind === 'directory') {
              const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
              await recurse(entry, nextPrefix);
            }
          }
        };

        await recurse(notesDirHandle, '');
        setNotesList(list);
      }
    } catch (err) {
      console.error('Error scanning notes folder:', err);
      setHasNotesDir(false);
      setNotesList([]);
    }
  }, [dirHandle, projectMetadata?.plugins?.notes]);

  const scanIdeasDir = useCallback(async () => {
    if (!dirHandle || projectMetadata?.plugins?.ideas === false) {
      setHasIdeasDir(false);
      return;
    }
    try {
      let ideasDirHandle = null;
      try {
        ideasDirHandle = await dirHandle.getDirectoryHandle('ideas');
      } catch (e) {
        setHasIdeasDir(false);
        return;
      }

      if (ideasDirHandle) {
        setHasIdeasDir(true);
      }
    } catch (err) {
      console.error('Error scanning ideas folder:', err);
      setHasIdeasDir(false);
    }
  }, [dirHandle, projectMetadata?.plugins?.ideas]);

  const scanBibFiles = useCallback(async () => {
    if (!dirHandle) {
      setBibFiles([]);
      return;
    }
    try {
      const list = [];
      const recurse = async (handle, pathPrefix = '') => {
        for await (const entry of handle.values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.bib')) {
            list.push(pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name);
          } else if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
            const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
            await recurse(entry, nextPrefix);
          }
        }
      };
      await recurse(dirHandle, '');
      setBibFiles(list);
    } catch (err) {
      console.error('Error scanning bib files:', err);
      setBibFiles([]);
    }
  }, [dirHandle]);

  useEffect(() => {
    scanNotesDir();
    scanIdeasDir();
    scanBibFiles();
  }, [dirHandle, refreshTrigger, scanNotesDir, scanIdeasDir, scanBibFiles]);

  // Load recent projects
  useEffect(() => {
    const loadRecents = async () => {
      try {
        const recents = await getRecentProjects();
        setRecentProjects(recents);

        // Auto open last? User didn't explicitly asking for auto-open, but "show previously used folders"
        // So we just load the list.
      } catch (e) {
        console.error(e);
      }
    };
    loadRecents();
  }, [viewState]); // Reload when going back to welcome

  // Load user settings
  useEffect(() => {
    const loadSettings = async () => {
      const stored = await getSettings();
      setSettings(stored);
    };
    loadSettings();
  }, []);

  // --- AI Improvement Handlers ---
  const handleRequestImprovement = useCallback(async (text, type) => {
    if (!text) return;

    setRightPanelTab('improvements');
    setImprovementData({
      status: 'loading',
      originalText: text,
      improvedText: '',
      type,
      error: null
    });

    // Build AI config from settings.ai (single source of truth)
    const { settings: latestSettings } = latestStateRef.current;
    const ai = latestSettings?.ai || {};
    const imp = ai.improvements || {};
    const useSeparate = imp.separate;

    // Use improvement-specific provider if separate, otherwise main
    const provider = useSeparate ? (imp.provider || ai.provider || 'gemini') : (ai.provider || 'gemini');

    const aiConfig = {
      enabled: true,
      provider,
      gemini: useSeparate
        ? { apiKey: imp.gemini?.apiKey || ai.gemini?.apiKey, model: imp.gemini?.model || ai.gemini?.model }
        : { ...(ai.gemini || {}) },
      openai: useSeparate
        ? { apiKey: imp.openai?.apiKey || ai.openai?.apiKey, model: imp.openai?.model || ai.openai?.model }
        : { ...(ai.openai || {}) },
      ollama: useSeparate
        ? { baseUrl: imp.ollama?.baseUrl || ai.ollama?.baseUrl, model: imp.ollama?.model || ai.ollama?.model }
        : { ...(ai.ollama || {}) }
    };

    setIsAiThinking(true);
    try {
      const result = await requestTextImprovement({
        aiConfig,
        text,
        type
      });

      if (result) {
        setImprovementData(prev => ({ ...prev, status: 'success', improvedText: result }));
      } else {
        setImprovementData(prev => ({ ...prev, status: 'error', error: 'No response generated.' }));
      }
    } catch (e) {
      setImprovementData(prev => ({ ...prev, status: 'error', error: e.message }));
    } finally {
      setIsAiThinking(false);
    }
  }, []);

  const handleApplyImprovement = useCallback((original, improved) => {
    // Simple string replacement. 
    // Note: This relies on the text being unique enough or user accepting the first match.
    setContent(prev => prev.replace(original, improved));
    setPreviewContent(prev => prev.replace(original, improved)); // Immediate update
    setRightPanelTab('visualization');
    setImprovementData({ status: 'idle', originalText: '', improvedText: '' });
  }, []);

  const handleAddComment = useCallback(async (text, selectionInfo) => {
    // selectionInfo comes from Editor: { text, start, end, contextBefore, contextAfter, line, tag }
    if (!text || !selectionInfo) return;
    const { metadata: latestMetadata } = latestStateRef.current;

    const newComment = {
      id: Date.now().toString(),
      text,
      selection: selectionInfo.text,
      contextBefore: selectionInfo.contextBefore,
      contextAfter: selectionInfo.contextAfter,
      line: selectionInfo.line,
      tag: selectionInfo.tag, // Pass custom peer review tag
      status: 'open', // 'open' | 'resolved'
      replies: [],
      date: new Date().toISOString()
    };

    const newComments = [...(latestMetadata.comments || []), newComment];
    await updateActiveFileComments(newComments);
    setRightPanelTab('comments');
  }, []);

  const handleReplyComment = useCallback(async (commentId, replyText) => {
    const { metadata: latestMetadata } = latestStateRef.current;
    const newComments = (latestMetadata.comments || []).map(c => {
      if (c.id === commentId) {
        return {
          ...c,
          replies: [...(c.replies || []), {
            id: Date.now().toString(),
            text: replyText,
            date: new Date().toISOString()
          }]
        };
      }
      return c;
    });
    await updateActiveFileComments(newComments);
  }, []);

  const handleResolveComment = useCallback(async (commentId) => {
    const { metadata: latestMetadata } = latestStateRef.current;
    const newComments = (latestMetadata.comments || []).map(c => {
      if (c.id === commentId) {
        return { ...c, status: c.status === 'open' ? 'resolved' : 'open' };
      }
      return c;
    });
    await updateActiveFileComments(newComments);
  }, []);

  const handleDeleteComment = useCallback(async (commentId) => {
    const { metadata: latestMetadata } = latestStateRef.current;
    const newComments = (latestMetadata.comments || []).filter(c => c.id !== commentId);
    await updateActiveFileComments(newComments);
  }, []);

  const updateActiveFileComments = useCallback(async (newComments) => {
    const { metadata: latestMetadata, currentFile: latestCurrentFile, content: latestContent, saveFile: latestSaveFile } = latestStateRef.current;
    const newMeta = { ...latestMetadata, comments: newComments };
    setMetadata(newMeta);
    
    if (latestCurrentFile.kind === 'md' && latestCurrentFile.handle) {
      try {
        const metaString = Object.keys(newMeta).length > 0 ? yaml.dump(newMeta) : '';
        const fullContent = metaString
          ? `---\n${metaString}---\n\n${latestContent}`
          : latestContent;
        
        await latestSaveFile(fullContent, latestCurrentFile.handle);
        setIsDirty(false);
      } catch (e) {
        console.error("Failed to auto-save file metadata comments:", e);
      }
    }
  }, []);

  // Validate comments against content on change (remove orphaned)
  useEffect(() => {
    if (!content || !metadata.comments) return;

    const validComments = metadata.comments.filter(c => {
      if (c.status === 'resolved') return true; // Keep resolved
      // Try strict context match first
      const strictSearch = c.contextBefore + c.selection + c.contextAfter;
      if (content.includes(strictSearch)) return true;

      // Try loose match (just selection)
      if (content.includes(c.selection)) return true;

      return false;
    });

    if (validComments.length !== metadata.comments.length) {
      const timer = setTimeout(() => {
        updateActiveFileComments(validComments);
      }, 2000); // 2 seconds of "missing" text before deletion
      return () => clearTimeout(timer);
    }
  }, [content, metadata.comments]);




  const handleOpenRecent = async (project) => {
    if (!project) return;

    // Normalize Project Object
    // If we have a path (Electron) but no valid handle (after restart in IDB), fix it.
    let activeHandle = project.handle;

    // Use path from top-level property OR handle property if available (for robustness)
    const projectPath = project.path || (project.handle && project.handle.path);

    if (window.electronAPI && window.electronAPI.isElectron && projectPath) {
      // Reconstruct handle from path
      try {
        const { getElectronHandle } = await import('./utils/electronFileSystem');
        activeHandle = getElectronHandle(projectPath, project.name);
      } catch (e) {
        console.error('Failed to restore Electron handle', e);
      }
    }

    if (!activeHandle) {
      alert('Selected project data is missing.');
      return;
    }

    if (window.electronAPI && window.electronAPI.isElectron && !activeHandle.path) {
      const reLink = window.confirm(`Unable to locate '${project.name}' automatically. Would you like to select the folder again?`);
      if (reLink) handleOpen();
      return;
    }

    // AUTOSAVE BEFORE SWITCHING
    if (isDirty) await handleSave();

    setIsLoading(true);
    try {
      // Verify permission (only if it's a standard web handle)
      if (!activeHandle.path && activeHandle.queryPermission) {
        let permission = await activeHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          permission = await activeHandle.requestPermission({ mode: 'readwrite' });
        }
        if (permission !== 'granted') {
          const reOpen = window.confirm(`Permission to access '${project.name}' was denied. Would you like to locate the folder again?`);
          if (reOpen) handleOpen();
          setIsLoading(false);
          return;
        }
      }

      setDirHandle(activeHandle);
      setMode(project.mode || 'researcher');
      setViewState('editor');

      await openDirectoryWithHandle(activeHandle);
      // Update timestamp and potentially ensure handle is saved
      await saveRecentProject(activeHandle, project.name, project.mode);

    } catch (e) {
      console.error('Failed to open recent', e);
      if (e.name === 'NotFoundError') {
        alert('Folder not found. It may have been moved or deleted.');
      } else {
        alert('Could not open project: ' + e.message);
      }
    } finally {
      setIsLoading(false);
    }
  };


  // Handler for Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, metadata, projectMetadata, currentFile, dirHandle, fileHandle]);

  // Dirty state tracking - set to true whenever content or metadata changes
  useEffect(() => {
    // We only want to set dirty if we are NOT in the middle of loading and a file is open
    if (!isLoading && viewState === 'editor' && currentFile?.name) {
      setIsDirty(true);
    }
  }, [content, metadata, projectMetadata, currentFile?.name]);

  // Reset dirty state when a new file is explicitly loaded or saved
  // This is handled inside handleSave and handleFileSelect/openDirectoryWithHandle

  // Warning for unsaved changes when closing the tab
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = ''; // Standard way to show confirmation dialog
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Autosave every minute
  useEffect(() => {
    const interval = setInterval(() => {
      if (isDirty) {
        console.log('Autosaving...');
        handleAutoSave();
      }
    }, 60000); // 1 minute
    return () => clearInterval(interval);
  }, [isDirty, content, metadata, projectMetadata, currentFile, dirHandle, fileHandle, mode]);

  // Live Live Preview Logic
  useEffect(() => {
    if (projectMetadata?.livePreview) {
      const handler = setTimeout(() => {
        setPreviewContent(content);
      }, 500);
      return () => clearTimeout(handler);
    } else {
      // If live preview is disabled, we don't automatically update previewContent here.
      // It will only be updated in handleSave.
    }
  }, [content, projectMetadata?.livePreview]);

  // Sync preview immediately when livePreview is toggled ON
  useEffect(() => {
    if (projectMetadata?.livePreview) {
      setPreviewContent(content);
    }
  }, [projectMetadata?.livePreview]);

  const handleAutoSave = async () => {
    // Only autosave if we have a place to save to without prompting
    const hasHandle = mode === 'researcher' ? !!dirHandle : !!fileHandle;
    if (hasHandle) {
      await handleSave(true); // pass true to indicate it's an internal/silent save
    }
  };

  // Parsing logic
  const parseFileContent = (text, filename) => {
    if (filename.endsWith('.bib') || filename.endsWith('.json') || filename.endsWith('.txt')) {
      setContent(text);
      setPreviewContent(text);
      setMetadata({}); // clear metadata for these files
      return;
    }

    try {
      if (text.startsWith('---')) {
        const parts = text.split('---');
        if (parts.length >= 3) {
          const metaConfig = yaml.load(parts[1]);
          const body = parts.slice(2).join('---').trim();
          setMetadata(metaConfig || {});
          setContent(body);
          setPreviewContent(body);
          return;
        }
      }
      setContent(text);
      setPreviewContent(text);
      setMetadata({});
    } catch (e) {
      console.error('Error parsing frontmatter', e);
      setContent(text);
      setPreviewContent(text);
    }
  };

  const stringifyFileContent = useCallback(() => {
    const { currentFile: latestCurrentFile, metadata: latestMetadata, content: latestContent } = latestStateRef.current;
    if (latestCurrentFile.kind !== 'md') return latestContent;

    const metaString = Object.keys(latestMetadata).length > 0 ? yaml.dump(latestMetadata) : '';
    return metaString
      ? `---\n${metaString}---\n\n${latestContent}`
      : latestContent;
  }, []);

  const openDirectoryWithHandle = useCallback(async (dir) => {
    if (!dir) return;

    let loadedMeta = { name: dir.name, mode: 'researcher' };

    // Try to load metadata first
    try {
      const h = await dir.getFileHandle('project_metadata.json');
      const f = await h.getFile();
      const d = JSON.parse(await f.text());
      loadedMeta = d;
      setProjectMetadata(d);

      // RESTORE MODE FROM METADATA
      if (d.mode) {
        setMode(d.mode);
      }

      // Ensure references folder exists if in a references-supporting mode and references are enabled
      const projMode = d.mode || 'researcher';
      const isReferencesMode = projMode === 'researcher' || projMode === 'engineer' || projMode === 'scholar';
      const enableReferences = d.enableReferences !== false;
      if (isReferencesMode && enableReferences) {
        try {
          await dir.getDirectoryHandle('references');
        } catch (e) {
          // Folder doesn't exist, create it and a default bib file
          try {
            const refDir = await createSubDir(dir, 'references');
            const bibContent = `@article{example2026,\n  author = {Author, An},\n  title = {A seminal work on the subject},\n  journal = {Journal of Interesting Results},\n  year = {2026},\n  volume = {42},\n  pages = {100-120}\n}`;
            await writeFileInDir(refDir, 'references.bib', bibContent);
          } catch (createErr) {
            console.error("Failed to automatically create references folder on open:", createErr);
          }
        }
      }
    } catch (e) {
      // No metadata file exists - ask user if they want to create one
      const shouldCreate = window.confirm(
        `This folder doesn't have a Feder project file (project_metadata.json).\n\n` +
        `This file is required to use Feder features like:\n` +
        `• Custom file/folder ordering\n` +
        `• Explorer state persistence\n` +
        `• Project settings\n\n` +
        `Would you like to create one now?`
      );

      if (shouldCreate) {
        try {
          const defaultMeta = {
            name: dir.name,
            mode: latestStateRef.current.mode, // Use current mode
            livePreview: false
          };
          const metaHandle = await dir.getFileHandle('project_metadata.json', { create: true });
          const writable = await metaHandle.createWritable();
          await writable.write(JSON.stringify(defaultMeta, null, 2));
          await writable.close();

          loadedMeta = defaultMeta;
          setProjectMetadata(defaultMeta);
        } catch (createErr) {
          console.error('Failed to create project_metadata.json', createErr);
          alert('Failed to create project metadata file. Some features may not work correctly.');
          setProjectMetadata(loadedMeta);
        }
      } else {
        // User declined - they can still browse but some features won't persist
        setProjectMetadata(loadedMeta);
      }
    }

    // Look for default file based on mode
    let mdFile = null;
    let mdFileName = '';

    try {
      // Strategy based on mode
      const mode = loadedMeta.mode || 'researcher';

      if (mode === 'scholar') {
        try {
          const lecturesDir = await dir.getDirectoryHandle('lectures');
          mdFile = await lecturesDir.getFileHandle('lecture_1.md');
          mdFileName = 'lectures/lecture_1.md';
        } catch {
          // Fallback
        }
      } else {
        mdFile = await dir.getFileHandle('main.md');
        mdFileName = 'main.md';
      }
    } catch (e) {
      // specific file not found, fall back to search
    }

    if (!mdFile) {
      // Find ANY .md file in root
      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.md')) {
          mdFile = entry;
          mdFileName = entry.name;
          break;
        }
      }
    }

    if (mdFile) {
      const contentObj = await readFile(mdFile);
      setFileHandle(mdFile);
      parseFileContent(contentObj.text, mdFile.name);
      const initialTab = { name: mdFile.name, kind: 'md', handle: mdFile };
      setCurrentFile(initialTab);
      setOpenTabs([initialTab]);
    } else {
      setContent('');
      setPreviewContent('');
      setMetadata({});
      setCurrentFile({ name: 'Untitled', kind: 'md', handle: null });
      setOpenTabs([]);
    }
    // Reset dirty state after loading
    setTimeout(() => setIsDirty(false), 100);
  }, [createSubDir, writeFileInDir, readFile]);

  const handleOpen = useCallback(async () => {
    const { isDirty: latestIsDirty, handleSave: latestHandleSave, openDirectoryWithHandle: latestOpenDirectoryWithHandle } = latestStateRef.current;
    // AUTOSAVE BEFORE SWITCHING
    if (latestIsDirty) await latestHandleSave();

    setIsLoading(true);
    try {
      const dir = await openDirectory(); // Uses unified hook with Electron support
      if (!dir) {
        setIsLoading(false);
        return;
      }

      // We don't know the mode yet. setViewState('editor') is fine.
      setViewState('editor');

      // Helper to peek at mode before full open
      let detectedMode = 'researcher';
      try {
        const h = await dir.getFileHandle('project_metadata.json');
        const f = await h.getFile();
        const d = JSON.parse(await f.text());
        if (d.mode) detectedMode = d.mode;
      } catch (e) {
        // No metadata, assume researcher default
      }

      setMode(detectedMode);

      await saveRecentProject(dir, dir.name, detectedMode);
      await latestOpenDirectoryWithHandle(dir);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error("Open failed:", error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [openDirectory]);

  const handleSave = useCallback(async (isSilent = false) => {
    const {
      currentFile: latestCurrentFile,
      dirHandle: latestDirHandle,
      projectMetadata: latestProjectMetadata,
      mode: latestMode,
      metadata: latestMetadata,
      fileHandle: latestFileHandle,
      content: latestContent,
      saveFile: latestSaveFile,
      saveFileAs: latestSaveFileAs
    } = latestStateRef.current;

    if (!latestCurrentFile || !latestCurrentFile.name) return;
    if (latestCurrentFile.kind === 'image') return; // Cannot save image changes yet

    const fullContent = stringifyFileContent();

    try {
      // If we have a directory handle (Project Mode), always save the project metadata
      if (latestDirHandle) {
        await writeFileInDir(latestDirHandle, 'project_metadata.json', JSON.stringify(latestProjectMetadata, null, 2));

        // Ensure references folder exists if in a references-supporting mode and references are enabled
        const isReferencesMode = latestMode === 'researcher' || latestMode === 'engineer' || latestMode === 'scholar';
        const enableReferences = latestProjectMetadata?.enableReferences !== false;
        if (isReferencesMode && enableReferences) {
          try {
            await latestDirHandle.getDirectoryHandle('references');
          } catch (e) {
            // Folder doesn't exist, create it and a default bib file if references are checked or showReferences is active
            const showReferences = latestMetadata?.useReferences ?? latestMetadata?.showReferences;
            if (showReferences) {
              try {
                const refDir = await createSubDir(latestDirHandle, 'references');
                const bibContent = `@article{example2026,\n  author = {Author, An},\n  title = {A seminal work on the subject},\n  journal = {Journal of Interesting Results},\n  year = {2026},\n  volume = {42},\n  pages = {100-120}\n}`;
                await writeFileInDir(refDir, 'references.bib', bibContent);
              } catch (createErr) {
                console.error("Failed to automatically create references folder on save:", createErr);
              }
            }
          }
        }

        if (latestCurrentFile.handle) {
          await latestSaveFile(fullContent, latestCurrentFile.handle);
        } else if (latestCurrentFile.name) {
          // Fallback / New File in Project
          const name = latestCurrentFile.name;
          const handle = await writeFileInDir(latestDirHandle, name, fullContent);
          setFileHandle(handle);
          setCurrentFile(prev => ({ ...prev, handle }));

          await saveRecentProject(latestDirHandle, latestProjectMetadata.name, latestMode);
        }
        setPreviewContent(latestContent);
        setIsDirty(false);
      } else if (latestMode === 'researcher' && !isSilent) {
        // Saving a NEW Research Project - only if NOT silent
        const dir = await openDirectory();

        await writeFileInDir(dir, 'project_metadata.json', JSON.stringify({ name: latestProjectMetadata.name, mode: 'researcher' }, null, 2));

        const mainFileName = `main.md`;
        const mdHandle = await writeFileInDir(dir, mainFileName, fullContent);
        await createSubDir(dir, 'figures');
        await writeFileInDir(dir, 'references.bib', '');

        setDirHandle(dir);
        setFileHandle(mdHandle);
        setCurrentFile({ name: mainFileName, kind: 'md', handle: mdHandle });
        setPreviewContent(latestContent);
        setIsDirty(false);
      } else {
        // Individual file mode
        if (latestFileHandle) {
          await latestSaveFile(fullContent);
          setPreviewContent(latestContent);
          setIsDirty(false);
        } else if (!isSilent) {
          const success = await latestSaveFileAs(fullContent);
          if (success) {
            setPreviewContent(latestContent);
            setIsDirty(false);
          }
        }
      }
      await scanNotesDir();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Save failed', err);
        if (!isSilent) alert('Save failed: ' + err.message);
      }
    }
  }, [scanNotesDir, openDirectory, createSubDir, writeFileInDir, stringifyFileContent]);

  const handleNew = useCallback(async () => {
    const { isDirty: latestIsDirty, handleSave: latestHandleSave } = latestStateRef.current;
    // AUTOSAVE BEFORE SWITCHING
    if (latestIsDirty) await latestHandleSave();

    setIsDirty(false);
  }, []);

  const goToWelcome = useCallback(async () => {
    const { isDirty: latestIsDirty, handleSave: latestHandleSave } = latestStateRef.current;
    if (latestIsDirty) await latestHandleSave();
    setViewState('welcome');
    setDirHandle(null);
    setFileHandle(null);
    setContent('');
    setPreviewContent('');
    setMetadata({});
    setIsDirty(false);
  }, []);

  const removeRecentProject = useCallback(async (projToRemove) => {
    setRecentProjects(prev => {
      const updated = prev.filter(p => {
        if (projToRemove.path && p.path) {
          return !(p.name === projToRemove.name && p.path === projToRemove.path);
        }
        return p.name !== projToRemove.name;
      });
      saveRecentList(updated);
      return updated;
    });
  }, []);

  const createProject = useCallback(async (name, newMode, initializeEmpty = false) => {
    const { isDirty: latestIsDirty, handleSave: latestHandleSave, settings: latestSettings, openDirectoryWithHandle: latestOpenDirectoryWithHandle } = latestStateRef.current;
    // AUTOSAVE BEFORE SWITCHING
    if (latestIsDirty) await latestHandleSave();

    setIsLoading(true);
    try {
      // All modes now use folder-based structure
      // 1. Select Folder
      // We use openDirectory but we need to ensure the user knows they are selecting a ROOT folder
      alert("Please select the ROOT folder where the new project folder will be created.");
      const parentDir = await openDirectory();
      if (!parentDir) {
        setIsLoading(false);
        return;
      }

      // 2. Create Subfolder
      const safeName = name.trim() || 'Untitled Project';
      // Electron adapter supports getDirectoryHandle with create: true
      const projectDir = await parentDir.getDirectoryHandle(safeName, { create: true });

      setMode(newMode);
      setDirHandle(projectDir);

      await saveRecentProject(projectDir, safeName, newMode);

      // 3. Initialize Files
      // Scholar mode needs access to settings inside createProject if we want to add course default there,
      // but project_metadata.json is usually simple. But user requested 'course' name there.
      // Let's assume project name is the default course name.
      const metadata = { name: safeName, mode: newMode };
      if (newMode === 'scholar') {
        metadata.course = safeName; // Default course name is project name
        metadata.university = latestSettings.affiliation || '';
      }
      await writeFileInDir(projectDir, 'project_metadata.json', JSON.stringify(metadata, null, 2));

      let mainFileHandle = null;
      let mainFileName = '';

      if (initializeEmpty) {
        // Create only project_metadata.json and main.md
        const defaultContent = `---\ntitle: ${safeName}\ndate: ${new Date().toLocaleDateString()}\n---\n\n# ${safeName}\n\n`;
        mainFileHandle = await writeFileInDir(projectDir, 'main.md', defaultContent);
        mainFileName = 'main.md';
      } else {
        switch (newMode) {
          case 'journalist': {
            await createSubDir(projectDir, 'figures');
            const notesDir = await createSubDir(projectDir, 'notes');
            const ideasDir = await createSubDir(projectDir, 'ideas');

            const journalBoilerplate = `---\ntitle: ${safeName}\nsubtitle: Lead Paragraph...\nauthor: ${latestSettings.name || 'Journalist'}\nprofession: ${latestSettings.profession || 'Press Reporter'}\nemail: ${latestSettings.email || ''}\nphone: ${latestSettings.phone || ''}\ndate: ${new Date().toISOString().split('T')[0]}\n---\n\n# ${safeName}\n\n[Location / Dateline]\n\nWrite your press article or report here...`;
            const noteBoilerplate = `---\ntitle: Research & Sources\ntags:\n  - journalist\n  - notes\ncolor: "#339af0"\nlinks: []\n---\n\n# Research & Sources\n\nKeep track of interviews, background material, and investigative leads here.`;
            const ideaBoilerplate = `---\ntitle: Article Ideas\ntags:\n  - ideas\n  - brainstorming\n---\n\n# Article Ideas\n\nCollect angles, headlines, and narrative arcs for future pieces.`;

            await writeFileInDir(notesDir, 'note_1.md', noteBoilerplate);
            await writeFileInDir(ideasDir, 'ideas_1.md', ideaBoilerplate);
            mainFileHandle = await writeFileInDir(projectDir, 'main.md', journalBoilerplate);
            mainFileName = 'main.md';
            break;
          }

          case 'engineer': {
            await createSubDir(projectDir, 'figures');
            const notesDir = await createSubDir(projectDir, 'notes');
            const ideasDir = await createSubDir(projectDir, 'ideas');
            const refDir = await createSubDir(projectDir, 'references');

            const engBoilerplate = `---\ntitle: ${safeName}\nproject: ${safeName}\ndate: ${new Date().toISOString().split('T')[0]}\nauthors:\n  - name: ${latestSettings.name || 'Engineer'}\n    affiliation: ${latestSettings.affiliation || ''}\nclient: Client Name\nprojectNumber: ENG-2026-001\nrevision: Rev 0\nshowToC: true\n---\n\n# Executive Summary\n\nThis technical report provides the structural details and calculations for ${safeName}.\n\n# Design Criteria\n\nState the design assumptions, standards, and safety factors.\n\n# Results and Recommendations\n\nProvide a summary of the analysis and action items.`;
            const noteBoilerplate = `---\ntitle: Site Inspection Notes\ntags:\n  - engineer\n  - calculations\ncolor: "#20c997"\nlinks: []\n---\n\n# Site Inspection Notes\n\nRecord physical observations, parameter values, and calculation checks here.`;
            const ideaBoilerplate = `---\ntitle: Engineering Solutions\ntags:\n  - ideas\n  - optimization\n---\n\n# Engineering Solutions\n\nBrainstorm structural alternatives, optimization opportunities, and design strategies.`;
            const bibContent = `@article{example2026,\n  author = {Author, An},\n  title = {A seminal work on the subject},\n  journal = {Journal of Interesting Results},\n  year = {2026},\n  volume = {42},\n  pages = {100-120}\n}`;

            await writeFileInDir(notesDir, 'note_1.md', noteBoilerplate);
            await writeFileInDir(ideasDir, 'ideas_1.md', ideaBoilerplate);
            await writeFileInDir(refDir, 'references.bib', bibContent);
            mainFileHandle = await writeFileInDir(projectDir, 'main.md', engBoilerplate);
            mainFileName = 'main.md';
            break;
          }

          case 'scholar': {
            await createSubDir(projectDir, 'figures');
            const notesDir = await createSubDir(projectDir, 'notes');
            const ideasDir = await createSubDir(projectDir, 'ideas');
            const lecturesDir = await createSubDir(projectDir, 'lectures');
            const refDir = await createSubDir(projectDir, 'references');

            const lecture1Boilerplate = `---\ntitle: Lecture 1: Introduction\ncourse: ${safeName}\ndate: ${new Date().toLocaleDateString()}\nauthor: ${latestSettings.name || 'Student Name'}\nshowCover: true\nobjectives:\n  - Understand the course scope\n  - Identify key syllabus items\n---\n\n# Lecture 1: Introduction\n\n**Date:** ${new Date().toLocaleDateString()}\n\n## Summary\nToday we introduced the course goals, reviewed the grading guidelines, and discussed the main themes.\n\n## Lecture Notes\n- Course covers advanced techniques in writing and analysis.\n- Review schedule and office hours.\n\n## Action Items / Homework\n- [ ] Complete the introduction survey`;

            const lecture2Boilerplate = `---\ntitle: Lecture 2: Core Principles\ncourse: ${safeName}\ndate: ${new Date().toLocaleDateString()}\nauthor: ${latestSettings.name || 'Student Name'}\nshowCover: true\nobjectives:\n  - Define core terms\n  - Explore the conceptual model\n---\n\n# Lecture 2: Core Principles\n\n**Date:** ${new Date().toLocaleDateString()}\n\n## Summary\nWe discussed the theoretical definitions and established the fundamental guidelines.\n\n## Lecture Notes\n- **Theory A**: Basic description.\n- Recommended reading: Chapters 1 and 2.\n\n## Action Items / Homework\n- [ ] Review lecture slides`;

            const noteBoilerplate = `---\ntitle: Study Group Notes\ntags:\n  - scholar\n  - study\ncolor: "#fcc419"\nlinks: []\n---\n\n# Study Group Notes\n\nSummarize key topics from discussions with peers and preparation for exams.`;
            const ideaBoilerplate = `---\ntitle: Essay & Project Ideas\ntags:\n  - ideas\n  - term-paper\n---\n\n# Essay & Project Ideas\n\nBrainstorm topics for term papers, presentation outlines, and group projects.`;
            const bibContent = `@article{example2026,\n  author = {Author, An},\n  title = {A seminal work on the subject},\n  journal = {Journal of Interesting Results},\n  year = {2026},\n  volume = {42},\n  pages = {100-120}\n}`;

            await writeFileInDir(notesDir, 'note_1.md', noteBoilerplate);
            await writeFileInDir(ideasDir, 'ideas_1.md', ideaBoilerplate);
            await writeFileInDir(refDir, 'references.bib', bibContent);
            mainFileHandle = await writeFileInDir(lecturesDir, 'lecture_1.md', lecture1Boilerplate);
            await writeFileInDir(lecturesDir, 'lecture_2.md', lecture2Boilerplate);
            mainFileName = 'lectures/lecture_1.md';
            break;
          }

          case 'scriptwriter': {
            await createSubDir(projectDir, 'figures');
            const notesDir = await createSubDir(projectDir, 'notes');
            const ideasDir = await createSubDir(projectDir, 'ideas');

            const scriptBoilerplate = `---\ntitle: ${safeName}\nauthor: ${latestSettings.name || 'Screenwriter'}\nbasedOn: \ndate: ${new Date().toLocaleDateString()}\ncontact: |\n  ${latestSettings.name || 'Screenwriter'}\n  ${latestSettings.email || ''}\n  ${latestSettings.phone || ''}\n---\n\n# PRELUDE\n\n[ACTION, LOCATION, ATMOSPHERE]\n\n**CHARACTER NAME**\n(Parenthetical)\nDialogue\n\n**CHARACTER NAME 2**\nDialogue \n\n---\n\n# SCENE 1\n\n...\n\n---\n\n# THE END`;
            const noteBoilerplate = `---\ntitle: Character Biographies\ntags:\n  - script\n  - characters\ncolor: "#f06595"\nlinks: []\n---\n\n# Character Biographies\n\nDefine key character arcs, motivations, backstory details, and personality traits.`;
            const ideaBoilerplate = `---\ntitle: Plot & Scene Beats\ntags:\n  - ideas\n  - structure\n---\n\n# Plot & Scene Beats\n\nBrainstorm story outline, key twists, pacing details, and thematic resolution points.`;

            await writeFileInDir(notesDir, 'note_1.md', noteBoilerplate);
            await writeFileInDir(ideasDir, 'ideas_1.md', ideaBoilerplate);
            mainFileHandle = await writeFileInDir(projectDir, 'main.md', scriptBoilerplate);
            mainFileName = 'main.md';
            break;
          }

          case 'researcher':
          default: {
            await createSubDir(projectDir, 'figures');
            const notesDir = await createSubDir(projectDir, 'notes');
            const ideasDir = await createSubDir(projectDir, 'ideas');
            const refDir = await createSubDir(projectDir, 'references');

            const resBoilerplate = `---\ntitle: ${safeName}\nproject: ${safeName}\nauthors:\n  - name: ${latestSettings.name || 'Researcher'}\n    affiliation: ${latestSettings.affiliation || ''}\n    email: ${latestSettings.email || ''}\ndate: ${new Date().toLocaleDateString()}\nabstract: |\n  This is the abstract for the research project. It should summarize the background, methodology, results, and conclusions of the paper.\n---\n\n# Introduction\n\nProvide an introduction to your research here.\n\n## Methodology\n\nDescribe your research methods.\n\n## Results\n\nPresent your findings and reference figures.\n\n## Discussion\n\nInterpret your results and link to the literature.`;
            const noteBoilerplate = `---\ntitle: Literature Review Notes\ntags:\n  - researcher\n  - literature\ncolor: "#845ef7"\nlinks: []\n---\n\n# Literature Review Notes\n\nSummarize key findings, citations, and conceptual definitions from your reference library.`;
            const ideaBoilerplate = `---\ntitle: Research Hypotheses\ntags:\n  - ideas\n  - hypotheses\n---\n\n# Research Hypotheses\n\nDocument future research directions, speculative ideas, and tentative explanations here.`;
            const bibContent = `@article{example2026,\n  author = {Author, An},\n  title = {A seminal work on the subject},\n  journal = {Journal of Interesting Results},\n  year = {2026},\n  volume = {42},\n  pages = {100-120}\n}`;

            await writeFileInDir(notesDir, 'note_1.md', noteBoilerplate);
            await writeFileInDir(ideasDir, 'ideas_1.md', ideaBoilerplate);
            await writeFileInDir(refDir, 'references.bib', bibContent);
            mainFileHandle = await writeFileInDir(projectDir, 'main.md', resBoilerplate);
            mainFileName = 'main.md';
            break;
          }
        }
      }

      if (mainFileHandle) {
        const fileData = await readFile(mainFileHandle);
        setFileHandle(mainFileHandle);
        parseFileContent(fileData.text, mainFileName);
        setCurrentFile({ name: mainFileName, kind: 'md', handle: mainFileHandle });
      } else {
        // Fallback if no file created (scholar might be tricky if I don't set one)
        await latestOpenDirectoryWithHandle(projectDir);
      }

      // 4. Open
      setViewState('editor');
      setTimeout(() => setIsDirty(false), 100);

    } catch (e) {
      if (e.name !== 'AbortError') console.error('Create Project Failed', e);
    } finally {
      setIsLoading(false);
    }
  }, [openDirectory, createSubDir, writeFileInDir, readFile]);

  // Open PDF export modal - show file picker
  const handleExport = useCallback(async () => {
    const { dirHandle: latestDirHandle } = latestStateRef.current;
    if (!latestDirHandle) {
      alert('Please open a project first to use PDF export.');
      return;
    }
    setShowPdfModal(true);
  }, []);

  // Called when user confirms a file in the PdfExportModal
  const handlePdfExport = useCallback(async (selectedFile) => {
    setShowPdfModal(false);
    setIsLoading(true);
    try {
      const file = await selectedFile.handle.getFile();
      const text = await file.text();

      // Parse frontmatter
      let fileContent = text;
      let fileMeta = {};
      if (text.trim().startsWith('---')) {
        const parts = text.split('---');
        if (parts.length >= 3) {
          try { fileMeta = yaml.load(parts[1]) || {}; } catch (e) { /* ignore */ }
          fileContent = parts.slice(2).join('---');
        }
      }

      // Preload bibliography and figures so all data is ready synchronously for export
      const { dirHandle: currentDirHandle, projectMetadata: currentProjectMetadata } = latestStateRef.current;
      const effectiveDirHandle = dirHandle || currentDirHandle;
      const effectiveProjectMetadata = projectMetadata || currentProjectMetadata;
      const bibData = await preloadBibData(fileMeta, effectiveDirHandle);
      const contentWithFigures = await preloadFigures(fileContent, effectiveDirHandle, selectedFile.path, effectiveProjectMetadata);

      setPrintData({ 
        content: contentWithFigures, 
        metadata: fileMeta, 
        bibData,
        filename: selectedFile.name.replace(/\.md$/, '.pdf'),
        title: fileMeta.title || selectedFile.name.replace(/\.md$/, ''),
        filePath: selectedFile.path,
        dirHandle: effectiveDirHandle,
        projectMetadata: effectiveProjectMetadata
      });
      setPrintMode(true);
    } catch (e) {
      console.error('PDF Export Error', e);
      alert('Failed to prepare file for export: ' + (e.message || e));
      setIsLoading(false);
    }
  }, [dirHandle, projectMetadata]);

  // Trigger export when printMode becomes true and printData is ready
  useEffect(() => {
    if (!printMode || !printData) return;

    let isCancelled = false;

    const runExport = async () => {
      // Allow time for React to mount the DOM and render KaTeX formulas
      await new Promise(resolve => setTimeout(resolve, 350));
      if (isCancelled) return;

      const element = document.getElementById('feder-print-root');
      if (!element) {
        setPrintMode(false);
        setIsLoading(false);
        return;
      }

      try {
        const renderedHtml = element.innerHTML;
        const fullHtml = buildPrintHtmlDocument(renderedHtml, printData.title || printData.filename);

        const result = await executePdfExport(fullHtml, printData.filename);
        if (result?.success && result?.filePath) {
          console.log('[PDF Export] Successfully exported to:', result.filePath);
        }
      } catch (err) {
        console.error('PDF generation failed:', err);
        alert('PDF Export failed: ' + (err.message || err));
      } finally {
        if (!isCancelled) {
          setPrintMode(false);
          setIsLoading(false);
        }
      }
    };

    runExport();

    return () => {
      isCancelled = true;
    };
  }, [printMode, printData]);

  const handleImport = useCallback(async () => {
    const { dirHandle: latestDirHandle, handleFileSelect: latestHandleFileSelect } = latestStateRef.current;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'LaTeX Files',
          accept: { 'text/x-tex': ['.tex'] },
        }],
      });
      const file = await handle.getFile();
      const text = await file.text();

      // Simple Import Logic (very basic conversion)
      let md = text;
      md = md.replace(/\\section\{(.*?)\}/g, '# $1');
      md = md.replace(/\\subsection\{(.*?)\}/g, '## $1');
      md = md.replace(/\\subsubsection\{(.*?)\}/g, '### $1');
      md = md.replace(/\\textbf\{(.*?)\}/g, '**$1**');
      md = md.replace(/\\textit\{(.*?)\}/g, '*$1*');
      md = md.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, '> $1');
      md = md.replace(/\\begin\{document\}|\\end\{document\}|\\maketitle|\\tableofcontents/g, '');
      md = md.replace(/\\documentclass\{.*?\}|\\usepackage\{.*?\}/g, '');
      md = md.replace(/\\title\{(.*?)\}/g, '# $1');
      md = md.replace(/\\author\{(.*?)\}/g, '*Author: $1*');

      const importedName = 'main_imported.md';
      if (latestDirHandle) {
        const newHandle = await writeFileInDir(latestDirHandle, importedName, md);
        setRefreshTrigger(prev => prev + 1);
        latestHandleFileSelect(newHandle);
        alert('Imported as main_imported.md');
      } else {
        setContent(md);
        setPreviewContent(md);
        setMetadata({});
        setCurrentFile({ name: importedName, kind: 'md', handle: null });
      }
      setTimeout(() => setIsDirty(false), 100);

    } catch (e) {
      if (e.name !== 'AbortError') console.error('Import failed', e);
    }
  }, [writeFileInDir]);


  // Helper for FileExplorer selection
  const handleFileSelect = useCallback(async (handle, path = '') => {
    const { isDirty: latestIsDirty, handleSave: latestHandleSave } = latestStateRef.current;
    // AUTOSAVE BEFORE SWITCHING
    if (latestIsDirty) await latestHandleSave();

    try {
      if (handle.kind === 'file') {
        const name = handle.name;
        const displayName = path ? (path.startsWith('/') ? path.substring(1) : path) : name;
        if (name.endsWith('.md') || name.endsWith('.bib') || name.endsWith('.txt') || name.endsWith('.json')) {
          const data = await readFile(handle);
          setFileHandle(handle);

          let kind = 'md';
          if (name.endsWith('.bib')) kind = 'bib';
          if (name.endsWith('.json')) kind = 'json';
          if (name.endsWith('.txt')) kind = 'txt';

          parseFileContent(data.text, name);
          const newFileObj = { name: displayName, kind, handle };
          setCurrentFile(newFileObj);
          setOpenTabs(prev => {
            if (prev.some(t => t.name === displayName)) return prev;
            return [...prev, newFileObj];
          });
        } else if (name.match(/\.(png|jpe?g|svg|gif|webp|bmp|ico|tiff?|avif)$/i)) {
          // Image visualization
          const file = await handle.getFile();
          let src = '';
          if (file instanceof Blob) {
            src = URL.createObjectURL(file);
          } else if (file && typeof file.arrayBuffer === 'function') {
            const buffer = await file.arrayBuffer();
            const ext = (name.split('.').pop() || '').toLowerCase();
            const mimeTypes = {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              svg: 'image/svg+xml',
              gif: 'image/gif',
              webp: 'image/webp',
              bmp: 'image/bmp',
              ico: 'image/x-icon',
              avif: 'image/avif',
              tiff: 'image/tiff'
            };
            const mime = mimeTypes[ext] || 'image/png';
            const blob = new Blob([buffer], { type: mime });
            src = URL.createObjectURL(blob);
          }
          const newFileObj = { name: displayName, kind: 'image', handle, src };
          setCurrentFile(newFileObj);
          setOpenTabs(prev => {
            if (prev.some(t => t.name === displayName)) return prev;
            return [...prev, newFileObj];
          });
        }
      }
      setTimeout(() => setIsDirty(false), 100);
    } finally {
      // No loading state to turn off
    }
  }, []);

  const handleSelectTab = useCallback(async (tab) => {
    const { isDirty: latestIsDirty, handleSave: latestHandleSave, currentFile: latestCurrentFile } = latestStateRef.current;
    if (tab.name === latestCurrentFile.name) return;
    if (latestIsDirty) {
      await latestHandleSave();
    }
    if (tab.handle) {
      await handleFileSelect(tab.handle, tab.name);
    } else {
      setCurrentFile({ name: tab.name, kind: tab.kind || 'md', handle: tab.handle || null, src: tab.src || null });
    }
  }, [handleFileSelect]);

  const handleCloseTab = useCallback(async (tabToClose) => {
    const { isDirty: latestIsDirty, handleSave: latestHandleSave, currentFile: latestCurrentFile, openTabs: latestOpenTabs } = latestStateRef.current;

    // Autosave if the tab being closed is currently active, dirty, and has a file name
    if (tabToClose.name === latestCurrentFile.name && latestIsDirty && latestCurrentFile.name) {
      await latestHandleSave();
    }

    const nextTabs = (latestOpenTabs || []).filter(t => t.name !== tabToClose.name);
    setOpenTabs(nextTabs);

    if (tabToClose.name === latestCurrentFile.name) {
      if (nextTabs.length > 0) {
        const currentIndex = (latestOpenTabs || []).findIndex(t => t.name === tabToClose.name);
        const nextIndex = Math.max(0, Math.min(currentIndex, nextTabs.length - 1));
        const nextTab = nextTabs[nextIndex];
        if (nextTab && nextTab.handle) {
          await handleFileSelect(nextTab.handle, nextTab.name);
        } else if (nextTab) {
          setCurrentFile({ name: nextTab.name, kind: nextTab.kind || 'md', handle: nextTab.handle || null, src: nextTab.src || null });
        }
      } else {
        setContent('');
        setPreviewContent('');
        setMetadata({});
        setCurrentFile({ name: '', kind: 'md', handle: null });
        setFileHandle(null);
        setTimeout(() => setIsDirty(false), 50);
      }
    }
  }, [handleFileSelect]);

  const onUploadImage = useCallback(async () => {
    const { mode: latestMode, dirHandle: latestDirHandle, projectMetadata: latestProjectMetadata } = latestStateRef.current;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'Images',
          accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.svg', '.gif'] }
        }]
      });
      const file = await handle.getFile();

      let src = '';
      if (latestMode === 'researcher' && latestDirHandle) {
        const folderName = latestProjectMetadata.figuresFolder || 'figures';
        let figuresDir;
        try {
          figuresDir = await latestDirHandle.getDirectoryHandle(folderName, { create: true });
        } catch (e) {
          figuresDir = latestDirHandle;
        }
        await writeFileInDir(figuresDir, file.name, file);
        src = `${folderName}/${file.name}`;
      } else {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        await new Promise(resolve => reader.onload = resolve);
        src = reader.result;
      }
      return { alt: file.name, src };
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
      return null;
    }
  }, []);

  const onPasteImage = useCallback(async (file) => {
    const { mode: latestMode, dirHandle: latestDirHandle, projectMetadata: latestProjectMetadata } = latestStateRef.current;
    try {
      let src = '';
      if (latestDirHandle) {
        const folderName = latestProjectMetadata.figuresFolder || 'figures';
        let figuresDir;
        try {
          figuresDir = await latestDirHandle.getDirectoryHandle(folderName, { create: true });
        } catch (e) {
          figuresDir = latestDirHandle;
        }
        await writeFileInDir(figuresDir, file.name, file);
        src = `${folderName}/${file.name}`;
      } else {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        await new Promise(resolve => reader.onload = resolve);
        src = reader.result;
      }
      return { alt: file.name.replace(/\.[^/.]+$/, ''), src };
    } catch (e) {
      console.error('Paste image failed:', e);
      return null;
    }
  }, []);

  const copyDirectory = async (srcHandle, destHandle) => {
    for await (const entry of srcHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const content = await file.arrayBuffer();
        const newFile = await destHandle.getFileHandle(entry.name, { create: true });
        const writable = await newFile.createWritable();
        await writable.write(content);
        await writable.close();
      } else if (entry.kind === 'directory') {
        const newSubDir = await destHandle.getDirectoryHandle(entry.name, { create: true });
        await copyDirectory(entry, newSubDir);
      }
    }
  };

  const handleRename = useCallback(async (handle, newName, pathPrefix = '') => {
    const { currentFile: latestCurrentFile, dirHandle: latestDirHandle } = latestStateRef.current;
    if (!handle || !newName || newName === handle.name) return;

    // Prevent renaming the project metadata file
    if (handle.name === 'project_metadata.json') {
      alert('The project metadata file cannot be renamed.');
      return;
    }

    // Check if we are renaming the currently active file
    let isCurrentActive = false;
    if (latestCurrentFile.handle) {
      if (latestCurrentFile.handle === handle || latestCurrentFile.handle.name === handle.name) {
        isCurrentActive = true;
      } else if (latestCurrentFile.handle.isSameEntry) {
        try { isCurrentActive = await latestCurrentFile.handle.isSameEntry(handle); } catch (e) { }
      }
    }

    try {
      // 1. Try native move (Works for Files and Directories in modern browsers)
      if (handle.move) {
        await handle.move(newName);

        // If we renamed the currently open file, update its name in state
        if (isCurrentActive) {
          const parts = latestCurrentFile.name.split('/');
          parts.pop();
          const newDisplayName = parts.length > 0 ? [...parts, newName].join('/') : newName;
          setCurrentFile(prev => ({ ...prev, name: newDisplayName }));
          setOpenTabs(prev => prev.map(t => t.name === latestCurrentFile.name ? { ...t, name: newDisplayName } : t));
        }

        setRefreshTrigger(prev => prev + 1);
        return;
      }

      // 2. Fallback: Polyfill for Files or Directories
      // Resolve parent directory handle from pathPrefix
      let parent = latestDirHandle;
      if (pathPrefix) {
        const parts = pathPrefix.split('/').filter(p => !!p);
        for (const part of parts) {
          parent = await parent.getDirectoryHandle(part);
        }
      }

      if (handle.kind === 'file') {
        // Check collision
        try {
          await parent.getFileHandle(newName);
          alert('A file with this name already exists.');
          return;
        } catch (e) { /* proceed */ }

        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();

        const newFileHandle = await parent.getFileHandle(newName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(buffer);
        await writable.close();

        await parent.removeEntry(handle.name);

        // Update state if currently open
        if (isCurrentActive) {
          setFileHandle(newFileHandle);
          const parts = latestCurrentFile.name.split('/');
          parts.pop();
          const newDisplayName = parts.length > 0 ? [...parts, newName].join('/') : newName;
          setCurrentFile(prev => ({ ...prev, name: newDisplayName, handle: newFileHandle }));
          setOpenTabs(prev => prev.map(t => t.name === latestCurrentFile.name ? { ...t, name: newDisplayName, handle: newFileHandle } : t));
        }

        setRefreshTrigger(prev => prev + 1);
      } else if (handle.kind === 'directory') {
        // Check collision
        try {
          await parent.getDirectoryHandle(newName);
          alert('A folder with this name already exists.');
          return;
        } catch (e) { /* proceed */ }

        const newDirHandle = await parent.getDirectoryHandle(newName, { create: true });
        await copyDirectory(handle, newDirHandle);
        await parent.removeEntry(handle.name, { recursive: true });
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (e) {
      console.error('Rename failed', e);
      alert('Rename failed: ' + e.message);
    }
  }, []);

  const handleMove = useCallback(async (handle, targetDirHandle) => {
    if (!handle || !targetDirHandle) return;
    try {
      if (handle.move) {
        await handle.move(targetDirHandle);
        setRefreshTrigger(prev => prev + 1);
      } else {
        alert('Moving items is not supported in this browser version.');
      }
    } catch (e) {
      console.error('Move failed', e);
      alert('Move failed: ' + e.message);
    }
  }, []);

  const handleExplorerStateChange = useCallback((state) => {
    setProjectMetadata(prev => ({
      ...prev,
      explorerState: {
        ...(prev.explorerState || {}),
        ...state
      }
    }));
  }, []);

  const handleOrderChange = useCallback((parentPath, newOrder) => {
    setProjectMetadata(prev => {
      const currentOrder = prev.explorerOrder || {};
      return {
        ...prev,
        explorerOrder: {
          ...currentOrder,
          [parentPath]: newOrder
        }
      };
    });
  }, []);

  const getDefaultMetadata = (currentMode) => {
    const { settings: latestSettings, projectMetadata: latestProjectMetadata } = latestStateRef.current;
    if (currentMode === 'engineer') {
      return {
        authors: [{
          name: latestSettings.name || '',
          affiliation: latestSettings.affiliation || '',
          company: latestSettings.company || '',
          email: latestSettings.email || '',
          phone: latestSettings.phone || ''
        }],
        showToC: true,
        client: '',
        projectNumber: '',
        revision: 'Rev 0',
        date: new Date().toISOString().split('T')[0]
      };
    } else if (currentMode === 'researcher') {
      return {
        authors: [{
          name: latestSettings.name || '',
          affiliation: latestSettings.affiliation || '',
          company: latestSettings.company || '',
          email: latestSettings.email || '',
          phone: latestSettings.phone || ''
        }]
      };
    } else if (currentMode === 'scholar') {
      return {
        title: '',
        course: latestProjectMetadata.course || latestProjectMetadata.name || '',
        date: new Date().toLocaleDateString(),
        author: latestSettings.name || '',
        showCover: true,
        objectives: ['']
      };
    } else if (currentMode === 'journalist') {
      return {
        author: latestSettings.name || '',
        profession: latestSettings.profession || '',
        email: latestSettings.email || '',
        phone: latestSettings.phone || '',
        date: new Date().toISOString().split('T')[0]
      };
    } else if (currentMode === 'scriptwriter') {
      return {
        author: latestSettings.name || '',
        profession: latestSettings.profession || '',
        email: latestSettings.email || '',
        phone: latestSettings.phone || '',
        basedOn: '',
        date: new Date().toISOString().split('T')[0]
      };
    }
    return {};
  };

  const handleCreateFile = useCallback(async (targetDirHandle = null, targetPath = '', suggestedName = 'newfile.md') => {
    const { dirHandle: latestDirHandle, mode: latestMode } = latestStateRef.current;
    const destination = targetDirHandle || latestDirHandle;
    if (!destination) return;
    const inFolderHint = targetPath ? ` in ${targetPath}` : '';
    const name = prompt(`File name${inFolderHint}:`, suggestedName);
    if (name) {
      let initialContent = '';
      if (name.endsWith('.md')) {
        const defaults = getDefaultMetadata(latestMode);
        if (Object.keys(defaults).length > 0) {
          initialContent = `---\n${yaml.dump(defaults)}---\n\n# ${name.replace('.md', '')}\n\n`;
        }
      }
      await writeFileInDir(destination, name, initialContent);
      setRefreshTrigger(prev => prev + 1);
    }
  }, []);

  const handleUpdateProjectSettings = useCallback(async (newMeta) => {
    const { dirHandle: latestDirHandle } = latestStateRef.current;
    setProjectMetadata(newMeta);
    if (latestDirHandle) {
      try {
        await writeFileInDir(latestDirHandle, 'project_metadata.json', JSON.stringify(newMeta, null, 2));
      } catch (e) {
        console.error('Failed to save settings', e);
      }
    }
  }, [writeFileInDir]);


  const handleCreateFolder = useCallback(async (targetDirHandle = null, targetPath = '') => {
    const { dirHandle: latestDirHandle } = latestStateRef.current;
    const destination = targetDirHandle || latestDirHandle;
    if (!destination) return;
    const inFolderHint = targetPath ? ` in ${targetPath}` : '';
    const name = prompt(`Folder name${inFolderHint}:`, 'new-folder');
    if (name) {
      await createSubDir(destination, name);
      setRefreshTrigger(prev => prev + 1);
    }
  }, []);

  const handleDelete = useCallback(async (handle) => {
    const { dirHandle: latestDirHandle, currentFile: latestCurrentFile } = latestStateRef.current;
    try {
      if (handle.kind === 'file') {
        // For files, we use remove() if supported
        if (handle.remove) {
          await handle.remove();
        } else if (latestDirHandle) {
          await latestDirHandle.removeEntry(handle.name);
        }
      } else if (handle.kind === 'directory') {
        // For directories, use removeEntry with recursive: true
        if (latestDirHandle) {
          await latestDirHandle.removeEntry(handle.name, { recursive: true });
        }
      }

      // If deleted file (or a folder containing it) was open, clear editor
      let isActiveDeleted = false;
      if (latestCurrentFile.handle) {
        if (latestCurrentFile.handle === handle) {
          isActiveDeleted = true;
        } else if (latestCurrentFile.handle.isSameEntry) {
          try { isActiveDeleted = await latestCurrentFile.handle.isSameEntry(handle); } catch (e) { }
        }
      }

      if (isActiveDeleted) {
        setContent('');
        setPreviewContent('');
        setMetadata({});
        setCurrentFile({ name: '', kind: 'md', handle: null });
        setFileHandle(null);
      }

      setOpenTabs(prev => prev.filter(t => {
        if (t.handle === handle) return false;
        if (t.name === handle.name || t.name.startsWith(handle.name + '/') || t.name.includes('/' + handle.name + '/')) return false;
        return true;
      }));

      setRefreshTrigger(prev => prev + 1);
    } catch (e) {
      console.error('Delete failed', e);
      alert('Failed to delete: ' + e.message);
    }
  }, []);

  // Render Logic
  const renderLeft = () => (
    <FileExplorer
      dirHandle={dirHandle}
      onFileSelect={handleFileSelect}
      currentFilename={currentFile.name}
      mode={mode}
      onOpenProject={handleOpen}
      onRename={handleRename}
      onDelete={handleDelete}
      onCreateFile={handleCreateFile}
      onCreateFolder={handleCreateFolder}
      refreshTrigger={refreshTrigger}
      onRefresh={handleRefresh}
      initialExpandedFolders={projectMetadata?.explorerState?.expandedFolders || EMPTY_OBJECT}
      onExplorerStateChange={handleExplorerStateChange}
      onMove={handleMove}
      customOrder={projectMetadata.explorerOrder || EMPTY_OBJECT}
      onOrderChange={handleOrderChange}
      projectMetadata={projectMetadata}
    />
  );

  const renderCenter = () => {
    const enableDocumentTabs = projectMetadata?.enableDocumentTabs ?? false;

    return (
      <div className="center-panel-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="controls-bar" style={{ display: 'none' }}>
          {/* Controls moved to Layout header */}
        </div>

        {enableDocumentTabs && (
          <DocumentTabs
            tabs={openTabs}
            activeTabName={currentFile.name}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            isDirty={isDirty}
          />
        )}

        {!currentFile.name ? (
          <div className="editor-empty-workspace">
            <Feather size={80} className="editor-empty-feather" />
          </div>
        ) : currentFile.kind === 'image' ? (
          <ImageViewer src={currentFile.src} alt={currentFile.name} />
        ) : (
          <>
            {currentFile.kind === 'md' && showMetadata && (
              <MetadataForm
                mode={mode}
                metadata={metadata}
                onChange={setMetadata}
                isNote={currentFile.name && (currentFile.name.startsWith('notes/') || currentFile.name.includes('/notes/'))}
                isIdea={currentFile.name && (currentFile.name.startsWith('ideas/') || currentFile.name.includes('/ideas/'))}
                notesList={notesList || []}
                bibFiles={bibFiles || []}
                currentFilename={currentFile.name}
                projectMetadata={projectMetadata}
              />
            )}
            <div className="editor-container" style={{ flex: 1, overflow: 'hidden' }}>
              <Editor
                key={currentFile.name || 'empty'}
                value={content}
                onChange={setContent}
                mode={mode}
                onUploadImage={onUploadImage}
                onPasteImage={onPasteImage}
                settings={settings}
                projectMetadata={projectMetadata}
                onAiThinking={setIsAiThinking}
                onRequestImprovement={handleRequestImprovement}
                onSelectionChange={setEditorSelection}
                onRegisterCancel={(fn) => { cancelAiRef.current = fn; }}
                onRegisterJumpTo={(fn) => { jumpToWordRef.current = fn; }}
                comments={metadata?.comments || []}
                commentTags={projectMetadata?.commentTags || DEFAULT_COMMENT_TAGS}
                onAddComment={handleAddComment}
                onCommentPositionsChange={setCommentPositions}
                onEditorScrollChange={setEditorScrollTop}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  const handleUpdateFromPreview = useCallback((val) => {
    if (typeof val === 'function') {
      setContent(prev => {
        const next = val(prev);
        setPreviewContent(next);
        return next;
      });
    } else {
      setContent(val);
      setPreviewContent(val);
    }
  }, []);

  const handleNavigateToWord = useCallback((wordInfo) => {
    if (jumpToWordRef.current) {
      jumpToWordRef.current(wordInfo);
    }
  }, []);

  const renderRight = () => {
    if (!currentFile.name) {
      return (
        <div className="preview-empty-workspace">
          <Feather size={64} className="preview-empty-feather" />
        </div>
      );
    }

    return (
      <Preview
        settings={settings}
        content={previewContent}
        metadata={metadata}
        projectMetadata={projectMetadata}
        dirHandle={dirHandle}
        mode={mode}
        paperView={paperView}
        onUpdateContent={handleUpdateFromPreview}

        onUpdateMetadata={setMetadata}
        onNavigateToWord={handleNavigateToWord}

        // Tabs & Improvements
        activeTab={rightPanelTab}
        onTabChange={setRightPanelTab}
        improvementData={improvementData}
        onApplyImprovement={handleApplyImprovement}
        onRetryImprovement={handleRequestImprovement}

        // Comments - only pass changing values if comments tab is active
        editorSelection={rightPanelTab === 'comments' ? editorSelection : null}
        onAddComment={handleAddComment}
        onReplyComment={handleReplyComment}
        onResolveComment={handleResolveComment}
        onDeleteComment={handleDeleteComment}
        commentPositions={rightPanelTab === 'comments' ? commentPositions : EMPTY_ARRAY}
        editorScrollTop={rightPanelTab === 'comments' ? editorScrollTop : 0}

        // Notes Graph
        hasNotesDir={hasNotesDir}
        notesList={notesList}
        bibFiles={bibFiles}
        onFileSelect={handleFileSelect}
        currentFilename={currentFile.name}

        // Ideas Graph
        hasIdeasDir={hasIdeasDir}
        isEditingNote={!!(currentFile.name && (currentFile.name.startsWith('notes/') || currentFile.name.includes('/notes/')))}
        isEditingIdea={!!(currentFile.name && (currentFile.name.startsWith('ideas/') || currentFile.name.includes('/ideas/')))}
        // Ideas Graph only needs content when active
        currentFileContent={rightPanelTab === 'ideas-graph' ? content : ''}
      />
    );
  };

  latestStateRef.current = { 
    content, 
    metadata, 
    currentFile, 
    openTabs,
    saveFile, 
    isDirty, 
    handleSave, 
    mode, 
    dirHandle, 
    projectMetadata,
    settings,
    openDirectoryWithHandle,
    saveFileAs,
    createSubDir,
    writeFileInDir,
    readFile,
    handleFileSelect,
    handleSelectTab,
    handleCloseTab
  };

  return (
    <>
      {isElectron && <div className="titlebar-drag-region" />}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          Loading...
        </div>
      )}

      {/* PDF Export Modal */}
      {showPdfModal && (
        <PdfExportModal
          dirHandle={dirHandle}
          mode={mode}
          onExport={handlePdfExport}
          onClose={() => setShowPdfModal(false)}
          currentFilename={currentFile?.name}
        />
      )}

      {/* Hidden Print Host — rendered off-screen to capture HTML for PDF export */}
      {printMode && printData && (
        <div
          id="feder-print-root"
          className="feder-print-host"
          style={{
            position: 'fixed',
            left: '-9999px',
            top: 0,
            width: '850px',
            opacity: 0,
            pointerEvents: 'none',
            background: '#ffffff',
            color: '#000000'
          }}
        >
          <MarkdownPreview
            content={printData.content}
            metadata={printData.metadata}
            projectMetadata={printData.projectMetadata || projectMetadata}
            dirHandle={printData.dirHandle || dirHandle}
            mode={mode}
            paperView={true}
            isPrinting={true}
            preloadedBibData={printData.bibData}
            filePath={printData.filePath}
            onUpdateContent={() => {}}
            onUpdateMetadata={() => {}}
          />
        </div>
      )}

      {viewState === 'welcome' ? (
        <WelcomeScreen
          onNewProject={createProject}
          onOpenProject={() => {
            setMode('researcher');
            handleOpen();
          }}
          recentProjects={recentProjects}
          onOpenRecent={handleOpenRecent}
          theme={theme}
          toggleTheme={toggleTheme}
          settings={settings}
          onUpdateSettings={async (newSettings) => {
            setSettings(newSettings);
            await saveSettings(newSettings);
          }}
          onRemoveRecent={removeRecentProject}
          isElectron={isElectron}
        />
      ) : (
        <Layout
          theme={theme}
          toggleTheme={toggleTheme}
          onOpen={handleOpen}
          onSave={handleSave}
          onNew={handleNew}
          onExport={handleExport}
          onImport={handleImport}
          onOpenMetadata={async () => {
            if (!dirHandle) return;
            try {
              const handle = await dirHandle.getFileHandle('project_metadata.json');
              handleFileSelect(handle, 'project_metadata.json');
            } catch (e) {
              alert('Project metadata file not found.');
            }
          }}
          filename={currentFile.name ? currentFile.name.split('/').pop() : ''}
          projectName={projectMetadata.name}
          mode={mode}
          onProjectNameChange={(name) => setProjectMetadata({ ...projectMetadata, name })}
          showExplorer={showExplorer}
          toggleExplorer={() => setShowExplorer(!showExplorer)}
          onLogoClick={goToWelcome}
          onOpenSettings={() => setShowSettingsModal(true)}
          onRename={(newName) => {
            if (currentFile.name === 'project_metadata.json') {
              alert('The project metadata file cannot be renamed.');
              setRefreshTrigger(prev => prev + 1); // Reset input
              return;
            }
            const parts = currentFile.name.split('/');
            parts.pop();
            const prefix = parts.join('/');
            handleRename(currentFile.handle, newName, prefix);
          }}
          statusBar={
            <StatusBar
              settings={settings}
              isAiThinking={isAiThinking}
              onCancelAi={() => { if (cancelAiRef.current) cancelAiRef.current(); }}
              projectMetadata={projectMetadata}
              onOpenSettings={() => setShowSettingsModal(true)}
              onUpdateSettings={async (newSettings) => {
                // SENSITIVE KEYS (v1): Keep keys in global settings, but move CONFIG to projectMeta
                setSettings(newSettings);
                await saveSettings(newSettings);
              }}
              onUpdateProjectMetadata={handleUpdateProjectSettings}
              wordCount={countWords(content)}
              paperView={paperView}
              onTogglePaperView={() => setPaperView(!paperView)}
              previewFont={projectMetadata?.previewFont}
              onFontChange={(font) => handleUpdateProjectSettings({ ...projectMetadata, previewFont: font })}
            />

          }
        >
          {showSettingsModal && (
            <SettingsModal
              mode={mode}
              metadata={projectMetadata}
              onUpdate={handleUpdateProjectSettings}
              onClose={() => setShowSettingsModal(false)}
              settings={settings}
              onUpdateSettings={async (newSettings) => {
                // Keep keys in global settings
                setSettings(newSettings);
                await saveSettings(newSettings);
              }}
            />
          )}

          <div className="workspace-container" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {isLoading && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                Loading...
              </div>
            )}
            {/* Helper to decide layout */}
            {(() => {
              const isMD = currentFile.kind === 'md';
              const isImage = currentFile.kind === 'image';
              const isTextLike = ['bib', 'json', 'txt'].includes(currentFile.kind);

              if (isTextLike) {
                // "It's just the center and right panels that should switch to text editor. But not disappearing the left panel."
                return (
                  <ResizablePanels
                    left={showExplorer ? renderLeft() : null}
                    center={renderCenter()}
                    right={null}
                  />
                );
              }

              if (isImage) {
                // "just two panels (left panel with explorer and right-center panel with the image)"
                return (
                  <ResizablePanels
                    left={showExplorer ? renderLeft() : null}
                    center={renderCenter()}
                    right={null}
                  />
                );
              }

              // Case for .md or default
              const isProjectMode = ['researcher', 'engineer', 'scholar', 'scriptwriter', 'journalist'].includes(mode);

              if (isProjectMode && dirHandle) {
                return (
                  <ResizablePanels
                    left={showExplorer ? renderLeft() : null}
                    center={renderCenter()}
                    right={isMD ? renderRight() : null}
                  />
                );
              } else {
                // Simple layout for Journalist / No Project
                return (
                  <div style={{ flex: 1, display: 'flex' }}>
                    {showExplorer && (
                      <div style={{ width: '250px', borderRight: '1px solid var(--border-color)' }}>
                        {renderLeft()}
                      </div>
                    )}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      {renderCenter()}
                    </div>
                    {isMD && (
                      <div style={{ width: '50%', borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                        {renderRight()}
                      </div>
                    )}
                  </div>
                );
              }
            })()}
          </div>
        </Layout>
      )}
    </>
  );
}

export default App;
