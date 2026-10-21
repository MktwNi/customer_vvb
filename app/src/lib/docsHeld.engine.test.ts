/**
 * Files a sales account attached that the team's link would not store (owner, 20 Oct 2569: "ในทีมแนบข้อมูลแล้ว
 * ขึ้นแบบนี้แก้ไขยังไง", a red "สคริปต์ของทีมยังเป็นเวอร์ชันเก่า" banner after a teammate attached a document).
 * Run against the real team script (team-sync/Code.gs in the simulator), with the link's answer to the file
 * requests bent the ways a deployment can answer:
 * - `nofiles`: ping without `files`, as a script from before attachments (the deployment on such a version);
 * - `doget`: doGet's {ok, app, hint} for every request, as when a redirect turns the POST into a GET.
 * The files wait in this browser with a notice that says they are safe and what the team lead does; they go up
 * a minute after the script is right, or at once when the person comes back to the tab or attaches another;
 * and a tab whose files went up from another tab drops its notice and message without a reload.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { FILES_RECHECK_MS, GccEngine } from './engine';
import { memoryStore, PREF } from './storage';
import { NOT_SCRIPT } from './teamFiles';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/held/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));

/** localStorage per browser: each engine reads and writes the one of its browser. */
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

/** How the link answers this browser's file requests (ping, upload…); `fail`: they fail as a network error. */
interface Net { files: 'ok' | 'nofiles' | 'doget' | 'fail'; sent: string[] }
type Store = ReturnType<typeof memoryStore>;
interface Tab { e: GccEngine; net: Net; store: Store; browser: string }
type Priv = { teamWake: (ev?: Event) => void; probeCaps: (url: string) => void; teamPrefsChanged: (e: { key: string }) => void; teamBusy: boolean };

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-20T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 100);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
});

/** A tab on `browser` (another tab of it: pass that tab's store, which holds the attached files). */
function mk(browser: string, store: Store = memoryStore()): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-20';
  raw.store = store;
  raw.rebuild();
  raw.loading = false;
  const net: Net = { files: 'ok', sent: [] };
  raw.transport = async (_u, body) => sim.post(body);
  raw.fileTransport = async (_u, body) => {
    net.sent.push(String(body.action));
    if (net.files === 'fail') throw new TypeError('Failed to fetch');
    if (net.files === 'doget') return sim.get() as Record<string, unknown>;
    const r = sim.post(body) as Record<string, unknown>;
    if (net.files === 'nofiles' && body.action === 'ping') delete r.files;
    return r;
  };
  const e = new Proxy(raw, {
    get(t, p) {
      cur = browser;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function'
        ? (...a: unknown[]) => {
            cur = browser;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          }
        : v;
    },
  });
  const tab = { e, net, store, browser };
  tabs.push(tab);
  return tab;
}
const priv = (t: Tab) => t.e as unknown as Priv;
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...ts: Tab[]) {
  for (let i = 0; i < 3; i++)
    for (const t of ts) {
      await t.e.teamSyncNow();
      await tick();
    }
}
/** A sync round, then the upload round it starts, finished. */
async function round(t: Tab) {
  await t.e.teamSyncNow();
  await t.e.uploadDocs();
}
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
/** An upload round whose tries fail: fake time goes on through its quiet waits (3 s, 10 s) until it ends. */
async function quietTries(p: Promise<unknown>) {
  let done = false;
  p.then(() => (done = true));
  for (let i = 0; i < 200 && !done; i++) {
    await vi.advanceTimersByTimeAsync(250);
    await tick();
  }
  await p;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const quote = { kind: 'quotation', amount: 1000, target: 'forecast', basis: 'total', detected: 1000, docNo: 'Q-1', docDate: '' } as const;
const fileOf = (t: Tab, deal: string, id: string) => t.e.sales.docs[`${deal}/${id}`]?.fileId ?? null;

async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
  return L;
}
/** An account the admin made, signed in on `browser` with its own password. */
async function member(L: Tab, u: string, name: string, role: Role, browser = u, store?: Store) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(browser, store);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  expect(M.e.auth).toBe('');
  await settle(M);
  return M;
}
/** The lead's deal that sales account หมิว attaches to, from browser X. */
async function team() {
  const L = await lead();
  const d = L.e.addDeal({ client: 'บริษัท ทดสอบแนบเอกสาร จำกัด' });
  await settle(L);
  const M = await member(L, 'miw', 'หมิว', 'sales', 'X');
  await settle(M);
  return { L, M, d };
}

