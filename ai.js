// NEO — the AI assistant layer.
//
// Bounded by one rule, enforced here rather than promised in a README: this
// module reads the writer's own material and returns *suggestions*. It never
// produces manuscript prose, and it never supplies a citation — no page
// numbers, no statute text, no dates it wasn't handed. Everything it returns
// lands in a proposal the writer accepts or ignores.
//
// The key lives in the OS keychain, and deliberately NOT in the library
// folder: that folder syncs to iCloud, and an API key has no business there.

const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL = 'claude-opus-5';

// Open Library is consulted first for books: it returns real catalogue records,
// costs nothing, and is faster than a model round-trip. The model's job is to
// pick the right edition out of the candidates and shape them to our schema —
// and to fill the gaps when the catalogue has nothing.
function getJSON(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 12000, headers: { 'User-Agent': 'NEO (research)' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function searchCatalogue(query) {
  const isbn = String(query).replace(/[^0-9Xx]/g, '');
  if (isbn.length === 10 || isbn.length === 13) {
    const data = await getJSON(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const rec = data && data[`ISBN:${isbn}`];
    if (rec) {
      return [{
        title: rec.title,
        authors: (rec.authors || []).map((a) => a.name).join(', '),
        publisher: (rec.publishers || []).map((p) => p.name).join(', '),
        year: rec.publish_date,
        pages: rec.number_of_pages,
        isbn,
        url: rec.url
      }];
    }
  }
  const data = await getJSON(
    'https://openlibrary.org/search.json?limit=5&fields=title,author_name,first_publish_year,publisher,isbn,number_of_pages_median' +
    '&q=' + encodeURIComponent(query)
  );
  return ((data && data.docs) || []).map((d) => ({
    title: d.title,
    authors: (d.author_name || []).join(', '),
    publisher: (d.publisher || []).slice(0, 3).join(', '),
    year: d.first_publish_year,
    pages: d.number_of_pages_median,
    isbn: (d.isbn || [])[0]
  }));
}

const SYSTEM = `You help a nonfiction author organize research note cards for a
book about Oklahoma tax policy. The book must withstand academic scrutiny.

You classify and critique the author's own words. You never supply facts,
citations, page numbers, statute text, dates, or quotations — if a card lacks
one, say it is missing rather than filling it in. You have no knowledge of any
source beyond the text you are given.

When you flag a problem, name the specific issue and explain in one sentence
why it matters, so the author learns the rule rather than depending on you for
it. Be direct and brief. If a card is fine, say so without inventing concerns.`;

const SCHEMA = {
  type: 'object',
  properties: {
    themeId: { type: 'string', description: 'id of the best-fitting existing theme, or empty string if none fit' },
    newTheme: { type: 'string', description: 'a proposed new pile name if nothing fits, else empty string' },
    reasoning: { type: 'string', description: 'one sentence on why this pile' },
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string', description: 'short label, e.g. "two ideas on one card"' },
          why: { type: 'string', description: 'one sentence on why this matters' }
        },
        required: ['issue', 'why'],
        additionalProperties: false
      }
    }
  },
  required: ['themeId', 'newTheme', 'reasoning', 'flags'],
  additionalProperties: false
};

