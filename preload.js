const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File dialogs
  openFile: () => ipcRenderer.invoke('dialog-open'),
  saveFile: (data) => ipcRenderer.invoke('dialog-save', data),
  saveFileAs: (data) => ipcRenderer.invoke('dialog-save-as', data),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  getFileStats: (path) => ipcRenderer.invoke('get-file-stats', path),

  // Session persistence
  saveSession: (data) => ipcRenderer.invoke('save-session', data),
  saveSessionSync: (data) => ipcRenderer.sendSync('save-session-sync', data),
  loadSession: () => ipcRenderer.invoke('load-session'),

  // Document (DOCX/PDF)
  readDocument: (filePath, docType) => ipcRenderer.invoke('read-document', { filePath, docType }),

  // Archive
  readArchive: (archivePath) => ipcRenderer.invoke('read-archive', archivePath),
  readArchiveFile: (archivePath, filePath) => ipcRenderer.invoke('read-archive-file', { archivePath, filePath }),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizeChanged: (cb) => ipcRenderer.on('window-maximize-changed', (e, val) => cb(val)),

  // Menu events
  onMenuNew: (cb) => ipcRenderer.on('menu-new', cb),
  onMenuOpen: (cb) => ipcRenderer.on('menu-open', cb),
  onMenuOpenFile: (cb) => ipcRenderer.on('menu-open-file', (e, path) => cb(path)),
  onMenuSave: (cb) => ipcRenderer.on('menu-save', cb),
  onMenuSaveAs: (cb) => ipcRenderer.on('menu-save-as', cb),
  onMenuPrint: (cb) => ipcRenderer.on('menu-print', cb),
  onMenuFind: (cb) => ipcRenderer.on('menu-find', cb),
  onMenuReplace: (cb) => ipcRenderer.on('menu-replace', cb),
  onMenuGoto: (cb) => ipcRenderer.on('menu-goto', cb),
  onMenuWordWrap: (cb) => ipcRenderer.on('menu-wordwrap', (e, val) => cb(val)),
  onMenuMinimap: (cb) => ipcRenderer.on('menu-minimap', (e, val) => cb(val)),
  onMenuZoomIn: (cb) => ipcRenderer.on('menu-zoom-in', cb),
  onMenuZoomOut: (cb) => ipcRenderer.on('menu-zoom-out', cb),
  onMenuZoomReset: (cb) => ipcRenderer.on('menu-zoom-reset', cb),
  onMenuToggleTheme: (cb) => ipcRenderer.on('menu-toggle-theme', cb),
  onMenuCompare: (cb) => ipcRenderer.on('menu-compare', cb),

  // Update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (e, status) => cb(status)),
});
