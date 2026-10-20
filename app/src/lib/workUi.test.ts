/**
 * The screens agree (owner: "how many companies we worked for", the 10-company quotation closed once): for the
 * same tracker and the same filters, the ปิดงาน tab's line, its counter, the Dashboard's ทำงานให้ card, the
 * export's menu line and the export's columns (their SUM in Excel) say the same numbers, and the money once.
 * Each screen's figure is read here the way the screen reads it (lib/workUi: its list and its words; the
 * engine's workTally and closedCsv), so a screen that drifted to a count of its own fails here.
 */
import { describe, expect, it } from 'vitest';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { DEAL_STAGE, jointAttr, jointOf, moneySum, normSalesFilter, stepOf, type SalesFilter, type SalesState } from './sales';
import { closeSummary, closedJoint, closedOrder, payerShort } from './joint';
import { closedExportSub, closedLine, closedMeta, closedTabRows, jointCloseCount, lineText, workCardRows, workCardSub } from './workUi';
import { IDS, PAYER, T, b82, none, world, yes10 } from './work.fixture';
import type { DateF } from './dateRange';

/** This browser alone (no team): every capability, the tracker `s`. */
function eng(s: SalesState) {
  const e = new GccEngine();
  e.store = memoryStore();
  e.sales = s;
  return e;
}
/** The CSV as Excel reads it: its header, rows, a column's SUM and a cell. */
function sheet(text: string) {
  const [head, ...rows] = text.split('\r\n').map((l) => l.slice(1, -1).split('","').map((x) => x.replace(/""/g, '"')));
  const col = (k: string) => {
    const i = head.indexOf(k);
    if (i < 0) throw new Error('no column ' + k);
    return i;
  };
  return { head, rows, sum: (k: string) => rows.reduce((a, r) => a + (Number(r[col(k)]) || 0), 0), cell: (i: number, k: string) => rows[i][col(k)] };
}
type Fx = Omit<SalesFilter, 'year'>;
/** Every screen's figures for tracker `e` and the filters `F` (the table's, the ปิดงาน tab's and the Dashboard's
 *  rows are each one: the same filters picked on both). */
function screens(e: GccEngine, F: Fx = {}) {
  const S = e.sales, Fy = normSalesFilter({ year: '2569', ...F }), attr = jointAttr(Fy);
  // ปิดงาน (tabs/Sales.tsx: closedRows, ClosedView's line and small line)
  const rows = closedTabRows(S, Fy, T);
  const t = e.workTally(rows, { attr }), m = moneySum(S, rows, attr);
  // its tab's counter (Sales: closedN, the year without filters)
  const counter = e.workTally(closedTabRows(S, { year: '2569' }, T)).jobs;
  // the Dashboard's card (tabs/SalesDash.tsx)
  const card = e.workTally(workCardRows(S, Fy, T), { attr }).worked;
  // the export (⋯ on the ปิดงาน tab: its menu line and the file)
  const csv = sheet(e.closedCsv(rows, attr));
  return { t, m, rows, counter, card, csv, line: lineText(closedLine(t, { fc: m.fc, ac: m.ac })), meta: closedMeta(t, ''), menu: closedExportSub(e.workTally(rows, { attr })) };
}
/** The numbers every screen must share, read off each. */
const agree = (x: ReturnType<typeof screens>) => {
  expect(x.card).toBe(x.t.worked);
  expect(x.csv.sum('นับเป็นงาน')).toBe(x.t.jobs);
  expect(x.csv.sum('นับเป็นบริษัทที่ทำงานให้')).toBe(x.t.worked);
  expect(x.csv.sum('FORECAST (บาท)')).toBe(x.m.fc);
  expect(x.csv.sum('ACTUAL (บาท)')).toBe(x.m.ac);
  expect(x.line.startsWith(`ปิดแล้ว ${x.t.jobs} งาน · ทำงานให้ ${x.t.worked} บริษัท`)).toBe(true);
  expect(x.menu).toBe(`${x.t.jobs} งาน · ทำงานให้ ${x.t.worked} บริษัท · ตามตัวกรองของแท็บนี้`);
};

