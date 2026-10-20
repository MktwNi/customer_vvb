/**
 * Actual counted once (the owner's "Actual 121,730.77 although the job brought in 60,000"): the sample
 * receipt (__fixtures__/INV2026090004.txt: total 61,730.77, หัก ณ ที่จ่าย 1,730.77, ยอดชำระ 60,000) attached
 * the way the attach dialog does it — the figure it proposes (lib/docExtract proposedAmount), the question
 * it asks and the choice it suggests (lib/sales countGuard / countAs) — through the engine. Every
 * sequence that used to count the one payment twice now counts 60,000; nothing recorded is deleted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeDocText, proposedAmount, type DocFacts } from './docExtract';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import {
  attachPreview, attachStage, closeReady, countAs, countGuard, dealMoney, docsOf, planOf, stepOf, targetForStage,
  type AttachInfo, type CountMode, type Deal, type DealDoc,
} from './sales';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-20';
let base: Dataset, R: RoundRaw[], fx: DocFacts;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 50);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
  fx = analyzeDocText(readFileSync(join(__dirname, '__fixtures__', 'INV2026090004.txt'), 'utf8'));
});
afterAll(() => vi.useRealTimers());

function mk() {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = TODAY;
  e.store = memoryStore();
  (e as unknown as { me: () => string }).me = () => 'หมิว';
  e.rebuild();
  e.loading = false;
  return e;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
let n = 0;
/** A job won on 25 Aug whose Forecast is a quotation of 60,000 (as on the owner's row). */
async function wonDeal(e: GccEngine) {
  const d = e.addDeal({ client: 'บริษัท ลูกค้าตัวอย่าง ' + ++n + ' จำกัด', section: 'Partner', resp: 'หมิว', year: '2569' } as Partial<Deal>);
  await e.attachDoc(d.id, pdf('QT.pdf'), { kind: 'quotation', amount: 60000, target: 'forecast', basis: 'netPay', detected: 60000, docNo: 'QT2026080001', docDate: '2026-08-20', stage: 'QUOTATION' });
  e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
  return d.id;
}
const deal = (e: GccEngine, id: string) => e.sales.deals[id];
const actual = (e: GccEngine, id: string) => dealMoney(e.sales, deal(e, id)).actual;
const receipts = (e: GccEngine, id: string) => docsOf(e.sales, id).filter((x) => x.kind !== 'quotation').map((x: DealDoc) => `${x.stage}:${x.target}:${x.amount}`);

/**
 * The attach dialog on the sample receipt opened at `stage` (the Actual figure's "แนบเอกสาร" opens it at
 * attachStage): the proposed figure (or `amount`), the suggested choice (or `mode`). Checks that the dialog's
 * "หลังแนบ" preview says what the engine then does.
 */
async function attach(e: GccEngine, id: string, o: { stage?: string; add?: boolean; mode?: CountMode; amount?: number; basis?: DealDoc['basis']; name?: string; docNo?: string; docDate?: string } = {}) {
  const S = e.sales, d = deal(e, id), kind = fx.kind!;
  const stage = o.stage ?? attachStage(S, d, { kind, target: 'actual' }, TODAY);
  const p = proposedAmount(fx), amount = o.amount ?? p.value!;
  const file = pdf(o.name ?? 'INV2026090004.pdf'), docNo = o.docNo ?? fx.docNo, docDate = o.docDate ?? fx.docDate;
  const info: AttachInfo = { kind, amount, target: targetForStage(S.cfg, stage, kind), docDate, stage };
  const g = countGuard(S, d, { ...info, add: o.add, docNo, name: file.name, size: file.size, figures: [fx.total, fx.netPay, fx.subtotal] }, TODAY);
  const mode = o.mode ?? g.pick;
  const how = countAs(g, mode, info);
  const pv = attachPreview(S, d, how, TODAY);
  const was = closeReady(S, d, TODAY);
  const before = Object.keys(S.docs).length;
  await e.attachDoc(id, file, { kind, amount, target: how.target, basis: o.basis ?? p.basis, detected: amount, docNo, docDate, stage: how.stage, replace: how.replace, addHand: how.addHand });
  // nothing recorded goes away: the document replaced stays, as evidence
  expect(Object.keys(e.sales.docs).length).toBe(before + 1);
  if (how.target !== 'none') {
    expect(actual(e, id)).toBe(pv.actual);
    expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(pv.ready || was);
  }
  return { g, mode };
}

