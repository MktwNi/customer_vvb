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
import { DOC_MAX_BYTES } from './teamFiles';

export interface DocText { text: string; method: 'pdf-text' | 'ocr' | 'none'; pages: number }
type Progress = (msg: string, pct?: number) => void;
type DocFile = Blob & { name?: string; type: string };

/** Totals sit on the first pages; OCR is slow (seconds per page), so scans stop here. */
const OCR_PAGES = 3;
const TEXT_PAGES = 50;

// "refresh" too: a page older than the site asks for program chunks that a new version replaced
const PDF_LOAD_FAILED = 'โหลดตัวอ่าน PDF ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (หรือรีเฟรชหน้านี้)';
const PDF_READ_FAILED = 'อ่านไฟล์ PDF นี้ไม่ได้ ไฟล์อาจเสีย — ลองบันทึกเป็น PDF ใหม่ หรือแนบเป็นรูปภาพ';
const OCR_LOAD_FAILED = 'โหลดตัวอ่าน OCR ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (หรือรีเฟรชหน้านี้)';
const OCR_FAILED = 'อ่านภาพด้วย OCR ไม่สำเร็จ — ลองใหม่อีกครั้ง';

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
/** What reaches the caller: the abort reason (an AbortError) once `signal` has aborted, else an
 *  Error with a Thai message — pdf.js, tesseract.js and failed chunk loads reject with English
 *  errors, plain strings or nothing at all. The original is kept as `cause`. */
function fail(e: unknown, signal: AbortSignal | undefined, message: string): never {
  checkAbort(signal);
  if (e instanceof Error && /[\u0E00-\u0E7F]/.test(e.message)) throw e;
  throw new Error(message, { cause: e });
}

/** The browser's MIME type is often empty or generic (files from LINE, Drive on Android), so
 *  the first bytes decide. */
export async function sniff(file: DocFile): Promise<'pdf' | 'image' | 'heic' | 'other'> {
  const b = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 1024).includes('%PDF')) return 'pdf'; // some generators put junk before the header
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image';
  if (ascii(0, 3) === 'GIF' || ascii(0, 2) === 'BM') return 'image';
  if (ascii(4, 8) === 'ftyp') {
    // ISO media file: the major brand, then the compatible ones. AVIF (which browsers decode) often
    // lists mif1 too, so it is told apart from HEIC by its own brand.
    const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
    const brands = [ascii(8, 12)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(i, i + 4));
    if (brands.some((x) => /^avi[fs]$/.test(x))) return 'image';
    if (brands.some((x) => /^(?:hei[cxms]|hev[cxms]|mif1|msf1)$/.test(x))) return 'heic';
  }
  if (/^image\//.test(file.type)) return 'image';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) return 'pdf';
  return 'other';
}

/**
 * Text of a PDF or image. PDFs use their text layer; pages with (almost) none — scans — have the
 * first of them rendered and OCR'd, as are images. `forceOcr` OCRs a PDF even when it has text
 * (for a text layer that comes out garbled). Unsupported files give method 'none'.
 * Rejects with an Error with a Thai message for unreadable files or when the readers cannot be
 * loaded, and with an AbortError when `signal` aborts.
 */
