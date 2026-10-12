import { afterEach, describe, expect, it, vi } from 'vitest';
import { monthEnd, normDateF, presetList, rangeTh, resolveDate, twinOf, weekStart, type DatePreset, type Range } from './dateRange';
import { localDay, todayISO } from './format';

// 2026-10-12 is a Monday; the tracker's year 2569
const T = '2026-10-12';
const ranges = (be: string, today: string, forward = false) => Object.fromEntries(presetList(be, today, forward).map((p) => [p.k, p.r]));

describe('weeks start on Monday', () => {
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday ends the week
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
  });
});

describe('ready-made ranges', () => {
  it('this year: about today', () => {
    const r = ranges('2569', T);
    expect(r.today).toEqual({ from: T, to: T });
    expect(r.week).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(r.last7).toEqual({ from: '2026-10-06', to: '2026-10-12' });
    expect(r.month).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.prevMonth).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(r.quarter).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(r.year).toBeNull(); // ทั้งปี = no date filter
    expect(presetList('2569', T).map((p) => p.k)).toEqual(['today', 'week', 'last7', 'month', 'prevMonth', 'quarter', 'year', 'custom']);
  });
  it('due dates look forward', () => {
    const r = ranges('2569', T, true);
    expect(r.next7).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(r.nextMonth).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect('last7' in r || 'prevMonth' in r).toBe(false);
  });
  it('stays inside the year: January and December', () => {
    const jan = ranges('2569', '2026-01-03');
    expect('prevMonth' in jan).toBe(false);
    expect(jan.last7).toEqual({ from: '2026-01-01', to: '2026-01-03' });
    expect(jan.week).toEqual({ from: '2026-01-01', to: '2026-01-04' });
    const dec = ranges('2569', '2026-12-28', true);
    expect('nextMonth' in dec).toBe(false);
    expect(dec.next7).toEqual({ from: '2026-12-28', to: '2026-12-31' });
  });
  it('another year: its quarters', () => {
    const P = presetList('2570', T);
    expect(P.map((p) => p.k)).toEqual(['q1', 'q2', 'q3', 'q4', 'year', 'custom']);
    expect(P[0].r).toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(P[3].r!.to).toBe('2027-12-31');
    expect(P[4].label).toBe('ทั้งปี 2570');
  });
  it('knows leap years', () => {
    expect(monthEnd('2028-02-10')).toBe('2028-02-29'); // BE 2571
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
  });
  it('a named range is worked out again from today; a custom one keeps its days', () => {
    expect(resolveDate({ basis: 'contact', preset: 'today', from: '2026-10-11', to: '2026-10-11' }, '2569', T)).toEqual({ from: T, to: T });
    expect(resolveDate({ basis: 'contact', preset: 'custom', from: '2026-09-01', to: '2026-09-05' }, '2569', T)).toEqual({ from: '2026-09-01', to: '2026-09-05' });
    // due dates: 7 วันข้างหน้า
    expect(resolveDate({ basis: 'due', preset: 'next7', from: '', to: '' }, '2569', T)).toEqual({ from: T, to: '2026-10-18' });
  });
  it('twins when the basis turns to due dates and back', () => {
    const pairs: [DatePreset, DatePreset][] = [['last7', 'next7'], ['next7', 'last7'], ['prevMonth', 'nextMonth'], ['nextMonth', 'prevMonth'], ['month', 'month'], ['today', 'today']];
    for (const [a, b] of pairs) expect(twinOf(a)).toBe(b);
  });
});

describe('a range in Thai words', () => {
  const r = (from: string, to: string): Range => ({ from, to });
  it('reads by what the range covers', () => {
    expect(rangeTh(r('2026-10-12', '2026-10-12'))).toBe('12 ต.ค. 2569');
    expect(rangeTh(r('2026-10-01', '2026-10-31'))).toBe('ต.ค. 2569');
    expect(rangeTh(r('2026-10-01', '2026-12-31'))).toBe('ต.ค. – ธ.ค. 2569');
    expect(rangeTh(r('2026-12-01', '2027-01-31'))).toBe('ธ.ค. 2569 – ม.ค. 2570');
    expect(rangeTh(r('2026-10-01', '2026-10-12'))).toBe('1–12 ต.ค. 2569');
    expect(rangeTh(r('2026-09-15', '2026-10-12'))).toBe('15 ก.ย. – 12 ต.ค. 2569');
    expect(rangeTh(r('2026-12-15', '2027-01-15'))).toBe('15 ธ.ค. 2569 – 15 ม.ค. 2570');
  });
  it('drops the year inside the table\'s year (the KPI caption)', () => {
    expect(rangeTh(r('2026-10-01', '2026-10-31'), { dropYear: '2569' })).toBe('ต.ค.');
    expect(rangeTh(r('2026-10-01', '2026-12-31'), { dropYear: '2569' })).toBe('ต.ค. – ธ.ค.');
    expect(rangeTh(r('2026-12-01', '2027-01-31'), { dropYear: '2569' })).toBe('ธ.ค. 2569 – ม.ค. 2570');
    expect(rangeTh(r('2027-03-01', '2027-03-31'), { dropYear: '2569' })).toBe('มี.ค. 2570');
  });
});

describe('a stored date filter made safe', () => {
  it('puts the days in order, fills a missing end, drops what is not a filter', () => {
    expect(normDateF({ basis: 'contact', preset: 'custom', from: '2026-10-12', to: '2026-10-01' }, '2569')).toEqual({ basis: 'contact', preset: 'custom', from: '2026-10-01', to: '2026-10-12' });
    expect(normDateF({ basis: 'paid', preset: 'custom', from: '2026-10-12' }, '2569')).toEqual({ basis: 'paid', preset: 'custom', from: '2026-10-12', to: '2026-10-12' });
    expect(normDateF({ basis: 'contact', preset: 'custom', from: '12/10/2026', to: '2026-10-12' }, '2569')).toBeNull();
    expect(normDateF({ basis: 'contact', preset: 'custom', from: '2026-02-30', to: '2026-03-01' }, '2569')).toBeNull();
    expect(normDateF({ basis: 'payday', preset: 'custom', from: T, to: T }, '2569')).toBeNull();
    expect(normDateF({ basis: 'contact', preset: 'decade', from: T, to: T }, '2569')).toBeNull();
    expect(normDateF({ basis: 'contact', preset: 'year', from: T, to: T }, '2569')).toBeNull(); // ทั้งปี is never stored
    expect(normDateF(null, '2569')).toBeNull();
  });
  it('keeps a custom range inside the year before to the year after', () => {
    expect(normDateF({ basis: 'due', preset: 'custom', from: '2026-12-15', to: '2027-01-15' }, '2569')).not.toBeNull();
    expect(normDateF({ basis: 'due', preset: 'custom', from: '2025-01-01', to: '2025-01-31' }, '2569')).not.toBeNull();
    expect(normDateF({ basis: 'due', preset: 'custom', from: '2024-12-31', to: '2025-01-31' }, '2569')).toBeNull();
    expect(normDateF({ basis: 'due', preset: 'custom', from: '2027-12-01', to: '2028-01-01' }, '2569')).toBeNull();
  });
});

describe('local days', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = tz;
  });
  it('today and a timestamp are the day in Thailand, not in UTC', () => {
    process.env.TZ = 'Asia/Bangkok';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T17:30:00Z'));
    expect(todayISO()).toBe('2026-10-12');
    expect(localDay('2026-10-11T17:30:00.000Z')).toBe('2026-10-12');
  });
});
