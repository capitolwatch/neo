// NEO — verse mode.
//
// NEO is built for prose, and three of its best behaviours are wrong for
// poetry: Enter twice makes a *** section break, Enter three times starts a
// chapter, and the first paragraph of every chapter gets a drop cap. A
// collection is *made* of blank lines, so a poet gets spurious breaks and
// chapters throughout, and a decorative capital on every poem.
//
// Verse mode is per book. It suppresses those three and nothing else — smart
// quotes, em dashes and true ellipses still work, because a poet wants those
// as much as a novelist does.

(function () {
  const neo = window.neo;
  if (!neo) return;

  const currentBook = () => { try { return book; } catch { return null; } };
  const isVerse = () => { const b = currentBook(); return Boolean(b && b.form === 'verse'); };

  // Overrides NEO's prose typography. Only present while verse mode is on.
  const sheet = document.createElement('style');
  sheet.textContent = `
    body.neo-verse .chapter-body p { text-indent: 0; }
    body.neo-verse .chapter-body p:first-of-type::first-letter {
      font-size: inherit; float: none; line-height: inherit;
      padding: 0; font-family: inherit; color: inherit;
    }
  `;
  document.head.appendChild(sheet);

  function applyClass() {
    document.body.classList.toggle('neo-verse', isVerse());
  }

  // Capture phase, so this runs before the chapter body's own keydown handler.
  // Stopping propagation on Enter means handleEnter never sees it, and the
  // browser's default — a new paragraph — is exactly what verse wants. Every
  // other key falls through untouched, so smart typography still runs.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || !isVerse()) return;
    const el = e.target;
    if (!el || !el.closest || !el.closest('.chapter-body')) return;
    e.stopPropagation();
  }, true);

  // The class has to survive every re-render of the editor.
  const watch = () => {
    const view = document.querySelector('#editor-view');
    if (!view) return;
    new MutationObserver(applyClass).observe(view, { attributes: true, attributeFilter: ['hidden'] });
    const chapters = document.querySelector('#chapters');
    if (chapters) new MutationObserver(applyClass).observe(chapters, { childList: true });
  };

  async function toggleVerse() {
    const bk = currentBook();
    if (!bk) { alert('Open the book you want to set.'); return; }

    const on = !isVerse();
    // Mutate the object app.js holds — its saveMeta writes `book` wholesale,
    // so a separate write from a fresh copy would be clobbered.
    bk.form = on ? 'verse' : 'prose';
    await neo.writeBookMeta(bk.id, bk);
    applyClass();

    alert(on
      ? 'Verse mode on for this book.\n\nEnter just makes a new line — no section breaks, no auto-chapters — and the drop cap is off. Smart quotes and em dashes still work.'
      : 'Verse mode off. Enter twice makes a section break again, three times a new chapter.');
  }

  applyClass();
  watch();
  setInterval(applyClass, 1500);   // cheap insurance against a render path I haven't found

  neo.onMenu((msg) => { if (msg && msg.type === 'verseMode') toggleVerse(); });
  window.toggleVerse = toggleVerse;
})();