export async function readDocText(file: DocFile, opts: { onProgress?: Progress; signal?: AbortSignal; forceOcr?: boolean; judge?: Judge } = {}): Promise<DocText> {
  const { onProgress, signal, judge } = opts;
  try {
    if (file.size > DOC_MAX_BYTES) throw new Error(`ไฟล์ใหญ่เกิน ${DOC_MAX_BYTES / 1048576} MB — ย่อขนาดไฟล์ หรือแนบเฉพาะหน้าที่มียอดเงิน`);
    const kind = await sniff(file);
    checkAbort(signal);
    if (kind === 'pdf') return await readPdf(file, onProgress, signal, !!opts.forceOcr, judge);
    if (kind === 'heic') throw new Error('เบราว์เซอร์นี้เปิดรูป HEIC (รูปจาก iPhone) ไม่ได้ — ส่งออกเป็น JPG หรือถ่ายภาพหน้าจอแล้วแนบใหม่');
    if (kind === 'image') {
      onProgress?.('กำลังเตรียมภาพ…', 0);
      const canvas = await imageToCanvas(file);
      checkAbort(signal);
      return { text: await ocr([canvas], onProgress, signal, judge), method: 'ocr', pages: 1 };
    }
    return { text: '', method: 'none', pages: 0 };
  } catch (e) {
    return fail(e, signal, 'อ่านไฟล์นี้ไม่ได้ — ลองใหม่อีกครั้ง');
  }
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

/** Whether one page has a real text layer: words, or at least an amount. A scanned page has none or
 *  a stray stamp ("Scanned with CamScanner" — counted per page, so a stamp on every page of a scan
 *  does not add up to a text layer), and PDFs with broken fonts give private-use or replacement
 *  characters only. */
export function hasTextLayer(page: string) {
  const good = (page.match(/[A-Za-z0-9\u0E01-\u0E5B]/g) || []).length;
  const bad = (page.match(/[\uE000-\uF8FF\uFFFD\u0000-\u0008\u000E-\u001F]/g) || []).length;
  return (good >= 40 || (good >= 8 && /\d[\d,]*\.\d\d(?!\d)/.test(page))) && bad < good * 0.3;
}

/** How well `text` answers what the caller needs (0 when the judge itself fails). */
const rate = (judge: Judge | undefined, text: string) => {
  try {
    return judge ? judge(text) : 100;
  } catch {
    return 0;
  }
};

async function readPdf(file: DocFile, progress: Progress | undefined, signal: AbortSignal | undefined, forceOcr: boolean, judge?: Judge): Promise<DocText> {
  progress?.('กำลังเปิด PDF…', 0);
  const pdfjs = await abortable(import('pdfjs-dist/legacy/build/pdf.mjs'), signal).catch((e): never => fail(e, signal, PDF_LOAD_FAILED));
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const params = {
    data: new Uint8Array(await file.arrayBuffer()),
    // decoders for JBIG2 / JPEG 2000 images (scanned pages) and ICC colour, self-hosted with the OCR files
    wasmUrl: assetBase() + 'pdfjs/',
    // never compile code from a PDF; pdf.js 6 no longer does at all, this keeps it so should an older one come back
    isEvalSupported: false,
  };
  checkAbort(signal);
  const task = pdfjs.getDocument(params);
  // destroy() leaves a page being rendered pending (and then never settles itself) or rejects what is
  // pending with "Transport destroyed": every call below is abortable, and nothing waits for it
  let closed = false;
  const close = () => {
    if (!closed) (closed = true), void task.destroy().catch(() => {});
  };
  signal?.addEventListener('abort', close, { once: true });
  const canvases: HTMLCanvasElement[] = [];
  let merge: ((ocrPages: string[]) => string) | undefined, numPages = 0;
  try {
    let doc;
    try {
      doc = await abortable(task.promise, signal);
    } catch (e) {
      checkAbort(signal);
      if ((e as Error)?.name === 'PasswordException') throw new Error('PDF นี้ตั้งรหัสผ่านไว้ — เปิดด้วยรหัสแล้วบันทึกเป็นไฟล์ใหม่ (Print → Save as PDF) ก่อนแนบ');
      // pdf.js's own worker script did not load (offline, or an old page after a new version went up)
      if (/fake worker|dynamically imported|importScripts|failed to fetch|networkerror/i.test(String((e as Error)?.message ?? e))) throw new Error(PDF_LOAD_FAILED, { cause: e });
      throw new Error('เปิดไฟล์ PDF ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่ PDF', { cause: e });
    }
    numPages = doc.numPages;
    let ocrPages: number[]; // 1-based
    if (forceOcr) ocrPages = Array.from({ length: Math.min(numPages, OCR_PAGES) }, (_, i) => i + 1);
    else {
      const n = Math.min(numPages, TEXT_PAGES);
      const pages: string[] = [];
      for (let p = 1; p <= n; p++) {
        checkAbort(signal);
        progress?.(n > 1 ? `กำลังอ่านข้อความจาก PDF… หน้า ${p}/${n}` : 'กำลังอ่านข้อความจาก PDF…', Math.round(((p - 1) / n) * 100));
        const page = await abortable(doc.getPage(p), signal);
        pages.push(layoutLines((await abortable(page.getTextContent(), signal)).items));
        page.cleanup();
      }
      const text = repairThaiText(pages.join('\n\n'));
      const fixed = pages.map(repairThaiText);
      const scanned = fixed.map((t, i) => (hasTextLayer(t) ? 0 : i + 1)).filter((p) => p > 0);
      // all text, or text pages that already hold a confirmed total next to a few without text
      if (!scanned.length || (scanned.length < n && judge && rate(judge, text) >= 100)) {
        progress?.('อ่านข้อความจาก PDF เสร็จแล้ว', 100);
        return { text, method: 'pdf-text', pages: numPages };
      }
      // the first scanned pages are read with OCR, in place of their stray text; text pages keep theirs
      const todo = scanned.slice(0, OCR_PAGES);
      ocrPages = todo;
      merge = (ocr) => fixed.map((t, i) => (todo.includes(i + 1) ? ocr[todo.indexOf(i + 1)] : scanned.includes(i + 1) ? '' : t)).filter((t) => t.trim()).join('\n\n');
    }
    for (const p of ocrPages) {
      checkAbort(signal);
      progress?.(`กำลังแปลงหน้า ${p} เป็นภาพ…`, 0);
      canvases.push(await renderPage(await abortable(doc.getPage(p), signal), signal));
    }
  } catch (e) {
    return fail(e, signal, PDF_READ_FAILED);
  } finally {
    signal?.removeEventListener('abort', close);
    close(); // the page images are made: pdf.js's worker and memory go before OCR starts
  }
  return { text: await ocr(canvases, progress, signal, judge, merge), method: 'ocr', pages: numPages };
}

interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement; viewport: never }): { promise: Promise<unknown>; cancel(): void };
  cleanup(): unknown;
}
/** Scale ~2 (144 dpi) at least, up to ~2600 px on the long side so small print stays readable. */
async function renderPage(page: unknown, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const pg = page as PdfPage;
  const base = pg.getViewport({ scale: 1 });
  const scale = Math.max(2, Math.min(3.5, 2600 / Math.max(base.width, base.height)));
  const viewport = pg.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const task = pg.render({ canvas, viewport: viewport as never });
  try {
    await abortable(task.promise, signal);
  } catch (e) {
    task.cancel();
    throw e;
  }
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
  /** a call on the worker's in-memory file system (where the language data is loaded) */
  FS?(method: string, args: unknown[]): Promise<unknown>;
}
type CreateWorker = (langs: string, oem: number, opts: Record<string, unknown>) => Promise<OcrWorker>;
type OcrLog = (m: { status: string; progress: number }) => void;

