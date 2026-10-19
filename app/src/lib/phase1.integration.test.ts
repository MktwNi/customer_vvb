/**
 * Phase 1 together (items 1, 2, 3, 6, 9a; plan.md §5 "one money fixture"): the features built apart meet
 * on one money core. A revised quotation (item 3) is counted once by every money view (the KPI, Cashflow,
 * the table lens, the Dashboard's การรับเงิน); the แผนติดต่อ calendar's "รับเงิน" entries (item 1) are the
 * dated installments Cashflow counts as owed (item 6, closed jobs still owing included, owner Q10 ก); and a
 * customer keeps its colour whatever happens to its quotations.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { cashKpis, cashLines, cashRecon, cashYear, dealMoney, emptySales, filterDeals, newDeal, payDue, receivables, salesStats, type Deal, type PayLine, type PlanInput, type SalesState } from './sales';
import { cashLensOf, lensSum } from './cashUi';
import { qtView } from './quotes';
import { cellLabel, chipName } from './planCal';
import { custColor, dealKey } from './custColor';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-12';

let base: Dataset, R: RoundRaw[];
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 300);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => vi.useRealTimers());

/** One browser on its own (no team): every change stays here. */
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
const qt = (amount: number, docDate: string, revise?: string) => ({
  kind: 'quotation' as const, amount, target: 'forecast' as const, basis: 'total' as const, detected: amount, docNo: 'QT-2569-014', docDate, stage: 'QUOTATION', ...(revise ? { revise } : {}),
});
const line = (stage: string, amt: number, due: string): PlanInput => ({ stage, amt, pct: null, due, rel: null, how: 'transfer', howT: '', note: '' });
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);
let n = 0;
/** A deal of 2569 won on 1 Oct, its quotation v1 attached on 4 Oct and revised (v2) on 9 Oct. */
async function revised(e: GccEngine) {
  const d = e.addDeal({ client: 'บริษัท ซากิโนมิยะ (ประเทศไทย) ทดสอบ ' + ++n + ' จำกัด', section: 'TGO', year: '2569' });
  const v1 = await e.attachDoc(d.id, pdf('QT-2569-014.pdf'), qt(192600, '2026-10-04'));
  later();
  const v2 = await e.attachDoc(d.id, pdf('QT-2569-014-แก้ไข.pdf'), qt(182970, '2026-10-09', v1.id));
  later();
  e.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
  return { d: e.sales.deals[d.id], v1, v2 };
}
const own = (e: GccEngine, d: Deal) => cashLines(e.sales, [e.sales.deals[d.id]], TODAY);

describe('a revised quotation in the money views', () => {
  it('without a plan: Cashflow\'s undated rest is the revised Forecast, once; the old version counts nowhere', async () => {
    const e = mk();
    const { d, v1, v2 } = await revised(e);
    const S = e.sales, dl = S.deals[d.id];
    expect(qtView(S, dl).versions.map((x) => [x.n, x.state])).toEqual([[1, 'old'], [2, 'cur']]);
    expect(dealMoney(S, dl).fcDoc!.id).toBe(v2.id);
    // the KPI and Cashflow agree: 182,970, not 192,600 and not both
    expect(salesStats(S, [dl], TODAY).forecast).toBe(182970);
    const L = own(e, d);
    expect(L.map((l) => [l.kind, l.src, l.amt, l.date])).toEqual([['owed', 'rest', 182970, '']]);
    const Y = cashYear(L, '2569');
    expect(Y.undated.map((l) => l.amt)).toEqual([182970]);
    expect(cashKpis(Y, '2569', TODAY)).toMatchObject({ total: 0, undated: 182970, undatedDeals: 1 });
    // ties to today's KPI ค้างรับ (open jobs of the year)
    expect(cashRecon(L, '2569').open).toBe(receivables(S, [dl], TODAY).receivable);
    expect(cashRecon(L, '2569').open).toBe(182970);

    // the version in use deleted: version 1 is the Forecast again, everywhere
    e.deleteDoc(d.id, v2.id);
    expect(dealMoney(S, S.deals[d.id]).fcDoc!.id).toBe(v1.id);
    expect(salesStats(S, [S.deals[d.id]], TODAY).forecast).toBe(192600);
    expect(own(e, d).map((l) => [l.src, l.amt])).toEqual([['rest', 192600]]);
  });

  it('with a plan: the installments are the money, the table lens and the Dashboard\'s การรับเงิน count them once', async () => {
    const e = mk();
    const { d } = await revised(e);
    // planned from the revised total, the last installment in 2570
    e.setPlan(d.id, [line('PAY1', 91485, '2026-10-08'), line('PAY2', 91485, '2027-01-15')]);
    const S = e.sales, L = own(e, d);
    expect(L.map((l) => [l.stage, l.kind, l.status, l.amt, l.date])).toEqual([
      ['PAY1', 'owed', 'late', 91485, '2026-10-08'],
      ['PAY2', 'owed', 'wait', 91485, '2027-01-15'],
    ]);
    // the plan adds up to the version in use (no difference shown against the Forecast)
    expect(L.reduce((a, l) => a + l.amt, 0)).toBe(dealMoney(S, S.deals[d.id]).forecast);
    // 2569 counts PAY1 only, 2570 PAY2 only: the lens and Cashflow say the same
    const lens69 = cashLensOf(S, Object.values(S.deals), '2569', null, TODAY);
    expect(lensSum(lens69, [S.deals[d.id]])).toEqual({ fc: 91485, ac: 0 });
    expect(cashKpis(cashYear(cashLines(S, Object.values(S.deals), TODAY), '2570'), '2570', TODAY)).toMatchObject({ total: 91485, from: { '2569': 1 } });
    // the Dashboard's การรับเงิน: late money in 2569 finds this deal, once
    expect(filterDeals(S, { year: '2569', pay: 'late' }, TODAY).map((x) => x.id)).toEqual([d.id]);
    expect(filterDeals(S, { year: '2570', pay: 'owed' }, TODAY).map((x) => x.id)).toEqual([d.id]);
  });
});

