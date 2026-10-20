/**
 * The five steps (lib/steps: CONTACT · QUOTATION · FOLLOW · CLOSE · PAY per plan) and the one-screen attach
 * (lib/attachPlan) together, through the engine: what the attach dialog proposes and says at each entry, what
 * saving it does to the steps, the money and closing. The sample receipt: __fixtures__/INV2026090004.txt (รวม
 * 61,730.77, หัก ณ ที่จ่าย 3% 1,730.77, ยอดชำระ 60,000) — the owner's 121,730.77 job.
 *
 * - a deal kept the eight-stage way (CALL1, CALL2, FOLLOW1, FOLLOW2, PAY1, PAY2 records; the receipt counted at
 *   PAY1 and again at PAY2) reads as the five steps, says "นับซ้ำ", and one more attach counts it once: 60,000;
 * - a deal without a plan has ONE PAY step: the quotation is the Forecast, the receipt at PAY the Actual, and the
 *   job is ready to close with nothing more to receive (no second PAY step left over);
 * - a plan of three is PAY1 · PAY2 · PAY3; a plan of one is a single PAY.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeDocText, type DocFacts } from './docExtract';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import {
  attachStage, closeReady, dealMoney, dealSteps, docsOf, dupCounted, payState, planOf, stepCode, stepOf,
  type Deal,
} from './sales';
import { acFig, fcFig } from './salesUi';
import { teamSteps } from './steps';
import { attachPlan, panelEntry, receiveNow, recvPlan, recvToast, type AttachChoice, type AttachEntry } from './attachPlan';
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
const pdf = (name: string, body = '%PDF-1.4 ' + name) => Object.assign(new Blob([body], { type: 'application/pdf' }), { name });
const facts = (o: Partial<DocFacts>): DocFacts => ({ kind: 'receipt', docNo: '', docDate: '', total: null, subtotal: null, vat: null, wht: null, netPay: null, words: null, party: '', candidates: [], confidence: 'high', ...o });
/** the sample's figures as a quotation (QT2026080001, 20 ส.ค.): ยอดชำระ 60,000 after 3% */
const QT = () => ({ ...RC, kind: 'quotation' as const, docNo: 'QT2026080001', docDate: '2026-08-20', copies: undefined, refs: undefined, party: '' });
const RCT = () => ({ ...RC, party: '' });
/** the file the sample receipt is (its name and size: the same file found again) */
const RFILE = pdf('INV2026090004.pdf');
const QFILE = pdf('QT2026080001.pdf');
const deal = (e: GccEngine, id: string): Deal => e.sales.deals[id];
const plan = (e: GccEngine, id: string, entry: AttachEntry, f: DocFacts | null, choice: AttachChoice = {}, file = RFILE) =>
  attachPlan(e.sales, deal(e, id), entry, { facts: f, name: file.name, size: file.size }, choice, TODAY);
/** What the dialog's button does with the plan (components/DocAttach save). */
async function save(e: GccEngine, id: string, entry: AttachEntry, f: DocFacts | null, choice: AttachChoice = {}, file = RFILE) {
  const p = plan(e, id, entry, f, choice, file);
  if (!p.noSave) await e.attachDoc(id, file, p.save!);
  if (p.full && p.fullStage) e.setPayFull(id, p.fullStage, true);
  return p;
}
const actual = (e: GccEngine, id: string) => dealMoney(e.sales, deal(e, id)).actual;
const steps = (e: GccEngine, id: string) => dealSteps(e.sales, deal(e, id), TODAY);
/** the steps as they show: "CODE th" */
const shown = (e: GccEngine, id: string) => steps(e, id).steps.map((v) => (v.th ? `${v.code} ${v.th}` : v.code));
const pays = (e: GccEngine, id: string) => steps(e, id).steps.filter((v) => v.kind === 'pay');
const ready = (e: GccEngine, id: string) => closeReady(e.sales, deal(e, id), TODAY);
let n = 0;
const newDeal = (e: GccEngine) => e.addDeal({ client: `บริษัท ห้าขั้น ${++n} จำกัด`, section: 'Partner', resp: 'หมิว', year: '2569' } as Partial<Deal>).id;
const FIVE = ['CONTACT ติดต่อประสานงาน', 'QUOTATION ส่งใบเสนอราคา', 'FOLLOW ติดตามผล', 'CLOSE ผลการขาย (YES / NO)'];