/** How well OCR'd text answers what the caller needs, 0–100; 100 = good enough, no second pass. */
export type Judge = (text: string) => number;
/** Tesseract page layouts tried in turn: one text block (best on photos and plain receipts), then
 *  "a column of text of variable sizes", which keeps the right-aligned totals of bordered tables
 *  that the first one drops. The second runs only when a judge finds the first wanting. */
const OCR_PASSES = ['6', '4'];

async function ocr(images: HTMLCanvasElement[], progress: Progress | undefined, signal: AbortSignal | undefined, judge?: Judge, merge = (pages: string[]) => pages.join('\n\n')): Promise<string> {
  progress?.('กำลังโหลดตัวอ่าน OCR…', 0);
  let page = 0;
  const n = images.length;
  const logger: OcrLog = (m) => {
    if (m.status === 'recognizing text') {
      const pct = Math.round(((page - 1 + m.progress) / n) * 100);
      progress?.(n > 1 ? `กำลังอ่านหน้า ${page}/${n} ด้วย OCR… ${pct}%` : `กำลังอ่านภาพด้วย OCR… ${pct}%`, pct);
    } else if (m.status === 'loading language traineddata') progress?.('กำลังโหลดข้อมูลภาษาไทยและอังกฤษ… (ครั้งแรกประมาณ 4 MB)', 0);
    else if (/initializ/.test(m.status)) progress?.('กำลังเตรียม OCR…', 0);
  };
  const engine = await startOcr(logger, signal);
  signal?.addEventListener('abort', engine.stop, { once: true });
  try {
    let best = '', bestScore = -1;
    for (const [i, psm] of OCR_PASSES.entries()) {
      // keep runs of spaces: they separate a label from its value in a column layout
      await engine.job(engine.worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: psm }));
      if (i > 0) progress?.('ตรวจอีกรอบด้วยการจัดหน้าแบบตาราง เพื่อหายอดให้ครบ…', 0);
      const out: string[] = [];
      page = 0;
      for (const img of images) {
        checkAbort(signal);
        page++;
        const { data } = await engine.job(engine.worker.recognize(img, { rotateAuto: true }));
        out.push(data.text);
      }
      const text = repairThaiText(merge(out));
      const score = rate(judge, text);
      if (score > bestScore) (best = text), (bestScore = score);
      if (bestScore >= 100) break;
    }
    progress?.('อ่านด้วย OCR เสร็จแล้ว', 100);
    return best;
  } catch (e) {
    return fail(e, signal, OCR_FAILED);
  } finally {
    signal?.removeEventListener('abort', engine.stop);
    engine.stop();
  }
}

