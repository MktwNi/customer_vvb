/**
 * Job expenses together (step B of ค่าใช้จ่ายของงาน): the deal card (lib/expenseJob.ts) and the money views
 * (lib/expenseMoney.ts: Cashflow's money out, the Dashboard's card, the month check's out side), built apart,
 * meet on one fixture made through the engine as the screens make it:
 *
 * - the owner's job: 100,000 received in August; ผู้รับเหมา 30,000 paid in September and ค่าเดินทาง 5,000 not
 *   paid yet (two categories, one unpaid), followed by คุณบี alone;
 * - a joint quotation of 200,000 (the payer's row followed by ต้น) for two companies, หมิว's at 60% and มกร's at
 *   40%, received in full in July; ค่าแล็บ 20,000 recorded on the quotation itself (paid in July) and
 *   ค่าเดินทาง 3,000 on หมิว's company (paid in August);
 * - accounting (ฝน, who recorded none of it) checked July's money out and the ผู้รับเหมา bill, and closed July's
 *   out side.
 *
 * For the same job and period the card's เงินเข้า / คงเหลือ equal Cashflow's and the Dashboard's (คงเหลือ =
 * received − paid; a bill not paid yet is said apart), a joint quotation counts each expense once (its
 * companies' cards add up to its own), and the card shows and guards accounting's check.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { cashKpis, cashYear, filterDeals, jointAttr, jointCashLines, normSalesFilter, type PlanInput, type SalesFilterIn } from './sales';
import { viewCashLines } from './joint';
import { headPartExps, jobSum } from './expenseJob';
import {
  dealExpChecks, expCheckRows, expChkRows, expGoneCheckWords, expGuard, expKpis, expLines, expNoteOf, expPageKeep, expSheets, expTeamMonth, expView, expYear, netQuarters, netSplit,
} from './expenseMoney';
import { canClose, chipOf, yearCheck } from './payCheck';
import { CAPS } from './caps';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-12';
const Y69 = '2569';

let base: Dataset, R: RoundRaw[];
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 200);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => vi.useRealTimers());

/** One browser on its own (no team: every capability), signed as `who` (changeable). */
function mk(who: { name: string }) {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = TODAY;
  e.store = memoryStore();
  (e as unknown as { me: () => string }).me = () => who.name;
  e.rebuild();
  e.loading = false;
  return e;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const line = (stage: string, amt: number, due: string): PlanInput => ({ stage, amt, pct: null, due, rel: null, how: 'transfer', howT: '', note: '' });
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);

