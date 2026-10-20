/**
 * The attach dialog's one screen (lib/attachPlan): which amount is proposed for each entry and document,
 * which sentence, tag and default for each "may be counted already" case, the revision compared on the same
 * basis, and "รับเงินแล้ว (ไม่มีไฟล์)" in one tap. Deals are set up through the engine (the records the app
 * writes); the plan is pure. The sample receipt: __fixtures__/INV2026090004.txt (รวม 61,730.77, หัก ณ ที่จ่าย
 * 3% 1,730.77, ยอดชำระ 60,000, ต้นฉบับ + สำเนา).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeDocText, type DocFacts } from './docExtract';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { dealMoney, docsOf, planOf, type Deal } from './sales';
import { attachPlan, figParts, figureRows, panelEntry, receiveNow, recvPlan, stepName, undoReceive, whtPct, type AttachChoice, type AttachEntry } from './attachPlan';
import { dealChecks, guardHits, type MonthClose } from './payCheck';
import { previewOf } from './payCheck';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-20';
let base: Dataset, R: RoundRaw[], RC: DocFacts;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 50);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
  RC = analyzeDocText(readFileSync(join(__dirname, '__fixtures__', 'INV2026090004.txt'), 'utf8'));
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
const CLIENT = 'บริษัท พีเอ็ม เอ็นไวรอนเมนทัล จำกัด';
const pdf = (name: string, body = '%PDF-1.4 ' + name) => Object.assign(new Blob([body], { type: 'application/pdf' }), { name });
const facts = (o: Partial<DocFacts>): DocFacts => ({ kind: 'receipt', docNo: '', docDate: '', total: null, subtotal: null, vat: null, wht: null, netPay: null, words: null, party: '', candidates: [], confidence: 'high', ...o });
/** the sample's figures as a quotation (QT2026080001, 20 ส.ค.) */
const QT = () => ({ ...RC, kind: 'quotation' as const, docNo: 'QT2026080001', docDate: '2026-08-20', copies: undefined, refs: undefined, party: '' });
/** a revised quotation: ยอดชำระ 55,000 after 3% of 52,884.62 (รวม VAT 56,586.54) */
const QT2 = facts({ kind: 'quotation', docNo: 'QT2026080001', docDate: '2026-09-05', subtotal: 52884.62, vat: 3701.92, total: 56586.54, wht: 1586.54, netPay: 55000 });
const RCT = (o: Partial<DocFacts> = {}) => ({ ...RC, party: '', ...o });
/** the file the sample receipt was attached as (name and size: the same file found again) */
const RFILE = pdf('INV2026090004.pdf');
const read = (f: DocFacts | null, file = RFILE) => ({ facts: f, name: file.name, size: file.size });
const deal = (e: GccEngine, id: string) => e.sales.deals[id];
const plan = (e: GccEngine, id: string, entry: AttachEntry, f: DocFacts | null, choice: AttachChoice = {}, file = RFILE) => attachPlan(e.sales, deal(e, id), entry, read(f, file), choice, TODAY);
/** What the dialog's "บันทึก" does with a plan (components/DocAttach save). */
async function save(e: GccEngine, id: string, entry: AttachEntry, f: DocFacts | null, choice: AttachChoice = {}, file = RFILE) {
  const p = plan(e, id, entry, f, choice, file);
  if (p.noSave) {
    if (p.full && p.fullStage) e.setPayFull(id, p.fullStage, true);
    return p;
  }
  await e.attachDoc(id, file, p.save!);
  if (p.full && p.fullStage) e.setPayFull(id, p.fullStage, true);
  return p;
}
let n = 0;
/** A job: CALL done, `qt` = its quotation of 60,000 (net) at QUOTATION, `won` on 25 ส.ค., `plan` installments. */
async function job(e: GccEngine, o: { qt?: number | null; qtBasis?: 'netPay' | 'total' | 'manual'; won?: boolean; plan?: number; forecast?: number } = {}) {
  const d = e.addDeal({ client: CLIENT.replace('จำกัด', ++n + ' จำกัด'), section: 'Partner', resp: 'หมิว', year: '2569', ...(o.forecast != null ? { forecast: o.forecast } : {}) } as Partial<Deal>);
  if (o.qt !== null) {
    const a = o.qt ?? 60000;
    await e.attachDoc(d.id, pdf('QT2026080001.pdf'), { kind: 'quotation', amount: a, target: 'forecast', basis: o.qtBasis ?? 'netPay', detected: a, docNo: 'QT2026080001', docDate: '2026-08-20', stage: 'QUOTATION' });
  }
  if (o.won ?? true) e.setStep(d.id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
  if (o.plan) e.quickPlan(d.id, o.plan);
  return d.id;
}
const actual = (e: GccEngine, id: string) => dealMoney(e.sales, deal(e, id)).actual;
const words = (s: { code: string; th: string }) => (s.th ? `${s.code} ${s.th}` : s.code);

describe('the amount: what the customer pays, the same rule for a quotation and a receipt', () => {
  it('1. a quotation with withholding tax at QUOTATION: 60,000, why, the figures line, one button, nothing to ask', async () => {
    const e = mk(), id = await job(e, { qt: null, won: false });
    const p = plan(e, id, { at: 'quote' }, QT(), {}, pdf('QT2026080001.pdf'));
    expect(p).toMatchObject({ mode: 'quote', kind: 'quotation', amount: 60000, basis: 'netPay', notice: null, title: 'ใบเสนอราคา · ขั้น QUOTATION', amountLabel: 'ยอดที่ลูกค้าจะจ่าย · เป็น Forecast' });
    expect(p.reason).toBe('ยอดชำระหลังหัก ณ ที่จ่าย 3% · เงินที่จะเข้าบัญชีจริง');
    expect('ในเอกสาร: ' + p.figs.join(' · ')).toBe('ในเอกสาร: รวม VAT 61,730.77 · หัก ณ ที่จ่าย 3% 1,730.77 · ยอดชำระ 60,000');
    expect(p.primary).toBe('บันทึก Forecast 60,000 บาท');
    expect(p.after).toBe('Forecast เป็น 60,000 บาท · ขั้น QUOTATION ทำแล้ว 20 ส.ค. 2569');
    expect(p.save).toMatchObject({ kind: 'quotation', amount: 60000, target: 'forecast', basis: 'netPay', detected: 60000, stage: 'QUOTATION', kept: false });
    expect(p.save!.revise).toBeUndefined();
  });

  it('2. a quotation without a withholding line keeps the total incl. VAT; a typed Forecast is replaced, and says so', async () => {
    const e = mk(), id = await job(e, { qt: null, won: false, forecast: 65000 });
    const p = plan(e, id, { at: 'quote' }, facts({ kind: 'quotation', subtotal: 100000, vat: 7000, total: 107000, docNo: 'QT-9', docDate: '2026-08-20' }));
    expect(p).toMatchObject({ amount: 107000, basis: 'total', reason: 'ยอดรวมทั้งสิ้น รวม VAT 7% · เอกสารนี้ไม่มีหัก ณ ที่จ่าย' });
    expect(p.after).toBe('Forecast จาก 65,000 (พิมพ์ไว้) เป็น 107,000 บาท · ขั้น QUOTATION ทำแล้ว 20 ส.ค. 2569');
    expect(p.figs).toEqual(['ก่อน VAT 100,000', 'VAT 7,000', 'รวม 107,000']);
  });

  it('3. the sample receipt at a one-installment plan of 60,000: 60,000, the copy page noted, ready to close', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    const w = words(stepName(e.sales, deal(e, id), 'PAY1'));
    expect(p).toMatchObject({ mode: 'pay', kind: 'receipt', amount: 60000, basis: 'netPay', copies: true, notice: null, count: 'add', title: `ใบเสร็จ · ขั้น ${w}`, amountLabel: 'เงินที่ได้รับ · นับเข้า Actual' });
    expect(p.reason).toBe('ยอดชำระหลังหัก ณ ที่จ่าย 3% · เงินที่เข้าบัญชีจริง');
    expect(p.after).toBe('รับครบตามแผน 60,000 บาท · Actual 60,000 จาก Forecast 60,000 · งานนี้พร้อมปิดงาน');
    expect(p.primary).toBe('บันทึกรับเงิน 60,000 บาท');
    expect(p.sub).toBe(`${deal(e, id).client} · แผน 60,000 บาท ครบกำหนด 24 ก.ย. 2569`);
  });

  it('4. three installments: the title names the installment, the line says what is left', async () => {
    const e = mk(), id = await job(e, { plan: 3 });
    e.markPaid(id, 'PAY1', { date: '2026-09-25', amount: null });
    const p = plan(e, id, { at: 'pay', stage: 'PAY2' }, facts({ docNo: 'RC-2', total: 20000, docDate: '2026-10-10' }), {}, pdf('RC-2.pdf'));
    expect(p.title).toBe(`ใบเสร็จ · ขั้น ${words(stepName(e.sales, deal(e, id), 'PAY2'))}`);
    expect(p.after).toBe('ขั้น PAY2 ครบตามแผน 20,000 บาท · เหลืออีก 1 งวด 20,000 บาท');
  });

  it('5. 60,000 against a plan of 61,730.77: short by exactly withholding tax, so received in full (unless "ยังค้าง")', async () => {
    const e = mk(), id = await job(e, { qt: 61730.77, qtBasis: 'total', plan: 1 });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p).toMatchObject({ full: true, fullStage: 'PAY1', whtShort: { short: 1730.77, rate: 3 } });
    expect(p.after).toContain('ส่วนที่ขาด 1,730.77 คือหัก ณ ที่จ่าย 3%');
    expect(p.after).toContain('งานนี้พร้อมปิดงาน');
    const q = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT(), { notWht: true });
    expect(q.full).toBe(false);
    expect(q.after).toBe('ขั้น PAY1 ยังค้าง 1,730.77 บาท');
    // saved: the installment is received, Actual 60,000
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines[0]).toMatchObject({ status: 'paid', got: 60000, full: true });
  });
});

