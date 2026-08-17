// NEO — the source store.
//
// Library-wide, not per-book: the same statute gets cited across chapters and
// across projects. Truth lives in sources/src-<id>/source.json — one small
// readable file per source — and the index is rebuilt by scanning, so there is
// no second copy of the metadata that can drift out of sync.
//
// Kept out of main.js on purpose. This is a fork-only feature and every line
// added to main.js is a merge conflict the next time upstream moves.

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const FAMILIES = ['book', 'document', 'dataset', 'article', 'interview'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function newId() {
  return `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Every field the citation generator could ever need, present from the first
// save. Formatting can be added later; capture cannot be reconstructed later.
function blankSource(family) {
  const now = new Date().toISOString();
  const base = {
    id: newId(),
    family,
    title: '',
    author: '',            // may be an agency or body, not a person
    retrieved: now.slice(0, 10),
    confidential: false,
    // Sources are library-wide so one can serve several books, but they still
    // need to be findable by book. Two kinds of association: this explicit list
    // (gathered for a book, maybe not cited yet) and the usage derived from
    // cards, which is automatic and always true.
    books: [],
    notes: '',
    file: null,            // filename within this source's folder
    sha256: null,
    pageOffset: 0,         // PDF page minus printed page
    created: now,
    modified: now
  };

  const perFamily = {
    book: { publisher: '', year: '', edition: '', printing: '', isbn: '' },
    // A statute is several sources over time. Each version carries its own
    // effective date and its own pinned copy; cards cite one version.
    document: { jurisdiction: '', citation: '', officialUrl: '', versions: [] },
    dataset: {
      tableId: '', vintage: '', query: '', url: '',
      uncertainty: '', uncertaintyUnavailable: false
    },
    article: { publication: '', date: '', url: '', accessed: '', archiveUrl: '', archiveError: '' },
    interview: {
      subjectCodeName: '',   // never the real name — see validate()
      role: '', affiliation: '',
      date: '', durationMin: '', medium: '',
      yourLocation: '', theirLocation: '',   // decides whose consent law applies
      recorded: false, consentTimestamp: '',
      agreedTerms: '', termsChanged: '',
      quotesReadBack: false,
      replySent: '', replyResponse: '',
      audioPath: '', transcriptPath: '',     // references; media lives outside
      confidentialityPromised: false
    }
  };

  return { ...base, [family]: perFamily[family] };
}

function newVersion() {
  return {
    id: `ver-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    effectiveDate: '',   // the date this text became law
    asOf: '',            // the date you retrieved this text
    file: null,
    sha256: null,
    note: ''
  };
}

// ---------------------------------------------------------------------------
// Validation
//
// errors           block the save outright — the record is structurally wrong
// citationBlockers allow the save but make the source uncitable until fixed,
//                  so research isn't interrupted but export can't slip past it
// ---------------------------------------------------------------------------

function validateSource(src) {
  const errors = [];
  const citationBlockers = [];

  if (!src || typeof src !== 'object') return { errors: ['not a source record'], citationBlockers };
  if (!FAMILIES.includes(src.family)) errors.push(`unknown source family "${src.family}"`);
  if (!String(src.title || '').trim()) errors.push('a source needs a title');

  const f = src[src.family] || {};

  if (src.family === 'book') {
    // Page numbers are meaningless without the printing they came from.
    if (!String(f.edition || '').trim()) citationBlockers.push('no edition recorded — page numbers are unverifiable without it');
    if (!String(f.year || '').trim()) citationBlockers.push('no publication year');
  }

  if (src.family === 'document') {
    const versions = Array.isArray(f.versions) ? f.versions : [];
    if (!versions.length) citationBlockers.push('no version recorded — a statute citation needs an as-of date');
    versions.forEach((v, i) => {
      if (!String(v.effectiveDate || '').trim() && !String(v.asOf || '').trim()) {
        errors.push(`version ${i + 1} has neither an effective date nor an as-of date`);
      }
      if (!v.file) citationBlockers.push(`version ${i + 1} has no pinned copy of the text`);
    });
  }

  if (src.family === 'dataset') {
    if (!String(f.tableId || '').trim()) citationBlockers.push('no table identifier');
    if (!String(f.vintage || '').trim()) citationBlockers.push('no vintage — estimates get revised');
    // The margin-of-error trap: county-level survey estimates frequently carry
    // uncertainty large enough to swallow the effect being claimed.
    if (!String(f.uncertainty || '').trim() && !f.uncertaintyUnavailable) {
      citationBlockers.push('no uncertainty recorded — set it, or explicitly mark it unavailable');
    }
  }

  if (src.family === 'article') {
    if (String(f.url || '').trim()) {
      if (!String(f.accessed || '').trim()) citationBlockers.push('no accessed date');
      if (!String(f.archiveUrl || '').trim()) citationBlockers.push('no archived snapshot — the link will rot');
    }
  }

  if (src.family === 'interview') {
    if (!String(f.subjectCodeName || '').trim()) errors.push('an interview needs a subject name or code name');
    // Defensive: real identities live outside NEO by design. If something
    // upstream ever tries to persist one, refuse rather than write it to disk.
    if (Object.prototype.hasOwnProperty.call(f, 'realName')) {
      errors.push('real identities are never stored in NEO — use a code name');
    }
    if (!String(f.date || '').trim()) citationBlockers.push('no interview date');
    if (f.recorded && !String(f.consentTimestamp || '').trim()) {
      citationBlockers.push('recorded, but no on-tape consent timestamp');
    }
    if (!String(f.agreedTerms || '').trim()) {
      citationBlockers.push('no agreed terms recorded — on record / background / not for attribution');
    }
  }

  return { errors, citationBlockers };
}

