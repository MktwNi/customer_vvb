import { describe, expect, it } from 'vitest';
import { emptySales, newDeal, quickMatch, stageTrack, type SalesState } from './sales';
import { localDay, telHref } from './format';

const TODAY = '2026-10-08';
const mk = (steps: Record<string, { d?: string; n?: string }>, extra: string[] = []) => {
  const s: SalesState = emptySales();
  s.cfg.stages = [...s.cfg.stages, ...extra];
  const d = newDeal({ id: 'x', client: 'ลูกค้า' }, 'A');
  s.deals.x = d;
  Object.entries(steps).forEach(([k, v]) => (s.steps['x/' + k] = { d: v.d || '', n: v.n || '' }));
  return { s, d };
};

describe('stage track (the progress line in the Sales Tracker)', () => {
  it('a new deal: the first stage is next', () => {
    const { s, d } = mk({});
    const t = stageTrack(s, d, TODAY);
    expect(t.next).toBe('CALL1');
    expect(t.states.CALL1).toBe('next');
    expect(t.states.CALL2).toBe('future');
  });

  it('done, skipped and planned stages; a planned one is next', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'โทร' }, QUOTATION: { d: '2026-10-20' } });
    const t = stageTrack(s, d, TODAY);
    expect(t.states).toMatchObject({ CALL1: 'done', CALL2: 'skipped', QUOTATION: 'planned' });
    expect(t.next).toBe('QUOTATION');
  });

  it('CLOSED DEAL with only a past date is not done: the result is asked for before the payments', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'โทร' }, QUOTATION: { d: '2026-09-10', n: 'QT' }, 'CLOSED DEAL': { d: '2026-10-01' } });
    const t = stageTrack(s, d, TODAY);
    expect(t.states['CLOSED DEAL']).toBe('next');
    expect(t.next).toBe('CLOSED DEAL');
    expect(t.states.PAY1).toBe('future');
  });

  it('a decision meeting booked ahead is planned and next (the stages before it were skipped)', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'x' }, 'CLOSED DEAL': { d: '2026-10-30' } });
    const t = stageTrack(s, d, TODAY);
    expect(t.states).toMatchObject({ 'CLOSED DEAL': 'planned', CALL2: 'skipped' });
    expect(t.next).toBe('CLOSED DEAL');
  });

  it('waiting for the result, won (payments next) and lost (nothing more)', () => {
    expect(stageTrack(mk({ 'CLOSED DEAL': { d: '2026-10-01', n: 'รอผู้บริหาร' } }).s, mk({ 'CLOSED DEAL': { d: '2026-10-01', n: 'รอผู้บริหาร' } }).d, TODAY).next).toBe('CLOSED DEAL');
    const won = mk({ 'CLOSED DEAL': { d: '2026-10-01', n: 'YES' }, PAY1: { d: '2026-10-05', n: 'รับแล้ว' } });
    expect(stageTrack(won.s, won.d, TODAY)).toMatchObject({ next: 'PAY2', result: 'YES' });
    expect(quickMatch(won.s, won.d, 'payment', TODAY)).toBe(true);
    const lost = mk({ CALL1: { d: '2026-09-01', n: 'x' }, 'CLOSED DEAL': { d: '2026-10-01', n: 'NO' } });
    const t = stageTrack(lost.s, lost.d, TODAY);
    expect(t.next).toBe('');
    expect(t.states.PAY1).toBe('off');
  });

  it('a stage added after the payments (an import) does not make an undecided deal look finished', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'x' }, MEETING: { d: '2026-09-05', n: 'ประชุม' } }, ['MEETING']);
    const t = stageTrack(s, d, TODAY);
    expect(t.next).toBe('CLOSED DEAL');
    expect(quickMatch(s, d, 'payment', TODAY)).toBe(false);
    const won = mk({ 'CLOSED DEAL': { d: '2026-09-01', n: 'YES' }, PAY1: { d: '2026-09-02', n: 'x' }, PAY2: { d: '2026-09-03', n: 'x' } }, ['MEETING']);
    expect(quickMatch(won.s, won.d, 'payment', TODAY)).toBe(false); // MEETING is not a payment
  });

  it('only one stage is next', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'x' }, QUOTATION: { d: '2026-10-20' }, 'CLOSED DEAL': { d: '2026-10-01' } });
    const t = stageTrack(s, d, TODAY);
    expect(Object.values(t.states).filter((x) => x === 'next').length).toBeLessThanOrEqual(1);
  });
});

describe('call links and local dates', () => {
  it('dials the first number, with an extension after a pause', () => {
    expect(telHref('02-111-0000 ต่อ 214')).toBe('tel:021110000,214');
    expect(telHref('081-234-5678 | 02-555-1234')).toBe('tel:0812345678');
    expect(telHref('02-555-1234 / 089-999-9999')).toBe('tel:025551234');
    expect(telHref('+66 81 234 5678')).toBe('tel:+66812345678');
    expect(telHref('02-111-0000 ext. 12')).toBe('tel:021110000,12');
    expect(telHref('')).toBe('');
  });
  it('turns a timestamp into the local day', () => {
    const iso = new Date(2026, 9, 8, 6, 30).toISOString(); // 06:30 local
    expect(localDay(iso)).toBe('2026-10-08');
  });
});