describe('a second document at an installment that counts money already: one sentence, a safe default', () => {
  it('6. a receipt after the invoice counted there replaces it ("นับแทน"), the invoice stays as evidence', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    await e.attachDoc(id, pdf('BL2026080006.pdf'), { kind: 'invoice', amount: 61730.77, target: 'actual', basis: 'total', detected: 61730.77, docNo: 'BL2026080006', docDate: '2026-08-31', stage: 'PAY1' });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p.count).toBe('replace');
    expect(p.notice).toMatchObject({ tone: 'info', tag: 'นับแทน' });
    expect(p.notice!.text).toBe('ใบเสร็จนี้นับแทนใบแจ้งหนี้ BL2026080006 ที่นับไว้ 61,730.77 บาท · ใบแจ้งหนี้เก็บไว้เป็นหลักฐาน ไม่นับซ้ำ');
    expect(p.notice!.alts).toEqual([{ pre: 'เป็นเงินอีกก้อน?', label: 'นับเพิ่ม', choice: { count: 'add' } }]);
    expect(p.after).toBe('Actual จาก 61,730.77 เป็น 60,000 บาท · รับครบตามแผน · งานนี้พร้อมปิดงาน');
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(actual(e, id)).toBe(60000);
    expect(docsOf(e.sales, id).filter((x) => x.kind !== 'quotation').map((x) => `${x.kind}:${x.target}`)).toEqual(['invoice:none', 'receipt:actual']);
  });

  it('7. one vendor number for the invoice and the receipt (INV2026090004): the receipt replaces the invoice, it is not a duplicate', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    await e.attachDoc(id, pdf('INV2026090004-invoice.pdf'), { kind: 'invoice', amount: 61730.77, target: 'actual', basis: 'total', detected: 61730.77, docNo: 'INV2026090004', docDate: '2026-09-20', stage: 'PAY1' });
    const inv = docsOf(e.sales, id).find((x) => x.kind === 'invoice')!;
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p.count).toBe('replace');
    expect(p.notice!.tag).toBe('นับแทน');
    expect(p.save!.replace).toBe(inv.id);
  });

  it('11. two part payments of one installment: the second is "the rest" when the two make the plan; else it replaces', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, facts({ docNo: 'RC-1', total: 30000, docDate: '2026-09-01' }), {}, pdf('RC-1.pdf'));
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, facts({ docNo: 'RC-2', total: 30000, docDate: '2026-10-01' }), {}, pdf('RC-2.pdf'));
    expect(p.count).toBe('add');
    expect(p.notice).toMatchObject({ tag: 'ส่วนที่เหลือ' });
    expect(p.notice!.text).toBe('ใบนี้คือเงินส่วนที่เหลือของขั้น PAY1 · รวมกับใบเดิม RC-1 30,000 เป็น 60,000 บาท ครบตามแผน');
    expect(p.notice!.alts[0]).toMatchObject({ label: 'ใบนี้แทนใบเดิม', choice: { count: 'replace' } });
    const q = plan(e, id, { at: 'pay', stage: 'PAY1' }, facts({ docNo: 'RC-2', total: 40000, docDate: '2026-10-01' }), {}, pdf('RC-2.pdf'));
    expect(q.count).toBe('replace');
    await save(e, id, { at: 'pay', stage: 'PAY1' }, facts({ docNo: 'RC-2', total: 30000, docDate: '2026-10-01' }), {}, pdf('RC-2.pdf'));
    expect(actual(e, id)).toBe(60000);
  });

  it('12. another receipt at an installment received in full replaces; counted on top on purpose, it says "มากกว่าแผน"', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, facts({ docNo: 'RC-1', total: 60000, docDate: '2026-09-01' }), {}, pdf('RC-1.pdf'));
    const f2 = facts({ docNo: 'RC-7', total: 60000, docDate: '2026-10-01' }), file = pdf('RC-7.pdf');
    expect(plan(e, id, { at: 'pay', stage: 'PAY1' }, f2, {}, file).count).toBe('replace');
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, f2, { count: 'add' }, file);
    expect(p).toMatchObject({ count: 'add', overTag: 'มากกว่าแผน' });
    expect(p.after).toBe('Actual จะเป็น 120,000 มากกว่าแผน 60,000 บาท · ตรวจว่าใช่เงินที่เข้าบัญชีจริง');
  });

  it('13. money recorded by hand at this installment: its receipt is that money (N6); half by hand plus the other half adds up', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    e.markPaid(id, 'PAY1', { date: '2026-09-28', amount: 60000 });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p.count).toBe('replace');
    expect(p.notice).toMatchObject({ tag: 'ใบเสร็จของเงินก้อนนี้', text: 'ขั้น PAY1 บันทึกรับเงินเองไว้ 60,000 บาท (28 ก.ย. 2569) · ใบนี้คือใบเสร็จของเงินก้อนนั้น ไม่นับซ้ำ' });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(actual(e, id)).toBe(60000);

    const e2 = mk(), id2 = await job(e2, { plan: 1 });
    e2.markPaid(id2, 'PAY1', { date: '2026-09-28', amount: 30000 });
    const q = plan(e2, id2, { at: 'pay', stage: 'PAY1' }, facts({ docNo: 'RC-2', total: 30000, docDate: '2026-10-05' }), {}, pdf('RC-2.pdf'));
    expect(q).toMatchObject({ count: 'add', notice: { tag: 'ส่วนที่เหลือ' } });
    expect(q.save!.addHand).toBe(true);
    await save(e2, id2, { at: 'pay', stage: 'PAY1' }, facts({ docNo: 'RC-2', total: 30000, docDate: '2026-10-05' }), {}, pdf('RC-2.pdf'));
    expect(actual(e2, id2)).toBe(60000);
  });

  it('14. money recorded by hand at PAY1 a day before, the receipt from the Actual figure (→ PAY2): it goes to PAY1', async () => {
    // (PAY2 is planned at another amount: a receipt equal to the next installment's plan is that one's own, actualCount.engine.test)
    const e = mk(), id = await job(e, { qt: 100000, qtBasis: 'manual' });
    e.setPlan(id, [
      { stage: 'PAY1', amt: 60000, pct: null, due: '', rel: 30, how: 'transfer', howT: '', note: '' },
      { stage: 'PAY2', amt: 40000, pct: null, due: '', rel: 60, how: 'transfer', howT: '', note: '' },
    ]);
    e.markPaid(id, 'PAY1', { date: '2026-09-27', amount: 60000 });
    const p = plan(e, id, { at: 'pay' }, RCT());
    expect(p.count).toBe('move');
    expect(p.notice).toMatchObject({ tag: 'ย้ายไป PAY1' });
    expect(p.notice!.text).toBe('เงินก้อนนี้บันทึกไว้ที่ขั้น PAY1 แล้ว (27 ก.ย. 2569) · แนบใบเสร็จนี้ที่ PAY1 แทน ไม่นับซ้ำ');
    expect(p.primary).toBe('บันทึกรับเงินที่ PAY1 60,000 บาท');
    await save(e, id, { at: 'pay' }, RCT());
    expect(actual(e, id)).toBe(60000);
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => l.status === 'paid')).toEqual([true, false]);
  });
});

