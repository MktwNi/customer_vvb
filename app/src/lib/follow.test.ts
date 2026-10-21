import { describe, expect, it } from 'vitest';
import { LOCAL_ONLY, NOT_IN_TRACKER, apptLine, apptWhen, expiringIn, followCounts, followIdsOf, followMatch, followMeta, followRank, followRows, sortFollow, type FollowFacts, type FollowSrc } from './follow';
import { emptySales, newDeal, type Deal } from './sales';
import type { Company, Task } from './types';

const TODAY = '2026-10-12';
const f = (name: string, p: Partial<FollowFacts> = {}): FollowFacts => ({ name, next: '', cfoSt: 'active', cfoDays: 200, giSoon: false, giDays: null, ...p });
const names = (l: { name: string }[]) => l.map((x) => x.name);

describe('the order of บริษัทที่ติดตาม', () => {
  it('ranks an appointment due, then a certificate about to expire, then no appointment, then the rest', () => {
    expect(followRank(f('a', { next: '2026-10-01' }), TODAY)).toBe(0);
    expect(followRank(f('a', { next: TODAY }), TODAY)).toBe(0);
    expect(followRank(f('a', { cfoSt: 'soon', cfoDays: 30, next: '2026-10-20' }), TODAY)).toBe(1);
    expect(followRank(f('a', { giSoon: true, giDays: 60 }), TODAY)).toBe(1);
    expect(followRank(f('a'), TODAY)).toBe(2);
    // an expired CFO is not "about to expire": with no appointment it waits with the others
    expect(followRank(f('a', { cfoSt: 'expired', cfoDays: -40 }), TODAY)).toBe(2);
    expect(followRank(f('a', { next: '2026-10-13' }), TODAY)).toBe(3);
  });

  it('a past appointment comes before an expiring certificate, even one expiring tomorrow', () => {
    const l = sortFollow([f('ใกล้หมด', { cfoSt: 'soon', cfoDays: 1 }), f('เลยนัด', { next: '2026-10-11' })], TODAY);
    expect(names(l)).toEqual(['เลยนัด', 'ใกล้หมด']);
  });

  it('orders inside a group: oldest appointment, fewest days left, by name, nearest appointment', () => {
    const l = sortFollow(
      [
        f('ข นัดถัดไปไกล', { next: '2026-11-30' }),
        f('ค ไม่มีนัด'),
        f('ก นัดถัดไปใกล้', { next: '2026-10-14' }),
        f('ง GI เหลือ 20', { giSoon: true, giDays: 20 }),
        f('จ CFO เหลือ 45', { cfoSt: 'soon', cfoDays: 45 }),
        f('ฉ นัดวันนี้', { next: TODAY }),
        f('ช เลยนัด 5 วัน', { next: '2026-10-07' }),
        f('ก ไม่มีนัด'),
      ],
      TODAY,
    );
    expect(names(l)).toEqual(['ช เลยนัด 5 วัน', 'ฉ นัดวันนี้', 'ง GI เหลือ 20', 'จ CFO เหลือ 45', 'ก ไม่มีนัด', 'ค ไม่มีนัด', 'ก นัดถัดไปใกล้', 'ข นัดถัดไปไกล']);
  });

  it('takes the nearest of the two expiries, and none when neither is expiring', () => {
    expect(expiringIn({ cfoSt: 'soon', cfoDays: 40, giSoon: true, giDays: 12 })).toBe(12);
    expect(expiringIn({ cfoSt: 'active', cfoDays: 40, giSoon: false, giDays: 12 })).toBeNull();
    expect(expiringIn({ cfoSt: 'soon', cfoDays: 0, giSoon: false, giDays: null })).toBe(0);
  });

  it('does not change the list it was given', () => {
    const l = [f('ข'), f('ก', { next: '2026-10-01' })];
    sortFollow(l, TODAY);
    expect(names(l)).toEqual(['ข', 'ก']);
  });
});

