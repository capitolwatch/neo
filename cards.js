// NEO — the card store.
//
// Cards are per-book (sources are library-wide), stored alongside darlings and
// stickies as one readable cards.json. Five types, and the distinctions are
// load-bearing: they decide what happens when a card becomes manuscript text.
//
// The immutability rule lives here rather than in the UI. A quote whose text
// can be edited months after capture is how nonfiction quietly stops matching
// the page it cites, so the storage layer refuses the edit outright.

const fs = require('fs');
const path = require('path');

const TYPES = ['quote', 'paraphrase', 'theme', 'derived', 'interview'];

// Theme cards are your own synthesis and legitimately have no source.
const NEEDS_SOURCE = new Set(['quote', 'paraphrase', 'interview']);

function newId() {
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankCard(type) {
  const now = new Date().toISOString();
  return {
    id: newId(),
    type: TYPES.includes(type) ? type : 'quote',
    sourceId: '',
    versionId: '',      // which version of a statute this came from
    locator: '',        // page / section / table id / recording timestamp
    // Two text fields on purpose. draftText is what you wrote on the index
    // card — your transcription, always editable, never citable. text is the
    // verbatim passage captured from the source itself, and locks once set.
    draftText: '',
    text: '',
    verified: false,    // has text been captured against the original?
    textLocked: false,  // set when a quote is verified; never unset
    note: '',           // your commentary, always editable
    tags: [],
    inputs: [],         // derived figures: the cards this was computed from
    method: '',
    result: '',
    // Arrangement. A card sits in exactly one theme — the constraint is the
    // point, the same way an index card can only be in one pile. Position is
    // argument order within that theme.
    themeId: '',
    position: 0,
    chapterId: '',      // set when the card is placed in the manuscript
    created: now,
    modified: now
  };
}

// ---------------------------------------------------------------------------
// Validation
//
// errors           block the save
// citationBlockers save fine, but the card can't be cited or exported yet
// ---------------------------------------------------------------------------

function validateCard(card, source, existing) {
  const errors = [];
  const citationBlockers = [];

  if (!card || typeof card !== 'object') return { errors: ['not a card'], citationBlockers };
  if (!TYPES.includes(card.type)) errors.push(`unknown card type "${card.type}"`);

  if (NEEDS_SOURCE.has(card.type) && !String(card.sourceId || '').trim()) {
    errors.push('this card needs a source — only theme cards stand alone');
  }
  if (NEEDS_SOURCE.has(card.type) && card.sourceId && !source) {
    errors.push('the source this card points at no longer exists');
  }

  if (card.type === 'quote' || card.type === 'interview') {
    // Something has to be here — but a transcription off an index card counts
    // for saving, since the whole point is to get the pile into the system.
    if (!String(card.text || '').trim() && !String(card.draftText || '').trim()) {
      errors.push('a quote needs either its captured text or what your note says');
    }
    if (!card.verified || !String(card.text || '').trim()) {
      citationBlockers.push('not yet verified against the source — open it and capture the exact words');
    }
  }

  // The rule everything else rests on: captured text is what the page says.
  // Elide with an ellipsis, bracket an insertion, or make it a paraphrase —
  // but never quietly reword it.
  if (existing && existing.textLocked && existing.type === 'quote') {
    if (String(card.text || '') !== String(existing.text || '')) {
      errors.push('captured quote text cannot be edited — elide, bracket, or convert to a paraphrase');
    }
  }

  if (card.type === 'derived') {
    if (!String(card.method || '').trim()) errors.push('a derived figure needs its method — how did you get this number?');
    if (!Array.isArray(card.inputs) || !card.inputs.length) errors.push('a derived figure needs the cards it was computed from');
    if (!String(card.result || '').trim()) citationBlockers.push('no result recorded');
  }

  if (card.type !== 'theme' && !String(card.locator || '').trim()) {
    citationBlockers.push('no locator — page, section, table, or timestamp');
  }

  // A statute source is several sources over time; a card has to say which.
  if (source && source.family === 'document') {
    const versions = (source.document && source.document.versions) || [];
    if (versions.length && !String(card.versionId || '').trim()) {
      citationBlockers.push('no version selected — which year’s text is this?');
    }
  }

  // Interview quotes are unusable until the terms are on record.
  if (source && source.family === 'interview') {
    const iv = source.interview || {};
    if (!String(iv.agreedTerms || '').trim()) {
      citationBlockers.push('the interview has no agreed terms recorded');
    }
    if (iv.recorded && !String(iv.consentTimestamp || '').trim()) {
      citationBlockers.push('the interview has no on-tape consent timestamp');
    }
  }

  return { errors, citationBlockers };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function registerCards({ ipcMain, libraryDir, readJSON, writeJSON, logError }) {
  const cardsFile = (bookId) => path.join(libraryDir, bookId, 'cards.json');
  const boardFile = (bookId) => path.join(libraryDir, bookId, 'board.json');
  const sourceFile = (id) => path.join(libraryDir, 'sources', id, 'source.json');

  // The board is the themes and their order. Themes stay unnamed and
  // unattached to a chapter for as long as you like — you sort first and
  // decide what the piles are called afterwards.
  const loadBoard = (bookId) => {
    const b = readJSON(boardFile(bookId), null);
    return b && Array.isArray(b.themes) ? b : { themes: [] };
  };

  ipcMain.handle('board:read', (_e, bookId) => loadBoard(bookId));

  ipcMain.handle('board:write', (_e, bookId, board) => {
    try {
      writeJSON(boardFile(bookId), { themes: (board && board.themes) || [] });
      return true;
    } catch (err) {
      logError('cards', err);
      return false;
    }
  });

  ipcMain.handle('board:newTheme', () => ({
    id: `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    chapter: '',   // free text until you know what the chapters are
    position: 0
  }));

  const load = (bookId) => {
    const list = readJSON(cardsFile(bookId), []);
    return Array.isArray(list) ? list : [];
  };

  const readSource = (id) => (id ? readJSON(sourceFile(id), null) : null);

  ipcMain.handle('cards:list', (_e, bookId) => {
    try {
      return load(bookId);
    } catch (err) {
      logError('cards', err);
      return [];
    }
  });

  ipcMain.handle('cards:blank', (_e, type) => blankCard(type));

  ipcMain.handle('cards:validate', (_e, bookId, card) => {
    const existing = load(bookId).find((c) => c.id === card.id) || null;
    return validateCard(card, readSource(card.sourceId), existing);
  });

  ipcMain.handle('cards:save', (_e, bookId, card) => {
    try {
      const all = load(bookId);
      const idx = all.findIndex((c) => c.id === card.id);
      const existing = idx >= 0 ? all[idx] : null;

      const check = validateCard(card, readSource(card.sourceId), existing);
      if (check.errors.length) return { ok: false, ...check };

      // A quote locks the moment it is verified against its source — not on
      // first save, or the pile you typed off index cards would freeze at your
      // handwriting. Never unset, including by anything handing us false.
      const locks = card.type === 'quote' && card.verified && String(card.text || '').trim();
      const record = {
        ...card,
        modified: new Date().toISOString(),
        textLocked: Boolean(locks || (existing && existing.textLocked))
      };

      if (idx >= 0) all[idx] = record; else all.push(record);
      writeJSON(cardsFile(bookId), all);
      return { ok: true, card: record, ...check };
    } catch (err) {
      logError('cards', err);
      return { ok: false, errors: [err.message], citationBlockers: [] };
    }
  });

  ipcMain.handle('cards:delete', (_e, bookId, cardId) => {
    try {
      writeJSON(cardsFile(bookId), load(bookId).filter((c) => c.id !== cardId));
      return true;
    } catch (err) {
      logError('cards', err);
      return false;
    }
  });

  // Bulk insert for imported cards. Same validation as a single save — an
  // import that skipped the rules would defeat the point of having them.
  ipcMain.handle('cards:import', (_e, bookId, incoming) => {
    const added = [];
    const rejected = [];
    try {
      const all = load(bookId);
      for (const raw of incoming || []) {
        const card = { ...blankCard(raw.type), ...raw, id: newId() };
        const check = validateCard(card, readSource(card.sourceId), null);
        if (check.errors.length) {
          rejected.push({ card, errors: check.errors });
          continue;
        }
        card.textLocked = card.type === 'quote';
        all.push(card);
        added.push(card);
      }
      writeJSON(cardsFile(bookId), all);
      return { added: added.length, rejected };
    } catch (err) {
      logError('cards', err);
      return { added: 0, rejected: [{ errors: [err.message] }] };
    }
  });
}

module.exports = { registerCards, validateCard, blankCard, TYPES };
