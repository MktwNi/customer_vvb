/**
 * Contacts beyond the stages (dact/<deal>/<id>) and a figure kept against its document, in the engine,
 * run against the real team script (team-sync/Code.gs in the simulator): what is stored and queued,
 * what a teammate's browser sees, and what goes with a deleted deal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { actsOf, docMismatch, emptySales, lastContactInfo, overdueDays, planOf, toAct, type DealDoc } from './sales';
import { acFig } from './salesUi';
import type { SyncOp } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/a/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-06';

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 200);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => vi.useRealTimers());

function mk(name: string) {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = TODAY;
  e.store = memoryStore();
  (e as unknown as { me: () => string }).me = () => name;
  e.rebuild();
  e.loading = false;
  e.transport = async (_u, body) => sim.post(body);
  e.fileTransport = async (_u, body) => sim.post(body);
  return e;
}
/** Two people on one team-code team. */
async function team() {
  sim = createGasSim({ teamKey: KEY });
  const A = mk('เอ'), B = mk('บี');
  for (const e of [A, B]) expect(await e.teamConnect(URL, KEY)).toBe(true);
  return [A, B] as const;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...es: GccEngine[]) {
  for (let i = 0; i < 3; i++)
    for (const e of es) {
      await e.teamSyncNow();
      await tick();
    }
}
const queued = async (e: GccEngine) => {
  await (e as unknown as { pq: Promise<unknown> }).pq;
  return (await e.store.get<SyncOp[]>('teamPending:' + URL)) || [];
};
function sheet(k: string): unknown {
  const r = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k === k);
  const l = r[r.length - 1];
  return !l ? undefined : l.del ? null : l.v;
}
const rowsOf = (prefix: string) => sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k.startsWith(prefix));
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
let n = 0;
const mkDeal = (e: GccEngine) => e.addDeal({ client: 'บริษัท ลูกค้าติดต่อหลายครั้ง ' + ++n + ' จำกัด', section: 'Partner', year: '2569' });
const ids = (e: GccEngine, deal: string) => actsOf(e.sales, deal).map((a) => a.note);

describe('contacts beyond the stages (dact records)', () => {
  it('add on one browser, see it on the other; both add at once and both stay; delete goes to both', async () => {
    const [A, B] = await team();
    const d = mkDeal(A);
    A.setStep(d.id, 'CALL1', { d: '2026-08-01', n: 'โทรแนะนำ' });
    await settle(A, B);
    expect(overdueDays(B.sales, B.sales.deals[d.id], TODAY)).toBe(66);

    const a1 = A.addAct(d.id, { type: 'call', note: 'โทรครั้งที่ 3 ขอเอกสารเพิ่ม', d: '2026-10-02' })!;
    // where the deal is (CALL1 done), a record of its own, not the deal or a stage
    expect(a1).toMatchObject({ deal: d.id, stage: 'CALL1', type: 'call', by: 'เอ', d: '2026-10-02' });
    const q = await queued(A);
    const op = q.find((o) => o.k === `dact/${d.id}/${a1.id}`)!;
    expect(op.v).toEqual({ d: '2026-10-02', type: 'call', note: 'โทรครั้งที่ 3 ขอเอกสารเพิ่ม', stage: 'CALL1', pid: '', by: 'เอ', at: a1.at });
    expect(op.f).toBeUndefined();
    expect(q.some((o) => o.k.startsWith('deal/') || o.k.startsWith('dstep/'))).toBe(false);
    expect(Object.values(A.sales.log).filter((l) => l.deal === d.id).pop()).toMatchObject({ action: 'บันทึกการติดต่อ', detail: 'โทร · CALL1 · โทรครั้งที่ 3 ขอเอกสารเพิ่ม' });

    // at the same moment on B, before either has synced
    const b1 = B.addAct(d.id, { type: 'email', note: 'ส่งโบรชัวร์', d: '2026-10-03', stage: 'CALL1' })!;
    await settle(A, B);
    for (const e of [A, B]) {
      expect(ids(e, d.id)).toEqual(['ส่งโบรชัวร์', 'โทรครั้งที่ 3 ขอเอกสารเพิ่ม']);
      expect(lastContactInfo(e.sales, e.sales.deals[d.id], TODAY)).toMatchObject({ date: '2026-10-03', from: 'act' });
      expect(overdueDays(e.sales, e.sales.deals[d.id], TODAY)).toBeNull();
    }
    expect(sheet(`dact/${d.id}/${b1.id}`)).toMatchObject({ type: 'email', by: 'บี', stage: 'CALL1' });

    // without accounts anyone may delete one (as the company's contact log): B removes A's
    expect(B.canDelAct(B.sales.acts![`${d.id}/${a1.id}`])).toBe(true);
    B.delAct(d.id, a1.id);
    await settle(B, A);
    for (const e of [A, B]) expect(ids(e, d.id)).toEqual(['ส่งโบรชัวร์']);
    expect(sheet(`dact/${d.id}/${a1.id}`)).toBeNull();
    A.dispose();
    B.dispose();
  });

  it('a deleted deal takes its contacts along, also one a stale browser adds for it meanwhile', async () => {
    const [A, B] = await team();
    const d = mkDeal(A);
    A.addAct(d.id, { type: 'meet', note: 'นัดพบที่โรงงาน' });
    A.addAct(d.id, { type: 'line', note: 'ส่งไลน์ตาม' });
    await settle(A, B);
    expect(ids(B, d.id)).toHaveLength(2);
    A.deleteDeal(d.id);
    expect(actsOf(A.sales, d.id)).toEqual([]);
    expect((await queued(A)).filter((o) => o.k.startsWith(`dact/${d.id}/`) && o.del)).toHaveLength(2);
    await A.teamSync();
    B.addAct(d.id, { type: 'call', note: 'ยังไม่รู้ว่าลบแล้ว' }); // B has not pulled the deletion
    await settle(B, A);
    for (const e of [A, B]) {
      expect(e.sales.deals[d.id]).toBeUndefined();
      expect(actsOf(e.sales, d.id)).toEqual([]);
    }
    const last = new Map(rowsOf(`dact/${d.id}/`).map((r) => [r.k, r]));
    expect([...last.values()].every((r) => r.del)).toBe(true);
    expect(rowsOf(`dact/${d.id}/`).some((r) => (r.v as { note?: string } | null)?.note === 'ยังไม่รู้ว่าลบแล้ว')).toBe(false);
    A.dispose();
    B.dispose();
  });

  it('nothing for a deal that is gone, an empty note is fine, and a backup adds what this browser lacks', async () => {
    const [A] = await team();
    expect(A.addAct('no-such-deal', { type: 'call', note: 'x' })).toBeNull();
    const d = mkDeal(A);
    expect(A.addAct(d.id, { type: 'other', note: '   ' })).toMatchObject({ note: '', type: 'other' });
    const C = mk('ซี');
    const v = { d: '2026-09-09', type: 'call', note: 'จากไฟล์สำรอง', stage: 'CALL1', pid: '', by: 'เอ', at: '2026-09-09T01:00:00.000Z' };
    C.sales.acts = { 'zz/keep': toAct({ ...v, note: 'ของเดิม' }, 'zz', 'keep')! };
    const backup = { kind: 'gcc-crm-backup', v: 1, crm: {}, contacts: {}, dedup: {}, custom: {}, sales: { ...emptySales(), acts: { 'zz/keep': v, 'zz/new': v, 'zz/bad': { type: 'call' }, junk: v } } };
    await C.importCrm(Object.assign(new Blob([JSON.stringify(backup)]), { name: 'b.json' }) as File);
    expect(Object.keys(C.sales.acts!).sort()).toEqual(['zz/keep', 'zz/new']);
    expect(C.sales.acts!['zz/keep'].note).toBe('ของเดิม');
    A.dispose();
    C.dispose();
  });
});

