/**
 * Keeping a closed job for a follow-up and its new cycle (lib/recontact.ts): the date rules, the รอติดต่อใหม่ list
 * (its rule and its order), the words for a due date, the years a new cycle may start in, and the fields it copies.
 */
import { describe, expect, it } from 'vitest';
import {
  CYCLE_LABEL, KEEP_LABEL, cycleBlock, cycleDefault, cycleFields, cycleIdOf, cycleLogIdOf, cycleLogs, cycleYears, dueWords, isoDay, keptLine, nextYear, recontactDue, recontactErr, recontactList, recontactOf, yearLater,
} from './recontact';
import { emptySales, newDeal, toDeal, type Deal, type SalesState } from './sales';

const TODAY = '2026-10-22';
function deal(s: SalesState, id: string, p: Partial<Deal> = {}) {
  s.deals[id] = newDeal({ id, year: '2569', section: 'Retention', order: Object.keys(s.deals).length, client: 'บริษัท ทองมงคล จำกัด', gid: 8238, ...p }, 'หมิว', '2026-10-01T03:00:00.000Z');
  return s.deals[id];
}
function joint(s: SalesState, hid: string, members: string[]) {
  s.jqt = { ...(s.jqt || {}), [hid]: { title: 'ใบเสนอราคาร่วม', at: '2026-10-02T00:00:00.000Z', by: 'หมิว' } };
  s.jqm = { ...(s.jqm || {}) };
  members.forEach((m, i) => (s.jqm![`${hid}/${m}`] = { share: null, pct: null, at: `2026-10-02T00:00:0${i}.000Z`, by: 'หมิว' }));
}

describe('dates', () => {
  it('a real calendar date is yyyy-mm-dd; anything else is not one', () => {
    expect(isoDay('2026-10-22')).toBe('2026-10-22');
    expect(isoDay('2028-02-29')).toBe('2028-02-29');
    expect(isoDay('2026-02-29')).toBe(''); // not a leap year
    expect(isoDay('2026-02-30')).toBe('');
    expect(isoDay('2026-13-01')).toBe('');
    expect(isoDay('22/10/2026')).toBe('');
    expect(isoDay('')).toBe('');
    expect(isoDay(undefined)).toBe('');
  });

  it('a year later is the same day, 29 February going to 28 February', () => {
    expect(yearLater('2026-10-22')).toBe('2027-10-22');
    expect(yearLater('2027-01-31')).toBe('2028-01-31');
    expect(yearLater('2028-02-29')).toBe('2029-02-28');
  });

  it('the date typed for a follow-up: required, a real date, today or later', () => {
    expect(recontactErr('', TODAY)).toBe('ใส่วันที่ติดต่อใหม่');
    expect(recontactErr('2026-02-30', TODAY)).toBe('วันที่ไม่ถูกต้อง');
    expect(recontactErr('2026-10-21', TODAY)).toBe('วันที่ติดต่อใหม่ต้องเป็นวันนี้หรือหลังจากนี้');
    expect(recontactErr(TODAY, TODAY)).toBe('');
    expect(recontactErr('2027-10-22', TODAY)).toBe('');
  });

  it('a due date is one on or before today; the list says so in words', () => {
    expect(recontactDue('2026-10-21', TODAY)).toBe(true);
    expect(recontactDue(TODAY, TODAY)).toBe(true);
    expect(recontactDue('2026-10-23', TODAY)).toBe(false);
    expect(recontactDue('', TODAY)).toBe(false);
    expect(dueWords('2026-10-22', TODAY)).toBe('ถึงกำหนดแล้ว');
    expect(dueWords('2026-11-01', TODAY)).toBe('');
    expect(keptLine('2027-10-22')).toBe('เก็บไว้ติดตาม · ติดต่อใหม่ 22 ต.ค. 2570');
    expect(KEEP_LABEL).toBe('ปิดแต่เก็บไว้ติดตาม');
    expect(CYCLE_LABEL).toBe('เปิดรอบใหม่');
  });
});

