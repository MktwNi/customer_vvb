import { describe, expect, it } from 'vitest';
import { cardHides, cardYear, reusedOnSubmit } from './similarCard';

const CO = { name: 'บริษัท ทดสอบ จำกัด', jur: '0105500000011', sameName: 1 };

/** Would an exact-name submit merge into the registry company (core.ts build): only then is the card redundant. */
describe('reusedOnSubmit: the submit merges the new customer into the company', () => {
  it('the name typed and no juristic id typed: reused', () => {
    expect(reusedOnSubmit({ name: 'บริษัท ทดสอบ จำกัด', jur: '' }, CO)).toBe(true);
  });

  it('the name typed as normalised (legal-form words and brackets left out, either side) and the same juristic id: reused', () => {
    expect(reusedOnSubmit({ name: 'ทดสอบ', jur: CO.jur }, CO)).toBe(true);
    expect(reusedOnSubmit({ name: 'บริษัท ทดสอบ', jur: '' }, CO)).toBe(true);
    expect(reusedOnSubmit({ name: 'ทดสอบ จำกัด (มหาชน)', jur: '' }, CO)).toBe(true);
  });

  it('a juristic id typed that is not the company\'s string (another number, or the same digits dashed): not reused', () => {
    expect(reusedOnSubmit({ name: CO.name, jur: '0105500000022' }, CO)).toBe(false);
    expect(reusedOnSubmit({ name: CO.name, jur: '0-1055-00000-01-1' }, CO)).toBe(false);
    expect(reusedOnSubmit({ name: CO.name, jur: ' ' }, CO)).toBe(false);
  });

  it('another name with the juristic id only, or a partial name: not reused', () => {
    expect(reusedOnSubmit({ name: 'ชื่อคนละคำ ทดสอบ', jur: CO.jur }, CO)).toBe(false);
    expect(reusedOnSubmit({ name: 'ทดสอบ เอ', jur: '' }, CO)).toBe(false);
  });

  it('two companies of one name: not reused (no merge decides which)', () => {
    expect(reusedOnSubmit({ name: CO.name, jur: '' }, { ...CO, sameName: 2 })).toBe(false);
  });

  it('no juristic id on the company: not reused (the card stays, the one way to reuse it)', () => {
    expect(reusedOnSubmit({ name: CO.name, jur: '' }, { ...CO, jur: '' })).toBe(false);
  });
});

/** The registry-match card of the add-customer dialog: left off a company whose jobs are all in other years. */
describe('cardHides: the registry-match card for a job being added in a year', () => {
  const reused = { reused: true };

  it('a company with jobs only in the year being added keeps its card', () => {
    expect(cardHides({ ...reused, jobYears: ['2569'] }, '2569')).toBe(false);
    expect(cardHides({ ...reused, jobYears: ['2568', '2569'] }, '2569')).toBe(false);
  });

  it('a company whose jobs are all in another year is left off the card, when the submit reuses it', () => {
    expect(cardHides({ ...reused, jobYears: ['2568'] }, '2569')).toBe(true);
    expect(cardHides({ ...reused, jobYears: ['2567', '2568'] }, '2569')).toBe(true);
  });

  it('a company with no job at all keeps its card (nothing to say it is the same work)', () => {
    expect(cardHides({ ...reused, jobYears: [] }, '2569')).toBe(false);
  });

  it('a company the submit does not reuse keeps its card, whatever its jobs', () => {
    expect(cardHides({ reused: false, jobYears: ['2568'] }, '2569')).toBe(false);
  });
});

/** The year the card is for: the job's year in the Sales Tracker, the deal's year from a deal's card, none otherwise. */
describe('cardYear: the year the registry-match card is for', () => {
  it('a job added in the Sales Tracker: the year picked for the job', () => {
    expect(cardYear({ deal: true }, '2569', undefined)).toBe('2569');
  });

  it('the dialog opened from a deal (link, no job): the linked deal\'s year', () => {
    expect(cardYear({ deal: false, link: 'd1' }, '2569', '2568')).toBe('2568');
    expect(cardYear({ deal: false, link: 'd1' }, '2569', undefined)).toBeUndefined();
  });

  it('no deal and no link (the customer added from the menu): no year, every match is offered', () => {
    expect(cardYear({ deal: false }, '2569', undefined)).toBeUndefined();
  });
});