describe('the calendar\'s รับเงิน entries are the installments Cashflow counts as owed', () => {
  const L0 = (p: Partial<PayLine>): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });
  function world(): SalesState {
    const s = emptySales();
    const add = (id: string, client: string, x: Partial<Deal>, result: string, pays: Record<string, Partial<PayLine>>) => {
      s.deals[id] = newDeal({ id, client, year: '2569', ...x }, 'A', '2026-01-05T03:00:00.000Z');
      s.steps[`${id}/CLOSED DEAL`] = { d: '2026-09-01', n: result };
      Object.entries(pays).forEach(([p, v]) => (s.pays[`${id}/${p}`] = L0(v)));
    };
    // open, part-paid, one late; a closed job still owing (late and due); a lost deal; a cross-year one; one paid in full
    add('w1', 'บริษัท ไทยออยล์ เอนเนอร์ยี่ จำกัด', { forecast: 160500 }, 'YES', { PAY1: { amt: 80250, due: '2026-10-08' }, PAY2: { amt: 80250, due: '2026-11-15', rcv: '2026-10-10', got: 40000 } });
    add('c1', 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย', { forecast: 214000, jobStatus: 'closed', closedDate: '2026-10-05' }, 'YES', { PAY1: { amt: 107000, due: '2026-10-09' }, PAY2: { amt: 107000, due: '2026-10-22' } });
    add('n1', 'บริษัท แพ้ จำกัด', { forecast: 50000 }, 'NO', { PAY1: { amt: 50000, due: '2026-10-20' } });
    add('x1', 'บริษัท ปทุมธานี ฟาร์มา จำกัด', { forecast: 318000 }, 'YES', { PAY1: { amt: 159000, due: '2026-12-15' }, PAY2: { amt: 159000, due: '2027-02-15' } });
    add('p1', 'บริษัท จ่ายครบ จำกัด', { forecast: 90000 }, 'YES', { PAY1: { amt: 90000, due: '2026-09-30', rcv: '2026-09-30', got: 90000 } });
    return s;
  }
  it('every dated owed installment, of open and closed jobs, of any year, and nothing else', () => {
    const s = world(), deals = Object.values(s.deals);
    const cal = payDue(s, deals, '', '9999-12-31', TODAY).map((x) => `${x.deal.id}/${x.line.stage} ${x.line.left}`).sort();
    const cash = cashLines(s, deals, TODAY).filter((l) => l.kind === 'owed' && l.src === 'plan' && l.date).map((l) => `${l.deal.id}/${l.stage} ${l.amt}`).sort();
    expect(cal).toEqual(cash);
    expect(cal).toEqual(['c1/PAY1 107000', 'c1/PAY2 107000', 'w1/PAY1 80250', 'w1/PAY2 40250', 'x1/PAY1 159000', 'x1/PAY2 159000']);
  });
  it('a closed job\'s late installment is named on its day, whole and late in words; a closed job keeps its colour', () => {
    const s = world();
    const late = payDue(s, Object.values(s.deals), '2026-10-09', '2026-10-09', TODAY);
    expect(late.map((x) => [x.deal.id, x.line.lateDays])).toEqual([['c1', 3]]);
    const label = cellLabel('9 ต.ค. 2569', false, [], late.map((x) => ({ name: chipName(x.deal.client), late: x.line.lateDays > 0 })));
    expect(label).toBe('9 ต.ค. 2569 · 0 งาน · รับเงิน 1 งวด เลยกำหนด: การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย');
    // the colour comes from who the customer is, not from the job's state or its documents
    const look = { company: () => undefined, canonical: (id: number) => id };
    const open = { ...s.deals.c1, jobStatus: 'open' as const };
    expect(dealKey(look, s.deals.c1)).toBe(dealKey(look, open));
    expect(custColor(dealKey(look, s.deals.c1))).toBe(custColor(dealKey(look, open)));
  });
});

describe('a customer\'s colour across its quotation versions', () => {
  it('revising, then deleting the version in use, never changes the deal\'s key or colour', async () => {
    const e = mk();
    const { d, v2 } = await revised(e);
    const k0 = dealKey(e, e.sales.deals[d.id]);
    e.deleteDoc(d.id, v2.id);
    expect(dealKey(e, e.sales.deals[d.id])).toBe(k0);
    expect(custColor(k0)).toBe(custColor(dealKey(e, e.sales.deals[d.id])));
  });
});