describe('the รอติดต่อใหม่ list', () => {
  it('holds closed single jobs with a real recontact date, of every year, by the date then by company', () => {
    const s = emptySales();
    deal(s, 'late', { jobStatus: 'closed', recontact: '2027-03-01', client: 'บริษัท ก' });
    deal(s, 'early-b', { jobStatus: 'closed', recontact: '2026-10-01', client: 'บริษัท ข', year: '2568' });
    deal(s, 'early-a', { jobStatus: 'closed', recontact: '2026-10-01', client: 'บริษัท ก ก' });
    deal(s, 'plain', { jobStatus: 'closed' }); // a plain ปิดงาน
    deal(s, 'open', { jobStatus: 'open', recontact: '2026-10-01' }); // open: not closed, not listed
    deal(s, 'bad', { jobStatus: 'closed', recontact: '2026-02-30' }); // not a date: not listed
    const got = recontactList(s, Object.values(s.deals)).map((d) => d.id);
    expect(got).toEqual(['early-a', 'early-b', 'late']);
  });

  it('leaves out a joint quotation\'s header and its companies, whatever they carry', () => {
    const s = emptySales();
    deal(s, 'head', { jobStatus: 'closed', recontact: '2026-10-01' });
    deal(s, 'member', { jobStatus: 'closed', recontact: '2026-10-01', gid: 9001 });
    deal(s, 'single', { jobStatus: 'closed', recontact: '2026-10-05', gid: 9002 });
    joint(s, 'head', ['member']);
    expect(recontactList(s, Object.values(s.deals)).map((d) => d.id)).toEqual(['single']);
    expect(recontactOf(s, s.deals.member)).toBe('');
    expect(recontactOf(s, s.deals.head)).toBe('');
  });

  it('a job reopened, or with no date, is not on it; the date of an open job is not read', () => {
    const s = emptySales();
    deal(s, 'a', { jobStatus: 'open', recontact: '2026-10-05' });
    deal(s, 'b', { jobStatus: 'closed', recontact: '' });
    expect(recontactOf(s, s.deals.a)).toBe('');
    expect(recontactOf(s, s.deals.b)).toBe('');
    expect(recontactList(s, Object.values(s.deals))).toEqual([]);
  });
});

