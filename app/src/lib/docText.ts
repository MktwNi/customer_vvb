/**
 * Reads the text of an attached quotation / invoice / receipt in the browser, for docExtract.ts:
 * the PDF text layer through pdf.js, or OCR (Tesseract, Thai + English) for photos, scans and PDFs
 * without a text layer.
 *
 * Both libraries load only when a document is read (dynamic import), so the main bundle does not
 * grow. The OCR engine and language data are self-hosted under <base>/ocr/ (copied there by
 * scripts/sync-ocr.mjs): the public CDNs tesseract.js defaults to are not reachable from every
 * network, and the site lives under a sub-path on GitHub Pages.
 */
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { repairThaiText } from './docExtract';

export interface DocText { text: string; method: 'pdf-text' | 'ocr' | 'none'; pages: number }
type Progress = (msg: string, pct?: number) => void;
type DocFile = Blob & { name?: string; type: string };

/** Totals sit on the first pages; OCR is slow (seconds per page), so scans stop here. */
const OCR_PAGES = 3;
const TEXT_PAGES = 50;

/** URL of the ocr/ folder. With an absolute base (dev server: '/') it is BASE_URL + 'ocr/'. The site
 *  is built with base './', which is relative to the page — right for index.html at the site root,
 *  wrong for a page in a sub-folder — so then it is resolved from this chunk, which always sits in
 *  <site>/assets/. (A variable, so Vite does not try to bundle the folder as an asset.) */
const OCR_FROM_CHUNK = '../ocr/';
const assetBase = () => {
  const base = import.meta.env.BASE_URL;
  return /^(\/|[a-z]+:)/i.test(base) ? new URL(base + 'ocr/', location.href).href : new URL(OCR_FROM_CHUNK, import.meta.url).href;
};

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('ยกเลิกแล้ว', 'AbortError');
}
/** Rejects as soon as `signal` aborts (wrapped work that cannot be interrupted itself). */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('ยกเลิกแล้ว', 'AbortError'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** The browser's MIME type is often empty or generic (files from LINE, Drive on Android), so
 *  the first bytes decide. */
async function sniff(file: DocFile): Promise<'pdf' | 'image' | 'heic' | 'other'> {
  const b = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 1024).includes('%PDF')) return 'pdf'; // some generators put junk before the header
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image';
  if (ascii(0, 3) === 'GIF' || ascii(0, 2) === 'BM') return 'image';
  if (ascii(4, 8) === 'ftyp' && /hei|hev|mif|avi/.test(ascii(8, 12))) return 'heic';
  if (/^image\//.test(file.type)) return 'image';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) return 'pdf';
  return 'other';
}

/**
 * Text of a PDF or image. PDFs use their text layer; a PDF with (almost) none — a scan — has its
 * first pages rendered and OCR'd, as are images. `forceOcr` OCRs a PDF even when it has text
 * (for a text layer that comes out garbled). Unsupported files give method 'none'.
 * Throws an Error with a Thai message for unreadable files; an AbortError when `signal` aborts.
 */
export async function readDocText(file: DocFile, opts: { onProgress?: Progress; signal?: AbortSignal; forceOcr?: boolean; judge?: Judge } = {}): Promise<DocText> {
  const { onProgress, signal, judge } = opts;
  const kind = await sniff(file);
  checkAbort(signal);
  if (kind === 'pdf') return readPdf(file, onProgress, signal, !!opts.forceOcr, judge);
  if (kind === 'heic') throw new Error('เบราว์เซอร์นี้เปิดรูป HEIC (รูปจาก iPhone) ไม่ได้ — ส่งออกเป็น JPG หรือถ่ายภาพหน้าจอแล้วแนบใหม่');
  if (kind === 'image') {
    onProgress?.('กำลังเตรียมภาพ…', 0);
    const canvas = await imageToCanvas(file);
    return { text: await ocr([canvas], onProgress, signal, judge), method: 'ocr', pages: 1 };
  }
  return { text: '', method: 'none', pages: 0 };
}

// ------------------------------------------------------------------ PDF

interface Item { s: string; x: number; y: number; w: number; h: number }

/**
 * Rebuilds lines from pdf.js text items: items on one baseline (within half a font height) form a
 * line, read left to right; a wide gap becomes 3 spaces (a column break, which docExtract uses to
 * tell a table's columns apart), a word gap one space.
 */
