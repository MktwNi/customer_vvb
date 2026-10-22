import { describe, expect, it } from 'vitest';
import { cardHides } from './similarCard';

/** The registry-match card of the add-customer dialog: left off a company whose jobs are all in other years. */
describe('cardHides: the registry-match card for a job being added in a year', () => {
  const one = { sameName: 1, hasJur: true };

  it('a company with jobs only in the year being added keeps its card', () => {
    expect(cardHides({ ...one, jobYears: ['2569'] }, '2569')).toBe(false);
    expect(cardHides({ ...one, jobYears: ['2568', '2569'] }, '2569')).toBe(false);
  });

  it('a company whose jobs are all in another year is left off the card', () => {
    expect(cardHides({ ...one, jobYears: ['2568'] }, '2569')).toBe(true);
    expect(cardHides({ ...one, jobYears: ['2567', '2568'] }, '2569')).toBe(true);
  });

  it('a company with no job at all keeps its card (nothing to say it is the same work)', () => {
    expect(cardHides({ ...one, jobYears: [] }, '2569')).toBe(false);
  });

  it('a company with a job in the year and one in another keeps its card', () => {
    expect(cardHides({ ...one, jobYears: ['2568', '2569'] }, '2569')).toBe(false);
  });

  it('two companies of one name: both keep their cards, the one picked decides', () => {
    expect(cardHides({ sameName: 2, hasJur: true, jobYears: ['2568'] }, '2569')).toBe(false);
  });

  it('no juristic id: the card stays, because a new customer typed with that name is not merged into it', () => {
    expect(cardHides({ sameName: 1, hasJur: false, jobYears: ['2568'] }, '2569')).toBe(false);
  });
});
