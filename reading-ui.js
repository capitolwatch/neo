// NEO — reading mode.
//
// The source on one side, its cards on the other. Select a passage, press a
// key, and it becomes a card with the locator already right — which is the
// whole point: the expensive part of research is finding the passage again,
// and this never loses it.
//
// A quote captured here is verified by construction. The text came out of the
// document, not out of anyone's handwriting, so it locks on save.

(function () {
  const neo = window.neo;
  if (!neo || !neo.sources) return;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const currentBook = () => { try { return book; } catch { return null; } };

  let backdrop = null;
  let escHandler = null;
  let state = null;   // { source, versionId, pages, paged, index }

  function close() {
    if (escHandler) { document.removeEventListener('keydown', escHandler, true); escHandler = null; }
    if (backdrop) backdrop.remove();
    backdrop = null;
    state = null;
  }

  // -------------------------------------------------------------------------
  // Pick what to read
  // -------------------------------------------------------------------------

  async function openReader() {
    if (!currentBook()) { alert('Open a book first — cards belong to a book.'); return; }
    if (backdrop) return;

    const sources = (await neo.sources.list()).filter((s) => {
      if (s.file) return true;
      return ((s.document && s.document.versions) || []).some((v) => v.file);
    });
    if (!sources.length) {
      alert('No source has a document attached yet.\n\nOpen Sources (⌘⇧R), pick one, and use “Attach document…”.');
      return;
    }

    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" style="width:min(1240px,96vw);height:90vh;display:flex;flex-direction:column;padding:22px 26px">
        <div id="rd-head" style="display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:12px"></div>
        <div id="rd-main" style="flex:1;display:flex;gap:16px;min-height:0"></div>
      </div>`;
    document.body.appendChild(backdrop);
    escHandler = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); };
    document.addEventListener('keydown', escHandler, true);

    pickSource(sources);
  }

  function pickSource(sources) {
    backdrop.querySelector('#rd-head').innerHTML = `
      <h2 style="font-size:16px;margin:0">Read a source</h2>
      <button id="rd-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:6px 15px;color:#888">Close</button>`;
    backdrop.querySelector('#rd-x').addEventListener('click', close);

    const rows = [];
    for (const s of sources) {
      const versions = (s.document && s.document.versions) || [];
      if (versions.length) {
        versions.filter((v) => v.file).forEach((v) => rows.push({
          s, versionId: v.id,
          label: `${s.title} — ${v.effectiveDate || v.asOf}${v.note ? ' · ' + v.note : ''}`
        }));
      }
      if (s.file) rows.push({ s, versionId: '', label: s.title });
    }

    backdrop.querySelector('#rd-main').innerHTML = `
      <div style="flex:1;overflow:auto">
        ${rows.map((r, i) => `<div class="rd-pick" data-i="${i}"
            style="padding:11px 12px;border-bottom:1px solid #2a2a2a;cursor:pointer">
            <div style="font-size:14px;color:#ddd">${esc(r.label)}</div>
            <div style="font-size:11px;color:#777;margin-top:2px">${esc(r.s.author || '')}</div>
          </div>`).join('')}
      </div>`;
    backdrop.querySelectorAll('.rd-pick').forEach((el) => {
      el.addEventListener('click', () => {
        const r = rows[Number(el.dataset.i)];
        load(r.s, r.versionId);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async function load(source, versionId) {
    backdrop.querySelector('#rd-main').innerHTML =
      `<div style="color:#777;font-size:13px;padding:20px">Reading the document…</div>`;

    const out = await neo.sources.pages(source.id, versionId);
    if (!out.ok) {
      backdrop.querySelector('#rd-main').innerHTML =
        `<div style="color:#c98b6b;font-size:13px;padding:20px">${esc(out.error)}</div>`;
      return;
    }
    state = { source, versionId, pages: out.pages, paged: out.paged, index: 0, hits: [], hit: -1 };
    renderReader();
  }

  function renderReader() {
    const s = state.source;
    backdrop.querySelector('#rd-head').innerHTML = `
      <div style="min-width:0">
        <h2 style="font-size:15px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</h2>
        <div style="font-size:11px;color:#777;margin-top:2px">
          ${state.paged ? `${state.pages.length} pages` : 'continuous text'}
          ${s.pageOffset ? ` · printed page = PDF page − ${s.pageOffset}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="rd-find" type="text" placeholder="Search this document" spellcheck="false" style="width:230px"/>
        <span id="rd-hits" style="font-size:11px;color:#777;min-width:52px"></span>
        <button id="rd-back" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:6px 12px;color:#888">Sources</button>
        <button id="rd-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:6px 15px;color:#888">Close</button>
      </div>`;

    backdrop.querySelector('#rd-x').addEventListener('click', close);
    backdrop.querySelector('#rd-back').addEventListener('click', async () => {
      const sources = (await neo.sources.list()).filter((x) => x.file ||
        ((x.document && x.document.versions) || []).some((v) => v.file));
      pickSource(sources);
    });

    backdrop.querySelector('#rd-main').innerHTML = `
      <div style="flex:1.55;display:flex;flex-direction:column;min-width:0;border:1px solid #2c2c2c;border-radius:8px">
        <div id="rd-text" style="flex:1;overflow:auto;padding:20px 24px;font-family:Georgia,serif;font-size:15px;line-height:1.75;color:#ddd;white-space:pre-wrap"></div>
        <div id="rd-nav" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;border-top:1px solid #2c2c2c"></div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em">Cards from this source</span>
          <span id="rd-count" style="font-size:11px;color:#777"></span>
        </div>
        <div id="rd-cards" style="flex:1;overflow:auto"></div>
        <button id="rd-make" style="margin-top:10px;background:var(--accent);border:none;border-radius:6px;padding:9px 14px;color:#191919">
          Make a card from the selection
        </button>
        <div style="font-size:11px;color:#666;margin-top:7px">Select a passage on the left, then press this — or ⌘⇧Return.</div>
      </div>`;

    backdrop.querySelector('#rd-make').addEventListener('click', makeCard);

    const find = backdrop.querySelector('#rd-find');
    find.addEventListener('input', () => search(find.value));
    find.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nextHit(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); find.value = ''; search(''); }
    });

    backdrop.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') { e.preventDefault(); makeCard(); }
    });

    showPage();
    refreshCards();
  }

  function showPage() {
    const p = state.pages[state.index];
    const host = backdrop.querySelector('#rd-text');
    host.textContent = p.text;
    host.scrollTop = 0;

    const nav = backdrop.querySelector('#rd-nav');
    if (!state.paged) {
      nav.innerHTML = `<span style="font-size:11px;color:#777">continuous text — the locator is structural, so type it on the card</span>`;
      return;
    }
    nav.innerHTML = `
      <button id="rd-prev" ${state.index === 0 ? 'disabled' : ''}
        style="background:none;border:1px solid #3a3a3a;border-radius:5px;padding:4px 12px;color:#aaa">←</button>
      <span style="font-size:12px;color:#999">
        PDF page ${p.page} of ${state.pages.length}${p.printed !== p.page ? ` · printed p. ${p.printed}` : ''}
      </span>
      <button id="rd-next" ${state.index >= state.pages.length - 1 ? 'disabled' : ''}
        style="background:none;border:1px solid #3a3a3a;border-radius:5px;padding:4px 12px;color:#aaa">→</button>`;
    const prev = nav.querySelector('#rd-prev');
    const next = nav.querySelector('#rd-next');
    if (prev) prev.addEventListener('click', () => { state.index--; showPage(); });
    if (next) next.addEventListener('click', () => { state.index++; showPage(); });
  }

  function search(term) {
    const t = term.trim().toLowerCase();
    state.hits = !t ? [] : state.pages
      .map((p, i) => (p.text.toLowerCase().includes(t) ? i : -1))
      .filter((i) => i >= 0);
    state.hit = -1;
    backdrop.querySelector('#rd-hits').textContent =
      !t ? '' : state.hits.length ? `${state.hits.length} page${state.hits.length === 1 ? '' : 's'}` : 'none';
    if (state.hits.length) nextHit(1);
  }

  function nextHit(dir) {
    if (!state.hits.length) return;
    state.hit = (state.hit + dir + state.hits.length) % state.hits.length;
    state.index = state.hits[state.hit];
    showPage();
  }

  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------

  async function makeCard() {
    const sel = window.getSelection();
    const text = sel ? String(sel).trim() : '';
    if (!text) { alert('Select the passage first.'); return; }

    const p = state.pages[state.index];
    const card = await neo.cards.blank('quote');
    card.sourceId = state.source.id;
    card.versionId = state.versionId || '';
    card.locator = state.paged ? `p. ${p.printed}` : '';
    // Captured from the document itself, so it is verified by construction —
    // no draft step, and it locks the moment it saves.
    card.text = text.replace(/\s+/g, ' ').trim();
    card.verified = true;

    const locator = prompt(
      state.paged
        ? 'Locator for this card:'
        : 'Locator — the section or article this passage sits in:',
      card.locator
    );
    if (locator === null) return;
    card.locator = locator.trim();

    const out = await neo.cards.save(currentBook().id, card);
    if (!out.ok) { alert(out.errors.join('\n')); return; }
    refreshCards();
  }

  async function refreshCards() {
    const all = await neo.cards.list(currentBook().id);
    const mine = all.filter((c) => c.sourceId === state.source.id);
    backdrop.querySelector('#rd-count').textContent = `${mine.length}`;
    backdrop.querySelector('#rd-cards').innerHTML = mine.length
      ? mine.map((c) => `
          <div style="background:#232323;border-left:3px solid #6b8fb5;border-radius:5px;padding:9px 11px;margin-bottom:7px">
            <div style="font-size:12px;color:#ddd;line-height:1.45;max-height:74px;overflow:hidden">${esc(c.text || c.draftText)}</div>
            <div style="font-size:10px;color:#777;margin-top:5px">${esc(c.locator || 'no locator')}${c.verified ? ' · verified' : ' · unverified'}</div>
          </div>`).join('')
      : `<div style="color:#666;font-size:12px">Nothing captured from this source yet.</div>`;
  }

  neo.onMenu((msg) => { if (msg && msg.type === 'readSource') openReader(); });
  window.openReader = openReader;
})();
