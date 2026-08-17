// NEO — endnotes and bibliography.
//
// Reads the anchors left in the manuscript by the card palette, in document
// order, and renders Chicago notes-bibliography — with Bluebook-style forms
// for statutes and constitutions, which is how policy writing actually cites.
//
// The rule that governs everything here: nothing is invented. A missing
// publisher renders as a visible [publisher missing] rather than a plausible
// guess, because a fabricated imprint is worse than an obvious gap — the gap
// gets fixed, the fabrication gets printed.

const fs = require('fs');
const path = require('path');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const gap = (what) => `[${what} missing]`;

// ISO date → Chicago's spelled-out form. Anything unparseable passes through
// untouched rather than being coerced into a wrong date.
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return String(iso || '').trim();
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Bodies and agencies stay as written; personal names inv+ert for the
// bibliography. Anything ambiguous is left alone and flagged.
const CORPORATE = /\b(department|bureau|office|commission|board|agency|council|society|association|university|press|institute|service|legislature|senate|house|court|state of|city of)\b/i;

function invertName(name) {
  const n = String(name || '').trim();
  if (!n) return { text: gap('author'), flagged: true };
  if (CORPORATE.test(n) || !n.includes(' ')) return { text: n, flagged: false };
  const parts = n.split(/\s+/);
  const last = parts.pop();
  return { text: `${last}, ${parts.join(' ')}`, flagged: false };
}

const italic = (s) => `<em>${s}</em>`;

// "2nd ed." already ends in a period; joining naively yields "2nd ed..".
const dot = (s) => (/[.!?]$/.test(String(s).trim()) ? String(s).trim() : String(s).trim() + '.');

// ---------------------------------------------------------------------------
// Note forms — the first, full citation
// ---------------------------------------------------------------------------

function noteFor(src, locator) {
  const loc = String(locator || '').trim();
  const f = src[src.family] || {};
  const author = String(src.author || '').trim();
  const title = String(src.title || '').trim() || gap('title');

  if (src.family === 'book') {
    const place = String(f.place || "").trim();
    const pub = String(f.publisher || '').trim() || gap('publisher');
    const year = String(f.year || '').trim() || gap('year');
    const ed = String(f.edition || '').trim();
    return `${author || gap('author')}, ${italic(title)}${ed ? `, ${ed}` : ''} ` +
           `(${place || gap('place of publication')}: ${pub}, ${year})${loc ? `, ${loc}` : ''}.`;
  }

  if (src.family === 'document') {
    // Bluebook-ish: the citation string is the address; the as-of date is what
    // makes a historical claim checkable.
    const cite = String(f.citation || '').trim() || title;
    const v = (f.versions || []).find((x) => x.id === src.__versionId) || (f.versions || [])[0];
    const asOf = v ? (v.effectiveDate || v.asOf) : '';
    return `${cite}${loc && !cite.includes(loc) ? `, ${loc}` : ''}` +
           `${asOf ? ` (${String(asOf).slice(0, 4)})` : ` ${gap('as-of date')}`}.`;
  }

  if (src.family === 'article') {
    const pubn = String(f.publication || '').trim() || gap('publication');
    const date = longDate(f.date) || gap('date');
    const url = String(f.archiveUrl || f.url || '').trim();
    const acc = String(f.accessed || '').trim();
    return `${author || gap('author')}, “${title},” ${italic(pubn)}, ${date}` +
           `${acc ? `, accessed ${longDate(acc)}` : ''}${url ? `, ${url}` : ''}` +
           `${loc ? `, ${loc}` : ''}.`;
  }

  if (src.family === 'dataset') {
    const tid = String(f.tableId || '').trim() || gap('table id');
    const vint = String(f.vintage || '').trim() || gap('vintage');
    const url = String(f.url || '').trim();
    const unc = String(f.uncertainty || '').trim();
    return `${author || gap('publishing agency')}, “${tid},” ${vint}` +
           `${unc ? `, margin of error ${unc}` : (f.uncertaintyUnavailable ? ', no margin of error published' : `, ${gap('margin of error')}`)}` +
           `${url ? `, ${url}` : ''}${loc ? `, ${loc}` : ''}.`;
  }

  if (src.family === 'interview') {
    const who = String(f.subjectCodeName || '').trim() || gap('subject');
    const when = longDate(f.date) || gap('date');
    const how = String(f.medium || '').trim();
    return `${who}, interview by author${how ? `, ${how}` : ''}, ${when}` +
           `${loc ? `, ${loc}` : ''}.`;
  }

  return `${title}${loc ? `, ${loc}` : ''}.`;
}

