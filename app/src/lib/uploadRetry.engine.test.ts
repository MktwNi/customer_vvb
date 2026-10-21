/**
 * Uploads that get no readable answer (owner, 21 Oct 2569: "ทำไมถึงขึ้นแบบนี้บ่อยจังครับ แก้ไขยังไง" about a pink
 * "อัปโหลดเอกสารขึ้น Drive ไม่สำเร็จ: เชื่อมต่อสคริปต์ของทีมไม่ได้ (เก็บไว้ในเครื่องนี้ จะลองใหม่ในอีก 1 นาที)").
 * Run against the real team script (team-sync/Code.gs in the simulator); the file requests go through a fake
 * network that can fail them as the browser reports a dropped connection or Google's own error page (a
 * TypeError), answer slowly, and watches which requests of one browser are on their way at the same time.
 * - an upload that fails is sent again quietly within the round (3 s, then 10 s): one that then goes through
 *   never shows a notice;
 * - one that keeps failing shows the calm notice: how many files wait, when the next try is, and a button
 *   that sends them at once; it goes as soon as they are up, also when another tab sent them;
 * - uploads never run side by side with each other or with a sync round (its pull and push), however the
 *   rounds are started (focus, the 30 s timer, a sync, another tab of the browser);
 * - a phone that put the page away while a file was going up: no notice, sent again when the page is back;
 * - what cannot wait (signing out, the sign-out dialog sending what is queued) goes before an upload on its
 *   way: the upload is cut and goes again after, in this tab and in another tab of the browser;
 * - a file whose record no longer wants it (deleted, taken off) is not sent at its quiet try.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore, PREF } from './storage';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/retry/exec';
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

/**
 * One browser's network. `fail`: the next uploads that fail as a network error (TypeError); `down`: every file
 * request fails so; `slow`: ms an upload takes (fake time); `answer`: the script's reply to an upload instead
 * of storing it. `log`: every request in the order it started (`upload`, `ping`, `pull`, `push`…), with the
 * fake time and, for a file, its docId; `live`: the requests on their way now; `overlap`: an upload found on its
 * way with another upload or a sync request; `cut`: slow uploads the engine cut (their AbortSignal, as fetch).
 */
interface Net { fail: number; down: boolean; slow: number; answer?: Record<string, unknown>; log: { a: string; t: number; tab: string; id?: string }[]; live: string[]; overlap: string[]; cut: number }
const newNet = (): Net => ({ fail: 0, down: false, slow: 0, log: [], live: [], overlap: [], cut: 0 });
type Store = ReturnType<typeof memoryStore>;
interface Tab { e: GccEngine; net: Net; store: Store; browser: string; name: string }
type Priv = { teamWake: (ev?: Event) => void; teamPrefsChanged: (e: { key: string }) => void };

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
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
  vi.clearAllTimers(); // (a slow answer left over must not land in the next test's script)
  LS.clear();
  vi.stubGlobal('navigator', undefined);
  vi.stubGlobal('document', undefined);
});

/** Web Locks shared by the tabs of one browser (granted in order; `ifAvailable` gets null while held or queued). */
function fakeLocks() {
  const tail = new Map<string, Promise<void>>(), busy = new Map<string, number>();
  return {
    request(name: string, a: unknown, b?: unknown) {
      const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean };
      const cb = (typeof a === 'function' ? a : b) as (lock: unknown) => unknown;
      if (opts.ifAvailable && busy.get(name)) return Promise.resolve().then(() => cb(null));
      busy.set(name, (busy.get(name) || 0) + 1);
      const run = (tail.get(name) || Promise.resolve()).then(() => cb({ name, mode: 'exclusive' }));
      tail.set(name, run.then(() => {}, () => {}).then(() => void busy.set(name, busy.get(name)! - 1)));
      return run;
    },
  };
}