describe('the same document again: "ใบซ้ำ", never counted twice', () => {
  it('8. the same file again: nothing stored; a WHT-short installment is received in full; another file of that number is evidence, or replaces it', async () => {
    const e = mk(), id = await job(e, { qt: 61730.77, qtBasis: 'total', plan: 1 });
    await e.attachDoc(id, RFILE, { kind: 'receipt', amount: 60000, target: 'actual', basis: 'netPay', detected: 60000, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY1' });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p).toMatchObject({ noSave: true, count: 'nosave', save: null, amountLabel: 'เงินที่ได้รับ · นับครั้งเดียว', primary: 'ตกลง ไม่นับซ้ำ', quiet: 'ไม่แนบ', full: true, fullStage: 'PAY1' });
    expect(p.notice).toMatchObject({ tone: 'warn', tag: 'ใบซ้ำ' });
    expect(p.notice!.text).toBe('ใบเสร็จ INV2026090004 นับไปแล้วที่ขั้น PAY1 60,000 บาท (แนบ 20 ต.ค. 2569) · ระบบจะไม่นับซ้ำ');
    expect(p.after).toBe('Actual ยังเป็น 60,000 บาท · ขั้น PAY1 ถือว่ารับครบ เพราะส่วนที่ขาด 1,730.77 คือหัก ณ ที่จ่าย 3% · งานนี้พร้อมปิดงาน');
    expect(p.reason).toBe('เท่ากับใบเดิม · ยอดชำระหลังหัก ณ ที่จ่าย 3%');
    // no way to add it on top: "นับเพิ่ม" is never offered, and asking for it changes nothing
    expect(plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT(), { count: 'add' }).count).toBe('nosave');
    // another file of the same number (a re-scan): evidence, or this file in place of the first
    const scan = pdf('INV2026090004 scan.pdf');
    const q = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT(), {}, scan);
    expect(q).toMatchObject({ count: 'none', noSave: false, save: { target: 'none' }, left: { label: 'ไม่ใช่ใบเดียวกัน? แก้เลขที่', act: 'editNo' } });
    expect(q.notice!.alts.map((a) => a.label)).toEqual(['ดูใบเดิม', 'ใช้ไฟล์นี้แทนใบเดิม']);
    const old = docsOf(e.sales, id).find((x) => x.kind === 'receipt')!;
    const r = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT(), q.notice!.alts[1].choice!, scan);
    expect(r).toMatchObject({ count: 'replace', save: { target: 'actual', replace: old.id, amount: 60000 } });
    expect(plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT(), { count: 'add' }, scan).count).toBe('none');
    // saved (nothing stored): the installment is received, Actual stays 60,000
    const before = Object.keys(e.sales.docs).length;
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(Object.keys(e.sales.docs).length).toBe(before);
    expect(actual(e, id)).toBe(60000);
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines[0].status).toBe('paid');
  });

  it('9. the same receipt at another installment (a two-line plan): kept as evidence, Actual unchanged', async () => {
    const e = mk(), id = await job(e, { qt: 120000, qtBasis: 'manual', plan: 2 });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(actual(e, id)).toBe(60000);
    const p = plan(e, id, { at: 'pay', stage: 'PAY2' }, RCT(), {}, pdf('INV2026090004 copy.pdf'));
    expect(p).toMatchObject({ count: 'none', save: { target: 'none', stage: 'PAY2' }, notice: { tag: 'ใบซ้ำ' } });
    expect(p.notice!.alts.map((a) => a.label)).toEqual(['ดูใบเดิม']);
    await save(e, id, { at: 'pay', stage: 'PAY2' }, RCT(), {}, pdf('INV2026090004 copy.pdf'));
    expect(actual(e, id)).toBe(60000);
    // the same file: nothing stored at all
    expect(plan(e, id, { at: 'pay', stage: 'PAY2' }, RCT()).noSave).toBe(true);
  });

  it('10. a misread number on the same file (name and size) is still the same document', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT({ docNo: 'INV2O26O9OOO4' }));
    expect(p).toMatchObject({ noSave: true, notice: { tag: 'ใบซ้ำ' } });
  });

  it('a deal that counts one receipt twice already (61,730.77 + 60,000): attached again, it counts once', async () => {
    const e = mk(), id = await job(e);
    await e.attachDoc(id, RFILE, { kind: 'receipt', amount: 61730.77, target: 'actual', basis: 'total', detected: 61730.77, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY1' });
    await e.attachDoc(id, RFILE, { kind: 'receipt', amount: 60000, target: 'actual', basis: 'netPay', detected: 60000, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY2' });
    expect(actual(e, id)).toBe(121730.77);
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p).toMatchObject({ count: 'replace', notice: { tag: 'ใบซ้ำ' } });
    expect(p.notice!.text).toContain('นับซ้ำอยู่ 2 ครั้ง');
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(actual(e, id)).toBe(60000);
  });
});

describe('a revised quotation: compared on the same basis', () => {
  it('15. 60,000 net → 55,000 net: "ลดลง 5,000 บาท (8%)"; a file without that figure says so; a typed version is compared with its amount', async () => {
    const e = mk(), id = await job(e, { won: false });
    const v1 = docsOf(e.sales, id).find((x) => x.kind === 'quotation')!;
    const p = plan(e, id, { at: 'quote', revise: v1.id }, QT2, {}, pdf('QT2026080001-rev.pdf'));
    expect(p).toMatchObject({ amount: 55000, basis: 'netPay', revise: v1.id, title: 'ใบเสนอราคาฉบับแก้ไข · ฉบับที่ 2', amountLabel: 'Forecast ใหม่', primary: 'บันทึกฉบับที่ 2 · Forecast 55,000 บาท' });
    expect(p.notice).toMatchObject({ tag: 'ฉบับแก้ไข', lead: 'Forecast จาก 60,000 เป็น 55,000 บาท', text: 'ลดลง 5,000 บาท (8%) · เทียบยอดชำระหลังหัก ณ ที่จ่ายทั้งสองฉบับ' });
    expect(p.reason).toBe('ยอดชำระหลังหัก ณ ที่จ่าย 3% · เงินที่จะเข้าบัญชีจริง · คิดแบบเดียวกับฉบับที่ 1');
    expect(p.sub).toBe(`${deal(e, id).client} · แก้จาก QT2026080001 ฉบับที่ 1`);
    expect(p.after).toBe('ฉบับที่ 1 (20 ส.ค. 2569) เก็บเป็น “ฉบับเดิม” เปิดดูได้ ไม่นับยอด · วันที่ขั้น QUOTATION ยังเป็น 20 ส.ค. 2569');
    expect(p.links.type).toBe(false);
    // the new file shows no amount after withholding: its total, and the notice says the bases differ
    const q = plan(e, id, { at: 'quote', revise: v1.id }, facts({ kind: 'quotation', subtotal: 52884.62, vat: 3701.92, total: 56586.54 }));
    expect(q.amount).toBe(56586.54);
    expect(q.notice!.text).toContain('คนละฐานกับฉบับเดิม');
    // a version typed by hand: compared with its amount
    const e2 = mk(), id2 = await job(e2, { qt: 58000, qtBasis: 'manual', won: false });
    const r = plan(e2, id2, { at: 'quote' }, QT2);
    expect(r.notice).toMatchObject({ lead: 'Forecast จาก 58,000 เป็น 55,000 บาท' });
    // saved: Forecast follows the new version, the old one is "ฉบับเดิม", QUOTATION keeps its first date
    await save(e, id, { at: 'quote', revise: v1.id }, QT2, {}, pdf('QT2026080001-rev.pdf'));
    expect(dealMoney(e.sales, deal(e, id)).forecast).toBe(55000);
    expect(e.sales.docs[`${id}/${v1.id}`].target).toBe('none');
    expect(e.sales.steps[`${id}/QUOTATION`].d).toBe('2026-08-20');
  });

  it('a quotation from the Forecast figure while one is counted is a revision of it', async () => {
    const e = mk(), id = await job(e, { won: false });
    expect(plan(e, id, { at: 'quote' }, QT2).revise).toBe(docsOf(e.sales, id).find((x) => x.kind === 'quotation')!.id);
  });
});

describe('the button decides what the document is; a file of another type is kept as evidence, one click away', () => {
  it('16. a quotation at a PAY card, a receipt at QUOTATION, a receipt as "เอกสารอื่น", a joint quotation\'s member', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, QT(), {}, pdf('QT2026080001.pdf'));
    expect(p).toMatchObject({ mode: 'other', target: 'none', primary: 'แนบเป็นหลักฐาน', notice: { tag: 'ไม่ใช่ใบเสร็จ' }, after: 'เก็บในการ์ด “เอกสารอื่น” · ไม่เปลี่ยน Forecast หรือ Actual' });
    expect(p.notice!.alts[0]).toMatchObject({ label: 'ใช้เป็นใบเสนอราคา (Forecast)', choice: { kind: 'quote' } });
    expect(plan(e, id, { at: 'pay', stage: 'PAY1' }, QT(), p.notice!.alts[0].choice!, pdf('QT2026080001.pdf')).mode).toBe('quote');
    const q = plan(e, id, { at: 'quote' }, RCT());
    expect(q).toMatchObject({ mode: 'other', target: 'none', notice: { tag: 'ไม่ใช่ใบเสนอราคา' } });
    expect(q.notice!.alts[0].label).toBe('นับเป็นเงินรับขั้น PAY1');
    expect(plan(e, id, { at: 'quote' }, RCT(), q.notice!.alts[0].choice!)).toMatchObject({ mode: 'pay', stage: 'PAY1', amount: 60000 });
    const r = plan(e, id, { at: 'other' }, RCT());
    expect(r).toMatchObject({ mode: 'other', notice: { tag: 'เป็นใบเสร็จ' }, save: { target: 'none', stage: '', amount: 60000 } });
    expect(r.notice!.text).toBe('ไฟล์นี้เป็นใบเสร็จ 60,000 บาท (ยอดชำระหลังหัก ณ ที่จ่าย 3%) · ถ้าเป็นเงินที่ได้รับของงานนี้');
    // not won: a receipt at QUOTATION is evidence, with nothing to count it as
    const e2 = mk(), id2 = await job(e2, { qt: null, won: false });
    expect(plan(e2, id2, { at: 'quote' }, RCT()).notice!.alts).toEqual([]);
  });

  it('16. a joint quotation\'s company: always evidence, and it says where the money counts', async () => {
    const e = mk();
    const m = e.addDeal({ client: 'บริษัท สมาชิก จำกัด', year: '2569', section: 'Partner' });
    const { hid } = await e.createJoint({ title: 'CFP มจพ', payer: 'มหาวิทยาลัย', payerGid: null, year: '2569', section: 'Partner', resp: 'หมิว', service: ['CFP'], total: 120000, docNo: 'QT-J1', docDate: '2026-10-06', basis: 'total', detected: 120000, members: [{ deal: m.id, share: null, pct: null }] });
    for (const entry of [{ at: 'quote' }, { at: 'pay', stage: 'PAY1' }, { at: 'other' }] as AttachEntry[]) {
      const p = plan(e, m.id, entry, RCT());
      expect(p).toMatchObject({ mode: 'other', target: 'none', notice: { tag: 'ใบเสนอราคาร่วม' } });
      expect(p.notice!.alts).toEqual([{ label: 'เปิดใบเสนอราคาร่วม', open: hid }]);
      expect(p.links.type).toBe(false);
    }
  });
});

