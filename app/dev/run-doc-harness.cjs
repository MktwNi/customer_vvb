// Dev-only: reads every sample document in a real browser (Chromium via Playwright) through
// dev/doc-harness.html — readDocText (pdf.js / Tesseract OCR) + analyzeDocText — and compares what
// was detected with expected.json.
// Usage: node dev/run-doc-harness.cjs [samples-dir] [--prod] [--json]
//   The folder is created with dev/make-doc-samples.cjs when it has no expected.json.
//   --prod: `vite build` the harness (base './', like the site) and serve it under /customer_vvb/
//   as GitHub Pages does, instead of the dev server.
//   Writes <samples-dir>/results.json; exits 1 when a text PDF or the clean image reads wrong.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { loadPlaywright } = require('./pw.cjs');
const { makeSamples } = require('./make-doc-samples.cjs');

const app = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(os.tmpdir(), 'gcc-doc-samples'));
const FIELDS = ['kind', 'docNo', 'docDate', 'total', 'subtotal', 'vat', 'wht', 'netPay', 'party'];
// what must be right: every amount on text PDFs and the clean image; OCR of scans/photos is reported only
const STRICT = new Set(['pdf', 'png']);
// Tesseract's own chatter on the console, not errors of ours
const NOISE = /^(Warning: Parameter not found|Estimating resolution|Detected \d+ diacritics|Image too small to scale|Line cannot be recognized)/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function devServer() {
  const { createServer } = await import('vite');
  const server = await createServer({ root: app, logLevel: 'error', server: { host: '127.0.0.1', port: 5199, strictPort: false } });
  await server.listen();
  return { url: server.resolvedUrls.local[0] + 'dev/doc-harness.html', close: () => server.close() };
}

async function prodServer() {
  const { build } = await import('vite');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gcc-doc-harness-'));
  await build({ root: app, base: './', logLevel: 'warn', build: { outDir: out, emptyOutDir: true, rollupOptions: { input: { harness: path.join(app, 'dev', 'doc-harness.html') } } } });
  const assets = fs.readdirSync(path.join(out, 'assets')).map((f) => [f, fs.statSync(path.join(out, 'assets', f)).size]);
  console.log('built harness chunks:\n' + assets.sort((a, b) => b[1] - a[1]).map(([f, n]) => `  ${(n / 1024).toFixed(0).padStart(6)} KB  ${f}`).join('\n'));
  const prefix = '/customer_vvb/';
  const srv = require('node:http').createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(out, u.slice(prefix.length));
    if (!u.startsWith(prefix) || !f.startsWith(out) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}${prefix}dev/doc-harness.html`, close: () => (srv.close(), fs.rmSync(out, { recursive: true, force: true })) };
}

async function main() {
  if (!fs.existsSync(path.join(dir, 'expected.json'))) {
    console.log(`making samples in ${dir} …`);
    await makeSamples(dir);
  }
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  execFileSync(process.execPath, [path.join(app, 'scripts', 'sync-ocr.mjs')], { stdio: 'inherit' });

  const server = args.includes('--prod') ? await prodServer() : await devServer();
  const url = server.url;
  console.log(`harness: ${url}`);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext(); // shared, like one user: OCR data is downloaded once, then cached
  const results = [];
  try {
    for (const [file, exp] of Object.entries(expected)) {
      const page = await context.newPage();
      const logs = [];
      page.on('console', (m) => m.type() === 'error' && !NOISE.test(m.text()) && logs.push(m.text()));
      page.on('pageerror', (e) => logs.push(String(e)));
      await page.goto(url);
      const t0 = Date.now();
      await page.setInputFiles('#file', path.join(dir, file));
      await page.waitForFunction(() => ['done', 'error'].includes(document.body.dataset.state), null, { timeout: 300000 });
      const r = await page.evaluate(() => window.__docResult);
      r.wallMs = Date.now() - t0;
      r.expected = exp;
      r.consoleErrors = logs;
      if (r.facts) r.diff = FIELDS.filter((f) => f in exp && r.facts[f] !== exp[f]).map((f) => ({ field: f, got: r.facts[f], want: exp[f] }));
      r.ok = !r.error && r.diff.length === 0;
      r.totalOk = !r.error && r.facts.total === exp.total;
      results.push(r);
      await page.close();
      const f = r.facts || {};
      console.log(
        `${r.ok ? 'OK  ' : r.totalOk ? 'PART' : 'FAIL'} ${file.padEnd(26)} ${String(r.method || '-').padEnd(8)} ${String(r.pages ?? '-').padStart(2)}p ${String(r.wallMs).padStart(6)} ms  ` +
          (r.error ? `error: ${r.error}` : `kind=${f.kind} no=${f.docNo} date=${f.docDate} total=${f.total} sub=${f.subtotal} vat=${f.vat} wht=${f.wht} net=${f.netPay} conf=${f.confidence}`),
      );
      for (const d of r.diff || []) console.log(`       ${d.field}: got ${JSON.stringify(d.got)}, expected ${JSON.stringify(d.want)}`);
      for (const l of logs) console.log(`       console: ${l}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
  const bad = results.filter((r) => STRICT.has(r.expected.type) && !r.totalOk);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} fully right, ${results.filter((r) => r.totalOk).length}/${results.length} totals right; results in ${path.join(dir, 'results.json')}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