/** A tab named `name` on `browser`, on that browser's network (another tab of it: pass that tab's store and net). */
function mk(browser: string, name = browser, store: Store = memoryStore(), net: Net = newNet()): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-21';
  raw.store = store;
  raw.rebuild();
  raw.loading = false;
  // a request on its way: an upload must find nothing else of this browser's on its way, and nothing may start beside it
  const go = async <T>(a: string, run: () => Promise<T>, doc?: string): Promise<T> => {
    const id = `${a}#${net.log.length}@${name}`;
    net.log.push({ a, t: Date.now(), tab: name, ...(doc ? { id: doc } : {}) });
    const up = (x: string) => x.startsWith('upload#');
    if (a === 'upload' ? net.live.some((x) => /^(upload|pull|push)#/.test(x)) : /^(pull|push)$/.test(a) && net.live.some(up)) net.overlap.push(`${id} with ${net.live.join(', ')}`);
    net.live.push(id);
    try {
      return await run();
    } finally {
      net.live.splice(net.live.indexOf(id), 1);
    }
  };
  raw.transport = (_u, body) => go(String(body.action), async () => sim.post(body) as Record<string, unknown>);
  // a slow answer ends early when the engine cuts the request (as fetch does with its signal)
  const slow = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((ok, no) => {
      const t = setTimeout(ok, ms);
      signal?.addEventListener('abort', () => (clearTimeout(t), net.cut++, no(new DOMException('cut', 'AbortError'))), { once: true });
    });
  raw.fileTransport = (_u, body, signal) =>
    go(
      String(body.action),
      async () => {
        if (body.action === 'upload' && net.slow) await slow(net.slow, signal);
        if (net.down || (body.action === 'upload' && net.fail > 0 && net.fail--)) throw new TypeError('Failed to fetch');
        if (body.action === 'upload' && net.answer) return net.answer;
        return sim.post(body) as Record<string, unknown>;
      },
      body.docId ? String(body.docId) : undefined,
    );
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
  const tab = { e, net, store, browser, name };
  tabs.push(tab);
  return tab;
}
const priv = (t: Tab) => t.e as unknown as Priv;
const tick = () => new Promise<void>((r) => setImmediate(r));
/** Fake time goes on in small steps (the quiet waits, slow answers) until `p` settles. */
async function drain<T>(p: Promise<T>, ms = 120000): Promise<T> {
  let done = false;
  p.then(() => (done = true), () => (done = true));
  for (let t = 0; t < ms && !done; t += 250) {
    await vi.advanceTimersByTimeAsync(250);
    await tick();
  }
  expect(done).toBe(true);
  return p;
}
async function settle(...ts: Tab[]) {
  for (let i = 0; i < 2; i++)
    for (const t of ts) {
      await drain(t.e.teamSyncNow());
      await drain(t.e.uploadDocs());
    }
}
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const quote = { kind: 'quotation', amount: 1000, target: 'forecast', basis: 'total', detected: 1000, docNo: 'Q-1', docDate: '' } as const;
const other = { kind: 'other', amount: null, target: 'none', basis: 'manual', detected: null, docNo: '', docDate: '' } as const;
const fileOf = (t: Tab, deal: string, id: string) => t.e.sales.docs[`${deal}/${id}`]?.fileId ?? null;
const uploads = (n: Net, tab?: string) => n.log.filter((x) => x.a === 'upload' && (!tab || x.tab === tab));
/** Every notice the tab showed (engine.docsWaitNote at each change), from now on. */
function watchNotes(t: Tab) {
  const seen: unknown[] = [];
  t.e.subscribe(() => {
    const w = t.e.docsWaitNote;
    if (w) seen.push(w);
  });
  return seen;
}

async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หัวหน้า', 'lead-pass-123');
  return L;
}
/** An account the admin made, signed in on `browser` with its own password. */
async function member(L: Tab, u: string, name: string, role: Role, browser = u, store?: Store, net?: Net) {
  const { temp } = await L.e.adminCreate({ u, name, role });
  const M = mk(browser, browser, store, net);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  expect(M.e.auth).toBe('');
  await settle(M);
  return M;
}
/** The lead's deal that sales account หมิว attaches to, from her computer X. */
async function team() {
  const L = await lead();
  const d = L.e.addDeal({ client: 'บริษัท ทดสอบอัปโหลดซ้ำ จำกัด' });
  await settle(L);
  const M = await member(L, 'miw', 'หมิว', 'sales', 'X');
  return { L, M, d };
}

