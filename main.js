const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const JSZip = require('jszip');
const mammoth = require('mammoth');


let mainWindow;
let openFiles = new Map(); // path -> { content, mtime }
let updateDownloaded = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Note+',
    icon: path.join(__dirname, 'src', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('close', (e) => {
    const answer = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Save', 'Don\'t Save', 'Cancel'],
      defaultId: 2,
      title: 'Save changes?',
      message: 'Do you want to save changes to this file?',
    });
    if (answer === 0) {
      mainWindow.webContents.send('menu-save');
    } else if (answer === 2) {
      e.preventDefault();
    }
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu-new'),
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFileDialog(),
        },
        {
          label: 'Open Recent',
          submenu: getRecentFilesMenu(),
        },
        { type: 'separator' },
        {
          label: 'Compare Files',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => mainWindow.webContents.send('menu-compare'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => triggerSaveAs(),
        },
        { type: 'separator' },
        {
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow.webContents.send('menu-print'),
        },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', role: 'undo' },
        { label: 'Redo', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        { label: 'Delete', role: 'delete' },
        { type: 'separator' },
        { label: 'Find...', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('menu-find') },
        { label: 'Replace...', accelerator: 'CmdOrCtrl+H', click: () => mainWindow.webContents.send('menu-replace') },
        { label: 'Go to Line...', accelerator: 'CmdOrCtrl+G', click: () => mainWindow.webContents.send('menu-goto') },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Word Wrap',
          type: 'checkbox',
          checked: true,
          click: (item) => mainWindow.webContents.send('menu-wordwrap', item.checked),
        },
        {
          label: 'Minimap',
          type: 'checkbox',
          checked: false,
          click: (item) => mainWindow.webContents.send('menu-minimap', item.checked),
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow.webContents.send('menu-zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.send('menu-zoom-out'),
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.send('menu-zoom-reset'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => mainWindow.webContents.send('menu-toggle-theme'),
        },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Note+',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Note+',
              message: 'Note+ v1.1.0',
              detail: 'Author: Thai Tran <me@tnmthai.com>',
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => autoUpdater.checkForUpdates(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  mainWindow.webContents.send('update-status', { type: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  mainWindow.webContents.send('update-status', {
    type: 'available',
    version: info.version,
  });
});

autoUpdater.on('update-not-available', () => {
  mainWindow.webContents.send('update-status', { type: 'not-available' });
});

autoUpdater.on('download-progress', (progress) => {
  mainWindow.webContents.send('update-status', {
    type: 'progress',
    percent: Math.round(progress.percent),
  });
});

autoUpdater.on('update-downloaded', () => {
  updateDownloaded = true;
  mainWindow.webContents.send('update-status', { type: 'downloaded' });
});

autoUpdater.on('error', (err) => {
  mainWindow.webContents.send('update-status', {
    type: 'error',
    message: err.message,
  });
});

function getRecentFilesMenu() {
  const recentPath = path.join(app.getPath('userData'), 'recent.json');
  try {
    const data = JSON.parse(fs.readFileSync(recentPath, 'utf-8'));
    return data.slice(0, 10).map((file) => ({
      label: path.basename(file),
      toolTip: file,
      click: () => mainWindow.webContents.send('menu-open-file', file),
    }));
  } catch {
    return [{ label: '(empty)', enabled: false }];
  }
}

function saveRecentFile(filePath) {
  const recentPath = path.join(app.getPath('userData'), 'recent.json');
  let recent = [];
  try {
    recent = JSON.parse(fs.readFileSync(recentPath, 'utf-8'));
  } catch {}
  recent = recent.filter((f) => f !== filePath);
  recent.unshift(filePath);
  recent = recent.slice(0, 20);
  fs.writeFileSync(recentPath, JSON.stringify(recent, null, 2));
}

// IPC Handlers
ipcMain.handle('dialog-open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Supported Files', extensions: [
        'txt', 'log', 'md', 'csv',
        'zip', 'rar', 'docx', 'pdf', 'xlsx', 'xls', 'xlsx', 'xls',
        'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
        'html', 'htm', 'css', 'scss', 'less',
        'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
        'py', 'pyw', 'pyi',
        'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx',
        'cs', 'csx',
        'java', 'kt', 'kts', 'scala', 'groovy',
        'go', 'rs', 'rb', 'php', 'swift', 'm', 'mm',
        'r', 'R', 'lua', 'dart', 'ex', 'exs', 'erl', 'hs',
        'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
        'sql', 'graphql', 'gql',
        'dockerfile', 'makefile', 'cmake',
        'vim', 'el', 'lisp',
        'proto', 'thrift',
        'env', 'editorconfig', 'gitignore', 'gitattributes',
        'vue', 'svelte',
      ]},
      { name: 'Text Files', extensions: ['txt', 'log', 'md', 'csv'] },
      { name: 'Config Files', extensions: ['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env'] },
      { name: 'Web Files', extensions: ['html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte'] },
      { name: 'JavaScript/TypeScript', extensions: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'] },
      { name: 'Python', extensions: ['py', 'pyw', 'pyi'] },
      { name: 'C/C++', extensions: ['c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx'] },
      { name: 'C#/.NET', extensions: ['cs', 'csx'] },
      { name: 'Java/Kotlin/Scala', extensions: ['java', 'kt', 'kts', 'scala', 'groovy'] },
      { name: 'Go/Rust', extensions: ['go', 'rs'] },
      { name: 'Ruby/PHP', extensions: ['rb', 'php'] },
      { name: 'Shell Scripts', extensions: ['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'] },
      { name: 'Archive Files', extensions: ['zip', 'rar'] },
      { name: 'Document Files', extensions: ['docx', 'pdf', 'xlsx', 'xls'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    
    // Check if it's an archive file
    if (ext === '.zip' || ext === '.rar') {
      saveRecentFile(filePath);
      return { filePath, content: null, isArchive: true };
    }
    
    // Check if it's a document file (DOCX/PDF)
    if (ext === '.docx' || ext === '.pdf' || ext === '.xlsx' || ext === '.xls') {
      saveRecentFile(filePath);
      return { filePath, content: null, isDocument: true, docType: ext.slice(1) };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    saveRecentFile(filePath);
    return { filePath, content };
  }
  return null;
});

ipcMain.handle('dialog-save', async (event, { filePath, content }) => {
  if (!filePath) {
    return saveAsDialog(content);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return { filePath };
});

ipcMain.handle('dialog-save-as', async (event, { content }) => {
  return saveAsDialog(content);
});

async function saveAsDialog(content) {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'Text Files', extensions: ['txt', 'log', 'md', 'csv'] },
      { name: 'Config Files', extensions: ['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf'] },
      { name: 'Web Files', extensions: ['html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte'] },
      { name: 'JavaScript/TypeScript', extensions: ['js', 'ts', 'jsx', 'tsx'] },
      { name: 'Python', extensions: ['py', 'pyw'] },
      { name: 'C/C++', extensions: ['c', 'h', 'cpp', 'hpp'] },
      { name: 'C#/.NET', extensions: ['cs'] },
      { name: 'Java/Kotlin', extensions: ['java', 'kt', 'scala'] },
      { name: 'Go/Rust', extensions: ['go', 'rs'] },
      { name: 'Ruby/PHP', extensions: ['rb', 'php'] },
      { name: 'Shell Scripts', extensions: ['sh', 'bash', 'ps1', 'bat', 'cmd'] },
      { name: 'Archive Files', extensions: ['zip', 'rar'] },
      { name: 'Document Files', extensions: ['docx', 'pdf', 'xlsx', 'xls'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    saveRecentFile(result.filePath);
    return { filePath: result.filePath };
  }
  return null;
}

function openFileDialog() {
  mainWindow.webContents.send('menu-open');
}

function triggerSaveAs() {
  mainWindow.webContents.send('menu-save-as');
}

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, error: null };
  } catch (err) {
    return { content: null, error: err.message };
  }
});

ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return { mtime: stats.mtime.toISOString(), size: stats.size };
  } catch {
    return null;
  }
});