async function fixture() {
  const who = { name: 'หมิว' };
  const e = mk(who);
  // the owner's job (คุณบี's): 100,000 received in August
  const p = e.addDeal({ client: 'สยามคาร์บอน ทดสอบค่าใช้จ่าย', section: 'TGO', year: Y69, resp: 'คุณบี', forecast: 100000 });
  e.setStep(p.id, 'CLOSED DEAL', { d: '2026-07-01', n: 'YES' });
  e.setPlan(p.id, [line('PAY1', 100000, '2026-08-20')]);
  e.markPaid(p.id, 'PAY1', { date: '2026-08-20', amount: 100000 });
  // its expenses, recorded by คุณบี in the dialog: two categories, one not paid yet
  who.name = 'คุณบี';
  const con = e.addExpense(p.id, { c: 'ผู้รับเหมา', n: 'ทีมตรวจวัดที่โรงงาน', amt: 30000, d: '2026-09-01', paid: '2026-09-05' })!;
  const trip = e.addExpense(p.id, { c: 'ค่าเดินทาง', amt: 5000, d: '2026-10-01' })!;
  expect(con && trip).toBeTruthy();
  later();
  // the joint quotation: 200,000 for หมิว's company (60%) and มกร's (40%), paid in full in July
  who.name = 'หมิว';
  const m1 = e.addDeal({ client: 'บางกอกสตีล ทดสอบค่าใช้จ่าย', section: 'Event Exhibition', year: Y69, resp: 'หมิว' });
  const m2 = e.addDeal({ client: 'โคราช ซีเมนต์ ทดสอบค่าใช้จ่าย', section: 'Event Exhibition', year: Y69, resp: 'มกร' });
  const { hid, attachErr } = await e.createJoint({
    title: 'CFP ร่วม ทดสอบค่าใช้จ่าย', payer: 'สมาคมทดสอบ', payerGid: null, year: Y69, section: 'Event Exhibition', resp: 'ต้น', service: ['CFP'],
    total: 200000, docNo: 'QT-2569-200', docDate: '2026-06-01', basis: 'total', detected: 200000, file: pdf('QT-2569-200.pdf'),
    members: [{ deal: m1.id, share: null, pct: 60 }, { deal: m2.id, share: null, pct: 40 }],
  });
  expect(attachErr).toBe('');
  [hid, m1.id, m2.id].forEach((id) => e.setStep(id, 'CLOSED DEAL', { d: '2026-06-15', n: 'YES' }));
  e.setPlan(hid, [line('PAY1', 200000, '2026-07-10')]);
  e.markPaid(hid, 'PAY1', { date: '2026-07-10', amount: 200000 });
  // expenses on the quotation itself (its header) and on หมิว's company
  const lab = e.addExpense(hid, { c: 'ค่าแล็บ', amt: 20000, d: '2026-07-18', paid: '2026-07-20' })!;
  const mTrip = e.addExpense(m1.id, { c: 'ค่าเดินทาง', amt: 3000, d: '2026-08-01', paid: '2026-08-02' })!;
  later();
  // accounting (ฝน) checks July's money out and the ผู้รับเหมา bill, and closes July's out side
  who.name = 'ฝน';
  const since = e.payChkCfg().since;
  const rows = () => expChkRows(e.sales, expLines(e.sales), e.expChecks(), since);
  const pick = rows().filter((r) => r.kind === 'got' && (r.ym === '2026-07' || r.key === `${p.id}/${con.id}`));
  expect(e.checkExps(pick).sort()).toEqual([`${hid}/${lab.id}`, `${p.id}/${con.id}`].sort());
  expect(e.closeMonthOut('2026-07')).toMatchObject({ by: 'ฝน', n: 1, amt: 20000 });
  // August is not closed: หมิว's company's 3,000 waits
  expect(e.closeMonthOut('2026-08')).toBeNull();
  who.name = 'หมิว';
  const S = e.sales, D = (id: string) => S.deals[id];
  return { e, who, S, p: D(p.id), h: D(hid), m1: D(m1.id), m2: D(m2.id), ids: { con: con.id, trip: trip.id, lab: lab.id, mTrip: mTrip.id }, rows };
}
type Fx = Awaited<ReturnType<typeof fixture>>;
let fx: Fx;
beforeAll(async () => {
  fx = await fixture();
});

/** The Cashflow tab of the year under a filter (SalesCash CashView): the received money, the money out. */
function cashflow(S: Fx['S'], f: Partial<SalesFilterIn>) {
  const F = normSalesFilter({ year: Y69, ...f, money: 'cash' });
  const lines = viewCashLines(S, F, TODAY, filterDeals(S, F, TODAY));
  const K = cashKpis(cashYear(lines, Y69), Y69, TODAY);
  const X = expYear(expView(S, F, TODAY, expLines(S)), Y69);
  return { K, X, XK: expKpis(X, K.got) };
}
/** The Dashboard's card "ค่าใช้จ่ายและคงเหลือ" of the year under a filter (SalesDash, components/ExpDash). */
function dashboard(S: Fx['S'], f: Partial<SalesFilterIn>) {
  const F = normSalesFilter({ year: Y69, ...f });
  const moneyDeals = filterDeals(S, { ...F, date: null, pay: undefined, money: 'cash' }, TODAY);
  const Y = cashYear(jointCashLines(S, moneyDeals, TODAY, jointAttr(F)), Y69);
  const X = expYear(expView(S, { ...F, date: null, pay: undefined }, TODAY), Y69);
  return netQuarters(Y, X);
}
const resp = (...v: string[]) => ({ resp: { v } });

