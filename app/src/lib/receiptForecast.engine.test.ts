/**
 * The owner's closed deal "ทองมงคล…" (receipt INV2026090004 at PAY counted as the Forecast, Actual 121,730.77
 * with no Actual document): what made it, through the engine as each build wrote the records.
 * - (a) a receipt / invoice is never offered as the Forecast (docTargets); one an older build counted so is
 *   flagged (targetWrong) and its card's form opens on Actual — or "ไม่นับยอด" when a copy counts already.
 * - (b) a plan line is never built from a receipt counted twice (planStart), and one tap "รับเงินแล้ว" never
 *   records a planned amount well past the Forecast (recvPlan over 'Forecast': nothing is written).
 * - B3: a quotation version an older build counted as Actual reads "รวมใน Actual", not "ไม่นับยอด".
 * - the dialog says a hand receipt kept on top ("นับเพิ่ม") still counts when a copy is replaced.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeDocText, type DocFacts } from './docExtract';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { DEAL_STAGE, closeReady, countedCopy, dealMoney, docTargets, docsOf, dupCounted, formTarget, planOf, planStart, targetWrong, type Deal, type DealDoc } from './sales';
import { acFig, fcFig } from './salesUi';
import { attachPlan, panelEntry, receiveNow, recvOverText, recvPlan } from './attachPlan';
import { qtVerShort, qtVerText, qtView } from './quotes';
import { dmTh } from './format';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-21';
let base: Dataset, R: RoundRaw[], fx: DocFacts;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 30);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
  fx = analyzeDocText(readFileSync(join(__dirname, '__fixtures__', 'INV2026090004.txt'), 'utf8'));
});
afterAll(() => vi.useRealTimers());
const at = (iso: string) => vi.setSystemTime(new Date(iso));

function mk() {
  at('2026-07-27T03:00:00Z');
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
const RNAME = 'INV2026090004_บริษัท พีเอ็ม เอ็นไวรอนเมนทัล จำกัด_.pdf', RSIZE = 319147;
const file = (name: string, size: number) => Object.assign(new Blob([new Uint8Array(size)], { type: 'application/pdf' }), { name });
const deal = (e: GccEngine, id: string) => e.sales.deals[id] as Deal;
/** The deal as it was won: QT v1 61,730.77 (27 ก.ค.), YES 20 ต.ค., the revision QT v2 60,000. */
async function wonDeal(e: GccEngine, v2 = true) {
  at('2026-07-27T03:00:00Z');
  const d = e.addDeal({ client: 'ทองมงคลอุตสาหกรรมน้ำมันปาล์ม', section: 'Partner', resp: 'หมิว', year: '2569' } as Partial<Deal>);
  await e.attachDoc(d.id, file('QT2026070022.pdf', 120001), { kind: 'quotation', amount: 61730.77, target: 'forecast', basis: 'total', detected: 61730.77, docNo: 'QT2026070022', docDate: '2026-07-27', stage: 'QUOTATION' });
  at('2026-10-20T02:00:00Z');
  e.setStep(d.id, DEAL_STAGE, { d: '2026-10-20', n: 'YES' });
  if (v2) await revise(e, d.id);
  return d.id;
}
async function revise(e: GccEngine, id: string) {
  const v1 = qtView(e.sales, deal(e, id)).head!.doc;
  await e.attachDoc(id, file('QT2026070022.pdf', 120001), { kind: 'quotation', amount: 60000, target: 'forecast', basis: 'manual', detected: 60000, docNo: 'QT2026070022', docDate: '2026-07-27', stage: 'QUOTATION', revise: v1.id });
}
/** The receipt attached as an older build's dialog did (its stage, figure and target chosen there). */
const receipt = (e: GccEngine, id: string, stage: string, amount: number, extra: Record<string, unknown> = {}) =>
  e.attachDoc(id, file(RNAME, RSIZE), { kind: 'receipt', amount, target: 'actual', basis: amount === 60000 ? 'netPay' : 'total', detected: amount, docNo: 'INV2026090004', docDate: '2026-09-28', stage, ...extra });
