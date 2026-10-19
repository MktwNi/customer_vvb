/**
 * Job expenses in the money views (lib/expenseMoney.ts): lines by period on the paid date, unpaid ones by the
 * bill date, the money left after them, by category / deal / person / unit (a joint quotation counted once,
 * split like its income), the page's filter, the out side of the month check (states from the fingerprint,
 * orphans, sums, closing, notes) and the files. The owner's example: a job with 100,000 received and
 * ผู้รับเหมา 25,000 + ค่าเดินทาง 4,000 paid, ค่าธรรมเนียม TGO 6,000 not yet.
 */
import { describe, expect, it } from 'vitest';
import { cashLines, cashYear, emptySales, newDeal, type Deal, type PayLine, type SalesState } from './sales';
import type { JobExp } from './expense';
import {
  NO_CAT, X_CHK_F, asCashLine, bothCsvRows, carriedOwed, expBackBell, catKey, dealExpChecks, expByCat, expByDeal, expByPerson, expByUnit, expChangeWords, expCheckRows, expChkRows, expCsvRows, expFp, expIn, expKpis,
  expGoneCheckWords, expGuard, expGuardText, expLines, expNoteOf, expOwners, expPageKeep, expRecorders, expReturnedTo, expSheets, expTeamMonth, expView, expWhat, expYear, isXChkF, netMonths, netOf, netQuarters, netSplit, pctWord, rowWhat, topCats,
  unitNets, xCheckWord, xMoneyWord, xSheetLines, xSheetPreview, type XRow,
} from './expenseMoney';
import { canClose, canConfirm, canReturn, canTick, chipOf, chkMatch, closeRecord, sumRows, yearCheck, type PayCheck } from './payCheck';
import { contribIn, staffKey, unitCtx } from './contrib';
import { cashRows } from './cashUi';
import { NOTIFY_CFG0, bellItems } from './notify';
import { searchHelp } from './helpContent';

const T = '2026-10-12';
const SINCE = '2026-01-01';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '2026-05-02T03:00:00.000Z', by: 'หมิว', ...p });
const X = (p: Partial<JobExp> = {}): JobExp => ({ c: 'ค่าเดินทาง', amt: 1000, d: '2026-10-01', by: 'เอก', at: '2026-10-07T03:00:00.000Z', ...p });
const BILL = { id: 'f1', name: 'บิลผู้รับเหมา.pdf', mime: 'application/pdf', size: 1000 };
const YES = (d: string) => ({ 'CLOSED DEAL': { d, n: 'YES' } });

/** The owner's job (d1), a joint quotation (header jh paid by its payer, members m1 60% and m2 40%), a lost
 *  job of last year with an expense, and an expense whose deal is gone. */