export function layoutLines(raw: unknown[]): string {
  const items: Item[] = [];
  for (const it of raw) {
    const t = it as { str?: string; transform?: number[]; width?: number; height?: number };
    if (typeof t.str !== 'string' || !t.transform || !t.str.trim()) continue;
    const [a, b, c, d, x, y] = t.transform;
    const h = Math.abs(t.height || 0) || Math.hypot(c, d) || Math.hypot(a, b) || 10;
    items.push({ s: t.str, x, y, w: Math.abs(t.width || 0), h });
  }
  items.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: Item[][] = [];
  for (const it of items) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    if (ref && Math.abs(ref.y - it.y) <= 0.5 * Math.min(ref.h, it.h)) line.push(it);
    else lines.push([it]);
  }
  return lines
    .map((line) => {
      line.sort((p, q) => p.x - q.x);
      let out = '', end = -Infinity;
      for (const it of line) {
        const gap = it.x - end, h = it.h;
        if (out) {
          if (gap > 1.5 * h) out = out.replace(/\s+$/, '') + '   ';
          else if (gap > 0.15 * h && !/\s$/.test(out) && !/^\s/.test(it.s)) out += ' ';
        }
        out += it.s;
        end = Math.max(end, it.x + it.w);
      }
      return out.replace(/\s+$/, '');
    })
    .join('\n');
}

/** A real text layer has words; scans have none or a stray stamp ("Scanned with …"), and some
 *  PDFs with broken fonts give private-use or replacement characters only. */
function hasTextLayer(text: string, pages: number) {
  const good = (text.match(/[A-Za-z0-9\u0E01-\u0E5B]/g) || []).length;
  const bad = (text.match(/[\uE000-\uF8FF\uFFFD\u0000-\u0008\u000E-\u001F]/g) || []).length;
  return good >= Math.max(40, 15 * Math.min(pages, OCR_PAGES)) && bad < good * 0.3;
}

async function readPdf(file: DocFile, progress: Progress | undefined, signal: AbortSignal | undefined, forceOcr: boolean, judge?: Judge): Promise<DocText> {
  progress?.('กำลังเปิด PDF…', 0);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  checkAbort(signal);
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // decoders for JBIG2 / JPEG 2000 images (scanned pages) and ICC colour, self-hosted with the OCR files
    wasmUrl: assetBase() + 'pdfjs/',
  });
  const onAbort = () => void task.destroy();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (e) {
      checkAbort(signal);
      if ((e as Error)?.name === 'PasswordException') throw new Error('PDF นี้ตั้งรหัสผ่านไว้ — เปิดด้วยรหัสแล้วบันทึกเป็นไฟล์ใหม่ (Print → Save as PDF) ก่อนแนบ');
      throw new Error('เปิดไฟล์ PDF ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่ PDF');
    }
    const n = Math.min(doc.numPages, TEXT_PAGES);
    const pages: string[] = [];
    if (!forceOcr)
      for (let p = 1; p <= n; p++) {
        checkAbort(signal);
        progress?.(n > 1 ? `กำลังอ่านข้อความจาก PDF… หน้า ${p}/${n}` : 'กำลังอ่านข้อความจาก PDF…', Math.round(((p - 1) / n) * 100));
        const page = await doc.getPage(p);
        pages.push(layoutLines((await page.getTextContent()).items));
        page.cleanup();
      }
    const text = repairThaiText(pages.join('\n\n'));
    if (!forceOcr && hasTextLayer(text, n)) {
      progress?.('อ่านข้อความจาก PDF เสร็จแล้ว', 100);
      return { text, method: 'pdf-text', pages: doc.numPages };
    }
    // a scan: render the first pages and read them with OCR
    const canvases: HTMLCanvasElement[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, OCR_PAGES); p++) {
      checkAbort(signal);
      progress?.(`กำลังแปลงหน้า ${p} เป็นภาพ…`, 0);
      canvases.push(await renderPage(await doc.getPage(p)));
    }
    return { text: await ocr(canvases, progress, signal, judge), method: 'ocr', pages: doc.numPages };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await task.destroy();
  }
}

interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement; viewport: never }): { promise: Promise<unknown> };
  cleanup(): unknown;
}
/** Scale ~2 (144 dpi) at least, up to ~2600 px on the long side so small print stays readable. */
async function renderPage(page: unknown): Promise<HTMLCanvasElement> {
  const pg = page as PdfPage;
  const base = pg.getViewport({ scale: 1 });
  const scale = Math.max(2, Math.min(3.5, 2600 / Math.max(base.width, base.height)));
  const viewport = pg.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await pg.render({ canvas, viewport: viewport as never }).promise;
  pg.cleanup();
  return canvas;
}

