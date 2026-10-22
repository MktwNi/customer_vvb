/**
 * The date chip's native input (DateChip): a year typed key by key reports partial values; only the complete day
 * is saved. Covers the values a browser reports while 2027-10-22 is typed (the partial ones were saved before, as
 * a deal's contact date 0202-10-22 that showed "22 ต.ค." with no year and counted 666,202 days overdue).
 */
import { describe, expect, it } from 'vitest';
import { dateInputChange } from './dateInput';

describe('dateInputChange (the date chip\'s native input)', () => {
  it('commits a complete day: four digits in the year, a real calendar day', () => {
    expect(dateInputChange('2027-10-22')).toEqual({ commit: '2027-10-22', draft: '' });
    expect(dateInputChange('1000-01-01').commit).toBe('1000-01-01');
  });

  it('keeps a year still being typed as the draft, never as the saved day', () => {
    for (const raw of ['0002-10-22', '0020-10-22', '0202-10-22', '0257-10-22', '0999-12-31']) {
      expect(dateInputChange(raw)).toEqual({ commit: null, draft: raw });
    }
  });

  it('keeps an empty field (the browser has no day: year 0, or the year cleared) as an empty draft', () => {
    expect(dateInputChange('')).toEqual({ commit: null, draft: '' });
  });

  it('does not commit a year of five or six digits, nor a day that does not exist', () => {
    expect(dateInputChange('20270-10-22')).toEqual({ commit: null, draft: '20270-10-22' });
    expect(dateInputChange('2027-02-30')).toEqual({ commit: null, draft: '2027-02-30' });
    expect(dateInputChange('2027-13-01').commit).toBeNull();
  });

  it('a whole typed sequence saves only the last value', () => {
    const typed = ['0002-10-22', '0020-10-22', '0202-10-22', '2027-10-22'];
    const saved = typed.map((raw) => dateInputChange(raw).commit).filter((x): x is string => x != null);
    expect(saved).toEqual(['2027-10-22']);
  });
});