function world(): SalesState {
  const s = emptySales();
  const deal = (id: string, p: Partial<Deal>) => (s.deals[id] = newDeal({ id, client: 'บริษัท ' + id, year: '2569', ...p }, 'หมิว', '2026-01-05T03:00:00.000Z'));
  deal('d1', { client: 'สยามคาร์บอน', resp: 'เอก', forecast: 100000, section: 'TGO', source: ['TGO'] });
  Object.assign(s.steps, { 'd1/CLOSED DEAL': YES('2026-09-01')['CLOSED DEAL'] });
  s.pays['d1/PAY1'] = L({ amt: 100000, due: '2026-10-05', rcv: '2026-10-05' });
  deal('jh', { client: 'ผู้จ่าย ร่วม', resp: 'หมิว', forecast: 100000, section: 'Partner' });
  s.steps['jh/CLOSED DEAL'] = { d: '2026-07-01', n: 'YES' };
  s.pays['jh/PAY1'] = L({ amt: 100000, due: '2026-08-10', rcv: '2026-08-10' });
  deal('m1', { client: 'สมาชิก หนึ่ง', resp: 'ปลา', section: 'Partner' });
  deal('m2', { client: 'สมาชิก สอง', resp: 'เอก', section: 'Partner' });
  s.jqt = { jh: { title: 'โครงการร่วม', at: '2026-06-01T00:00:00.000Z', by: 'หมิว' } };
  s.jqm = { 'jh/m1': { share: null, pct: 60, at: '2026-06-01T00:00:00.000Z', by: 'หมิว' }, 'jh/m2': { share: null, pct: 40, at: '2026-06-02T00:00:00.000Z', by: 'หมิว' } };
  deal('old', { client: 'งานปีก่อน', resp: 'เอก', year: '2568' });
  s.steps['old/CLOSED DEAL'] = { d: '2025-11-01', n: 'NO' };
  s.exp = {
    'd1/e1': X({ c: 'ผู้รับเหมา', n: 'ทีมวัดค่า', amt: 25000, d: '2026-10-03', paid: '2026-10-06', file: BILL }),
    'd1/e2': X({ c: 'ค่าเดินทาง', amt: 4000, d: '2026-09-18', paid: '2026-09-20' }),
    'd1/e3': X({ c: 'ค่าธรรมเนียม TGO', amt: 6000, d: '2026-10-10' }),
    'jh/h1': X({ c: 'ค่าแล็บ', amt: 10000, d: '2026-08-14', paid: '2026-08-15', by: 'หมิว' }),
    'm1/x1': X({ c: ' ค่าเดินทาง ', amt: 2000, d: '2026-08-20', paid: '2026-08-20', by: 'ปลา' }),
    'old/o1': X({ c: 'ค่าเดินทาง', amt: 1500, d: '2025-12-28', paid: '2025-12-28' }),
    'old/o2': X({ c: '', amt: 300, d: '' }),
    'gone/g1': X({ amt: 999, paid: '2026-10-01' }),
  };
  return s;
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('expense lines', () => {
  it('every expense of every deal, whatever its year or result; paid on the paid date, unpaid on the bill date; a gone deal\'s skipped', () => {
    const s = world();
    const ls = expLines(s);
    expect(ids(ls)).toEqual(['old/o1', 'jh/h1', 'm1/x1', 'd1/e2', 'd1/e1', 'd1/e3', 'old/o2']);
    const e1 = ls.find((x) => x.id === 'd1/e1')!;
    expect([e1.kind, e1.date, e1.bill, e1.paid, e1.amt, e1.full, e1.c, e1.n, e1.file?.id, e1.expId, e1.deal.id, e1.dealYear]).toEqual(['paid', '2026-10-06', '2026-10-03', '2026-10-06', 25000, 25000, 'ผู้รับเหมา', 'ทีมวัดค่า', 'f1', 'e1', 'd1', '2569']);
    const e3 = ls.find((x) => x.id === 'd1/e3')!;
    expect([e3.kind, e3.date, e3.paid]).toEqual(['unpaid', '2026-10-10', '']);
    // a joint quotation: the header's expense is the quotation's, a member's its company's
    expect(ls.find((x) => x.id === 'jh/h1')!.joint).toEqual({ role: 'header', members: 2, title: 'โครงการร่วม', head: 'jh' });
    expect(ls.find((x) => x.id === 'm1/x1')!.joint).toEqual({ role: 'member', members: 2, title: 'โครงการร่วม', head: 'jh' });
    expect(ls.find((x) => x.id === 'd1/e1')!.joint).toBeUndefined();
    // only some deals
    expect(ids(expLines(s, [s.deals.d1]))).toEqual(['d1/e2', 'd1/e1', 'd1/e3']);
    expect(expLines(emptySales())).toEqual([]);
  });

  it('a year: by month and quarter, paid on the paid date and unpaid on the bill date; undated bills of the year\'s jobs apart', () => {
    const s = world(), Y = expYear(expLines(s), '2569');
    expect(Y.totals).toEqual({ paid: 41000, paidN: 4, unpaid: 6000, unpaidN: 1 });
    expect(Y.months[9]).toEqual({ paid: 25000, paidN: 1, unpaid: 6000, unpaidN: 1 });
    expect(Y.months[8]).toEqual({ paid: 4000, paidN: 1, unpaid: 0, unpaidN: 0 });
    expect(Y.months[7]).toEqual({ paid: 12000, paidN: 2, unpaid: 0, unpaidN: 0 });
    expect(Y.quarters.map((q) => q.paid)).toEqual([0, 0, 16000, 25000]);
    expect(Y.undated).toEqual([]);
    const Y68 = expYear(expLines(s), '2568');
    expect(Y68.totals).toEqual({ paid: 1500, paidN: 1, unpaid: 0, unpaidN: 0 });
    expect(ids(Y68.undated)).toEqual(['old/o2']);
    // a range: paid ones on their paid date, unpaid on the bill date
    expect(expIn(expLines(s), { from: '2026-10-01', to: '2026-10-31' })).toEqual({ paid: 25000, paidN: 1, unpaid: 6000, unpaidN: 1, deals: 1 });
    // the jobs paid for: a job with only an unpaid bill in the range is not one of them
    s.exp!['old/o3'] = X({ amt: 50, d: '2026-10-11' });
    expect(expIn(expLines(s), { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ unpaidN: 2, deals: 1 });
  });

  it('the money left: received − paid (the owner\'s 100,000 and 35,000 → 65,000, 65%); unpaid never in it', () => {
    expect(netOf(100000, 35000)).toEqual({ net: 65000, pct: 65 });
    expect(netOf(0, 500)).toEqual({ net: -500, pct: null });
    expect(netOf(1000, 1500)).toEqual({ net: -500, pct: -50 });
    expect([pctWord(65), pctWord(null)]).toEqual(['65%', '—']);
    const s = world(), C = cashYear(cashLines(s, Object.values(s.deals), T), '2569'), Y = expYear(expLines(s), '2569');
    const q = netQuarters(C, Y);
    expect(q.year).toEqual({ got: 200000, paid: 41000, unpaid: 6000, net: 159000, pct: 80 });
    expect(q.q[3]).toEqual({ got: 100000, paid: 25000, unpaid: 6000, net: 75000, pct: 75 });
    expect(q.q[2]).toEqual({ got: 100000, paid: 16000, unpaid: 0, net: 84000, pct: 84 });
    expect(q.q[0]).toEqual({ got: 0, paid: 0, unpaid: 0, net: 0, pct: null });
    expect(netMonths(C, Y)[9]).toEqual({ got: 100000, paid: 25000, unpaid: 6000, net: 75000, pct: 75 });
    const K = expKpis(Y, C.totals.got);
    expect([K.paid, K.paidN, K.unpaid, K.unpaidN, K.lastPaid, K.net, K.pct, K.deals]).toEqual([41000, 4, 6000, 1, '2026-10-06', 159000, 80, 3]);
  });

  it('the bar under คงเหลือสุทธิ reads the card\'s one rounded figure: never 65% beside 64% on a .5', () => {
    // 64.5% left: rounding each part on its own read "เหลือ 65%" beside "คงเหลือ 64%"
    expect(netOf(100000, 35500).pct).toBe(65);
    expect(netSplit(100000, 35500)).toEqual({ ex: 35, left: 65, exW: 35, leftW: 65 });
    // the reviewer's year: 747,000 received, 115,785 paid (84.5% left)
    expect(netSplit(747000, 115785)).toMatchObject({ ex: 15, left: 85 });
    expect(netSplit(747000, 115785)!.left).toBe(netOf(747000, 115785).pct);
    for (const [g, p] of [[100000, 35000], [3, 1], [7, 5], [1000, 0], [200000, 41000], [999, 998.5]]) {
      const b = netSplit(g, p)!;
      expect([b.left, b.ex + b.left, b.exW + b.leftW]).toEqual([netOf(g, p).pct, 100, 100]);
    }
    // spent more than came in: the words say so (−50%), the bar is all expenses
    expect(netSplit(1000, 1500)).toEqual({ ex: 150, left: -50, exW: 100, leftW: 0 });
    expect(netSplit(0, 500)).toBeNull();
  });
});

describe('by category, deal, person and unit', () => {
  it('categories as typed, whatever the spacing or case; the spelling most lines use; shares; the rest folded', () => {
    expect(catKey('  ค่า  TGO ')).toBe(catKey('ค่า tgo'));
    const s = world();
    s.exp!['d1/e4'] = X({ c: 'ค่าเดินทาง', amt: 500, paid: '2026-10-07' });
    s.exp!['d1/e5'] = X({ c: '', amt: 100, paid: '2026-10-08' });
    const rows = expByCat(expLines(s), { from: '2026-01-01', to: '2026-12-31' });
    expect(rows.map((r) => [r.c, r.amt, r.n])).toEqual([['ผู้รับเหมา', 25000, 1], ['ค่าแล็บ', 10000, 1], ['ค่าเดินทาง', 6500, 3], [NO_CAT, 100, 1]]);
    expect(rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(100, 0);
    // unpaid bills are not in it; without a range every year
    expect(expByCat(expLines(s)).find((r) => r.c === 'ค่าธรรมเนียม TGO')).toBeUndefined();
    expect(expByCat(expLines(s)).find((r) => r.c === 'ค่าเดินทาง')!.amt).toBe(8000);
    const top = topCats(rows, 3);
    expect(top.map((r) => [r.c, r.amt])).toEqual([['ผู้รับเหมา', 25000], ['ค่าแล็บ', 10000], ['อื่นๆ 2 หมวด', 6600]]);
    expect(topCats(rows, 4)).toBe(rows);
  });

  it('by deal: each record once, where it was recorded', () => {
    const m = expByDeal(expLines(world()));
    expect(m.get('d1')).toEqual({ paid: 29000, paidN: 2, unpaid: 6000, unpaidN: 1 });
    expect(m.get('jh')).toEqual({ paid: 10000, paidN: 1, unpaid: 0, unpaidN: 0 });
    expect(m.get('m1')).toEqual({ paid: 2000, paidN: 1, unpaid: 0, unpaidN: 0 });
  });

  it('by person: a joint quotation header\'s expense to its companies by their parts (as its income), a member\'s its own', () => {
    const s = world(), ls = expLines(s);
    expect(expOwners(s, ls.find((x) => x.id === 'jh/h1')!).map((o) => [o.deal.id, o.amt])).toEqual([['m1', 6000], ['m2', 4000]]);
    expect(expOwners(s, ls.find((x) => x.id === 'm1/x1')!).map((o) => [o.deal.id, o.amt])).toEqual([['m1', 2000]]);
    const p = expByPerson(s, ls, { from: '2026-01-01', to: '2026-12-31' });
    expect(Object.fromEntries(p)).toEqual({ เอก: 29000 + 4000, ปลา: 6000 + 2000 });
    // the payer (หมิว) holds none of the quotation's expense, as none of its income
    expect(p.has('หมิว')).toBe(false);
  });

  it('by unit: the job\'s own split, the same as its income; units add up to the period\'s totals', () => {
    const s = world();
    s.units = {
      ua: { n: 'ทีมเหนือ', c: 1, o: 0, rates: [{ from: '', r: 5 }], at: '', by: '' },
      ub: { n: 'ทีมใต้', c: 2, o: 1, rates: [{ from: '', r: 3 }], at: '', by: '' },
    };
    s.unitm = { [staffKey('ปลา')]: { unit: 'ua', n: 'ปลา', at: '', by: '' }, [staffKey('เอก')]: { unit: 'ub', n: 'เอก', at: '', by: '' } };
    // d1 split half and half between the two units
    s.shares = { d1: { lines: [{ u: 'ua', p: 50 }, { u: 'ub', p: 50 }], at: '', by: '' } };
    const ctx = unitCtx(s), ls = expLines(s), yr = { from: '2026-01-01', to: '2026-12-31' };
    const by = expByUnit(ctx, ls, yr);
    // d1: 29,000 half each; the header's 10,000 by its members (ปลา 60%, เอก 40%); m1's 2,000 its own (ปลา)
    expect(by).toEqual({ ua: 14500 + 6000 + 2000, ub: 14500 + 4000 });
    const cash = cashLines(s, Object.values(s.deals), T);
    const got = contribIn(ctx, cash, yr);
    expect(got.by.ua.got).toBe(50000 + 60000);
    const rows = unitNets(ctx, cash, ls, yr);
    expect(rows.map((r) => [r.n, r.got, r.paid, r.net, r.pct])).toEqual([['ทีมเหนือ', 110000, 22500, 87500, 80], ['ทีมใต้', 90000, 18500, 71500, 79]]);
    expect(rows.reduce((a, r) => a + r.paid, 0)).toBe(expYear(ls, '2569').totals.paid);
    // as contrib reads a line: the deal, the day, the amount
    const cl = asCashLine(ls.find((x) => x.id === 'jh/h1')!);
    expect([cl.deal.id, cl.date, cl.amt, cl.kind, cl.joint?.members]).toEqual(['jh', '2026-08-15', 10000, 'got', 2]);
    expect(asCashLine(ls.find((x) => x.id === 'm1/x1')!).joint).toBeUndefined();
    // nobody in a unit: ยังไม่ระบุหน่วยงาน
    const bare = world();
    bare.units = s.units;
    expect(unitNets(unitCtx(bare), cashLines(bare, Object.values(bare.deals), T), expLines(bare), yr).map((r) => [r.u, r.paid])).toEqual([['', 41000]]);
  });
});

describe('the page\'s filter', () => {
  it('none: every line; ผู้รับผิดชอบ: a joint quotation header\'s expense as the part of the companies listed; other years\' jobs too', () => {
    const s = world(), all = expLines(s);
    expect(expView(s, { year: '2569' }, T, all)).toBe(all);
    const aek = expView(s, { year: '2569', resp: 'เอก' }, T, all);
    expect(aek.map((x) => [x.id, x.amt])).toEqual([['old/o1', 1500], ['jh/h1', 4000], ['d1/e2', 4000], ['d1/e1', 25000], ['d1/e3', 6000], ['old/o2', 300]]);
    expect(aek.find((x) => x.id === 'jh/h1')!.joint).toMatchObject({ part: 1, keep: ['m2'] });
    // its whole bill stays what it is (the check is the whole bill's)
    expect(aek.find((x) => x.id === 'jh/h1')!.full).toBe(10000);
    const pla = expView(s, { year: '2569', resp: 'ปลา' }, T, all);
    expect(pla.map((x) => [x.id, x.amt])).toEqual([['jh/h1', 6000], ['m1/x1', 2000]]);
    // a filter that reads the quotation as one job (หมวด): the whole of it when its header is listed
    expect(expView(s, { year: '2569', section: 'Partner' }, T, all).map((x) => [x.id, x.amt])).toEqual([['jh/h1', 10000], ['m1/x1', 2000]]);
    expect(expView(s, { year: '2569', section: 'TGO' }, T, all).map((x) => x.id)).toEqual(['d1/e2', 'd1/e1', 'd1/e3']);
    // a person's filtered figures equal that person's row of the whole
    const yr = { from: '2026-01-01', to: '2026-12-31' };
    expect(expYear(aek, '2569').totals.paid).toBe(expByPerson(s, all, yr).get('เอก'));
    expect(expYear(pla, '2569').totals.paid).toBe(expByPerson(s, all, yr).get('ปลา'));
  });
});

describe('the month check of money out', () => {
  const rec = (p: Partial<PayCheck> & Pick<PayCheck, 'amt' | 'd'>): PayCheck => ({ s: 'ok', by: 'ฝน', at: '2026-10-08T03:00:00.000Z', f: '', ...p });
  const rowsOf = (s: SalesState, checks: Record<string, PayCheck> = s.xchk || {}, since = SINCE) => expChkRows(s, expLines(s), checks, since);
  const byKey = (rows: XRow[], k: string) => rows.find((r) => r.key === k)!;

  it('paid expenses wait for a check, unpaid bills are money still owed (no check), soonest first; the fingerprint is amount, paid date and bill', () => {
    const s = world(), rows = rowsOf(s);
    expect(rows.map((r) => [r.key, r.kind, r.state, r.ym])).toEqual([
      ['old/o1', 'got', 'none', '2025-12'],
      ['jh/h1', 'got', 'wait', '2026-08'],
      ['m1/x1', 'got', 'wait', '2026-08'],
      ['d1/e2', 'got', 'wait', '2026-09'],
      ['d1/e1', 'got', 'wait', '2026-10'],
      ['owed:d1/e3', 'owed', 'none', '2026-10'],
    ]);
    const e1 = byKey(rows, 'd1/e1');
    expect(e1.fp).toEqual({ amt: 25000, d: '2026-10-06', f: 'f1' });
    expect(expFp({ full: 4000.004, paid: '2026-09-20', file: null })).toEqual({ amt: 4000, d: '2026-09-20', f: '' });
    expect([e1.by, e1.lineId, e1.x?.id, e1.amt]).toEqual([['เอก'], 'exp.e1', 'd1/e1', 25000]);
    expect(expRecorders({ by: '  ' })).toEqual([]);
    // October: 25,000 paid and 6,000 still to pay; sumRows reads them as the income check's figures
    const oct = sumRows(rows.filter((r) => r.ym === '2026-10'));
    expect([oct.got, oct.gotN, oct.owed, oct.owedN, oct.late, oct.n, oct.ok, oct.wait]).toEqual([25000, 1, 6000, 1, 0, 1, 0, 1]);
    expect(chipOf(e1)).toMatchObject({ word: 'รอตรวจ', cls: 'chip' });
  });

  it('checked, changed after the check (amount, paid date, bill), sent back; the recorder can\'t check their own', () => {
    const s = world();
    const checks = {
      'd1/e1': rec({ amt: 25000, d: '2026-10-06', f: 'f1' }),
      'd1/e2': rec({ amt: 4000, d: '2026-09-19', f: '' }),
      'jh/h1': rec({ s: 'back', amt: 10000, d: '2026-08-15', f: '', note: 'ขอใบเสร็จตัวจริง' }),
      'm1/x1': rec({ amt: 2500, d: '2026-08-20', f: 'old' }),
    };
    const rows = rowsOf(s, checks);
    expect(byKey(rows, 'd1/e1').state).toBe('ok');
    expect(chipOf(byKey(rows, 'd1/e1'))).toMatchObject({ word: 'ตรวจแล้ว', cls: 'chip info' });
    const ch = byKey(rows, 'd1/e2');
    expect([ch.state, ch.diff]).toEqual(['changed', { amt: null, d: ['2026-09-19', '2026-09-20'], add: [], rm: [] }]);
    expect(expChangeWords(ch)).toBe('วันที่จ่ายจาก 19 ก.ย. 2569 เป็น 20 ก.ย. 2569');
    const m1 = byKey(rows, 'm1/x1');
    expect(expChangeWords(m1)).toBe('ยอดจาก 2,500 เป็น 2,000 บาท · เอาบิลออก');
    expect(expChangeWords({ diff: { amt: null, d: null, add: ['b'], rm: ['a'] } })).toBe('เปลี่ยนไฟล์บิล');
    expect(expChangeWords({ diff: { amt: null, d: null, add: ['b'], rm: [] } })).toBe('แนบบิล');
    expect(expNoteOf(ch)).toMatchObject({ head: expect.stringMatching(/^เปลี่ยนหลังตรวจ · เอก แก้เมื่อ/), body: expect.stringContaining('ฝน ตรวจไว้เมื่อ') });
    const back = byKey(rows, 'jh/h1');
    expect(back.state).toBe('back');
    expect(expNoteOf(back)).toMatchObject({ head: expect.stringMatching(/^สิ่งที่ต้องแก้ จาก ฝน · .* · ส่งถึง หมิว$/), body: 'ขอใบเสร็จตัวจริง', to: 'หมิว' });
    // who may do what: the recorder (เอก) can't tick, confirm or return their own; ฝน can
    expect([canTick(ch, 'เอก'), canConfirm(ch, 'เอก'), canReturn(ch, 'เอก')]).toEqual([false, false, false]);
    expect([canTick(ch, 'ฝน'), canConfirm(ch, 'ฝน'), canReturn(ch, 'ฝน')]).toEqual([true, true, true]);
    // a returned one is confirmed one at a time (no tick)
    expect([canTick(back, 'ฝน'), canConfirm(back, 'ฝน'), canReturn(back, 'ฝน')]).toEqual([false, true, false]);
    // returned to whoever recorded it, or the job's ผู้รับผิดชอบ
    expect(expReturnedTo(rows, 'หมิว').map((r) => r.key)).toEqual(['jh/h1']);
    expect(expReturnedTo(rows, 'ปลา')).toEqual([]);
    expect(expReturnedTo(rows, '')).toEqual([]);
  });

  it('orphans: a checked expense deleted or no longer paid, until acknowledged; before the first month checked none', () => {
    const s = world();
    delete s.exp!['d1/e2'];
    s.exp!['d1/e1'] = { ...s.exp!['d1/e1'], paid: undefined };
    const checks = { 'd1/e1': rec({ amt: 25000, d: '2026-10-06', f: 'f1' }), 'd1/e2': rec({ amt: 4000, d: '2026-09-20', f: '' }), 'd1/old': rec({ amt: 5, d: '2025-06-01', f: '' }) };
    const rows = rowsOf(s, checks);
    const gone = byKey(rows, 'd1/e2'), unpaid = byKey(rows, 'd1/e1');
    expect([gone.kind, gone.x, gone.amt, gone.ym, gone.state]).toEqual(['orphan', null, 4000, '2026-09', 'ok']);
    expect([unpaid.kind, unpaid.x?.kind, unpaid.ym]).toEqual(['orphan', 'unpaid', '2026-10']);
    // the unpaid bill is still listed as money owed, apart from its orphan
    expect(byKey(rows, 'owed:d1/e1').kind).toBe('owed');
    expect(rows.some((r) => r.key === 'd1/old')).toBe(false);
    expect(chipOf(gone)).toMatchObject({ word: 'ยกเลิกหลังตรวจ' });
    expect(expNoteOf(gone)!.head).toBe('ยกเลิกหลังตรวจ · ลบรายการนี้แล้ว');
    expect(expNoteOf(unpaid)!.head).toMatch(/^ยกเลิกหลังตรวจ · ตอนนี้ยังไม่ได้จ่าย \(เอก แก้เมื่อ/);
    expect(expNoteOf(gone)!.body).toMatch(/ตอนนี้ไม่ได้นับเป็นเงินออกแล้ว$/);
    expect([rowWhat(gone), rowWhat(unpaid), expWhat({ c: '', n: 'ค่ารถ' }), expWhat(null)]).toEqual(['รายการที่ลบแล้ว', 'ผู้รับเหมา', 'ค่ารถ', 'ค่าใช้จ่าย']);
    // a whole deal deleted
    delete s.deals.d1;
    expect(expNoteOf(byKey(rowsOf(s, checks), 'd1/e2'))!.head).toBe('ยกเลิกหลังตรวจ · งานนี้ถูกลบแล้ว');
    const sep = sumRows(rows.filter((r) => r.ym === '2026-09'));
    expect([sep.orphans, sep.n]).toEqual([1, 0]);
    // the first month checked moves: earlier paid money shows no status
    expect(byKey(rowsOf(world(), {}, '2026-10-01'), 'd1/e2').state).toBe('none');
  });

  it('closing the out side: every paid expense of the month checked, the month over; the year table; the close record', () => {
    const s = world();
    s.xchk = { 'jh/h1': rec({ amt: 10000, d: '2026-08-15', f: '' }) };
    const aug = expTeamMonth(s, s.xchk, SINCE, '2026-08');
    expect([aug.n, aug.ok]).toEqual([2, 1]);
    expect(canClose(aug, '2026-08', T)).toBe(false);
    s.xchk['m1/x1'] = rec({ amt: 2000, d: '2026-08-20', f: '' });
    const aug2 = expTeamMonth(s, s.xchk, SINCE, '2026-08');
    expect(canClose(aug2, '2026-08', T)).toBe(true);
    expect(closeRecord(aug2, 'ฝน', 'x')).toEqual({ by: 'ฝน', at: 'x', n: 2, amt: 12000 });
    // this month is never closed before it ends
    expect(canClose(expTeamMonth(s, s.xchk, SINCE, '2026-10'), '2026-10', T)).toBe(false);
    const rows = rowsOf(s);
    const Y = yearCheck(rows, 2026, { '2026-08': { by: 'ฝน', at: '2026-09-02T03:00:00.000Z', n: 2, amt: 12000 } }, T);
    expect(Y.months[7].state).toBe('closed');
    expect(Y.months[7].drift?.flagged).toBe(false);
    expect(Y.months[8].state).toBe('open');
    expect(Y.months[9].state).toBe('current');
    expect([Y.total.got, Y.total.owed, Y.closed]).toEqual([41000, 6000, 1]);
    // an expense of a closed month edited after it: the month says so
    s.exp!['m1/x1'] = { ...s.exp!['m1/x1'], amt: 2100 };
    const Y2 = yearCheck(rowsOf(s), 2026, { '2026-08': { by: 'ฝน', at: '', n: 2, amt: 12000 } }, T);
    expect(Y2.months[7].drift).toMatchObject({ redo: 1, flagged: true });
  });

  it('the bell: an expense sent back reaches whoever recorded it (or the job\'s ผู้รับผิดชอบ); only with ดูค่าใช้จ่าย', () => {
    const s = world();
    const checks = { 'd1/e1': rec({ s: 'back', amt: 25000, d: '2026-10-06', f: 'f1', note: 'ยอดในบิลไม่ตรง' }), 'jh/h1': rec({ amt: 10000, d: '2026-08-15' }) };
    const rows = expBackBell(s, checks, SINCE, 'เอก');
    expect(rows).toEqual([{ key: 'x:d1/e1', kind: 'xchk', title: 'สยามคาร์บอน', sub: 'ผู้รับเหมา · 25,000 บาท · ฝน ส่งกลับให้แก้: ยอดในบิลไม่ตรง', right: { text: 'ส่งกลับแก้ไข', chip: '' }, count: true, go: { deal: 'd1' } }]);
    expect(expBackBell(s, checks, SINCE, 'ปลา')).toEqual([]);
    expect(expBackBell(s, {}, SINCE, 'เอก')).toEqual([]);
    // changed since: it waits for accounting again, off the bell
    s.exp!['d1/e1'] = { ...s.exp!['d1/e1'], amt: 24000 };
    expect(expBackBell(s, checks, SINCE, 'เอก')).toEqual([]);
    const base = { S: s, tasks: [], owners: {}, coName: () => '', me: 'เอก', live: null, checks: {}, cfg: NOTIFY_CFG0, scope: 'mine' as const, today: T, xback: rows };
    const kinds = (caps: Parameters<typeof bellItems>[0]['caps']) => bellItems({ ...base, caps }).groups.map((g) => g.kind);
    expect(kinds({ 'view.sales': 'all', 'view.money': 'all', 'view.exp': 'all' })).toContain('xchk');
    expect(kinds({ 'view.sales': 'all', 'view.money': 'all' })).not.toContain('xchk');
    expect(bellItems({ ...base, caps: { 'view.sales': 'all', 'view.money': 'all', 'view.exp': 'all' } }).groups.find((g) => g.kind === 'xchk')!.title).toBe('ค่าใช้จ่ายที่บัญชีส่งกลับ');
  });

  it('the filter chips: ทั้งหมด · รอตรวจ · ตรวจแล้ว · ส่งกลับแก้ไข · ค้างจ่าย', () => {
    expect(X_CHK_F.map((f) => f.label)).toEqual(['ทั้งหมด', 'รอตรวจ', 'ตรวจแล้ว', 'ส่งกลับแก้ไข', 'ค้างจ่าย']);
    expect([isXChkF('owed'), isXChkF('late')]).toEqual([true, false]);
    const rows = rowsOf(world());
    expect(rows.filter((r) => chkMatch(r, 'owed')).map((r) => r.key)).toEqual(['owed:d1/e3']);
    expect(rows.filter((r) => chkMatch(r, 'wait')).length).toBe(4);
  });

  it('the page\'s filter on the rows, every year; the year\'s rows; a deal\'s checks', () => {
    const s = world(), all = rowsOf(s);
    const keep = expPageKeep(s, { year: '2569', resp: 'ปลา' }, T)!;
    const { rows, wide, team } = expCheckRows(all, 2026, keep);
    expect(rows.map((r) => [r.key, r.amt])).toEqual([['jh/h1', 6000], ['m1/x1', 2000]]);
    expect(byKey(rows, 'jh/h1').fp!.amt).toBe(10000);
    expect(wide.length).toBe(2);
    expect(team).toBe(all);
    expect(expPageKeep(s, { year: '2569' }, T)).toBeNull();
    expect(expCheckRows(all, 2025, null).rows.map((r) => r.key)).toEqual(['old/o1']);
    expect(dealExpChecks(s, 'd1', { 'd1/e1': rec({ amt: 25000, d: '2026-10-06', f: 'f1' }), 'jh/h1': rec({ amt: 1, d: '2026-08-15' }) }, SINCE).map((r) => [r.key, r.state])).toEqual([['d1/e2', 'wait'], ['d1/e1', 'ok']]);
  });

  it('expGuard: the question before the deal card changes or deletes a checked expense, or money of a closed month', () => {
    const s = world();
    const checks = { 'd1/e1': rec({ amt: 25000, d: '2026-10-06', f: 'f1' }), 'd1/e2': rec({ s: 'back', amt: 4000, d: '2026-09-20', note: 'ขอบิล' }) };
    const rows = dealExpChecks(s, 'd1', checks, SINCE);
    const e1 = byKey(rows, 'd1/e1'), e2 = byKey(rows, 'd1/e2');
    const none = {};
    // nothing that touches the check (the description, the category): no question
    expect(expGuard(e1, { amt: 25000, d: '2026-10-06', f: 'f1' }, none, SINCE)).toBeNull();
    // the amount of a checked expense: it waits again, accounting sees what changed
    const g = expGuard(e1, { amt: 26750, d: '2026-10-06', f: 'f1' }, none, SINCE)!;
    expect(g.head).toBe('ค่าใช้จ่ายนี้บัญชีตรวจแล้ว (ฝน 8\u00a0ต.ค.) · 25,000 บาท · จ่าย 6 ต.ค. 2569');
    expect(g.body).toBe('ถ้าแก้ ยอด วันที่จ่าย หรือบิล รายการนี้จะกลับเป็น “รอตรวจ” และ ฝน จะเห็นว่าเปลี่ยนอะไร');
    // the bill replaced (a new file): asked too
    expect(expGuard(e1, { amt: 25000, d: '2026-10-06', f: '\u0000new' }, none, SINCE)).not.toBeNull();
    // deleted, or marked not paid: no longer money out, and the check shows as cancelled after it
    expect(expGuard(e1, null, none, SINCE, 'ลบ')!.body).toBe('ถ้าลบ ค่าใช้จ่ายนี้จะไม่นับเป็นเงินออกแล้ว และ ฝน จะเห็นรายการเดิมว่า “ยกเลิกหลังตรวจ” ในหน้า Cashflow เดือนตุลาคม 2569 จนกว่าจะกดรับทราบ');
    expect(expGuard(e1, { amt: 25000, d: '', f: 'f1' }, none, SINCE)!.body).toContain('จะไม่นับเป็นเงินออกแล้ว');
    // one sent back says so
    expect(expGuard(e2, { amt: 4500, d: '2026-09-20', f: '' }, none, SINCE)!.head).toBe('ค่าใช้จ่ายนี้บัญชีส่งกลับแก้ไข (ฝน 8\u00a0ต.ค.) · 4,000 บาท · จ่าย 20 ก.ย. 2569');
    // waiting (never checked) in an open month: nothing to ask
    const w = byKey(dealExpChecks(s, 'd1', {}, SINCE), 'd1/e1');
    expect(expGuard(w, null, none, SINCE, 'ลบ')).toBeNull();
    // a closed month: asked even while it waits; moving its paid date out of it says where it goes
    const closes = { '2026-10': closeRecord({ ...sumRows([]), n: 1 } as never, 'ฝน', '2026-11-02T03:00:00.000Z'), '2026-09': { by: 'ฝน', at: '2026-10-02T03:00:00.000Z', n: 1, amt: 4000 } };
    expect(expGuard(w, null, closes, SINCE, 'ลบ')!.body).toBe('ถ้าลบ ค่าใช้จ่ายนี้จะไม่นับเป็นเงินออกแล้ว · เดือนตุลาคม 2569 ปิดเงินออกแล้ว (ฝน 2\u00a0พ.ย.) ยอดของเดือนนั้นจะไม่เท่ากับตอนปิด');
    expect(expGuard(w, { amt: 25000, d: '2026-11-01', f: 'f1' }, closes, SINCE)!.body).toContain('ยอดของเดือนนั้นจะไม่เท่ากับตอนปิด และรายการนี้จะไปรอตรวจในเดือนพฤศจิกายน 2569');
    expect(expGuard(e1, { amt: 25000, d: '2026-09-30', f: 'f1' }, { '2026-09': closes['2026-09'] }, SINCE)!.body).toContain('เดือนกันยายน 2569 ปิดเงินออกแล้ว (ฝน 2\u00a0ต.ค.) เดือนนั้นจะมีรายการที่ต้องตรวจใหม่');
    // a new expense, or one marked paid, landing in a closed month (not before the first month checked)
    const owed = dealExpChecks(s, 'd1', {}, SINCE).find((r) => r.key === 'owed:d1/e3');
    expect(owed).toBeUndefined(); // the card's rows are paid ones (and orphans) only
    expect(expGuard(null, { amt: 6000, d: '2026-09-28', f: '' }, closes, SINCE)).toEqual({ head: '6,000 บาท · จ่าย 28 ก.ย. 2569', body: 'เงินนี้จะนับเป็นเงินออกเดือนกันยายน 2569 · เดือนกันยายน 2569 ปิดเงินออกแล้ว (ฝน 2\u00a0ต.ค.) บันทึกได้ แต่เดือนนั้นจะมีรายการที่ต้องตรวจใหม่' });
    expect(expGuard(null, { amt: 6000, d: '2026-09-28', f: '' }, closes, '2026-10-01')).toBeNull();
    expect(expGuard(null, { amt: 6000, d: '', f: '' }, closes, SINCE)).toBeNull();
    expect(expGuard(undefined, null, closes, SINCE)).toBeNull();
    // deleting the whole job: the checked or closed-month paid lines say what becomes of their check
    expect(expGoneCheckWords(rows, none)).toBe('ค่าใช้จ่ายที่บัญชีตรวจแล้วหรืออยู่ในเดือนที่ปิดแล้ว 2 รายการ (29,000 บาท) จะขึ้นว่า “ยกเลิกหลังตรวจ” ในส่วนเงินออกของ Cashflow จนกว่าบัญชีจะกดรับทราบ');
    expect(expGoneCheckWords(dealExpChecks(s, 'd1', {}, SINCE), none)).toBe('');
    expect(expGoneCheckWords(dealExpChecks(s, 'd1', {}, SINCE), { '2026-09': closes['2026-09'] })).toContain(' 1 รายการ (4,000 บาท)');
    // the question's text
    expect(expGuardText('ลบค่าใช้จ่าย ผู้รับเหมา', g, 'ลบ')).toBe(`ลบค่าใช้จ่าย ผู้รับเหมา\n\n${g.head}\n${g.body}\n\nลบต่อหรือไม่?`);
  });

  it('"ค้างจากเดือนก่อน": unpaid bills of earlier months, last year\'s too, counted by year (as the income side\'s late money)', () => {
    const s = world();
    s.exp!['old/o4'] = X({ c: 'ค่าแล็บ', amt: 7000, d: '2025-12-15' });
    s.exp!['d1/e5'] = X({ amt: 2000, d: '2026-09-10' });
    s.exp!['d1/e6'] = X({ amt: 30000, d: '2026-10-01' });
    const rows = expChkRows(s, expLines(s), {}, SINCE);
    // October: September's 2,000 and last December's 7,000; October's own bills (6,000 and 30,000) are this month's
    expect(carriedOwed(rows, '2026-10')).toEqual({ n: 2, amt: 9000, years: [{ be: '2568', n: 1, amt: 7000 }, { be: '2569', n: 1, amt: 2000 }] });
    // January: only December's, of the year before (its own link "ดูปี 2568")
    expect(carriedOwed(rows, '2026-01')).toEqual({ n: 1, amt: 7000, years: [{ be: '2568', n: 1, amt: 7000 }] });
    // paid ones and checks never count; nothing before: none
    expect(carriedOwed(rows, '2025-12')).toEqual({ n: 0, amt: 0, years: [] });
    expect(carriedOwed(rows.filter((r) => r.kind !== 'owed'), '2026-12').n).toBe(0);
  });
});

describe('the files', () => {
  const rec = (p: Partial<PayCheck> & Pick<PayCheck, 'amt' | 'd'>): PayCheck => ({ s: 'ok', by: 'ฝน', at: '2026-10-08T03:00:00.000Z', f: '', ...p });
  it('Excel: sheet เงินออก one row per expense (paid, unpaid, cancelled after the check last) and สรุปเงินออก with the money left', () => {
    const s = world();
    const checks = { 'd1/e1': rec({ amt: 25000, d: '2026-10-06', f: 'f1' }), 'd1/gone': rec({ s: 'back', amt: 700, d: '2026-10-02', f: '', note: 'ไม่มีบิล' }) };
    const rows = expChkRows(s, expLines(s), checks, SINCE).filter((r) => r.ym === '2026-10');
    const months = yearCheck(rows, 2026, {}, T).months.filter((m) => m.ym === '2026-10');
    const inMonths = [{ ...months[0], sum: { ...months[0].sum, got: 100000 } }];
    const [ls, sum] = expSheets(rows, months, true, (d) => (d.id === 'd1' ? 'QT-1' : ''), inMonths);
    expect([ls.name, sum.name]).toEqual(['เงินออก', 'สรุปเงินออก']);
    expect(xSheetLines(rows, true).map((r) => r.key)).toEqual(['d1/e1', 'owed:d1/e3', 'd1/gone']);
    expect(xSheetLines(rows, false).map((r) => r.key)).toEqual(['d1/e1', 'd1/gone']);
    expect(ls.rows[0]).toEqual(['ต.ค. 2569', 'สยามคาร์บอน', 'QT-1', 'ผู้รับเหมา', 'ทีมวัดค่า', 25000, { date: '2026-10-03' }, { date: '2026-10-06' }, 'จ่ายแล้ว', 'บิล บิลผู้รับเหมา.pdf', 'เอก', 'ตรวจแล้ว', 'ฝน', { date: '2026-10-08' }, '']);
    expect(ls.rows[1].slice(5, 9)).toEqual([6000, { date: '2026-10-10' }, null, 'ค้างจ่าย']);
    expect(ls.rows[2].slice(8, 13)).toEqual(['ยกเลิกหลังตรวจ', '', '', 'ส่งกลับแก้ไข · ยกเลิกหลังตรวจ ไม่นับในยอด', 'ฝน']);
    expect(ls.rows[2][14]).toBe('ไม่มีบิล');
    expect(sum.head.slice(0, 5)).toEqual(['เดือน', 'จ่ายแล้ว (บาท)', 'ค้างจ่าย (บาท)', 'เงินเข้าแล้ว (บาท)', 'คงเหลือสุทธิ (บาท)']);
    expect(sum.rows[0].slice(0, 5)).toEqual(['ตุลาคม 2569', 25000, 6000, 100000, 75000]);
    // without the income months: no เงินเข้า columns
    expect(expSheets(rows, months, true, () => '')[1].head[3]).toBe('รายการจ่ายแล้ว');
    expect(xSheetPreview(rows, true, 2)).toEqual([['สยามคาร์บอน', 'ผู้รับเหมา', '25,000', '2026-10-06', 'จ่ายแล้ว', 'ตรวจแล้ว'], ['สยามคาร์บอน', 'ค่าธรรมเนียม TGO', '6,000', '', 'ค้างจ่าย', '']]);
    expect([xMoneyWord({ kind: 'got' }), xMoneyWord({ kind: 'owed' }), xCheckWord({ kind: 'got', state: 'changed' }), xCheckWord({ kind: 'got', state: 'none' }), xCheckWord({ kind: 'owed', state: 'none' })]).toEqual(['จ่ายแล้ว', 'ค้างจ่าย', 'รอตรวจ (เปลี่ยนหลังตรวจ)', 'ก่อนเริ่มตรวจ', '']);
  });

  it('the Cashflow CSV: money out by line or summed with the money left; in and out in one list, soonest first', () => {
    const s = world(), X0 = expYear(expLines(s), '2569'), C = cashYear(cashLines(s, Object.values(s.deals), T), '2569');
    const qt = () => '';
    const lines = expCsvRows('2569', X0, 'lines', false, qt);
    expect(lines.head[6]).toBe('หมวดค่าใช้จ่าย');
    expect(lines.rows[0]).toEqual(['2569', 'ส.ค. 2569', 'ผู้จ่าย ร่วม (ใบเสนอราคาร่วม 2 บริษัท)', '2569', 'Partner', 'หมิว', 'ค่าแล็บ', '', 10000, '2026-08-14', '2026-08-15', 'จ่ายแล้ว', '', 'หมิว']);
    expect(lines.rows.map((r) => r[11])).toEqual(['จ่ายแล้ว', 'จ่ายแล้ว', 'จ่ายแล้ว', 'จ่ายแล้ว', 'ค้างจ่าย']);
    const m = expCsvRows('2569', X0, 'month', false, qt);
    expect(m.head).toEqual(['ปี (พ.ศ.)', 'เดือน', 'จ่ายแล้ว (บาท)', 'ค้างจ่าย (บาท)', 'จำนวนรายการ']);
    expect(m.rows[9]).toEqual(['2569', 'ต.ค. 2569', 25000, 6000, 2]);
    expect(expCsvRows('2569', X0, 'quarter', false, qt).rows[2]).toEqual(['2569', 'ไตรมาส 3 (ก.ค.–ก.ย.)', 16000, 0, 3]);
    const und = expCsvRows('2568', expYear(expLines(s), '2568'), 'month', true, qt);
    expect(und.rows.at(-1)).toEqual(['2568', 'ยังไม่ระบุวันที่บิล', 0, 300, 1]);
    const both = bothCsvRows('2569', cashRows(s, '2569', C, 'lines', false), C, X0, 'lines', false, qt);
    expect(both.rows.map((r) => [r[2], r[9]])).toEqual([['เงินเข้า', 100000], ['เงินออก', 10000], ['เงินออก', 2000], ['เงินออก', 4000], ['เงินเข้า', 100000], ['เงินออก', 25000], ['เงินออก', 6000]]);
    expect(both.head.length).toBe(both.rows[0].length);
  });

  it('the CSV "เงินเข้าและเงินออก" summed by month or quarter keeps the money still owed and the undated income', () => {
    const s = world();
    // a won job: 60,000 came in in March, the last 40,000 has no date yet; a bill with no date
    s.deals.u1 = { ...s.deals.d1, id: 'u1', client: 'ยังไม่กำหนดวัน', forecast: 100000 };
    s.steps['u1/CLOSED DEAL'] = { d: '2026-02-01', n: 'YES' };
    s.pays['u1/PAY1'] = L({ amt: 60000, due: '2026-03-01', rcv: '2026-03-01' });
    s.pays['u1/PAY2'] = L({ amt: 40000 });
    s.exp!['d1/e7'] = X({ amt: 500, d: '' });
    const C = cashYear(cashLines(s, Object.values(s.deals), T), '2569'), X0 = expYear(expLines(s), '2569'), qt = () => '';
    expect([C.undated.length, X0.undated.length]).toEqual([1, 1]);
    const inM = cashRows(s, '2569', C, 'month', true);
    const m = bothCsvRows('2569', inM, C, X0, 'month', true, qt);
    expect(m.head).toEqual(['ปี (พ.ศ.)', 'เดือน', 'รับแล้ว (บาท)', 'เลยกำหนด (บาท)', 'รอรับ (บาท)', 'จ่ายแล้ว (บาท)', 'ค้างจ่าย (บาท)', 'คงเหลือสุทธิ (บาท)', 'จำนวนงวด', 'จำนวนรายการค่าใช้จ่าย']);
    expect(m.rows.every((r) => r.length === m.head.length)).toBe(true);
    // each month's money in is the in-only file's (received, late, still to come)
    expect(m.rows.slice(0, 12).map((r) => r.slice(2, 5))).toEqual(inM.rows.slice(0, 12).map((r) => r.slice(2, 5)));
    expect(m.rows[2]).toEqual(['2569', 'มี.ค. 2569', 60000, 0, 0, 0, 0, 60000, 1, 0]);
    expect(m.rows[9]).toEqual(['2569', 'ต.ค. 2569', 100000, 0, 0, 25000, 6000, 75000, 1, 2]);
    // the money with no date: the income's 40,000 (the in-only file's last row) and the bill's 500
    expect(inM.rows.at(-1)).toEqual(['2569', 'ยังไม่กำหนดวันรับ', 0, 0, 40000, 40000, 1]);
    expect(m.rows.slice(12)).toEqual([
      ['2569', 'ยังไม่กำหนดวันรับ', 0, 0, 40000, 0, 0, 0, 1, 0],
      ['2569', 'ยังไม่ระบุวันที่บิล', 0, 0, 0, 0, 500, 0, 0, 1],
    ]);
    // without them: the twelve months only
    expect(bothCsvRows('2569', cashRows(s, '2569', C, 'month', false), C, X0, 'month', false, qt).rows).toHaveLength(12);
    const q = bothCsvRows('2569', cashRows(s, '2569', C, 'quarter', true), C, X0, 'quarter', true, qt);
    expect(q.head[1]).toBe('ไตรมาส');
    expect(q.rows[3]).toEqual(['2569', 'ไตรมาส 4 (ต.ค.–ธ.ค.)', 100000, 0, 0, 25000, 6000, 75000, 1, 2]);
    expect(q.rows.map((r) => r[1]).slice(4)).toEqual(['ยังไม่กำหนดวันรับ', 'ยังไม่ระบุวันที่บิล']);
    // the year adds up: the quarters' received and paid are the year's
    expect([q.rows.slice(0, 4).reduce((a, r) => a + (r[2] as number), 0), q.rows.slice(0, 4).reduce((a, r) => a + (r[5] as number), 0)]).toEqual([C.totals.got, X0.totals.paid]);
  });
});

describe('the help centre', () => {
  it('finds money out: the Cashflow cards, the out side of the month check, the Dashboard card', () => {
    expect(searchHelp('ตรวจเงินออก').topics[0].id).toBe('exp-month-check');
    expect(searchHelp('เงินออก').topics.map((t) => t.id)).toEqual(expect.arrayContaining(['exp-cashflow', 'exp-month-check', 'exp-dash']));
    expect(searchHelp('คงเหลือสุทธิ').topics[0].id).toBe('exp-cashflow');
    expect(searchHelp('ค่าใช้จ่ายและคงเหลือ').topics[0].id).toBe('exp-dash');
  });
});
