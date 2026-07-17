let editor;
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let isDarkTheme = true;

// Archive state
let currentArchive = null; // { path, files: [] }
let archiveFileContentCache = new Map(); // archivePath:filePath -> content

// Language mapping for file extensions
const LANG_MAP = {
  'js': 'javascript', 'ts': 'typescript', 'jsx': 'javascript', 'tsx': 'typescript',
  'mjs': 'javascript', 'cjs': 'javascript',
  'py': 'python', 'pyw': 'python', 'pyi': 'python',
  'rb': 'ruby', 'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c',
  'hpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'hxx': 'cpp',
  'cs': 'csharp', 'csx': 'csharp',
  'go': 'go', 'rs': 'rust', 'php': 'php', 'swift': 'swift',
  'kt': 'kotlin', 'kts': 'kotlin', 'scala': 'scala', 'groovy': 'java',
  'r': 'r', 'lua': 'lua', 'dart': 'dart',
  'ex': 'elixir', 'exs': 'elixir', 'erl': 'erlang', 'hs': 'haskell',
  'html': 'html', 'htm': 'html', 'css': 'css', 'scss': 'scss', 'less': 'less',
  'vue': 'html', 'svelte': 'html',
  'json': 'json', 'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
  'toml': 'ini', 'md': 'markdown', 'txt': 'plaintext', 'log': 'plaintext',
  'sql': 'sql', 'graphql': 'graphql', 'gql': 'graphql',
  'sh': 'shell', 'bash': 'shell', 'zsh': 'shell', 'fish': 'shell',
  'ps1': 'powershell', 'psm1': 'powershell',
  'bat': 'bat', 'cmd': 'bat',
  'ini': 'ini', 'cfg': 'ini', 'conf': 'ini', 'env': 'ini',
  'dockerfile': 'dockerfile', 'makefile': 'makefile', 'cmake': 'cmake',
  'proto': 'protobuf', 'vim': 'vim', 'el': 'lisp',
  'csv': 'plaintext',
};

// Initialize Monaco Editor
require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });

require(['vs/editor/editor.main'], () => {
  editor = monaco.editor.create(document.getElementById('editor'), {
    value: '',
    language: 'plaintext',
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
    minimap: { enabled: false },
    wordWrap: 'on',
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
  });

  // Update cursor position on selection change
  editor.onDidChangeCursorPosition((e) => {
    updateCursorPosition(e.position);
  });

  editor.onDidChangeCursorSelection(() => {
    // Could update selection info if needed
  });

  // Track modifications
  editor.onDidChangeModelContent(() => {
    if (activeTabId !== null) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        tab.modified = true;
        updateTabUI();
      }
    }
    updateFindCount();
    // Save session immediately on every change
    autoSaveSession();
  });

  // Save session before page unload
  window.addEventListener('beforeunload', () => {
    if (activeTabId !== null && editor) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        tab.content = editor.getValue();
      }
    }
    // Synchronous save to ensure data is written before app closes
    window.api.saveSessionSync({
      tabs: tabs.map(t => ({
        filePath: t.filePath,
        name: t.name,
        content: t.content,
        language: t.language,
        modified: t.modified,
      })),
      activeTabId,
      isDarkTheme,
      archive: currentArchive ? { path: currentArchive.path } : null,
    });
  });

  // Create first tab or restore session
  loadSession();
});

// Session persistence
async function saveSession() {
  const sessionData = {
    tabs: tabs.map(t => ({
      filePath: t.filePath,
      name: t.name,
      content: t.content,
      language: t.language,
      modified: t.modified,
    })),
    activeTabId,
    isDarkTheme,
    archive: currentArchive ? { path: currentArchive.path } : null,
  };
  await window.api.saveSession(sessionData);
}