describe('the ปิดงาน line, its counter, the Dashboard card and the export say the same', () => {
  it('10 YES / 8 YES + 2 NO / no company results: 6 jobs and 13 / 11 / 3 companies everywhere; the money once', () => {
    for (const [s, worked, lost, noResult] of [[yes10(), 13, 2, 0], [b82(), 11, 4, 0], [none(), 3, 2, 10]] as const) {
      const x = screens(eng(s));
      agree(x);
      expect(x.line).toBe(`ปิดแล้ว 6 งาน · ทำงานให้ ${worked} บริษัท · Forecast 1,725,000 · Actual 1,515,000`);
      expect(x.counter).toBe(6);
      expect(x.t).toMatchObject({ jobs: 6, worked, lost, noResult });
      // one row per company, the payer's row once with the money: 5 + 1 + 10
      expect(x.csv.rows).toHaveLength(16);
    }
    // the small line: the joint quotation's sentence (there is one), the lost, the rows waiting for a result
    expect(screens(eng(yes10())).meta).toBe('ใบเสนอราคาร่วม 1 ใบนับเป็น 1 งาน เงินนับครั้งเดียว · นับบริษัทที่ได้งาน บริษัทซ้ำนับครั้งเดียว · ไม่ได้งาน 2 บริษัท · เปิดกลับได้');
    expect(screens(eng(none())).meta).toContain('ยังไม่มีผล 10 บริษัท');
    // no joint quotation in the list: no sentence about it
    const plain = screens(eng(yes10()), { section: { v: ['Retention'] } });
    expect(plain.t.joint).toBe(0);
    expect(plain.meta).not.toContain('ใบเสนอราคาร่วม');
  });

  it('the export is the list as shown: the band first (its payer\'s row with the money, then its companies), then the other rows; one count column 1 per job, one per company', () => {
    const e = eng(yes10()), x = screens(e), S = e.sales;
    const order = closedOrder(S, x.rows).flatMap((r) => (r.k === 'band' ? [r.g.head.id, ...r.shown.map((d) => d.id)] : [r.d.id]));
    expect(order).toEqual(['h', ...IDS, 'c1', 'c2', 'c3', 'c4', 'c5']);
    expect(x.csv.rows.map((r) => r[x.csv.head.indexOf('POTENTIAL CLIENT')])).toEqual(order.map((id) => S.deals[id].client));
    expect([x.csv.cell(0, 'FORECAST (บาท)'), x.csv.cell(0, 'นับเป็นงาน'), x.csv.cell(0, 'นับเป็นบริษัทที่ทำงานให้')]).toEqual(['1000000', '1', '']);
    expect([x.csv.cell(1, 'FORECAST (บาท)'), x.csv.cell(1, 'นับเป็นงาน'), x.csv.cell(1, 'นับเป็นบริษัทที่ทำงานให้')]).toEqual(['', '', '1']);
    // a lost plain job: a job, no company worked for
    expect([x.csv.cell(13, 'POTENTIAL CLIENT'), x.csv.cell(13, 'นับเป็นงาน'), x.csv.cell(13, 'นับเป็นบริษัทที่ทำงานให้')]).toEqual(['บริษัท สหพัฒน์ จำกัด', '1', '']);
    // the other tabs' export keeps its columns (no count columns there)
    expect(e.salesCsv(x.rows).split('\r\n')[0].endsWith('"แผนชำระ"')).toBe(true);
  });

  it('under ผู้รับผิดชอบ: หมิว 695,000 and คุณบี 160,000 on the line and in the file; the payer\'s row comes along with the part counted', () => {
    const e = eng(yes10());
    const mew = screens(e, { resp: { v: ['หมิว'] } });
    agree(mew);
    expect(mew.line).toBe('ปิดแล้ว 2 งาน · ทำงานให้ 7 บริษัท · Forecast 695,000 · Actual 695,000');
    const bee = screens(e, { resp: { v: ['คุณบี'] } });
    agree(bee);
    expect(bee.line).toBe('ปิดแล้ว 2 งาน · ทำงานให้ 1 บริษัท · Forecast 160,000 · Actual 100,000');
    // the payer's row is filtered out of the list, yet the file has it: the job and คุณบี's company's part
    expect(bee.rows.some((d) => d.id === 'h')).toBe(false);
    expect([bee.csv.cell(0, 'POTENTIAL CLIENT'), bee.csv.cell(0, 'FORECAST (บาท)'), bee.csv.cell(0, 'นับเป็นงาน')]).toEqual([PAYER, '100000', '1']);
    expect(bee.csv.cell(0, 'ใบเสนอราคาร่วม')).toContain('นับส่วนของ 1 บริษัทตามตัวกรอง');
    // every person: the screens agree; the companies and the money add up to the whole, the jobs to more
    const all = screens(e);
    const people = ['หมิว', 'คุณบี', 'ปลา', 'มกร', 'คุณเอ'].map((p) => screens(e, { resp: { v: [p] } }));
    people.forEach(agree);
    expect(people.reduce((a, x) => a + x.t.worked, 0)).toBe(all.t.worked);
    expect(people.reduce((a, x) => a + x.csv.sum('FORECAST (บาท)'), 0)).toBe(all.csv.sum('FORECAST (บาท)'));
    expect(people.reduce((a, x) => a + x.t.jobs, 0)).toBeGreaterThan(all.t.jobs);
  });

  it('searching the quotation\'s number: "ปิดแล้ว 1 งาน · ทำงานให้ 10 บริษัท", the file 11 rows (the payer\'s and its 10)', () => {
    const x = screens(eng(yes10()), { q: 'CFP 10' });
    agree(x);
    expect(x.line).toBe('ปิดแล้ว 1 งาน · ทำงานให้ 10 บริษัท · Forecast 1,000,000 · Actual 1,000,000');
    expect(x.csv.rows).toHaveLength(11);
    // the tab's counter is the year's, the filter aside
    expect(x.counter).toBe(6);
  });

  it('a period: the card reads it on the closing day (whatever basis the range has, and การรับเงิน aside), as the ปิดงาน tab does on its ปิดงาน basis', () => {
    const e = eng(yes10());
    const q4 = (basis: DateF['basis']): DateF => ({ basis, preset: 'q4', from: '2026-10-01', to: '2026-12-31' });
    const tab = screens(e, { date: q4('closed') });
    agree(tab);
    // Q4: พฤกษา, บ้านปู and the quotation closed then
    expect(tab.t).toMatchObject({ jobs: 3, worked: 11 });
    for (const F of [{ date: q4('contact') }, { date: q4('paid'), pay: 'got' as const }, { date: q4('result') }]) expect(screens(e, F).card).toBe(tab.t.worked);
    expect(workCardSub(4, true)).toBe('ได้งานและปิดในไตรมาส 4 · ไม่นับซ้ำ');
    expect(workCardSub(0, true)).toBe('ได้งานและปิดในช่วงนี้ · ไม่นับซ้ำ');
    expect(workCardSub(0, false)).toBe('ได้งานและปิดงานแล้ว · ไม่นับซ้ำ');
  });

  it('the closing dialog\'s "ทำงานให้ N บริษัท" is what the ปิดงาน line gains when the quotation closes', () => {
    const e = eng(world({ closed: false }));
    const g = jointOf(e.sales, { id: 'h' })!, sum = closeSummary(e.sales, g, T), A = closedJoint(e.sales, g, T);
    const c = jointCloseCount({
      worked: e.workTally(g.members.map((x) => A.deals[x.deal.id]), { s: A }).worked,
      fill: sum.fill, filled: sum.rows.filter((x) => x.by).length, waiting: sum.rows.filter((x) => !/^(YES|NO)$/.test(x.after)).length, payer: payerShort(g),
    });
    expect(c.count).toBe('ปิดแล้วนับเป็น 1 งาน · ทำงานให้ 10 บริษัท');
    expect(c.more[0]).toBe('บริษัทที่ยังไม่มีผลจะบันทึกเป็น “ได้งาน” ตามผลของ มจพ');
    const before = screens(e);
    expect(before.t).toMatchObject({ jobs: 5, worked: 3 });
    expect(e.closeJoint('h')).toBe(11);
    const after = screens(e);
    agree(after);
    expect([after.t.jobs - before.t.jobs, after.t.worked - before.t.worked]).toEqual([1, 10]);
    expect(stepOf(e.sales, 'm1', DEAL_STAGE)).toEqual({ d: '2026-10-05', n: 'YES' });
    // no result from the payer yet: none counts until it is recorded, and the dialog says so
    const u = world({ closed: false, payer: '' }), gu = jointOf(u, { id: 'h' })!, su = closeSummary(u, gu, T);
    const cu = jointCloseCount({ worked: 0, fill: su.fill, filled: 0, waiting: su.rows.filter((x) => !/^(YES|NO)$/.test(x.after)).length, payer: payerShort(gu) });
    expect(cu.count).toBe('ปิดแล้วนับเป็น 1 งาน · ทำงานให้ 0 บริษัท');
    expect(cu.more[0]).toBe('บริษัทที่ยังไม่มีผลจะนับเป็นบริษัทที่ทำงานให้เมื่อบันทึกผลของ มจพ');
  });
});