describe('the figure proposed for the sample receipt', () => {
  it('is the 60,000 paid after withholding tax, not the 61,730.77 total', () => {
    expect(fx).toMatchObject({ kind: 'receipt', total: 61730.77, wht: 1730.77, netPay: 60000, copies: 2 });
    expect(proposedAmount(fx)).toEqual({ basis: 'netPay', value: 60000 });
  });
});

describe('the same receipt attached twice', () => {
  it('no plan: PAY1, then the same file at PAY2 ("รอชำระงวด 2") — "ไม่นับยอดซ้ำ" is suggested and Actual stays 60,000', async () => {
    const e = mk(), id = await wonDeal(e);
    const a = await attach(e, id, { stage: 'PAY1' });
    expect(a.g.modes).toEqual([]);
    expect(actual(e, id)).toBe(60000);
    expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(false); // no plan: PAY2 too
    const b = await attach(e, id, { stage: 'PAY2' });
    expect(b.g).toMatchObject({ stage: 'PAY2', sameBy: 'no', same: { stage: 'PAY1', amount: 60000 }, modes: ['none', 'replace', 'add'], pick: 'none' });
    expect(actual(e, id)).toBe(60000);
    // attached as evidence; the payment stays counted where it was
    expect(receipts(e, id)).toEqual(['PAY1:actual:60000', 'PAY2:none:60000']);
    expect(stepOf(e.sales, id, 'PAY1').n).not.toBe('');
  });

  it('"ใช้ยอดนี้แทน" at another installment moves the count there: the earlier one stays as evidence and its installment is open again', async () => {
    const e = mk(), id = await wonDeal(e);
    await attach(e, id, { stage: 'PAY1' });
    await attach(e, id, { stage: 'PAY2', mode: 'replace' });
    expect(actual(e, id)).toBe(60000);
    expect(receipts(e, id)).toEqual(['PAY1:none:60000', 'PAY2:actual:60000']);
    // PAY1 no longer holds a payment: its note goes with it, as when a document there stops counting
    // (the dialog's preview says the same: checked in attach())
    expect(stepOf(e.sales, id, 'PAY1')).toEqual({ d: '', n: '' });
  });

  it('a deal already counted the old way (61,730.77 at PAY1): the receipt attached again at PAY1 replaces it with 60,000', async () => {
    const e = mk(), id = await wonDeal(e);
    await attach(e, id, { stage: 'PAY1', amount: 61730.77, basis: 'total' });
    expect(actual(e, id)).toBe(61730.77);
    const b = await attach(e, id, { stage: 'PAY1' });
    expect(b.g).toMatchObject({ same: { stage: 'PAY1', amount: 61730.77 }, modes: ['replace', 'none', 'add'], pick: 'replace' });
    expect(actual(e, id)).toBe(60000);
    expect(receipts(e, id)).toEqual(['PAY1:none:61730.77', 'PAY1:actual:60000']);
    expect(stepOf(e.sales, id, 'PAY1').n).toContain('60,000');
  });

  it('at the same installment: the same document is replaced, also from "แนบใบเสร็จเพิ่ม"', async () => {
    const e = mk(), id = await wonDeal(e);
    e.quickPlan(id, 1);
    await attach(e, id, { stage: 'PAY1', amount: 61730.77, basis: 'total' });
    const b = await attach(e, id, { stage: 'PAY1', add: true });
    expect(b.g).toMatchObject({ same: { stage: 'PAY1' }, old: null, pick: 'replace' });
    expect(actual(e, id)).toBe(60000);
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines[0]).toMatchObject({ status: 'paid', got: 60000 });
  });

  it('the same file without a document number is found by its name and size', async () => {
    const e = mk(), id = await wonDeal(e);
    await attach(e, id, { stage: 'PAY1', docNo: '' });
    const b = await attach(e, id, { stage: 'PAY2', docNo: '' });
    expect(b.g).toMatchObject({ sameBy: 'file', same: { stage: 'PAY1' }, pick: 'none' });
    expect(actual(e, id)).toBe(60000);
  });

  it('counted on top anyway ("นับเพิ่ม", the user\'s choice): it adds up to the satang, and says it goes past the Forecast', async () => {
    const e = mk(), id = await wonDeal(e);
    await attach(e, id, { stage: 'PAY1', amount: 61730.77, basis: 'total' });
    const b = await attach(e, id, { stage: 'PAY2', mode: 'add' });
    expect(b.g.overAdd).toMatchObject({ before: 61730.77, after: 121730.77, cap: 60000, what: 'Forecast' });
    expect(actual(e, id)).toBe(121730.77); // not 121730.76999999999
  });
});