async function loadSession() {
  const session = await window.api.loadSession();
  if (session && session.tabs && session.tabs.length > 0) {
    // Restore theme
    if (session.isDarkTheme !== undefined) {
      isDarkTheme = session.isDarkTheme;
      document.body.classList.toggle('light', !isDarkTheme);
      monaco.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
    }

    for (const tabData of session.tabs) {
      // Verify file still exists for saved files
      let content = tabData.content;
      if (tabData.filePath) {
        const result = await window.api.readFile(tabData.filePath);
        if (result.content !== null) {
          content = result.content;
          tabData.modified = false;
        }
      }
      const id = ++tabCounter;
      tabs.push({
        id,
        filePath: tabData.filePath,
        name: tabData.name,
        content,
        language: tabData.language,
        modified: tabData.modified,
        viewState: null,
      });
    }
    // Restore active tab
    const activeId = session.activeTabId || tabs[0]?.id;
    if (activeId) {
      switchToTab(activeId);
    }
    updateTabUI();
  } else {
    createNewTab();
  }

  // Restore archive panel
  if (session && session.archive && session.archive.path) {
    openArchive(session.archive.path);
  }
}

// Auto-save session when tabs change
function autoSaveSession() {
  // Sync current tab content from editor before saving
  if (activeTabId !== null && editor) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
      tab.content = editor.getValue();
    }
  }
  saveSession();
}

// Tab management
function createNewTab(filePath = null, content = '', language = 'plaintext') {
  const id = ++tabCounter;
  const name = filePath ? filePath.split(/[/\\]/).pop() : 'Untitled';

  tabs.push({
    id,
    filePath,
    name,
    content,
    language,
    modified: false,
    viewState: null,
  });

  switchToTab(id);
  updateTabUI();
  autoSaveSession();
}

function switchToTab(id) {
  // Save current state
  if (activeTabId !== null) {
    const prev = tabs.find((t) => t.id === activeTabId);
    if (prev && editor) {
      prev.content = editor.getValue();
      prev.viewState = editor.saveViewState();
    }
  }

  activeTabId = id;
  const tab = tabs.find((t) => t.id === id);

  if (tab && editor) {
    const model = monaco.editor.createModel(tab.content, tab.language);
    editor.setModel(model);
    if (tab.viewState) {
      editor.restoreViewState(tab.viewState);
    }
    updateStatusFile(tab);
    updateCursorPosition(editor.getPosition());
  }

  updateTabUI();
  autoSaveSession();
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    createNewTab();
  } else if (activeTabId === id) {
    const newIdx = Math.min(idx, tabs.length - 1);
    switchToTab(tabs[newIdx].id);
  }

  updateTabUI();
  autoSaveSession();
}

