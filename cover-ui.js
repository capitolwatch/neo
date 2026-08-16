// NEO — real cover images.
//
// NEO draws a gradient jacket from the book's seed. This lets a real image
// stand in its place, copied into the book's own folder so the book keeps
// travelling with its jacket.

(function () {
  const neo = window.neo;
  if (!neo) return;

  const currentBook = () => { try { return book; } catch { return null; } };
  const covers = new Map();   // bookId → absolute path, cached per session

  async function paint(tile) {
    const id = tile.dataset.id;
    if (!id) return;
    let file = covers.get(id);
    if (file === undefined) {
      const meta = await neo.readBookMeta(id);
      file = meta && meta.coverImage ? await neo.coverPath(id, meta.coverImage) : null;
      covers.set(id, file);
    }
    if (!file) return;
    // Replace the gradient, keep the jacket typography sitting on top.
    tile.style.backgroundImage = `url("file://${encodeURI(file).replace(/#/g, '%23')}")`;
    tile.style.backgroundSize = 'cover';
    tile.style.backgroundPosition = 'center';
    tile.classList.add('has-cover');
  }

  // The shelf is rebuilt on every render, so watch rather than run once.
  const repaint = () => {
    document.querySelectorAll('#shelves .book[data-id]:not(.has-cover)').forEach(paint);
  };

  const shelves = document.querySelector('#shelves');
  if (shelves) {
    new MutationObserver(repaint).observe(shelves, { childList: true, subtree: true });
    repaint();   // the shelf may already be rendered by the time we load
  }

  async function setCover() {
    const bk = currentBook();
    if (!bk) { alert('Open the book you want to give a cover.'); return; }
    const file = await neo.setCover(bk.id);
    if (!file) return;
    // Mutate the object app.js holds in memory, not a fresh copy from disk —
    // its own saveMeta() writes `book` wholesale and would clobber ours.
    bk.coverImage = file;
    await neo.writeBookMeta(bk.id, bk);
    covers.delete(bk.id);
    alert('Cover set. You\'ll see it on the shelf.');
  }

  neo.onMenu((msg) => { if (msg && msg.type === 'setCover') setCover(); });
  window.setCover = setCover;
})();