const rcpt = (e: GccEngine, id: string, amount: number) => docsOf(e.sales, id).find((z) => z.kind === 'receipt' && z.amount === amount && z.target !== 'none')!;
const money = (e: GccEngine, id: string) => {
  const m = dealMoney(e.sales, deal(e, id));
  return { forecast: m.forecast, fcDoc: m.fcDoc?.kind ?? null, actual: m.actual, word: acFig(e.sales, deal(e, id)).word };
};
const pays = (e: GccEngine, id: string) => Object.fromEntries(Object.entries(e.sales.pays).filter(([k]) => k.startsWith(id + '/')).map(([k, v]) => [k.slice(id.length + 1), { ...v }]));

describe('(a) a receipt is never the Forecast', () => {
  it('a card offers what its type may count toward, its own first', () => {
    expect(docTargets('receipt')).toEqual(['actual', 'none']);
    expect(docTargets('invoice')).toEqual(['actual', 'none']);
    expect(docTargets('quotation')).toEqual(['forecast', 'none']);
    expect(docTargets('other')).toEqual(['forecast', 'actual', 'none']);
  });

  it('a receipt an older build counted as the Forecast is flagged; its form opens on Actual and the fix gives Forecast and Actual 60,000', async () => {
    const e = mk();
    const id = await wonDeal(e);
    await receipt(e, id, 'PAY1', 60000);
    at('2026-10-21T02:11:00Z');
    // (what "แก้ยอด / ประเภท" → นับเป็น Forecast did on the live build: the engine still takes it from an older build)
    e.updateDoc(id, rcpt(e, id, 60000).id, { target: 'forecast' });
    const r = rcpt(e, id, 60000);
    expect(money(e, id)).toMatchObject({ forecast: 60000, fcDoc: 'receipt', actual: null });
    expect(targetWrong(r)).toBe('forecast');
    expect(fcFig(e.sales, deal(e, id)).docNo).toBe('INV2026090004');
    // the form's "นับเป็น" opens on Actual (no other copy counts) — saving it as it opens sets it right
    expect(formTarget(e.sales, deal(e, id), r)).toBe('actual');
    at('2026-10-21T03:00:00Z');
    e.updateDoc(id, r.id, { target: formTarget(e.sales, deal(e, id), r) });
    expect(money(e, id)).toEqual({ forecast: 60000, fcDoc: 'quotation', actual: 60000, word: 'จากเอกสาร' });
    expect(targetWrong(rcpt(e, id, 60000))).toBeNull();
    expect(qtView(e.sales, deal(e, id)).cur?.n).toBe(2);
  });

  it('a copy counted already: the form opens on "ไม่นับยอด", so setting it right never counts it twice', async () => {
    const e = mk();
    const id = await wonDeal(e);
    await receipt(e, id, 'PAY1', 60000);
    e.updateDoc(id, rcpt(e, id, 60000).id, { target: 'forecast' });
    const old = rcpt(e, id, 60000);
    // the receipt attached again the way the dialog does it now: it counts at PAY
    at('2026-10-21T02:30:00Z');
    await receipt(e, id, 'PAY1', 60000);
    expect(countedCopy(e.sales, deal(e, id), old)?.target).toBe('actual');
    const t = formTarget(e.sales, deal(e, id), old);
    expect(t).toBe('none');
    e.updateDoc(id, old.id, { target: t });
    expect(dupCounted(e.sales, deal(e, id))).toEqual([]);
    expect(money(e, id)).toMatchObject({ forecast: 60000, fcDoc: 'quotation', actual: 60000 });
  });

  it('changing the type keeps the choice within it (a receipt typed as a quotation offers Forecast / ไม่นับยอด)', async () => {
    const e = mk();
    const id = await wonDeal(e);
    await receipt(e, id, 'PAY1', 60000);
    const r = rcpt(e, id, 60000);
    expect(formTarget(e.sales, deal(e, id), r)).toBe('actual');
    expect(formTarget(e.sales, deal(e, id), r, 'quotation', 'actual')).toBe('forecast');
    expect(formTarget(e.sales, deal(e, id), r, 'other', 'actual')).toBe('actual');
  });
});

