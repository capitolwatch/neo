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

  let cleaning = false;

  function scrub(root) {
    if (!root || cleaning) return false;
    let touched = false;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) {
      const before = n.nodeValue;
      const after = before.replace(ZERO_WIDTH, '').replace(ODD_SPACE, ' ');
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

  neo.onMenu((msg) => { if (msg && msg.type === 'insertCard') openPalette(); });
  window.openCardPalette = openPalette;
})();