describe('an upload that gets no readable answer', () => {
  it('is sent again quietly 3 s and 10 s later: one that then goes through never shows a notice', async () => {
    const { L, M, d } = await team();
    const seen = watchNotes(M);
    M.net.fail = 2;
    const doc = await M.e.attachDoc(d.id, pdf('qt.pdf'), quote);
    await drain(M.e.uploadDocs());
    const tries = uploads(M.net);
    expect(tries.length).toBe(3);
    expect([tries[1].t - tries[0].t, tries[2].t - tries[1].t]).toEqual([3000, 10000]);
    expect(fileOf(M, d.id, doc.id)).toBeTruthy();
    expect([M.e.docsWaitNote, M.e.docMsg, seen]).toEqual([null, '', []]);
    // one file in the team's Drive (the script keeps one copy of a file sent again), and the team sees it
    await settle(M, L);
    expect((await L.e.docBlob(L.e.sales.docs[`${d.id}/${doc.id}`])).size).toBeGreaterThan(0);
    expect(sim.drive.list().filter((f) => f.kind === 'file' && !f.trashed).length).toBe(1);
  });

  it('that keeps failing shows the calm notice: how many files wait, when the next try is, why; "ลองอีกครั้งตอนนี้" sends them at once and the notice goes', async () => {
    const { M, d } = await team();
    M.net.down = true;
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    const b = await M.e.attachDoc(d.id, pdf('b.pdf'), other);
    await drain(M.e.uploadDocs());
    const failedAt = Date.now();
    expect(M.e.docsWaitNote).toEqual({ n: 2, at: failedAt + 60000, why: 'การเชื่อมต่อกับ Google ขาดช่วงระหว่างส่ง', busy: false });
    expect(M.e.docMsg).toBe(''); // never the red message: nothing is wrong with the files
    expect(await M.store.get('docblob:' + a.id)).toBeTruthy();
    // the syncs within the minute do not send them again
    const n0 = M.net.log.length;
    for (let i = 0; i < 3; i++) await drain(M.e.teamSyncNow().then(() => M.e.uploadDocs()));
    expect(M.net.log.slice(n0).filter((x) => x.a === 'upload' || x.a === 'ping')).toEqual([]);

    // the person presses the button 20 s later: sent now, not at the minute
    M.net.down = false;
    await vi.advanceTimersByTimeAsync(20000);
    const p = M.e.retryDocsNow();
    expect(M.e.docsWaitNote?.busy).toBe(true); // "กำลังส่ง…"
    await drain(p);
    expect(uploads(M.net).at(-1)!.t).toBeLessThan(failedAt + 60000);
    expect([!!fileOf(M, d.id, a.id), !!fileOf(M, d.id, b.id), M.e.docsWaitNote, M.e.docMsg]).toEqual([true, true, null, '']);
  });

  it('a later round goes on by itself (1, then 2 minutes), and the notice follows the next try\'s time', async () => {
    const { M, d } = await team();
    M.net.down = true;
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await drain(M.e.uploadDocs());
    const first = M.e.docsWaitNote!;
    later(61000);
    await drain(M.e.teamSyncNow().then(() => M.e.uploadDocs()));
    const second = M.e.docsWaitNote!;
    expect(second.at - Date.now()).toBe(120000);
    expect(second.at).toBeGreaterThan(first.at);
    M.net.down = false;
    later(121000);
    await drain(M.e.teamSyncNow().then(() => M.e.uploadDocs()));
    expect([!!fileOf(M, d.id, a.id), M.e.docsWaitNote]).toEqual([true, null]);
  });

  it('a file the script refuses for good is the red message, never counted as waiting', async () => {
    const { M, d } = await team();
    M.net.answer = { ok: false, error: 'bad_file_type' };
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await drain(M.e.uploadDocs());
    expect(uploads(M.net).length).toBe(1); // not sent again quietly either
    expect(M.e.docMsg).toMatch(/^อัปโหลดเอกสารขึ้น Drive ไม่ได้ — a\.pdf: /);
    expect(M.e.docsWaitNote).toBe(null);
    // another file then fails for a while: the amber notice counts it alone, and the red message stays
    M.net.answer = undefined;
    M.net.down = true;
    await M.e.attachDoc(d.id, pdf('b.pdf'), other);
    await drain(M.e.uploadDocs());
    expect(M.e.docsWaitNote?.n).toBe(1);
    expect(M.e.docMsg).toMatch(/a\.pdf/);
    expect(fileOf(M, d.id, a.id)).toBe('');
  });

  it('never marks a document uploaded without its Drive file, and doGet\'s reply is not sent again quietly', async () => {
    const { M, d } = await team();
    M.net.answer = sim.get() as Record<string, unknown>; // {ok, app, hint}: a redirect turned the POST into a GET
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await drain(M.e.uploadDocs());
    expect(uploads(M.net).length).toBe(1);
    expect(fileOf(M, d.id, a.id)).toBe('');
    expect(M.e.docsWaitNote).toMatchObject({ n: 1, why: expect.stringMatching(/^ลิงก์ของทีมตอบกลับไม่ใช่คำตอบของสคริปต์/) });
    expect(M.e.docMsg).toBe('');
  });
});

