/**
 * The same receipt attached by two accounts of a team, through the real team script in the simulator
 * (team-sync/Code.gs). In turn (the second already has the first's record): the dialog suggests
 * "ใช้ยอดนี้แทน" and Actual stays 60,000. At the same time (neither has the other's yet): both count after
 * the sync — no dialog can see it coming — so both browsers show "นับซ้ำ", and attaching it once more with
 * the suggested choice counts it once everywhere.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { analyzeDocText, proposedAmount, type DocFacts } from './docExtract';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { attachStage, countAs, countGuard, dealMoney, dupCounted, planOf, targetForStage, type AttachInfo, type CountMode, type Deal } from './sales';
import { acFig } from './salesUi';
import { receiveNow, undoReceive } from './attachPlan';
import type { Role } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 60000 });
const URL = 'https://script.google.com/macros/s/a/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});
const T0 = new Date('2026-10-20T03:00:00Z');
const TODAY = '2026-10-20';
let base: Dataset, R: RoundRaw[], sim: GasSim, fx: DocFacts;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 60);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
  fx = analyzeDocText(readFileSync(join(__dirname, '__fixtures__', 'INV2026090004.txt'), 'utf8'));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
interface Tab { e: GccEngine; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  vi.setSystemTime(T0);
});
/** One browser: its own local store, talking to the simulated script. */
function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = TODAY;
  raw.store = memoryStore();
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => sim.post(body) as Record<string, unknown>;
  raw.transport = post;
  raw.fileTransport = post;
  const e = new Proxy(raw, {
    get(t, p) {
      cur = browser;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? (...a: unknown[]) => ((cur = browser), (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
    },
  });
  const tab = { e, browser };
  tabs.push(tab);
  return tab;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...ts: Tab[]) {
  for (let i = 0; i < 3; i++)
    for (const t of ts) {
      await t.e.teamSyncNow();
      await tick();
    }
}
async function lead() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const L = mk('L');
  expect(await L.e.teamOpen(URL)).toBe('setup');
  await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
  return L;
}
async function member(L: Tab, u: string, name: string, role: Role) {
  const { temp } = await L.e.adminCreate({ u, name, role: 'viewer' });
  if (role !== 'viewer') await L.e.adminUpdate(u, { role });
  const M = mk(u);
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin(u, temp, true);
  await M.e.teamChangePassword('', u + '-pass-123');
  await settle(M);
  return M;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });

/** The attach dialog on the sample receipt in browser `t` at `stage`: proposed figure, suggested choice. */
async function attach(t: Tab, id: string, o: { stage?: string; mode?: CountMode } = {}) {
  const S = t.e.sales, d = S.deals[id] as Deal, kind = fx.kind!;
  const stage = o.stage ?? attachStage(S, d, { kind, target: 'actual' }, TODAY);
  const p = proposedAmount(fx), file = pdf('INV2026090004.pdf');
  const info: AttachInfo = { kind, amount: p.value, target: targetForStage(S.cfg, stage, kind), docDate: fx.docDate, stage };
  const g = countGuard(S, d, { ...info, pinned: true, docNo: fx.docNo, name: file.name, size: file.size, figures: [fx.total, fx.netPay, fx.subtotal], refs: fx.refs }, TODAY);
  const how = countAs(g, o.mode ?? g.pick, info);
  await t.e.attachDoc(id, file, { kind, amount: how.amount, target: how.target, basis: p.basis, detected: p.value, docNo: fx.docNo, docDate: fx.docDate, stage: how.stage, replace: how.replace, drop: how.drop, addHand: how.addHand });
  return g;
}
const money = (t: Tab, id: string) => {
  const d = t.e.sales.deals[id];
  return { actual: dealMoney(t.e.sales, d).actual, dup: dupCounted(t.e.sales, d).map((gr) => gr.length), word: acFig(t.e.sales, d).word, pay1: planOf(t.e.sales, d, TODAY)!.lines[0].status };
};