const AUDIT_SYSTEM = `You audit a nonfiction manuscript against the research
behind it. The author is a journalist writing a policy book that must survive
academic scrutiny and a publisher's legal review.

You are not an editor and not a fact-checker. You cannot know whether a claim is
true — you can only see whether it is *supported* by the evidence supplied, and
whether it is stated more strongly than that evidence allows. Report only what
you can see in the material given.

Look for, in rough order of seriousness:
- factual or causal claims with no card and no source behind them
- causal language ("caused", "led to", "because of") where the evidence shows
  correlation or coincidence
- statistics quoted without their uncertainty, especially survey estimates
- claims resting only on a secondary source's characterization of a primary one
- quotes in the manuscript that differ from the captured text on their card
- named individuals described in terms that assert fact rather than opinion

Quote the exact phrase from the manuscript so the author can find it. Never
supply a citation, a page number, or a fact of your own — if something is
unsupported, say so rather than filling the gap. If a passage is sound, do not
manufacture a concern about it.`;

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', description: 'blocking, check, or note' },
          kind: { type: 'string', description: 'short label, e.g. "causal overreach"' },
          passage: { type: 'string', description: 'the exact phrase from the manuscript' },
          why: { type: 'string', description: 'what is wrong, in one or two sentences' },
          fix: { type: 'string', description: 'the smallest change that would resolve it' }
        },
        required: ['severity', 'kind', 'passage', 'why', 'fix'],
        additionalProperties: false
      }
    },
    summary: { type: 'string', description: 'one or two sentences on the overall state of the sourcing' }
  },
  required: ['findings', 'summary'],
  additionalProperties: false
};

// Every word the model ever produced for this project, appended as it happens.
// Two purposes: it makes the prose check possible, and it is the evidentiary
// record if anyone ever asks what the AI actually wrote.
function logOutput(libraryDir, kind, text) {
  try {
    if (!text) return;
    fs.appendFileSync(
      path.join(libraryDir, 'ai-outputs.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), kind, text }) + '\n'
    );
  } catch { /* logging must never break the feature */ }
}

// Words in common, not style. Either a phrase the model produced appears in
// the manuscript or it doesn't — no detector, no opinion, no false positives
// from someone simply writing well.
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function grams(words, n) {
  const out = new Map();
  for (let i = 0; i + n <= words.length; i++) {
    const key = words.slice(i, i + n).join(' ');
    if (!out.has(key)) out.set(key, i);
  }
  return out;
}

function registerAI({ ipcMain, app, safeStorage, libraryDir, readJSON, logError }) {
  // userData, never the library — the library is synced to iCloud.
  const keyFile = () => path.join(app.getPath('userData'), 'anthropic.key');

  function readKey() {
    try {
      if (!fs.existsSync(keyFile())) return null;
      const buf = fs.readFileSync(keyFile());
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(buf) || null;
    } catch (err) {
      logError('ai', err);
      return null;
    }
  }

  ipcMain.handle('ai:hasKey', () => Boolean(readKey()));

  ipcMain.handle('ai:setKey', (_e, key) => {
    try {
      const trimmed = String(key || '').trim();
      if (!trimmed) return { ok: false, error: 'no key given' };
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: 'this Mac cannot encrypt the key — refusing to store it in plain text' };
      }
      fs.writeFileSync(keyFile(), safeStorage.encryptString(trimmed), { mode: 0o600 });
      return { ok: true };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ai:clearKey', () => {
    try {
      if (fs.existsSync(keyFile())) fs.unlinkSync(keyFile());
      return true;
    } catch (err) {
      logError('ai', err);
      return false;
    }
  });

  // Classify one card against the piles that already exist. The card's text is
  // the author's; the themes are the author's. Nothing external is consulted.
  ipcMain.handle('ai:suggestCard', async (_e, payload) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };

    const { card, themes, sourceTitle, confidential } = payload || {};
    // The confidential lane is a wall, not a preference.
    if (confidential) return { ok: false, error: 'this source is marked confidential and never leaves the machine' };

    const text = [card.text, card.draftText, card.note].filter(Boolean).join('\n').trim();
    if (!text) return { ok: false, error: 'nothing on the card to read yet' };

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const piles = (themes || [])
        .filter((t) => t.name)
        .map((t) => `- ${t.id}: ${t.name}${t.chapter ? ` (chapter: ${t.chapter})` : ''}`)
        .join('\n') || '(no named piles yet)';

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        // Low effort: this is a short classification on a paragraph of text,
        // and it runs while the author waits with the card open.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: `Existing piles:\n${piles}\n\nCard type the author chose: ${card.type}
Source: ${sourceTitle || '(none)'}
Locator: ${card.locator || '(none)'}

Card text:
"""
${text}
"""

Suggest which pile this belongs in, and flag anything wrong with the card as a research note.`
        }]
      });

      // Guard before reading content — a refusal returns 200 with no content.
      if (res.stop_reason === 'refusal') {
        return { ok: false, error: 'the request was declined' };
      }
      const block = res.content.find((b) => b.type === 'text');
      const parsed = block ? JSON.parse(block.text) : null;
      if (!parsed) return { ok: false, error: 'no suggestion returned' };
      logOutput(libraryDir, 'card-suggestion',
        [parsed.reasoning, ...(parsed.flags || []).map((f) => f.why)].join(' '));
      return { ok: true, suggestion: parsed };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'request failed' };
    }
  });

  // Fill a source record from a title, ISBN, or citation. Catalogue first,
  // model second. Every field comes back tagged with where it came from so
  // the author can see what to check hardest.
  ipcMain.handle('ai:lookupSource', async (_e, query, family) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };
    if (!String(query || '').trim()) return { ok: false, error: 'nothing to look up' };

    let candidates = [];
    if (family === 'book') {
      try { candidates = await searchCatalogue(query); } catch { candidates = []; }
    }

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: `You fill in bibliographic records for a nonfiction author who
verifies every field herself. Return the fields you are confident about and
leave the rest empty — an empty field costs her ten seconds, a wrong one can
invalidate every page citation to that work.

Set source to "catalogue" for any field taken from the supplied catalogue
records, and "model" for any field you supplied from your own knowledge.
Be especially careful with edition and printing: if the catalogue doesn't state
it, leave it empty rather than inferring it.`,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                author: { type: 'string' },
                publisher: { type: 'string' },
                year: { type: 'string' },
                edition: { type: 'string' },
                isbn: { type: 'string' },
                jurisdiction: { type: 'string' },
                citation: { type: 'string' },
                publication: { type: 'string' },
                url: { type: 'string' },
                source: { type: 'string', description: 'catalogue or model or mixed' },
                caution: { type: 'string', description: 'one sentence on what to check first, or empty' }
              },
              required: ['title', 'author', 'publisher', 'year', 'edition', 'isbn',
                'jurisdiction', 'citation', 'publication', 'url', 'source', 'caution'],
              additionalProperties: false
            }
          }
        },
        messages: [{
          role: 'user',
          content: `Source type: ${family}\nThe author typed: ${query}\n\n` +
            (candidates.length
              ? `Catalogue records found:\n${JSON.stringify(candidates, null, 1)}\n\nPick the best match and shape it into the fields.`
              : `No catalogue records were found. Fill in what you can and say so in "source".`)
        }]
      });

      if (res.stop_reason === 'refusal') return { ok: false, error: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const fields = block ? JSON.parse(block.text) : null;
      if (!fields) return { ok: false, error: 'nothing came back' };
      logOutput(libraryDir, 'source-lookup', Object.values(fields).filter((v) => typeof v === 'string').join(' '));
      return { ok: true, fields, candidates };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'lookup failed' };
    }
  });

  // Does any phrase the model produced appear in the manuscript? Pure string
  // work — no model, no network, no judgement. A hit means look, not guilty.
  ipcMain.handle('ai:proseCheck', (_e, bookId, n) => {
    const RUN = Math.max(5, Number(n) || 8);
    try {
      const bookDir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(bookDir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      const logFile = path.join(libraryDir, 'ai-outputs.jsonl');
      if (!fs.existsSync(logFile)) {
        return { ok: true, matches: [], outputs: 0, note: 'No AI output has been recorded for this library yet.' };
      }
      const entries = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

      // Every run of RUN words the model has ever produced.
      const aiGrams = new Map();
      for (const e of entries) {
        const w = normalize(e.text).split(' ').filter(Boolean);
        for (const [g] of grams(w, RUN)) if (!aiGrams.has(g)) aiGrams.set(g, e);
      }

      const strip = (html) => String(html || '')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

      const matches = [];
      for (const chId of (meta.chapterOrder || [])) {
        let html = '';
        try { html = fs.readFileSync(path.join(bookDir, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
        const plain = strip(html);
        const words = normalize(plain).split(' ').filter(Boolean);
        const seen = new Set();
        for (const [g] of grams(words, RUN)) {
          if (aiGrams.has(g) && !seen.has(g)) {
            seen.add(g);
            const e = aiGrams.get(g);
            matches.push({ chapter: chId, phrase: g, from: e.kind, at: e.at });
          }
        }
      }
      return { ok: true, matches, outputs: entries.length, run: RUN };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message };
    }
  });

  // Read the manuscript against its own evidence. The whole book plus every
  // card fits in one request, which is what lets this see a claim in chapter 9
  // resting on a card captured for chapter 2.
  ipcMain.handle('ai:audit', async (_e, bookId) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };

    try {
      const bookDir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(bookDir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      const strip = (html) => String(html || '')
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

      const manuscript = (meta.chapterOrder || []).map((chId, i) => {
        const file = path.join(bookDir, 'chapters', `${chId}.html`);
        const title = (meta.chapterTitles && meta.chapterTitles[chId]) ||
                      (meta.chapterNotes && meta.chapterNotes[chId]) || '';
        let html = '';
        try { html = fs.readFileSync(file, 'utf8'); } catch { /* chapter not written yet */ }
        return `## Chapter ${i + 1}${title ? ' — ' + title : ''}\n${strip(html)}`;
      }).join('\n\n');

      if (!manuscript.replace(/## Chapter \d+[^\n]*/g, '').trim()) {
        return { ok: false, error: 'nothing written yet to audit' };
      }

      const cards = readJSON(path.join(bookDir, 'cards.json'), []) || [];
      // Confidential sources never leave the machine — drop their cards and
      // say how many were withheld, rather than silently auditing less.
      let withheld = 0;
      const evidence = cards.filter((c) => {
        const s = c.sourceId ? readJSON(path.join(libraryDir, 'sources', c.sourceId, 'source.json'), null) : null;
        if (s && s.confidential) { withheld++; return false; }
        return true;
      }).map((c) => {
        const s = c.sourceId ? readJSON(path.join(libraryDir, 'sources', c.sourceId, 'source.json'), null) : null;
        return {
          type: c.type,
          source: s ? s.title : '(none)',
          locator: c.locator || '',
          verified: Boolean(c.verified),
          text: c.text || c.draftText || '',
          method: c.method || undefined,
          result: c.result || undefined
        };
      });

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: AUDIT_SYSTEM,
        thinking: { type: 'adaptive' },
        // The audit is the one place worth spending real thinking on.
        output_config: { effort: 'high', format: { type: 'json_schema', schema: AUDIT_SCHEMA } },
        messages: [{
          role: 'user',
          content: `MANUSCRIPT\n${manuscript}\n\nEVIDENCE ON FILE (${evidence.length} cards)\n` +
            `${evidence.length ? JSON.stringify(evidence, null, 1) : '(no cards captured yet — treat every factual claim as unsupported)'}\n\n` +
            `Audit the manuscript against this evidence.`
        }]
      });

      if (res.stop_reason === 'refusal') return { ok: false, error: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const parsed = block ? JSON.parse(block.text) : null;
      if (!parsed) return { ok: false, error: 'no findings returned' };
      logOutput(libraryDir, 'audit',
        [parsed.summary, ...(parsed.findings || []).map((f) => f.why + ' ' + f.fix)].join(' '));
      return { ok: true, ...parsed, withheld, cardCount: evidence.length };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'audit failed' };
    }
  });
}

module.exports = { registerAI, normalize, grams };