describe('nothing read, a number typed, a name that does not match, a change before saving', () => {
  it('17. no amount read: one question; a typed number is the user\'s (kept only against a figure the reader found)', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, null, {}, pdf('IMG_4821.jpg'));
    expect(p).toMatchObject({ scan: true, amount: null, primaryOff: true, primary: 'บันทึกรับเงิน', chip: { label: 'ตามแผนขั้นนี้ 60,000', value: 60000 }, left: { label: 'แนบไว้ก่อน ยังไม่นับยอด', act: 'save' } });
    const q = plan(e, id, { at: 'pay', stage: 'PAY1' }, null, { figure: 'manual', manual: 60000 }, pdf('IMG_4821.jpg'));
    expect(q).toMatchObject({ amount: 60000, primaryOff: false, primary: 'บันทึกรับเงิน 60,000 บาท', save: { basis: 'manual', detected: null, kept: false } });
    const r = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT(), { figure: 'manual', manual: 58000 });
    expect(r.save).toMatchObject({ amount: 58000, basis: 'manual', detected: 60000, kept: true });
    // "แนบไว้ก่อน": attached at the installment, nothing counted
    expect(plan(e, id, { at: 'pay', stage: 'PAY1' }, null, p.left!.choice!, pdf('IMG_4821.jpg')).save).toMatchObject({ amount: null, target: 'none', stage: 'PAY1' });
    // another figure of the document
    expect(plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT(), { figure: 'total' })).toMatchObject({ amount: 61730.77, basis: 'total', primary: 'บันทึกรับเงิน 61,730.77 บาท' });
  });

  it('18. the customer named in the document is another company: a tag, appended to another notice', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT({ party: 'บริษัท อื่น จำกัด' }));
    expect(p.notice).toMatchObject({ tone: 'warn', tag: 'ชื่อไม่ตรง' });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    const q = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT({ party: 'บริษัท อื่น จำกัด' }));
    expect(q.notice!.tag).toBe('ใบซ้ำ');
    expect(q.notice!.text).toContain('ชื่อลูกค้าในเอกสาร "บริษัท อื่น จำกัด" ไม่ตรงกับ');
  });

  it('19. worked out again at save time: another document counted meanwhile changes the sentence and the button', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    await e.attachDoc(id, pdf('BL-1.pdf'), { kind: 'invoice', amount: 60000, target: 'actual', basis: 'total', detected: 60000, docNo: 'BL-1', docDate: '2026-09-01', stage: 'PAY1' });
    const q = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(q.key).not.toBe(p.key);
    expect(q.notice!.tag).toBe('นับแทน');
  });

  it('an invoice after the receipt counted there is evidence (N4)', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, facts({ kind: 'invoice', docNo: 'BL-9', total: 61730.77, docDate: '2026-09-20' }), {}, pdf('BL-9.pdf'));
    expect(p).toMatchObject({ count: 'none', primary: 'แนบเป็นหลักฐาน', notice: { tag: 'เก็บเป็นหลักฐาน', text: 'ขั้น PAY1 มีใบเสร็จ INV2026090004 นับแล้ว · ใบแจ้งหนี้นี้เก็บไว้เป็นหลักฐาน ไม่นับยอด' } });
    expect(p.after).toBe('เก็บไว้ที่ขั้น PAY1 เป็นหลักฐาน · Actual ยังเป็น 60,000 บาท');
  });

  it('"เปลี่ยนประเภท": a tile per installment still to be received', async () => {
    const e = mk(), id = await job(e, { qt: null, forecast: 60000, plan: 2 });
    const p = plan(e, id, { at: 'quote' }, QT2);
    expect(p.tiles.map((t) => `${t.label}|${t.sub}|${t.on}`)).toEqual(['ใบเสนอราคา|เป็น Forecast|true', 'ใบเสร็จ / ใบแจ้งหนี้|เงินรับขั้น PAY1|false', 'ใบเสร็จ / ใบแจ้งหนี้|เงินรับขั้น PAY2|false', 'เอกสารอื่น|เก็บไว้ ไม่นับยอด|false']);
    expect(plan(e, id, { at: 'quote' }, RCT(), p.tiles[2].choice)).toMatchObject({ mode: 'pay', stage: 'PAY2' });
  });
});

