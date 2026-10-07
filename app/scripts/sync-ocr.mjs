// Copies what src/lib/docText.ts loads at runtime into public/ocr so the site serves it itself
// (CDNs such as jsDelivr are not reachable from every network, and GitHub Pages serves the app
// from a sub-path): the tesseract.js worker, the tesseract.js-core LSTM builds it picks from at
// runtime (plain / SIMD / relaxed SIMD — each device downloads one), Thai + English traineddata
// (the smaller "best_int" models), and pdf.js's image decoders for scanned PDFs (JBIG2, JPEG 2000).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dst = join(root, 'public', 'ocr');
const require = createRequire(join(root, 'package.json'));
const pkg = (name, from = require) => {
  try {
    return dirname(from.resolve(`${name}/package.json`));
  } catch {
    console.error(`sync-ocr: package ${name} is not installed — run npm install`);
    process.exit(1);
  }
};

const tess = pkg('tesseract.js');
const core = pkg('tesseract.js-core', createRequire(join(tess, 'package.json'))); // the version tesseract.js depends on
const pdfjs = pkg('pdfjs-dist');
const FILES = [
  [join(tess, 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [join(core, f), f]),
  ...['tha', 'eng'].map((l) => [join(pkg(`@tesseract.js-data/${l}`), '4.0.0_best_int', `${l}.traineddata.gz`), `${l}.traineddata.gz`]),
  ...['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_QCMS'].map((f) => [join(pdfjs, 'wasm', f), join('pdfjs', f)]),
];

mkdirSync(join(dst, 'pdfjs'), { recursive: true });
let n = 0, bytes = 0;
for (const [from, rel] of FILES) {
  if (!existsSync(from)) {
    console.error(`sync-ocr: missing ${from}`);
    process.exit(1);
  }
  const to = join(dst, rel), s = statSync(from);
  bytes += s.size;
  if (existsSync(to) && statSync(to).size === s.size && statSync(to).mtimeMs >= s.mtimeMs) continue;
  copyFileSync(from, to);
  n++;
}
console.log(`sync-ocr: ${n} file(s) copied to public/ocr (${(bytes / 1048576).toFixed(1)} MB in total)`);