describe('team mode: two accounts, one receipt (plan of 1 installment, 60,000)', () => {
  async function job() {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    const d = A.e.addDeal({ client: 'บริษัท ตัวอย่างทีม จำกัด', year: '2569', resp: 'เอก' } as Partial<Deal>);
    A.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    A.e.quickPlan(d.id, 1, [60000]);
    await settle(A, L);
    return { L, A, id: d.id };
  }

  it('in turn: the second account is asked and replaces it, Actual 60,000', async () => {
    const { L, A, id } = await job();
    expect((await attach(A, id, { stage: 'PAY1' })).modes).toEqual([]);
    await settle(A, L);
    const b = await attach(L, id, { stage: 'PAY1' });
    expect(b).toMatchObject({ sameBy: 'no', modes: ['replace', 'none', 'add'], pick: 'replace' });
    await settle(L, A, L);
    for (const t of [A, L]) expect(money(t, id)).toEqual({ actual: 60000, dup: [], word: 'จากเอกสาร', pay1: 'paid' });
  });

  it('at the same time: both browsers show "นับซ้ำ" after the sync, and attaching it once more counts it once', async () => {
    const { L, A, id } = await job();
    await attach(A, id, { stage: 'PAY1' });
    await attach(L, id, { stage: 'PAY1' });
    await settle(A, L, A, L);
    for (const t of [A, L]) expect(money(t, id)).toEqual({ actual: 120000, dup: [2], word: 'นับซ้ำ', pay1: 'paid' });
    // anyone attaching it again is told it is counted twice, and "ใช้ยอดนี้แทน" stops both copies
    const c = await attach(L, id, { stage: 'PAY1' });
    expect(c.sames).toHaveLength(2);
    expect(c.pick).toBe('replace');
    await settle(L, A, L);
    for (const t of [A, L]) expect(money(t, id)).toEqual({ actual: 60000, dup: [], word: 'จากเอกสาร', pay1: 'paid' });
  });
});

describe('team mode: "รับเงินแล้ว" in one tap, then "เลิกทำ"', () => {
  async function job() {
    const L = await lead();
    const A = await member(L, 'aek', 'เอก', 'sales');
    const d = A.e.addDeal({ client: 'บริษัท ตัวอย่างทีม จำกัด', year: '2569', resp: 'เอก' } as Partial<Deal>);
    A.e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    A.e.quickPlan(d.id, 1, [60000]);
    A.e.updatePayLine(d.id, 'PAY1', { amt: 60000 });
    await settle(A, L);
    return { L, A, id: d.id };
  }
  const line = (t: Tab, id: string) => {
    const l = planOf(t.e.sales, t.e.sales.deals[id], TODAY)!.lines[0];
    return { actual: dealMoney(t.e.sales, t.e.sales.deals[id]).actual, got: l.got, status: l.status, rcv: l.line.rcv };
  };

  it('synced to a teammate and taken back: both browsers as before the tap', async () => {
    const { L, A, id } = await job();
    const before = line(L, id);
    const x = receiveNow(A.e, id, 'PAY1', TODAY)!;
    await settle(A, L);
    expect(line(L, id)).toMatchObject({ actual: 60000, status: 'paid', rcv: TODAY });
    expect(undoReceive(A.e, x.undo)).toEqual({ stale: [] });
    await settle(A, L, A);
    for (const t of [A, L]) expect(line(t, id)).toEqual(before);
  });

  it('a teammate corrected it meanwhile (55,000 on 18 Oct): "เลิกทำ" refuses, the correction stays everywhere', async () => {
    const { L, A, id } = await job();
    const x = receiveNow(A.e, id, 'PAY1', TODAY)!;
    await settle(A, L);
    L.e.markPaid(id, 'PAY1', { date: '2026-10-18', amount: 55000, how: 'transfer', full: false });
    await settle(L, A);
    expect(undoReceive(A.e, x.undo)).toEqual({ stale: ['PAY1'] });
    await settle(A, L, A);
    for (const t of [A, L]) expect(line(t, id)).toMatchObject({ actual: 55000, got: 55000, rcv: '2026-10-18' });
  });
});
