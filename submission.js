// NEO — export for submission.
//
// NEO's own DOCX export is a lovely reading document: Georgia, one-and-a-half
// spaced, no notes. That is not what an agent or an acquisitions editor
// expects, and it is not what a nonfiction manuscript needs.
//
// This produces standard manuscript format — double-spaced Times New Roman,
// one-inch margins, a running header, chapter openings a third down the page —
// with the citation apparatus actually inside the file as real Word endnotes,
// plus a bibliography. Hugh's export is left exactly as it is.

const fs = require('fs');
const path = require('path');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Manuscript format is double-spaced: 480 twentieths of a point.
const DOUBLE = 'w:line="480" w:lineRule="auto"';

const runs = (text, italic) =>
  `<w:r>${italic ? '<w:rPr><w:i/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

// A paragraph whose runs may carry an endnote reference.
function para(inner, opts = {}) {
  const o = opts;
  return `<w:p><w:pPr>` +
    (o.align ? `<w:jc w:val="${o.align}"/>` : '') +
    `<w:spacing ${DOUBLE}${o.before ? ` w:before="${o.before}"` : ''}/>` +
    (o.indent ? `<w:ind w:firstLine="720"/>` : '') +
    (o.pageBreak ? `<w:pageBreakBefore/>` : '') +
    `</w:pPr>${inner}</w:p>`;
}

// Inline formatting NEO writes into chapter HTML, kept; everything else dropped.
function inlineRuns(html, notes) {
  let out = '';
  const re = /<span[^>]*class="[^"]*neo-cite[^"]*"[^>]*>([\s\S]*?)<\/span>|<(em|i)>([\s\S]*?)<\/\2>|<(strong|b)>([\s\S]*?)<\/\4>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      // A cited passage: its text, then a real endnote reference after it.
      const tag = m[0];
      const idAttr = /data-note="(\d+)"/.exec(tag);
      const plain = m[1].replace(/<[^>]+>/g, '');
      out += runs(decode(plain));
      if (idAttr) {
        out += `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr>` +
               `<w:endnoteReference w:id="${idAttr[1]}"/></w:r>`;
      }
    } else if (m[3] !== undefined) out += runs(decode(m[3].replace(/<[^>]+>/g, '')), true);
    else if (m[5] !== undefined) {
      out += `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(decode(m[5].replace(/<[^>]+>/g, '')))}</w:t></w:r>`;
    } else if (m[6] !== undefined) {
      const t = decode(m[6]);
      if (t.trim()) out += runs(t);
    }
  }
  return out || runs('');
}

const decode = (s) => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function registerSubmission({ ipcMain, dialog, libraryDir, readJSON, logError }) {
  ipcMain.handle('submission:export', async (_e, bookId) => {
    try {
      const dir = path.join(libraryDir, bookId);
      const meta = readJSON(path.join(dir, 'book.json'), null);
      if (!meta) return { ok: false, error: 'could not read the book' };

      const library = readJSON(path.join(libraryDir, 'library.json'), {}) || {};
      const author = meta.author || library.authorName || 'Author';
      const surname = String(author).trim().split(/\s+/).pop();

      // Build the notes first: numbering has to match what the text references.
      const { buildNotesFor } = require('./citations');
      const apparatus = buildNotesFor({ libraryDir, readJSON, bookId, meta });

      // Chapters, with each anchor rewritten to carry its note number.
      const body = [];
      let wordCount = 0;
      let noteN = 0;

      for (const chId of (meta.chapterOrder || [])) {
        let html = '';
        try { html = fs.readFileSync(path.join(dir, 'chapters', `${chId}.html`), 'utf8'); } catch { continue; }
        const title = (meta.chapterTitles && meta.chapterTitles[chId]) || '';

        // Chapter opening: a third down the page, centred, as manuscripts do.
        body.push(para(runs(title ? title.toUpperCase() : ''), { align: 'center', pageBreak: true, before: 3200 }));
        body.push(para(runs('')));

        let first = true;
        for (const pm of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
          let inner = pm[1];
          const plainText = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (!plainText) continue;
          wordCount += plainText.split(' ').length;

          if (/^\*{3}$/.test(plainText)) {
            body.push(para(runs('#'), { align: 'center' }));
            first = true;
            continue;
          }
          // Tag each anchor with its note number, in document order.
          inner = inner.replace(/<span([^>]*class="[^"]*neo-cite[^"]*"[^>]*)>/gi,
            (mm, attrs) => `<span${attrs} data-note="${++noteN}">`);

          body.push(para(inlineRuns(inner, apparatus.notes), { indent: !first }));
          first = false;
        }
      }

      // Notes and bibliography, as ordinary back matter too — so the file reads
      // correctly even where Word endnotes are stripped or ignored.
      if (apparatus.notes.length) {
        body.push(para(runs('NOTES'), { align: 'center', pageBreak: true, before: 2400 }));
        apparatus.notes.forEach((n, i) => {
          body.push(para(runs(`${i + 1}. ${n.plain}`)));
        });
      }
      if (apparatus.works.length) {
        body.push(para(runs('BIBLIOGRAPHY'), { align: 'center', pageBreak: true, before: 2400 }));
        apparatus.works.forEach((w) => body.push(para(runs(w))));
      }
      if (apparatus.legal.length) {
        body.push(para(runs('STATUTES AND CONSTITUTIONAL PROVISIONS'), { align: 'center', pageBreak: true, before: 2400 }));
        apparatus.legal.forEach((w) => body.push(para(runs(w))));
      }

      // Title page, standard manuscript format.
      const front = [
        para(runs(author)),
        para(runs(`${Math.round(wordCount / 100) * 100} words`), { align: 'right' }),
        para(runs(''), { before: 3600 }),
        para(runs(String(meta.title || 'Untitled').toUpperCase()), { align: 'center' }),
        meta.subtitle ? para(runs(meta.subtitle, true), { align: 'center' }) : '',
        para(runs(`by ${author}`), { align: 'center', before: 480 })
      ].filter(Boolean);

      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
${front.join('')}${body.join('')}
<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>
<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720"/>
</w:sectPr></w:body></w:document>`;

      const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing ${DOUBLE}/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/>