describe('the words of an appointment', () => {
  it('says how far it is, red when past its day and amber today', () => {
    expect(apptWhen('2026-10-09', TODAY)).toEqual({ text: 'เลยกำหนด 3 วัน', kind: 'bad' });
    expect(apptWhen(TODAY, TODAY)).toEqual({ text: 'วันนี้', kind: 'warn' });
    expect(apptWhen('2026-10-13', TODAY)).toEqual({ text: 'พรุ่งนี้', kind: '' });
    expect(apptWhen('2026-10-22', TODAY)).toEqual({ text: 'อีก 10 วัน', kind: '' });
    // across a month and a year end
    expect(apptWhen('2027-01-01', '2026-12-31')).toEqual({ text: 'พรุ่งนี้', kind: '' });
    expect(apptWhen('2026-09-30', '2026-10-01')).toEqual({ text: 'เลยกำหนด 1 วัน', kind: 'bad' });
  });

  it('names the type, the day in Thai and the time when there is one', () => {
    expect(apptLine({ type: 'call', date: '2026-10-14', time: '10:00' })).toBe('โทร · 14 ต.ค. 2569 10:00');
    expect(apptLine({ type: 'meet', date: '2026-11-02', time: '' })).toBe('นัดพบ · 2 พ.ย. 2569');
  });
});

// ---- the rows, from what the engine holds
const co = (id: number, name: string, p: Partial<Company> = {}): Company =>
  ({ id, name, code: 'GCC-' + id, hay: name.toLowerCase(), prov: 1, cfoSt: 'active', days: 300, giDays: null, giLive: null, fl: { giSoon: false }, ...p }) as unknown as Company;
const task = (id: string, gid: number, date: string, p: Partial<Task> = {}): Task => ({ id, gid, title: '', type: 'call', date, time: '', note: '', done: false, ...p });
function src(o: { watch: number[]; cos: Company[]; tasks?: Task[]; deals?: Deal[]; owners?: Record<string, string>; merged?: Record<number, number> }): FollowSrc {
  const sales = emptySales();
  (o.deals || []).forEach((d) => (sales.deals[d.id] = d));
  const canon = (id: number) => o.merged?.[id] ?? id;
  return {
    crm: { watch: o.watch, owners: o.owners || {} },
    sales,
    company: (id) => o.cos.find((c) => c.id === canon(id)),
    tasksOf: (id) => (o.tasks || []).filter((t) => canon(t.gid) === id),
    dealsOf: (id) => Object.values(sales.deals).filter((d) => d.gid != null && canon(d.gid) === id),
  };
}
const deal = (id: string, gid: number, year: string, p: Partial<Deal> = {}) => newDeal({ id, client: 'c' + gid, gid, year, ...p }, 'x', '2026-09-01T00:00:00Z');

