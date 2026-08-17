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

  // -------------------------------------------------------------------------
  // What the board is missing
  //
  // Two halves, deliberately separated. How many sources hold up a theme is
  // arithmetic and gets counted. What argument has nothing behind it is a
  // judgement and gets asked — but only about the shape of missing evidence,
  // never its content.
  // -------------------------------------------------------------------------

  async function openGaps() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(760px,94vw);max-height:86vh;display:flex;flex-direction:column">
        <h2 style="font-size:16px;margin:0 0 12px">What's missing</h2>
        <div id="gx-body" style="flex:1;overflow:auto;font-size:13px;color:#999;line-height:1.65">Reading the board…</div>
        <div style="text-align:right;margin-top:14px">
          <button id="gx-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) shut(); });
    bd.querySelector('#gx-x').addEventListener('click', shut);

    const out = await neo.ai.gaps(bk.id);
    const host = bd.querySelector('#gx-body');
    if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }

    const structural = (out.structural || []).length ? `
      <h3 style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.09em;margin:0 0 9px">Counted from your board</h3>
      ${out.structural.map((s) => `
        <div style="border-left:3px solid #7a6a3a;background:#25220f;padding:9px 12px;margin-bottom:7px">
          <div style="font-size:12px;color:#d8cfae"><b>${esc(s.theme)}</b> — ${esc(s.issue)}</div>
        </div>`).join('')}` : '';

    const conceptual = (out.conceptual || []).length ? `
      <h3 style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.09em;margin:22px 0 9px">Arguments with nothing behind them</h3>
      ${out.conceptual.map((g) => `
        <div style="border-left:3px solid #4d6b7a;background:#1b2429;padding:10px 13px;margin-bottom:8px">
          <div style="font-size:13px;color:#cfd8dd;margin-bottom:4px">${esc(g.missing)}</div>
          <div style="font-size:12px;color:#93a5ad;margin-bottom:4px">${esc(g.why)}</div>
          <div style="font-size:12px;color:#8fa89b">→ ${esc(g.evidence)}</div>
        </div>`).join('')}` : '';

    host.innerHTML =
      (out.verdict ? `<div style="color:#bbb;margin-bottom:16px">${esc(out.verdict)}</div>` : '') +
      (out.unfiled ? `<div style="font-size:12px;color:#8a7a5a;margin-bottom:14px">${out.unfiled} card${out.unfiled === 1 ? '' : 's'} still unfiled — a pile that doesn't fit anywhere is often a theme you haven't named yet.</div>` : '') +
      structural + conceptual +
      (!structural && !conceptual ? `<div style="color:#6b9c86">Nothing flagged. That means nothing visible from the board — it says nothing about evidence you haven't captured.</div>` : '') +
      (out.note ? `<div style="font-size:11px;color:#777;margin-top:16px">${esc(out.note)}</div>` : '');
  }

  // -------------------------------------------------------------------------
  // Figures that disagree with themselves
  // -------------------------------------------------------------------------

  async function openConsistency() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(760px,94vw);max-height:86vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="font-size:16px;margin:0">Figures that disagree</h2>
          <span id="kx-meta" style="font-size:12px;color:#777"></span>
        </div>
        <div id="kx-body" style="flex:1;overflow:auto;margin:14px 0;font-size:13px;color:#999;line-height:1.65">Reading every figure in the manuscript…</div>
        <div style="text-align:right"><button id="kx-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#888">Close</button></div>
      </div>`;
    document.body.appendChild(bd);
    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) shut(); });
    bd.querySelector('#kx-x').addEventListener('click', shut);

    const out = await neo.ai.consistency(bk.id);
    const host = bd.querySelector('#kx-body');
    if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }

    bd.querySelector('#kx-meta').textContent = `${out.counted} figure${out.counted === 1 ? '' : 's'} compared`;

    if (!out.findings.length) {
      host.innerHTML = `<div style="color:#6b9c86">No two figures appear to describe the same quantity differently.</div>
        <div style="color:#777;font-size:12px;margin-top:8px">${esc(out.note || out.verdict || '')}</div>
        <div style="color:#777;font-size:12px;margin-top:8px">This compares your numbers against each other. It cannot tell you whether any of them is right.</div>`;
      return;
    }

    host.innerHTML =
      (out.verdict ? `<div style="color:#bbb;margin-bottom:14px">${esc(out.verdict)}</div>` : '') +
      out.findings.map((f) => `
        <div style="border-left:3px solid #a05548;background:#2a1d1a;padding:11px 14px;margin-bottom:10px">
          <div style="font-size:10px;color:#c98b6b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">${esc(f.quantity)}</div>
          <div style="font-size:12px;color:#ddc4bd;margin-bottom:5px">“${esc(f.a)}”</div>
          <div style="font-size:12px;color:#ddc4bd;margin-bottom:6px">“${esc(f.b)}”</div>
          <div style="font-size:12px;color:#aa9791">${esc(f.why)}</div>
        </div>`).join('') +
      `<div style="color:#777;font-size:12px;margin-top:10px">Which figure is right is yours to determine — this only shows that two of them disagree.</div>`;
  }

  // -------------------------------------------------------------------------
  // The hostile reviewer
  //
  // The audit asks whether a claim is supported. This asks whether the
  // reasoning holds — the thing provenance can never settle, and the first
  // place a reviewer goes when a book argues that one policy caused an outcome.
  // -------------------------------------------------------------------------

  const FORCE = {
    fatal:   { label: 'Fatal',   color: '#a05548', bg: '#2a1d1a', text: '#ddc4bd' },
    serious: { label: 'Serious', color: '#7a6a3a', bg: '#25220f', text: '#d8cfae' },
    minor:   { label: 'Minor',   color: '#4d6b7a', bg: '#1b2429', text: '#cfd8dd' }
  };

  async function openHostile() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(800px,95vw);max-height:88vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="font-size:16px;margin:0">The unconvinced reader</h2>
          <select id="hx-chapter" style="max-width:280px"></select>
        </div>
        <div id="hx-body" style="flex:1;overflow:auto;margin:14px 0;font-size:13px;color:#999;line-height:1.65"></div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <button id="hx-go" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919">Have at it</button>
          <button id="hx-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 16px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) shut(); });
    bd.querySelector('#hx-x').addEventListener('click', shut);

    const sel = bd.querySelector('#hx-chapter');
    sel.innerHTML = `<option value="">the whole book</option>` +
      (bk.chapterOrder || []).map((id, i) => {
        const t = (bk.chapterTitles && bk.chapterTitles[id]) || (bk.chapterNotes && bk.chapterNotes[id]) || '';
        return `<option value="${id}">${i + 1}. ${esc(t || 'untitled')}</option>`;
      }).join('');

    bd.querySelector('#hx-body').innerHTML = `
      <p style="color:#999;margin:0 0 10px">A public-finance economist who isn't convinced, reading for weak points —
      causal claims the evidence can't carry, alternative explanations you haven't addressed, cases that look chosen
      because they fit, magnitudes that might not survive their own uncertainty.</p>
      <p style="color:#777;font-size:12px;margin:0">It knows nothing about Oklahoma beyond your text and is barred from
      asserting any fact, figure or source of its own. It attacks what's on the page and says what would answer it.
      This is the one thing provenance can't do for you.</p>`;

    bd.querySelector('#hx-go').addEventListener('click', async () => {
      const btn = bd.querySelector('#hx-go');
      btn.disabled = true; btn.textContent = 'Reading closely…';
      const host = bd.querySelector('#hx-body');
      host.innerHTML = `<div style="color:#777">Thinking hard about this one — it runs at high effort.</div>`;

      const out = await neo.ai.hostileReview(bk.id, sel.value || null);
      btn.disabled = false; btn.textContent = 'Again';
      if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }

      host.innerHTML =
        (out.verdict ? `<div style="color:#bbb;margin-bottom:14px">${esc(out.verdict)}</div>` : '') +
        (out.strongest ? `<div style="border-left:3px solid #4f7a5f;background:#16231b;padding:10px 13px;margin-bottom:14px">
            <div style="font-size:10px;color:#7fae8c;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Holds up best</div>
            <div style="font-size:12px;color:#c3d6c8">${esc(out.strongest)}</div>
          </div>` : '') +
        (out.challenges.length ? out.challenges.map((c) => {
          const f = FORCE[c.force] || FORCE.minor;
          return `<div style="border-left:3px solid ${f.color};background:${f.bg};padding:11px 14px;margin-bottom:9px">
            <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px">
              <span style="font-size:10px;color:${f.color};text-transform:uppercase;letter-spacing:.09em;font-weight:600">${esc(f.label)}</span>
              <span style="font-size:10px;color:#777">${esc(c.kind)}</span>
            </div>
            <div style="font-size:12px;color:${f.text};font-style:italic;margin-bottom:7px">“${esc(c.passage)}”</div>
            <div style="font-size:12px;color:#aaa;line-height:1.55;margin-bottom:5px">${esc(c.objection)}</div>
            <div style="font-size:12px;color:#8fa89b;line-height:1.55">→ ${esc(c.answer)}</div>
          </div>`;
        }).join('') : `<div style="color:#6b9c86">No objections raised.</div>`);
    });
  }

  // -------------------------------------------------------------------------
  // Interview preparation
  // -------------------------------------------------------------------------

  async function openInterviewPrep() {
    const bk = currentBook();
    if (!bk) { alert('Open a book first.'); return; }

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:min(760px,94vw);max-height:88vh;display:flex;flex-direction:column">
        <h2 style="font-size:16px;margin:0 0 4px">Before the interview</h2>
        <p style="font-size:12px;color:#888;margin:0 0 12px">Questions aimed at what your documents can't answer.
          Say who you're seeing — a role is enough, and don't type a real name if they're confidential.</p>
        <input id="ip-who" type="text" placeholder="e.g. a county assessor who served through the 1990s" style="width:100%"/>
        <div id="ip-body" style="flex:1;overflow:auto;margin:14px 0;font-size:13px;color:#999;line-height:1.65"></div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <button id="ip-go" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919">Draft questions</button>
          <button id="ip-x" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 16px;color:#888">Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const shut = () => { document.removeEventListener('keydown', k, true); bd.remove(); };
    const k = (e) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('keydown', k, true);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) shut(); });
    bd.querySelector('#ip-x').addEventListener('click', shut);

    bd.querySelector('#ip-go').addEventListener('click', async () => {
      const btn = bd.querySelector('#ip-go');
      const host = bd.querySelector('#ip-body');
      btn.disabled = true; btn.textContent = 'Reading your evidence…';
      const out = await neo.ai.interviewPrep(bk.id, bd.querySelector('#ip-who').value);
      btn.disabled = false; btn.textContent = 'Again';
      if (!out.ok) { host.innerHTML = `<span style="color:#c98b6b">${esc(out.error)}</span>`; return; }

      host.innerHTML =
        (out.withheld ? `<div style="font-size:11px;color:#8a7a5a;margin-bottom:12px">${out.withheld} card${out.withheld === 1 ? '' : 's'} from confidential sources were withheld and not read.</div>` : '') +
        out.questions.map((q, i) => `
          <div style="border-left:3px solid ${q.sensitive ? '#7a6a3a' : '#3a4a52'};background:${q.sensitive ? '#25220f' : '#1b2429'};padding:11px 14px;margin-bottom:9px">
            <div style="font-size:13px;color:#dbe2e5;margin-bottom:5px">${i + 1}. ${esc(q.question)}</div>
            <div style="font-size:11px;color:#93a5ad">${esc(q.why)}</div>
            ${q.sensitive ? `<div style="font-size:11px;color:#c9a96b;margin-top:5px">Contentious — put it plainly and give them room to answer. This is right-of-reply territory.</div>` : ''}
          </div>`).join('') +
        (out.cannotAnswer ? `<div style="font-size:12px;color:#777;margin-top:12px">Probably can't help with: ${esc(out.cannotAnswer)}</div>` : '') +
        `<div style="font-size:11px;color:#666;margin-top:14px;padding-top:10px;border-top:1px solid #2a2a2a">
          Before you dial: start recording, then ask for consent on tape. Agree the terms out loud — on record, on
          background, not for attribution — and note when they were agreed. All of it goes on the interview source record.</div>`;
    });
  }

  neo.onMenu((msg) => {
    if (!msg) return;
    if (msg.type === 'interviewPrep') openInterviewPrep();
    if (msg.type === 'hostile') openHostile();
    if (msg.type === 'audit') openAudit();
    if (msg.type === 'proseCheck') openProseCheck();
    if (msg.type === 'gaps') openGaps();
    if (msg.type === 'consistency') openConsistency();
  });
  window.openConsistency = openConsistency;
  window.openHostile = openHostile;
  window.openInterviewPrep = openInterviewPrep;
  window.openGaps = openGaps;
  window.openAudit = openAudit;
  window.openProseCheck = openProseCheck;
})();