// ------------------------------------------------------------------ images

/** Decodes an image (EXIF rotation applied) onto a white canvas, scaled so text is large enough
 *  for Tesseract but a 12-megapixel photo does not take minutes. */
async function imageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let src: CanvasImageSource & { width: number; height: number };
  let done = () => {};
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    src = bmp;
    done = () => bmp.close();
  } catch {
    // older Safari: no createImageBitmap for blobs
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img;
    } catch {
      throw new Error('เปิดรูปนี้ไม่ได้ — รองรับไฟล์ PDF, PNG, JPG และ WEBP');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const long = Math.max(src.width, src.height);
  const scale = long < 1800 ? Math.min(2.5, 2200 / long) : long > 3600 ? 3600 / long : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  done();
  return canvas;
}

// ------------------------------------------------------------------ OCR

interface OcrWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(img: HTMLCanvasElement, o?: { rotateAuto?: boolean }): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}
type CreateWorker = (langs: string, oem: number, opts: Record<string, unknown>) => Promise<OcrWorker>;

/** How well OCR'd text answers what the caller needs, 0–100; 100 = good enough, no second pass. */
export type Judge = (text: string) => number;
/** Tesseract page layouts tried in turn: one text block (best on photos and plain receipts), then
 *  "a column of text of variable sizes", which keeps the right-aligned totals of bordered tables
 *  that the first one drops. The second runs only when a judge finds the first wanting. */
const OCR_PASSES = ['6', '4'];

async function ocr(images: HTMLCanvasElement[], progress: Progress | undefined, signal: AbortSignal | undefined, judge?: Judge): Promise<string> {
  progress?.('กำลังโหลดตัวอ่าน OCR…', 0);
  const mod = (await import('tesseract.js')) as unknown as { createWorker?: CreateWorker; default?: { createWorker: CreateWorker } };
  const createWorker = mod.createWorker || mod.default!.createWorker;
  checkAbort(signal);
  const base = assetBase();
  let page = 0;
  const n = images.length;
  const logger = (m: { status: string; progress: number }) => {
    if (m.status === 'recognizing text') {
      const pct = Math.round(((page - 1 + m.progress) / n) * 100);
      progress?.(n > 1 ? `กำลังอ่านหน้า ${page}/${n} ด้วย OCR… ${pct}%` : `กำลังอ่านภาพด้วย OCR… ${pct}%`, pct);
    } else if (m.status === 'loading language traineddata') progress?.('กำลังโหลดข้อมูลภาษาไทยและอังกฤษ… (ครั้งแรกประมาณ 4 MB)', 0);
    else if (/initializ/.test(m.status)) progress?.('กำลังเตรียม OCR…', 0);
  };
  const worker = await abortable(
    createWorker('tha+eng', 1 /* LSTM only */, {
      workerPath: base + 'worker.min.js',
      corePath: base, // a folder: tesseract.js picks the plain / SIMD / relaxed-SIMD build for this device
      langPath: base,
      gzip: true,
      cachePath: 'gcc-ocr', // traineddata cached in IndexedDB, apart from other sites on the same origin
      logger,
      errorHandler: () => {},
    }),
    signal,
  );
  const stop = () => void worker.terminate().catch(() => {});
  signal?.addEventListener('abort', stop, { once: true });
  try {
    let best = '', bestScore = -1;
    for (const [i, psm] of OCR_PASSES.entries()) {
      // keep runs of spaces: they separate a label from its value in a column layout
      await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: psm });
      if (i > 0) progress?.('ตรวจอีกรอบด้วยการจัดหน้าแบบตาราง เพื่อหายอดให้ครบ…', 0);
      const out: string[] = [];
      page = 0;
      for (const img of images) {
        checkAbort(signal);
        page++;
        const { data } = await abortable(worker.recognize(img, { rotateAuto: true }), signal);
        out.push(data.text);
      }
      const text = repairThaiText(out.join('\n\n'));
      const score = judge ? judge(text) : 100;
      if (score > bestScore) (best = text), (bestScore = score);
      if (bestScore >= 100) break;
    }
    progress?.('อ่านด้วย OCR เสร็จแล้ว', 100);
    return best;
  } finally {
    signal?.removeEventListener('abort', stop);
    await worker.terminate().catch(() => {});
  }
}