<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
</w:styles>`;

      // Running header: Surname / KEYWORD / page — the manuscript convention.
      const keyword = String(meta.title || 'UNTITLED').split(/\s+/).slice(0, 2).join(' ').toUpperCase();
      const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>
<w:pPr><w:jc w:val="right"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>
<w:r><w:t xml:space="preserve">${esc(surname)} / ${esc(keyword)} / </w:t></w:r>
<w:r><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r>
<w:r><w:t>1</w:t></w:r>
<w:r><w:fldChar w:fldCharType="end"/></w:r>
</w:p></w:hdr>`;

      const endnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>
<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>
${apparatus.notes.map((n, i) => `<w:endnote w:id="${i + 1}"><w:p><w:pPr><w:spacing ${DOUBLE}/></w:pPr>` +
  `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteRef/></w:r>` +
  `<w:r><w:t xml:space="preserve"> ${esc(n.plain)}</w:t></w:r></w:p></w:endnote>`).join('')}
</w:endnotes>`;

      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

      const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

      const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdEnd" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>
<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

      const JSZip = require('jszip');
      const zip = new JSZip();
      zip.file('[Content_Types].xml', contentTypes);
      zip.file('_rels/.rels', rootRels);
      zip.file('word/document.xml', documentXml);
      zip.file('word/styles.xml', stylesXml);
      zip.file('word/endnotes.xml', endnotesXml);
      zip.file('word/header1.xml', headerXml);
      zip.file('word/_rels/document.xml.rels', docRels);

      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

      const picked = await dialog.showSaveDialog({
        title: 'Export for submission',
        defaultPath: `${String(meta.title || 'manuscript').replace(/[^\w -]/g, '')} — submission.docx`,
        filters: [{ name: 'Word document', extensions: ['docx'] }]
      });
      if (picked.canceled || !picked.filePath) return { ok: false, error: 'cancelled' };
      fs.writeFileSync(picked.filePath, buf);

      return {
        ok: true,
        file: picked.filePath,
        words: wordCount,
        notes: apparatus.notes.length,
        works: apparatus.works.length + apparatus.legal.length,
        gaps: apparatus.gaps
      };
    } catch (err) {
      logError('submission', err);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerSubmission };
