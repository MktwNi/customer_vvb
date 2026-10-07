import { describe, expect, it } from 'vitest';
import { emptySales, filterDeals, newDeal, salesStats, type Deal, type SalesState } from './sales';
import { beYearInput, facetOptions, winRateBySource, yearOptions } from './salesUi';

const deal = (p: Partial<Deal> = {}): Deal => newDeal({ id: p.id || 'd' + Math.random().toString(36).slice(2), client: 'บริษัท ก', year: '2569', ...p }, 'me', '2026-10-01T00:00:00.000Z');
const state = (deals: Deal[], steps: SalesState['steps'] = {}): SalesState => ({ ...emptySales(), deals: Object.fromEntries(deals.map((d) => [d.id, d])), steps });

describe('import year prompt', () => {
  it('takes a Buddhist-era year only', () => {
    expect(beYearInput('2569')).toEqual({ year: '2569' });
    expect(beYearInput(' ๒๕๖๘ ')).toEqual({ year: '2568' });
    expect(beYearInput('พ.ศ. 2567')).toEqual({ year: '2567' });
    for (const bad of ['', '69', '1999', '2600', 'ปีนี้', '2569/70']) expect(beYearInput(bad)).toBeNull();
  });
  it('turns a Christian-era year into its BE year, flagged for a confirm', () => {
    expect(beYearInput('2025')).toEqual({ year: '2568', ce: '2025' });
    expect(beYearInput('ค.ศ. 2026')).toEqual({ year: '2569', ce: '2026' });
  });
});

describe('year picker', () => {
  it('lists this year ±1, the year shown and every year with deals — also one added after the first call', () => {
    const S = state([deal({ id: 'a', year: '2569' })]);
    expect(yearOptions(Object.values(S.deals), '2569', '2569')).toEqual(['2568', '2569', '2570']);
    S.deals.b = deal({ id: 'b', year: '2566' }); // the engine adds deals to the same object (import, team sync)
    expect(yearOptions(Object.values(S.deals), '2569', '2569')).toEqual(['2566', '2568', '2569', '2570']);
    expect(yearOptions([], '2560', '2569')).toEqual(['2560', '2568', '2569', '2570']);
  });
});

describe('table filters', () => {
  it('offers every owner of the year, and keeps the chosen one when other filters leave none of its rows', () => {
    const a = deal({ id: 'a', resp: 'สมชาย' });
    const b = deal({ id: 'b', resp: 'สมหญิง' });
    const c = deal({ id: 'c', resp: '' });
    const S = state([a, b, c], { 'a/CLOSED DEAL': { d: '2026-09-01', n: 'YES' }, 'b/CLOSED DEAL': { d: '2026-09-01', n: 'NO' } });
    const shown = filterDeals(S, { year: '2569', resp: 'สมหญิง', result: 'YES' });
    expect(shown).toEqual([]);
    // built from the rows shown, the list would lose สมหญิง and the select would read "ทั้งหมด"
    expect(facetOptions(filterDeals(S, { year: '2569' }), 'resp', 'สมหญิง')).toEqual(['(ไม่ระบุ)', 'สมชาย', 'สมหญิง']);
    expect(facetOptions(shown, 'resp', 'สมหญิง')).toContain('สมหญิง');
    expect(facetOptions([], 'referral', '')).toEqual([]);
  });
});

describe('dashboard', () => {
  it('win rate per channel keeps a channel that lost every decided deal (0%)', () => {
    const a = deal({ id: 'a', source: ['TGO'] });
    const b = deal({ id: 'b', source: ['TGO'] });
    const c = deal({ id: 'c', source: ['SET/mai'] });
    const d = deal({ id: 'd', source: ['Partner'] }); // no result yet: no win rate
    const S = state([a, b, c, d], { 'a/CLOSED DEAL': { d: '', n: 'YES' }, 'b/CLOSED DEAL': { d: '', n: 'NO' }, 'c/CLOSED DEAL': { d: '', n: 'NO' } });
    const st = salesStats(S, [a, b, c, d], '2026-10-07');
    expect(st.winRate).toBe(33);
    expect(winRateBySource(st.bySource)).toEqual([['SET/mai', 0], ['TGO', 50]]); // in SOURCE list order
  });
});
