/**
 * Cashflow by year (cash impl-note §1, §5): the money lines (cashLines), a year of them (cashYear), the
 * cards (cashKpis), the line that ties them to the KPI ค้างรับ (cashRecon), the money lens and the
 * การรับเงิน filter (filterDeals), the received-money core shared with receivedIn, and the CSV. One demo
 * world (the seed of the mockups, Mon 12 Oct 2569) is checked against the figures drawn in the mockups.
 */
import { describe, expect, it } from 'vitest';
import {
  cashKpis, cashLines, cashRecon, cashTotal, cashYear, cashYears, emptySales, filterDeals, jointRole, newDeal, owedIn, payDue, payMatch, quarterOf, receivables, receivedIn, receivedOf,
  type Deal, type DealDoc, type PayLine, type SalesState,
} from './sales';
import { cashCsv, cashLensOf, cashRows, compactBaht, crossYearTag, instSub, instText, instWords, lensSum, lensWhere, moneyTicks, payIn, splitExample, statusWord, yearMoneyLabel, yearSplit } from './cashUi';
import { searchHelp } from './helpContent';
import { yearOptions } from './salesUi';

const T = '2026-10-12';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });
const doc = (p: Partial<DealDoc>): DealDoc => ({
  id: 'r', deal: 'x', kind: 'receipt', name: 'r.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: '', docDate: '', amount: 100, target: 'actual', detected: 100, basis: 'total', stage: 'PAY1', at: '2026-10-01T00:00:00.000Z', by: '', ...p,
});

/** A small tracker: deals with their stage steps ({stage: [date, note]}) and plan lines. */
function world(spec: Record<string, { d?: Partial<Deal>; steps?: Record<string, [string, string]>; pays?: Record<string, Partial<PayLine>> }>): SalesState {
  const s = emptySales();
  for (const [id, x] of Object.entries(spec)) {
    s.deals[id] = newDeal({ id, client: 'บริษัท ' + id, year: '2569', ...x.d }, 'A', '2026-01-05T03:00:00.000Z');
    Object.entries(x.steps || {}).forEach(([p, [d, n]]) => (s.steps[`${id}/${p}`] = { d, n }));
    Object.entries(x.pays || {}).forEach(([p, v]) => (s.pays[`${id}/${p}`] = L(v)));
  }
  return s;
}
const YES = (d: string): Record<string, [string, string]> => ({ 'CLOSED DEAL': [d, 'YES'] });

/**
 * The demo seed as the mockups use it (Mon 12 Oct 2569), with ปทุมธานี ฟาร์มา (dep2) won on 8 ต.ค. and
 * paying 3 installments, the last in ก.พ. 2570. The joint quotation of the mockups comes with package
 * quotes, so the figures below are the mockups' minus its 963,000.
 */