describe('files a sales account attached while the link answers as a script that cannot store them', () => {
  it('wait here with the notice instead of an error, and go up a minute after the script is right, without a reload', async () => {
    const { L, M, d } = await team();
    M.net.files = 'nofiles';
    const doc = await M.e.attachDoc(d.id, pdf('qt.pdf'), quote);
    await M.e.uploadDocs();
    expect(M.e.teamFiles).toBe(false);
    expect([M.e.docsHeld, M.e.docMsg, fileOf(M, d.id, doc.id)]).toEqual([1, '', '']);
    expect(await M.store.get('docblob:' + doc.id)).toBeTruthy(); // the only copy, kept
    expect(M.net.sent).not.toContain('upload');

    // the lead deploys the new version: the next rounds within the minute still take the last answer
    M.net.files = 'ok';
    later(30000);
    await round(M);
    expect(M.e.docsHeld).toBe(1);
    later(FILES_RECHECK_MS);
    await round(M);
    expect(fileOf(M, d.id, doc.id)).toBeTruthy();
    expect([M.e.teamFiles, M.e.docsHeld, M.e.docMsg]).toEqual([true, 0, '']);
    await settle(M, L);
    expect((await L.e.docBlob(L.e.sales.docs[`${d.id}/${doc.id}`])).size).toBeGreaterThan(0);
  });

  it('are asked about again at once when the person comes back to the tab, not on the 30 s timer', async () => {
    const { M, d } = await team();
    M.net.files = 'nofiles';
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await M.e.uploadDocs();
    expect(M.e.docsHeld).toBe(1);
    M.net.files = 'ok';
    const pings = () => M.net.sent.filter((x) => x === 'ping').length;
    const n0 = pings();
    priv(M).teamWake(); // the timer
    await vi.waitFor(() => expect(priv(M).teamBusy).toBe(false));
    await M.e.uploadDocs();
    expect([pings(), M.e.docsHeld]).toEqual([n0, 1]);
    priv(M).teamWake(new Event('focus')); // the person comes back (told the lead has deployed)
    await vi.waitFor(() => expect(fileOf(M, d.id, a.id)).toBeTruthy());
    expect([pings(), M.e.docsHeld, M.e.docMsg]).toEqual([n0 + 1, 0, '']);
  });

  it('are asked about again at once when another file is attached', async () => {
    const { M, d } = await team();
    M.net.files = 'nofiles';
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await M.e.uploadDocs();
    expect(M.e.docsHeld).toBe(1);
    M.net.files = 'ok';
    const b = await M.e.attachDoc(d.id, pdf('b.pdf'), quote);
    await M.e.uploadDocs();
    expect([!!fileOf(M, d.id, a.id), !!fileOf(M, d.id, b.id), M.e.docsHeld]).toEqual([true, true, 0]);
  });

  it('are asked about again at the next round once the script\'s hello says it stores files', async () => {
    const { M, d } = await team();
    M.net.files = 'nofiles';
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await M.e.uploadDocs();
    expect(M.e.docsHeld).toBe(1);
    M.net.files = 'ok';
    priv(M).probeCaps(URL); // asked now and then after a sync
    await vi.waitFor(() => expect(M.e.caps?.files).toBe(true));
    await round(M);
    expect([!!fileOf(M, d.id, a.id), M.e.docsHeld]).toEqual([true, 0]);
  });

  it('in a second tab of the same browser: once the files went up from the other tab, its notice and message go without a reload', async () => {
    const L = await lead();
    const d = L.e.addDeal({ client: 'บริษัท สองแท็บ จำกัด' });
    await settle(L);
    const store = memoryStore();
    const T1 = await member(L, 'miw', 'หมิว', 'sales', 'X', store);
    const T2 = mk('X', store);
    await T2.e.teamOpen(URL);
    priv(T2).teamPrefsChanged({ key: PREF.session }); // follows the session T1 signed in with
    await settle(T2);
    expect([T2.e.auth, T2.e.session?.u]).toEqual(['', 'miw']);

    // T2 attaches while the link answers as the old script; T1 is opened again after the lead fixed it
    T2.net.files = 'nofiles';
    const a = await T2.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await T2.e.uploadDocs();
    expect(T2.e.docsHeld).toBe(1);
    T2.net.files = 'ok';
    await settle(T2, T1);
    await T1.e.uploadDocs();
    await settle(T1, T2);
    expect(fileOf(T1, d.id, a.id)).toBeTruthy();
    expect([fileOf(T2, d.id, a.id), T2.e.docsHeld, T2.e.docMsg]).toEqual([fileOf(T1, d.id, a.id), 0, '']);

    // T2's tries fail (also the quiet ones): its waiting notice, never the red message; then T1 uploads that
    // file: T2's notice goes once it hears of it
    T2.net.files = 'fail';
    const b = await T2.e.attachDoc(d.id, pdf('b.pdf'), quote);
    await quietTries(T2.e.uploadDocs());
    expect([T2.e.docsWaitNote?.n, T2.e.docMsg]).toEqual([1, '']);
    await settle(T2, T1);
    await T1.e.uploadDocs();
    await settle(T1);
    T2.net.files = 'ok';
    await round(T2);
    expect([!!fileOf(T2, d.id, b.id), T2.e.docsWaitNote, T2.e.docMsg]).toEqual([true, null, '']);
    // T2 uploaded nothing, T1 both files
    expect([T2.net.sent.filter((x) => x === 'upload').length, T1.net.sent.filter((x) => x === 'upload').length]).toEqual([0, 2]);
  });

  it('on another device of the same account, files attached elsewhere are neither held here nor a reason to ask the script', async () => {
    const { M, d } = await team();
    M.net.files = 'nofiles';
    const doc = await M.e.attachDoc(d.id, pdf('qt.pdf'), quote);
    await M.e.uploadDocs();
    await settle(M);
    expect(M.e.docsHeld).toBe(1);
    // หมิว on her phone: the document's record arrives, its file is on the computer
    const P = mk('phone');
    expect(await P.e.teamOpen(URL)).toBe('accounts');
    await P.e.teamLogin('miw', 'miw-pass-123', true);
    P.net.files = 'nofiles';
    await round(P);
    expect(P.e.sales.docs[`${d.id}/${doc.id}`]?.fileId).toBe('');
    expect([P.e.docsHeld, P.e.docsUnsent, P.e.docMsg, P.net.sent]).toEqual([0, 0, '', []]);
  });

  it('a reply that is not the script\'s (doGet\'s) is a failed upload to retry, never "old script", and never marks a document uploaded', async () => {
    const { M, d } = await team();
    M.net.files = 'doget';
    const doc = await M.e.attachDoc(d.id, pdf('qt.pdf'), quote);
    await M.e.uploadDocs();
    expect(M.e.teamFiles).toBe(null);
    expect(M.e.docsHeld).toBe(0);
    // the waiting notice says what the lead checks; the file is fine, so never the red message
    expect(M.e.docsWaitNote).toEqual({ n: 1, at: Date.now() + 60000, why: NOT_SCRIPT, busy: false });
    expect(M.e.docMsg).toBe('');
    expect(fileOf(M, d.id, doc.id)).toBe('');
    M.net.files = 'ok';
    later(61000);
    await round(M);
    expect([!!fileOf(M, d.id, doc.id), M.e.docsWaitNote, M.e.docMsg]).toEqual([true, null, '']);
  });

  it('signing out ends the notice and keeps the file; it goes up after signing in again', async () => {
    const { M, d } = await team();
    M.net.files = 'nofiles';
    const doc = await M.e.attachDoc(d.id, pdf('qt.pdf'), quote);
    await M.e.uploadDocs();
    expect(M.e.docsHeld).toBe(1);
    await M.e.teamLogout({});
    expect([M.e.auth, M.e.docsHeld, M.e.docMsg]).toEqual(['login', 0, '']);
    expect(await M.store.get('docblob:' + doc.id)).toBeTruthy();
    M.net.files = 'ok';
    await M.e.teamLogin('miw', 'miw-pass-123', true);
    await round(M);
    expect([!!fileOf(M, d.id, doc.id), M.e.docsHeld]).toEqual([true, 0]);
  });
});