describe('(b) a plan line never carries a receipt counted twice', () => {
  it('both copies at PAY1 (61,730.77 and 60,000): the plan starts at 60,000, not 121,730.76999…', async () => {
    const e = mk();
    const id = await wonDeal(e);
    await receipt(e, id, 'PAY1', 61730.77);
    await receipt(e, id, 'PAY1', 60000);
    expect(dupCounted(e.sales, deal(e, id))).toHaveLength(1);
    expect(planStart(e.sales, deal(e, id), TODAY).lines).toEqual([{ stage: 'PAY1', amt: 60000, old: '' }]);
    e.quickPlan(id, 1);
    expect(pays(e, id).PAY1.amt).toBe(60000);
    // set right (the older copy "ไม่นับยอด"): the plan and Actual agree, nothing left owed
    e.updateDoc(id, rcpt(e, id, 61730.77).id, { target: 'none' });
    const P = planOf(e.sales, deal(e, id), TODAY)!;
    expect(P.lines[0]).toMatchObject({ stage: 'PAY1', amt: 60000, got: 60000, status: 'paid' });
    expect(money(e, id)).toMatchObject({ forecast: 60000, actual: 60000 });
  });

  it('copies at PAY1 and PAY2 with a typed Actual 121,730.77: the older copy\'s stage gets no amount and no hand receipt', async () => {
    const e = mk();
    const id = await wonDeal(e);
    await receipt(e, id, 'PAY1', 61730.77);
    await receipt(e, id, 'PAY2', 60000);
    e.updateDeal(id, { actual: 121730.77 });
    expect(planStart(e.sales, deal(e, id), TODAY)).toEqual({ lines: [{ stage: 'PAY1', amt: null, old: '' }, { stage: 'PAY2', amt: 60000, old: '' }], used: ['PAY1', 'PAY2'] });
    e.quickPlan(id, 1);
    expect(pays(e, id).PAY1).toBeUndefined();
    expect(pays(e, id).PAY2).toMatchObject({ amt: 60000, rcv: '' });
    // the older copy set right: no money recorded by hand comes back in its place
    e.updateDoc(id, rcpt(e, id, 61730.77).id, { target: 'none' });
    expect(dealMoney(e.sales, deal(e, id))).toMatchObject({ actual: 60000, hand: 0 });
  });

  it('two different documents at one stage still add up, to the satang', async () => {
    const e = mk();
    const id = await wonDeal(e);
    await e.attachDoc(id, file('a.pdf', 1000), { kind: 'receipt', amount: 61730.77, target: 'actual', basis: 'total', detected: 61730.77, docNo: 'RC-1', docDate: '2026-09-28', stage: 'PAY1' });
    await e.attachDoc(id, file('b.pdf', 2000), { kind: 'receipt', amount: 60000, target: 'actual', basis: 'total', detected: 60000, docNo: 'RC-2', docDate: '2026-09-29', stage: 'PAY1' });
    expect(planStart(e.sales, deal(e, id), TODAY).lines).toEqual([{ stage: 'PAY1', amt: 121730.77, old: '' }]);
  });
});