function updateTabUI() {
  const container = document.getElementById('tabs');
  container.innerHTML = '';

  tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = `tab${tab.id === activeTabId ? ' active' : ''}${tab.modified ? ' modified' : ''}`;
    el.innerHTML = `
      <span class="modified"></span>
      <span class="name">${tab.name}</span>
      <span class="close-btn">×</span>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('close-btn')) {
        closeTab(tab.id);
      } else {
        switchToTab(tab.id);
      }
    });

    container.appendChild(el);
  });
}

function updateStatusFile(tab) {
  document.getElementById('status-file').textContent = tab.filePath || tab.name;
  document.getElementById('status-lang').textContent = getLanguageName(tab.language);
  document.title = `${tab.modified ? '● ' : ''}${tab.name} - Note+`;
}

function updateCursorPosition(pos) {
  if (pos) {
    document.getElementById('status-pos').textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
  }
}

function getLanguageName(langId) {
  const names = {
    plaintext: 'Plain Text', javascript: 'JavaScript', typescript: 'TypeScript',
    python: 'Python', java: 'Java', c: 'C', cpp: 'C++', csharp: 'C#',
    go: 'Go', rust: 'Rust', ruby: 'Ruby', php: 'PHP', swift: 'Swift',
    kotlin: 'Kotlin', scala: 'Scala', dart: 'Dart', lua: 'Lua', r: 'R',
    html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
    json: 'JSON', xml: 'XML', yaml: 'YAML', toml: 'TOML',
    markdown: 'Markdown', sql: 'SQL', graphql: 'GraphQL',
    shell: 'Shell', powershell: 'PowerShell', bat: 'Batch',
    dockerfile: 'Dockerfile', makefile: 'Makefile', cmake: 'CMake',
    elixir: 'Elixir', erlang: 'Erlang', haskell: 'Haskell',
    protobuf: 'Protocol Buffers', vim: 'Vim', lisp: 'Lisp',
  };
  return names[langId] || langId;
}

function detectLanguage(filePath) {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop().toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

// File operations via IPC
async function openFile() {
  const result = await window.api.openFile();
  if (result) {
    // Check if it's an archive
    if (result.isArchive) {
      openArchive(result.filePath);
    } else if (result.isDocument) {
      await openDocument(result.filePath, result.docType);
    } else {
      const lang = detectLanguage(result.filePath);
      // Check if file already open
      const existing = tabs.find((t) => t.filePath === result.filePath);
      if (existing) {
        switchToTab(existing.id);
      } else {
        createNewTab(result.filePath, result.content, lang);
      }
    }
  }
}

async function saveCurrentFile() {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const content = editor.getValue();
  const result = await window.api.saveFile({ filePath: tab.filePath, content });

  if (result) {
    tab.filePath = result.filePath;
    tab.name = result.filePath.split(/[/\\]/).pop();
    tab.content = content;
    tab.modified = false;
    tab.language = detectLanguage(result.filePath);

    // Update model language
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, tab.language);
    }

    updateTabUI();
    updateStatusFile(tab);
  }
}

async function saveAsCurrentFile() {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const content = editor.getValue();
  const result = await window.api.saveFileAs({ content });

  if (result) {
    tab.filePath = result.filePath;
    tab.name = result.filePath.split(/[/\\]/).pop();
    tab.content = content;
    tab.modified = false;
    tab.language = detectLanguage(result.filePath);

    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, tab.language);
    }

    updateTabUI();
    updateStatusFile(tab);
  }
}

// Find/Replace
let findDecorations = [];

function toggleFindBar(showReplace = false) {
  const bar = document.getElementById('find-bar');
  const replaceRow = document.getElementById('replace-row');

  if (bar.classList.contains('hidden')) {
    bar.classList.remove('hidden');
    replaceRow.style.display = showReplace ? 'flex' : 'none';
    document.getElementById('find-input').focus();
    document.getElementById('find-input').select();

    // Pre-fill with selection
    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      const selectedText = editor.getModel().getValueInRange(selection);
      document.getElementById('find-input').value = selectedText;
    }
  } else if (showReplace) {
    replaceRow.style.display = replaceRow.style.display === 'none' ? 'flex' : 'none';
  } else {
    bar.classList.add('hidden');
    clearFindDecorations();
    editor.focus();
  }
}

function doFind() {
  const query = document.getElementById('find-input').value;
  if (!query) {
    clearFindDecorations();
    return;
  }

  const caseSensitive = document.getElementById('find-case').checked;
  const wholeWord = document.getElementById('find-whole').checked;
  const useRegex = document.getElementById('find-regex').checked;

  const matches = editor.getModel().findMatches(query, false, useRegex, caseSensitive, wholeWord ? 'true' : null, false);

  findDecorations = editor.deltaDecorations(findDecorations, matches.map((match) => ({
    range: match.range,
    options: { inlineClassName: 'findHighlight', minimap: { color: '#555' } },
  })));

  document.getElementById('find-count').textContent = `${matches.length} result${matches.length !== 1 ? 's' : ''}`;

  if (matches.length > 0) {
    editor.revealRangeInCenter(matches[0].range);
    editor.setSelection(matches[0].range);
  }
}

function clearFindDecorations() {
  findDecorations = editor.deltaDecorations(findDecorations, []);
  document.getElementById('find-count').textContent = '';
}

function findNext() {
  const action = editor.getAction('actions.find');
  editor.trigger('keyboard', 'editor.action.nextMatchFindAction', {});
}

function findPrev() {
  editor.trigger('keyboard', 'editor.action.previousMatchFindAction', {});
}

function replaceOne() {
  const findText = document.getElementById('find-input').value;
  const replaceText = document.getElementById('replace-input').value;
  if (!findText) return;

  const selection = editor.getSelection();
  const selectedText = editor.getModel().getValueInRange(selection);

  if (selectedText === findText) {
    editor.executeEdits('replace', [{
      range: selection,
      text: replaceText,
    }]);
  }

  editor.trigger('keyboard', 'editor.action.nextMatchFindAction', {});
}

function replaceAll() {
  const findText = document.getElementById('find-input').value;
  const replaceText = document.getElementById('replace-input').value;
  if (!findText) return;

  const model = editor.getModel();
  const fullText = model.getValue();
  const caseSensitive = document.getElementById('find-case').checked;
  const wholeWord = document.getElementById('find-whole').checked;
  const useRegex = document.getElementById('find-regex').checked;

  let flags = caseSensitive ? 'g' : 'gi';
  let pattern = useRegex ? findText : findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) pattern = `\\b${pattern}\\b`;

  const regex = new RegExp(pattern, flags);
  const newText = fullText.replace(regex, replaceText);

  editor.setValue(newText);
}

// Go to line
function showGotoDialog() {
  document.getElementById('goto-dialog').classList.remove('hidden');
  const input = document.getElementById('goto-input');
  input.value = editor.getPosition().lineNumber;
  input.focus();
  input.select();
}

function goToLine() {
  const line = parseInt(document.getElementById('goto-input').value);
  if (line >= 1) {
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }
  document.getElementById('goto-dialog').classList.add('hidden');
}

// Theme
function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  document.body.classList.toggle('light', !isDarkTheme);
  monaco.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
  autoSaveSession();
}

// Word wrap
function setWordWrap(enabled) {
  editor.updateOptions({ wordWrap: enabled ? 'on' : 'off' });
}

// Minimap
function setMinimap(enabled) {
  editor.updateOptions({ minimap: { enabled } });
}

// Zoom
let zoomLevel = 0;
function zoomIn() {
  zoomLevel++;
  editor.updateOptions({ fontSize: 14 + zoomLevel });
}
function zoomOut() {
  zoomLevel--;
  editor.updateOptions({ fontSize: Math.max(8, 14 + zoomLevel) });
}
function zoomReset() {
  zoomLevel = 0;
  editor.updateOptions({ fontSize: 14 });
}

// Print
function printEditor() {
  window.print();
}

// Drag and drop
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const path = file.path;
      if (path) {
        // Check if it's an archive
        if (isArchiveFile(path)) {
          openArchive(path);
        } else if (isDocumentFile(path)) {
          const ext = path.split('.').pop().toLowerCase();
          await openDocument(path, ext);
        } else {
          const result = await window.api.readFile(path);
          if (result.content !== null) {
            const lang = detectLanguage(path);
            createNewTab(path, result.content, lang);
          }
        }
      }
    }
  });
});

// Register menu handlers
window.api.onMenuNew(() => createNewTab());
window.api.onMenuOpen(() => openFile());
window.api.onMenuOpenFile(async (filePath) => {
  const result = await window.api.readFile(filePath);
  if (result.content !== null) {
    const lang = detectLanguage(filePath);
    createNewTab(filePath, result.content, lang);
  }
});
window.api.onMenuSave(() => saveCurrentFile());
window.api.onMenuSaveAs(() => saveAsCurrentFile());
window.api.onMenuPrint(() => printEditor());
window.api.onMenuFind(() => toggleFindBar(false));
window.api.onMenuReplace(() => toggleFindBar(true));
window.api.onMenuGoto(() => showGotoDialog());
window.api.onMenuWordWrap((val) => setWordWrap(val));
window.api.onMenuMinimap((val) => setMinimap(val));
window.api.onMenuZoomIn(() => zoomIn());
window.api.onMenuZoomOut(() => zoomOut());
window.api.onMenuZoomReset(() => zoomReset());
window.api.onMenuToggleTheme(() => toggleTheme());
window.api.onMenuCompare(() => openCompareMode());

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('find-bar').classList.add('hidden');
    document.getElementById('goto-dialog').classList.add('hidden');
    clearFindDecorations();
    editor.focus();
  }
});

// Find bar event listeners
document.getElementById('find-input').addEventListener('input', doFind);
document.getElementById('find-next').addEventListener('click', findNext);
document.getElementById('find-prev').addEventListener('click', findPrev);
document.getElementById('find-close').addEventListener('click', () => {
  document.getElementById('find-bar').classList.add('hidden');
  clearFindDecorations();
  editor.focus();
});
document.getElementById('replace-one').addEventListener('click', replaceOne);
document.getElementById('replace-all').addEventListener('click', replaceAll);

// Go to line event listeners
document.getElementById('goto-go').addEventListener('click', goToLine);
document.getElementById('goto-close').addEventListener('click', () => {
  document.getElementById('goto-dialog').classList.add('hidden');
  editor.focus();
});
document.getElementById('goto-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') goToLine();
  if (e.key === 'Escape') {
    document.getElementById('goto-dialog').classList.add('hidden');
    editor.focus();
  }
});

// New tab button
document.getElementById('new-tab-btn').addEventListener('click', () => createNewTab());

// Update notification
const updateBar = document.getElementById('update-bar');
const updateText = document.getElementById('update-text');
const updateAction = document.getElementById('update-action');
const updateClose = document.getElementById('update-close');

function showUpdateBar(text, showAction = false, actionLabel = '') {
  updateText.textContent = text;
  updateAction.style.display = showAction ? 'inline-block' : 'none';
  updateAction.textContent = actionLabel;
  updateBar.classList.remove('hidden');
}

function hideUpdateBar() {
  updateBar.classList.add('hidden');
}

window.api.onUpdateStatus((status) => {
  switch (status.type) {
    case 'checking':
      showUpdateBar('Checking for updates...');
      break;
    case 'available':
      showUpdateBar(
        `Update available: v${status.version}`,
        true,
        'Download'
      );
      updateAction.onclick = () => {
        window.api.downloadUpdate();
        showUpdateBar('Downloading update...', false);
      };
      break;
    case 'not-available':
      showUpdateBar('You are up to date.');
      setTimeout(hideUpdateBar, 3000);
      break;
    case 'progress':
      showUpdateBar(`Downloading update... ${status.percent}%`, false);
      break;
    case 'downloaded':
      showUpdateBar('Update ready to install.', true, 'Restart Now');
      updateAction.onclick = () => window.api.installUpdate();
      break;
    case 'error':
      showUpdateBar(`Update error: ${status.message}`);
      setTimeout(hideUpdateBar, 5000);
      break;
  }
});

updateClose.addEventListener('click', hideUpdateBar);

// Compare mode
let compareMode = false;
let diffEditor = null;
let compareLeftContent = null;
let compareRightContent = null;

const compareContainer = document.getElementById('compare-container');
const editorContainer = document.getElementById('editor-container');
const compareSummary = document.getElementById('compare-summary');
const compareLeftName = document.getElementById('compare-left-name');
const compareRightName = document.getElementById('compare-right-name');
const compareRunBtn = document.getElementById('compare-run');

function openCompareMode() {
  compareMode = true;
  editorContainer.classList.add('hidden');
  compareContainer.classList.remove('hidden');
  compareLeftContent = null;
  compareRightContent = null;
  compareLeftName.textContent = 'No file';
  compareRightName.textContent = 'No file';
  compareSummary.classList.add('hidden');
  compareRunBtn.disabled = true;
  if (diffEditor) {
    diffEditor.dispose();
    diffEditor = null;
  }
  document.getElementById('diff-container').innerHTML = '';
  autoSaveSession();
}

function closeCompareMode() {
  compareMode = false;
  compareContainer.classList.add('hidden');
  editorContainer.classList.remove('hidden');
  if (diffEditor) {
    diffEditor.dispose();
    diffEditor = null;
  }
  autoSaveSession();
}

async function openCompareFile(side) {
  const result = await window.api.openFile();
  if (!result) return;

  const name = result.filePath.split(/[/\\]/).pop();
  if (side === 'left') {
    compareLeftContent = result.content;
    compareLeftName.textContent = name;
    compareLeftName.title = result.filePath;
  } else {
    compareRightContent = result.content;
    compareRightName.textContent = name;
    compareRightName.title = result.filePath;
  }

  compareRunBtn.disabled = !(compareLeftContent && compareRightContent);
}

function runCompare() {
  if (!compareLeftContent || !compareRightContent) return;

  const container = document.getElementById('diff-container');

  if (diffEditor) {
    diffEditor.dispose();
  }

  const originalModel = monaco.editor.createModel(compareLeftContent, 'plaintext');
  const modifiedModel = monaco.editor.createModel(compareRightContent, 'plaintext');

  diffEditor = monaco.editor.createDiffEditor(container, {
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: true,
    enableSplitViewResizing: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    wordWrap: 'on',
    fontSize: 14,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
  });

  diffEditor.setModel({
    original: originalModel,
    modified: modifiedModel,
  });

  updateCompareSummary(compareLeftContent, compareRightContent);
}

function updateCompareSummary(original, modified) {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  const maxLines = Math.max(originalLines.length, modifiedLines.length);

  let identical = 0;
  let added = 0;
  let removed = 0;
  let modified_count = 0;

  const origSet = new Set(originalLines);
  const modSet = new Set(modifiedLines);

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i];
    const modLine = modifiedLines[i];

    if (origLine === modLine) {
      identical++;
    } else if (origLine === undefined) {
      added++;
    } else if (modLine === undefined) {
      removed++;
    } else {
      modified_count++;
    }
  }

  const total = Math.max(originalLines.length, modifiedLines.length);
  const percent = total > 0 ? Math.round((identical / total) * 100) : 0;

  compareSummary.innerHTML = `
    <span class="summary-item summary-identical">
      <span class="summary-label">Identical:</span>
      <span class="summary-value">${identical} lines</span>
    </span>
    <span class="summary-item summary-added">
      <span class="summary-label">Added:</span>
      <span class="summary-value">${added} lines</span>
    </span>
    <span class="summary-item summary-removed">
      <span class="summary-label">Removed:</span>
      <span class="summary-value">${removed} lines</span>
    </span>
    <span class="summary-item summary-modified">
      <span class="summary-label">Modified:</span>
      <span class="summary-value">${modified_count} lines</span>
    </span>
    <span class="summary-item summary-percent">
      <span class="summary-label">Similarity:</span>
      <span class="summary-value">${percent}%</span>
    </span>
  `;
  compareSummary.classList.remove('hidden');
}

// Compare mode event listeners
document.getElementById('compare-open-left').addEventListener('click', () => openCompareFile('left'));
document.getElementById('compare-open-right').addEventListener('click', () => openCompareFile('right'));
document.getElementById('compare-run').addEventListener('click', runCompare);

// Archive functions
function isArchiveFile(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return ext === 'zip' || ext === 'rar';
}

function isDocumentFile(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return ext === 'docx' || ext === 'pdf' || ext === 'xlsx' || ext === 'xls';
}

async function openDocument(filePath, docType) {
  // Open in dedicated viewer window
  await window.api.openDocumentViewer(filePath, docType);
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function openArchive(archivePath) {
  const result = await window.api.readArchive(archivePath);
  if (result.error) {
    console.error('Failed to read archive:', result.error);
    return;
  }

  currentArchive = { path: archivePath, files: result.files };
  renderArchiveTree(result.files);
  document.getElementById('archive-panel').classList.remove('hidden');
  document.getElementById('archive-name').textContent = archivePath.split(/[/\\]/).pop();
}

function renderArchiveTree(files) {
  const tree = document.getElementById('archive-tree');
  tree.innerHTML = '';

  files.sort((a, b) => {
    const aDir = a.name.includes('/') && !a.name.endsWith('/');
    const bDir = b.name.includes('/') && !b.name.endsWith('/');
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.name.localeCompare(b.name);
  });

  const root = {};
  files.forEach(file => {
    const parts = file.name.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (!node[part]) {
        node[part] = i === parts.length - 1 ? file : {};
      }
      node = node[part];
    });
  });

  function renderNode(node, parentPath, depth) {
    const entries = Object.entries(node).sort(([aName, aVal], [bName, bVal]) => {
      const aIsDir = typeof aVal === 'object' && !aVal.name;
      const bIsDir = typeof bVal === 'object' && !bVal.name;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return aName.localeCompare(bName);
    });

    entries.forEach(([name, value]) => {
      const isDir = typeof value === 'object' && !value.name;
      const item = document.createElement('div');
      item.className = 'archive-item';
      item.style.paddingLeft = (12 + depth * 16) + 'px';

      const icon = isDir ? '\uD83D\uDCC1' : getFileIcon(name);
      const size = !isDir && value.size ? formatFileSize(value.size) : '';
      const fullPath = parentPath ? parentPath + '/' + name : name;

      item.innerHTML =
        '<span class="archive-item-icon">' + icon + '</span>' +
        '<span class="archive-item-name" title="' + fullPath + '">' + name + '</span>' +
        (size ? '<span class="archive-item-size">' + size + '</span>' : '');

      if (!isDir) {
        item.addEventListener('click', () => openArchiveFile(fullPath));
      }

      tree.appendChild(item);

      if (isDir) {
        renderNode(value, fullPath, depth + 1);
      }
    });
  }

  renderNode(root, '', 0);
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    js: '\uD83D\uDCD9', ts: '\uD83D\uDCD9', jsx: '\uD83D\uDCD9', tsx: '\uD83D\uDCD9',
    html: '\uD83C\uDF10', css: '\uD83C\uDFA8', json: '{ }', xml: '\uD83D\uDCF6',
    md: '\uD83D\uDCDD', txt: '\uD83D\uDCC4', log: '\uD83D\uDCCB',
    py: '\uD83D\uDC0D', rb: '\uD83D\uDD38', java: '\u2615', go: '\uD83D\uDC1D', rs: '\uD83E\uDD80',
    png: '\uD83D\uDDBC', jpg: '\uD83D\uDDBC', gif: '\uD83D\uDDBC', svg: '\uD83D\uDDBC',
    zip: '\uD83D\uDCE6', rar: '\uD83D\uDCE6', '7z': '\uD83D\uDCE6',
    pdf: '\uD83D\uDCD5', doc: '\uD83D\uDCC3', xls: '\uD83D\uDCCA',
  };
  return icons[ext] || '\uD83D\uDCC4';
}

async function openArchiveFile(filePath) {
  if (!currentArchive) return;

  const cacheKey = currentArchive.path + ':' + filePath;
  let content = archiveFileContentCache.get(cacheKey);

  if (!content) {
    const result = await window.api.readArchiveFile(currentArchive.path, filePath);
    if (result.error) {
      console.error('Failed to read file from archive:', result.error);
      return;
    }
    content = result.content;
    archiveFileContentCache.set(cacheKey, content);
  }

  const lang = detectLanguage(filePath);
  const displayName = '[' + currentArchive.path.split(/[/\\]/).pop() + '] ' + filePath;

  const existing = tabs.find(function(t) { return t.filePath === cacheKey; });
  if (existing) {
    switchToTab(existing.id);
  } else {
    const id = ++tabCounter;
    tabs.push({
      id: id,
      filePath: cacheKey,
      name: displayName,
      content: content,
      language: lang,
      modified: false,
      viewState: null,
    });
    switchToTab(id);
    updateTabUI();
    autoSaveSession();
  }
}

function closeArchivePanel() {
  currentArchive = null;
  archiveFileContentCache.clear();
  document.getElementById('archive-panel').classList.add('hidden');
}

document.getElementById('archive-close').addEventListener('click', closeArchivePanel);


document.getElementById('compare-close').addEventListener('click', closeCompareMode);
