/** Job expenses per job (lib/expenseJob.ts): categories suggested, the dialog's line, and one job's money
 *  (a plain deal, a joint quotation's header and member, the computed commission). Mon 12 Oct 2569. */
import { describe, expect, it } from 'vitest';
import {
  CAT_EXAMPLES, catKey, catSuggest, expCats, expChanged, expClash, expFieldWords, expFollow, expForm, expGoneWords, expTotals, expTouched, jobComm, jobIncome, jobSum, memberExps, pctOf,
  readExpForm, sameBill, tidyCat,
} from './expenseJob';
import { emptySales, newDeal, type Deal, type DealDoc, type JointMember, type PayLine, type SalesState } from './sales';
import { staffKey, unitCtx } from './contrib';
import type { JobExp } from './expense';

const T = '2026-10-12';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });
const X = (p: Partial<JobExp> = {}): JobExp => ({ c: 'ค่าเดินทาง', amt: 1000, d: '2026-10-05', by: 'เอก', at: '2026-10-05T03:00:00.000Z', ...p });
const M = (p: Partial<JointMember> = {}, at = '2026-10-06T03:00:00.000Z'): JointMember => ({ share: null, pct: null, at, by: 'หมิว', ...p });
const qt = (deal: string, amount: number): DealDoc => ({
  id: 'qt-' + deal, deal, kind: 'quotation', name: 'qt.pdf', mime: 'application/pdf', size: 1, fileId: 'F', docNo: 'QT-1', docDate: '2026-10-01', amount, target: 'forecast', detected: amount,
  basis: 'total', stage: 'QUOTATION', at: '2026-10-01T03:00:00.000Z', cAt: '2026-10-01T03:00:00.000Z', by: 'หมิว',
});

/** p1: a plain won deal, Forecast 100,000 in two installments, PAY1 (50,000) received; h: a joint quotation
 *  (1,200,000) for b1 (25%) and b2 (75%), won, PAY1 600,000 received; n1: a deal not won yet. */
function world(): SalesState {
  const s = emptySales();
  const add = (id: string, p: Partial<Deal>) => (s.deals[id] = newDeal({ id, year: '2569', section: 'TGO', ...p, client: p.client || 'บริษัท ' + id }, 'หมิว', '2026-09-01T03:00:00.000Z'));
  add('p1', { resp: 'เอก', forecast: 100000 });
  s.steps['p1/CLOSED DEAL'] = { d: '2026-10-01', n: 'YES' };
  s.pays['p1/PAY1'] = L({ amt: 50000, due: '2026-10-05', rcv: '2026-10-06' });
  s.pays['p1/PAY2'] = L({ amt: 50000, due: '2026-12-01' });
  add('h', { client: 'มหาวิทยาลัย', resp: 'หมิว' });
  add('b1', { resp: 'เอก', forecast: 50000 });
  add('b2', { resp: 'ฝน', forecast: 50000 });
  s.docs['h/qt-h'] = qt('h', 1200000);
  s.jqt = { h: { title: 'CFP มหาวิทยาลัย', at: '2026-10-01T03:00:00.000Z', by: 'หมิว' } };
  s.jqm = { 'h/b1': M({ pct: 25 }, '2026-10-01T03:00:00.000Z'), 'h/b2': M({ pct: 75 }, '2026-10-01T03:00:01.000Z') };
  s.steps['h/CLOSED DEAL'] = { d: '2026-10-02', n: 'YES' };
  s.pays['h/PAY1'] = L({ amt: 600000, due: '2026-10-08', rcv: '2026-10-09' });
  s.pays['h/PAY2'] = L({ amt: 600000, due: '2026-12-15' });
  add('n1', { resp: 'เอก', forecast: 80000 });
  return s;
}