describe('uploads take turns', () => {
  it('with each other and with the sync, whatever starts a round: focus, the 30 s timer, a sync, an attach', async () => {
    const { M, d } = await team();
    M.net.slow = 20000;
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    const b = await M.e.attachDoc(d.id, pdf('b.pdf'), other);
    const n0 = M.net.log.length;
    const runs: Promise<unknown>[] = [M.e.uploadDocs(), M.e.teamSyncNow(), M.e.uploadDocs(true)];
    for (let i = 0; i < 3; i++) {
      priv(M).teamWake(new Event('focus'));
      priv(M).teamWake(); // the timer
      await vi.advanceTimersByTimeAsync(5000);
      runs.push(M.e.uploadDocs());
    }
    await drain(Promise.all(runs));
    await settle(M);
    expect(M.net.overlap).toEqual([]);
    const log = M.net.log.slice(n0).map((x) => x.a);
    expect(log.filter((x) => x === 'upload').length).toBe(2); // each file once
    // a sync that waited goes between the two files (one push carries the attachments' records)
    const i1 = log.indexOf('upload'), i2 = log.lastIndexOf('upload');
    expect(log.slice(i1 + 1, i2)).toContain('pull');
    expect(log).toContain('push');
    expect([!!fileOf(M, d.id, a.id), !!fileOf(M, d.id, b.id), M.e.docsWaitNote]).toEqual([true, true, null]);
  });

  it('a push made while a slow upload is on its way waits for it, and is not lost', async () => {
    const { L, M, d } = await team();
    M.net.slow = 30000;
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    const up = M.e.uploadDocs();
    await vi.advanceTimersByTimeAsync(1000);
    const x = M.e.addDeal({ client: 'บริษัท เพิ่มระหว่างอัปโหลด จำกัด' });
    const s = M.e.teamSyncNow();
    await drain(Promise.all([up, s]));
    expect(M.net.overlap).toEqual([]);
    await settle(M, L);
    expect([!!fileOf(M, d.id, a.id), !!L.e.sales.deals[x.id]]).toEqual([true, true]);
  });

  it('across two tabs of one browser: one upload at a time, beside no sync; the notice in the other tab goes once the file is up', async () => {
    vi.stubGlobal('navigator', { onLine: true, locks: fakeLocks() });
    const L = await lead();
    const d = L.e.addDeal({ client: 'บริษัท สองแท็บอัปโหลด จำกัด' });
    await settle(L);
    const store = memoryStore(), net = newNet();
    const T1 = await member(L, 'miw', 'หมิว', 'sales', 'X', store, net);
    const T2 = mk('X', 'X2', store, net);
    await T2.e.teamOpen(URL);
    priv(T2).teamPrefsChanged({ key: PREF.session }); // follows the session T1 signed in with
    await settle(T2);
    expect([T2.e.auth, T2.e.session?.u]).toEqual(['', 'miw']);

    // T2's tries all fail: its notice; then T1 sends the file (they share the browser's files)
    net.down = true;
    const b = await T2.e.attachDoc(d.id, pdf('b.pdf'), quote);
    await drain(T2.e.uploadDocs());
    expect(T2.e.docsWaitNote?.n).toBe(1);
    net.down = false;
    await drain(T1.e.teamSyncNow());
    await drain(T1.e.uploadDocs(true));
    expect(fileOf(T1, d.id, b.id)).toBeTruthy();
    await settle(T1);
    // T2 hears of it at its next sync (on the timer, or as soon as the person looks at it again): its notice
    // goes without sending anything itself
    const sent = uploads(net, 'X2').length;
    await drain(T2.e.teamSyncNow());
    expect([fileOf(T2, d.id, b.id), T2.e.docsWaitNote]).toEqual([fileOf(T1, d.id, b.id), null]);
    await drain(T2.e.uploadDocs());
    expect(uploads(net, 'X2').length).toBe(sent);

    // both tabs start rounds while a slow upload of T2's is on its way: nothing side by side, the file once
    net.slow = 15000;
    const c = await T2.e.attachDoc(d.id, pdf('c.pdf'), other);
    const n0 = net.log.length;
    const runs = [T2.e.uploadDocs(), T1.e.uploadDocs(true), T1.e.teamSyncNow(), T2.e.teamSyncNow()];
    priv(T1).teamWake(new Event('focus'));
    priv(T2).teamWake(new Event('focus'));
    await drain(Promise.all(runs));
    await settle(T1, T2);
    expect(net.overlap).toEqual([]);
    expect(net.log.slice(n0).filter((x) => x.a === 'upload').length).toBe(1);
    expect([!!fileOf(T1, d.id, c.id), !!fileOf(T2, d.id, c.id), T1.e.docsWaitNote, T2.e.docsWaitNote]).toEqual([true, true, null, null]);
  });
});