describe('the owner\'s job: the card, Cashflow and the Dashboard say the same', () => {
  it('"เงินเข้า 100,000 · จ่ายแล้ว 30,000 · คงเหลือ 70,000 (70%)" and the 5,000 not paid yet apart', () => {
    const { S, p } = fx;
    const j = jobSum(S, p, TODAY);
    expect([j.inc, j.t.out, j.t.paid, j.t.unpaid, j.t.n, j.t.nUnpaid]).toEqual([100000, 35000, 30000, 5000, 2, 1]);
    expect([j.left, j.pct, j.after, j.afterPct]).toEqual([70000, 70, 65000, 65]);
    // the bar's figures are Cashflow's card's (one rounded figure)
    expect(netSplit(j.inc, j.t.paid)).toMatchObject({ ex: 30, left: 70 });
    // Cashflow under คุณบี (this job alone): รับแล้ว, จ่ายแล้ว, ค้างจ่าย, คงเหลือสุทธิ and its %
    const c = cashflow(S, resp('คุณบี'));
    expect([c.K.got, c.XK.paid, c.XK.unpaid, c.XK.net, c.XK.pct]).toEqual([j.inc, j.t.paid, j.t.unpaid, j.left, j.pct]);
    // the Dashboard's year row: รับแล้ว, ค่าใช้จ่าย (paid), คงเหลือ and its %, ค้างจ่าย apart
    const y = dashboard(S, resp('คุณบี')).year;
    expect([y.got, y.paid, y.unpaid, y.net, y.pct]).toEqual([j.inc, j.t.paid, j.t.unpaid, j.left, j.pct]);
    // expenses count in the period they were paid: September for the 30,000; the bill not paid yet in no paid total
    const q = dashboard(S, resp('คุณบี')).q;
    expect(q.map((x) => [x.got, x.paid, x.unpaid])).toEqual([[0, 0, 0], [0, 0, 0], [100000, 30000, 0], [0, 0, 5000]]);
    // by category (two, typed freely)
    expect(c.X.lines.map((x) => [x.c, x.kind])).toEqual([['ผู้รับเหมา', 'paid'], ['ค่าเดินทาง', 'unpaid']]);
  });
});

describe('the joint quotation: expenses on the header and on a company, each counted once', () => {
  it('the header\'s card holds the whole quotation; its companies\' cards add up to it', () => {
    const { S, h, m1, m2 } = fx;
    const H = jobSum(S, h, TODAY), A = jobSum(S, m1, TODAY), B = jobSum(S, m2, TODAY);
    expect([H.inc, H.t.out, H.t.paid, H.left, H.pct]).toEqual([200000, 23000, 23000, 177000, 89]);
    expect(H.own.out).toBe(20000);
    expect(H.members.map((x) => [x.deal.id, x.t.out])).toEqual([[m1.id, 3000]]);
    // หมิว's company: 60% of the money and of the quotation's ค่าแล็บ, and its own ค่าเดินทาง
    expect(headPartExps(S, m1)?.list.map((x) => [x.c, x.part])).toEqual([['ค่าแล็บ', 12000]]);
    expect([A.inc, A.t.out, A.left, A.pct]).toEqual([120000, 15000, 105000, 88]);
    expect([B.inc, B.t.out, B.left, B.pct]).toEqual([80000, 8000, 72000, 90]);
    expect(A.inc + B.inc).toBe(H.inc);
    expect(A.t.out + B.t.out).toBe(H.t.out);
    expect(A.left + B.left).toBe(H.left);
  });
  it('under each company\'s person, Cashflow and the Dashboard equal that company\'s card; both persons, the header\'s', () => {
    const { S, h, m1, m2 } = fx;
    for (const [who, d] of [['หมิว', m1], ['มกร', m2]] as const) {
      const j = jobSum(S, d, TODAY), c = cashflow(S, resp(who)), y = dashboard(S, resp(who)).year;
      expect([c.K.got, c.XK.paid, c.XK.net, c.XK.pct], who).toEqual([j.inc, j.t.paid, j.left, j.pct]);
      expect([y.got, y.paid, y.net, y.pct], who).toEqual([j.inc, j.t.paid, j.left, j.pct]);
    }
    const H = jobSum(S, h, TODAY), c = cashflow(S, resp('หมิว', 'มกร'));
    expect([c.K.got, c.XK.paid, c.XK.net]).toEqual([H.inc, H.t.paid, H.left]);
    // the payer's own person (ต้น) holds none of it once the quotation has companies
    expect(cashflow(S, resp('ต้น')).XK).toMatchObject({ got: 0, paid: 0 });
  });
  it('no filter: every expense once (the owner\'s job and the joint quotation)', () => {
    const { S, p, h } = fx;
    const c = cashflow(S, {});
    const P = jobSum(S, p, TODAY), H = jobSum(S, h, TODAY);
    expect([c.K.got, c.XK.paid, c.XK.unpaid]).toEqual([P.inc + H.inc, P.t.paid + H.t.paid, P.t.unpaid + H.t.unpaid]);
    expect(c.XK.net).toBe(P.left + H.left);
    expect(dashboard(S, {}).year.net).toBe(P.left + H.left);
  });
});