describe('(b) one tap "รับเงินแล้ว" never records a planned amount well past the Forecast', () => {
  /** A plan line of 121,730.77 (set while the receipt counted twice), the receipts no longer counting. */
  async function inflated() {
    const e = mk();
    const id = await wonDeal(e);
    await receipt(e, id, 'PAY1', 61730.77);
    await receipt(e, id, 'PAY1', 60000);
    e.setPlan(id, [{ stage: 'PAY1', amt: 121730.77, pct: null, due: '', rel: 30, how: 'transfer', howT: '', note: '' }]);
    at('2026-10-21T02:10:00Z');
    docsOf(e.sales, id).filter((z) => z.kind === 'receipt').forEach((z) => e.updateDoc(id, z.id, { target: 'none' }));
    return { e, id };
  }

  it('refused with the reason, nothing written (the owner\'s "รับ 21 ต.ค. · 121,730.77 บันทึกเอง")', async () => {
    const { e, id } = await inflated();
    const r = recvPlan(e.sales, deal(e, id), 'PAY1', TODAY)!;
    expect(r.over).toEqual({ actual: 0, cap: 60000, extra: null, what: 'Forecast' });
    expect(recvOverText(e.sales, deal(e, id), r)).toBe('ยังไม่ได้บันทึก PAY · แผนงวดนี้ 121,730.77 บาท จะเกิน Forecast 60,000 บาท · ถ้ายอดแผนผิด กด “แก้ไขแผน” ถ้ารับเงินเท่านี้จริง กด “แก้ยอด / วันที่”');
    const before = pays(e, id);
    expect(receiveNow(e, id, 'PAY1', TODAY)).toBeNull();
    expect(pays(e, id)).toEqual(before);
    expect(dealMoney(e.sales, deal(e, id)).actual).toBeNull();
  });

  it('the plan corrected to 60,000: one tap records it as before', async () => {
    const { e, id } = await inflated();
    e.setPlan(id, [{ stage: 'PAY1', amt: 60000, pct: null, due: '', rel: 30, how: 'transfer', howT: '', note: '' }]);
    expect(recvPlan(e.sales, deal(e, id), 'PAY1', TODAY)!.over).toBeNull();
    expect(receiveNow(e, id, 'PAY1', TODAY)).toMatchObject({ stage: 'PAY1', amount: 60000 });
    expect(dealMoney(e.sales, deal(e, id)).actual).toBe(60000);
  });

  it('a plan of two within the Forecast still takes each installment in one tap', async () => {
    const e = mk();
    const id = await wonDeal(e);
    e.quickPlan(id, 2);
    expect(receiveNow(e, id, 'PAY1', TODAY)).toMatchObject({ amount: 30000 });
    expect(receiveNow(e, id, 'PAY2', TODAY)).toMatchObject({ amount: 30000 });
    expect(dealMoney(e.sales, deal(e, id)).actual).toBe(60000);
  });
});

describe('B3: a quotation version counted as Actual says so', () => {
  it('QT v1 an older build counted as Actual reads "รวมใน Actual" in the versions list; "ไม่นับยอด" on it leaves the receipt', async () => {
    const e = mk();
    const id = await wonDeal(e, false);
    const q1 = qtView(e.sales, deal(e, id)).head!.doc;
    at('2026-10-20T03:00:00Z');
    e.updateDoc(id, q1.id, { target: 'actual' });
    await receipt(e, id, 'PAY1', 60000);
    at('2026-10-20T04:00:00Z');
    await revise(e, id);
    const v = qtView(e.sales, deal(e, id)), v1 = v.versions[0];
    expect(v1.doc.target).toBe('actual');
    expect(qtVerText(v1, v.typed)).toBe('27 ก.ค. 2569 · 61,730.77 บาท · รวมใน Actual');
    expect(qtVerShort(v1)).toBe(`61,730.77 · ${dmTh('2026-07-27')} · รวมใน Actual`);
    expect(qtVerText(v.versions[1], v.typed)).toContain('นับเป็น Forecast');
    expect(targetWrong(v1.doc)).toBe('actual');
    expect(money(e, id)).toMatchObject({ forecast: 60000, actual: 121730.77 });
    // the version list's "ไม่นับใน Actual"
    e.updateDoc(id, v1.doc.id, { target: 'none' });
    expect(money(e, id)).toMatchObject({ forecast: 60000, fcDoc: 'quotation', actual: 60000, word: 'จากเอกสาร' });
    expect(qtVerText(qtView(e.sales, deal(e, id)).versions[0], false)).toContain('ไม่นับยอด');
  });
});