// Session persistence
function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

ipcMain.handle('save-session', async (event, sessionData) => {
  try {
    fs.writeFileSync(getSessionPath(), JSON.stringify(sessionData, null, 2));
    return true;
  } catch {
    return false;
  }
});

ipcMain.on('save-session-sync', (event, sessionData) => {
  try {
    fs.writeFileSync(getSessionPath(), JSON.stringify(sessionData, null, 2));
    event.returnValue = true;
  } catch {
    event.returnValue = false;
  }
});

ipcMain.handle('load-session', async () => {
  try {
    const data = fs.readFileSync(getSessionPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
});

// Update IPC handlers
ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdates();
});

ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});


// Archive IPC handlers
ipcMain.handle('read-archive', async (event, archivePath) => {
  const ext = path.extname(archivePath).toLowerCase();
  try {
    if (ext === '.zip') {
      const data = fs.readFileSync(archivePath);
      const zip = await JSZip.loadAsync(data);
      const files = [];
      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          files.push({
            name: relativePath,
            size: zipEntry._data ? zipEntry._data.uncompressedSize || 0 : 0,
          });
        }
      });
      return { files, error: null };
    } else if (ext === '.rar') {
      // RAR support using unrar.js
      const Unrar = require('unrar.js');
      const archive = new Unrar(archivePath);
      const list = archive.list();
      const files = list.filter(f => f.type === 'File').map(f => ({
        name: f.name,
        size: f.size,
      }));
      return { files, error: null };
    }
    return { files: [], error: 'Unsupported archive format' };
  } catch (err) {
    return { files: [], error: err.message };
  }
});

