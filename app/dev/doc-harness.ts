// Dev-only harness: reads a chosen file with readDocText, analyses it with analyzeDocText and shows
// the result. dev/run-doc-harness.cjs drives it in Chromium and reads window.__docResult; the
// "ยกเลิก" button (or window.__docAbort()) cancels the read, as closing the dialog does in the app.
import { analyzeDocText, factsScore } from '../src/lib/docExtract';
import { readDocText } from '../src/lib/docText';

declare global {
  interface Window { __docResult?: unknown; __docAbort?: () => void }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let current: AbortController | null = null;

async function run(file: File) {
  current?.abort();
  const ctl = (current = new AbortController());
  document.body.dataset.state = 'running';
  window.__docResult = undefined;
  const progress: string[] = [];
  const t0 = performance.now();
  try {
    const dt = await readDocText(file, {
      signal: ctl.signal,
      forceOcr: $<HTMLInputElement>('force').checked,
      judge: (t) => factsScore(analyzeDocText(t)), // as the app does (DocAttach)
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
    // what DocAttach would see: an AbortError after a cancel, otherwise an Error with a Thai message
    const err = e as Error;
    window.__docResult = { file: file.name, error: String(err?.message || e), errorName: err?.name, isError: e instanceof Error, readMs: Math.round(performance.now() - t0), progress };
    $('result').textContent = 'ผิดพลาด: ' + String(err?.message || e);
    document.body.dataset.state = 'error';
  }
}

window.__docAbort = () => current?.abort();
$('cancel').addEventListener('click', () => current?.abort());
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void run(f);
});
