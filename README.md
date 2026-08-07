# NEO

**A word processor for authors. Distraction-free by default. Free forever.**

NEO understands from the moment you install it that you are writing *books* — not blog posts, not school reports, not slide decks. It was designed by a working novelist who tried every writing app on the market and decided to build the one he actually wanted: less bloat than the general-purpose word processors, less confusing than the binder-style writing suites, more useful than the typewriter apps, and built from the ground up for finishing manuscripts and shipping them — to agents, to editors, or straight to your readers.

It runs entirely on your machine. Your words live in plain, readable files on your own disk. No accounts, no subscription, no telemetry, no lock-in. Ever.

## Download

Grab the latest installer from the **[Releases page](../../releases)**:

- **macOS** — download the `.dmg`, open it, drag NEO to Applications.
- **Windows** — download the `.exe` installer and run it.

*(First launch on macOS: if you see an "unidentified developer" warning, right-click the app and choose Open.)*

## What makes NEO different

**The bookshelf.** Your library looks like a bookshelf, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Books wear generated covers, show progress bars toward word goals, and drag-and-drop anywhere.

**A page, and nothing else.** White paper, dark surround. Every control fades until you reach for it. Chapters number and renumber themselves. Drop caps mark chapter openings. Em dashes, true ellipses, and curly quotes happen as you type. Spellcheck exists only as a deliberate pass you invoke when *you're* ready — never a red squiggle mid-sentence.

**Enter, Enter, Enter.** One Enter: new paragraph. Two: a `***` section break. Three: a new chapter. Your hands never leave the story.

**Darlings.** The famous advice is "kill your darlings" — NEO adds the part nobody mentions: *keep the bodies*. Drag any beautiful-but-in-the-way passage onto the Darlings tab. It leaves your manuscript but is never lost, and restores to the exact spot it came from.

**Placeholders.** Mid-flow and need a name, a fact, a date? ⌘⇧X drops a mark and a sticky note, and you keep writing. The left panel shows a red dot on every chapter with unfinished business.

**Outlining that becomes the book.** Outline chapters and sections in the Outline tab; section notes appear in the manuscript as gray ghost paragraphs, ready to be written over. Pantsers can ignore all of it.

**The Silo.** A focus mode with the courage of its convictions: full kiosk screen, no Dock, no menus, always on top. The only way out is typing a confession NEO hands you, word for word — *"I'm a great writer and I'll do another session later, but right now I really need to see a cat video."* Most people go back to writing.

**Goals and momentum.** Daily word goals, word sprints, and a NaNoWriMo-style progress chart. A quiet "words today" counter that turns gold when you've earned it.

**Real exports.** EPUB 3 with a proper table of contents built to KDP's guidelines, Word .docx, PDF, HTML, Markdown, and plain text. Email a timestamped PDF snapshot to yourself with one keystroke — with a SHA-256 fingerprint of the text in the body, a provenance trail proving your words existed on a date.

**Import.** Bring in existing .docx, .txt, and .md manuscripts; chapters and scene breaks are detected automatically.

**A safety net you'll never think about.** Continuous autosave, atomic writes, daily zip backups kept two weeks, everything stored as plain files that sync happily with Dropbox or iCloud.

## Your files are yours

Everything lives in `~/Documents/NEO Library` — one folder per book, chapters as readable HTML, metadata as JSON. Open them in any text editor. Back them up, sync them, inspect them. If NEO vanished tomorrow, your books would still be right there, readable.

## Building from source

Requires [Node.js](https://nodejs.org).

```
git clone https://github.com/hughhowey/neo.git
cd neo
npm install
npm start
```

To build installers: `npm install electron-builder --save-dev`, then `npm run package` (macOS), `npm run package:win` (Windows), or `npm run package:all`. Output lands in `dist/`.

The app is deliberately simple under the hood: an Electron shell (`main.js`), one preload bridge (`preload.js`), and a single-file renderer (`app.js` + `styles.css` + `index.html`). No frameworks, no build step, no transpiler. If you can read JavaScript, you can change NEO.

## Roadmap

Chapter version history · manuscript format for agent submissions (Times New Roman, double-spaced, address block) · custom cover art · global end matter that updates every book at once · submission tracking · Total Plus word count · auto-updates.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Fair warning from the project's founding principle: NEO is opinionated by design, and bloat killed every writing app we loved. Features that serve working authors get in; everything else stays out, no matter how cool.

## License

[MIT](LICENSE) — free to use, free to modify, free to share. Now go write.