describe('what brings a waiting upload forward, and what does not', () => {
  it('a phone that puts the page away while a file goes up: no notice, the round ends quietly and the file goes as soon as the page is back', async () => {
    const doc = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal('document', doc);
    const { M, d } = await team();
    const seen = watchNotes(M);
    M.net.slow = 8000;
    const a = await M.e.attachDoc(d.id, pdf('photo.pdf'), quote);
    const up = M.e.uploadDocs();
    await vi.advanceTimersByTimeAsync(2000);
    // the screen locks: the browser cuts the request (and would cut any other while the page is away)
    doc.hidden = true;
    priv(M).teamWake(new Event('visibilitychange'));
    M.net.down = true;
    await drain(up);
    expect(uploads(M.net).length).toBe(1); // no quiet tries while the page is away
    await vi.advanceTimersByTimeAsync(120000); // nor on the timer, nor after the sync of the attachment's record
    expect(uploads(M.net).length).toBe(1);
    expect([M.e.docsWaitNote, M.e.docMsg, fileOf(M, d.id, a.id)]).toEqual([null, '', '']);
    // the person opens the page again: sent at once (not at a retry time), without a notice
    M.net.down = false;
    doc.hidden = false;
    priv(M).teamWake(new Event('visibilitychange'));
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      expect(fileOf(M, d.id, a.id)).toBeTruthy();
    });
    expect(uploads(M.net).length).toBe(2);
    expect([M.e.docsWaitNote, seen]).toEqual([null, []]);
  });

  it('back online: files waiting after failed tries go at once', async () => {
    const { M, d } = await team();
    M.net.down = true;
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await drain(M.e.uploadDocs());
    expect(M.e.docsWaitNote?.n).toBe(1);
    M.net.down = false;
    priv(M).teamWake(new Event('online'));
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(500);
      expect(fileOf(M, d.id, a.id)).toBeTruthy();
    });
    expect(M.e.docsWaitNote).toBe(null);
  });

  it('focus alone does not bring a try forward (no burst of uploads from focus spam)', async () => {
    const { M, d } = await team();
    M.net.down = true;
    await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await drain(M.e.uploadDocs());
    const n = uploads(M.net).length;
    for (let i = 0; i < 5; i++) {
      priv(M).teamWake(new Event('focus'));
      await drain(M.e.teamSyncNow().then(() => M.e.uploadDocs()));
    }
    expect(uploads(M.net).length).toBe(n);
    expect(M.e.docsWaitNote?.n).toBe(1);
  });
});

describe('signing out while a round waits for its quiet try', () => {
  it('sends nothing more for that session, and leaves no notice behind; the file goes up after signing in again', async () => {
    const { M, d } = await team();
    M.net.fail = 99; // every upload (the script answers the rest)
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    const up = M.e.uploadDocs();
    await vi.advanceTimersByTimeAsync(500); // the first try failed; the round waits 3 s
    expect(uploads(M.net).length).toBe(1);
    // signing out gives what is waiting a last 10 s (the try at 3 s), then ends the session; the round's
    // next try (at 13 s) finds it ended
    await drain(M.e.teamLogout({}));
    await drain(up);
    await vi.advanceTimersByTimeAsync(60000);
    expect(uploads(M.net).length).toBe(2);
    expect([M.e.auth, M.e.docsWaitNote, M.e.docMsg]).toEqual(['login', null, '']);
    expect(await M.store.get('docblob:' + a.id)).toBeTruthy();
    M.net.fail = 0;
    await M.e.teamLogin('miw', 'miw-pass-123', true);
    await settle(M);
    expect([!!fileOf(M, d.id, a.id), M.e.docsWaitNote]).toEqual([true, null]);
  });
});