function demo(): SalesState {
  return world({
    c1: { d: { client: 'อมตะ คอร์ปอเรชัน', jobStatus: 'closed', closedDate: '2026-08-20', forecast: 240000, resp: 'ปลา', section: 'TGO' }, steps: YES('2026-06-10'), pays: { PAY1: { amt: 120000, due: '2026-06-30', rcv: '2026-06-30' }, PAY2: { amt: 120000, due: '2026-08-15', rcv: '2026-08-15' } } },
    c2: { d: { client: 'พฤกษา โฮลดิ้ง', jobStatus: 'closed', closedDate: '2026-10-06', forecast: 180000, actual: 180000 }, steps: { ...YES('2026-08-28'), PAY1: ['2026-09-25', 'รับงวด 1'], PAY2: ['2026-10-05', 'รับงวด 2'] } },
    c4: { d: { client: 'ดับบลิวเอชเอ', jobStatus: 'closed', closedDate: '2026-04-30', forecast: 95000, actual: 95000 }, steps: { ...YES('2026-03-12'), PAY1: ['2026-04-20', 'รับครบ'] } },
    w1: { d: { client: 'แสนสิริ กรีน พร็อพเพอร์ตี้', forecast: 214000 }, steps: YES('2026-09-04'), pays: { PAY1: { amt: 107000, due: '2026-09-20', rcv: '2026-09-19' }, PAY2: { amt: 107000, due: '2026-10-20' } } },
    w2: { d: { client: 'ไทยออยล์ เอนเนอร์ยี่', forecast: 160500 }, steps: YES('2026-10-03'), pays: { PAY1: { amt: 80250, due: '2026-10-08' }, PAY2: { amt: 80250, due: '2026-11-15' } } },
    w3: { d: { client: 'เบทาโกร ฟู้ด', forecast: 98000 }, steps: YES('2026-10-09'), pays: { PAY1: { amt: 49000, due: '2026-10-15' }, PAY2: { amt: 49000, due: '2026-11-30' } } },
    demo3: { d: { client: 'คงธนา เซอร์วิส', forecast: 250000, actual: 125000 }, steps: { ...YES('2026-09-27'), PAY1: ['2026-10-06', 'รับงวดที่ 1 แล้ว'] } },
    dep2: { d: { client: 'ปทุมธานี ฟาร์มา', forecast: 530000, section: 'Depa', resp: 'คุณบี' }, steps: YES('2026-10-08'), pays: { PAY1: { amt: 212000, due: '2026-11-15' }, PAY2: { amt: 159000, due: '2026-12-15' }, PAY3: { amt: 159000, due: '2027-02-15' } } },
    // not money: lost, and a plan typed before the result
    demo7: { d: { forecast: 140000 }, steps: { 'CLOSED DEAL': ['2026-09-07', 'NO'] }, pays: { PAY1: { amt: 140000, due: '2026-10-01' } } },
    demo4: { d: { forecast: 320000 }, steps: { 'CLOSED DEAL': ['2026-10-05', 'รอผู้บริหารอนุมัติ'] }, pays: { PAY1: { amt: 320000, rel: 30 } } },
  });
}
const all = (s: SalesState) => cashLines(s, Object.values(s.deals), T);

