/**
 * The payment plan, attaching at a stage and closing, in the engine, run against the real team script
 * (team-sync/Code.gs in the simulator): what each action stores and queues, what a teammate's
 * browser sees, and how the plan's records line up with the stage notes and documents.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { attachPreview, closeReady, dealMoney, emptySales, payState, planLines, planOf, stageTrack, toDoc, toPay, type Deal, type DealDoc, type PlanInput } from './sales';
import type { SyncOp } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/p/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-06';

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 300);
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
const stored = (e: GccEngine) => (e as unknown as { pq: Promise<unknown> }).pq;
const queued = async (e: GccEngine) => {
  await stored(e);
  return (await e.store.get<SyncOp[]>('teamPending:' + URL)) || [];
};
function sheet(k: string): unknown {
  const r = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k === k);
  const l = r[r.length - 1];
  return !l ? undefined : l.del ? null : l.v;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const doc = (kind: DealDoc['kind'], amount: number | null, o: { stage?: string; replace?: string; docNo?: string; docDate?: string } = {}) => ({
  kind, amount, target: (kind === 'quotation' ? 'forecast' : amount == null || kind === 'other' ? 'none' : 'actual') as DealDoc['target'], basis: 'total' as const, detected: amount, docNo: o.docNo || '', docDate: o.docDate || '', ...o,
});
const line = (stage: string, amt: number | null, o: Partial<PlanInput> = {}): PlanInput => ({ stage, amt, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', ...o });
let n = 0;
/** A deal won on 1 Oct with this Forecast. */
function won(e: GccEngine, forecast: number | null) {
  const d = e.addDeal({ client: 'บริษัท ลูกค้าแผนชำระ ' + ++n + ' จำกัด', section: 'Partner', year: '2569' });
  if (forecast != null) e.updateDeal(d.id, { forecast });
  e.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
  return e.sales.deals[d.id];
}
const lastLog = (e: GccEngine, id: string) => Object.values(e.sales.log).filter((l) => l.deal === id).at(-1)!;
const lineOf = (e: GccEngine, d: Deal, stage: string) => planOf(e.sales, e.sales.deals[d.id], TODAY)!.lines.find((l) => l.stage === stage)!;
const pays = (e: GccEngine, d: Deal) => Object.fromEntries(Object.entries(e.sales.pays).filter(([k]) => k.startsWith(d.id + '/')));