describe('categories (free text, no fixed list)', () => {
  it('are tidied as typed, and spellings that differ in spaces or case are one', () => {
    expect(tidyCat('  ผู้รับเหมา   ภายนอก ')).toBe('ผู้รับเหมา ภายนอก');
    expect(tidyCat('ก'.repeat(60))).toHaveLength(40);
    expect(catKey(' ค่าธรรมเนียม  TGO')).toBe(catKey('ค่าธรรมเนียม tgo'));
    expect(CAT_EXAMPLES).toBe('เช่น ผู้รับเหมา, ค่าเดินทาง, ค่าธรรมเนียม TGO, ค่าแล็บ');
  });

  it('expCats: what the team used, most used first, then the most recent, one spelling each', () => {
    const s = { exp: {
      'a/1': X({ c: 'ค่าเดินทาง', at: '2026-10-01T00:00:00Z' }),
      'a/2': X({ c: 'ค่าเดินทาง ', at: '2026-10-02T00:00:00Z' }),
      'b/3': X({ c: 'ค่าธรรมเนียม TGO', at: '2026-10-03T00:00:00Z' }),
      'b/4': X({ c: 'ค่าธรรมเนียม tgo', at: '2026-09-03T00:00:00Z' }),
      'b/5': X({ c: 'ค่าธรรมเนียม TGO', at: '2026-09-04T00:00:00Z' }),
      'c/6': X({ c: 'ค่าแล็บ', at: '2026-10-09T00:00:00Z' }),
      'c/7': X({ c: 'ผู้รับเหมา', at: '2026-10-08T00:00:00Z' }),
      'c/8': X({ c: '   ' }),
    } };
    expect(expCats(s)).toEqual([
      { c: 'ค่าธรรมเนียม TGO', n: 3, at: '2026-10-03T00:00:00Z' },
      { c: 'ค่าเดินทาง', n: 2, at: '2026-10-02T00:00:00Z' },
      // the same count: the most recently written first
      { c: 'ค่าแล็บ', n: 1, at: '2026-10-09T00:00:00Z' },
      { c: 'ผู้รับเหมา', n: 1, at: '2026-10-08T00:00:00Z' },
    ]);
    expect(expCats({})).toEqual([]);
  });

  it('catSuggest: the ones containing what is typed (not the one typed exactly), at most max', () => {
    const s = { exp: { 'a/1': X({ c: 'ค่าเดินทาง' }), 'a/2': X({ c: 'ค่าเดินทาง' }), 'a/3': X({ c: 'ค่าแล็บ' }), 'a/4': X({ c: 'ผู้รับเหมา' }), 'a/5': X({ c: 'ค่าเดินทางต่างจังหวัด' }) } };
    expect(catSuggest(s, '').map((x) => x.c)).toEqual(['ค่าเดินทาง', 'ค่าเดินทางต่างจังหวัด', 'ค่าแล็บ', 'ผู้รับเหมา']);
    expect(catSuggest(s, 'ค่า').map((x) => x.c)).toEqual(['ค่าเดินทาง', 'ค่าเดินทางต่างจังหวัด', 'ค่าแล็บ']);
    expect(catSuggest(s, ' ค่าเดินทาง').map((x) => x.c)).toEqual(['ค่าเดินทางต่างจังหวัด']);
    expect(catSuggest(s, 'zz')).toEqual([]);
    expect(catSuggest(s, '', 2)).toHaveLength(2);
  });
});