// ---------------------------------------------------------------------------
// Archiving
//
// The one place NEO reaches the network, and only for public web sources.
// Failure is never fatal: the source saves, stays uncitable, and can retry.
// ---------------------------------------------------------------------------

function requestArchive(url) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve({ error: 'not a valid URL' });
    }
    if (!/^https?:$/.test(target.protocol)) return resolve({ error: 'only http and https can be archived' });

    const req = https.request(
      {
        host: 'web.archive.org',
        path: '/save/' + target.href,
        method: 'GET',
        timeout: 30000,
        headers: { 'User-Agent': 'NEO (research citation archiver)' }
      },
      (res) => {
        const loc = res.headers['content-location'] || res.headers.location || '';
        res.resume(); // drain; we only need the header
        if (loc.startsWith('/web/')) return resolve({ url: 'https://web.archive.org' + loc });
        if (/^https?:\/\/web\.archive\.org\/web\//.test(loc)) return resolve({ url: loc });
        resolve({ error: `no snapshot returned (HTTP ${res.statusCode})` });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ error: 'archive request timed out' }); });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Documents carry their text inside a container NEO can't read. Two extractors:
// macOS ships textutil for word-processor formats, and PDF.js handles PDFs —
// the same library that will drive reading mode. A plain-text sidecar costs
// nothing and makes a document searchable and quotable instead of merely stored.

async function pdfText(file, maxPages) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
  const last = Math.min(doc.numPages, maxPages || doc.numPages);
  const pages = [];
  for (let i = 1; i <= last; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map((it) => it.str).join(' '));
  }
  return { text: pages.join('\n\n'), pages: doc.numPages };
}

function textutilText(file, out) {
  return new Promise((resolve) => {
    execFile('textutil', ['-convert', 'txt', '-output', out, file], { timeout: 30000 }, (err) => {
      resolve(!err && fs.existsSync(out));
    });
  });
}

async function extractText(file) {
  const out = file.replace(/\.[^.]+$/, '') + '.extracted.txt';
  try {
    if (/\.pdf$/i.test(file)) {
      const { text } = await pdfText(file);
      if (!text.trim()) return null;        // a scan with no text layer — OCR territory
      fs.writeFileSync(out, text);
      return path.basename(out);
    }
    if (process.platform === 'darwin' && /\.(rtf|rtfd|doc|docx|odt|html?|wordml)$/i.test(file)) {
      return (await textutilText(file, out)) ? path.basename(out) : null;
    }
  } catch {
    return null;   // extraction is a convenience; never fail an attach over it
  }
  return null;
}