interface Engine {
  worker: OcrWorker;
  /** `p`, rejecting as well when the engine reports an error or `signal` aborts */
  job<T>(p: Promise<T>): Promise<T>;
  /** stops the Web Worker (and with it any download or recognition in progress) */
  stop(): void;
}

/**
 * Starts Tesseract (Thai + English). tesseract.js reports a failed language download or start-up
 * only to `errorHandler` — the promise of createWorker then never settles — and keeps its Web
 * Worker to itself until it has loaded. So errors are raced against that promise, and the worker
 * is caught as it is constructed (createWorker does that before its first await) to be stopped on
 * failure or cancel; should that ever not catch it, it is stopped once createWorker resolves.
 * tesseract.js downloads the language data itself and keeps it in IndexedDB, so it is fetched once
 * per browser. (Handing it the data as { code, data } instead does not work in tesseract.js 7.0:
 * initialize() then passes the bytes as the language name, and Thai is silently left out.)
 * It also takes whatever answers with status 200 — a proxy's block page, a misconfigured fallback —
 * starts without an error, reads without Thai, and caches that page, so Thai stays broken in this
 * browser. So the loaded data is checked: bad data is dropped from the cache and downloaded once
 * more (it may only have been cached earlier); still bad, the read fails and nothing bad is kept.
 */
async function startOcr(logger: OcrLog, signal: AbortSignal | undefined, retried = false): Promise<Engine> {
  const mod = (await abortable(import('tesseract.js'), signal).catch((e): never => fail(e, signal, OCR_LOAD_FAILED))) as unknown as {
    createWorker?: CreateWorker;
    default?: { createWorker: CreateWorker };
  };
  const createWorker = mod.createWorker || mod.default!.createWorker;
  checkAbort(signal);
  const base = assetBase();
  let broke: (e: unknown) => void = () => {};
  const broken = new Promise<never>((_, reject) => (broke = reject));
  broken.catch(() => {}); // a job that fails rejects by itself as well
  let raw: Worker | undefined;
  const pending = catchWorker(
    () =>
      createWorker(OCR_LANGS.join('+'), 1 /* LSTM only */, {
        workerPath: base + 'worker.min.js',
        corePath: base, // a folder: tesseract.js picks the plain / SIMD / relaxed-SIMD build for this device
        langPath: base,
        gzip: true,
        cachePath: OCR_CACHE, // traineddata cached in IndexedDB, apart from other sites on the same origin
        logger,
        errorHandler: (e: unknown) => broke(e),
      }),
    (w) => {
      raw = w;
      w.addEventListener('error', (ev) => broke((ev as ErrorEvent).message || 'OCR worker error'));
    },
  );
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // the caught worker directly: tesseract.js's own terminate() forgets it, and a job still being
    // prepared (an image being encoded) then fails as an unhandled rejection
    if (raw) raw.terminate();
    else pending.then((w) => w.terminate(), () => {}).catch(() => {});
  };
  const job = <T>(p: Promise<T>) => abortable(Promise.race([p, broken]), signal);
  let bad: string[];
  try {
    const worker = await job(pending);
    bad = await badLanguageData(worker, job);
    checkAbort(signal);
    if (!bad.length) return { worker, job, stop };
  } catch (e) {
    stop();
    return fail(e, signal, OCR_LOAD_FAILED);
  }
  stop();
  await forgetLanguageData(bad);
  if (!retried) {
    // the bad answer may still be fresh in the browser's HTTP cache, where the worker's own download
    // would find it again: it is fetched anew first (and read to the end, so the new copy is kept)
    await Promise.all(bad.map((l) => abortable(fetch(base + l + '.traineddata.gz', { cache: 'reload' }).then((r) => r.arrayBuffer()), signal).catch(() => {})));
    checkAbort(signal);
    return startOcr(logger, signal, true);
  }
  return fail(new Error('OCR language data is not traineddata: ' + bad.join(', ')), signal, OCR_LOAD_FAILED);
}

