// NEO — main process
// Owns the window and all file-system access. The renderer talks to this
// through the IPC handlers below (see preload.js for the exposed API).

const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// Library location: a folder of plain files the user can inspect, sync, back up.
// ---------------------------------------------------------------------------
const LIBRARY_DIR = path.join(os.homedir(), 'Documents', 'NEO Library');
const LIBRARY_FILE = path.join(LIBRARY_DIR, 'library.json');

function ensureLibrary() {
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  if (!fs.existsSync(LIBRARY_FILE)) {
    const seed = {
      authorName: '',
      penNames: [],
      firstRunDone: false,
      shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
    };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(seed, null, 2));
  }
}

function bookDir(bookId) {
  return path.join(LIBRARY_DIR, bookId);
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomic-ish: never leave a half-written file
}

// ---------------------------------------------------------------------------
// IPC — the renderer's whole view of the disk
// ---------------------------------------------------------------------------

ipcMain.handle('library:read', () => {
  ensureLibrary();
  return readJSON(LIBRARY_FILE, null);
});

// A real cover image, replacing the generated gradient. Copied into the book's
// own folder so the book stays self-contained and travels with its jacket.
ipcMain.handle('book:setCover', async (_e, bookId) => {
  const picked = await dialog.showOpenDialog({
    title: 'Choose a cover image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic'] }]
  });
  if (picked.canceled || !picked.filePaths.length) return null;
  try {
    const from = picked.filePaths[0];
    const ext = path.extname(from).toLowerCase().replace('.', '') || 'jpg';
    const name = `cover.${ext}`;
    fs.copyFileSync(from, path.join(bookDir(bookId), name));
    return name;
  } catch (err) {
    logError('cover', err);
    return null;
  }
});

ipcMain.handle('book:coverPath', (_e, bookId, file) =>
  file ? path.join(bookDir(bookId), file) : null);

ipcMain.handle('library:write', (_e, data) => {
  ensureLibrary();
  writeJSON(LIBRARY_FILE, data);
  return true;
});

// A book is a folder: book.json + chapters/*.html + notes.html + outline.html + darlings.json
ipcMain.handle('book:create', (_e, meta) => {
  ensureLibrary();
  const id = 'book-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const dir = bookDir(id);
  fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
  const book = {
    id,
    title: meta.title || 'Untitled',
    subtitle: '',
    series: '',
    author: meta.author || 'Anonymous',
    wordGoal: 0,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    chapterOrder: [],
    tabNames: { notes: 'Notes', outline: 'Outline' }
  };
  writeJSON(path.join(dir, 'book.json'), book);
  fs.writeFileSync(path.join(dir, 'notes.html'), '');
  fs.writeFileSync(path.join(dir, 'outline.html'), '');
  writeJSON(path.join(dir, 'darlings.json'), []);
  writeJSON(path.join(dir, 'stickies.json'), []);
  return book;
});

ipcMain.handle('book:readMeta', (_e, bookId) => {
  return readJSON(path.join(bookDir(bookId), 'book.json'), null);
});

ipcMain.handle('book:writeMeta', (_e, bookId, meta) => {
  meta.modified = new Date().toISOString();
  writeJSON(path.join(bookDir(bookId), 'book.json'), meta);
  return true;
});

