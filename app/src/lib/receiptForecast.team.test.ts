/**
 * The owner's closed deal (receipt INV2026090004 at PAY counted as the Forecast, Actual 121,730.77 recorded by
 * one tap) through the real team script in the simulator (team-sync/Code.gs), two accounts and a fresh sign-in:
 * - a plan set on a deal that counts the receipt twice carries 60,000 to every browser, never 121,730.77;
 * - one tap at a plan line well past the Forecast writes nothing anywhere;
 * - set right with the card's own choice (Actual) and the plan at 60,000: Forecast QT v2 60,000, Actual 60,000
 *   from the receipt, PAY paid, still closed — in every browser.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { DEAL_STAGE, dealMoney, docsOf, dupCounted, formTarget, planOf, targetWrong, type Deal, type DealDoc } from './sales';
import { acFig, fcFig } from './salesUi';
import { receiveNow, recvPlan } from './attachPlan';
import { qtView } from './quotes';
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
const T0 = new Date('2026-10-20T01:00:00Z');
const TODAY = '2026-10-21';
const at = (iso: string) => vi.setSystemTime(new Date(iso));
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 60);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
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
/** The owner (lead) and หมิว (sales), signed in. */
async function team() {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
  sim.setup();
  const O = mk('owner');
  expect(await O.e.teamOpen(URL)).toBe('setup');
  await O.e.teamClaim(sim.ownerCode()!, 'owner', 'เจ้าของ', 'owner-pass-123');
  const { temp } = await O.e.adminCreate({ u: 'miew', name: 'หมิว', role: 'viewer' });
  await O.e.adminUpdate('miew', { role: 'sales' as Role });
  const M = mk('miew');
  expect(await M.e.teamOpen(URL)).toBe('accounts');
  await M.e.teamLogin('miew', temp, true);
  await M.e.teamChangePassword('', 'miew-pass-123');
  await settle(M, O);
  return { O, M };
}
/** หมิว's browser signed in afresh: the whole team log from the start. */
async function fresh() {
  const F = mk('miew-fresh');
  expect(await F.e.teamOpen(URL)).toBe('accounts');
  await F.e.teamLogin('miew', 'miew-pass-123', false);
  await settle(F);
  return F;
}
const pdf = (name: string, size: number) => Object.assign(new Blob([new Uint8Array(size)], { type: 'application/pdf' }), { name });
const RN = 'INV2026090004_บริษัท พีเอ็ม เอ็นไวรอนเมนทัล จำกัด_.pdf';
/** The deal as หมิว won it (QT v1 61,730.77 → v2 60,000, YES 20 ต.ค.) with the receipt counted twice at PAY1. */
async function won(M: Tab) {
  at('2026-10-20T01:30:00Z');
  const id = M.e.addDeal({ client: 'ทองมงคลอุตสาหกรรมน้ำมันปาล์ม', section: 'Partner', resp: 'หมิว', year: '2569' } as Partial<Deal>).id;
  await M.e.attachDoc(id, pdf('QT2026070022.pdf', 120001), { kind: 'quotation', amount: 61730.77, target: 'forecast', basis: 'total', detected: 61730.77, docNo: 'QT2026070022', docDate: '2026-07-27', stage: 'QUOTATION' });
  at('2026-10-20T02:00:00Z');
  M.e.setStep(id, DEAL_STAGE, { d: '2026-10-20', n: 'YES' });
  const v1 = qtView(M.e.sales, M.e.sales.deals[id]).head!.doc;
  await M.e.attachDoc(id, pdf('QT2026070022.pdf', 120001), { kind: 'quotation', amount: 60000, target: 'forecast', basis: 'manual', detected: 60000, docNo: 'QT2026070022', docDate: '2026-07-27', stage: 'QUOTATION', revise: v1.id });
  at('2026-10-20T02:10:00Z');
  await M.e.attachDoc(id, pdf(RN, 319147), { kind: 'receipt', amount: 61730.77, target: 'actual', basis: 'total', detected: 61730.77, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY1' });
  at('2026-10-20T02:11:00Z');
  await M.e.attachDoc(id, pdf(RN, 319147), { kind: 'receipt', amount: 60000, target: 'actual', basis: 'netPay', detected: 60000, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY1' });
  return id;
}
const view = (t: Tab, id: string) => {
  const S = t.e.sales, d = S.deals[id], m = dealMoney(S, d), P = planOf(S, d, TODAY);
  return {
    fc: m.forecast, fcFrom: fcFig(S, d).doc?.kind ?? null, ac: m.actual, acWord: acFig(S, d).word,
    receipts: docsOf(S, id).filter((z) => z.kind === 'receipt').map((z) => `${z.stage}:${z.target}:${z.amount}`).sort().join(','),
    plan: P ? P.lines.map((l) => `${l.code} ${l.amt} got ${l.got} ${l.status}${l.hand ? ' hand' : ''}`).join(';') : '-',
    job: d.jobStatus,
  };
};
const doc = (t: Tab, id: string, f: (z: DealDoc) => boolean) => docsOf(t.e.sales, id).find(f)!;

describe('team mode: the receipt counted as the Forecast, and setting it right', () => {
  it('a plan set while the receipt counts twice carries 60,000 to every browser', async () => {
    const { O, M } = await team();
    const id = await won(M);
    await settle(M, O);
    expect(dupCounted(O.e.sales, O.e.sales.deals[id])).toHaveLength(1);
    at('2026-10-20T02:20:00Z');
    O.e.quickPlan(id, 1);
    await settle(O, M);
    const F = await fresh();
    for (const t of [O, M, F]) expect(t.e.sales.pays[`${id}/PAY1`]?.amt).toBe(60000);
    // the older copy set right ("ไม่นับยอด"): Actual is the plan, every browser
    at('2026-10-20T02:30:00Z');
    M.e.updateDoc(id, doc(M, id, (z) => z.kind === 'receipt' && z.amount === 61730.77).id, { target: 'none' });
    await settle(M, O, F);
    // (the quick plan's new installment for the rest has no amount: nothing is left of the Forecast)
    for (const t of [O, M, F]) expect(view(t, id)).toMatchObject({ fc: 60000, ac: 60000, plan: 'PAY1 60000 got 60000 paid;PAY2 0 got 0 wait' });
  });

  it('one tap at a plan line past the Forecast writes nothing; the card\'s own choice and the plan at 60,000 set it right everywhere', async () => {
    const { O, M } = await team();
    const id = await won(M);
    // what the live build let happen (the plan editor's pre-fill of the double count, "นับเป็น Forecast" on the card)
    at('2026-10-20T02:20:00Z');
    M.e.setPlan(id, [{ stage: 'PAY1', amt: 121730.77, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '' }]);
    at('2026-10-20T09:00:00Z');
    M.e.updateDeal(id, { jobStatus: 'closed' });
    await settle(M, O);
    at('2026-10-20T10:00:00Z');
    O.e.updateDoc(id, doc(O, id, (z) => z.kind === 'receipt' && z.amount === 61730.77).id, { target: 'none' });
    O.e.updateDoc(id, doc(O, id, (z) => z.kind === 'receipt' && z.amount === 60000).id, { target: 'forecast' });
    await settle(O, M);
    expect(view(M, id)).toMatchObject({ fc: 60000, fcFrom: 'receipt', ac: null, plan: 'PAY 121730.77 got 0 wait', job: 'closed' });
    // one tap "รับเงินแล้ว": refused (the planned 121,730.77 is twice the Forecast), nothing synced
    const r = recvPlan(M.e.sales, M.e.sales.deals[id], 'PAY1', TODAY)!;
    expect(r.over).toMatchObject({ cap: 60000, what: 'Forecast' });
    expect(receiveNow(M.e, id, 'PAY1', TODAY)).toBeNull();
    await settle(M, O);
    expect(O.e.sales.pays[`${id}/PAY1`]).toMatchObject({ amt: 121730.77, rcv: '' });
    // set right by the owner: แก้ไขแผน PAY 60,000, then the receipt card's form as it opens (Actual)
    at('2026-10-20T11:00:00Z');
    O.e.setPlan(id, [{ stage: 'PAY1', amt: 60000, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '' }]);
    const wrong = doc(O, id, (z) => !!targetWrong(z));
    expect(wrong).toMatchObject({ kind: 'receipt', target: 'forecast' });
    O.e.updateDoc(id, wrong.id, { target: formTarget(O.e.sales, O.e.sales.deals[id], wrong) });
    await settle(O, M);
    const F = await fresh();
    for (const t of [O, M, F])
      expect(view(t, id)).toEqual({ fc: 60000, fcFrom: 'quotation', ac: 60000, acWord: 'จากเอกสาร', receipts: 'PAY1:actual:60000,PAY1:none:61730.77', plan: 'PAY 60000 got 60000 paid', job: 'closed' });
  });
});