ipcMain.handle('read-archive-file', async (event, { archivePath, filePath }) => {
  const ext = path.extname(archivePath).toLowerCase();
  try {
    if (ext === '.zip') {
      const data = fs.readFileSync(archivePath);
      const zip = await JSZip.loadAsync(data);
      const file = zip.file(filePath);
      if (!file) {
        return { content: null, error: 'File not found in archive' };
      }
      const content = await file.async('string');
      return { content, error: null };
    } else if (ext === '.rar') {
      const Unrar = require('unrar.js');
      const archive = new Unrar(archivePath);
      const extracted = archive.extractFile(filePath);
      if (!extracted) {
        return { content: null, error: 'File not found in archive' };
      }
      const content = Buffer.from(extracted).toString('utf-8');
      return { content, error: null };
    }
    return { content: null, error: 'Unsupported archive format' };
  } catch (err) {
    return { content: null, error: err.message };
  }
});





// Document viewer IPC handler
let viewerWindow = null;

ipcMain.handle('open-document-viewer', async (event, { filePath, docType }) => {
  const fileName = path.basename(filePath);
  
  viewerWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: fileName + ' - Note+ Viewer',
    icon: path.join(__dirname, 'src', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  viewerWindow.loadFile(path.join(__dirname, 'src', 'document-viewer.html'), {
    query: { file: filePath, type: docType, title: fileName }
  });

  viewerWindow.on('closed', () => { viewerWindow = null; });
});

ipcMain.handle('read-file-binary', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return { data: data.toString('base64'), error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
});

ipcMain.handle('render-document', async (event, { filePath, docType }) => {
  try {
    if (docType === 'docx' || docType === 'xlsx' || docType === 'xls') {
      const data = fs.readFileSync(filePath);
      if (viewerWindow && !viewerWindow.isDestroyed()) {
        viewerWindow.webContents.send('document-rendered', { type: docType, data: data.toString('base64'), error: null });
      }
    }
  } catch (err) {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('document-rendered', { error: err.message });
    }
  }
});


app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
