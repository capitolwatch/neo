// NEO — the endnotes panel.
//
// Shows the apparatus your manuscript's anchors imply: numbered notes in
// document order, a bibliography, and a separate table of authorities for
// statutes and constitutional provisions.
//
// Gaps show as [publisher missing] rather than being filled in. That is the
// point — an obvious gap gets fixed, a plausible invention gets printed.

(function () {
  const neo = window.neo;
  if (!neo || !neo.citations) return;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const currentBook = () => { try { return book; } catch { return null; } };

  async function open() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(820px,95vw);max-height:88vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="font-size:16px;margin:0">Endnotes &amp; bibliography</h2>
          <span id="cx-meta" style="font-size:12px;color:#777"></span>
        </div>
        <div id="cx-body" style="flex:1;overflow:auto;margin:14px 0;font-size:13px;line-height:1.7;color:#ccc">Reading the manuscript…</div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div style="display:flex;gap:8px">
            <button id="cx-save" style="background:var(--accent);border:none;border-radius:6px;padding:7px 15px;color:#191919" disabled>Save beside the book</button>
            <button id="cx-copy" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 14px;color:#aaa" disabled>Copy</button>
          </div>
          <button id="cx-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 16px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);

    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) shut(); });
    bd.querySelector('#cx-x').addEventListener('click', shut);

    const out = await neo.citations.build(bk.id);
    const host = bd.querySelector('#cx-body');
    if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }

    if (!out.notes.length) {
      host.innerHTML = `<p style="color:#999">No citations yet.</p>
        <p style="color:#777;font-size:12px">Notes are generated from cards you place in the manuscript with ⌘⇧K.
        Capture a passage in reading mode, put it in the page, and it appears here.</p>`;
      return;
    }

    bd.querySelector('#cx-meta').textContent =
      `${out.notes.length} note${out.notes.length === 1 ? '' : 's'} · ${out.sources} source${out.sources === 1 ? '' : 's'}`;

    const section = (title, items, ordered) => !items.length ? '' : `
      <h3 style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.09em;margin:22px 0 9px">${esc(title)}</h3>
      <${ordered ? 'ol' : 'div'} style="${ordered ? 'padding-left:22px;margin:0' : ''}">
        ${items.map((x) => ordered
          ? `<li style="margin-bottom:7px">${x}</li>`
          : `<div style="margin-bottom:8px;padding-left:22px;text-indent:-22px">${x}</div>`).join('')}
      </${ordered ? 'ol' : 'div'}>`;

    host.innerHTML =
      (out.problems.length ? `
        <div style="border-left:3px solid #7a6a3a;background:#25220f;padding:10px 13px;margin-bottom:6px">
          <div style="font-size:10px;color:#b7a469;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">${out.problems.length} to resolve before this is publishable</div>
          ${out.problems.slice(0, 12).map((p) => `<div style="font-size:12px;color:#d8cfae;margin-bottom:3px">${esc(p.why)}${p.text ? ` — “${esc(p.text)}…”` : ''}</div>`).join('')}
          ${out.problems.length > 12 ? `<div style="font-size:11px;color:#8a7a5a;margin-top:4px">and ${out.problems.length - 12} more</div>` : ''}
        </div>` : '') +
      (out.gaps.length ? `
        <div style="font-size:11px;color:#8a7a5a;margin-bottom:10px">Fields NEO doesn't have: ${out.gaps.map(esc).join(' · ')} — these print literally rather than being guessed.</div>` : '') +
      section('Notes', out.notes.map((n) =>
        `${n.text}${n.unverified ? ` <span style="color:#c9a96b;font-size:11px">· quote unverified</span>` : ''}`), true) +
      section('Bibliography', out.works, false) +
      section('Statutes and constitutional provisions', out.legal, false);

    const buildHTML = () => `<h1>Notes</h1><ol>${out.notes.map((n) => `<li>${n.text}</li>`).join('')}</ol>` +
      (out.works.length ? `<h1>Bibliography</h1>${out.works.map((w) => `<p>${w}</p>`).join('')}` : '') +
      (out.legal.length ? `<h1>Statutes and Constitutional Provisions</h1>${out.legal.map((w) => `<p>${w}</p>`).join('')}` : '');

    const save = bd.querySelector('#cx-save');
    const copy = bd.querySelector('#cx-copy');
    save.disabled = false;
    copy.disabled = false;
    save.addEventListener('click', async () => {
      const p = await neo.citations.save(bk.id, buildHTML());
      save.textContent = p ? 'Saved as endnotes.html' : 'Could not save';
      save.disabled = true;
    });
    copy.addEventListener('click', async () => {
      const plain = buildHTML().replace(/<\/?(h1|ol|li|p|em)[^>]*>/g, (m) =>
        (/h1|p|li/.test(m) && m.startsWith('</')) ? '\n' : (m.includes('em') ? '' : ''));
      await navigator.clipboard.writeText(plain.replace(/\n{3,}/g, '\n\n').trim());
      copy.textContent = 'Copied';
    });
  }

  // -------------------------------------------------------------------------
  // The fact-check dossier
  // -------------------------------------------------------------------------

  async function openDossier() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(900px,96vw);max-height:90vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="font-size:16px;margin:0">Fact-check dossier</h2>
          <span id="dx-meta" style="font-size:12px;color:#777"></span>
        </div>
        <div id="dx-body" style="flex:1;overflow:auto;margin:14px 0"></div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <button id="dx-save" style="background:var(--accent);border:none;border-radius:6px;padding:7px 15px;color:#191919" disabled>Save beside the book</button>
          <button id="dx-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 16px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) shut(); });
    bd.querySelector('#dx-x').addEventListener('click', shut);

    const out = await neo.citations.dossier(bk.id);
    const host = bd.querySelector('#dx-body');
    if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }
    if (!out.entries.length) {
      host.innerHTML = `<p style="color:#999">Nothing sourced yet.</p>
        <p style="color:#777;font-size:12px">The dossier is built from cards placed in the manuscript with ⌘⇧K.</p>`;
      return;
    }

    bd.querySelector('#dx-meta').textContent =
      `${out.entries.length} sourced claim${out.entries.length === 1 ? '' : 's'}` +
      (out.unverified ? ` · ${out.unverified} unverified` : '') +
      (out.noLocator ? ` · ${out.noLocator} without a locator` : '');

    const row = (e, i) => `
      <div style="border:1px solid #2c2c2c;border-radius:7px;padding:12px 14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:10px;color:#777;margin-bottom:7px">
          <span>${i + 1}${e.chapter ? ' · ' + esc(e.chapter) : ''}</span>
          <span>${e.verified ? '<span style="color:#6b9c86">verified</span>' : '<span style="color:#c9a96b">NOT VERIFIED</span>'}</span>
        </div>
        <div style="font-size:13px;color:#ddd;line-height:1.6;margin-bottom:9px">${esc(e.claim)}</div>
        <table style="width:100%;font-size:11px;color:#9aa5aa;border-collapse:collapse">
          <tr><td style="width:98px;color:#6d777c;padding:2px 0">source</td><td>${esc(e.source)}${e.author ? ' — ' + esc(e.author) : ''}</td></tr>
          ${e.version ? `<tr><td style="color:#6d777c;padding:2px 0">version</td><td>${esc(e.version)}</td></tr>` : ''}
          <tr><td style="color:#6d777c;padding:2px 0">locator</td><td>${e.locator ? esc(e.locator) : '<span style="color:#c98b6b">none — reader cannot find this</span>'}</td></tr>
          ${e.fingerprint ? `<tr><td style="color:#6d777c;padding:2px 0">sha-256</td><td style="font-family:monospace">${esc(String(e.fingerprint).slice(0, 24))}…</td></tr>` : ''}
          ${e.method ? `<tr><td style="color:#6d777c;padding:2px 0">method</td><td>${esc(e.method)}</td></tr>` : ''}
        </table>
        ${e.captured ? `<div style="margin-top:9px;padding:8px 11px;background:#1e1e1e;border-left:2px solid #4d6b7a;font-size:12px;color:#c6cfd3;font-style:italic">${esc(e.captured)}</div>` : ''}
      </div>`;

    host.innerHTML =
      (out.confidentialHeld ? `<div style="font-size:11px;color:#c9a96b;margin-bottom:12px">
        ${out.confidentialHeld} claim${out.confidentialHeld === 1 ? '' : 's'} rest${out.confidentialHeld === 1 ? 's' : ''} on a confidential source.
        The subject appears by code name only; supply real identities to counsel separately, never through this file.</div>` : '') +
      out.entries.map(row).join('');

    const save = bd.querySelector('#dx-save');
    save.disabled = false;
    save.addEventListener('click', async () => {
      const html = `<h1>Fact-check dossier — ${esc(bk.title)}</h1>` +
        `<p>${out.entries.length} sourced claims. Generated ${new Date().toISOString().slice(0, 10)}.</p>` +
        out.entries.map((e, i) => `
          <h3>${i + 1}. ${esc(e.chapter)}</h3>
          <p><b>Claim:</b> ${esc(e.claim)}</p>
          <p><b>Source:</b> ${esc(e.source)}${e.author ? ' — ' + esc(e.author) : ''}<br>
             <b>Locator:</b> ${esc(e.locator || 'NONE')}<br>
             ${e.version ? `<b>Version:</b> ${esc(e.version)}<br>` : ''}
             ${e.fingerprint ? `<b>SHA-256:</b> ${esc(e.fingerprint)}<br>` : ''}
             <b>Verified against source:</b> ${e.verified ? 'yes' : 'NO'}</p>
          ${e.captured ? `<blockquote>${esc(e.captured)}</blockquote>` : ''}`).join('');
      const p = await neo.citations.saveDossier(bk.id, html);
      save.textContent = p ? 'Saved as fact-check.html' : 'Could not save';
      save.disabled = true;
    });
  }

  async function exportSubmission() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }
    const out = await neo.submission.export(bk.id);
    if (!out.ok) { if (out.error !== 'cancelled') alert(out.error); return; }
    alert(
      `Exported.\n\n` +
      `${out.words.toLocaleString()} words · ${out.notes} note${out.notes === 1 ? '' : 's'} · ` +
      `${out.works} bibliography entr${out.works === 1 ? 'y' : 'ies'}\n\n` +
      `Double-spaced Times New Roman, running header, notes as real Word endnotes.` +
      (out.gaps.length ? `\n\nStill printing as gaps: ${out.gaps.join(', ')}` : '')
    );
  }

  neo.onMenu((msg) => {
    if (!msg) return;
    if (msg.type === 'submission') exportSubmission();
    if (msg.type === 'citations') open();
    if (msg.type === 'dossier') openDossier();
  });
  window.openCitations = open;
  window.openDossier = openDossier;
})();