ipcMain.handle('chapter:read', (_e, bookId, chapterId) => {
  const file = path.join(bookDir(bookId), 'chapters', chapterId + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('chapter:write', (_e, bookId, chapterId, html) => {
  const dir = path.join(bookDir(bookId), 'chapters');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, chapterId + '.html'), html);
  return true;
});

ipcMain.handle('chapter:delete', (_e, bookId, chapterId) => {
  const file = path.join(bookDir(bookId), 'chapters', chapterId + '.html');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
});

ipcMain.handle('aux:read', (_e, bookId, name) => {
  // name: 'notes' | 'outline'
  const file = path.join(bookDir(bookId), name + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('aux:write', (_e, bookId, name, html) => {
  fs.writeFileSync(path.join(bookDir(bookId), name + '.html'), html);
  return true;
});

ipcMain.handle('json:read', (_e, bookId, name, fallback) => {
  return readJSON(path.join(bookDir(bookId), name + '.json'), fallback);
});

ipcMain.handle('json:write', (_e, bookId, name, data) => {
  writeJSON(path.join(bookDir(bookId), name + '.json'), data);
  return true;
});

ipcMain.handle('book:delete', async (_e, bookId, title) => {
  const win = BrowserWindow.getFocusedWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancel', 'Move to Trash'],
    defaultId: 0,
    cancelId: 0,
    message: `Move “${title}” to the Trash?`,
    detail: 'The book folder will go to your Mac Trash, so you can recover it.'
  });
  if (response === 1) {
    const { shell } = require('electron');
    await shell.trashItem(bookDir(bookId));
    return true;
  }
  return false;
});

ipcMain.handle('library:path', () => LIBRARY_DIR);

// ---------------------------------------------------------------------------
// Fullscreen + The Silo
// ---------------------------------------------------------------------------

// The Silo means it: kiosk mode (no Dock, no menu bar, no hover-reveal)
// plus always-on-top at screen-saver level across every workspace — so even
// app-switching leaves NEO covering the screen. The typed prompt is the way out.
ipcMain.handle('silo:set', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  win.__silo = on;
  if (on) {
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setKiosk(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.focus();
  } else {
    win.setAlwaysOnTop(false);
    win.setKiosk(false);
  }
  return true;
});

// Regular fullscreen: Esc walks you out like any civilized app
ipcMain.handle('fullscreen:escape', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win.isFullScreen()) {
    win.setFullScreen(false);
    return true;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Export + email
// ---------------------------------------------------------------------------

async function renderPDF(html) {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await pdfWin.webContents.printToPDF({
      pageSize: 'Letter',
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
      printBackground: false
    });
  } finally {
    pdfWin.destroy();
  }
}

// zipEntries: [{path, content, base64?, store?}] — order matters (EPUB mimetype first)
async function buildZip(zipEntries) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  for (const e of zipEntries) {
    zip.file(e.path, e.base64 ? Buffer.from(e.content, 'base64') : e.content, {
      compression: e.store ? 'STORE' : 'DEFLATE'
    });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/epub+zip'
  });
}

ipcMain.handle('export:save', async (_e, { format, defaultName, content, zipEntries }) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(os.homedir(), 'Documents', defaultName + '.' + format),
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  });
  if (canceled || !filePath) return null;
  if (zipEntries) {
    fs.writeFileSync(filePath, await buildZip(zipEntries));
  } else if (format === 'pdf') {
    fs.writeFileSync(filePath, await renderPDF(content));
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return filePath;
});