/** What the team sees now: a fresh lead tab in another browser. */
async function leadView() {
  const V = mk('V' + Math.random().toString(36).slice(2, 6));
  expect(await V.e.teamOpen(URL)).toBe('accounts');
  await V.e.teamLogin('lead', 'lead-pass-123', false);
  await settle(V);
  return V;
}
/** Web Locks as a browser grants them: in a later task, never in the same run of microtasks. */
function taskLocks() {
  const tail = new Map<string, Promise<void>>(), busy = new Map<string, number>();
  const later = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    request(name: string, a: unknown, b?: unknown) {
      const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean };
      const cb = (typeof a === 'function' ? a : b) as (lock: unknown) => unknown;
      if (opts.ifAvailable && busy.get(name)) return later().then(() => cb(null));
      busy.set(name, (busy.get(name) || 0) + 1);
      const run = (tail.get(name) || Promise.resolve()).then(later).then(() => cb({ name, mode: 'exclusive' }));
      tail.set(name, run.then(() => {}, () => {}).then(() => void busy.set(name, busy.get(name)! - 1)));
      return run;
    },
  };
}
/** Two tabs of browser X signed in as หมิว (they share its files, its queue and its locks), and a deal of the lead's. */
async function twoTabs(locks: unknown) {
  vi.stubGlobal('navigator', { onLine: true, locks });
  const L = await lead();
  const d = L.e.addDeal({ client: 'บริษัท สองแท็บ จำกัด' });
  await settle(L);
  const store = memoryStore(), net = newNet();
  const T1 = await member(L, 'miw', 'หมิว', 'sales', 'X', store, net);
  const T2 = mk('X', 'X2', store, net);
  await T2.e.teamOpen(URL);
  priv(T2).teamPrefsChanged({ key: PREF.session });
  await settle(T2);
  expect([T2.e.auth, T2.e.session?.u]).toEqual(['', 'miw']);
  return { L, d, T1, T2, net };
}