describe('the demo world against the mockups', () => {
  const s = demo(), lines = all(s), Y = cashYear(lines, '2569');
  it('2569 by month: received on its day, owed on its due date (the ต.ค. bar is 541,250)', () => {
    const tot = Y.months.map(cashTotal);
    expect(tot).toEqual([0, 0, 0, 95000, 0, 120000, 0, 120000, 107000, 541250, 341250, 159000]);
    expect(Y.months[9]).toEqual({ got: 305000, late: 80250, wait: 156000, n: 5 });
    expect(Y.totals).toEqual({ got: 747000, late: 80250, wait: 656250, n: 13 });
    expect(Y.undated.map((l) => [l.deal.id, l.amt, l.kind])).toEqual([['demo3', 125000, 'owed']]);
  });
  it('the cards: year total, received, owed in the year with late and due this month, undated', () => {
    const k = cashKpis(Y, '2569', T);
    expect(k).toMatchObject({ total: 1483500, n: 13, got: 747000, gotN: 6, lastGot: '2026-10-06', owed: 736500, owedN: 7, late: 80250, lateN: 1, dueMonth: 156000, dueMonthN: 2, undated: 125000, undatedDeals: 1, from: {}, ownN: 13 });
    // 2570: only ปทุมธานี ฟาร์มา's third installment, from a deal of 2569
    const k70 = cashKpis(cashYear(lines, '2570'), '2570', T);
    expect(k70).toMatchObject({ total: 159000, n: 1, got: 0, owed: 159000, late: 0, dueMonth: 0, firstDue: '2027-02-15', undated: 0, from: { '2569': 1 }, ownN: 0 });
  });
  it('reconciles with today\'s KPI ค้างรับ: 1,020,500 = 736,500 in 2569 + 159,000 in 2570 + 125,000 undated', () => {
    const r = cashRecon(lines, '2569');
    expect(r).toEqual({ open: 1020500, inYear: 736500, byYear: [{ year: '2570', amt: 159000 }], undated: 125000, closedIn: 0, otherIn: 0 });
    const open = Object.values(s.deals).filter((d) => d.year === '2569' && d.jobStatus === 'open');
    expect(receivables(s, open, T).receivable).toBe(r.open);
    expect(r.open).toBe(r.inYear + r.byYear.reduce((a, y) => a + y.amt, 0) + r.undated);
    expect(cashKpis(Y, '2569', T).owed).toBe(r.inYear + r.closedIn + r.otherIn);
    // 2570 has no deals of its own: its card holds another year's installment
    expect(cashRecon(lines, '2570')).toEqual({ open: 0, inYear: 0, byYear: [], undated: 0, closedIn: 0, otherIn: 159000 });
  });
  it('the totals are the sum of the lines; quarters are the sum of their months', () => {
    expect(cashTotal(Y.totals)).toBe(Y.lines.reduce((a, l) => a + l.amt, 0));
    expect(Y.quarters.map(cashTotal)).toEqual([0, 215000, 227000, 1041500]);
    expect(Y.quarters.reduce((a, q) => a + q.got, 0)).toBe(Y.totals.got);
    expect(Y.quarters[3]).toEqual({ got: 305000, late: 80250, wait: 656250, n: 9 });
    expect(Y.lines.every((l) => l.date.startsWith('2026-'))).toBe(true);
  });
  it('the received money is the same core as the KPI footer "รับในช่วงนี้"', () => {
    const deals = Object.values(s.deals);
    expect(receivedIn(s, deals, { from: '2026-01-01', to: '2026-12-31' }, T)).toBe(Y.totals.got);
    expect(receivedIn(s, deals, { from: '2026-07-01', to: '2026-09-30' }, T)).toBe(Y.quarters[2].got);
    // c2's typed Actual comes in on its latest paid PAY stage (5 ต.ค.), not on PAY1's date
    expect(receivedOf(s, s.deals.c2, T)).toMatchObject([{ amt: 180000, date: '2026-10-05', stage: 'PAY2', src: 'typed' }]);
  });
  it('the CSV: a row per amount, the undated last with an empty month, ISO dates, empty cells empty', () => {
    const r = cashRows(s, '2569', Y, 'lines', true);
    expect(r.head).toEqual(['ปี (พ.ศ.)', 'เดือน', 'ลูกค้า', 'ปีของงาน', 'หมวด', 'ผู้รับผิดชอบ', 'งวด', 'ยอด (บาท)', 'ครบกำหนด', 'วันที่รับ', 'สถานะ', 'เลขใบเสนอราคา', 'ใบเสนอราคาร่วม (จำนวนบริษัท)']);
    expect(r.rows).toHaveLength(13 + 1);
    expect(r.rows[0]).toEqual(['2569', 'เม.ย. 2569', 'ดับบลิวเอชเอ', '2569', '', '', 'ไม่มีแผน', 95000, '', '2026-04-20', 'รับแล้ว', '', '']);
    expect(r.rows[1]).toEqual(['2569', 'มิ.ย. 2569', 'อมตะ คอร์ปอเรชัน', '2569', 'TGO', 'ปลา', '1/2', 120000, '2026-06-30', '2026-06-30', 'รับแล้ว', '', '']);
    expect(r.rows[13]).toEqual(['2569', '', 'คงธนา เซอร์วิส', '2569', '', '', 'ไม่มีแผน', 125000, '', '', 'ยังไม่กำหนดวันรับ', '', '']);
    expect(cashRows(s, '2569', Y, 'lines', false).rows).toHaveLength(13);
    const csv = cashCsv(r).split('\r\n');
    expect(csv).toHaveLength(15);
    expect(csv[2]).toBe('"2569","มิ.ย. 2569","อมตะ คอร์ปอเรชัน","2569","TGO","ปลา","1/2","120000","2026-06-30","2026-06-30","รับแล้ว","",""');
    const m = cashRows(s, '2569', Y, 'month', true);
    expect(m.rows).toHaveLength(13);
    expect(m.rows[9]).toEqual(['2569', 'ต.ค. 2569', 305000, 80250, 156000, 541250, 5]);
    expect(m.rows[12]).toEqual(['2569', 'ยังไม่กำหนดวันรับ', 0, 0, 125000, 125000, 1]);
    const q = cashRows(s, '2569', Y, 'quarter', false);
    expect(q.rows.map((x) => x[5])).toEqual([0, 215000, 227000, 1041500]);
  });
  it('words: the cross-year tag, the installment and its source, the year picker', () => {
    const own = (id: string) => lines.filter((l) => l.deal.id === id);
    expect(crossYearTag(own('dep2'), '2569')).toBe('ข้ามปี: งวด 3 อยู่ปี 2570');
    expect(crossYearTag(own('dep2'), '2570')).toBe('ข้ามปี: งวด 1–2 อยู่ปี 2569');
    expect(crossYearTag(own('w1'), '2569')).toBe('');
    expect(instWords([3, 1])).toBe('งวด 1, 3');
    const c4 = own('c4')[0], d3 = Y.undated[0], p3 = own('dep2')[2];
    expect([instText(c4), instSub(c4), statusWord(c4)]).toEqual(['ไม่มีแผน', 'รับที่ PAY1 · พิมพ์เอง', 'รับแล้ว']);
    expect([instText(d3), instSub(d3), statusWord(d3)]).toEqual(['ไม่มีแผน', 'ส่วนที่ยังไม่รับ', 'ยังไม่กำหนดวันรับ']);
    expect([instText(p3), instSub(p3), statusWord(p3)]).toEqual(['งวด 3/3', 'PAY3 · งวดเพิ่ม', 'รอรับ']);
    expect(statusWord(own('w2')[0])).toBe('เลยกำหนด');
    expect(statusWord(own('w3')[0])).toBe('ถึงกำหนด');
    expect(yearMoneyLabel(Y)).toBe('เงินเข้า 13 งวด');
    expect(yearMoneyLabel(cashYear(lines, '2568'))).toBe('ไม่มีเงินเข้า');
    expect(yearSplit(own('dep2'))).toEqual([{ year: '2569', n: 2, amt: 371000 }, { year: '2570', n: 1, amt: 159000 }]);
    expect(splitExample(lines)).toMatchObject({ deal: { id: 'dep2' }, total: 530000, n: 3, last: '2027-02-15' });
    expect(cashYears(lines)).toEqual(['2569', '2570']);
    expect(yearOptions(Object.values(s.deals), '2569', '2569', cashYears(lines))).toEqual(['2568', '2569', '2570']);
    expect(yearOptions([], '2569', '2569', ['2572'])).toEqual(['2568', '2569', '2570', '2572']);
  });
});