describe('followRows', () => {
  it('lists each followed company once, leaves out one no longer in the data, and orders them', () => {
    const e = src({
      watch: [1, 2, 3, 99, 4],
      // 4 was merged into 1 (two followed rows of one company)
      merged: { 4: 1 },
      cos: [co(1, 'ก ไม่มีนัด'), co(2, 'ข เลยนัด'), co(3, 'ค ใกล้หมดอายุ', { cfoSt: 'soon', days: 20 })],
      tasks: [task('t1', 2, '2026-10-05'), task('t2', 2, '2026-10-20'), task('t3', 3, '2026-10-30', { done: true })],
    });
    const rows = followRows(e, '2569', TODAY);
    expect(names(rows)).toEqual(['ข เลยนัด', 'ค ใกล้หมดอายุ', 'ก ไม่มีนัด']);
    // the earliest appointment not done yet; a done one is no plan
    expect(rows[0].task?.id).toBe('t1');
    expect(rows[1].task).toBeNull();
  });

  it('reads the Sales Tracker of the year only, its open row first, never a joint quotation header', () => {
    const d68 = deal('d68', 1, '2568', { resp: 'คุณบี' });
    const closed = deal('dc', 1, '2569', { jobStatus: 'closed', at: '2026-10-01T00:00:00Z' });
    const open = deal('do', 1, '2569', { at: '2026-01-01T00:00:00Z' });
    const head = deal('dh', 2, '2569');
    const e = src({ watch: [1, 2, 3], cos: [co(1, 'ก'), co(2, 'ข'), co(3, 'ค')], deals: [d68, closed, open, head] });
    e.sales.jqt = { dh: { at: '', by: '', name: '' } } as unknown as typeof e.sales.jqt;
    const rows = followRows(e, '2569', TODAY);
    const by = (n: string) => rows.find((r) => r.name === n)!;
    expect(by('ก').deal?.id).toBe('do');
    expect(by('ก').status).toBe('ยังไม่เริ่ม');
    // its two jobs this year (one closed): the list says the open one and "อีก 1 งาน"
    expect(by('ก').jobs).toBe(2);
    expect(by('ข').jobs).toBe(0);
    expect(by('ข').deal).toBeNull();
    expect(by('ข').status).toBe('');
    expect(by('ค').deal).toBeNull();
    // another year's row is not this year's
    expect(followRows(e, '2570', TODAY).find((r) => r.name === 'ก')!.deal).toBeNull();
    expect(NOT_IN_TRACKER).toBe('ยังไม่อยู่ใน Sales Tracker');
  });

  it('takes the owner from the company, else its row of the year, else its newest row', () => {
    const e = src({
      watch: [1, 2, 3, 4],
      cos: [co(1, 'ก'), co(2, 'ข'), co(3, 'ค'), co(4, 'ง')],
      owners: { 1: 'หมิว' },
      deals: [deal('a', 1, '2569', { resp: 'คุณบี' }), deal('b', 2, '2569', { resp: 'คุณบี' }), deal('c', 3, '2567', { resp: 'ปลา' }), deal('d', 3, '2568', { resp: 'ฝน' })],
    });
    const own = Object.fromEntries(followRows(e, '2569', TODAY).map((r) => [r.name, r.owner]));
    expect(own).toEqual({ ก: 'หมิว', ข: 'คุณบี', ค: 'ฝน', ง: '' });
  });

  it('counts what needs doing', () => {
    const e = src({
      watch: [1, 2, 3, 4],
      cos: [co(1, 'ก'), co(2, 'ข', { cfoSt: 'soon', days: 10 }), co(3, 'ค'), co(4, 'ง', { giDays: 30, fl: { giSoon: true } as Company['fl'] })],
      tasks: [task('a', 1, '2026-10-01'), task('b', 3, TODAY)],
      deals: [deal('x', 2, '2569')],
    });
    expect(followCounts(followRows(e, '2569', TODAY), TODAY)).toEqual({ late: 1, today: 1, expiring: 2, noPlan: 2, notIn: 3 });
  });

  it('filters by every word typed: name, province, owner or code', () => {
    const e = src({ watch: [1, 2], cos: [co(1, 'บริษัท กรีนวัลเลย์ ฟู้ดส์ จำกัด', { hay: 'บริษัท กรีนวัลเลย์ ฟู้ดส์ จำกัด gcc-1' }), co(2, 'บริษัท เอบีซี จำกัด')], owners: { 2: 'คุณบี' } });
    const [a, b] = followRows(e, '2569', TODAY).sort((x, y) => x.c.id - y.c.id);
    expect(followMatch('', a, 'ชลบุรี')).toBe(true);
    expect(followMatch('กรีน  ฟู้ดส์', a, 'ชลบุรี')).toBe(true);
    expect(followMatch('GCC-1', a, 'ชลบุรี')).toBe(true);
    expect(followMatch('ชลบุรี', a, 'ชลบุรี')).toBe(true);
    expect(followMatch('กรีน ระยอง', a, 'ชลบุรี')).toBe(false);
    expect(followMatch('คุณบี', b, 'ระยอง')).toBe(true);
    expect(followMatch('คุณบี', a, 'ชลบุรี')).toBe(false);
  });
});

describe('which followed ids are a company', () => {
  // 19831 was merged into 19; 7 is a company of its own
  const canon = (id: number) => (id === 19831 ? 19 : id);
  it('its own id and a row since merged into it, nothing else', () => {
    expect(followIdsOf([19831], 19, canon)).toEqual([19831]);
    expect(followIdsOf([7, 19, 19831], 19, canon)).toEqual([19, 19831]);
    expect(followIdsOf([7], 19, canon)).toEqual([]);
    expect(followIdsOf([], 19, canon)).toEqual([]);
  });
});

describe('the grey line under a followed company', () => {
  it('province and code; on a connected team, a company only this device has says so', () => {
    expect(followMeta({ id: 12, code: 'GCC-12' }, 'ชลบุรี', true)).toBe('ชลบุรี · GCC-12');
    expect(followMeta({ id: 12, code: 'GCC-12' }, '', false)).toBe('ไม่ระบุจังหวัด · GCC-12');
    // from the TGO website sync (900000 ≤ id < 1e12): not shared with the team
    expect(followMeta({ id: 900004, code: 'GCC-900004' }, 'ระยอง', true)).toBe('ระยอง · GCC-900004 · ' + LOCAL_ONLY);
    // not connected: everything is on this device, so nothing to point out
    expect(followMeta({ id: 900004, code: 'GCC-900004' }, 'ระยอง', false)).toBe('ระยอง · GCC-900004');
    // a customer added by hand is shared like a registry company
    expect(followMeta({ id: 1e12 + 5, code: '' }, 'ระยอง', true)).toBe('ระยอง');
  });
});