describe('what cannot wait goes before an upload on its way (the upload gives way and goes again after)', () => {
  it('signing out: the edits and the attachment\'s record reach the team at once; the file stays here and goes up at the next sign-in', async () => {
    const { L, M, d } = await team();
    L.e.dispose();
    M.net.slow = 60000; // a large photo on a slow line
    const a = await M.e.attachDoc(d.id, pdf('big.pdf'), quote);
    await vi.advanceTimersByTimeAsync(1000);
    expect(M.net.live.some((x) => x.startsWith('upload#'))).toBe(true);
    const x = M.e.addDeal({ client: 'บริษัท แก้ก่อนออกจากระบบ จำกัด' });
    await vi.advanceTimersByTimeAsync(1000);
    const t0 = Date.now();
    await drain(M.e.teamLogout({}));
    expect(Date.now() - t0).toBeLessThanOrEqual(10250); // never longer than the last 10 s it gives what waits
    expect(M.e.auth).toBe('login');
    expect(M.net.cut).toBeGreaterThanOrEqual(1);
    expect(M.net.overlap).toEqual([]);
    // before the session ended: the edit and the record went (pull, push), nothing after the logout
    const sent = M.net.log.filter((y) => y.t >= t0).map((y) => y.a);
    expect(sent.slice(0, 2)).toEqual(['pull', 'push']);
    expect(sent.at(-1)).toBe('logout');
    await vi.advanceTimersByTimeAsync(120000);
    expect(M.net.log.filter((y) => y.t > t0 + 10250)).toEqual([]);
    const V = await leadView();
    expect([!!V.e.sales.deals[x.id], V.e.sales.docs[`${d.id}/${a.id}`]?.fileId]).toEqual([true, '']);
    // the file is safe here, and goes up when หมิว signs in again on this computer: one copy in Drive
    expect(await M.store.get('docblob:' + a.id)).toBeTruthy();
    M.net.slow = 0;
    await M.e.teamLogin('miw', 'miw-pass-123', true);
    await settle(M);
    expect(fileOf(M, d.id, a.id)).toBeTruthy();
    expect([M.e.docsWaitNote, M.e.docMsg]).toEqual([null, '']);
    expect(sim.drive.list().filter((f) => f.kind === 'file' && !f.trashed).length).toBe(1);
  });

  it('the sign-out dialog sending what is queued: the edits go at once, and the file goes again right after without a notice', async () => {
    const { L, M, d } = await team();
    const seen = watchNotes(M);
    M.net.slow = 30000;
    const a = await M.e.attachDoc(d.id, pdf('a.pdf'), quote);
    await vi.advanceTimersByTimeAsync(1000);
    const x = M.e.addDeal({ client: 'บริษัท ส่งก่อนออก จำกัด' });
    const t0 = Date.now();
    await drain(M.e.teamSyncNow({ urgent: true }));
    expect(Date.now() - t0).toBeLessThan(2000); // not after the file's 30 s
    expect(M.net.cut).toBe(1);
    await settle(L);
    expect(!!L.e.sales.deals[x.id]).toBe(true);
    // the cut file goes again by itself (after that sync), once, and nobody is told anything
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      expect(fileOf(M, d.id, a.id)).toBeTruthy();
    }, { timeout: 20000 });
    expect(M.net.overlap).toEqual([]);
    expect([M.e.docsWaitNote, M.e.docMsg, seen]).toEqual([null, '', []]);
    expect(sim.drive.list().filter((f) => f.kind === 'file' && !f.trashed).length).toBe(1);
  });

  it('another tab of the browser signing out: this tab\'s upload gives way when it hears of it, and the other tab\'s edits reach the team', async () => {
    const { d, T1, T2, net } = await twoTabs(fakeLocks());
    net.slow = 60000;
    const a = await T2.e.attachDoc(d.id, pdf('a.pdf'), quote); // T2 sends it (and holds the browser's turn)
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.live.some((x) => x.startsWith('upload#') && x.endsWith('@X2'))).toBe(true);
    const x = T1.e.addDeal({ client: 'บริษัท แก้ในแท็บที่ออก จำกัด' });
    const before = LS.get('X')!.get('gcc-file-yield');
    const out = T1.e.teamLogout({});
    await vi.advanceTimersByTimeAsync(0);
    // T1 asked the browser's other tabs to give way (a storage event reaches them): T2 hears of it
    expect(LS.get('X')!.get('gcc-file-yield')).not.toBe(before);
    priv(T2).teamPrefsChanged({ key: 'gcc-file-yield' });
    await drain(out);
    expect(net.cut).toBeGreaterThanOrEqual(1);
    expect(net.overlap).toEqual([]);
    // T2 hears of the sign-out too (it shares the session): an upload it started again meanwhile is cut, and
    // it leaves no notice
    priv(T2).teamPrefsChanged({ key: PREF.session });
    await vi.advanceTimersByTimeAsync(0);
    expect([T2.e.auth, net.live, T2.e.docsWaitNote]).toEqual(['login', [], null]);
    expect(await T2.store.get('docblob:' + a.id)).toBeTruthy();
    vi.stubGlobal('navigator', undefined); // (the lead looks from another computer)
    const V = await leadView();
    expect([!!V.e.sales.deals[x.id], V.e.sales.docs[`${d.id}/${a.id}`]?.fileId]).toEqual([true, '']);
  });
});

describe('a try that runs out of time', () => {
  /** M's uploads end by fileFetchTransport's own 180 s limit (as a TimeoutError) while `hang` is on. */
  function hangUploads(M: Tab) {
    const orig = M.e.fileTransport;
    const st = { hang: true, n: 0 };
    M.e.fileTransport = async (u, body, signal) => {
      if (st.hang && body.action === 'upload') {
        st.n++;
        await new Promise((r) => setTimeout(r, 180000));
        throw new DOMException('timeout', 'TimeoutError');
      }
      return orig(u, body, signal);
    };
    return st;
  }

  it('while the page was put away (a phone asleep longer than the limit): no notice and no wait; sent as soon as the page is back', async () => {
    const doc = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal('document', doc);
    const { M, d } = await team();
    const seen = watchNotes(M);
    const st = hangUploads(M);
    const a = await M.e.attachDoc(d.id, pdf('photo.pdf'), quote);
    await vi.advanceTimersByTimeAsync(2000);
    doc.hidden = true; // the screen locks right after attaching
    priv(M).teamWake(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(400000);
    expect(st.n).toBe(1); // not sent again while away
    expect([M.e.docsWaitNote, M.e.docMsg, seen]).toEqual([null, '', []]);
    // back: sent at once (not after a minute's wait), and still no notice
    st.hang = false;
    doc.hidden = false;
    priv(M).teamWake(new Event('visibilitychange'));
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(500);
      expect(fileOf(M, d.id, a.id)).toBeTruthy();
    });
    expect([M.e.docsWaitNote, seen]).toEqual([null, []]);
  });

  it('while the page stayed in view: not sent again quietly (it waited long enough); the notice says why', async () => {
    const { M, d } = await team();
    const st = hangUploads(M);
    await M.e.attachDoc(d.id, pdf('photo.pdf'), quote);
    await drain(M.e.uploadDocs(), 400000);
    expect(st.n).toBe(1);
    expect(M.e.docsWaitNote).toMatchObject({ n: 1, why: 'ส่งไม่ทันเวลา (ไฟล์ใหญ่หรืออินเทอร์เน็ตช้า)' });
  });
});