describe('the figures, the panel drop', () => {
  it('lists the figures the proposed one first, and the withholding rate only at 1, 2, 3 or 5 %', () => {
    expect(figureRows(RC, 'netPay').map((x) => `${x.label} ${x.value}${x.proposed ? ' *' : ''}`)).toEqual([
      'ยอดชำระหลังหัก ณ ที่จ่าย 60000 *', 'ยอดรวมทั้งสิ้น (รวม VAT) 61730.77', 'ก่อน VAT 57692.33',
      ...figureRows(RC, 'netPay').slice(3).map((x) => `ตัวเลขอื่นในเอกสาร ${x.value}`),
    ]);
    expect(whtPct(RC)).toBe(3);
    expect(whtPct({ wht: 1500, subtotal: 100000, netPay: null, vat: null })).toBeNull();
    expect(figParts(facts({ total: 5000 }))).toEqual([]);
  });

  it('a file dropped on the panel goes to the current step', async () => {
    const e = mk(), id = await job(e, { plan: 2 });
    const d = deal(e, id);
    expect(panelEntry(e.sales, d, 'QUOTATION', TODAY)).toEqual({ at: 'quote' });
    expect(panelEntry(e.sales, d, 'PAY2', TODAY)).toEqual({ at: 'pay', stage: 'PAY2' });
    expect(panelEntry(e.sales, d, 'FOLLOW1', TODAY)).toEqual({ at: 'pay' });
    const id2 = await job(e, { won: false });
    expect(panelEntry(e.sales, deal(e, id2), 'FOLLOW1', TODAY)).toEqual({ at: 'quote' });
  });
});