describe('money lines', () => {
  it('a deal paying 3 installments across the year end counts each in its own year', () => {
    const s = world({ x: { d: { forecast: 530000 }, steps: YES('2026-10-08'), pays: { PAY1: { amt: 212000, due: '2026-11-15' }, PAY2: { amt: 159000, due: '2026-12-15' }, PAY3: { amt: 159000, due: '2027-02-15' } } } });
    const lines = all(s), a = cashYear(lines, '2569'), b = cashYear(lines, '2570');
    expect(a.months[10].wait + a.months[11].wait).toBe(371000);
    expect(cashTotal(a.totals)).toBe(371000);
    expect(b.months[1]).toEqual({ got: 0, late: 0, wait: 159000, n: 1 });
    expect(cashTotal(a.totals) + cashTotal(b.totals)).toBe(530000);
    expect(lines.map((l) => [l.stage, l.n, l.of, l.dealYear])).toEqual([['PAY1', 1, 3, '2569'], ['PAY2', 2, 3, '2569'], ['PAY3', 3, 3, '2569']]);
  });
  it('an installment due in December but received in January counts in January of the next year', () => {
    const s = world({ x: { d: { forecast: 50000 }, steps: YES('2026-11-01'), pays: { PAY1: { amt: 50000, due: '2026-12-28', rcv: '2027-01-03' } } } });
    const lines = cashLines(s, Object.values(s.deals), '2027-01-10');
    expect(lines).toMatchObject([{ kind: 'got', date: '2027-01-03', due: '2026-12-28', rcv: '2027-01-03', status: 'paid' }]);
    expect(cashYear(lines, '2569').totals.n).toBe(0);
    expect(cashYear(lines, '2570').months[0].got).toBe(50000);
  });
  it('a part-paid installment: received on its day, the rest owed on its due date', () => {
    const s = world({ x: { d: { forecast: 100000 }, steps: YES('2026-08-01'), pays: { PAY1: { amt: 100000, due: '2026-09-15', rcv: '2026-09-01', got: 40000 } } } });
    expect(all(s).map((l) => [l.kind, l.amt, l.date, l.status, l.lateDays])).toEqual([['got', 40000, '2026-09-01', 'paid', 0], ['owed', 60000, '2026-09-15', 'late', 27]]);
  });
  it('a closed job still owing counts (the open-only KPI and owedIn leave it out), and the calendar shows it', () => {
    const s = demo();
    s.deals.w2.jobStatus = 'closed';
    const lines = all(s), Y = cashYear(lines, '2569');
    expect(Y.totals.late).toBe(80250);
    expect(lines.filter((l) => l.deal.id === 'w2').map((l) => l.amt)).toEqual([80250, 80250]);
    expect(owedIn(s, [s.deals.w2], { from: '2026-10-01', to: '2026-11-30' }, T)).toBe(0);
    expect(payDue(s, [s.deals.w2], '', '2026-12-31', T).map((x) => x.line.stage)).toEqual(['PAY1', 'PAY2']);
    // the line under the cards names it, so both figures still add up
    const r = cashRecon(lines, '2569');
    expect(r).toMatchObject({ open: 1020500 - 160500, inYear: 736500 - 160500, closedIn: 160500, otherIn: 0 });
    expect(cashKpis(Y, '2569', T).owed).toBe(r.inYear + r.closedIn + r.otherIn);
  });
  it('undated money goes to the deal year\'s bucket, never in a month or the totals', () => {
    const s = world({
      // won, no plan, a PAY stage left: Forecast − Actual
      a: { d: { forecast: 200000 }, steps: YES('2026-05-01') },
      // a typed Actual with no PAY stage dated
      b: { d: { forecast: 50000, actual: 50000 }, steps: YES('2026-05-01') },
      // a plan line with no due date
      c: { d: { forecast: 30000 }, steps: YES('2026-05-01'), pays: { PAY1: { amt: 30000 } } },
      // a line due 30 days after the win, on a deal not won: nothing at all
      d: { d: { forecast: 90000 }, pays: { PAY1: { amt: 90000, rel: 30 } } },
      // the next year's deal: its own bucket
      e: { d: { forecast: 10000, year: '2570' }, steps: YES('2027-01-05') },
    });
    const lines = all(s), Y = cashYear(lines, '2569');
    expect(Y.totals.n).toBe(0);
    expect(Y.undated.map((l) => [l.deal.id, l.kind, l.amt, l.src])).toEqual([['a', 'owed', 200000, 'rest'], ['b', 'got', 50000, 'typed'], ['c', 'owed', 30000, 'plan']]);
    expect(lines.some((l) => l.deal.id === 'd')).toBe(false);
    expect(cashYear(lines, '2570').undated.map((l) => l.deal.id)).toEqual(['e']);
    expect(cashKpis(Y, '2569', T)).toMatchObject({ undated: 280000, undatedDeals: 3, total: 0 });
  });
  it('a lost deal or one still in the pipeline brings no money; a cancelled installment none either', () => {
    const s = world({
      no: { d: { forecast: 100000, actual: 100000 }, steps: { 'CLOSED DEAL': ['2026-05-01', 'NO'], PAY1: ['2026-05-02', 'x'] }, pays: { PAY1: { amt: 100000, due: '2026-06-01', rcv: '2026-06-01' } } },
      wait: { d: { forecast: 50000 }, steps: { 'CLOSED DEAL': ['2026-05-01', 'รอผล'] }, pays: { PAY1: { amt: 50000, due: '2026-06-01' } } },
      none: { d: { forecast: 70000 } },
    });
    expect(all(s)).toEqual([]);
  });
  it('without a plan: Actual documents on their stage date, else the document date', () => {
    const s = world({ x: { d: { forecast: 3000 }, steps: { ...YES('2026-08-01'), PAY1: ['2026-09-03', 'โอนแล้ว'] } } });
    s.docs['x/r1'] = doc({ id: 'r1', amount: 2000, stage: 'PAY1', docNo: 'RC-1' });
    s.docs['x/r2'] = doc({ id: 'r2', amount: 500, stage: '', docDate: '2026-10-20' });
    const lines = all(s);
    expect(lines.map((l) => [l.kind, l.amt, l.date, l.src])).toEqual([['got', 2000, '2026-09-03', 'doc'], ['got', 500, '2026-10-20', 'doc'], ['owed', 500, '', 'rest']]);
    expect(instSub(lines[0])).toBe('ใบเสร็จ / ใบกำกับภาษี RC-1');
  });
  it('boundaries: calendar quarters and Buddhist-era years', () => {
    expect([quarterOf('2026-03-31'), quarterOf('2026-04-01'), quarterOf('2026-12-31')]).toEqual([0, 1, 3]);
    const s = world({ x: { d: { forecast: 4 }, steps: YES('2026-01-01'), pays: { PAY1: { amt: 1, due: '2026-03-31' }, PAY2: { amt: 1, due: '2026-04-01' }, PAY3: { amt: 1, due: '2026-12-31' }, PAY4: { amt: 1, due: '2027-01-01' } } } });
    const lines = all(s), a = cashYear(lines, '2569'), b = cashYear(lines, '2570');
    expect(a.quarters.map((q) => q.n)).toEqual([1, 1, 0, 1]);
    expect(a.months[11].n).toBe(1);
    expect(b.months[0].n).toBe(1);
  });
  it('a joint quotation counts once: until package quotes, every deal is plain', () => {
    const s = demo();
    expect(Object.values(s.deals).every((d) => jointRole(s, d) === 'plain')).toBe(true);
    expect(all(s).every((l) => l.joint === undefined)).toBe(true);
  });
});