describe('the payment plan in the engine', () => {
  it('set, edit and clear: a new line is written whole, an edit by its fields; a received line is never deleted', async () => {
    const [A, B] = await team();
    const d = won(A, 107000);
    expect(A.setPlan(d.id, [line('PAY1', 53500, { rel: 0, note: 'มัดจำเมื่อเซ็นสัญญา' }), line('PAY2', 53500, { due: '2026-10-20' })])).toEqual({ kept: [] });
    let q = await queued(A);
    const op1 = q.find((o) => o.k === `dpay/${d.id}/PAY1`)!;
    expect(op1.v).toMatchObject({ amt: 53500, rel: 0, note: 'มัดจำเมื่อเซ็นสัญญา', how: 'transfer', rcv: '', got: null, full: false, by: 'เอ' });
    expect(op1.f).toBeUndefined();
    expect(lastLog(A, d.id)).toMatchObject({ action: 'ตั้งแผนชำระ', detail: '2 งวด · 53,500 + 53,500' });
    await settle(A, B);
    expect(pays(B, d)).toEqual(pays(A, d));
    expect(planOf(B.sales, B.sales.deals[d.id], TODAY)).toMatchObject({ n: 2, total: 107000, diff: 0, next: { stage: 'PAY1', status: 'late', due: '2026-10-01' } });

    // an edit sends only what changed; an unchanged line is not sent again
    A.setPlan(d.id, [line('PAY1', 53500, { rel: 0, note: 'มัดจำเมื่อเซ็นสัญญา' }), line('PAY2', 53500, { due: '2026-10-20', note: 'เมื่อส่งรายงาน' })]);
    q = await queued(A);
    expect(q.find((o) => o.k === `dpay/${d.id}/PAY2`)!.f).toEqual(['note', 'at', 'by']);
    expect(q.some((o) => o.k === `dpay/${d.id}/PAY1`)).toBe(false);
    expect(lastLog(A, d.id).action).toBe('แก้แผนชำระ');
    A.updatePayLine(d.id, 'PAY2', { how: 'cheque', howT: 'ธ.กสิกรไทย' });
    expect(A.sales.pays[`${d.id}/PAY2`]).toMatchObject({ how: 'cheque', howT: 'ธ.กสิกรไทย', note: 'เมื่อส่งรายงาน' });
    expect((await queued(A)).find((o) => o.k === `dpay/${d.id}/PAY2`)!.f).toEqual(['note', 'at', 'by', 'how', 'howT']);

    // a received line stays when the plan no longer lists it, or is cleared
    A.markPaid(d.id, 'PAY1', { date: '2026-10-02', amount: null });
    expect(A.setPlan(d.id, [line('PAY2', 107000)])).toEqual({ kept: ['PAY1'] });
    expect(Object.keys(pays(A, d))).toEqual([`${d.id}/PAY1`, `${d.id}/PAY2`]);
    expect(A.clearPlan(d.id)).toEqual({ kept: ['PAY1'] });
    expect(Object.keys(pays(A, d))).toEqual([`${d.id}/PAY1`]);
    expect(lastLog(A, d.id)).toMatchObject({ action: 'ลบแผนชำระ', detail: 'เก็บงวดที่รับแล้ว PAY1' });
    await settle(A, B);
    expect(sheet(`dpay/${d.id}/PAY2`)).toBeNull();
    expect(pays(B, d)).toEqual(pays(A, d));

    // at most 12 installments; a "/" can't break the record key
    A.setPlan(d.id, Array.from({ length: 15 }, (_, i) => line('PAY' + (i + 1), 1)));
    expect(planLines(A.sales, d)!.length).toBe(12);
    A.setPlan(d.id, [line('PAY1', 1), line('งวด/พิเศษ', 1)]);
    expect(planLines(A.sales, d)!.map((x) => x.stage)).toEqual(['PAY1', 'งวด-พิเศษ']);
    A.dispose();
    B.dispose();
  });

  it('the quick plan splits what is left of the Forecast, due 30 days after the win and every 30 days after', async () => {
    const [A] = await team();
    const d = won(A, 85000);
    expect(A.quickPlan(d.id, 2)).toEqual({ stages: ['PAY1', 'PAY2'], amounts: [42500, 42500] });
    expect(planOf(A.sales, d, TODAY)!.lines.map((l) => [l.stage, l.amt, l.line.pct, l.due, l.line.how])).toEqual([
      ['PAY1', 42500, 50, '2026-10-31', 'transfer'],
      ['PAY2', 42500, 50, '2026-11-30', 'transfer'],
    ]);
    // the calendar's entries: what is due in October
    expect(A.payDue('2026-10-01', '2026-10-31').filter((x) => x.deal.id === d.id).map((x) => [x.line.stage, x.line.due, x.line.amt])).toEqual([['PAY1', '2026-10-31', 42500]]);
    // three replace the two; the third installment is an extra one (the list ends at PAY2)
    expect(A.quickPlan(d.id, 3)).toEqual({ stages: ['PAY1', 'PAY2', 'PAY3'], amounts: [28333, 28333, 28334] });
    expect(planOf(A.sales, d, TODAY)).toMatchObject({ n: 3, total: 85000, diff: 0 });
    expect(planLines(A.sales, d)!.map((x) => [x.stage, x.inList, x.line.rel])).toEqual([['PAY1', true, 30], ['PAY2', true, 60], ['PAY3', false, 90]]);
    // PAY1 already paid by its invoice before there was a plan: it stays as received, the rest is split
    const e = won(A, 107000);
    await A.attachDoc(e.id, pdf('inv.pdf'), doc('invoice', 50000, { stage: 'PAY1', docNo: 'INV-1' }));
    expect(A.quickPlan(e.id, 1)).toEqual({ stages: ['PAY2'], amounts: [57000] });
    expect(planOf(A.sales, e, TODAY)!.lines.map((l) => [l.stage, l.amt, l.status, l.line.pct])).toEqual([['PAY1', 50000, 'paid', null], ['PAY2', 57000, 'wait', null]]);
    // without a Forecast the lines have no amounts yet
    const f = won(A, null);
    expect(A.quickPlan(f.id, 2)!.amounts).toEqual([null, null]);
    A.dispose();
  });

  it('รับเงินแล้ว: an empty stage note is filled in; short by withholding tax, then counted complete, makes the deal ready; undo', async () => {
    const [A, B] = await team();
    const d = won(A, 107000);
    A.setPlan(d.id, [line('PAY1', 53500, { rel: 0 }), line('PAY2', 53500, { due: '2026-10-20' })]);
    expect(A.markPaid(d.id, 'PAY9', { date: TODAY, amount: 1 })).toBe(false); // no such installment
    expect(A.markPaid(d.id, 'PAY1', { date: '2026-10-03', amount: null, how: 'transfer' })).toBe(false); // PAY2 still to come
    expect(A.sales.steps[`${d.id}/PAY1`]).toEqual({ d: '2026-10-03', n: 'รับชำระแล้ว 53,500 บาท · โอน' });
    expect(dealMoney(A.sales, d)).toMatchObject({ actual: 53500, hand: 53500, acConfirmed: false });
    expect(lastLog(A, d.id)).toMatchObject({ action: 'รับชำระ PAY1', detail: '53,500 บาท · โอน' });
    expect(stageTrack(A.sales, d, TODAY).states).toMatchObject({ PAY1: 'done', PAY2: 'planned' });
    // the user's own note in the stage stays
    A.setStep(d.id, 'PAY2', { d: '2026-10-05', n: 'วางบิลแล้ว ลูกค้านัดโอน' });
    expect(A.markPaid(d.id, 'PAY2', { date: TODAY, amount: 52000 })).toBe(false);
    expect(A.sales.steps[`${d.id}/PAY2`].n).toBe('วางบิลแล้ว ลูกค้านัดโอน');
    expect(lineOf(A, d, 'PAY2')).toMatchObject({ status: 'part', got: 52000, left: 1500 });
    expect(A.setPayFull(d.id, 'PAY2', true)).toBe(true);
    expect(A.setPayFull(d.id, 'PAY2', true)).toBe(false); // nothing changed
    expect(lastLog(A, d.id).action).toBe('ถือว่ารับครบ PAY2');
    expect(closeReady(A.sales, d, TODAY)).toBe(true);
    await settle(A, B);
    expect(closeReady(B.sales, B.sales.deals[d.id], TODAY)).toBe(true);
    expect(B.sales.steps[`${d.id}/PAY1`].n).toBe('รับชำระแล้ว 53,500 บาท · โอน');
    // undo: the note it wrote goes, a note the user wrote stays
    A.unmarkPaid(d.id, 'PAY1');
    expect(A.sales.steps[`${d.id}/PAY1`]).toBeUndefined();
    A.unmarkPaid(d.id, 'PAY2');
    expect(A.sales.steps[`${d.id}/PAY2`].n).toBe('วางบิลแล้ว ลูกค้านัดโอน');
    expect(A.sales.pays[`${d.id}/PAY2`]).toMatchObject({ rcv: '', got: null, full: false });
    expect(lastLog(A, d.id).action).toBe('ยกเลิกการรับ PAY2');
    expect(closeReady(A.sales, d, TODAY)).toBe(false);
    // the last installment received in full: ready, says the return value
    A.markPaid(d.id, 'PAY1', { date: TODAY, amount: null });
    expect(A.markPaid(d.id, 'PAY2', { date: TODAY, amount: 53500 })).toBe(true);
    await settle(A, B);
    expect(closeReady(B.sales, B.sales.deals[d.id], TODAY)).toBe(true);
    A.dispose();
    B.dispose();
  });

  it('attaching at a stage: that stage, done on the document date; a user note stays; extra installments get no step', async () => {
    const [A, B] = await team();
    const d = won(A, 107000);
    const inv = await A.attachDoc(d.id, pdf('inv2.pdf'), doc('invoice', 53500, { stage: 'PAY2', docNo: 'INV-2', docDate: '2026-10-02' }));
    expect(inv.stage).toBe('PAY2');
    expect(A.sales.steps[`${d.id}/PAY2`]).toEqual({ d: '2026-10-02', n: 'ใบแจ้งหนี้ INV-2 · 53,500 บาท' });
    expect(A.sales.steps[`${d.id}/PAY1`]).toBeUndefined();
    // a planned-only PAY1: the receipt fills it in on its date (today at the latest)
    A.setStep(d.id, 'PAY1', { d: '2026-10-20', n: '' });
    await A.attachDoc(d.id, pdf('rc1.pdf'), doc('receipt', 53500, { stage: 'PAY1', docNo: 'RC-1', docDate: '2026-10-30' }));
    expect(A.sales.steps[`${d.id}/PAY1`]).toEqual({ d: TODAY, n: 'ใบเสร็จ / ใบกำกับภาษี RC-1 · 53,500 บาท' });
    expect(stageTrack(A.sales, d, TODAY).states.PAY1).toBe('done');
    expect(payState(A.sales, d, TODAY).left).toEqual([]);
    expect(closeReady(A.sales, d, TODAY)).toBe(true);

    // a note the user wrote, with a planned date: the note stays, the date becomes the document's; deleting the document keeps both
    const e = won(A, 107000);
    A.setStep(e.id, 'PAY2', { d: '2026-10-25', n: 'วางบิลแล้ว' });
    const rc = await A.attachDoc(e.id, pdf('rc2.pdf'), doc('receipt', 53500, { stage: 'PAY2', docDate: '2026-10-03' }));
    expect(A.sales.steps[`${e.id}/PAY2`]).toEqual({ d: '2026-10-03', n: 'วางบิลแล้ว' });
    expect(rc.auto).toBeUndefined();
    A.deleteDoc(e.id, rc.id);
    expect(A.sales.steps[`${e.id}/PAY2`]).toEqual({ d: '2026-10-03', n: 'วางบิลแล้ว' });

    // without a stage: the first installment of the plan not received — here the extra PAY3, which gets no step
    const f = won(A, 90000);
    A.quickPlan(f.id, 3);
    await A.attachDoc(f.id, pdf('a.pdf'), doc('receipt', 30000, { stage: 'PAY1' }));
    await A.attachDoc(f.id, pdf('b.pdf'), doc('receipt', 30000, { stage: 'PAY2' }));
    const c = await A.attachDoc(f.id, pdf('c.pdf'), doc('receipt', 30000));
    expect(c.stage).toBe('PAY3');
    expect(A.sales.steps[`${f.id}/PAY3`]).toBeUndefined();
    expect((await queued(A)).some((o) => o.k === `dstep/${f.id}/PAY3`)).toBe(false);
    expect(lineOf(A, f, 'PAY3')).toMatchObject({ status: 'paid', got: 30000, rcvDate: TODAY });
    expect(closeReady(A.sales, f, TODAY)).toBe(true);
    // a stage that is neither in the list nor in the plan: none
    expect((await A.attachDoc(f.id, pdf('x.pdf'), doc('other', null, { stage: 'PAYX' }))).stage).toBe('');
    // a document that does not count, filed at a PAY stage, does not complete it
    const h = won(A, 1000);
    expect((await A.attachDoc(h.id, pdf('contract.pdf'), doc('other', null, { stage: 'PAY1' }))).stage).toBe('PAY1');
    expect(A.sales.steps[`${h.id}/PAY1`]).toBeUndefined();
    expect(payState(A.sales, h, TODAY).paid).toEqual([]);
    expect(attachPreview(A.sales, h, { kind: 'other', amount: null, target: 'none', docDate: '', stage: 'PAY2' }, TODAY).ready).toBe(false);
        // no plan, PAY1 only planned: the generic attach goes to PAY1 (it used to pick PAY2)
    const g = won(A, 1000);
    A.setStep(g.id, 'PAY1', { d: '2026-10-30', n: '' });
    expect((await A.attachDoc(g.id, pdf('g.pdf'), doc('invoice', 1000))).stage).toBe('PAY1');
    await settle(A, B);
    expect(B.sales.docs[`${f.id}/${c.id}`].stage).toBe('PAY3');
    expect(closeReady(B.sales, B.sales.deals[f.id], TODAY)).toBe(true);
    A.dispose();
    B.dispose();
  });

  it('stages that are not configured get no step: a quotation without QUOTATION, an invoice without PAY stages', async () => {
    const C = mk('ซี'); // this browser only
    C.setSalesList('stages', ['CALL1', 'CLOSED DEAL']);
    const d = C.addDeal({ client: 'บริษัท ไม่มีขั้นชำระ จำกัด' });
    C.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    expect((await C.attachDoc(d.id, pdf('q.pdf'), doc('quotation', 1000))).stage).toBe('');
    expect((await C.attachDoc(d.id, pdf('i.pdf'), doc('invoice', 1000))).stage).toBe('');
    expect(Object.keys(C.sales.steps).filter((k) => k.startsWith(d.id + '/'))).toEqual([`${d.id}/CLOSED DEAL`]);
    expect(closeReady(C.sales, C.sales.deals[d.id], TODAY)).toBe(true); // no PAY stage: won is enough
    C.dispose();
  });

  it('replacing the counted document of an installment never counts it twice; "นับเพิ่ม" adds up', async () => {
    const [A, B] = await team();
    const d = won(A, 107000);
    const inv = await A.attachDoc(d.id, pdf('inv.pdf'), doc('invoice', 53500, { stage: 'PAY1', docNo: 'INV-118' }));
    vi.setSystemTime(Date.now() + 1000);
    const rc = await A.attachDoc(d.id, pdf('rc.pdf'), doc('receipt', 53500, { stage: 'PAY1', docNo: 'RC-118', replace: inv.id }));
    expect(dealMoney(A.sales, d).actual).toBe(53500);
    expect(A.sales.docs[`${d.id}/${inv.id}`]).toMatchObject({ target: 'none' });
    expect(A.sales.docs[`${d.id}/${inv.id}`].auto).toBeUndefined();
    expect(A.sales.docs[`${d.id}/${rc.id}`].auto).toMatchObject({ stage: 'PAY1', n: 'ใบเสร็จ / ใบกำกับภาษี RC-118 · 53,500 บาท' });
    expect(A.sales.steps[`${d.id}/PAY1`].n).toBe('ใบเสร็จ / ใบกำกับภาษี RC-118 · 53,500 บาท');
    await settle(A, B);
    expect(dealMoney(B.sales, B.sales.deals[d.id]).actual).toBe(53500);
    expect(B.sales.docs[`${d.id}/${inv.id}`].target).toBe('none');
    // another payment for the same installment, counted alongside
    vi.setSystemTime(Date.now() + 1000);
    await A.attachDoc(d.id, pdf('rc2.pdf'), doc('receipt', 20000, { stage: 'PAY1', docNo: 'RC-119' }));
    expect(dealMoney(A.sales, d).actual).toBe(73500);
    // deleting the replacing receipt does not count the old invoice again; the note passes to what is left
    A.deleteDoc(d.id, rc.id);
    expect(dealMoney(A.sales, d).actual).toBe(20000);
    expect(A.sales.docs[`${d.id}/${inv.id}`].target).toBe('none');
    expect(A.sales.steps[`${d.id}/PAY1`].n).toBe('ใบเสร็จ / ใบกำกับภาษี RC-119 · 20,000 บาท');
    A.dispose();
    B.dispose();
  });

  it('a document settles its installment: in full, short (then counted complete), and over a hand receipt', async () => {
    const [A] = await team();
    const d = won(A, 107000);
    A.setPlan(d.id, [line('PAY1', 53500), line('PAY2', 53500)]);
    await A.attachDoc(d.id, pdf('r1.pdf'), doc('receipt', 53500, { stage: 'PAY1', docNo: 'RC-1', docDate: '2026-10-04' }));
    expect(lineOf(A, d, 'PAY1')).toMatchObject({ status: 'paid', got: 53500, rcvDate: '2026-10-04', doc: { docNo: 'RC-1' } });
    const info = doc('receipt', 52000, { stage: 'PAY2', docNo: 'RC-2' });
    expect(attachPreview(A.sales, d, info, TODAY)).toMatchObject({ stage: 'PAY2', short: 1500, wht: 3, ready: false, readyIfFull: true });
    await A.attachDoc(d.id, pdf('r2.pdf'), info);
    expect(lineOf(A, d, 'PAY2')).toMatchObject({ status: 'part', left: 1500 });
    expect(closeReady(A.sales, d, TODAY)).toBe(false);
    expect(A.setPayFull(d.id, 'PAY2', true)).toBe(true);
    // a hand receipt, then the receipt document: the document's amount, counted once
    const e = won(A, 50000);
    A.setPlan(e.id, [line('PAY1', 50000)]);
    A.markPaid(e.id, 'PAY1', { date: '2026-10-02', amount: 48500 });
    expect(dealMoney(A.sales, e).actual).toBe(48500);
    await A.attachDoc(e.id, pdf('r.pdf'), doc('receipt', 50000, { stage: 'PAY1' }));
    expect(dealMoney(A.sales, e)).toMatchObject({ actual: 50000, hand: 0, acConfirmed: true });
    expect(lineOf(A, e, 'PAY1')).toMatchObject({ status: 'paid', got: 50000, hand: false });
    A.dispose();
  });

  it('a deal deleted by a teammate takes its plan along, also a change queued for it by a stale browser', async () => {
    const [A, B] = await team();
    const d = won(A, 1000);
    A.setPlan(d.id, [line('PAY1', 1000)]);
    await settle(A, B);
    A.deleteDeal(d.id);
    expect(A.sales.pays[`${d.id}/PAY1`]).toBeUndefined();
    expect((await queued(A)).find((o) => o.k === `dpay/${d.id}/PAY1`)).toMatchObject({ k: `dpay/${d.id}/PAY1` });
    await A.teamSync();
    B.updatePayLine(d.id, 'PAY1', { note: 'แก้จากเครื่องที่ยังไม่รู้' }); // B has not pulled the deletion
    B.markPaid(d.id, 'PAY1', { date: TODAY, amount: null });
    await settle(B, A);
    for (const e of [A, B]) {
      expect(e.sales.deals[d.id]).toBeUndefined();
      expect(pays(e, d)).toEqual({});
      expect(e.sales.steps[`${d.id}/PAY1`]).toBeUndefined();
    }
    expect(sheet(`dpay/${d.id}/PAY1`)).toBeNull();
    expect(sheet(`dstep/${d.id}/PAY1`) ?? null).toBeNull();
    A.dispose();
    B.dispose();
  });

  it('record shapes: steps stay {d, n}, documents keep their fields, installments are toPay records; the CSV and a backup carry the plan', async () => {
    const [A] = await team();
    const d = won(A, 107000);
    A.setPlan(d.id, [line('PAY1', 53500, { rel: 0 }), line('PAY2', 53500)]);
    A.markPaid(d.id, 'PAY1', { date: '2026-10-02', amount: null });
    const inv = await A.attachDoc(d.id, pdf('i.pdf'), doc('invoice', 53500, { stage: 'PAY2', docNo: 'INV-9' }));
    await A.attachDoc(d.id, pdf('r.pdf'), doc('receipt', 53500, { stage: 'PAY2', replace: inv.id }));
    const q = await queued(A);
    const keys = (v: unknown) => Object.keys(v as object).sort();
    for (const o of q) {
      expect(['deal', 'dstep', 'ddoc', 'dpay', 'dlog']).toContain(o.k.split('/')[0]);
      if (o.k.startsWith('dstep/')) expect(keys(o.v)).toEqual(['d', 'n']);
      if (o.k.startsWith('ddoc/')) expect(keys(o.v)).toEqual(keys(toDoc(o.v, d.id, o.k.split('/')[2])));
      if (o.k.startsWith('dpay/')) expect(o.v).toEqual(toPay(o.v));
    }
    // the CSV's last column
    const csv = A.salesCsv([A.sales.deals[d.id]]).split('\r\n');
    expect(csv[0].endsWith('"แผนชำระ"')).toBe(true);
    expect(csv[1].endsWith('"PAY1 53,500 (01/10/2026 โอน) รับแล้ว; PAY2 53,500 (โอน) รับแล้ว"')).toBe(true);
    // a backup adds plan lines this browser doesn't have, never overwrites one, skips a broken one
    const C = mk('ซี');
    C.sales.pays['zz/PAY1'] = { ...toPay({ amt: 1 })! };
    const backup = { kind: 'gcc-crm-backup', v: 1, crm: {}, contacts: {}, dedup: {}, custom: {}, sales: { ...emptySales(), pays: { 'zz/PAY1': { amt: 999 }, 'zz/PAY2': { amt: 2, how: 'cash' }, 'zz/PAY3': 'junk', bad: { amt: 3 } } } };
    await C.importCrm(Object.assign(new Blob([JSON.stringify(backup)]), { name: 'b.json' }) as File);
    expect(Object.keys(C.sales.pays).sort()).toEqual(['zz/PAY1', 'zz/PAY2']);
    expect(C.sales.pays['zz/PAY1'].amt).toBe(1);
    expect(C.sales.pays['zz/PAY2']).toMatchObject({ amt: 2, how: 'cash' });
    A.dispose();
    C.dispose();
  });
});
