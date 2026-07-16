let editor;
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let isDarkTheme = true;

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
        const result = await window.api.readFile(path);
        if (result.content !== null) {
          const lang = detectLanguage(path);
          createNewTab(path, result.content, lang);
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
