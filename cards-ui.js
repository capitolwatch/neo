// NEO — the card board.
//
// The table you spread index cards out on. Cards pile into themes; themes
// later carry a chapter. You sort first and name the piles afterwards, which
// is the order the method actually works in.
//
// One card lives in exactly one theme. The constraint is deliberate — an index
// card can only be in one pile, and being forced to choose is what turns a
// heap of evidence into an argument.

(function () {
  const neo = window.neo;
  if (!neo || !neo.cards) return;

  const TYPE_COLOR = {
    quote: '#6b8fb5',
    paraphrase: '#7fa87f',
    theme: '#b9a06b',
    derived: '#a98bb5',
    interview: '#b5836b'
  };
  const TYPE_LABEL = {
    quote: 'Quote', paraphrase: 'Paraphrase', theme: 'Theme',
    derived: 'Derived figure', interview: 'Interview'
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const currentBook = () => { try { return book; } catch { return null; } };

  let backdrop = null;
  let cards = [];
  let boardData = { themes: [] };
  let sources = [];
  let dragId = null;

  // Escape has to be listened for on the document. A bare div never receives
  // keydown — it isn't focusable — so a handler bound to the backdrop looks
  // right and silently does nothing.
  function dismissible(el, onClose) {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    // Clicking the dimmed area outside the panel closes it too.
    el.addEventListener('mousedown', (e) => { if (e.target === el) onClose(); });
    return () => document.removeEventListener('keydown', onKey, true);
  }

  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------

  async function openBoard() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first — cards belong to a book.'); return; }
    if (backdrop) return;

    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" style="width:min(1180px,94vw);height:86vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="font-size:16px;margin:0">Card board</h2>
          <span id="cb-count" style="font-size:12px;color:#777"></span>
        </div>
        <div id="cb-board" style="flex:1;overflow:auto;margin:12px 0;display:flex;gap:12px;align-items:flex-start"></div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div style="display:flex;gap:8px">
            <button id="cb-add-card" style="background:var(--accent);border:none;border-radius:6px;padding:7px 14px;color:#191919">+ Card</button>
            <button id="cb-add-theme" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 14px;color:#aaa">+ Theme</button>
          </div>
          <button id="cb-close" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#cb-close').addEventListener('click', close);
    backdrop.querySelector('#cb-add-theme').addEventListener('click', addTheme);
    backdrop.querySelector('#cb-add-card').addEventListener('click', () => editCard(null));
    releaseBoardKeys = dismissible(backdrop, close);

    await reload();
  }

  let releaseBoardKeys = null;

  function close() {
    if (releaseBoardKeys) { releaseBoardKeys(); releaseBoardKeys = null; }
    if (backdrop) backdrop.remove();
    backdrop = null;
  }

  async function reload() {
    const bk = currentBook();
    cards = await neo.cards.list(bk.id);
    boardData = await neo.board.read(bk.id);
    sources = await neo.sources.list();
    renderBoard();
  }

  const sourceById = (id) => sources.find((s) => s.id === id);

  function shortSource(card) {
    const s = sourceById(card.sourceId);
    if (!s) return card.type === 'theme' ? 'your own thinking' : 'no source';
    return s.author ? `${s.author}` : s.title;
  }

  // -------------------------------------------------------------------------
  // Board
  // -------------------------------------------------------------------------

  function renderBoard() {
    const host = backdrop.querySelector('#cb-board');
    const themes = [...boardData.themes].sort((a, b) => a.position - b.position);

    const unverified = cards.filter((c) => c.type === 'quote' && !c.verified).length;
    backdrop.querySelector('#cb-count').textContent =
      `${cards.length} card${cards.length === 1 ? '' : 's'}` +
      (unverified ? ` · ${unverified} awaiting verification` : '');

    // Unfiled always sits first. A pile of cards that don't fit yet is
    // information, not a mess to be tidied away.
    const columns = [{ id: '', name: 'Unfiled', chapter: '' }, ...themes];
    host.innerHTML = columns.map((t) => column(t)).join('');

    host.querySelectorAll('.cb-col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.style.background = '#232323'; });
      col.addEventListener('dragleave', () => { col.style.background = ''; });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.style.background = '';
        await moveCard(dragId, col.dataset.theme, null);
      });
    });

    host.querySelectorAll('.cb-card').forEach((el) => {
      el.addEventListener('dragstart', () => { dragId = el.dataset.id; el.style.opacity = '.4'; });
      el.addEventListener('dragend', () => { el.style.opacity = ''; });
      el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.style.borderTop = '2px solid var(--accent)'; });
      el.addEventListener('dragleave', () => { el.style.borderTop = ''; });
      el.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        el.style.borderTop = '';
        await moveCard(dragId, el.closest('.cb-col').dataset.theme, el.dataset.id);
      });
      el.addEventListener('click', () => editCard(cards.find((c) => c.id === el.dataset.id)));
    });

    host.querySelectorAll('.cb-name').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const t = boardData.themes.find((x) => x.id === inp.dataset.theme);
        if (t) { t.name = inp.value; await saveBoard(); }
      });
    });
    host.querySelectorAll('.cb-chapter').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const t = boardData.themes.find((x) => x.id === inp.dataset.theme);
        if (t) { t.chapter = inp.value; await saveBoard(); }
      });
    });
  }

  function column(t) {
    const inPile = cards
      .filter((c) => (c.themeId || '') === t.id)
      .sort((a, b) => a.position - b.position);

    const header = t.id
      ? `<input class="cb-name" data-theme="${esc(t.id)}" value="${esc(t.name)}" placeholder="name this pile later…"
             style="width:100%;background:none;border:none;color:#ddd;font-size:13px;padding:0"/>
         <input class="cb-chapter" data-theme="${esc(t.id)}" value="${esc(t.chapter)}" placeholder="chapter"
             style="width:100%;background:none;border:none;color:#777;font-size:11px;padding:0;margin-top:2px"/>`
      : `<div style="font-size:13px;color:#888">Unfiled</div>
         <div style="font-size:11px;color:#666;margin-top:2px">doesn't fit yet</div>`;

    return `<div class="cb-col" data-theme="${esc(t.id)}"
        style="flex:0 0 232px;background:#1e1e1e;border:1px solid #2c2c2c;border-radius:8px;padding:10px;min-height:130px;transition:background .1s">
        <div style="border-bottom:1px solid #2c2c2c;padding-bottom:7px;margin-bottom:8px">
          ${header}
          <div style="font-size:10px;color:#666;margin-top:4px">${inPile.length} card${inPile.length === 1 ? '' : 's'}</div>
        </div>
        ${inPile.map(cardFace).join('') || '<div style="font-size:11px;color:#555;padding:8px 2px">drop cards here</div>'}
      </div>`;
  }

  function cardFace(c) {
    const gist = (c.text || c.draftText || c.result || c.note || '').trim();
    const flag = c.type === 'quote' && !c.verified
      ? `<span title="typed from your notes — not yet checked against the source" style="color:#c9a96b;font-size:10px">unverified</span>`
      : '';
    return `<div class="cb-card" data-id="${esc(c.id)}" draggable="true"
        style="background:#262626;border-left:3px solid ${TYPE_COLOR[c.type] || '#555'};border-radius:5px;padding:8px 9px;margin-bottom:7px;cursor:grab">
        <div style="font-size:12px;color:#ddd;line-height:1.4;max-height:54px;overflow:hidden">${esc(gist) || '<em style="color:#666">empty card</em>'}</div>
        <div style="display:flex;justify-content:space-between;gap:6px;margin-top:6px;font-size:10px;color:#777">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(shortSource(c))}${c.locator ? ' · ' + esc(c.locator) : ''}</span>
          ${flag}
        </div>
      </div>`;
  }

  async function moveCard(id, themeId, beforeId) {
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card) return;

    const target = cards
      .filter((c) => (c.themeId || '') === themeId && c.id !== id)
      .sort((a, b) => a.position - b.position);
    const at = beforeId ? target.findIndex((c) => c.id === beforeId) : target.length;
    target.splice(at < 0 ? target.length : at, 0, card);

    card.themeId = themeId;
    const bk = currentBook();
    // Rewrite positions for the whole pile so order is explicit on disk
    // rather than implied by array order.
    for (let i = 0; i < target.length; i++) {
      target[i].position = i;
      await neo.cards.save(bk.id, target[i]);
    }
    await reload();
  }

  async function addTheme() {
    const t = await neo.board.newTheme();
    t.position = boardData.themes.length;
    boardData.themes.push(t);
    await saveBoard();
    renderBoard();
  }

  const saveBoard = () => neo.board.write(currentBook().id, boardData);

  // -------------------------------------------------------------------------
  // Card form
  // -------------------------------------------------------------------------

  async function editCard(existing) {
    const card = existing
      ? JSON.parse(JSON.stringify(existing))
      : await neo.cards.blank('quote');

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.style.zIndex = '950';   // .modal-backdrop is 900 — must sit above the board
    bd.innerHTML = `<div class="modal" style="width:600px;max-height:84vh;overflow:auto">
        <h2 style="font-size:15px;margin:0 0 12px">${existing ? 'Card' : 'New card'}</h2>
        <div id="cf-body"></div>
        <div id="cf-ai" style="margin-top:12px"></div>
        <div id="cf-problems" style="margin-top:10px"></div>
        <div style="display:flex;justify-content:space-between;margin-top:14px">
          <div style="display:flex;gap:8px">
            <button id="cf-save" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919">Save</button>
            <button id="cf-ask" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 14px;color:#aaa">Where does this go?</button>
            ${existing ? `<button id="cf-del" style="background:none;border:none;color:#7a4b42;font-size:12px">Delete</button>` : ''}
          </div>
          <button id="cf-cancel" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 16px;color:#888">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(bd);

    const render = () => {
      const src = sourceById(card.sourceId);
      const versions = src && src.family === 'document' ? (src.document.versions || []) : [];
      const locked = card.textLocked;

      bd.querySelector('#cf-body').innerHTML = `
        <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Type</label>
        <select id="cf-type" style="width:100%;margin-bottom:10px">
          ${Object.keys(TYPE_LABEL).map((t) => `<option value="${t}" ${card.type === t ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}
        </select>

        ${card.type === 'theme' ? '' : `
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Source</label>
          <select id="cf-source" style="width:100%;margin-bottom:10px">
            <option value="">— pick a source —</option>
            ${sources.map((s) => `<option value="${esc(s.id)}" ${card.sourceId === s.id ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}
          </select>`}

        ${versions.length ? `
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Which version</label>
          <select id="cf-version" style="width:100%;margin-bottom:10px">
            <option value="">— pick a version —</option>
            ${versions.map((v) => `<option value="${esc(v.id)}" ${card.versionId === v.id ? 'selected' : ''}>${esc(v.effectiveDate || v.asOf)}${v.note ? ' · ' + esc(v.note) : ''}</option>`).join('')}
          </select>` : ''}

        ${card.type === 'theme' ? '' : `
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Locator</label>
          <input id="cf-locator" type="text" value="${esc(card.locator)}" placeholder="p. 41 · § 2802 · table B19013 · 14:22" style="width:100%;margin-bottom:10px"/>`}

        ${card.type === 'quote' || card.type === 'interview' ? `
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">What your note says</label>
          <textarea id="cf-draft" rows="3" style="width:100%">${esc(card.draftText)}</textarea>
          <div style="font-size:11px;color:#666;margin:3px 0 10px">Your transcription. Always editable, never citable.</div>

          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Verbatim, from the source ${locked ? '<span style="color:#6b9c86">· locked</span>' : ''}</label>
          <textarea id="cf-text" rows="3" style="width:100%" ${locked ? 'readonly' : ''}>${esc(card.text)}</textarea>
          <label style="display:flex;gap:8px;align-items:center;margin:6px 0 10px;font-size:12px;color:#bbb">
            <input type="checkbox" id="cf-verified" ${card.verified ? 'checked' : ''} ${locked ? 'disabled' : ''}/>
            I checked this against the source itself
          </label>` : `
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Text</label>
          <textarea id="cf-text" rows="4" style="width:100%">${esc(card.text)}</textarea>
          <div style="height:10px"></div>`}

        ${card.type === 'derived' ? `
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Method — how did you get this number?</label>
          <textarea id="cf-method" rows="2" style="width:100%">${esc(card.method)}</textarea>
          <div style="height:10px"></div>
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Result</label>
          <input id="cf-result" type="text" value="${esc(card.result)}" style="width:100%;margin-bottom:10px"/>
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Computed from</label>
          <select id="cf-inputs" multiple size="4" style="width:100%;margin-bottom:10px">
            ${cards.filter((c) => c.id !== card.id).map((c) => `<option value="${esc(c.id)}" ${(card.inputs || []).includes(c.id) ? 'selected' : ''}>${esc((c.text || c.draftText || '').slice(0, 60))}</option>`).join('')}
          </select>` : ''}

        <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Your note</label>
        <textarea id="cf-note" rows="2" style="width:100%">${esc(card.note)}</textarea>`;

      bd.querySelector('#cf-type').addEventListener('change', (e) => { harvest(); card.type = e.target.value; render(); });
      const srcSel = bd.querySelector('#cf-source');
      if (srcSel) srcSel.addEventListener('change', (e) => { harvest(); card.sourceId = e.target.value; card.versionId = ''; render(); });
    };

    const harvest = () => {
      const g = (id) => { const el = bd.querySelector(id); return el ? el.value : undefined; };
      const c = (id) => { const el = bd.querySelector(id); return el ? el.checked : undefined; };
      let v;
      if ((v = g('#cf-source')) !== undefined) card.sourceId = v;
      if ((v = g('#cf-version')) !== undefined) card.versionId = v;
      if ((v = g('#cf-locator')) !== undefined) card.locator = v;
      if ((v = g('#cf-draft')) !== undefined) card.draftText = v;
      if ((v = g('#cf-text')) !== undefined && !card.textLocked) card.text = v;
      if ((v = c('#cf-verified')) !== undefined) card.verified = v;
      if ((v = g('#cf-method')) !== undefined) card.method = v;
      if ((v = g('#cf-result')) !== undefined) card.result = v;
      if ((v = g('#cf-note')) !== undefined) card.note = v;
      const inputs = bd.querySelector('#cf-inputs');
      if (inputs) card.inputs = [...inputs.selectedOptions].map((o) => o.value);
    };

    render();

    const shut = () => { releaseCardKeys(); bd.remove(); };
    const releaseCardKeys = dismissible(bd, shut);
    bd.querySelector('#cf-cancel').addEventListener('click', shut);

    bd.querySelector('#cf-ask').addEventListener('click', () => askWhereItGoes(bd, card));
    const del = bd.querySelector('#cf-del');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Delete this card?')) return;
      await neo.cards.remove(currentBook().id, card.id);
      shut();
      await reload();
    });

    bd.querySelector('#cf-save').addEventListener('click', async () => {
      harvest();
      const out = await neo.cards.save(currentBook().id, card);
      const host = bd.querySelector('#cf-problems');
      if (!out.ok) {
        host.innerHTML = `<div style="border-left:3px solid #a05548;background:#2a1d1a;padding:8px 12px">
          ${out.errors.map((e) => `<div style="font-size:12px;color:#ddc4bd">${esc(e)}</div>`).join('')}</div>`;
        return;
      }
      shut();
      await reload();
    });
  }

  // -------------------------------------------------------------------------
  // Suggestions
  //
  // A proposal, never an action. Nothing here files a card, edits its text, or
  // supplies anything the author didn't write — it reads the card and says
  // where it might belong and what looks wrong with it.
  // -------------------------------------------------------------------------

  async function askWhereItGoes(bd, card) {
    const host = bd.querySelector('#cf-ai');
    const say = (html) => { host.innerHTML = html; };

    if (!(await neo.ai.hasKey())) return keyPrompt(host);

    const src = sourceById(card.sourceId);
    if (src && src.confidential) {
      return say(`<div style="font-size:12px;color:#c9a96b">This source is marked confidential, so its cards never leave the machine.</div>`);
    }

    say(`<div style="font-size:12px;color:#777">Reading the card…</div>`);
    const out = await neo.ai.suggestCard({
      card,
      themes: boardData.themes,
      sourceTitle: src ? src.title : '',
      confidential: Boolean(src && src.confidential)
    });

    if (!out.ok) return say(`<div style="font-size:12px;color:#c98b6b">${esc(out.error)}</div>`);

    const s = out.suggestion;
    const named = boardData.themes.find((t) => t.id === s.themeId);
    const pile = named
      ? `<b style="color:#ddd">${esc(named.name)}</b>`
      : (s.newTheme ? `a new pile, <b style="color:#ddd">${esc(s.newTheme)}</b>` : 'nothing that exists yet');

    say(`
      <div style="border-left:3px solid #4d6b7a;background:#1b2429;padding:10px 12px">
        <div style="font-size:10px;color:#7fa3b5;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">Suggestion — yours to take or ignore</div>
        <div style="font-size:12px;color:#cfd8dd;margin-bottom:4px">Looks like ${pile}.</div>
        <div style="font-size:12px;color:#93a5ad">${esc(s.reasoning)}</div>
        ${named ? `<button id="cf-apply" style="margin-top:8px;background:none;border:1px solid #3a4a52;border-radius:5px;padding:4px 11px;color:#9fc0cf;font-size:11px">Put it there</button>` : ''}
      </div>
      ${(s.flags || []).length ? `
        <div style="border-left:3px solid #7a6a3a;background:#25220f;padding:10px 12px;margin-top:8px">
          <div style="font-size:10px;color:#b7a469;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">Worth fixing</div>
          ${s.flags.map((f) => `<div style="font-size:12px;color:#d8cfae;margin-bottom:4px"><b>${esc(f.issue)}</b> — ${esc(f.why)}</div>`).join('')}
        </div>` : ''}`);

    const apply = bd.querySelector('#cf-apply');
    if (apply) apply.addEventListener('click', () => {
      card.themeId = s.themeId;
      apply.textContent = `Filed under ${named.name}`;
      apply.disabled = true;
    });
  }

  function keyPrompt(host) {
    host.innerHTML = `
      <div style="border-left:3px solid #3a4a52;background:#1b2429;padding:10px 12px">
        <div style="font-size:12px;color:#cfd8dd;margin-bottom:6px">Paste an Anthropic API key to turn this on. It goes straight into the macOS keychain — never into your library folder, which syncs to iCloud.</div>
        <input id="cf-key" type="password" placeholder="sk-ant-…" style="width:100%"/>
        <button id="cf-key-save" style="margin-top:7px;background:none;border:1px solid #3a4a52;border-radius:5px;padding:4px 12px;color:#9fc0cf;font-size:11px">Save key</button>
        <span id="cf-key-msg" style="font-size:11px;color:#777;margin-left:8px"></span>
      </div>`;
    host.querySelector('#cf-key-save').addEventListener('click', async () => {
      const res = await neo.ai.setKey(host.querySelector('#cf-key').value);
      host.querySelector('#cf-key-msg').textContent = res.ok
        ? 'Saved. Ask again.'
        : res.error;
    });
  }

  neo.onMenu((msg) => { if (msg && msg.type === 'board') openBoard(); });
  window.openBoard = openBoard;
})();