// Writes a timestamped snapshot to the library's Exports folder, then hands it
// to your email — an outside-the-machine paper trail for provenance.
ipcMain.handle('email:draft', async (_e, { to, subject, body, html, defaultName, method }) => {
  const { shell } = require('electron');
  const exportsDir = path.join(LIBRARY_DIR, 'Exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(exportsDir, `${defaultName}-${stamp}.pdf`);
  fs.writeFileSync(file, await renderPDF(html));

  if (method === 'gmail') {
    // Gmail compose in the browser can't take an attachment from outside,
    // so open the draft pre-filled and reveal the PDF right next to it to drag in.
    const url = 'https://mail.google.com/mail/?view=cm&fs=1'
      + '&to=' + encodeURIComponent(to)
      + '&su=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
    await shell.openExternal(url);
    shell.showItemInFolder(file);
    return { ok: true, method: 'gmail', file };
  }

  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
    tell application "Mail"
      set msg to make new outgoing message with properties {subject:"${esc(subject)}", content:"${esc(body)}" & return & return, visible:true}
      tell msg to make new to recipient at end of to recipients with properties {address:"${esc(to)}"}
      tell msg to make new attachment with properties {file name:(POSIX file "${esc(file)}")} at after the last paragraph of content
      activate
    end tell`;
  return new Promise((resolve) => {
    require('child_process').execFile('osascript', ['-e', script], (err) => {
      if (err) {
        // Mail not available — at least reveal the snapshot we saved
        shell.showItemInFolder(file);
        resolve({ ok: false, file });
      } else {
        resolve({ ok: true, method: 'mail', file });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Import: .docx / .txt / .md → chapters
// ---------------------------------------------------------------------------

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

async function importFile(fp) {
  const name = path.basename(fp).replace(/\.[^.]+$/, '');
  const ext = path.extname(fp).toLowerCase();
  let paras = [];

  if (ext === '.docx') {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(fp));
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Not a valid .docx: ' + fp);
    const xml = await docFile.async('string');
    paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
      const p = m[0];
      // <w:t> is a text run; <w:tab> is a tab stop. `<w:t[^>]*>` matches both,
      // and then captures everything up to the next </w:t> — dragging raw XML
      // into the manuscript. Require a space or the closing bracket right
      // after w:t so only real text runs match.
      const text = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((t) => decodeEntities(t[1])).join('');
      const pageBreak = /<w:br [^>]*w:type="page"/.test(p) || /<w:pageBreakBefore/.test(p);
      return { text: text.trim(), pageBreak };
    });
  } else if (ext === '.rtf' || ext === '.doc' || ext === '.odt' || ext === '.pdf') {
    // Formats NEO couldn't read before. PDFs and word-processor files go
    // through the same extractors the source library uses.
    const tmp = path.join(app.getPath('temp'), `neo-import-${Date.now()}${ext}`);
    fs.copyFileSync(fp, tmp);
    const { extractText } = require('./sources');
    const outName = await extractText(tmp);
    if (!outName) {
      throw new Error(`Couldn't read any text out of ${path.basename(fp)}. If it's a scan, it needs OCR first.`);
    }
    const raw = fs.readFileSync(path.join(path.dirname(tmp), outName), 'utf8');
    paras = raw.split(/\r?\n\s*\r?\n/)
      .map((b) => ({ text: b.replace(/\s*\r?\n\s*/g, ' ').trim(), pageBreak: false }))
      .filter((p) => p.text);
  } else {
    const raw = fs.readFileSync(fp, 'utf8');
    paras = raw.split(/\r?\n\s*\r?\n/)
      .map((b) => ({ text: b.replace(/\s*\r?\n\s*/g, ' ').trim(), pageBreak: false }))
      .filter((p) => p.text);
  }

  // Strip Word field instructions from every path — they leak through
  // textutil, some .docx exporters, and most PDF extractions.
  const { stripFieldCodes } = require('./sources');
  paras = paras.map((p) => ({ ...p, text: stripFieldCodes(p.text).trim() }));

  // Fail loudly. Silently producing an empty book is worse than an error:
  // it looks like the import worked and the document was blank.
  if (!paras.some((p) => p.text && p.text.trim())) {
    throw new Error(
      `${path.basename(fp)} opened, but no text came out of it. ` +
      `If it was exported from Pages or another app, try exporting again as .docx or .pdf.`
    );
  }

  // Chapterize: page breaks and "Chapter N"-style headings start new chapters,
  // lines of asterisks become scene breaks.
  const isHeading = (t) => /^(chapter|prologue|epilogue|part)\b/i.test(t) && t.length < 60;
  const isBreak = (t) => /^([*#•~]\s*){1,7}$/.test(t);
  const chapters = [];
  let cur = [];
  for (const p of paras) {
    if (!p.text && !p.pageBreak) continue;
    if ((p.pageBreak || isHeading(p.text)) && cur.length) {
      chapters.push(cur);
      cur = [];
    }
    if (isHeading(p.text)) continue; // the heading line itself becomes the chapter head
    if (isBreak(p.text)) { cur.push({ scene: true }); continue; }
    if (p.text) cur.push({ text: p.text });
  }
  if (cur.length) chapters.push(cur);
  if (!chapters.length) chapters.push([{ text: '' }]);
  return { name, chapters };
}

ipcMain.handle('import:pick', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Bring your manuscripts home',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Manuscripts', extensions: ['docx', 'doc', 'rtf', 'odt', 'pdf', 'txt', 'md'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths.length) return [];
  const out = [];
  for (const fp of filePaths) {
    try {
      out.push(await importFile(fp));
    } catch (err) {
      logError('import', err);
      out.push({ name: path.basename(fp), error: String(err.message || err) });
    }
  }
  return out;
});

// ---------------------------------------------------------------------------
// Robustness: error log, daily backups, single instance
// ---------------------------------------------------------------------------
const ERROR_LOG = () => path.join(LIBRARY_DIR, 'neo-errors.log');

function logError(source, err) {
  try {
    ensureLibrary();
    const line = `[${new Date().toISOString()}] [${source}] ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(ERROR_LOG(), line);
  } catch { /* never let logging crash the app */ }
}

process.on('uncaughtException', (err) => logError('main', err));
process.on('unhandledRejection', (err) => logError('main-promise', err));
ipcMain.handle('log:error', (_e, msg) => logError('renderer', msg));

// One zip of the whole library per day, keeping the last 14. Cheap insurance.
// ---------------------------------------------------------------------------
// Authorship snapshots
//
// A dated, fingerprinted record that the manuscript accumulated over months.
// This is the answer to an authorship challenge that a promise can never be:
// here is the chapter at fourteen points across a year, each with the SHA-256
// of its text at that moment. Weekly, automatic, and it never overwrites.
// ---------------------------------------------------------------------------

function weeklySnapshot() {
  try {
    ensureLibrary();
    const dir = path.join(LIBRARY_DIR, 'Snapshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const week = (() => {
      const d = new Date();
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const n = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${String(n).padStart(2, '0')}`;
    })();

    const target = path.join(dir, `snapshot-${week}.json`);
    if (fs.existsSync(target)) return;   // one per week, never overwritten

    const crypto = require('crypto');
    const books = [];
    for (const name of fs.readdirSync(LIBRARY_DIR)) {
      if (!name.startsWith('book-')) continue;
      const meta = readJSON(path.join(LIBRARY_DIR, name, 'book.json'), null);
      if (!meta) continue;

      const chapters = [];
      let words = 0;
      for (const chId of (meta.chapterOrder || [])) {
        let html = '';
        try { html = fs.readFileSync(path.join(LIBRARY_DIR, name, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
        const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        const n = text ? text.split(' ').length : 0;
        words += n;
        chapters.push({
          id: chId,
          title: (meta.chapterTitles && meta.chapterTitles[chId]) || '',
          words: n,
          // The fingerprint is of the TEXT, not the HTML: reformatting the
          // page must not look like the words changed.
          sha256: crypto.createHash('sha256').update(text).digest('hex')
        });
      }
      books.push({ id: name, title: meta.title || 'Untitled', words, chapters });
    }

    writeJSON(target, { taken: new Date().toISOString(), week, books });
  } catch (err) {
    logError('snapshot', err);
  }
}

// Newest mtime anywhere in the library, ignoring the backups themselves.
// Used to decide whether today's zip is stale rather than merely present.
function libraryTouchedAt(dir, rel = '') {
  let newest = 0;
  for (const name of fs.readdirSync(dir)) {
    if (rel === '' && (name === 'Backups' || name === 'Exports')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    newest = Math.max(newest, stat.isDirectory() ? libraryTouchedAt(full, rel + '/' + name) : stat.mtimeMs);
  }
  return newest;
}

async function dailyBackup() {
  try {
    ensureLibrary();
    const backupsDir = path.join(LIBRARY_DIR, 'Backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(backupsDir, `neo-backup-${today}.zip`);

    // Rewrite today's zip whenever the library has moved on since it was
    // written. The old check skipped on existence alone, so a backup taken
    // before a day's writing stayed empty until the next day.
    if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= libraryTouchedAt(LIBRARY_DIR)) return;

    const JSZip = require('jszip');
    const zip = new JSZip();
    const skip = new Set(['Backups', 'Exports']);
    const walk = (dir, rel) => {
      for (const name of fs.readdirSync(dir)) {
        if (rel === '' && skip.has(name)) continue;
        const full = path.join(dir, name);
        const relPath = rel ? rel + '/' + name : name;
        const stat = fs.statSync(full);
        // Source records are small and precious; the pinned PDFs beside them
        // are neither, and would churn gigabytes through every backup.
        if (relPath.startsWith('sources/') && !stat.isDirectory() && !name.endsWith('.json')) continue;
        if (stat.isDirectory()) walk(full, relPath);
        else zip.file(relPath, fs.readFileSync(full));
      }
    };
    walk(LIBRARY_DIR, '');
    fs.writeFileSync(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

    // Off-machine copy. iCloud belongs on the backups, never on the live
    // library — an editor rewriting files every few seconds turns every save
    // into a sync operation and the whole app goes sluggish.
    try {
      const cloud = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'NEO Backups');
      if (fs.existsSync(path.dirname(cloud))) {
        if (!fs.existsSync(cloud)) fs.mkdirSync(cloud, { recursive: true });
        fs.copyFileSync(target, path.join(cloud, path.basename(target)));
        const off = fs.readdirSync(cloud).filter((f) => f.startsWith('neo-backup-')).sort();
        while (off.length > 30) fs.unlinkSync(path.join(cloud, off.shift()));
      }
    } catch (err) {
      logError('backup', err);   // never let the off-machine copy break the local one
    }

    // prune old backups
    const backups = fs.readdirSync(backupsDir).filter((f) => f.startsWith('neo-backup-')).sort();
    while (backups.length > 14) fs.unlinkSync(path.join(backupsDir, backups.shift()));
  } catch (err) {
    logError('backup', err);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#191919',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The engine is available, but every editable element starts with
      // spellcheck="false" — NEO never nags. A spellcheck pass is a
      // deliberate act (Edit → Spellcheck Pass), not a klaxon.
      spellcheck: true
    }
  });
  win.loadFile('index.html');

  // The Silo holds the door: if focus escapes (⌘Tab), pull it straight back.
  win.on('blur', () => {
    if (!win.__silo || win.isDestroyed()) return;
    setTimeout(() => {
      if (win.__silo && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    }, 60);
  });

  // Right-click suggestions during a spellcheck pass
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.misspelledWord) return;
    const menu = new Menu();
    for (const s of (params.dictionarySuggestions || []).slice(0, 6)) {
      menu.append(new MenuItem({ label: s, click: () => win.webContents.replaceMisspelling(s) }));
    }
    if (params.dictionarySuggestions && params.dictionarySuggestions.length) {
      menu.append(new MenuItem({ type: 'separator' }));
    }
    menu.append(new MenuItem({
      label: `Add “${params.misspelledWord}” to Dictionary`,
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
    }));
    menu.popup();
  });
}

// ---------------------------------------------------------------------------
// Application menu — Help and Format live here, out of the writing room
// ---------------------------------------------------------------------------
function sendToWindow(msg) {
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (w) w.webContents.send('menu', msg);
}

function buildMenu() {
  const bodyFonts = ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style'];
  const template = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'Export',
          submenu: [
            { label: 'Plain Text (.txt)', click: () => sendToWindow({ type: 'export', format: 'txt' }) },
            { label: 'Markdown (.md)', click: () => sendToWindow({ type: 'export', format: 'md' }) },
            { label: 'Web Page (.html)', click: () => sendToWindow({ type: 'export', format: 'html' }) },
            { label: 'PDF (.pdf)', click: () => sendToWindow({ type: 'export', format: 'pdf' }) },
            { label: 'Word (.docx)', click: () => sendToWindow({ type: 'export', format: 'docx' }) },
            { label: 'EPUB (.epub)', click: () => sendToWindow({ type: 'export', format: 'epub' }) }
          ]
        },
        { type: 'separator' },
        {
          label: 'Email Draft to Myself',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToWindow({ type: 'emailDraft' })
        },
        { label: 'Email Settings…', click: () => sendToWindow({ type: 'emailSettings' }) },
        {
          label: 'Goals & Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToWindow({ type: 'stats' })
        },
        { type: 'separator' },
        {
          label: 'Import Manuscripts…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => sendToWindow({ type: 'import' })
        },
        {
          label: 'Set Book Cover…',
          click: () => sendToWindow({ type: 'setCover' })
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find & Replace',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToWindow({ type: 'find' })
        },
        {
          label: 'Spellcheck Pass',
          accelerator: 'CmdOrCtrl+;',
          click: () => sendToWindow({ type: 'spellcheck' })
        }
      ]
    },
    {
      label: 'Research',
      submenu: [
        {
          label: 'Read a Source…',
          accelerator: 'CmdOrCtrl+Shift+O',   // Shift+D is Darlings
          click: () => sendToWindow({ type: 'readSource' })
        },
        {
          label: 'Insert Card…',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => sendToWindow({ type: 'insertCard' })
        },
        {
          label: 'Card Board…',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => sendToWindow({ type: 'board' })
        },
        {
          label: 'Find the Structure…',
          click: () => sendToWindow({ type: 'findStructure' })
        },
        {
          label: 'Import Bibliography…',
          click: () => sendToWindow({ type: 'importBib' })
        },
        {
          label: 'Sources…',
          accelerator: 'CmdOrCtrl+Shift+R',   // ⌘⇧S is the Silo
          click: () => sendToWindow({ type: 'sources' })
        },
        { type: 'separator' },
        {
          label: 'Check My Prose…',
          click: () => sendToWindow({ type: 'proseCheck' })
        },
        {
          label: 'Fact-Check Dossier…',
          click: () => sendToWindow({ type: 'dossier' })
        },
        {
          label: "What's Missing…",
          click: () => sendToWindow({ type: 'gaps' })
        },
        {
          label: 'Rigor Audit…',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => sendToWindow({ type: 'audit' })
        }
      ]
    },
    {
      label: 'Format',
      submenu: [
        {
          label: 'Body Font',
          submenu: bodyFonts.map((f) => ({
            label: f,
            click: () => sendToWindow({ type: 'bodyFont', value: f })
          }))
        },
        {
          label: 'Drop Cap Style',
          submenu: [
            { label: 'Literary', click: () => sendToWindow({ type: 'dropCap', value: 'literary' }) },
            { label: 'Fantasy', click: () => sendToWindow({ type: 'dropCap', value: 'fantasy' }) },
            { label: 'Sci-Fi', click: () => sendToWindow({ type: 'dropCap', value: 'scifi' }) }
          ]
        },
        {
          label: 'Page',
          submenu: [
            { label: 'Paper', click: () => sendToWindow({ type: 'pageTheme', value: 'paper' }) },
            { label: 'Night', click: () => sendToWindow({ type: 'pageTheme', value: 'night' }) }
          ]
        },
        { type: 'separator' },
        {
          label: 'Verse Mode (this book)',
          click: () => sendToWindow({ type: 'verseMode' })
        },
        { type: 'separator' },
        { label: 'Larger Text', accelerator: 'CmdOrCtrl+=', click: () => sendToWindow({ type: 'fontSize', value: 1 }) },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', click: () => sendToWindow({ type: 'fontSize', value: -1 }) },
        { label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', click: () => sendToWindow({ type: 'fontSize', value: 0 }) },
        { type: 'separator' },
        {
          label: 'Typewriter Scrolling',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => sendToWindow({ type: 'typewriter' })
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Full Screen',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            const w = BrowserWindow.getFocusedWindow();
            if (w && !w.isSimpleFullScreen()) w.setFullScreen(!w.isFullScreen());
          }
        },
        {
          label: 'The Silo',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToWindow({ type: 'silo' })
        }
      ]
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'NEO Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => sendToWindow({ type: 'help' })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Two copies of NEO editing the same library is how words get eaten
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Auto-update from GitHub releases. Deliberately defensive: any failure is
// logged and swallowed, so an unsigned build or offline machine never notices.
// (macOS auto-update only works once the app is code-signed.)
function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = null;
    autoUpdater.on('error', (err) => logError('updater', err));
    autoUpdater.checkForUpdatesAndNotify().catch((err) => logError('updater', err));
  } catch (err) {
    logError('updater', err);
  }
}

// Research lives in its own modules — see sources.js for why.
require('./cards').registerCards({ ipcMain, libraryDir: LIBRARY_DIR, readJSON, writeJSON, logError });

require('./citations').registerCitations({ ipcMain, libraryDir: LIBRARY_DIR, readJSON, logError });

require('./ai').registerAI({
  ipcMain,
  app,
  safeStorage: require('electron').safeStorage,
  libraryDir: LIBRARY_DIR,
  readJSON,
  logError
});

require('./sources').registerSources({
  ipcMain,
  dialog,
  shell: require('electron').shell,
  libraryDir: LIBRARY_DIR,
  readJSON,
  writeJSON,
  logError
});

app.whenReady().then(() => {
  // macOS press-and-hold accent picker can open invisibly inside Chromium
  // and re-emit swallowed keys as phantom repeated letters. Within NEO,
  // held keys simply repeat — which is what writers expect anyway.
  if (process.platform === 'darwin') {
    try {
      const { systemPreferences } = require('electron');
      systemPreferences.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false);
    } catch (err) {
      logError('prefs', err);
    }
  }
  ensureLibrary();
  buildMenu();
  createWindow();
  dailyBackup();
  weeklySnapshot();
  // A day's writing shouldn't ride on one backup taken at launch.
  setInterval(dailyBackup, 2 * 60 * 60 * 1000);
  setInterval(weeklySnapshot, 6 * 60 * 60 * 1000);   // catches a week rolling over mid-session
  checkForUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Back up on the way out, so the last session's work is captured even if the
// app is only ever opened and closed within a single day. Bounded so a slow or
// stuck backup can never trap the user in an app that won't quit.
let quitBackupDone = false;
app.on('before-quit', (e) => {
  if (quitBackupDone) return;
  e.preventDefault();
  const bounded = Promise.race([
    dailyBackup(),
    new Promise((resolve) => setTimeout(resolve, 8000))
  ]);
  bounded.catch((err) => logError('backup', err)).finally(() => {
    quitBackupDone = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
