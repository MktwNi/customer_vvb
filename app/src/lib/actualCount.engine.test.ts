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
  attachPreview, attachStage, closeReady, countAs, countGuard, dealMoney, docsOf, dupCounted, planOf, stageTrack, stepOf, targetForStage, withDoc,
  type AttachInfo, type CountMode, type Deal, type DealDoc,
} from './sales';
import { acFig } from './salesUi';
import { attachPlan, panelEntry, type AttachEntry } from './attachPlan';
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
 * The attach dialog on a document (the sample receipt unless `fx` is given) opened at `stage` — at an
 * installment the user chose (`pinned`), else the Actual figure's "แนบเอกสาร", which opens it at attachStage
 * — the proposed figure (or `amount`), the suggested choice (or `mode`). Checks that the dialog's "หลังแนบ"
 * preview says what the engine then does.
 */
async function attach(e: GccEngine, id: string, o: { fx?: DocFacts; stage?: string; pinned?: boolean; add?: boolean; mode?: CountMode; amount?: number; basis?: DealDoc['basis']; name?: string; docNo?: string; docDate?: string } = {}) {
  const S = e.sales, d = deal(e, id), f = o.fx ?? fx, kind = f.kind!;
  const stage = o.stage ?? attachStage(S, d, { kind, target: 'actual' }, TODAY);
  const p = proposedAmount(f), amount = o.amount ?? p.value!;
  const file = pdf(o.name ?? (f.docNo || 'INV2026090004') + '.pdf'), docNo = o.docNo ?? f.docNo, docDate = o.docDate ?? f.docDate;
  // (what the document is goes with it: the preview sees a double count as saving it does — closeReady)
  const info: AttachInfo = { kind, amount, target: targetForStage(S.cfg, stage, kind), docDate, stage, docNo, name: file.name, size: file.size };
  const g = countGuard(S, d, { ...info, add: o.add, pinned: o.pinned, docNo, name: file.name, size: file.size, figures: [f.total, f.netPay, f.subtotal], refs: f.refs }, TODAY);
  const mode = o.mode ?? g.pick;
  const how = countAs(g, mode, info);
  const pv = attachPreview(S, d, how, TODAY), ready = closeReady(withDoc(S, d, how, TODAY), d, TODAY);
  const before = Object.keys(S.docs).length;
  await e.attachDoc(id, file, { kind, amount: how.amount, target: how.target, basis: o.basis ?? p.basis, detected: amount, docNo, docDate, stage: how.stage, replace: how.replace, drop: how.drop, addHand: how.addHand });
  // nothing recorded goes away: the document replaced stays, as evidence
  expect(Object.keys(e.sales.docs).length).toBe(before + 1);
  if (how.target !== 'none') {
    expect(actual(e, id)).toBe(pv.actual);
    expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(ready);
  }
  return { g, mode, pv };
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
    // no plan: one PAY step (lib/steps), paid in full against the Forecast of 60,000 — nothing else to receive
    expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(true);
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
    // PAY2 is planned at another amount, so a 30,000 receipt is PAY1's
    e.setPlan(id, [
      { stage: 'PAY1', amt: 30000, pct: null, due: '', rel: 0, how: 'transfer', howT: '', note: '' },
      { stage: 'PAY2', amt: 70000, pct: null, due: '', rel: 60, how: 'transfer', howT: '', note: '' },
    ]);
    e.markPaid(id, 'PAY1', { date: '2026-09-28', amount: 30000, how: 'transfer' });
    const b = await attach(e, id, { amount: 30000, basis: 'manual', docDate: '2026-09-29' });
    expect(b.g).toMatchObject({ stage: 'PAY2', over: null, hand: { stage: 'PAY1' }, modes: ['move', 'add'], pick: 'move' });
    expect(actual(e, id)).toBe(30000);
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => [l.stage, l.got, l.status === 'paid'])).toEqual([['PAY1', 30000, true], ['PAY2', 0, false]]);
  });

  it('equal installments paid close together: from the Actual figure it is suggested as the hand money\'s receipt; from PAY2\'s own row it counts there (asked both ways)', async () => {
    // (the Actual figure picks the first installment not received: after "รับเงินแล้ว" at PAY1 that is PAY2,
    // while the receipt is most often PAY1's own — equal installments are the plan's default, 50/50)
    for (const pinned of [false, true]) {
      const e = mk(), id = await wonDeal(e);
      e.quickPlan(id, 2); // 30,000 + 30,000
      e.markPaid(id, 'PAY1', { date: '2026-10-01', amount: 30000, how: 'transfer' });
      const b = await attach(e, id, { stage: pinned ? 'PAY2' : undefined, pinned, amount: 30000, basis: 'manual', name: 'RC-0002.pdf', docNo: 'RC-0002', docDate: '2026-10-05' });
      expect(b.g).toMatchObject({ stage: 'PAY2', hand: { stage: 'PAY1' }, modes: pinned ? ['add', 'move'] : ['move', 'add'], pick: pinned ? 'add' : 'move' });
      expect(actual(e, id)).toBe(pinned ? 60000 : 30000);
      expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => l.status === 'paid')).toEqual([true, pinned]);
    }
  });

  it('a hand receipt weeks before the next installment\'s receipt: counted at that installment, and asked (the hand money has no receipt yet)', async () => {
    const e = mk(), id = await wonDeal(e);
    e.quickPlan(id, 2);
    e.markPaid(id, 'PAY1', { date: '2026-09-01', amount: 30000, how: 'transfer' });
    const b = await attach(e, id, { amount: 30000, basis: 'manual', name: 'RC-2.pdf', docNo: 'RC-2', docDate: '2026-10-15' });
    expect(b.g).toMatchObject({ stage: 'PAY2', hand: { stage: 'PAY1' }, modes: ['add', 'move'], pick: 'add' });
    expect(actual(e, id)).toBe(60000);
  });

  it('opened at an installment the user chose: not moved by default', async () => {
    const e = mk(), id = await wonDeal(e);
    e.setPlan(id, [
      { stage: 'PAY1', amt: 30000, pct: null, due: '', rel: 0, how: 'transfer', howT: '', note: '' },
      { stage: 'PAY2', amt: 70000, pct: null, due: '', rel: 60, how: 'transfer', howT: '', note: '' },
    ]);
    e.markPaid(id, 'PAY1', { date: '2026-09-28', amount: 30000, how: 'transfer' });
    const b = await attach(e, id, { stage: 'PAY2', pinned: true, amount: 30000, basis: 'manual', docDate: '2026-09-29' });
    expect(b.g).toMatchObject({ hand: { stage: 'PAY1' }, modes: ['add', 'move'], pick: 'add' });
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

});