describe('a hand receipt kept on top ("นับเพิ่ม") is named when a copy replaces the receipt', () => {
  it('the notice says the 60,000 recorded by hand still counts (Actual 120,000, as the line after it says)', async () => {
    const e = mk();
    const id = await wonDeal(e);
    e.quickPlan(id, 1);
    e.markPaid(id, 'PAY1', { date: '2026-10-20', amount: 60000, how: 'transfer' });
    await receipt(e, id, 'PAY1', 61730.77, { addHand: true });
    expect(dealMoney(e.sales, deal(e, id)).actual).toBe(121730.77);
    const d = deal(e, id), entry = panelEntry(e.sales, d, 'PAY1', TODAY);
    const p = attachPlan(e.sales, d, entry, { facts: fx, name: RNAME, size: RSIZE }, {}, TODAY);
    expect(p.notice?.tag).toBe('ใบซ้ำ');
    expect(p.notice?.text).toBe('ใบเสร็จ INV2026090004 นับไว้แล้วที่ขั้น PAY 61,730.77 บาท · บันทึกครั้งนี้นับแทนเป็น 60,000 บาท ไม่นับซ้ำ · เงินที่บันทึกเองไว้ 60,000 บาท (20 ต.ค. 2569) ยังนับเพิ่มอยู่');
    expect(p.after).toContain('Actual จาก 121,730.77 เป็น 120,000 บาท');
    // and what is saved is what it says
    await e.attachDoc(id, file(RNAME, RSIZE), p.save!);
    expect(dealMoney(e.sales, deal(e, id)).actual).toBe(120000);
  });
});

describe('the owner\'s deal today, set right on this build', () => {
  it('receipt → Actual (the form\'s own choice), plan 60,000: Forecast QT v2, Actual 60,000, still closed', async () => {
    const e = mk();
    const id = await wonDeal(e);
    await receipt(e, id, 'PAY1', 61730.77);
    await receipt(e, id, 'PAY1', 60000);
    // the plan the live build pre-filled while the receipt counted twice
    e.setPlan(id, [{ stage: 'PAY1', amt: 121730.77, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '' }]);
    at('2026-10-20T09:00:00Z');
    e.updateDeal(id, { jobStatus: 'closed' });
    at('2026-10-21T02:10:00Z');
    e.updateDoc(id, rcpt(e, id, 61730.77).id, { target: 'none' });
    e.updateDoc(id, rcpt(e, id, 60000).id, { target: 'forecast' });
    e.markPaid(id, 'PAY1', { date: TODAY, amount: null, how: 'transfer' });
    expect(money(e, id)).toEqual({ forecast: 60000, fcDoc: 'receipt', actual: 121730.77, word: 'บันทึกเอง' });
    // the fix: 1 แก้ไขแผน PAY 60,000; 2 the receipt card → its form's choice (Actual)
    at('2026-10-21T03:00:00Z');
    e.setPlan(id, [{ stage: 'PAY1', amt: 60000, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '' }]);
    const r = docsOf(e.sales, id).find((z) => targetWrong(z))!;
    e.updateDoc(id, r.id, { target: formTarget(e.sales, deal(e, id), r) });
    expect(money(e, id)).toEqual({ forecast: 60000, fcDoc: 'quotation', actual: 60000, word: 'จากเอกสาร' });
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines[0]).toMatchObject({ amt: 60000, got: 60000, status: 'paid', hand: false });
    expect(closeReady(e.sales, deal(e, id), TODAY)).toBe(true);
    expect(deal(e, id).jobStatus).toBe('closed');
    expect(docsOf(e.sales, id).filter((z: DealDoc) => targetWrong(z))).toEqual([]);
  });
});