describe('a deal kept the eight-stage way, the receipt counted twice (the owner\'s 121,730.77)', () => {
  /** What the eight-stage tracker stored: calls at CALL1 / CALL2, follow-ups at FOLLOW1 / FOLLOW2, the quotation,
   *  YES, then the receipt at PAY1 (its total) and the same receipt at PAY2 (the amount paid), no plan. */
  async function oldStyle(e: GccEngine) {
    const id = newDeal(e);
    e.setStep(id, 'CALL1', { d: '2026-08-01', n: 'โทรแนะนำบริการ' });
    e.setStep(id, 'CALL2', { d: '2026-08-08', n: 'นัดคุยรายละเอียด' });
    await e.attachDoc(id, QFILE, { kind: 'quotation', amount: 60000, target: 'forecast', basis: 'netPay', detected: 60000, docNo: 'QT2026080001', docDate: '2026-08-20', stage: 'QUOTATION' });
    e.setStep(id, 'FOLLOW1', { d: '2026-08-15', n: 'ส่งอีเมลติดตาม' });
    e.setStep(id, 'FOLLOW2', { d: '2026-08-22', n: 'ลูกค้าขออนุมัติภายใน' });
    e.setStep(id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    await e.attachDoc(id, RFILE, { kind: 'receipt', amount: 61730.77, target: 'actual', basis: 'total', detected: 61730.77, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY1' });
    await e.attachDoc(id, RFILE, { kind: 'receipt', amount: 60000, target: 'actual', basis: 'netPay', detected: 60000, docNo: 'INV2026090004', docDate: '2026-09-28', stage: 'PAY2' });
    return id;
  }

  it('reads as the five steps (the older records inside CONTACT and FOLLOW), and says "นับซ้ำ"', async () => {
    const e = mk(), id = await oldStyle(e);
    expect(teamSteps(e.sales.cfg).map((x) => x.code)).toEqual(['CONTACT', 'QUOTATION', 'FOLLOW', 'CLOSE', 'PAY']);
    const t = steps(e, id);
    // PAY2 holds money: it reads as the rest of a payment without a plan, never "งวดที่ 2" of a plan the deal has not
    expect(shown(e, id)).toEqual([...FIVE, 'PAY ชำระเงิน', 'PAY ส่วนที่เหลือ']);
    expect(t.steps.map((v) => v.state)).toEqual(['done', 'done', 'done', 'yes', 'done', 'done']);
    expect(t.steps[0].entries.map((x) => `${x.kind}:${x.stage}`)).toEqual(['old:CALL2', 'old:CALL1']);
    expect(t.steps[2].entries.map((x) => `${x.kind}:${x.stage}`)).toEqual(['old:FOLLOW2', 'old:FOLLOW1']);
    // nothing stored was rewritten: the older stages keep their records, no CONTACT / FOLLOW record was made
    expect(stepOf(e.sales, id, 'CALL1').n).toBe('โทรแนะนำบริการ');
    expect(stepOf(e.sales, id, 'CONTACT')).toEqual({ d: '', n: '' });
    expect(actual(e, id)).toBe(121730.77);
    expect(dupCounted(e.sales, deal(e, id))).toHaveLength(1);
    const v = acFig(e.sales, deal(e, id));
    expect(v).toMatchObject({ kind: 'warn', word: 'นับซ้ำ' });
    expect(v.title).toContain('INV2026090004 นับยอดซ้ำ 2 ครั้ง (PAY 61,730.77 · PAY ส่วนที่เหลือ 60,000 บาท)');
  });

  const entries: [string, (e: GccEngine, id: string) => AttachEntry][] = [
    // the row menu's "แนบใบเสร็จ …" names the step the app picks: the last PAY step, the rest of the payment
    ['the row menu (PAY ส่วนที่เหลือ)', (e, id) => ({ at: 'pay', stage: attachStage(e.sales, deal(e, id), { kind: 'receipt', target: 'actual' }, TODAY) })],
    ['the PAY card', () => ({ at: 'pay', stage: 'PAY1' })],
    ['a file dropped on the panel', (e, id) => panelEntry(e.sales, deal(e, id), steps(e, id).next?.id || '', TODAY)],
  ];
  for (const [where, entry] of entries)
    it(`one attach more from ${where} counts it once at PAY: 60,000, ready to close, no second PAY step`, async () => {
      const e = mk(), id = await oldStyle(e);
      const before = docsOf(e.sales, id).length;
      const p = plan(e, id, entry(e, id), RCT());
      expect(p).toMatchObject({ mode: 'pay', amount: 60000, count: 'replace', notice: { tag: 'ใบซ้ำ' }, title: 'ใบเสร็จ · ขั้น PAY ชำระเงิน', primary: 'บันทึกรับเงิน 60,000 บาท' });
      expect(p.notice!.text).toBe('ใบเสร็จ INV2026090004 นับซ้ำอยู่ 2 ครั้ง (ขั้น PAY 61,730.77 · ขั้น PAY ส่วนที่เหลือ 60,000 บาท) · บันทึกครั้งนี้นับครั้งเดียวที่ขั้น PAY ไม่นับซ้ำ');
      expect(p.save).toMatchObject({ stage: 'PAY1', amount: 60000, target: 'actual' });
      // nothing is said to turn unpaid: the rest of the payment is not owed once the money makes up the Forecast
      expect(p.after).toBe('Actual จาก 121,730.77 เป็น 60,000 บาท · งานนี้พร้อมปิดงาน');
      await save(e, id, entry(e, id), RCT());
      expect(actual(e, id)).toBe(60000);
      expect(dupCounted(e.sales, deal(e, id))).toEqual([]);
      expect(acFig(e.sales, deal(e, id))).toMatchObject({ kind: 'ok', word: 'จากเอกสาร' });
      expect(shown(e, id)).toEqual([...FIVE, 'PAY ชำระเงิน']);
      expect(payState(e.sales, deal(e, id), TODAY)).toMatchObject({ pays: ['PAY1'], paid: ['PAY1'], left: [] });
      expect(ready(e, id)).toBe(true);
      // every document stays (the copies as evidence), the older stages too
      expect(docsOf(e.sales, id)).toHaveLength(before + 1);
      expect(docsOf(e.sales, id).filter((x) => x.kind === 'receipt').map((x) => `${x.stage}:${x.target}:${x.amount}`)).toEqual(['PAY1:none:61730.77', 'PAY2:none:60000', 'PAY1:actual:60000']);
      expect(stepOf(e.sales, id, 'FOLLOW2').n).toBe('ลูกค้าขออนุมัติภายใน');
    });
});

describe('a deal without a plan: one PAY step', () => {
  async function quoted(e: GccEngine) {
    const id = newDeal(e);
    e.setStep(id, 'CONTACT', { d: '2026-08-01', n: 'โทรแนะนำบริการ' });
    const q = await save(e, id, { at: 'quote' }, QT(), {}, QFILE);
    expect(q).toMatchObject({ title: 'ใบเสนอราคา · ขั้น QUOTATION', primary: 'บันทึก Forecast 60,000 บาท', after: 'Forecast เป็น 60,000 บาท · ขั้น QUOTATION ทำแล้ว 20 ส.ค. 2569' });
    return id;
  }

  it('the quotation is the Forecast; won, the receipt at PAY is the Actual 60,000 and the job is ready to close', async () => {
    const e = mk(), id = await quoted(e);
    expect(dealMoney(e.sales, deal(e, id)).forecast).toBe(60000);
    expect(fcFig(e.sales, deal(e, id))).toMatchObject({ kind: 'ok', docNo: 'QT2026080001' });
    // before the result: one PAY step, after the win
    expect(shown(e, id)).toEqual([...FIVE, 'PAY ชำระเงิน']);
    e.setStep(id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    expect(pays(e, id).map((v) => `${v.id}:${v.code}:${v.state}`)).toEqual(['PAY1:PAY:next']);
    expect(steps(e, id).next?.code).toBe('PAY');
    expect(panelEntry(e.sales, deal(e, id), steps(e, id).next!.id, TODAY)).toEqual({ at: 'pay', stage: 'PAY1', loose: true });
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p).toMatchObject({ title: 'ใบเสร็จ · ขั้น PAY ชำระเงิน', amount: 60000, notice: null, count: 'add', primary: 'บันทึกรับเงิน 60,000 บาท' });
    expect(p.after).toBe('Actual เป็น 60,000 บาท · ครบตาม Forecast · งานนี้พร้อมปิดงาน');
    expect(p.tiles.map((x) => x.sub)).toEqual(['เป็น Forecast', 'เงินรับขั้น PAY', 'เก็บไว้ ไม่นับยอด']);
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(actual(e, id)).toBe(60000);
    expect(ready(e, id)).toBe(true);
    // no second PAY step: nothing more to receive
    expect(shown(e, id)).toEqual([...FIVE, 'PAY ชำระเงิน']);
    expect(payState(e.sales, deal(e, id), TODAY).left).toEqual([]);
    // (FOLLOW was never recorded: skipped, as the steps say of a step left empty before a later one)
    expect(steps(e, id)).toMatchObject({ done: 4, total: 5, next: null });
    expect(steps(e, id).steps[2].state).toBe('skipped');
    // the same receipt again, from the Actual figure: nothing stored, still ready
    const again = plan(e, id, { at: 'pay' }, RCT());
    expect(again).toMatchObject({ noSave: true, count: 'nosave', primary: 'ตกลง ไม่นับซ้ำ' });
    expect(again.notice!.text).toBe('ใบเสร็จ INV2026090004 นับไปแล้วที่ขั้น PAY 60,000 บาท (แนบ 20 ต.ค. 2569) · ระบบจะไม่นับซ้ำ');
  });

  it('from the Actual figure (no step chosen) the receipt goes to the single PAY step', async () => {
    const e = mk(), id = await quoted(e);
    e.setStep(id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    const p = await save(e, id, { at: 'pay' }, RCT());
    expect(p.save).toMatchObject({ stage: 'PAY1' });
    expect(actual(e, id)).toBe(60000);
    expect(ready(e, id)).toBe(true);
  });

  it('"รับเงินแล้ว (ไม่มีไฟล์)" at PAY in one tap: a plan of one, still one PAY step, ready; its receipt later counts in its place', async () => {
    const e = mk(), id = await quoted(e);
    e.setStep(id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    expect(recvPlan(e.sales, deal(e, id), 'PAY1', TODAY)).toMatchObject({ plan: true, shown: 60000, ask: false, over: null });
    const x = receiveNow(e, id, 'PAY1', TODAY)!;
    expect(x).toMatchObject({ stage: 'PAY1', amount: 60000, ready: true, madePlan: true });
    expect(recvToast(e.sales, deal(e, id), x.stage, x.amount)).toBe('บันทึกรับเงิน PAY แล้ว 60,000 บาท · วันนี้ · ยังไม่มีใบเสร็จ');
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => `${l.stage}:${l.code}:${l.status}`)).toEqual(['PAY1:PAY:paid']);
    expect(shown(e, id)).toEqual([...FIVE, 'PAY ชำระเงิน']);
    expect(actual(e, id)).toBe(60000);
    const p = await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p).toMatchObject({ count: 'replace', notice: { tag: 'ใบเสร็จของเงินก้อนนี้' } });
    expect(actual(e, id)).toBe(60000);
    expect(ready(e, id)).toBe(true);
  });

  it('paid less than the Forecast: "PAY ส่วนที่เหลือ" is owed; the same receipt there is not counted again, and a note there closes it', async () => {
    const e = mk(), id = newDeal(e);
    await e.attachDoc(id, QFILE, { kind: 'quotation', amount: 80000, target: 'forecast', basis: 'manual', detected: 80000, docNo: 'QT2026080009', docDate: '2026-08-20', stage: 'QUOTATION' });
    e.setStep(id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(actual(e, id)).toBe(60000);
    expect(pays(e, id).map((v) => `${v.id}:${v.code} ${v.th}:${v.state}:${v.short ?? ''}`)).toEqual(['PAY1:PAY ชำระเงิน:done:', 'PAY2:PAY ส่วนที่เหลือ:next:20000']);
    expect(ready(e, id)).toBe(false);
    expect(stepCode(e.sales, deal(e, id), 'PAY2', TODAY)).toBe('PAY ส่วนที่เหลือ');
    const p = plan(e, id, { at: 'pay', stage: 'PAY2' }, RCT());
    expect(p).toMatchObject({ noSave: true, title: 'ใบเสร็จ · ขั้น PAY ส่วนที่เหลือ' });
    expect(p.notice!.text).toBe('ใบเสร็จ INV2026090004 นับไปแล้วที่ขั้น PAY 60,000 บาท (แนบ 20 ต.ค. 2569) · ระบบจะไม่นับซ้ำ · ถ้าตกลงลดยอดแล้ว พิมพ์โน้ตที่ขั้น PAY ส่วนที่เหลือ แล้วปิดงานได้');
    // what the hint says works: the note completes the rest, the job is ready
    e.setStep(id, 'PAY2', { d: '2026-10-20', n: 'ตกลงลดยอดเหลือ 60,000' });
    expect(ready(e, id)).toBe(true);
    expect(actual(e, id)).toBe(60000);
  });
});

describe('a payment plan: one PAY step per installment', () => {
  async function planned(e: GccEngine, n: number, amount: number) {
    const id = newDeal(e);
    await e.attachDoc(id, QFILE, { kind: 'quotation', amount, target: 'forecast', basis: 'manual', detected: amount, docNo: 'QT2026080010', docDate: '2026-08-20', stage: 'QUOTATION' });
    e.setStep(id, 'CLOSED DEAL', { d: '2026-08-25', n: 'YES' });
    e.quickPlan(id, n);
    return id;
  }
  const rc = (no: string, amount: number, date: string) => facts({ docNo: no, docDate: date, total: amount });

  it('three installments: PAY1 · PAY2 · PAY3, each takes its receipt; the last one received makes the job ready', async () => {
    const e = mk(), id = await planned(e, 3, 120000);
    expect(shown(e, id)).toEqual([...FIVE, 'PAY1 ชำระงวดที่ 1', 'PAY2 ชำระงวดที่ 2', 'PAY3 ชำระงวดที่ 3']);
    expect(steps(e, id).total).toBe(7);
    // the plan row's "แนบใบเสร็จ" at PAY2
    const p2 = plan(e, id, { at: 'pay', stage: 'PAY2' }, rc('RC-2', 40000, '2026-10-01'), {}, pdf('RC-2.pdf'));
    expect(p2).toMatchObject({ title: 'ใบเสร็จ · ขั้น PAY2 ชำระงวดที่ 2', notice: null, primary: 'บันทึกรับเงิน 40,000 บาท' });
    expect(p2.after).toBe('ขั้น PAY2 ครบตามแผน 40,000 บาท · เหลืออีก 2 งวด 80,000 บาท');
    await save(e, id, { at: 'pay', stage: 'PAY2' }, rc('RC-2', 40000, '2026-10-01'), {}, pdf('RC-2.pdf'));
    // the Actual figure's "แนบเอกสาร": the first installment not received
    const p1 = await save(e, id, { at: 'pay' }, rc('RC-1', 40000, '2026-10-05'), {}, pdf('RC-1.pdf'));
    expect(p1.save).toMatchObject({ stage: 'PAY1' });
    // (PAY3 is due on a later day: planned, and the next step)
    expect(pays(e, id).map((v) => `${v.code}:${v.state}`)).toEqual(['PAY1:done', 'PAY2:done', 'PAY3:planned']);
    expect(steps(e, id).next?.code).toBe('PAY3');
    expect(ready(e, id)).toBe(false);
    // the last one in one tap, no file
    const x = receiveNow(e, id, 'PAY3', TODAY)!;
    expect(x).toMatchObject({ stage: 'PAY3', amount: 40000, ready: true, madePlan: false });
    expect(recvToast(e.sales, deal(e, id), x.stage, x.amount)).toBe('บันทึกรับเงิน PAY3 แล้ว 40,000 บาท · วันนี้ · ยังไม่มีใบเสร็จ');
    expect(actual(e, id)).toBe(120000);
    expect(ready(e, id)).toBe(true);
    // (CONTACT and FOLLOW were never recorded on this deal: skipped; every PAY step is done)
    expect(steps(e, id)).toMatchObject({ done: 5, total: 7, next: null });
  });

  it('one installment: a single PAY step; the sample receipt short by withholding tax only is received in full', async () => {
    const e = mk(), id = await planned(e, 1, 61730.77);
    expect(shown(e, id)).toEqual([...FIVE, 'PAY ชำระเงิน']);
    expect(planOf(e.sales, deal(e, id), TODAY)!.lines.map((l) => `${l.stage}:${l.code}:${l.amt}`)).toEqual(['PAY1:PAY:61730.77']);
    const p = plan(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(p).toMatchObject({ title: 'ใบเสร็จ · ขั้น PAY ชำระเงิน', amount: 60000, full: true, fullStage: 'PAY1' });
    expect(p.after).toBe('ขั้น PAY ถือว่ารับครบ เพราะส่วนที่ขาด 1,730.77 คือหัก ณ ที่จ่าย 3% · งานนี้พร้อมปิดงาน');
    await save(e, id, { at: 'pay', stage: 'PAY1' }, RCT());
    expect(actual(e, id)).toBe(60000);
    expect(pays(e, id).map((v) => `${v.code}:${v.state}`)).toEqual(['PAY:done']);
    expect(ready(e, id)).toBe(true);
  });
});
