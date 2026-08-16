// NEO — the rigor audit.
//
// Reads the manuscript against the evidence on file and reports where the
// prose outruns what the cards actually support. Every finding is a pointer
// back into the author's own material — nothing here asserts a fact, supplies
// a citation, or edits a word.
//
// It cannot tell you whether a claim is true. It can tell you whether it is
// supported, and whether it is stated more strongly than the evidence allows.

(function () {
  const neo = window.neo;
  if (!neo || !neo.ai) return;

  const SEVERITY = {
    blocking: { label: 'Unsupported', color: '#a05548', bg: '#2a1d1a', text: '#ddc4bd' },
    check:    { label: 'Check this',  color: '#7a6a3a', bg: '#25220f', text: '#d8cfae' },
    note:     { label: 'Worth noting', color: '#4d6b7a', bg: '#1b2429', text: '#cfd8dd' }
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const currentBook = () => { try { return book; } catch { return null; } };

  let backdrop = null;
  let escHandler = null;

  function close() {
    if (escHandler) { document.removeEventListener('keydown', escHandler, true); escHandler = null; }
    if (backdrop) backdrop.remove();
    backdrop = null;
  }

  async function openAudit() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }
    if (backdrop) return;

    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" style="width:min(760px,94vw);max-height:86vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="font-size:16px;margin:0">Rigor audit</h2>
          <span id="au-meta" style="font-size:12px;color:#777"></span>
        </div>
        <div id="au-body" style="flex:1;overflow:auto;margin:14px 0"></div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <button id="au-run" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919">Run the audit</button>
          <button id="au-close" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#au-close').addEventListener('click', close);
    backdrop.querySelector('#au-run').addEventListener('click', run);

    backdrop.querySelector('#au-body').innerHTML = `
      <p style="color:#999;font-size:13px;line-height:1.6;margin:0 0 12px">
        This reads your whole manuscript against every card you've captured, and reports where a
        claim has nothing behind it, where causal language outruns the evidence, where a statistic
        is missing its uncertainty, and where a quote has drifted from what you captured.
      </p>
      <p style="color:#777;font-size:12px;line-height:1.6;margin:0">
        It points at your own material. It never supplies a fact, a page number, or a citation —
        where something is unsupported it says so rather than filling the gap. Findings are a place
        to look, not a verdict.
      </p>`;
  }

  async function run() {
    const bk = currentBook();
    const body = backdrop.querySelector('#au-body');
    const btn = backdrop.querySelector('#au-run');
    btn.disabled = true;
    btn.textContent = 'Reading…';
    body.innerHTML = `<div style="color:#777;font-size:13px">Reading the manuscript against your cards. This one takes a while — it's thinking hard on purpose.</div>`;

    const out = await neo.ai.audit(bk.id);
    btn.disabled = false;
    btn.textContent = 'Run again';

    if (!out.ok) {
      body.innerHTML = `<div style="border-left:3px solid #a05548;background:#2a1d1a;padding:10px 12px;font-size:13px;color:#ddc4bd">${esc(out.error)}</div>`;
      return;
    }

    backdrop.querySelector('#au-meta').textContent =
      `${out.cardCount} card${out.cardCount === 1 ? '' : 's'} consulted` +
      (out.withheld ? ` · ${out.withheld} withheld as confidential` : '');

    const findings = out.findings || [];
    const order = ['blocking', 'check', 'note'];
    findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

    body.innerHTML = `
      <div style="font-size:13px;color:#bbb;line-height:1.6;margin-bottom:14px">${esc(out.summary)}</div>
      ${out.withheld ? `<div style="font-size:11px;color:#8a7a5a;margin-bottom:12px">${out.withheld} card${out.withheld === 1 ? '' : 's'} from confidential sources were withheld from this audit and not read.</div>` : ''}
      ${findings.length
        ? findings.map(finding).join('')
        : `<div style="color:#6b9c86;font-size:13px">Nothing flagged. That is not the same as nothing wrong — it means nothing visible from the manuscript and the cards on file.</div>`}`;
  }

  function finding(f) {
    const s = SEVERITY[f.severity] || SEVERITY.note;
    return `
      <div style="border-left:3px solid ${s.color};background:${s.bg};padding:11px 14px;margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px">
          <span style="font-size:10px;color:${s.color};text-transform:uppercase;letter-spacing:.09em;font-weight:600">${esc(s.label)}</span>
          <span style="font-size:10px;color:#777">${esc(f.kind)}</span>
        </div>
        <div style="font-size:13px;color:${s.text};font-style:italic;line-height:1.5;margin-bottom:7px">“${esc(f.passage)}”</div>
        <div style="font-size:12px;color:#aaa;line-height:1.55;margin-bottom:5px">${esc(f.why)}</div>
        <div style="font-size:12px;color:#8fa89b;line-height:1.55">→ ${esc(f.fix)}</div>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // Prose check — is any of the model's wording in your book?
  // Deterministic: string matching against a log of everything it ever said.
  // -------------------------------------------------------------------------

  async function openProseCheck() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(660px,92vw);max-height:80vh;overflow:auto">
        <h2 style="font-size:16px;margin:0 0 10px">Check my prose</h2>
        <div id="pc-body" style="font-size:13px;color:#999;line-height:1.6">Comparing…</div>
        <div style="text-align:right;margin-top:16px">
          <button id="pc-close" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) shut(); });
    bd.querySelector('#pc-close').addEventListener('click', shut);

    const out = await neo.ai.proseCheck(bk.id, 8);
    const host = bd.querySelector('#pc-body');

    if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }

    if (!out.matches.length) {
      host.innerHTML = `
        <div style="color:#6b9c86;margin-bottom:10px">No AI wording found in your manuscript.</div>
        <div style="color:#888">Compared every run of ${out.run || 8} consecutive words against
          ${out.outputs} recorded AI output${out.outputs === 1 ? '' : 's'}.
          ${esc(out.note || '')}</div>
        <div style="color:#777;font-size:12px;margin-top:10px">This is a string comparison, not a style guess —
          it can only find wording the model actually produced here. It says nothing about text from anywhere else.</div>`;
      return;
    }

    host.innerHTML = `
      <div style="color:#c9a96b;margin-bottom:12px">${out.matches.length} passage${out.matches.length === 1 ? '' : 's'}
        in your manuscript match wording the model produced. A match means look, not guilty —
        ordinary phrasing collides sometimes.</div>
      ${out.matches.map((m) => `
        <div style="border-left:3px solid #7a6a3a;background:#25220f;padding:9px 12px;margin-bottom:8px">
          <div style="font-size:12px;color:#d8cfae;font-style:italic">“${esc(m.phrase)}”</div>
          <div style="font-size:10px;color:#8a7a5a;margin-top:4px">from a ${esc(m.from)} on ${esc(String(m.at).slice(0, 10))}</div>
        </div>`).join('')}`;
  }

  neo.onMenu((msg) => {
    if (!msg) return;
    if (msg.type === 'audit') openAudit();
    if (msg.type === 'proseCheck') openProseCheck();
  });
  window.openAudit = openAudit;
  window.openProseCheck = openProseCheck;
})();