describe('the money lens and the การรับเงิน filter', () => {
  const s = demo();
  it('a deal of 2569 with an installment in 2570 is in 2570 only with the money lens', () => {
    expect(filterDeals(s, { year: '2570' }, T)).toEqual([]);
    expect(filterDeals(s, { year: '2570', money: 'cash' }, T).map((d) => d.id)).toEqual(['dep2']);
    // its own year as before (every 2569 deal, won or not)
    expect(filterDeals(s, { year: '2569', money: 'cash' }, T).length).toBe(filterDeals(s, { year: '2569' }, T).length);
  });
  it('รับแล้ว / ค้างรับ / เลยกำหนด keep the deals with that money in the range, on its own dates', () => {
    const ids = (f: Parameters<typeof filterDeals>[1]) => filterDeals(s, f, T).map((d) => d.id).sort();
    expect(ids({ year: '2569', pay: 'got' })).toEqual(['c1', 'c2', 'c4', 'demo3', 'w1']);
    expect(ids({ year: '2569', pay: 'owed' })).toEqual(['dep2', 'w1', 'w2', 'w3']);
    expect(ids({ year: '2569', pay: 'late' })).toEqual(['w2']);
    // ไตรมาส 3 on "รับเงิน": พฤกษา's PAY1 stage is dated in Q3 but its money came in on 5 ต.ค.
    const q3 = { basis: 'contact' as const, preset: 'q3' as const, from: '2026-07-01', to: '2026-09-30' };
    expect(ids({ year: '2569', pay: 'got', date: q3 })).toEqual(['c1', 'w1']);
    expect(ids({ year: '2569', pay: 'got', date: { ...q3, preset: 'q4', from: '2026-10-01', to: '2026-12-31' } })).toEqual(['c2', 'demo3']);
    // without the filter the date basis reads basisDates as always (c2's PAY1 in Q3 counts as paid there)
    expect(ids({ year: '2569', date: { ...q3, basis: 'paid' } })).toEqual(['c1', 'c2', 'w1']);
    // 2570: the 2569 deal's installment
    expect(ids({ year: '2570', pay: 'owed' })).toEqual(['dep2']);
  });
  it('the filter shape keeps only what it knows', () => {
    const f = (x: unknown) => filterDeals(s, { year: '2569', ...(x as object) }, T).length;
    expect(f({ pay: 'bogus', money: 'x' })).toBe(filterDeals(s, { year: '2569' }, T).length);
    expect(payMatch(all(s)[0], '')).toBe(true);
  });
});

