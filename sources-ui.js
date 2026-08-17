// NEO — the Sources panel.
//
// Library-wide research sources: books, statutes, datasets, articles,
// interviews. Summoned and dismissed rather than always on screen, so the
// page stays the page.
//
// Registers its own menu listener instead of hooking app.js — ipcRenderer
// supports multiple listeners, and every line not added to app.js is one less
// merge conflict when upstream moves.

(function () {
  const neo = window.neo;
  if (!neo || !neo.sources) return;

  const FAMILY_LABEL = {
    book: 'Book',
    document: 'Statute / document',
    dataset: 'Dataset',
    article: 'Article',
    interview: 'Interview'
  };

  // [key, label, hint, type] — rendered in order under the common fields.
  const FIELDS = {
    book: [
      ['publisher', 'Publisher'],
      ['year', 'Year'],
      ['edition', 'Edition / printing', 'Page numbers are unverifiable without this'],
      ['isbn', 'ISBN']
    ],
    document: [
      ['jurisdiction', 'Jurisdiction', 'e.g. Oklahoma'],
      ['citation', 'Citation', 'e.g. Okla. Const. art. X, § 8 — or 68 O.S. § 2802'],
      ['officialUrl', 'Official URL']
    ],
    dataset: [
      ['tableId', 'Table ID', 'e.g. B19013'],
      ['vintage', 'Vintage', 'e.g. 2022 ACS 5-year'],
      ['query', 'Query / filters'],
      ['url', 'URL'],
      ['uncertainty', 'Margin of error', 'Required for survey estimates, or mark it unavailable'],
      ['uncertaintyUnavailable', 'No margin of error published', '', 'check']
    ],
    article: [
      ['publication', 'Publication'],
      ['date', 'Published', '', 'date'],
      ['url', 'URL'],
      ['accessed', 'Accessed', '', 'date'],
      ['archiveUrl', 'Archived snapshot', 'Fetched automatically when you save with a URL']
    ],
    interview: [
      ['subjectCodeName', 'Subject', 'Use a code name. Real identities are never stored in NEO'],
      ['role', 'Role'],
      ['affiliation', 'Affiliation'],
      ['date', 'Date', '', 'date'],
      ['durationMin', 'Duration (min)'],
      ['medium', 'Medium', 'phone / in person / video'],
      ['yourLocation', 'Your location', 'Decides which recording-consent law applies'],
      ['theirLocation', 'Their location'],
      ['recorded', 'Recorded', '', 'check'],
      ['consentTimestamp', 'Consent timestamp', 'Where in the recording the on-tape consent sits'],
      ['agreedTerms', 'Agreed terms', 'on record / on background / not for attribution', 'area'],
      ['termsChanged', 'Terms changed mid-interview?', 'With the timestamp it changed'],
      ['quotesReadBack', 'Quotes read back for accuracy', '', 'check'],
      ['replySent', 'Right of reply sent', '', 'date'],
      ['replyResponse', 'Response', '', 'area'],
      ['audioPath', 'Audio file path', 'A reference only — media stays outside the library'],
      ['transcriptPath', 'Transcript path'],
      ['confidentialityPromised', 'Confidentiality promised', '', 'check']
    ]
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let backdrop = null;
  let editing = null;   // the source currently open in the form

  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------

  async function openSources() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" style="width:760px;max-height:82vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="font-size:16px;margin:0">Sources</h2>
          <span id="src-count" style="font-size:12px;color:#777"></span>
        </div>
        <div id="src-body" style="flex:1;overflow:auto;margin:14px 0"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div id="src-actions" style="display:flex;gap:8px"></div>
          <button class="src-close" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('.src-close').addEventListener('click', close);
    // On the document, not the backdrop — a div isn't focusable and would
    // never receive the keystroke.
    escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    await renderList();
  }

  let escHandler = null;

  function close() {
    if (escHandler) { document.removeEventListener('keydown', escHandler, true); escHandler = null; }
    if (backdrop) backdrop.remove();
    backdrop = null;
    editing = null;
  }

  const body = () => backdrop.querySelector('#src-body');
  const actions = () => backdrop.querySelector('#src-actions');
  const countEl = () => backdrop.querySelector('#src-count');

  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------

  async function renderList() {
    editing = null;
    const all = await neo.sources.list();
    countEl().textContent = all.length ? `${all.length} source${all.length === 1 ? '' : 's'}` : '';

    if (!all.length) {
      body().innerHTML = `<p style="color:#777;margin:24px 0">Nothing yet. Add the first source below —
        the fields you fill in now are the ones you won't have to reconstruct later.</p>`;
    } else {
      const rows = await Promise.all(all.map(async (s) => {
        const { citationBlockers } = await neo.sources.validate(s);
        const flag = citationBlockers.length
          ? `<span style="color:#c98b6b;font-size:11px;white-space:nowrap">⚠ ${citationBlockers.length} to fix</span>`
          : `<span style="color:#6b9c86;font-size:11px;white-space:nowrap">✓ citable</span>`;
        // Spelled out, not hidden in a tooltip — this is the thing you act on.
        const why = citationBlockers.length
          ? `<div style="font-size:11px;color:#8a7a5a;margin-top:4px;line-height:1.5">${citationBlockers.map((b) => '· ' + esc(b)).join('<br>')}</div>`
          : '';
        return `<div class="src-row" data-id="${esc(s.id)}" style="padding:10px 4px;border-bottom:1px solid #2a2a2a;cursor:pointer">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
              <div style="min-width:0">
                <div style="font-size:14px">${esc(s.title) || '<em style="color:#666">untitled</em>'}</div>
                <div style="font-size:11px;color:#777">${esc(FAMILY_LABEL[s.family] || s.family)}${s.author ? ' · ' + esc(s.author) : ''}</div>
              </div>
              ${flag}
            </div>
            ${why}
          </div>`;
      }));
      body().innerHTML = rows.join('');
      body().querySelectorAll('.src-row').forEach((row) => {
        row.addEventListener('click', async () => {
          const src = await neo.sources.read(row.dataset.id);
          if (src) renderForm(src);
        });
      });
    }

    actions().innerHTML = Object.keys(FAMILY_LABEL).map((f) =>
      `<button data-family="${f}" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:6px 12px;color:#aaa;font-size:12px">+ ${esc(FAMILY_LABEL[f])}</button>`
    ).join('');
    actions().querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', async () => renderForm(await neo.sources.blank(b.dataset.family)));
    });
  }

  // -------------------------------------------------------------------------
  // Form
  // -------------------------------------------------------------------------

  function field(key, label, hint, type, value) {
    const id = 'f-' + key;
    if (type === 'check') {
      return `<label style="display:flex;gap:8px;align-items:center;margin:10px 0;font-size:13px;color:#bbb">
          <input type="checkbox" id="${id}" ${value ? 'checked' : ''}/> ${esc(label)}
        </label>`;
    }
    const input = type === 'area'
      ? `<textarea id="${id}" rows="2" style="width:100%">${esc(value)}</textarea>`
      : `<input id="${id}" type="${type === 'date' ? 'date' : 'text'}" value="${esc(value)}" style="width:100%"/>`;
    return `<div style="margin:10px 0">
        <label for="${id}" style="display:block;font-size:11px;color:#888;margin-bottom:3px">${esc(label)}</label>
        ${input}
        ${hint ? `<div style="font-size:11px;color:#666;margin-top:3px">${esc(hint)}</div>` : ''}
      </div>`;
  }

  function renderForm(src) {
    editing = JSON.parse(JSON.stringify(src));
    const f = editing[editing.family] || {};

    const versions = editing.family === 'document'
      ? `<h3 style="font-size:12px;color:#888;margin:20px 0 6px;text-transform:uppercase;letter-spacing:.08em">Versions</h3>
         <p style="font-size:11px;color:#666;margin:0 0 8px">The same section is a different source in different years. Each version needs its own date and its own pinned copy.</p>
         <div id="src-versions"></div>
         <button id="src-add-version" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:5px 11px;color:#aaa;font-size:12px">+ Version</button>`
      : '';

    body().innerHTML = `
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">${esc(FAMILY_LABEL[editing.family])}</div>
      <div style="display:flex;gap:7px;margin-bottom:12px">
        <input id="src-lookup" type="text" placeholder="Title, ISBN, or citation — fill it in for me" style="flex:1"/>
        <button id="src-lookup-go" style="background:none;border:1px solid #3a4a52;border-radius:6px;padding:6px 13px;color:#9fc0cf;font-size:12px;white-space:nowrap">Look up</button>
      </div>
      <div id="src-lookup-out" style="margin-bottom:10px"></div>
      ${field('title', 'Title', '', 'text', editing.title)}
      ${field('author', 'Author', 'May be an agency or body', 'text', editing.author)}
      ${field('retrieved', 'Retrieved', '', 'date', editing.retrieved)}
      ${(FIELDS[editing.family] || []).map(([k, l, h, t]) => field(k, l, h, t, f[k])).join('')}
      ${versions}
      ${field('pageOffset', 'Page offset', 'PDF page minus printed page, so locators come out right', 'text', editing.pageOffset)}
      ${field('notes', 'Notes', '', 'area', editing.notes)}
      ${field('confidential', 'Confidential — keep out of any cloud request', '', 'check', editing.confidential)}
      <div style="margin:14px 0 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="src-attach" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:6px 12px;color:#aaa;font-size:12px">Attach document…</button>
        <span id="src-file" style="font-size:11px;color:#777">${editing.file ? esc(editing.file) + ' · ' + esc(String(editing.sha256).slice(0, 12)) : 'no file pinned'}</span>
      </div>
      <div id="src-problems" style="margin-top:12px"></div>`;

    if (editing.family === 'document') {
      renderVersions();
      backdrop.querySelector('#src-add-version').addEventListener('click', async () => {
        harvest();
        editing.document.versions.push(await neo.sources.blankVersion());
        renderForm(editing);
      });
    }

    backdrop.querySelector('#src-lookup-go').addEventListener('click', lookup);
    backdrop.querySelector('#src-lookup').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); lookup(); }
    });

    backdrop.querySelector('#src-attach').addEventListener('click', async () => {
      harvest();
      const res = await neo.sources.attach(editing.id, null);
      if (res) {
        editing.file = res.file;
        editing.sha256 = res.sha256;
        editing.textFile = res.textFile || '';
        renderForm(editing);
      }
    });

    actions().innerHTML = `
      <button id="src-save" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919">Save</button>
      <button id="src-back" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 14px;color:#888">Back</button>
      <button id="src-del" style="background:none;border:none;color:#7a4b42;font-size:12px">Delete</button>`;
    actions().querySelector('#src-back').addEventListener('click', renderList);
    actions().querySelector('#src-save').addEventListener('click', save);

    // Say what's outstanding the moment the form opens, rather than making the
    // author press Save to find out.
    neo.sources.validate(editing).then((check) => {
      if (check.errors.length || check.citationBlockers.length) {
        showProblems(check.errors, check.citationBlockers);
      }
    });
    actions().querySelector('#src-del').addEventListener('click', async () => {
      if (!confirm('Move this source to the Trash?')) return;
      await neo.sources.remove(editing.id);
      renderList();
    });
  }

  function renderVersions() {
    const host = backdrop.querySelector('#src-versions');
    const vs = editing.document.versions || [];
    host.innerHTML = vs.map((v, i) => `
      <div style="border:1px solid #2f2f2f;border-radius:6px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:130px">
            <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Effective date</label>
            <input class="v-eff" data-i="${i}" type="date" value="${esc(v.effectiveDate)}" style="width:100%"/>
          </div>
          <div style="flex:1;min-width:130px">
            <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Retrieved as of</label>
            <input class="v-asof" data-i="${i}" type="date" value="${esc(v.asOf)}" style="width:100%"/>
          </div>
        </div>
        <div style="margin-top:8px">
          <label style="display:block;font-size:11px;color:#888;margin-bottom:3px">Note</label>
          <input class="v-note" data-i="${i}" type="text" value="${esc(v.note)}" style="width:100%"/>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="v-attach" data-i="${i}" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:4px 10px;color:#aaa;font-size:11px">Attach text…</button>
          <span style="font-size:11px;color:#777">${v.file ? esc(v.file) : 'no copy pinned'}</span>
          ${v.sha256 ? `<span style="font-size:10px;color:#5f6f66" title="fingerprint of this version's file">${esc(String(v.sha256).slice(0, 10))}</span>` : ''}
          ${v.textFile ? `<span style="font-size:10px;color:#6b9c86">searchable</span>` : ''}
        </div>
      </div>`).join('');

    host.querySelectorAll('.v-attach').forEach((b) => {
      b.addEventListener('click', async () => {
        harvest();
        const v = editing.document.versions[Number(b.dataset.i)];
        const res = await neo.sources.attach(editing.id, v.id);
        if (res) {
          v.file = res.file;
          v.sha256 = res.sha256;
          v.textFile = res.textFile || '';
          renderForm(editing);
        }
      });
    });
  }

  // Pull the form back into the record before any save or re-render, so
  // typing is never lost to a redraw.
  function harvest() {
    const val = (k) => {
      const el = backdrop.querySelector('#f-' + k);
      if (!el) return undefined;
      return el.type === 'checkbox' ? el.checked : el.value;
    };
    ['title', 'author', 'retrieved', 'notes'].forEach((k) => {
      const v = val(k); if (v !== undefined) editing[k] = v;
    });
    const off = val('pageOffset');
    if (off !== undefined) editing.pageOffset = Number(off) || 0;
    const conf = val('confidential');
    if (conf !== undefined) editing.confidential = conf;

    const f = editing[editing.family];
    (FIELDS[editing.family] || []).forEach(([k]) => {
      const v = val(k); if (v !== undefined) f[k] = v;
    });

    if (editing.family === 'document') {
      backdrop.querySelectorAll('.v-eff').forEach((el) => { editing.document.versions[Number(el.dataset.i)].effectiveDate = el.value; });
      backdrop.querySelectorAll('.v-asof').forEach((el) => { editing.document.versions[Number(el.dataset.i)].asOf = el.value; });
      backdrop.querySelectorAll('.v-note').forEach((el) => { editing.document.versions[Number(el.dataset.i)].note = el.value; });
    }
  }

  async function save() {
    harvest();

    // Archive on the way in: government links rot, and a snapshot taken later
    // is a snapshot of whatever the page became.
    const f = editing[editing.family];
    if (editing.family === 'article' && f.url && !f.archiveUrl) {
      showProblems([], [], 'Archiving to the Wayback Machine…');
      const res = await neo.sources.archive(f.url);
      if (res && res.url) { f.archiveUrl = res.url; f.archiveError = ''; }
      else { f.archiveError = (res && res.error) || 'archive failed'; }
    }

    const out = await neo.sources.save(editing);
    if (!out.ok) return showProblems(out.errors, out.citationBlockers);
    editing = out.source;
    renderForm(editing);
    showProblems([], out.citationBlockers, 'Saved.');
  }

  // Fill the form from a catalogue record or the model. Nothing is saved —
  // the fields land in the form for the author to look over.
  async function lookup() {
    const out = backdrop.querySelector('#src-lookup-out');
    const q = backdrop.querySelector('#src-lookup').value.trim();
    if (!q) return;
    out.innerHTML = `<div style="font-size:12px;color:#777">Looking…</div>`;

    harvest();
    const res = await neo.ai.lookupSource(q, editing.family);
    if (!res.ok) {
      out.innerHTML = `<div style="font-size:12px;color:#c98b6b">${esc(res.error)}</div>`;
      return;
    }

    const f = res.fields;
    const put = (obj, key, val) => { if (val && !String(obj[key] || '').trim()) obj[key] = val; };
    put(editing, 'title', f.title);
    put(editing, 'author', f.author);
    const fam = editing[editing.family];
    ['publisher', 'year', 'edition', 'isbn', 'jurisdiction', 'citation', 'publication', 'url']
      .forEach((k) => { if (k in fam) put(fam, k, f[k]); });
    editing.metadataSource = f.source || '';

    renderForm(editing);
    backdrop.querySelector('#src-lookup-out').innerHTML = `
      <div style="border-left:3px solid #4d6b7a;background:#1b2429;padding:9px 12px">
        <div style="font-size:11px;color:#9fc0cf">Filled from <b>${esc(f.source || 'unknown')}</b>. Empty fields were left empty rather than guessed.</div>
        ${f.caution ? `<div style="font-size:11px;color:#c9a96b;margin-top:4px">Check first: ${esc(f.caution)}</div>` : ''}
        ${(res.candidates || []).length > 1 ? `<div style="font-size:11px;color:#777;margin-top:4px">${res.candidates.length} catalogue matches — if this is the wrong printing, search by ISBN.</div>` : ''}
      </div>`;
  }

  function showProblems(errors, blockers, note) {
    const host = backdrop.querySelector('#src-problems');
    if (!host) return;
    const bits = [];
    if (note) bits.push(`<div style="font-size:12px;color:#6b9c86;margin-bottom:6px">${esc(note)}</div>`);
    if (errors && errors.length) {
      bits.push(`<div style="border-left:3px solid #a05548;background:#2a1d1a;padding:8px 12px;margin-bottom:6px">
        <div style="font-size:11px;color:#c98b6b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Can't save yet</div>
        ${errors.map((e) => `<div style="font-size:12px;color:#ddc4bd">${esc(e)}</div>`).join('')}</div>`);
    }
    if (blockers && blockers.length) {
      bits.push(`<div style="border-left:3px solid #7a6a3a;background:#25220f;padding:8px 12px">
        <div style="font-size:11px;color:#b7a469;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Saved, but not citable until</div>
        ${blockers.map((b) => `<div style="font-size:12px;color:#d8cfae">${esc(b)}</div>`).join('')}</div>`);
    }
    host.innerHTML = bits.join('');
  }

  // Turn somebody's works-cited list into source records. They arrive
  // unverified and uncitable, which is correct — a bibliography entry is a
  // claim about a work, not the work.
  async function importBibliography() {
    const res = await neo.ai.importBibliography();
    if (!res.ok) { alert(res.error === 'cancelled' ? '' : res.error); return; }
    if (!res.entries.length) { alert('No bibliography entries found in that file.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.style.zIndex = '960';
    bd.innerHTML = `<div class="modal" style="width:min(720px,94vw);max-height:84vh;display:flex;flex-direction:column">
        <h2 style="font-size:16px;margin:0 0 4px">${res.entries.length} entries from ${esc(res.file)}</h2>
        <p style="font-size:12px;color:#888;margin:0 0 12px">Untick anything you don't want. They come in
          unverified and uncitable — no edition, no pinned copy — so each becomes a research to-do rather
          than a finished source.</p>
        <div id="bib-list" style="flex:1;overflow:auto"></div>
        <div style="display:flex;justify-content:space-between;margin-top:14px">
          <button id="bib-go" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919">Add the ticked ones</button>
          <button id="bib-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 16px;color:#888">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(bd);

    bd.querySelector('#bib-list').innerHTML = res.entries.map((e, i) => `
      <label style="display:flex;gap:9px;padding:8px 4px;border-bottom:1px solid #2a2a2a;cursor:pointer">
        <input type="checkbox" data-i="${i}" checked style="margin-top:3px"/>
        <span style="min-width:0">
          <span style="font-size:12px;color:#ddd">${esc(e.title) || '<em style="color:#666">untitled</em>'}</span>
          <span style="display:block;font-size:11px;color:#777;margin-top:2px">${esc(e.author)}${e.year ? ' · ' + esc(e.year) : ''}${e.publisher ? ' · ' + esc(e.publisher) : ''} <span style="color:#5f6f66">[${esc(e.family)}]</span></span>
        </span>
      </label>`).join('');

    const shut = () => bd.remove();
    bd.querySelector('#bib-x').addEventListener('click', shut);
    bd.querySelector('#bib-go').addEventListener('click', async () => {
      const picks = [...bd.querySelectorAll('input:checked')].map((c) => res.entries[Number(c.dataset.i)]);
      let added = 0;
      for (const e of picks) {
        const fam = ['book', 'document', 'dataset', 'article', 'interview'].includes(e.family) ? e.family : 'book';
        const s = await neo.sources.blank(fam);
        s.title = e.title; s.author = e.author;
        s.metadataSource = 'bibliography';
        s.notes = `Imported from the works cited of ${res.file} on ${new Date().toISOString().slice(0, 10)}.\nUNVERIFIED — entry as printed:\n${e.raw}`;
        const f = s[fam];
        if ('publisher' in f) f.publisher = e.publisher || '';
        if ('year' in f) f.year = e.year || '';
        if ('publication' in f) f.publication = e.publication || '';
        if ('url' in f) f.url = e.url || '';
        const out = await neo.sources.save(s);
        if (out.ok) added++;
      }
      shut();
      alert(`${added} source${added === 1 ? '' : 's'} added, all unverified.`);
      renderList();
    });
  }

  // Its own menu listener — app.js is left untouched.
  neo.onMenu((msg) => {
    if (!msg) return;
    if (msg.type === 'sources') openSources();
    if (msg.type === 'importBib') importBibliography();
  });

  window.openSources = openSources;
})();