describe('the dialog\'s line', () => {
  it('a new one starts with the bill dated today, not paid; an existing one shows what it holds', () => {
    expect(expForm(null, T)).toEqual({ c: '', n: '', amt: '', d: T, paidOn: false, paid: '' });
    expect(expForm(X({ amt: 35000.5, n: 'งวดแรก', paid: '2026-10-07' }), T)).toEqual({ c: 'ค่าเดินทาง', n: 'งวดแรก', amt: '35,000.5', d: '2026-10-05', paidOn: true, paid: '2026-10-07' });
    expect(expForm(X({ d: '' }), T).d).toBe(T);
  });

  it('readExpForm: a category, an amount over 0 as written on Thai bills, the bill date, a paid date once paid', () => {
    const f = { c: '  ค่าแล็บ ', n: ' ตรวจวัด   ปล่อง ', amt: '35,000.-', d: '2026-10-05', paidOn: false, paid: '' };
    expect(readExpForm(f)).toEqual({ ok: true, v: { c: 'ค่าแล็บ', n: 'ตรวจวัด ปล่อง', amt: 35000, d: '2026-10-05' } });
    expect(readExpForm({ ...f, amt: '1.5 ล้าน', paidOn: true, paid: '2026-10-06', n: '' })).toEqual({ ok: true, v: { c: 'ค่าแล็บ', amt: 1500000, d: '2026-10-05', paid: '2026-10-06' } });
    expect(readExpForm({ ...f, amt: '1,234.567' })).toMatchObject({ ok: true, v: { amt: 1234.57 } });
    expect(readExpForm({ c: ' ', n: '', amt: '0', d: '2026-02-30', paidOn: true, paid: '' })).toEqual({
      ok: false, err: { c: 'ใส่ประเภทค่าใช้จ่าย', amt: 'ใส่ยอดตามบิล (มากกว่า 0)', d: 'เลือกวันที่ในบิล', paid: 'เลือกวันที่จ่าย' },
    });
    expect(readExpForm({ ...f, amt: '35,000 หรือ 40,000' })).toEqual({ ok: false, err: { amt: 'อ่านยอดไม่ได้ พิมพ์ตัวเลขเดียว เช่น 35,000' } });
    expect(readExpForm({ ...f, amt: '' })).toEqual({ ok: false, err: { amt: 'ใส่ยอดตามบิล (มากกว่า 0)' } });
    // the description is cut at 200
    const long = readExpForm({ ...f, n: 'ก'.repeat(250) });
    expect(long.ok && long.v.n).toHaveLength(200);
  });

  it('expChanged: the fields an edit changes (a field taken away counts; who and when do not)', () => {
    expect(expChanged(X({ paid: '2026-10-07' }), X({ amt: 1200, by: 'ฝน', at: 'x' }))).toEqual(['amt', 'paid']);
    expect(expChanged(X(), X())).toEqual([]);
  });
});

describe('a teammate\'s change while the dialog is open', () => {
  const open = expForm(X({ amt: 3500, n: 'รอบแรก' }), T);
  it('expTouched: the fields the person changed (a paid date counts only while ticked)', () => {
    expect(expTouched(open, open)).toEqual([]);
    expect(expTouched(open, { ...open, paidOn: true, paid: '2026-10-09' })).toEqual(['paid']);
    // a date picked and the box ticked off again: nothing changed
    expect(expTouched(open, { ...open, paid: '2026-10-09' })).toEqual([]);
    expect(expTouched(open, { ...open, amt: '3500', c: 'ค่าแล็บ' })).toEqual(['c', 'amt']);
  });
  it('expFollow: fields the person has not changed follow the record; changed ones keep what was typed', () => {
    const ed = { init: open, f: { ...open, paidOn: true, paid: '2026-10-09' } };
    const live = expForm(X({ amt: 3800, n: 'รอบแรก', d: '2026-10-06' }), T);
    const next = expFollow(ed, live);
    expect(next.f).toEqual({ ...open, amt: '3,800', d: '2026-10-06', paidOn: true, paid: '2026-10-09' });
    expect(next.init).toEqual({ ...open, amt: '3,800', d: '2026-10-06' });
    // the paid date stays the person's change, and does not clash with a record still unpaid
    expect(expTouched(next.init, next.f)).toEqual(['paid']);
    expect(expClash(next.init, next.f, live)).toEqual([]);
    // nothing new: the same object (no re-render)
    expect(expFollow(next, live)).toBe(next);
  });
  it('expClash: a field both changed, to different values, asks; the same value or the teammate alone does not', () => {
    const f = { ...open, amt: '4,000' };
    expect(expClash(open, f, expForm(X({ amt: 3800, n: 'รอบแรก' }), T))).toEqual(['amt']);
    expect(expClash(open, f, expForm(X({ amt: 4000, n: 'รอบแรก' }), T))).toEqual([]);
    expect(expClash(open, open, expForm(X({ amt: 3800, n: 'รอบแรก' }), T))).toEqual([]);
    // a paid date both set, differently
    const paid = { ...open, paidOn: true, paid: '2026-10-09' };
    expect(expClash(open, paid, expForm(X({ amt: 3500, n: 'รอบแรก', paid: '2026-10-08' }), T))).toEqual(['paid']);
  });
  it('expFieldWords: the record\'s value now, in the question', () => {
    const live = X({ amt: 3800, n: '', paid: '2026-10-08', file: { id: 'F', name: 'บิล.pdf', mime: 'application/pdf', size: 9 } });
    expect(expFieldWords('amt', live)).toBe('ยอด 3,800 บาท');
    expect(expFieldWords('paid', live)).toBe('จ่ายแล้ว 8 ต.ค. 2569');
    expect(expFieldWords('paid', X())).toBe('ยังไม่จ่าย (ค้างจ่าย)');
    expect(expFieldWords('c', live)).toBe('ประเภท "ค่าเดินทาง"');
    expect(expFieldWords('n', live)).toBe('รายละเอียด (ว่าง)');
    expect(expFieldWords('d', live)).toBe('วันที่ในบิล 5 ต.ค. 2569');
    expect(expFieldWords('file', live)).toBe('บิล บิล.pdf');
    expect(expFieldWords('file', X())).toBe('ไม่มีบิล');
  });
  it('sameBill: one file (the same upload, or the same one still waiting)', () => {
    const b = { id: '', name: 'a.pdf', mime: 'application/pdf', size: 5 };
    expect(sameBill(b, { ...b })).toBe(true);
    expect(sameBill(b, { ...b, id: 'F' })).toBe(false);
    expect(sameBill(b, { ...b, name: 'b.pdf' })).toBe(false);
    expect(sameBill(undefined, null)).toBe(true);
    expect(sameBill(b, undefined)).toBe(false);
  });
});