// Subsequent references: surname, short title, locator.
function shortNote(src, locator) {
  const loc = String(locator || '').trim();
  const f = src[src.family] || {};
  if (src.family === 'document') {
    const cite = String(f.citation || '').trim() || String(src.title || '').trim();
    return `${cite}${loc && !cite.includes(loc) ? `, ${loc}` : ''}.`;
  }
  // An interview is identified by its subject, not by an author field it
  // doesn't have.
  if (src.family === 'interview') {
    const who = String((f.subjectCodeName || '')).trim() || gap('subject');
    return `${who}, interview${loc ? `, ${loc}` : ''}.`;
  }
  const name = String(src.author || '').trim();
  const surname = CORPORATE.test(name) || !name.includes(' ') ? name : name.split(/\s+/).pop();
  const words = String(src.title || '').split(/\s+/).slice(0, 4).join(' ');
  return `${surname || gap('author')}, ${italic(words)}${loc ? `, ${loc}` : ''}.`;
}

// ---------------------------------------------------------------------------
// Bibliography forms
// ---------------------------------------------------------------------------

function bibFor(src) {
  const f = src[src.family] || {};
  const title = String(src.title || '').trim() || gap('title');
  const who = invertName(src.author);

  if (src.family === 'book') {
    const place = String(f.place || '').trim() || gap('place of publication');
    const pub = String(f.publisher || '').trim() || gap('publisher');
    const year = String(f.year || '').trim() || gap('year');
    const ed = String(f.edition || '').trim();
    return `${dot(who.text)} ${italic(title)}.${ed ? ` ${dot(ed)}` : ''} ${place}: ${pub}, ${year}.`;
  }
  if (src.family === 'article') {
    const pubn = String(f.publication || '').trim() || gap('publication');
    const url = String(f.archiveUrl || f.url || '').trim();
    return `${dot(who.text)} “${title}.” ${italic(pubn)}, ${longDate(f.date) || gap('date')}.${url ? ` ${url}.` : ''}`;
  }
  if (src.family === 'dataset') {
    return `${dot(who.text)} “${String(f.tableId || '').trim() || gap('table id')}.” ` +
           `${String(f.vintage || '').trim() || gap('vintage')}.${f.url ? ` ${f.url}.` : ''}`;
  }
  if (src.family === 'interview') {
    return `${String(f.subjectCodeName || '').trim() || gap('subject')}. Interview by author, ${longDate(f.date) || gap('date')}.`;
  }
  // Statutes and constitutions conventionally sit in their own table rather
  // than the bibliography proper.
  return `${String(f.citation || '').trim() || title}.`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function registerCitations({ ipcMain, libraryDir, readJSON, logError }) {
  ipcMain.handle('citations:build', (_e, bookId) => {
    try {
      const dir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(dir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      const cards = readJSON(path.join(dir, 'cards.json'), []) || [];
      const cardById = new Map(cards.map((c) => [c.id, c]));
      const srcCache = new Map();
      const readSource = (id) => {
        if (!id) return null;
        if (!srcCache.has(id)) srcCache.set(id, readJSON(path.join(libraryDir, 'sources', id, 'source.json'), null));
        return srcCache.get(id);
      };

      const notes = [];
      const problems = [];
      const usedSources = new Map();
      const seen = new Map();   // sourceId → first note number, for short forms

      for (const chId of (meta.chapterOrder || [])) {
        let html = '';
        try { html = fs.readFileSync(path.join(dir, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
        const chapterTitle = (meta.chapterTitles && meta.chapterTitles[chId]) || '';

        for (const m of html.matchAll(/<span[^>]*class="[^"]*neo-cite[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
          const tag = m[0];
          const attr = (name) => {
            const a = new RegExp(`data-${name}="([^"]*)"`).exec(tag);
            return a ? a[1] : '';
          };
          const cardId = attr('card');
          const card = cardById.get(cardId) || null;
          const src = readSource(attr('source') || (card && card.sourceId));
          const locator = attr('locator') || (card && card.locator) || '';
          const quoted = m[1].replace(/<[^>]+>/g, '').trim();

          if (!src) {
            problems.push({ chapter: chapterTitle, why: 'an anchor points at a source that no longer exists', text: quoted.slice(0, 80) });
            continue;
          }
          src.__versionId = attr('version') || (card && card.versionId) || '';
          usedSources.set(src.id, src);

          const first = !seen.has(src.id);
          if (first) seen.set(src.id, notes.length + 1);
          notes.push({
            n: notes.length + 1,
            chapter: chapterTitle,
            text: first ? noteFor(src, locator) : shortNote(src, locator),
            quoted: quoted.slice(0, 110),
            unverified: Boolean(card && card.type === 'quote' && !card.verified),
            noLocator: !String(locator).trim()
          });

          if (!String(locator).trim()) {
            problems.push({ chapter: chapterTitle, why: 'no locator — the reader cannot find this passage', text: quoted.slice(0, 80) });
          }
          if (card && card.type === 'quote' && !card.verified) {
            problems.push({ chapter: chapterTitle, why: 'quote never verified against its source', text: quoted.slice(0, 80) });
          }
        }
      }

      // Alphabetical by the string that leads each entry.
      const legal = [];
      const works = [];
      for (const src of usedSources.values()) {
        (src.family === 'document' ? legal : works).push(bibFor(src));
      }
      const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/^[“"']/, '').toLowerCase();
      works.sort((a, b) => strip(a).localeCompare(strip(b)));
      legal.sort((a, b) => strip(a).localeCompare(strip(b)));

      const gaps = [...notes, ...works, ...legal]
        .map((x) => (typeof x === 'string' ? x : x.text))
        .join(' ').match(/\[[a-z ]+ missing\]/g) || [];

      return {
        ok: true,
        notes,
        works,
        legal,
        problems,
        sources: usedSources.size,
        gaps: [...new Set(gaps)]
      };
    } catch (err) {
      logError('citations', err);
      return { ok: false, error: err.message };
    }
  });

  // The fact-check dossier: every sourced sentence beside the evidence behind
  // it. This is what a publisher's legal review asks for, and assembling it by
  // hand is the miserable fortnight every nonfiction author spends before
  // submission. Generated, it takes a second.
  ipcMain.handle('citations:dossier', (_e, bookId) => {
    try {
      const dir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(dir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      const cards = readJSON(path.join(dir, 'cards.json'), []) || [];
      const cardById = new Map(cards.map((c) => [c.id, c]));
      const srcCache = new Map();
      const readSource = (id) => {
        if (!id) return null;
        if (!srcCache.has(id)) srcCache.set(id, readJSON(path.join(libraryDir, 'sources', id, 'source.json'), null));
        return srcCache.get(id);
      };

      const entries = [];
      let confidentialHeld = 0;

      for (const chId of (meta.chapterOrder || [])) {
        let html = '';
        try { html = fs.readFileSync(path.join(dir, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
        const chapterTitle = (meta.chapterTitles && meta.chapterTitles[chId]) || '';

        for (const pm of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
          const para = pm[1];
          if (!/neo-cite/.test(para)) continue;

          for (const m of para.matchAll(/<span[^>]*class="[^"]*neo-cite[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
            const tag = m[0];
            const attr = (n) => {
              const a = new RegExp(`data-${n}="([^"]*)"`).exec(tag);
              return a ? a[1] : '';
            };
            const card = cardById.get(attr('card')) || null;
            const src = readSource(attr('source') || (card && card.sourceId));

            // The claim as the reader will meet it: the whole sentence the
            // anchor sits inside, not just the quoted fragment.
            const plain = para.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            const marked = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            const at = plain.indexOf(marked.slice(0, 40));
            const sentences = plain.split(/(?<=[.!?])\s+/);
            let claim = plain;
            if (at >= 0) {
              let run = 0;
              for (const sent of sentences) {
                if (at >= run && at < run + sent.length + 1) { claim = sent; break; }
                run += sent.length + 1;
              }
            }

            if (src && src.confidential) confidentialHeld++;

            const v = src && src.family === 'document'
              ? ((src.document.versions || []).find((x) => x.id === (attr('version') || (card && card.versionId))) || null)
              : null;

            entries.push({
              chapter: chapterTitle,
              claim,
              locator: attr('locator') || (card && card.locator) || '',
              source: src ? src.title : '(source missing)',
              sourceFamily: src ? src.family : '',
              author: src ? src.author : '',
              confidential: Boolean(src && src.confidential),
              version: v ? (v.effectiveDate || v.asOf) : '',
              fingerprint: src ? (src.sha256 || (v && v.sha256) || '') : '',
              captured: card ? (card.text || card.draftText || '') : '',
              cardType: card ? card.type : '',
              verified: Boolean(card && card.verified),
              method: card && card.method ? card.method : ''
            });
          }
        }
      }

      return {
        ok: true,
        entries,
        confidentialHeld,
        unverified: entries.filter((e) => e.cardType === 'quote' && !e.verified).length,
        noLocator: entries.filter((e) => !e.locator).length
      };
    } catch (err) {
      logError('citations', err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('citations:saveDossier', (_e, bookId, html) => {
    try {
      const out = path.join(libraryDir, bookId, 'fact-check.html');
      fs.writeFileSync(out, html);
      return out;
    } catch (err) {
      logError('citations', err);
      return null;
    }
  });

  // Write the apparatus beside the book as plain readable HTML.
  ipcMain.handle('citations:save', (_e, bookId, html) => {
    try {
      const out = path.join(libraryDir, bookId, 'endnotes.html');
      fs.writeFileSync(out, html);
      return out;
    } catch (err) {
      logError('citations', err);
      return null;
    }
  });
}

// Shared with the submission export, which needs the same notes in the same
// order so the numbers in the text match the notes at the back.
function buildNotesFor({ libraryDir, readJSON, bookId, meta }) {
  const dir = path.join(libraryDir, bookId);
  const cards = readJSON(path.join(dir, 'cards.json'), []) || [];
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const cache = new Map();
  const readSource = (id) => {
    if (!id) return null;
    if (!cache.has(id)) cache.set(id, readJSON(path.join(libraryDir, 'sources', id, 'source.json'), null));
    return cache.get(id);
  };

  const notes = [];
  const used = new Map();
  const seen = new Map();
  const plain = (s) => String(s).replace(/<[^>]+>/g, '');

  for (const chId of (meta.chapterOrder || [])) {
    let html = '';
    try { html = fs.readFileSync(path.join(dir, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
    for (const m of html.matchAll(/<span[^>]*class="[^"]*neo-cite[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
      const tag = m[0];
      const attr = (n) => {
        const a = new RegExp(`data-${n}="([^"]*)"`).exec(tag);
        return a ? a[1] : '';
      };
      const card = cardById.get(attr('card')) || null;
      const src = readSource(attr('source') || (card && card.sourceId));
      if (!src) continue;
      src.__versionId = attr('version') || (card && card.versionId) || '';
      used.set(src.id, src);
      const loc = attr('locator') || (card && card.locator) || '';
      const first = !seen.has(src.id);
      if (first) seen.set(src.id, true);
      const text = first ? noteFor(src, loc) : shortNote(src, loc);
      notes.push({ text, plain: plain(text) });
    }
  }

  const legal = [];
  const works = [];
  for (const src of used.values()) (src.family === 'document' ? legal : works).push(plain(bibFor(src)));
  const key = (s) => s.replace(/^[“"']/, '').toLowerCase();
  works.sort((a, b) => key(a).localeCompare(key(b)));
  legal.sort((a, b) => key(a).localeCompare(key(b)));

  const gaps = [...new Set((notes.map((n) => n.plain).join(' ') + works.join(' ') + legal.join(' '))
    .match(/\[[a-z ]+ missing\]/g) || [])];

  return { notes, works, legal, gaps };
}

module.exports = { registerCitations, buildNotesFor, noteFor, shortNote, bibFor, invertName, longDate };
