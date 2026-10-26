/**
 * Feed values as the TGO sheet shows them: ids with thousands commas, shares as percent text, dates as
 * Buddhist-year text, ISO or JSON Date strings. Each reads to the same clean value.
 */
import { describe, expect, it } from 'vitest';
import { dateOf, fromFeed, idOf, shareOf, type FeedRow } from './tgoSync';

const row = (o: Partial<Record<keyof FeedRow, unknown>>) =>
  ({ id: '', cert: 'TGO CFO FY27-1', act: '', org: 'บริษัท ทดสอบ จำกัด', branch: '', prov: 'กรุงเทพฯ', addr: '', tambon: '', amphoe: '', changwat: '', zip: '', ind: '', size: '', apBE: '', exBE: '', ap: '', ex: '', s1: null, s2: null, s3: null, fy: '', note: '', flags: '', ...o }) as unknown as FeedRow;

describe('feed values read tolerantly', () => {
  it('ids: thousands commas and a trailing .0 are dropped', () => {
    expect(idOf('32,040')).toBe('32040');
    expect(idOf(32040)).toBe('32040');
    expect(idOf('32040.0')).toBe('32040');
    expect(idOf(' 1,234,567 ')).toBe('1234567');
    expect(idOf('')).toBe('');
    expect(idOf(null)).toBe('');
  });

  it('shares: percent text and fractions both read as a fraction; anything else is null', () => {
    expect(shareOf('12.20%')).toBe(0.122);
    expect(shareOf('12.20 %')).toBe(0.122);
    expect(shareOf('85.23%')).toBe(0.8523);
    expect(shareOf('0.1448')).toBe(0.1448);
    expect(shareOf(0.0029)).toBe(0.0029);
    expect(shareOf(12.2)).toBe(0.122); // a bare number above 1 is a percentage
    expect(shareOf('')).toBeNull();
    expect(shareOf('-')).toBeNull();
    expect(shareOf(null)).toBeNull();
  });

  it('dates: ISO, Buddhist or Gregorian dd/mm/yyyy, JSON dates (Bangkok day) and Date strings', () => {
    expect(dateOf('2026-10-21')).toBe('2026-10-21');
    expect(dateOf('21/10/2569')).toBe('2026-10-21');
    expect(dateOf('21/10/2026')).toBe('2026-10-21');
    expect(dateOf('2026-10-20T17:00:00.000Z')).toBe('2026-10-21'); // Apps Script's JSON of local midnight, Bangkok = UTC+7
    expect(dateOf('2026-10-21T00:00:00+07:00')).toBe('2026-10-21');
    expect(dateOf('Wed Oct 21 2026 00:00:00 GMT+0700 (Indochina Time)')).toBe('2026-10-21');
    expect(dateOf('')).toBe('');
    expect(dateOf('ไม่ใช่วันที่')).toBe('');
  });

  it('a feed row with those display values maps to clean fields', () => {
    const it0 = fromFeed(row({ id: '32,040', s1: '12.20%', s2: '30%', s3: '57.80%', ap: '2026-10-20T17:00:00.000Z', ex: '', apBE: '21/10/2569', exBE: '20/10/2570' }));
    expect(it0).toMatchObject({ id: '32040', s1: 0.122, s2: 0.3, s3: 0.578, ap: '2026-10-21', ex: '2027-10-20' });
    // the date text is used when the ISO column is blank
    expect(fromFeed(row({ apBE: '21/10/2569', ap: '' })).ap).toBe('2026-10-21');
  });
});