describe('"รับเงินแล้ว (ไม่มีไฟล์)": one tap', () => {
  it('records the planned amount today; "เลิกทำ" takes it back', async () => {
    const e = mk(), id = await job(e, { plan: 2 });
    expect(recvPlan(e.sales, deal(e, id), 'PAY1', TODAY)).toMatchObject({ amount: null, shown: 30000, plan: false, ask: false, how: 'transfer' });
    const r = receiveNow(e, id, 'PAY1', TODAY)!;
    expect(r).toMatchObject({ stage: 'PAY1', amount: 30000, ready: false, madePlan: false });
    expect(e.sales.pays[`${id}/PAY1`]).toMatchObject({ rcv: TODAY, got: null });
    expect(actual(e, id)).toBe(30000);
    // received: not one tap again
    expect(recvPlan(e.sales, deal(e, id), 'PAY1', TODAY)).toBeNull();
    undoReceive(e, id, r);
    expect(actual(e, id)).toBeNull();
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines[0].status).not.toBe('paid');
  });

  it('a part received by hand is topped up to the plan; the last installment makes the job ready', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    e.markPaid(id, 'PAY1', { date: '2026-09-28', amount: 20000 });
    expect(recvPlan(e.sales, deal(e, id), 'PAY1', TODAY)).toMatchObject({ amount: 60000, shown: 40000 });
    expect(receiveNow(e, id, 'PAY1', TODAY)).toMatchObject({ amount: 40000, ready: true });
    expect(actual(e, id)).toBe(60000);
  });

  it('no plan: a one-installment plan of the Forecast in the same tap (undone with it); no Forecast: the amount is asked', async () => {
    const e = mk(), id = await job(e);
    expect(recvPlan(e.sales, deal(e, id), 'PAY1', TODAY)).toMatchObject({ plan: true, ask: false, shown: 60000 });
    const r = receiveNow(e, id, 'PAY1', TODAY)!;
    expect(r).toMatchObject({ stage: 'PAY1', amount: 60000, ready: true, madePlan: true });
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => [l.stage, l.amt, l.status])).toEqual([['PAY1', 60000, 'paid']]);
    undoReceive(e, id, r);
    expect(planOf(e.sales, deal(e, id), TODAY)).toBeNull();
    expect(actual(e, id)).toBeNull();
    const id2 = await job(e, { qt: null });
    expect(recvPlan(e.sales, deal(e, id2), 'PAY1', TODAY)).toMatchObject({ plan: true, ask: true });
    expect(receiveNow(e, id2, 'PAY1', TODAY)).toBeNull();
    expect(receiveNow(e, id2, 'PAY1', TODAY, 53500)).toMatchObject({ amount: 53500, madePlan: true });
    expect(actual(e, id2)).toBe(53500);
  });

  it('the pay guard still asks first when the month the money lands in is closed', async () => {
    const e = mk(), id = await job(e, { plan: 1 });
    const d = deal(e, id), r = recvPlan(e.sales, d, 'PAY1', TODAY)!;
    const after = previewOf.pay(e.sales, id, 'PAY1', { rcv: TODAY, got: r.amount, full: false });
    const rows = (s: typeof e.sales) => dealChecks(s, s.deals[id], {}, '2026-01-01', TODAY);
    const closed: Record<string, MonthClose> = { '2026-10': { by: 'ฝน', at: '2026-10-19T00:00:00.000Z', n: 1, amt: 0 } };
    expect(guardHits(rows(e.sales), closed, { after: rows(after) }).length).toBeGreaterThan(0);
    expect(guardHits(rows(e.sales), {}, { after: rows(after) })).toEqual([]);
  });
});