describe('"ลองอีกครั้งตอนนี้" while another tab of the browser is sending its own file (locks granted in a later task, as browsers do)', () => {
  it('waits for that tab\'s round instead of giving up, and the file goes: once, beside nothing, and the notice goes', async () => {
    const { d, T1, T2, net } = await twoTabs(fakeLocks());
    vi.stubGlobal('navigator', { onLine: true, locks: taskLocks() }); // (the set-up above runs without fake time)
    net.down = true;
    const b = await T2.e.attachDoc(d.id, pdf('b.pdf'), quote);
    await drain(T2.e.uploadDocs());
    expect(T2.e.docsWaitNote?.n).toBe(1);
    net.down = false;
    // T1 (not synced since: it does not know b yet) starts a slow round of its own file
    net.slow = 20000;
    const c = await T1.e.attachDoc(d.id, pdf('c.pdf'), other);
    await vi.advanceTimersByTimeAsync(1000);
    const n0 = net.log.length;
    const p = T2.e.retryDocsNow();
    await drain(p);
    // the press did not end before b was up (from this tab or the other, which shares the files)
    expect(fileOf(T2, d.id, b.id)).toBeTruthy();
    expect(T2.e.docsWaitNote).toBe(null);
    await settle(T1, T2);
    expect(net.log.slice(n0).filter((x) => x.a === 'upload' && x.id === b.id).length).toBeGreaterThanOrEqual(1);
    expect([fileOf(T1, d.id, b.id), !!fileOf(T1, d.id, c.id)]).toEqual([fileOf(T2, d.id, b.id), true]);
    expect(net.overlap).toEqual([]);
    expect(sim.drive.list().filter((f) => f.kind === 'file' && !f.trashed).length).toBe(2);
  });
});

describe('a file whose record no longer wants it by the time of its quiet try', () => {
  it('a document deleted meanwhile is not sent again (nothing made in Drive, nothing to trash)', async () => {
    const { M, d } = await team();
    M.net.fail = 1;
    const a = await M.e.attachDoc(d.id, pdf('gone.pdf'), quote);
    await vi.advanceTimersByTimeAsync(500); // the first try failed; the quiet one is 3 s later
    expect(uploads(M.net).length).toBe(1);
    M.e.deleteDoc(d.id, a.id);
    await drain(M.e.uploadDocs());
    await vi.advanceTimersByTimeAsync(20000);
    await settle(M);
    expect(uploads(M.net).length).toBe(1);
    expect(sim.drive.list().filter((f) => f.kind === 'file')).toEqual([]);
    expect([M.e.docsWaitNote, M.e.docMsg]).toEqual([null, '']);
  });

  it('a bill taken off meanwhile is not sent either', async () => {
    const { L, M } = await team();
    const d = L.e.addDeal({ client: 'บริษัท บิลระหว่างรอ จำกัด', resp: 'หมิว' });
    await settle(L, M);
    const x = M.e.addExpense(d.id, { c: 'ค่าเดินทาง', amt: 3500, d: '2026-10-05' })!;
    await settle(M);
    M.net.fail = 1;
    await M.e.attachExpenseBill(d.id, x.id, pdf('bill.pdf'));
    await vi.advanceTimersByTimeAsync(500);
    expect(uploads(M.net).length).toBe(1);
    expect(M.e.removeExpenseBill(d.id, x.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(20000);
    await settle(M);
    expect(uploads(M.net).length).toBe(1);
    expect(sim.drive.list().filter((f) => f.kind === 'file')).toEqual([]);
    expect([M.e.docsWaitNote, M.e.docMsg]).toEqual([null, '']);
  });
});