describe('what deleting a job takes of its expenses, in words', () => {
  it('expGoneWords: how many, how much, and the bills', () => {
    expect(expGoneWords([])).toBe('');
    expect(expGoneWords([X({ amt: 20000 }), X({ amt: 3500.5, file: { id: 'F', name: 'b.pdf', mime: 'application/pdf', size: 1 } })], 'ที่ใบเสนอราคาร่วม')).toBe(
      'ค่าใช้จ่ายที่บันทึกไว้ที่ใบเสนอราคาร่วม 2 รายการ (23,500.5 บาท) และบิลที่แนบ จะถูกลบด้วย',
    );
    expect(expGoneWords([X({ amt: 1000 })])).toBe('ค่าใช้จ่ายที่บันทึกไว้ 1 รายการ (1,000 บาท) จะถูกลบด้วย');
  });
});

describe('one job\'s money', () => {
  it('expTotals: all, paid, not paid yet (ค้างจ่าย), to the satang', () => {
    expect(expTotals([X({ amt: 35000, paid: '2026-10-06' }), X({ amt: 0.1 }), X({ amt: 0.2 })])).toEqual({ out: 35000.3, paid: 35000, unpaid: 0.3, n: 3, nUnpaid: 2 });
    expect(expTotals([])).toEqual({ out: 0, paid: 0, unpaid: 0, n: 0, nUnpaid: 0 });
  });

  it('pctOf: whole %, a loss negative, none without anything received', () => {
    expect(pctOf(65000, 100000)).toBe(65);
    expect(pctOf(-5000, 100000)).toBe(-5);
    expect(pctOf(2, 3)).toBe(67);
    expect(pctOf(100, 0)).toBeNull();
  });

  it('a plain deal: received as Cashflow counts it; "เงินเข้า 50,000 · ค่าใช้จ่าย 35,000 · คงเหลือ 15,000 (30%)"', () => {
    const s = world();
    expect(jobIncome(s, s.deals.p1, T)).toEqual({ inc: 50000, fc: 100000 });
    s.exp = { 'p1/e1': X({ amt: 30000, paid: '2026-10-07' }), 'p1/e2': X({ amt: 5000 }), 'n1/e3': X({ amt: 999 }) };
    const j = jobSum(s, s.deals.p1, T);
    expect(j).toMatchObject({ inc: 50000, fc: 100000, left: 15000, pct: 30, fcLeft: 65000, fcPct: 65, members: [] });
    expect(j.t).toEqual({ out: 35000, paid: 30000, unpaid: 5000, n: 2, nUnpaid: 1 });
    expect(j.own).toEqual(j.t);
    // not won: nothing received yet, the Forecast line still says what would be left
    expect(jobSum(s, s.deals.n1, T)).toMatchObject({ inc: 0, pct: null, left: -999, fc: 80000, fcLeft: 79001, fcPct: 99 });
  });

  it('a joint quotation: the header holds the whole quotation\'s money and every company\'s expenses, once each', () => {
    const s = world();
    s.exp = { 'h/e1': X({ amt: 100000, paid: '2026-10-10' }), 'b1/e2': X({ amt: 20000 }), 'b2/e3': X({ amt: 30000, paid: '2026-10-11' }), 'b2/e4': X({ amt: 10000 }), 'p1/e5': X({ amt: 7 }) };
    const j = jobSum(s, s.deals.h, T);
    expect(j).toMatchObject({ inc: 600000, fc: 1200000, left: 440000, pct: 73, fcLeft: 1040000 });
    expect(j.t).toEqual({ out: 160000, paid: 130000, unpaid: 30000, n: 4, nUnpaid: 2 });
    expect(j.own).toEqual({ out: 100000, paid: 100000, unpaid: 0, n: 1, nUnpaid: 0 });
    expect(memberExps(s, s.deals.h).map((m) => [m.deal.id, m.list.map((x) => x.id), m.t.out])).toEqual([['b1', ['e2'], 20000], ['b2', ['e3', 'e4'], 40000]]);
    // a member: its part of the money received (25% of 600,000) and of the quotation, its own expenses only
    expect(jobIncome(s, s.deals.b1, T)).toEqual({ inc: 150000, fc: 300000 });
    expect(jobSum(s, s.deals.b1, T)).toMatchObject({ inc: 150000, fc: 300000, left: 130000, pct: 87, members: [] });
    expect(jobSum(s, s.deals.b2, T)).toMatchObject({ inc: 450000, t: { out: 40000 } });
    // the members' parts add up to the header's money: nothing counted twice
    expect(jobIncome(s, s.deals.b1, T).inc + jobIncome(s, s.deals.b2, T).inc).toBe(jobIncome(s, s.deals.h, T).inc);
    expect(memberExps(s, s.deals.p1)).toEqual([]);
    expect(memberExps(s, s.deals.b1)).toEqual([]);
  });

  it('jobComm: received × the job\'s unit split × the unit\'s rate on the day (computed, never stored); a member its part', () => {
    const s = world();
    expect(jobComm(unitCtx(s), s, s.deals.p1, T)).toBe(0);
    s.units = { sales: { n: 'ฝ่ายขาย', c: 1, o: 0, rates: [{ from: '', r: 5 }], at: '', by: '' }, con: { n: 'ที่ปรึกษา', c: 2, o: 1, rates: [{ from: '', r: 2 }], at: '', by: '' } };
    s.unitm = { [staffKey('เอก')]: { unit: 'sales', n: 'เอก', at: '', by: '' }, [staffKey('ฝน')]: { unit: 'con', n: 'ฝน', at: '', by: '' } };
    const ctx = unitCtx(s);
    // p1 (เอก, ฝ่ายขาย 5%): 50,000 received
    expect(jobComm(ctx, s, s.deals.p1, T)).toBe(2500);
    // the joint quotation's 600,000: b1 (เอก) 25% at 5%, b2 (ฝน) 75% at 2%
    expect(jobComm(ctx, s, s.deals.b1, T)).toBe(7500);
    expect(jobComm(ctx, s, s.deals.b2, T)).toBe(9000);
    expect(jobComm(ctx, s, s.deals.h, T)).toBe(16500);
    expect(jobComm(ctx, s, s.deals.n1, T)).toBe(0);
  });
});
