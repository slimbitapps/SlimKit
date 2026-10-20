'use strict';
/** PDF: Bilder und PDFs zu einer Datei zusammenfügen, PDF in einzelne Seiten aufteilen (pdf-lib, ohne Internet). */
const fsp = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const A4 = [595.28, 841.89];

/**
 * @param {{name:string, bytes:Uint8Array, type:'pdf'|'jpg'|'png'}[]} items in dieser Reihenfolge
 * @param {{page?:'auto'|'a4', margin?:number}} opts
 * @returns {Promise<{bytes:Uint8Array, pages:number, skipped:string[]}>}
 */
async function mergeToPdf(items, opts = {}) {
  const doc = await PDFDocument.create();
  const skipped = [];
  const margin = opts.page === 'a4' ? (opts.margin ?? 28) : 0;
  for (const it of items) {
    try {
      if (it.type === 'pdf') {
        const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
        const pages = await doc.copyPages(src, src.getPageIndices());
        for (const p of pages) doc.addPage(p);
        continue;
      }
      const img = it.type === 'png' ? await doc.embedPng(it.bytes) : await doc.embedJpg(it.bytes);
      let pw;
      let ph;
      if (opts.page === 'a4') {
        [pw, ph] = img.width > img.height ? [A4[1], A4[0]] : A4;
      } else {
        // Bildgröße bei 150 dpi, aber nicht größer als 2× A4
        const scale = Math.min(72 / 150, (A4[1] * 2) / Math.max(img.width, img.height));
        pw = img.width * scale;
        ph = img.height * scale;
      }
      const page = doc.addPage([pw, ph]);
      const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * s;
      const h = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    } catch {
      skipped.push(it.name);
    }
  }
  doc.setProducer('SlimKit');
  doc.setCreator('SlimKit');
  return { bytes: await doc.save(), pages: doc.getPageCount(), skipped };
}

/** PDF aufteilen: eine Datei je Seite im Ordner outDir */
async function splitPdf(file, outDir) {
  const src = await PDFDocument.load(await fsp.readFile(file), { ignoreEncryption: true });
  await fsp.mkdir(outDir, { recursive: true });
  const base = path.basename(file, path.extname(file));
  const n = src.getPageCount();
  const digits = String(n).length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = await PDFDocument.create();
    const [p] = await d.copyPages(src, [i]);
    d.addPage(p);
    const f = path.join(outDir, `${base} ${String(i + 1).padStart(digits, '0')}.pdf`);
    await fsp.writeFile(f, await d.save(), { flag: 'wx' });
    out.push(f);
  }
  return out;
}

module.exports = { mergeToPdf, splitPdf };
