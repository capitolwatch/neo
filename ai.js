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

  // The argument attacked on its merits. Distinct from the rigor audit, which
  // asks whether a claim is *supported*; this asks whether the reasoning
  // *holds* — the thing no amount of provenance can settle, and the thing a
  // reviewer goes at first when a book argues that one policy caused an outcome.
  ipcMain.handle('ai:hostileReview', async (_e, bookId, chapterId) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };

    try {
      const dir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(dir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      const ids = chapterId ? [chapterId] : (meta.chapterOrder || []);
      const strip = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const text = ids.map((chId) => {
        let html = '';
        try { html = fs.readFileSync(path.join(dir, 'chapters', `${chId}.html`), 'utf8'); } catch { return ''; }
        const t = (meta.chapterTitles && meta.chapterTitles[chId]) || '';
        return `## ${t}\n${strip(html)}`;
      }).filter((s) => s.replace(/^## .*/, '').trim()).join('\n\n');

      if (!text.trim()) return { ok: false, error: 'nothing written in that chapter yet' };

      // What evidence exists, so the reviewer attacks the argument rather than
      // complaining about sourcing the audit already covers.
      const cards = readJSON(path.join(dir, 'cards.json'), []) || [];
      const kinds = {};
      for (const c of cards) {
        const s = c.sourceId ? readJSON(path.join(libraryDir, 'sources', c.sourceId, 'source.json'), null) : null;
        if (s && s.confidential) continue;
        const k = s ? s.family : 'none';
        kinds[k] = (kinds[k] || 0) + 1;
      }

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 6000,
        system: `You are the most demanding reader this chapter will meet: a
public-finance economist who is unconvinced, reading for the argument's weak
points. Not an editor — you do not care about prose.

Attack the reasoning:
- the causal claim, and whether the evidence shown could distinguish cause from
  coincidence
- alternative explanations the author has not addressed
- selection: whether the cases shown were chosen because they fit
- generalization from a few places to a whole state or era
- timing: whether the effect precedes the cause anywhere
- base rates and comparison: what happened in places without the policy
- whether a stated magnitude could survive its own uncertainty

You have no knowledge of Oklahoma beyond this text, and you must not pretend
otherwise. Never assert a fact, a figure, a statute or a source of your own —
not even to illustrate. Attack only what is on the page, and say what evidence
would answer each objection. If a passage is well argued, say so; a reviewer
who objects to everything is ignored.`,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                challenges: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      force: { type: 'string', description: 'fatal, serious, or minor' },
                      kind: { type: 'string', description: 'short label, e.g. "alternative explanation"' },
                      passage: { type: 'string', description: 'the phrase being attacked, quoted from the text' },
                      objection: { type: 'string' },
                      answer: { type: 'string', description: 'what evidence or reframing would answer it' }
                    },
                    required: ['force', 'kind', 'passage', 'objection', 'answer'],
                    additionalProperties: false
                  }
                },
                strongest: { type: 'string', description: 'the part of the argument that holds up best' },
                verdict: { type: 'string' }
              },
              required: ['challenges', 'strongest', 'verdict'],
              additionalProperties: false
            }
          }
        },
        messages: [{
          role: 'user',
          content: `Evidence the author has gathered, by kind: ${JSON.stringify(kinds)}\n\n${text.slice(0, 300000)}`
        }]
      });

      if (res.stop_reason === 'refusal') return { ok: false, error: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const parsed = block ? JSON.parse(block.text) : null;
      if (!parsed) return { ok: false, error: 'nothing came back' };

      const order = ['fatal', 'serious', 'minor'];
      const challenges = (parsed.challenges || [])
        .sort((a, b) => order.indexOf(a.force) - order.indexOf(b.force));

      logOutput(libraryDir, 'hostile-review',
        [parsed.verdict, parsed.strongest, ...challenges.map((c) => c.objection + ' ' + c.answer)].join(' '));
      return { ok: true, challenges, strongest: parsed.strongest, verdict: parsed.verdict };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'review failed' };
    }
  });

  // Figures and dates that disagree with themselves across a manuscript. The
  // candidates are extracted mechanically — every number, percentage, year and
  // dollar amount with the sentence around it — so the model is never asked to
  // find numbers, only to judge whether two of the author's own numbers are
  // meant to be the same one.
  ipcMain.handle('ai:consistency', async (_e, bookId) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };

    try {
      const dir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(dir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      // Pull every figure with enough context to tell what it refers to.
      const FIGURE = /(?:\$\s?[\d,]+(?:\.\d+)?(?:\s?(?:million|billion|thousand))?|[\d,]+(?:\.\d+)?\s?(?:percent|%)|\b(?:1[6-9]|20)\d{2}\b|\b[\d,]{2,}(?:\.\d+)?\b)/g;
      const found = [];
      for (const chId of (meta.chapterOrder || [])) {
        let html = '';
        try { html = fs.readFileSync(path.join(dir, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
        const title = (meta.chapterTitles && meta.chapterTitles[chId]) || '';
        const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        for (const sent of text.split(/(?<=[.!?])\s+/)) {
          const hits = sent.match(FIGURE);
          if (!hits) continue;
          for (const h of new Set(hits)) {
            found.push({ chapter: title || chId, figure: h.trim(), sentence: sent.slice(0, 260) });
          }
        }
      }

      if (found.length < 2) {
        return { ok: true, findings: [], counted: found.length, note: 'too few figures in the manuscript to compare' };
      }

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: `You are given every figure in a manuscript with the sentence
around it, already extracted. Your only job is to spot figures that appear to
describe the SAME quantity but disagree.

Report a conflict only when the surrounding sentences make it clear the two
figures refer to the same thing. Different counties, different years, different
measures and different populations are not conflicts, and reporting them as
such wastes the author's time and trains them to ignore you.

You cannot know which figure is correct — say which passages disagree and let
the author check. Never assert a value of your own, never compute a correction,
and never introduce a figure that is not in the material given.`,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                findings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      quantity: { type: 'string', description: 'what both figures appear to describe' },
                      a: { type: 'string', description: 'the first passage, quoted' },
                      b: { type: 'string', description: 'the second passage, quoted' },
                      why: { type: 'string', description: 'why these look like the same quantity' }
                    },
                    required: ['quantity', 'a', 'b', 'why'],
                    additionalProperties: false
                  }
                },
                verdict: { type: 'string' }
              },
              required: ['findings', 'verdict'],
              additionalProperties: false
            }
          }
        },
        messages: [{ role: 'user', content: `Figures extracted from the manuscript:\n${JSON.stringify(found.slice(0, 600), null, 1)}` }]
      });

      if (res.stop_reason === 'refusal') return { ok: false, error: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const parsed = block ? JSON.parse(block.text) : { findings: [], verdict: '' };
      logOutput(libraryDir, 'consistency', [parsed.verdict, ...(parsed.findings || []).map((f) => f.why)].join(' '));
      return { ok: true, findings: parsed.findings || [], verdict: parsed.verdict, counted: found.length };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'consistency check failed' };
    }
  });

  // Read a book's title and copyright pages. This is the grounded opposite of
  // asking a model what edition a book is: the answer comes off a photograph of
  // the actual page in the author's hands, which is the only place an edition
  // statement is authoritative. Catalogues get editions wrong routinely.
  ipcMain.handle('ai:copyrightPage', async () => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };

    const { dialog } = require('electron');
    const picked = await dialog.showOpenDialog({
      title: 'Photograph or scan of the title and copyright pages',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and PDFs', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'] }]
    });
    if (picked.canceled || !picked.filePaths.length) return { ok: false, error: 'cancelled' };

    try {
      const content = [];
      for (const fp of picked.filePaths.slice(0, 4)) {
        const ext = path.extname(fp).toLowerCase();
        const data = fs.readFileSync(fp).toString('base64');
        if (ext === '.pdf') {
          content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
        } else {
          const media = ext === '.png' ? 'image/png'
            : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          content.push({ type: 'image', source: { type: 'base64', media_type: media, data } });
        }
      }
      content.push({
        type: 'text',
        text: 'Read the bibliographic details off these pages. Transcribe only what is printed.'
      });

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: `You transcribe what is printed on a book's title and copyright
pages. You are reading an image the author supplied of a book they are holding.

Report only what is legibly printed. Never complete a field from your own
knowledge of the book, never correct an apparent error, and never infer an
edition from a copyright year. If something is illegible or absent, leave it
empty and say so in "unreadable".

The printing line — a row like "10 9 8 7 6 5 4 3 2 1" — gives the printing
number as its lowest digit. Transcribe the line as printed and state the number
you read from it, but only if the line is actually visible.`,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                subtitle: { type: 'string' },
                author: { type: 'string' },
                publisher: { type: 'string' },
                place: { type: 'string', description: 'city of publication as printed' },
                year: { type: 'string', description: 'copyright or publication year as printed' },
                edition: { type: 'string', description: 'edition statement exactly as printed, or empty' },
                printing: { type: 'string', description: 'the printing line as printed, or empty' },
                isbn: { type: 'string' },
                unreadable: { type: 'string', description: 'what you could not make out, or empty' }
              },
              required: ['title', 'subtitle', 'author', 'publisher', 'place', 'year',
                'edition', 'printing', 'isbn', 'unreadable'],
              additionalProperties: false
            }
          }
        },
        messages: [{ role: 'user', content }]
      });

      if (res.stop_reason === 'refusal') return { ok: false, error: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const fields = block ? JSON.parse(block.text) : null;
      if (!fields) return { ok: false, error: 'nothing came back' };
      logOutput(libraryDir, 'copyright-page', Object.values(fields).filter((v) => typeof v === 'string').join(' '));
      return { ok: true, fields, files: picked.filePaths.map((f) => path.basename(f)) };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'could not read those pages' };
    }
  });

  // What the board is missing. The structural half is counted, not guessed —
  // how many sources hold up a theme is arithmetic, and a model has no business
  // being asked. The model is used only for the conceptual half: which argument
  // has no evidence against it.
  ipcMain.handle('ai:gaps', async (_e, bookId) => {
    try {
      const dir = path.join(libraryDir, bookId);
      const board = readJSON(path.join(dir, 'board.json'), { themes: [] }) || { themes: [] };
      const cards = readJSON(path.join(dir, 'cards.json'), []) || [];
      const srcCache = new Map();
      const readSource = (id) => {
        if (!id) return null;
        if (!srcCache.has(id)) srcCache.set(id, readJSON(path.join(libraryDir, 'sources', id, 'source.json'), null));
        return srcCache.get(id);
      };

      const themes = (board.themes || []).filter((t) => String(t.name || '').trim());
      if (!themes.length && !cards.length) return { ok: false, error: 'nothing on the board yet' };

      // Counted, not inferred.
      const structural = [];
      const digest = [];
      for (const t of themes) {
        const mine = cards.filter((c) => c.themeId === t.id);
        const srcs = [...new Set(mine.map((c) => c.sourceId).filter(Boolean))].map(readSource).filter(Boolean);
        const families = new Set(srcs.map((s) => s.family));
        const primary = srcs.filter((s) => ['document', 'dataset', 'interview'].includes(s.family)).length;
        const unver = mine.filter((c) => c.type === 'quote' && !c.verified).length;

        if (!mine.length) structural.push({ theme: t.name, issue: 'no cards at all' });
        else if (srcs.length === 1) structural.push({ theme: t.name, issue: `everything rests on one source — ${srcs[0].title}` });
        else if (srcs.length && !primary) structural.push({ theme: t.name, issue: 'no primary documents — all of it is secondary' });
        if (mine.length && mine.length < 3) structural.push({ theme: t.name, issue: `only ${mine.length} card${mine.length === 1 ? '' : 's'} behind it` });
        if (unver) structural.push({ theme: t.name, issue: `${unver} quote${unver === 1 ? '' : 's'} never verified` });

        digest.push({
          theme: t.name,
          chapter: t.chapter || '',
          cards: mine.length,
          sourceKinds: [...families],
          gist: mine.slice(0, 8).map((c) => (c.text || c.draftText || c.note || '').slice(0, 140))
        });
      }

      const unfiled = cards.filter((c) => !c.themeId);

      const key = readKey();
      if (!key) return { ok: true, structural, conceptual: [], unfiled: unfiled.length, note: 'no API key — structural findings only' };

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        system: `You review the evidence an author has gathered for a policy book
and say what is missing. You see only their themes and the gist of their cards.

Name arguments a hostile reader would expect to see addressed and that have no
evidence behind them — the competing explanation, the obvious objection, the
counterexample. Say what KIND of evidence would answer it.

You do not know the subject better than the author. Do not assert facts about
Oklahoma, tax policy, or anything else, and do not name specific sources,
statutes or figures — describe the shape of the missing evidence, not its
content. If the board looks well covered, say so rather than inventing gaps.`,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                gaps: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      missing: { type: 'string', description: 'the argument or objection with nothing behind it' },
                      why: { type: 'string', description: 'why a reader would expect it addressed' },
                      evidence: { type: 'string', description: 'the kind of evidence that would answer it' }
                    },
                    required: ['missing', 'why', 'evidence'],
                    additionalProperties: false
                  }
                },
                verdict: { type: 'string' }
              },
              required: ['gaps', 'verdict'],
              additionalProperties: false
            }
          }
        },
        messages: [{ role: 'user', content: `Themes and the evidence behind them:\n${JSON.stringify(digest, null, 1)}\n\nUnfiled cards: ${unfiled.length}` }]
      });

      if (res.stop_reason === 'refusal') return { ok: true, structural, conceptual: [], unfiled: unfiled.length, note: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const parsed = block ? JSON.parse(block.text) : { gaps: [], verdict: '' };
      logOutput(libraryDir, 'gaps', [parsed.verdict, ...(parsed.gaps || []).map((g) => g.missing + ' ' + g.why)].join(' '));
      return { ok: true, structural, conceptual: parsed.gaps || [], verdict: parsed.verdict, unfiled: unfiled.length };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'gap analysis failed' };
    }
  });

  // An imported paper arrives as one undifferentiated block, because NEO looks
  // for page breaks and "Chapter N" headings and a paper has neither. This
  // reads the text and proposes where the sections actually begin. It proposes
  // only — the split happens when the author says so.
  ipcMain.handle('ai:structure', async (_e, bookId) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };

    try {
      const dir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(dir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      const paras = [];
      for (const chId of (meta.chapterOrder || [])) {
        let html = '';
        try { html = fs.readFileSync(path.join(dir, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
        for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
          const t = m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
          if (t) paras.push(t);
        }
      }
      if (paras.length < 4) return { ok: false, error: 'not enough text to find a structure in' };

      // Numbered so the model can point at a paragraph rather than quote it —
      // an index is unambiguous where a quoted phrase may repeat.
      const numbered = paras.map((t, i) => `[${i}] ${t.slice(0, 300)}`).join('\n');

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: `You find the structure already present in a document. The author
imported it and it arrived as one undivided block.

Identify where its real divisions begin — abstract, introduction, named
sections, conclusion, notes, works cited. Point at the paragraph index that
STARTS each division. Use the document's own headings and wording for titles;
do not invent titles it does not have, and do not reorganize it into a
structure you think would be better. If the text has no clear divisions, return
an empty list rather than imposing some.`,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                sections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      start: { type: 'integer', description: 'index of the paragraph that begins this section' },
                      title: { type: 'string', description: "the document's own heading, or a short descriptive one" },
                      kind: { type: 'string', description: 'abstract, section, subsection, notes, bibliography, other' }
                    },
                    required: ['start', 'title', 'kind'],
                    additionalProperties: false
                  }
                },
                note: { type: 'string', description: 'one sentence on what kind of document this is' }
              },
              required: ['sections', 'note'],
              additionalProperties: false
            }
          }
        },
        messages: [{ role: 'user', content: `Document paragraphs:\n\n${numbered.slice(0, 200000)}` }]
      });

      if (res.stop_reason === 'refusal') return { ok: false, error: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const parsed = block ? JSON.parse(block.text) : null;
      if (!parsed) return { ok: false, error: 'nothing came back' };

      // Keep only sane, ascending, in-range boundaries.
      const seen = new Set();
      const sections = (parsed.sections || [])
        .filter((s) => Number.isInteger(s.start) && s.start >= 0 && s.start < paras.length)
        .filter((s) => (seen.has(s.start) ? false : seen.add(s.start)))
        .sort((a, b) => a.start - b.start)
        .map((s) => ({ ...s, preview: paras[s.start].slice(0, 110) }));

      logOutput(libraryDir, 'structure', [parsed.note, ...sections.map((s) => s.title)].join(' '));
      return { ok: true, sections, note: parsed.note, paragraphs: paras.length };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'structuring failed' };
    }
  });

  // A works-cited list is a set of sources someone already gathered. Parsing it
  // is restructuring text the author supplied — no lookup, nothing invented.
  // Entries arrive unverified: a bibliography entry is a *claim* about a work,
  // typos in them are common, and none of them carries an edition or a copy.
  ipcMain.handle('ai:importBibliography', async (_e, dialogRef) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'no API key set' };

    const { dialog } = require('electron');
    const picked = await dialog.showOpenDialog({
      title: 'Choose the document whose bibliography you want',
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'rtf', 'doc', 'docx', 'txt', 'md'] }]
    });
    if (picked.canceled || !picked.filePaths.length) return { ok: false, error: 'cancelled' };

    try {
      const src = picked.filePaths[0];
      let text = '';
      if (/\.(txt|md)$/i.test(src)) {
        text = fs.readFileSync(src, 'utf8');
      } else {
        const tmp = path.join(app.getPath('temp'), `neo-bib-${Date.now()}${path.extname(src)}`);
        fs.copyFileSync(src, tmp);
        const { extractText } = require('./sources');
        const out = await extractText(tmp);
        if (out) text = fs.readFileSync(path.join(path.dirname(tmp), out), 'utf8');
      }
      if (!text.trim()) {
        return { ok: false, error: 'no text could be read from that file — if it is a scan, it needs OCR first' };
      }

      // Bibliographies sit at the end. Take the tail, and cut in at the heading
      // if we can find one, so the model reads entries rather than the paper.
      const head = text.search(/\n\s*(works\s+cited|references|bibliography|sources\s+cited)\s*\n/i);
      const section = head >= 0 ? text.slice(head) : text.slice(-40000);

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: `You extract bibliography entries into structured records. You are
reading text the author supplied. Transcribe only what is on the page — never
complete a missing publisher, year, or edition from your own knowledge, and
never correct what looks like an error. Leave a field empty instead. If the
supplied text contains no bibliography, return an empty list.`,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                entries: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      family: { type: 'string', description: 'book, document, dataset, article, or interview' },
                      title: { type: 'string' },
                      author: { type: 'string' },
                      publisher: { type: 'string' },
                      year: { type: 'string' },
                      publication: { type: 'string' },
                      url: { type: 'string' },
                      raw: { type: 'string', description: 'the entry exactly as printed' }
                    },
                    required: ['family', 'title', 'author', 'publisher', 'year', 'publication', 'url', 'raw'],
                    additionalProperties: false
                  }
                }
              },
              required: ['entries'],
              additionalProperties: false
            }
          }
        },
        messages: [{ role: 'user', content: `Extract every bibliography entry from this text.\n\n${section.slice(0, 120000)}` }]
      });

      if (res.stop_reason === 'refusal') return { ok: false, error: 'the request was declined' };
      const block = res.content.find((b) => b.type === 'text');
      const parsed = block ? JSON.parse(block.text) : null;
      if (!parsed) return { ok: false, error: 'nothing came back' };
      logOutput(libraryDir, 'bibliography', (parsed.entries || []).map((e) => e.title).join(' '));
      return { ok: true, entries: parsed.entries || [], file: path.basename(src) };
    } catch (err) {
      logError('ai', err);
      return { ok: false, error: err.message || 'import failed' };
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
