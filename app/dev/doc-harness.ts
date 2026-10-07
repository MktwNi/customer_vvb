// Dev-only harness: reads a chosen file with readDocText, analyses it with analyzeDocText and shows
// the result. dev/run-doc-harness.cjs drives it in Chromium and reads window.__docResult.
import { analyzeDocText } from '../src/lib/docExtract';
import { readDocText } from '../src/lib/docText';

declare global {
  interface Window { __docResult?: unknown }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function run(file: File) {
  document.body.dataset.state = 'running';
  window.__docResult = undefined;
  const progress: string[] = [];
  const t0 = performance.now();
  try {
    const dt = await readDocText(file, {
      forceOcr: $<HTMLInputElement>('force').checked,
      onProgress: (msg) => {
        $('progress').textContent = msg;
        if (progress[progress.length - 1] !== msg) progress.push(msg);
      },
    });
    const t1 = performance.now();
    const facts = analyzeDocText(dt.text);
    const t2 = performance.now();
    const result = { file: file.name, method: dt.method, pages: dt.pages, readMs: Math.round(t1 - t0), analyzeMs: Math.round(t2 - t1), facts, text: dt.text, progress };
    window.__docResult = result;
    $('result').textContent = JSON.stringify({ ...result, text: undefined }, null, 2);
    $('text').textContent = dt.text;
    document.body.dataset.state = 'done';
  } catch (e) {
    window.__docResult = { file: file.name, error: String((e as Error)?.message || e), progress };
    $('result').textContent = 'ผิดพลาด: ' + String((e as Error)?.message || e);
    document.body.dataset.state = 'error';
  }
}

$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void run(f);
});