describe('the table lens and the Dashboard money', () => {
  const s = demo(), deals = Object.values(s.deals);
  it('2570 in the lens: the 2569 deal counts 159,000 (งวด 3), its first two installments stay in 2569', () => {
    const L = cashLensOf(s, filterDeals(s, { year: '2570', money: 'cash' }, T), '2570', null, T);
    const d = s.deals.dep2;
    expect(lensSum(L, [d])).toEqual({ fc: 159000, ac: 0 });
    expect(['PAY1', 'PAY2', 'PAY3'].map((p) => lensWhere(L, d, p))).toEqual([
      { inYear: false, text: 'อยู่ปี 2569' },
      { inYear: false, text: 'อยู่ปี 2569' },
      { inYear: true, text: 'นับในปี 2570' },
    ]);
    expect(L.K).toMatchObject({ total: 159000, owed: 159000, from: { '2569': 1 } });
    // a stage with no money line (a deal without a plan) says nothing
    expect(lensWhere(L, s.deals.c2, 'PAY1')).toEqual({ inYear: false, text: '' });
  });
  it('a date range narrows the counted installments; the cards are the year\'s', () => {
    const L = cashLensOf(s, deals, '2569', { from: '2026-10-01', to: '2026-12-31' }, T);
    expect(lensSum(L, deals)).toEqual({ fc: 1041500, ac: 305000 });
    expect(lensSum(L, [s.deals.c1])).toEqual({ fc: 0, ac: 0 });
    // undated money stays in its bucket whatever the range
    expect(L.K.undated).toBe(125000);
    expect(lensSum(cashLensOf(s, deals, '2569', null, T), deals).fc).toBe(cashTotal(cashYear(all(s), '2569').totals));
  });
  it('การรับเงิน in a range: received on its day, owed and late on the due date, undated in none', () => {
    const lines = all(s), y = { from: '2026-01-01', to: '2026-12-31' }, q3 = { from: '2026-07-01', to: '2026-09-30' };
    expect(payIn(lines, 'got', y)).toEqual({ amt: 747000, n: 6, deals: 5 });
    expect(payIn(lines, 'owed', y)).toEqual({ amt: 736500, n: 7, deals: 4 });
    expect(payIn(lines, 'late', y)).toEqual({ amt: 80250, n: 1, deals: 1 });
    expect(payIn(lines, 'got', q3)).toEqual({ amt: 227000, n: 2, deals: 2 });
    // the quarter card and the stat read the same lines: the four quarters add up to the year
    const Y = cashYear(lines, '2569');
    expect([0, 1, 2, 3].map((q) => payIn(lines, 'got', { from: `2026-${String(q * 3 + 1).padStart(2, '0')}-01`, to: ['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31'][q] }).amt)).toEqual(Y.quarters.map((x) => x.got));
    expect(payIn(lines, 'owed', { from: '2027-01-01', to: '2027-12-31' }).amt).toBe(159000);
  });
});

describe('the chart axis and the help centre', () => {
  it('a round step about a third of the top, from 0', () => {
    expect(moneyTicks(601500)).toEqual({ ticks: [0, 200000, 400000, 600000], top: 601500 });
    expect(moneyTicks(1190000)).toEqual({ ticks: [0, 500000, 1000000], top: 1190000 });
    expect(moneyTicks(159000).ticks).toEqual([0, 50000, 100000, 150000]);
    expect(moneyTicks(0)).toEqual({ ticks: [0], top: 1 });
    expect([0, 50000, 200000, 1000000, 1500000, 2500].map(compactBaht)).toEqual(['0', '50K', '200K', '1M', '1.5M', '2.5K']);
  });
  it('finds the Cashflow topic', () => {
    expect(searchHelp('Cashflow').topics[0].id).toBe('sales-cashflow');
    expect(searchHelp('นับยอด').topics[0].id).toBe('sales-lens');
    expect(searchHelp('การรับเงิน').topics[0].id).toBe('sales-dash-money');
  });
});