function registerSources({ ipcMain, dialog, shell, libraryDir, readJSON, writeJSON, logError }) {
  const SOURCES_DIR = () => path.join(libraryDir, 'sources');
  const srcDir = (id) => path.join(SOURCES_DIR(), id);
  const srcFile = (id) => path.join(srcDir(id), 'source.json');

  function ensureSources() {
    const dir = SOURCES_DIR();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }

  function listSources() {
    const dir = ensureSources();
    return fs.readdirSync(dir)
      .filter((name) => name.startsWith('src-'))
      .map((name) => readJSON(path.join(dir, name, 'source.json'), null))
      .filter(Boolean)
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
  }

  ipcMain.handle('sources:list', () => {
    try {
      return listSources();
    } catch (err) {
      logError('sources', err);
      return [];
    }
  });

  ipcMain.handle('sources:blank', (_e, family) => blankSource(FAMILIES.includes(family) ? family : 'book'));

  // Which books actually use which sources. Derived from the cards rather than
  // recorded, so it can't drift out of date and needs no upkeep.
  ipcMain.handle('sources:usage', () => {
    const out = { books: [], bySource: {} };
    try {
      const lib = readJSON(path.join(libraryDir, 'library.json'), null);
      const ids = (lib && lib.shelves ? lib.shelves : []).flatMap((sh) => sh.bookIds || []);
      for (const bookId of ids) {
        const meta = readJSON(path.join(libraryDir, bookId, 'book.json'), null);
        if (!meta) continue;
        out.books.push({ id: bookId, title: meta.title || 'Untitled' });

        const cards = readJSON(path.join(libraryDir, bookId, 'cards.json'), []) || [];
        const counts = {};
        for (const c of cards) if (c.sourceId) counts[c.sourceId] = (counts[c.sourceId] || 0) + 1;
        for (const [srcId, n] of Object.entries(counts)) {
          (out.bySource[srcId] = out.bySource[srcId] || []).push({ bookId, title: meta.title, cards: n });
        }
      }
    } catch (err) {
      logError('sources', err);
    }
    return out;
  });

  ipcMain.handle('sources:blankVersion', () => newVersion());

  ipcMain.handle('sources:read', (_e, id) => readJSON(srcFile(id), null));

  ipcMain.handle('sources:validate', (_e, src) => validateSource(src));

  ipcMain.handle('sources:save', (_e, src) => {
    const check = validateSource(src);
    if (check.errors.length) return { ok: false, ...check };
    try {
      ensureSources();
      const id = src.id || newId();
      const dir = srcDir(id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const record = { ...src, id, modified: new Date().toISOString() };
      writeJSON(srcFile(id), record);
      return { ok: true, source: record, ...check };
    } catch (err) {
      logError('sources', err);
      return { ok: false, errors: [err.message], citationBlockers: [] };
    }
  });

  ipcMain.handle('sources:delete', async (_e, id) => {
    try {
      await shell.trashItem(srcDir(id)); // recoverable — never a hard delete
      return true;
    } catch (err) {
      logError('sources', err);
      return false;
    }
  });

  // Copy a file into the source's own folder and fingerprint it. The pinned
  // copy is the citation: official sites reorganize and statutes get amended.
  ipcMain.handle('sources:attach', async (_e, id, versionId) => {
    const picked = await dialog.showOpenDialog({
      title: 'Attach a source document',
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'rtf', 'doc', 'docx', 'txt', 'md', 'html', 'epub', 'csv', 'xlsx'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (picked.canceled || !picked.filePaths.length) return null;

    try {
      const from = picked.filePaths[0];
      const dir = srcDir(id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Version files sit beside the primary copy under a distinct name so a
      // document source can hold the 2005 text and the 2019 text at once.
      const base = path.basename(from);
      const name = versionId ? `${versionId}-${base}` : base;
      const dest = path.join(dir, name);
      fs.copyFileSync(from, dest);

      // The fingerprint is always of the original you attached, never of the
      // extracted text — the pinned copy is what the citation rests on.
      return {
        file: name,
        sha256: sha256(dest),
        textFile: await extractText(dest)
      };
    } catch (err) {
      logError('sources', err);
      return null;
    }
  });

  ipcMain.handle('sources:archive', async (_e, url) => requestArchive(url));

  ipcMain.handle('sources:reveal', (_e, id) => {
    try {
      shell.showItemInFolder(srcFile(id));
      return true;
    } catch (err) {
      logError('sources', err);
      return false;
    }
  });
}

module.exports = { registerSources, validateSource, blankSource, newVersion, extractText, pdfText, FAMILIES };