describe('a figure kept against its document', () => {
  it('"คงยอดเดิม" at PAY1: the plan\'s figure is counted, the document\'s own is kept; a teammate sees the same', async () => {
    const [A, B] = await team();
    const d = mkDeal(A);
    A.updateDeal(d.id, { forecast: 320000 });
    A.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    A.quickPlan(d.id, 2);
    // the receipt says 160,500; the plan says 160,000; the user keeps the plan's
    const kept = await A.attachDoc(d.id, pdf('rc.pdf'), { kind: 'receipt', amount: 160000, target: 'actual', basis: 'manual', detected: 160500, docNo: 'RC-1', docDate: '2026-10-05', stage: 'PAY1', kept: true });
    expect(docMismatch(kept)).toEqual({ doc: 160500, kept: 160000, diff: -500 });
    // the other choice at PAY2: the document's figure, read at its basis
    await A.attachDoc(d.id, pdf('rc2.pdf'), { kind: 'receipt', amount: 160500, target: 'actual', basis: 'total', detected: 160500, docNo: 'RC-2', docDate: '2026-10-05', stage: 'PAY2' });
    await settle(A, B);
    for (const e of [A, B]) {
      const P = planOf(e.sales, e.sales.deals[d.id], TODAY)!;
      expect(P.lines.map((l) => [l.stage, l.amt, l.got, l.status])).toEqual([['PAY1', 160000, 160000, 'paid'], ['PAY2', 160000, 160500, 'paid']]);
      expect(acFig(e.sales, e.sales.deals[d.id])).toMatchObject({ kind: 'warn', word: 'ไม่ตรงเอกสาร' });
      const doc = Object.values(e.sales.docs).find((x) => x.docNo === 'RC-1') as DealDoc;
      expect([doc.amount, doc.detected, doc.basis, doc.kept]).toEqual([160000, 160500, 'manual', true]);
    }
    // "ใช้ยอดจากเอกสาร" later, from the document's card: the figure becomes the document's
    A.updateDoc(d.id, kept.id, { amount: 160500, basis: 'manual' });
    expect(docMismatch(A.sales.docs[`${d.id}/${kept.id}`])).toBeNull();
    expect(acFig(A.sales, A.sales.deals[d.id])).toMatchObject({ kind: 'ok' });
    // the teammate's copy drops the decision too
    await settle(A, B);
    expect(B.sales.docs[`${d.id}/${kept.id}`]).toMatchObject({ amount: 160500, detected: 160500 });
    expect(B.sales.docs[`${d.id}/${kept.id}`].kept).toBeUndefined();
    A.dispose();
    B.dispose();
  });
});