describe('a new cycle (เปิดรอบใหม่)', () => {
  it('the years it may start in: the tracker\'s years and the next, later than the job\'s own, each once', () => {
    const rows = [{ year: '2568' }, { year: '2569' }, { year: '2569' }];
    expect(cycleYears(rows, '2568', '2570')).toEqual(['2569', '2570']);
    expect(cycleYears(rows, '2569', '2570')).toEqual(['2570']);
    expect(cycleYears([], '2569', '2570')).toEqual(['2570']);
    expect(cycleDefault(['2569', '2570'], '2570')).toBe('2570');
    expect(cycleDefault(['2569'], '2570')).toBe('2569');
    expect(cycleDefault([], '2570')).toBe('');
    expect(nextYear('2026-10-22')).toBe('2570');
  });

  it('is refused for an open job and for a joint quotation\'s row, and says why', () => {
    const s = emptySales();
    deal(s, 'open', { jobStatus: 'open' });
    deal(s, 'closed', { jobStatus: 'closed' });
    deal(s, 'head', { jobStatus: 'closed' });
    deal(s, 'member', { jobStatus: 'closed', gid: 9001 });
    joint(s, 'head', ['member']);
    expect(cycleBlock(s, s.deals.open)).toContain('ปิดงานก่อน');
    expect(cycleBlock(s, s.deals.head)).toContain('ใบเสนอราคาร่วม');
    expect(cycleBlock(s, s.deals.member)).toContain('ใบเสนอราคาร่วม');
    expect(cycleBlock(s, s.deals.closed)).toBe('');
  });

  it('copies the company, contact, owner, referral, section, sources and services; nothing of the work', () => {
    const s = emptySales();
    const old = deal(s, 'old', {
      jobStatus: 'closed', closedDate: '2026-09-30', contactDate: '2026-09-01', recontact: '2027-01-01', gid: 8238, client: 'บริษัท ทองมงคล จำกัด',
      contactName: 'คุณสมชาย', phone: '081-111-2222', email: 'somchai@example.com', resp: 'หมิว', referral: 'งานแนะนำ', section: 'TGO',
      source: ['TGO', 'Web'], service: ['CFO', 'CFP'], forecast: 500000, actual: 480000, fcAt: '2026-09-02T00:00:00.000Z', at: '2026-01-01T00:00:00.000Z', by: 'หมิว',
    });
    const f = cycleFields(old, '2570');
    expect(f).toEqual({
      year: '2570', section: 'TGO', gid: 8238, client: 'บริษัท ทองมงคล จำกัด', contactName: 'คุณสมชาย', phone: '081-111-2222', email: 'somchai@example.com',
      resp: 'หมิว', referral: 'งานแนะนำ', source: ['TGO', 'Web'], service: ['CFO', 'CFP'], contactDate: '', jobStatus: 'open', closedDate: '', from: 'old',
    });
    // nothing else of the job comes along (no money, no result, no recontact, no record of its own)
    expect(f).not.toHaveProperty('forecast');
    expect(f).not.toHaveProperty('actual');
    expect(f).not.toHaveProperty('recontact');
    expect(f).not.toHaveProperty('id');
    // the copies do not share arrays with the old job
    expect(f.service).not.toBe(old.service);
    expect(cycleLogs('2569', '2570')).toEqual({ old: 'เปิดรอบใหม่ปี 2570', next: 'ต่อจากรอบปี 2569' });
  });
});

describe('the new job\'s id: one per old job and year, the same on every browser', () => {
  it('the same id for the same old job and year; another year or another old job gives another id; a plain id with no "/"', () => {
    const a = cycleIdOf('job-1', '2570');
    expect(cycleIdOf('job-1', '2570')).toBe(a);
    expect(cycleIdOf('job-1', '2571')).not.toBe(a);
    expect(cycleIdOf('job-2', '2570')).not.toBe(a);
    expect(a).toMatch(/^cy-[0-9a-z]+$/);
    // the two history lines of one cycle: each its own id, the same on every browser
    expect(cycleLogIdOf('job-1', '2570', 'old')).toBe(cycleLogIdOf('job-1', '2570', 'old'));
    expect(cycleLogIdOf('job-1', '2570', 'old')).not.toBe(cycleLogIdOf('job-1', '2570', 'next'));
    expect(cycleLogIdOf('job-1', '2570', 'old')).not.toBe(cycleLogIdOf('job-1', '2571', 'old'));
    expect(cycleLogIdOf('job-1', '2570', 'old')).toMatch(/^cl-[0-9a-z]+$/);
  });
});

describe('a recontact date is read only on a closed job', () => {
  it('toDeal keeps the date of a closed job and drops it on an open one (a reopening or a stale write)', () => {
    const row = { year: '2569', client: 'บริษัท ทองมงคล จำกัด', recontact: '2027-10-22', at: '2026-10-01T03:00:00.000Z', by: 'หมิว' };
    expect(toDeal({ ...row, jobStatus: 'closed' }, 'a')!.recontact).toBe('2027-10-22');
    expect(toDeal({ ...row, jobStatus: 'open' }, 'a')!.recontact).toBeUndefined();
    expect(toDeal({ ...row }, 'a')!.recontact).toBeUndefined();
    const s = emptySales();
    s.deals.a = toDeal({ ...row, jobStatus: 'open' }, 'a')!;
    expect(recontactOf(s, s.deals.a)).toBe('');
    expect(recontactList(s, [s.deals.a])).toEqual([]);
  });
});