describe('a deal that already counts the receipt twice (the owner\'s: 61,730.77 at PAY1 and 60,000 at PAY2)', () => {
  /** The old app's sequence: no plan, the total at PAY1, the amount payable chosen at PAY2, no question then. */
  async function counted(e: GccEngine) {
    const id = await wonDeal(e);
    await e.attachDoc(id, pdf('INV2026090004.pdf'), { kind: 'receipt', amount: 61730.77, target: 'actual', basis: 'total', detected: 61730.77, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY1' });
    await e.attachDoc(id, pdf('INV2026090004.pdf'), { kind: 'receipt', amount: 60000, target: 'actual', basis: 'netPay', detected: 60000, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY2' });
    return id;
  }

  it('the panel and the tracker row say so', async () => {
    const e = mk(), id = await counted(e);
    expect(actual(e, id)).toBe(121730.77);
    expect(dupCounted(e.sales, deal(e, id)).map((gr) => gr.map((x) => `${x.stage}:${x.amount}`))).toEqual([['PAY1:61730.77', 'PAY2:60000']]);
    const v = acFig(e.sales, deal(e, id));
    expect(v).toMatchObject({ kind: 'warn', word: 'นับซ้ำ' });
    // (named as the steps name them: no plan, PAY1 is the single PAY step and PAY2 the rest of the payment)
    expect(v.title).toContain('INV2026090004 นับยอดซ้ำ 2 ครั้ง (PAY 61,730.77 · PAY ส่วนที่เหลือ 60,000 บาท)');
  });

  for (const stage of ['PAY1', 'PAY2']) {
    it(`attached once more at ${stage}: "ใช้ยอดนี้แทน" is suggested and counts it once, 60,000`, async () => {
      const e = mk(), id = await counted(e);
      const b = await attach(e, id, { stage, pinned: true });
      expect(b.g.sames.map((x) => x.stage)).toEqual(['PAY1', 'PAY2']);
      // no plan: counted once at the single PAY step wherever it is attached again; the second PAY step (the rest
      // of the payment, lib/steps) goes with the money it no longer lacks — nothing turns unpaid, the job is ready
      expect(b.pv.unpaid).toEqual([]);
      expect(b.g).toMatchObject({ same: { stage }, home: 'PAY1', modes: ['replace', 'none', 'add'], pick: 'replace' });
      expect(actual(e, id)).toBe(60000);
      expect(receipts(e, id).filter((x) => x.includes(':actual:'))).toEqual(['PAY1:actual:60000']);
      expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(true);
      expect(dupCounted(e.sales, deal(e, id))).toEqual([]);
      expect(acFig(e.sales, deal(e, id))).toMatchObject({ kind: 'ok', word: 'จากเอกสาร' });
    });
  }

  it('setting the extra one to "ไม่นับยอด" (the fix for the deal today) clears it too', async () => {
    const e = mk(), id = await counted(e);
    const [p1, p2] = docsOf(e.sales, id).filter((x) => x.kind === 'receipt');
    e.updateDoc(id, p1.id, { amount: 60000 });
    e.updateDoc(id, p2.id, { target: 'none' });
    expect(actual(e, id)).toBe(60000);
    expect(dupCounted(e.sales, deal(e, id))).toEqual([]);
  });
});

describe('a receipt for an invoice already counted', () => {
  const INV = analyzeDocText(['ใบแจ้งหนี้', 'เลขที่ INV2026-0601', 'วันที่ 01/10/2026', 'ค่าบริการ งวดที่ 1 จาก 2 งวด', 'รวมเป็นเงิน   50,000.00', 'ภาษีมูลค่าเพิ่ม 7%   3,500.00', 'จำนวนเงินรวมทั้งสิ้น   53,500.00'].join('\n'));
  const RCT = analyzeDocText(['ใบเสร็จรับเงิน', 'เลขที่ RC2026-0701', 'วันที่ 10/10/2026', 'ชำระตามใบแจ้งหนี้เลขที่ INV2026-0601   จำนวนเงิน   53,500.00', 'รวมทั้งสิ้น   53,500.00', '(ห้าหมื่นสามพันห้าร้อยบาทถ้วน)'].join('\n'));
  const RCT0 = analyzeDocText(['ใบเสร็จรับเงิน', 'เลขที่ RC2026-0701', 'วันที่ 10/10/2026', 'รวมทั้งสิ้น   53,500.00', '(ห้าหมื่นสามพันห้าร้อยบาทถ้วน)'].join('\n'));
  async function invoiced(e: GccEngine) {
    const d = e.addDeal({ client: 'บริษัท ใบแจ้งหนี้ ' + ++n + ' จำกัด', resp: 'หมิว', year: '2569' } as Partial<Deal>);
    await e.attachDoc(d.id, pdf('QT.pdf'), { kind: 'quotation', amount: 107000, target: 'forecast', basis: 'total', detected: 107000, docNo: 'QT-1', docDate: '2026-08-20', stage: 'QUOTATION' });
    e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    e.quickPlan(d.id, 2); // 53,500 + 53,500
    await attach(e, d.id, { fx: INV });
    expect(receipts(e, d.id)).toEqual(['PAY1:actual:53500']);
    return d.id;
  }
  const lines = (e: GccEngine, id: string) => planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => `${l.stage}:${l.got}:${l.status === 'paid' ? 'paid' : 'open'}`);

  it('that names the invoice: attached at its installment in its place, PAY2 stays to be paid', async () => {
    for (const pinned of [false, true]) {
      const e = mk(), id = await invoiced(e);
      // from the Actual figure (the app picks PAY2), or from PAY2's row: the receipt says which invoice it pays
      const b = await attach(e, id, { fx: RCT, stage: pinned ? 'PAY2' : undefined, pinned });
      expect(b.g).toMatchObject({ stage: 'PAY2', inv: { stage: 'PAY1', docNo: 'INV2026-0601' }, modes: ['move', 'add'], pick: 'move' });
      expect(actual(e, id)).toBe(53500);
      expect(lines(e, id)).toEqual(['PAY1:53500:paid', 'PAY2:0:open']);
      // the invoice stays as evidence
      expect(docsOf(e.sales, id).filter((x) => x.kind !== 'quotation').map((x) => `${x.kind}@${x.stage}:${x.target}`)).toEqual(['invoice@PAY1:none', 'receipt@PAY1:actual']);
    }
  });

  it('of the invoice\'s amount, from the Actual figure: the same; from PAY2\'s own row: offered, not chosen', async () => {
    const e = mk(), id = await invoiced(e);
    const b = await attach(e, id, { fx: RCT0 });
    expect(b.g).toMatchObject({ inv: { stage: 'PAY1' }, pick: 'move' });
    expect(actual(e, id)).toBe(53500);
    const e2 = mk(), id2 = await invoiced(e2);
    const c = await attach(e2, id2, { fx: RCT0, stage: 'PAY2', pinned: true });
    expect(c.g).toMatchObject({ inv: { stage: 'PAY1' }, modes: ['add', 'move'], pick: 'add' });
    expect(actual(e2, id2)).toBe(107000);
  });
});

describe('a whole-job document on top of money already counted', () => {
  // the final receipt shows the whole job; the deposit receipt (32,100) is counted at PAY1
  const FINAL = analyzeDocText(['ใบกำกับภาษี/ใบเสร็จรับเงิน', 'เลขที่ RC2026-0902', 'วันที่ 15/10/2026', 'รวมเป็นเงิน   100,000.00', 'ภาษีมูลค่าเพิ่ม 7%   7,000.00', 'จำนวนเงินรวมทั้งสิ้น   107,000.00', 'หักเงินมัดจำ (ใบเสร็จ RC2026-0901)   32,100.00', 'ยอดชำระ   74,900.00'].join('\n'));
  async function deposit(e: GccEngine, plan: boolean) {
    const d = e.addDeal({ client: 'บริษัท มัดจำ ' + ++n + ' จำกัด', resp: 'หมิว', year: '2569' } as Partial<Deal>);
    await e.attachDoc(d.id, pdf('QT.pdf'), { kind: 'quotation', amount: 107000, target: 'forecast', basis: 'total', detected: 107000, docNo: 'QT-1', docDate: '2026-08-20', stage: 'QUOTATION' });
    e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    if (plan) e.quickPlan(d.id, 2, [32100, 74900]);
    await e.attachDoc(d.id, pdf('RC-0901.pdf'), { kind: 'receipt', amount: 32100, target: 'actual', basis: 'total', detected: 32100, docNo: 'RC2026-0901', docDate: '2026-09-01', stage: 'PAY1' });
    return d.id;
  }

  for (const plan of [false, true]) {
    it(`the final receipt that deducts the deposit proposes what is left, 74,900 (${plan ? 'plan 30/70' : 'no plan'})`, async () => {
      const e = mk(), id = await deposit(e, plan);
      const b = await attach(e, id, { fx: FINAL });
      expect(b.g).toMatchObject({ stage: 'PAY2', modes: [], over: null });
      expect(actual(e, id)).toBe(107000);
    });

    it(`read at its total (107,000) all the same: only what is left counts by default (${plan ? 'plan 30/70' : 'no plan'})`, async () => {
      const e = mk(), id = await deposit(e, plan);
      const b = await attach(e, id, { fx: FINAL, amount: 107000, basis: 'total' });
      expect(b.g).toMatchObject({ over: { before: 32100, after: 139100, cap: 107000 }, rest: 74900, modes: ['rest', 'none', 'add'], pick: 'rest' });
      expect(actual(e, id)).toBe(107000);
      if (plan) expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => l.status)).toEqual(['paid', 'paid']);
      // the user's "นับเพิ่ม" still counts it on top
      const e2 = mk(), id2 = await deposit(e2, plan);
      await attach(e2, id2, { fx: FINAL, amount: 107000, basis: 'total', mode: 'add' });
      expect(actual(e2, id2)).toBe(139100);
    });
  }

  it('a real second payment that is not the whole job is not questioned', async () => {
    const e = mk(), id = await deposit(e, true);
    const b = await attach(e, id, { amount: 74900, basis: 'manual', name: 'RC-0903.pdf', docNo: 'RC2026-0903', docDate: '2026-10-15' });
    expect(b.g).toMatchObject({ modes: [], over: null, rest: null });
    expect(actual(e, id)).toBe(107000);
  });
});

describe('the one-screen attach (lib/attachPlan): the 121,730.77 replay through every entry', () => {
  // the owner's deal: Forecast 61,730.77 (the quotation's total), one installment, the receipt counted at
  // 60,000 by the old dialog with the installment left "รับบางส่วน" (short by exactly the withholding tax)
  async function owners(e: GccEngine) {
    const d = e.addDeal({ client: 'บริษัท พีเอ็ม ' + ++n + ' จำกัด', section: 'Partner', resp: 'หมิว', year: '2569' } as Partial<Deal>);
    await e.attachDoc(d.id, pdf('QT.pdf'), { kind: 'quotation', amount: 61730.77, target: 'forecast', basis: 'total', detected: 61730.77, docNo: 'QT2026080001', docDate: '2026-08-20', stage: 'QUOTATION' });
    e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    e.quickPlan(d.id, 1);
    await e.attachDoc(d.id, pdf('INV2026090004.pdf'), { kind: 'receipt', amount: 60000, target: 'actual', basis: 'netPay', detected: 60000, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY1' });
    expect(planOf(e.sales, deal(e, d.id), TODAY)!.lines[0].status).toBe('part');
    return d.id;
  }
  /** what the dialog's button does with the plan (components/DocAttach save) */
  async function viaDialog(e: GccEngine, id: string, entry: AttachEntry, file = pdf('INV2026090004.pdf')) {
    const p = attachPlan(e.sales, deal(e, id), entry, { facts: fx, name: file.name, size: file.size }, {}, TODAY);
    if (p.noSave) {
      if (p.full) e.setPayFull(id, p.fullStage, true);
    } else {
      await e.attachDoc(id, file, p.save!);
      if (p.full) e.setPayFull(id, p.fullStage, true);
    }
    return p;
  }
  const entries: [string, (e: GccEngine, id: string) => AttachEntry][] = [
    ['the PAY card', () => ({ at: 'pay', stage: 'PAY1' })],
    ['the plan row "แนบใบเสร็จ"', () => ({ at: 'pay', stage: 'PAY1' })],
    ['the Actual figure', () => ({ at: 'pay' })],
    ['a file dropped on the panel', (e, id) => panelEntry(e.sales, deal(e, id), stageTrack(e.sales, deal(e, id), TODAY).next, TODAY)],
  ];
  for (const [where, entry] of entries) {
    it(`the same receipt again from ${where}: nothing stored, Actual 60,000, the installment received in full`, async () => {
      const e = mk(), id = await owners(e);
      const before = Object.keys(e.sales.docs).length;
      const p = await viaDialog(e, id, entry(e, id));
      expect(p).toMatchObject({ noSave: true, full: true, notice: { tag: 'ใบซ้ำ' } });
      expect(Object.keys(e.sales.docs).length).toBe(before);
      expect(actual(e, id)).toBe(60000);
      expect(planOf(e.sales, deal(e, id), TODAY)!.lines[0]).toMatchObject({ status: 'paid', got: 60000 });
      expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(true);
    });
  }
  it('a re-scan of it (another file, the same number): kept as evidence, Actual 60,000, received in full', async () => {
    const e = mk(), id = await owners(e);
    const p = await viaDialog(e, id, { at: 'pay', stage: 'PAY1' }, pdf('INV2026090004 scan.pdf'));
    expect(p).toMatchObject({ count: 'none', full: true });
    expect(actual(e, id)).toBe(60000);
    expect(receipts(e, id)).toEqual(['PAY1:actual:60000', 'PAY1:none:60000']);
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines[0].status).toBe('paid');
  });
});