describe('a receipt for money recorded by hand ("รับเงินแล้ว")', () => {
  it('plan of 2: PAY1 received 60,000 by hand, the receipt from the Actual figure (→ PAY2) goes to PAY1 in its place', async () => {
    const e = mk(), id = await wonDeal(e);
    e.quickPlan(id, 2);
    e.markPaid(id, 'PAY1', { date: '2026-09-28', amount: 60000, how: 'transfer' });
    expect(actual(e, id)).toBe(60000);
    const b = await attach(e, id);
    expect(b.g).toMatchObject({ stage: 'PAY2', over: { before: 60000, after: 120000, cap: 60000, what: 'แผน' }, hand: { stage: 'PAY1' }, modes: ['move', 'none', 'add'], pick: 'move' });
    expect(actual(e, id)).toBe(60000);
    expect(receipts(e, id)).toEqual(['PAY1:actual:60000']);
    // the hand entry is kept (the document counts in its place)
    expect(e.sales.pays[`${id}/PAY1`]).toMatchObject({ rcv: '2026-09-28', got: 60000 });
  });

  it('PAY1 planned at 61,730.77, 60,000 received by hand (short), "แนบใบเสร็จเพิ่ม": the receipt is for that money', async () => {
    const e = mk(), id = await wonDeal(e);
    e.setPlan(id, [{ stage: 'PAY1', amt: 61730.77, pct: null, due: '', rel: 30, how: 'transfer', howT: '', note: '' }]);
    e.markPaid(id, 'PAY1', { date: '2026-09-28', amount: 60000, how: 'transfer', full: false });
    const b = await attach(e, id, { stage: 'PAY1', add: true });
    expect(b.g).toMatchObject({ handPart: { stage: 'PAY1' }, modes: ['replace', 'none', 'add'], pick: 'replace' });
    expect(actual(e, id)).toBe(60000);
  });

  it('dated within a week of a hand receipt of the same amount at another installment: suggested as its receipt', async () => {
    const e = mk(), id = await wonDeal(e);
    e.quickPlan(id, 2); // 30,000 + 30,000
    e.markPaid(id, 'PAY1', { date: '2026-09-28', amount: 30000, how: 'transfer' });
    const b = await attach(e, id, { amount: 30000, basis: 'manual', docDate: '2026-09-29' });
    expect(b.g).toMatchObject({ stage: 'PAY2', over: null, hand: { stage: 'PAY1' }, modes: ['move', 'add'], pick: 'move' });
    expect(actual(e, id)).toBe(30000);
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => [l.stage, l.got, l.status === 'paid'])).toEqual([['PAY1', 30000, true], ['PAY2', 0, false]]);
  });
});

describe('real second payments are not questioned', () => {
  it('two installments, two receipts', async () => {
    const e = mk(), id = await wonDeal(e);
    e.quickPlan(id, 2);
    const a = await attach(e, id, { stage: 'PAY1', amount: 30000, basis: 'manual', name: 'RC-1.pdf', docNo: 'RC-1', docDate: '2026-09-01' });
    const b = await attach(e, id, { stage: 'PAY2', amount: 30000, basis: 'manual', name: 'RC-2.pdf', docNo: 'RC-2', docDate: '2026-10-15' });
    expect([a.g.modes, b.g.modes]).toEqual([[], []]);
    expect(actual(e, id)).toBe(60000);
    expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(true);
  });

  it('a hand receipt weeks before the second installment\'s receipt', async () => {
    const e = mk(), id = await wonDeal(e);
    e.quickPlan(id, 2);
    e.markPaid(id, 'PAY1', { date: '2026-09-01', amount: 30000, how: 'transfer' });
    const b = await attach(e, id, { amount: 30000, basis: 'manual', name: 'RC-2.pdf', docNo: 'RC-2', docDate: '2026-10-15' });
    expect(b.g).toMatchObject({ stage: 'PAY2', modes: [], pick: 'add' });
    expect(actual(e, id)).toBe(60000);
  });
});