describe('the month check of money out, on the out side and on the card', () => {
  it('the checked lines, the closed July, and what waits', () => {
    const { e, S, p, h, m1, ids, rows } = fx;
    const { rows: yr, team } = expCheckRows(rows(), 2026, null);
    const months = yearCheck(yr, 2026, e.monthClosesOut(), TODAY, team).months;
    const jul = months.find((m) => m.ym === '2026-07')!, aug = months.find((m) => m.ym === '2026-08')!;
    expect(jul.state).toBe('closed');
    expect(jul.close).toMatchObject({ by: 'ฝน', n: 1, amt: 20000 });
    expect(aug.state).not.toBe('closed');
    expect(canClose(expTeamMonth(S, e.expChecks(), e.payChkCfg().since, '2026-08'), '2026-08', TODAY)).toBe(false);
    // the card's chips: ตรวจแล้ว on the ผู้รับเหมา bill and the quotation's ค่าแล็บ, รอตรวจ on the company's trip
    const chip = (dealId: string, expId: string) => chipOf(dealExpChecks(S, dealId, e.expChecks(), e.payChkCfg().since).find((r) => r.lineId === 'exp.' + expId)!)?.word;
    expect([chip(p.id, ids.con), chip(h.id, ids.lab), chip(m1.id, ids.mTrip)]).toEqual(['ตรวจแล้ว', 'ตรวจแล้ว', 'รอตรวจ']);
    // the bill not paid yet has no check
    expect(dealExpChecks(S, p.id, e.expChecks(), e.payChkCfg().since).some((r) => r.lineId === 'exp.' + ids.trip)).toBe(false);
    // the Excel file's out sheet says so, July's summary row says closed
    const sh = expSheets(yr, months, true, () => '');
    const out = sh[0].rows.map((r) => [r[3], r[11]]);
    expect(out).toContainEqual(['ผู้รับเหมา', 'ตรวจแล้ว']);
    expect(out).toContainEqual(['ค่าแล็บ', 'ตรวจแล้ว']);
    expect(sh[1].rows.find((r) => String(r[0]).startsWith('กรกฎาคม'))).toContain('ปิดแล้ว');
  });
  it('the card asks before a checked or closed-month line changes; an unchecked line in an open month does not ask', () => {
    const { e, S, p, h, m1, ids } = fx;
    const since = e.payChkCfg().since, closes = e.monthClosesOut();
    const row = (dealId: string, expId: string) => dealExpChecks(S, dealId, e.expChecks(), since).find((r) => r.lineId === 'exp.' + expId);
    // the checked ผู้รับเหมา bill: a new amount asks, the description alone does not
    expect(expGuard(row(p.id, ids.con), { amt: 32000, d: '2026-09-05', f: '' }, closes, since)?.body).toContain('จะกลับเป็น “รอตรวจ” และ ฝน จะเห็นว่าเปลี่ยนอะไร');
    expect(expGuard(row(p.id, ids.con), { amt: 30000, d: '2026-09-05', f: '' }, closes, since)).toBeNull();
    // the quotation's ค่าแล็บ in closed July: deleting it says July's total will no longer match its close
    expect(expGuard(row(h.id, ids.lab), null, closes, since, 'ลบ')?.body).toContain('เดือนกรกฎาคม 2569 ปิดเงินออกแล้ว');
    // the company's trip (waiting, August open): no question; the bill not paid yet marked paid in October: none
    expect(expGuard(row(m1.id, ids.mTrip), null, closes, since, 'ลบ')).toBeNull();
    expect(expGuard(row(p.id, ids.trip), { amt: 5000, d: '2026-10-10', f: '' }, closes, since)).toBeNull();
    // a new expense paid in closed July asks
    expect(expGuard(null, { amt: 500, d: '2026-07-25', f: '' }, closes, since)?.body).toContain('เดือนนั้นจะมีรายการที่ต้องตรวจใหม่');
    // cancelling the joint quotation (its checked ค่าแล็บ goes with it) or deleting the owner's job says so too;
    // the company's waiting trip in open August does not
    expect(expGoneCheckWords(dealExpChecks(S, h.id, e.expChecks(), since), closes)).toContain('1 รายการ (20,000 บาท) จะขึ้นว่า “ยกเลิกหลังตรวจ”');
    expect(expGoneCheckWords(dealExpChecks(S, p.id, e.expChecks(), since), closes)).toContain('1 รายการ (30,000 บาท)');
    expect(expGoneCheckWords(dealExpChecks(S, m1.id, e.expChecks(), since), closes)).toBe('');
  });
  it('a checked line changed from the card waits again with what changed; under a person filter the out side holds the parts', () => {
    const { e, S, p, ids, who } = fx;
    // คุณบี (who recorded it) corrects the amount in the dialog (only the amount is sent)
    who.name = 'คุณบี';
    expect(e.updateExpense(p.id, ids.con, { c: 'ผู้รับเหมา', n: 'ทีมตรวจวัดที่โรงงาน', amt: 32100, d: '2026-09-01', paid: '2026-09-05' }, ['amt'])).toBe(true);
    who.name = 'หมิว';
    const r = dealExpChecks(S, p.id, e.expChecks(), e.payChkCfg().since).find((x) => x.lineId === 'exp.' + ids.con)!;
    expect(r.state).toBe('changed');
    expect(chipOf(r)).toMatchObject({ word: 'รอตรวจ', meta: 'เปลี่ยนหลังตรวจ' });
    expect(expNoteOf(r)?.body).toContain('ยอดจาก 30,000 เป็น 32,100 บาท');
    // and the card and Cashflow still agree
    const j = jobSum(S, p, TODAY), c = cashflow(S, resp('คุณบี'));
    expect([j.left, c.XK.net]).toEqual([67900, 67900]);
    // the out side under หมิว: the quotation's ค่าแล็บ as her company's part, its check still the whole bill's
    const keep = expPageKeep(S, normSalesFilter({ year: Y69, ...resp('หมิว') }), TODAY)!;
    const mine = expCheckRows(expChkRows(S, expLines(S), e.expChecks(), e.payChkCfg().since), 2026, keep).rows;
    const lab = mine.find((x) => x.lineId === 'exp.' + fx.ids.lab)!;
    expect([lab.amt, lab.fp?.amt, lab.state]).toEqual([12000, 20000, 'ok']);
  });
  it('the capability text covers money in and out', () => {
    expect(CAPS.find((c) => c.id === 'pay.check')?.desc).toContain('เงินเข้าและเงินออก');
  });
});