const OCR_LANGS = ['tha', 'eng'];
/** tesseract.js's cachePath: its IndexedDB keys are `gcc-ocr/<lang>.traineddata` */
const OCR_CACHE = 'gcc-ocr';
/** Below this, loaded language data is not the real thing: tha.traineddata is about 1.07 MB and eng
 *  5.2 MB (4.0.0_best_int, unzipped); an error or block page is a few KB. */
const MIN_TRAINEDDATA = 256 * 1024;

/** The languages whose data the worker loaded is too small to be real. A check that fails itself
 *  counts as fine: it never stops OCR that works. (Only files that are there are looked at: tesseract.js
 *  reports any failed job to errorHandler, which would stop the engine.) */
async function badLanguageData(worker: OcrWorker, job: Engine['job']): Promise<string[]> {
  if (typeof worker.FS !== 'function') return [];
  const bad: string[] = [];
  let names: unknown;
  try {
    // a job's result is { jobId, data }; tesseract.js writes the data to ./<lang>.traineddata
    names = ((await job(worker.FS('readdir', ['.']))) as { data?: unknown } | undefined)?.data;
  } catch {
    return [];
  }
  if (!Array.isArray(names)) return [];
  for (const l of OCR_LANGS) {
    if (!names.includes(l + '.traineddata')) continue;
    try {
      const r = (await job(worker.FS('stat', [l + '.traineddata']))) as { data?: { size?: unknown } } | undefined;
      const size = r?.data?.size;
      if (typeof size === 'number' && size < MIN_TRAINEDDATA) bad.push(l);
    } catch {
      // not checked: treated as fine
    }
  }
  return bad;
}

/** Drops cached language data, so the next start downloads it again. tesseract.js keeps it with
 *  idb-keyval (database "keyval-store", store "keyval"). Never fails, and gives up after 3 s. */
function forgetLanguageData(langs: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => resolve();
    setTimeout(done, 3000);
    try {
      const req = indexedDB.open('keyval-store');
      req.onupgradeneeded = () => req.result.createObjectStore('keyval'); // as idb-keyval creates it
      req.onerror = req.onblocked = done;
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          langs.forEach((l) => store.delete(`${OCR_CACHE}/${l}.traineddata`));
          tx.oncomplete = tx.onerror = tx.onabort = () => (db.close(), done());
        } catch {
          db.close();
          done();
        }
      };
    } catch {
      done();
    }
  });
}

/** Runs `make` with the Worker constructor wrapped, so the worker it creates is handed to `caught`. */
function catchWorker<T>(make: () => T, caught: (w: Worker) => void): T {
  const W = globalThis.Worker;
  if (typeof W !== 'function') return make();
  globalThis.Worker = class extends W {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      caught(this);
    }
  };
  try {
    return make();
  } finally {
    globalThis.Worker = W;
  }
}
