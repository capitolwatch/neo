// NEO — cards into the manuscript, and paste hygiene.
//
// Two things that touch the page itself:
//
// 1. A palette summoned at the caret. Search your cards, pick one, it lands
//    anchored — the anchor is what lets the endnote generator find it later,
//    and what lets the audit notice when a quote has drifted.
//
// 2. A paste sanitizer. Invisible characters ride in from browsers and chat
//    windows and survive all the way into a .docx, where they are exactly what
//    a naive "AI detector" or a curious copyeditor looks for.
//
// Nothing here writes text you didn't capture yourself.

(function () {
  const neo = window.neo;
  if (!neo || !neo.cards) return;

  const currentBook = () => { try { return book; } catch { return null; } };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Anchors are invisible in the page but present in the saved HTML.
  const style = document.createElement('style');
  style.textContent = `
    .neo-cite { border-bottom: 1px dotted rgba(140,170,190,.5); }
    .neo-cite[data-unverified="1"] { border-bottom: 1px dashed rgba(201,169,107,.85); }
    .neo-pal-row:hover, .neo-pal-row.on { background: #262626; }
  `;
  document.head.appendChild(style);

  // -------------------------------------------------------------------------
  // Paste hygiene
  // -------------------------------------------------------------------------

  const ZERO_WIDTH = /[​-‍⁠﻿]/g;   // ZWSP, ZWNJ, ZWJ, word-joiner, BOM
  const ODD_SPACE = /[      　]/g;

  // Word field instructions, which ride along when you copy out of Word:
  //   HYPERLINK "http://…" \o "tooltip" Novel:   ->   Novel:
  // Mirrors stripFieldCodes in sources.js. Only quoted arguments and
  // \switches are consumed, and keywords match case-sensitively, so ordinary
  // prose — "the hyperlink between poverty and policy" — survives untouched.
  const FIELD_NAMED = /\b(?:HYPERLINK|TOC|SEQ|XE|EMBED|INCLUDEPICTURE|AUTOTEXT|FORMTEXT|MACROBUTTON)\b(?:\s+"[^"]*"|\s+\\\*?[a-zA-Z]+)*\s*/g;
  const FIELD_REF = /\b(?:PAGEREF|NOTEREF|STYLEREF|REF)\s+[\w._-]+(?:\s+\\\*?[a-zA-Z]+)*\s*/g;
  const MERGEFORMAT = /\s*\\\*\s*MERGEFORMAT/g;

  let cleaning = false;

  function scrub(root) {
    if (!root || cleaning) return false;
    let touched = false;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) {
      const before = n.nodeValue;
      const after = before
        .replace(ZERO_WIDTH, '')
        .replace(ODD_SPACE, ' ')
        .replace(FIELD_NAMED, '')
        .replace(FIELD_REF, '')
        .replace(MERGEFORMAT, '')
        .replace(/[ \t]{2,}/g, ' ');
      if (after !== before) { n.nodeValue = after; touched = true; }
    }
    return touched;
  }

  // Runs after NEO's own paste handler has put clean prose in the document.
  document.addEventListener('paste', (e) => {
    const body = e.target && e.target.closest && e.target.closest('.chapter-body, #aux-editor');
    if (!body) return;
    setTimeout(() => {
      if (scrub(body)) {
        cleaning = true;
        body.dispatchEvent(new Event('input', { bubbles: true }));  // let NEO save the cleaned text
        cleaning = false;
      }
    }, 0);
  }, true);

  // -------------------------------------------------------------------------
  // The palette
  // -------------------------------------------------------------------------

  let savedRange = null;

  function editorTarget() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const node = sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest('.chapter-body') : null;
  }

  async function openPalette() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const body = editorTarget();
    if (!body) {
      alert('Put the cursor where the card should go, then try again.');
      return;
    }
    savedRange = window.getSelection().getRangeAt(0).cloneRange();

    const cards = await neo.cards.list(bk.id);
    if (!cards.length) {
      alert('No cards yet. Make some on the board first (⌘⇧B).');
      return;
    }
    const sources = await neo.sources.list();
    const srcName = (id) => {
      const s = sources.find((x) => x.id === id);
      return s ? (s.author || s.title) : '';
    };

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.style.zIndex = '940';
    bd.innerHTML = `
      <div class="modal" style="width:min(660px,92vw);max-height:70vh;display:flex;flex-direction:column">
        <input id="np-q" type="text" placeholder="Search your cards…" autocomplete="off" spellcheck="false" style="width:100%"/>
        <div id="np-list" style="flex:1;overflow:auto;margin-top:12px"></div>
        <div style="font-size:11px;color:#666;margin-top:10px">↑↓ to move · Enter to insert · Esc to close</div>
      </div>`;
    document.body.appendChild(bd);

    const q = bd.querySelector('#np-q');
    const list = bd.querySelector('#np-list');
    let shown = [];
    let cursor = 0;

    const close = () => { document.removeEventListener('keydown', onKey, true); bd.remove(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, shown.length - 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[cursor]) insert(shown[cursor], body, close); }
    };
    document.addEventListener('keydown', onKey, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });

    const mark = () => {
      list.querySelectorAll('.neo-pal-row').forEach((r, i) => r.classList.toggle('on', i === cursor));
      const on = list.querySelector('.neo-pal-row.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    };

    const render = () => {
      const term = q.value.trim().toLowerCase();
      shown = cards.filter((c) => {
        if (!term) return true;
        return [c.text, c.draftText, c.note, c.locator, srcName(c.sourceId)]
          .filter(Boolean).join(' ').toLowerCase().includes(term);
      }).slice(0, 60);
      cursor = 0;

      list.innerHTML = shown.map((c, i) => {
        const gist = (c.text || c.draftText || c.result || c.note || '').trim();
        const unver = c.type === 'quote' && !c.verified;
        return `<div class="neo-pal-row${i === 0 ? ' on' : ''}" data-i="${i}"
            style="padding:8px 10px;border-radius:5px;cursor:pointer">
            <div style="font-size:12px;color:#ddd;line-height:1.4;max-height:36px;overflow:hidden">${esc(gist) || '<em style="color:#666">empty</em>'}</div>
            <div style="font-size:10px;color:#777;margin-top:3px">
              ${esc(c.type)}${c.locator ? ' · ' + esc(c.locator) : ''}${srcName(c.sourceId) ? ' · ' + esc(srcName(c.sourceId)) : ''}
              ${unver ? ' · <span style="color:#c9a96b">unverified</span>' : ''}
            </div>
          </div>`;
      }).join('') || `<div style="color:#666;font-size:12px;padding:10px">nothing matches</div>`;

      list.querySelectorAll('.neo-pal-row').forEach((r) => {
        r.addEventListener('click', () => insert(shown[Number(r.dataset.i)], body, close));
      });
    };

    q.addEventListener('input', render);
    render();
    q.focus();
  }

  // Insert the card's text at the saved caret, wrapped in its anchor.
  function insert(card, body, done) {
    if (!card || !savedRange) return;

    const verbatim = card.type === 'quote' || card.type === 'interview';
    const unverified = verbatim && !card.verified;
    const text = (verbatim ? (card.text || card.draftText) : (card.text || card.draftText || card.result || '')).trim();
    if (!text) { alert('That card has no text to insert.'); return; }

    if (unverified && !confirm(
      'This quote has not been checked against its source yet.\n\n' +
      'It will go in marked unverified, and the audit will keep flagging it until you confirm the exact wording.\n\nInsert anyway?'
    )) return;

    const span = document.createElement('span');
    span.className = 'neo-cite';
    span.dataset.card = card.id;
    if (card.sourceId) span.dataset.source = card.sourceId;
    if (card.versionId) span.dataset.version = card.versionId;
    if (card.locator) span.dataset.locator = card.locator;
    if (unverified) span.dataset.unverified = '1';
    span.textContent = verbatim ? `“${text}”` : text;

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    savedRange.deleteContents();
    savedRange.insertNode(span);

    // Leave the caret after the insertion so typing continues naturally.
    const after = document.createRange();
    after.setStartAfter(span);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);

    // NEO saves on 'input'; this makes the insertion persist exactly as if typed.
    body.dispatchEvent(new Event('input', { bubbles: true }));
    savedRange = null;
    done();
  }

  // -------------------------------------------------------------------------
  // Find the structure in an imported document
  //
  // A paper imports as one block because NEO looks for page breaks and
  // "Chapter N". This proposes where the divisions already are, and splits
  // only when told to. The originals are removed last, after the new chapters
  // are safely on disk.
  // -------------------------------------------------------------------------

  async function findStructure() {
    const bk = currentBook();
    if (!bk) { alert('Open the book you want to restructure.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(720px,94vw);max-height:84vh;display:flex;flex-direction:column">
        <h2 style="font-size:16px;margin:0 0 10px">Find the structure</h2>
        <div id="st-body" style="flex:1;overflow:auto;font-size:13px;color:#999;line-height:1.6">Reading the document…</div>
        <div style="display:flex;justify-content:space-between;margin-top:14px">
          <button id="st-go" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919" disabled>Split into chapters</button>
          <button id="st-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 16px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.querySelector('#st-x').addEventListener('click', shut);

    const out = await neo.ai.structure(bk.id);
    const host = bd.querySelector('#st-body');
    if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }
    if (!out.sections.length) {
      host.innerHTML = `<span style="color:#999">No clear divisions found — the text reads as one continuous piece.</span>`;
      return;
    }

    host.innerHTML = `
      <div style="color:#bbb;margin-bottom:12px">${esc(out.note)} — ${out.sections.length} sections across ${out.paragraphs} paragraphs.</div>
      ${out.sections.map((s, i) => `
        <label style="display:flex;gap:9px;padding:9px 4px;border-bottom:1px solid #2a2a2a;cursor:pointer">
          <input type="checkbox" data-i="${i}" checked style="margin-top:4px"/>
          <span style="min-width:0">
            <span style="font-size:13px;color:#ddd">${esc(s.title)}</span>
            <span style="font-size:10px;color:#5f6f66;margin-left:7px">${esc(s.kind)}</span>
            <span style="display:block;font-size:11px;color:#777;margin-top:3px">¶${s.start} · ${esc(s.preview)}…</span>
          </span>
        </label>`).join('')}`;

    const go = bd.querySelector('#st-go');
    go.disabled = false;
    go.addEventListener('click', async () => {
      const picks = [...bd.querySelectorAll('input:checked')].map((c) => out.sections[Number(c.dataset.i)]);
      if (!picks.length) return;
      if (!confirm(
        `Split this book into ${picks.length} chapters?\n\n` +
        `Your text is not changed — it is redistributed across new chapters, and the originals are ` +
        `removed only after the new ones are written. A backup zip sits in your library either way.`
      )) return;
      go.disabled = true;
      go.textContent = 'Splitting…';
      await applySplit(bk, picks);
      shut();
    });
  }

  async function applySplit(bk, sections) {
    // Rebuild the paragraph list exactly as the main process saw it.
    const paras = [];
    for (const chId of (bk.chapterOrder || [])) {
      const html = await neo.readChapter(bk.id, chId);
      for (const m of String(html).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
        if (m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim()) paras.push(m[0]);
      }
    }
    if (!paras.length) { alert('No paragraphs found to split.'); return; }

    const bounds = sections.map((s) => s.start).filter((n) => n < paras.length);
    if (bounds[0] !== 0) bounds.unshift(0);   // whatever precedes the first heading is its own chapter

    const oldIds = [...(bk.chapterOrder || [])];
    const newIds = [];
    const titles = {};

    for (let i = 0; i < bounds.length; i++) {
      const from = bounds[i];
      const to = i + 1 < bounds.length ? bounds[i + 1] : paras.length;
      const id = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${i}`;
      await neo.writeChapter(bk.id, id, paras.slice(from, to).join('\n'));
      newIds.push(id);
      const sec = sections.find((s) => s.start === from);
      titles[id] = sec ? sec.title : 'Front matter';
    }

    // Only now is it safe to repoint the book and drop the originals.
    bk.chapterOrder = newIds;
    bk.chapterTitles = { ...(bk.chapterTitles || {}), ...titles };
    await neo.writeBookMeta(bk.id, bk);
    for (const id of oldIds) await neo.deleteChapter(bk.id, id);

    if (typeof openBook === 'function') openBook(bk.id);   // re-render with the new structure
  }

  neo.onMenu((msg) => {
    if (!msg) return;
    if (msg.type === 'insertCard') openPalette();
    if (msg.type === 'findStructure') findStructure();
  });
  window.openCardPalette = openPalette;
  window.findStructure = findStructure;
})();
