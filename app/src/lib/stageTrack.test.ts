import { describe, expect, it } from 'vitest';
import { dealSteps, emptySales, newDeal, quickMatch, stageTrack, type SalesState } from './sales';
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

describe('stage track (the progress line in the Sales Tracker): the five steps', () => {
  const ids = (s: SalesState, d: ReturnType<typeof mk>['d']) => dealSteps(s, d, TODAY).steps.map((v) => v.id);
  it('a new deal: five steps, the first is next', () => {
    const { s, d } = mk({});
    const t = dealSteps(s, d, TODAY);
    expect(t.steps.map((v) => [v.code, v.th])).toEqual([
      ['CONTACT', 'ติดต่อประสานงาน'], ['QUOTATION', 'ส่งใบเสนอราคา'], ['FOLLOW', 'ติดตามผล'], ['CLOSE', 'ผลการขาย (YES / NO)'], ['PAY', 'ชำระเงิน'],
    ]);
    expect(ids(s, d)).toEqual(['CONTACT', 'QUOTATION', 'FOLLOW', 'CLOSED DEAL', 'PAY1']);
    expect(t.next?.id).toBe('CONTACT');
    expect(t.steps[0].state).toBe('next');
    expect([t.done, t.total]).toEqual([0, 5]);
    expect(stageTrack(s, d, TODAY)).toMatchObject({ next: 'CONTACT', done: 0, total: 5 });
  });

  it('done, skipped and planned steps; a planned one is next', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'โทร' }, FOLLOW: { d: '2026-10-20' } });
    const t = stageTrack(s, d, TODAY);
    expect(t.states).toMatchObject({ CONTACT: 'done', QUOTATION: 'skipped', FOLLOW: 'planned', CALL1: 'done', FOLLOW1: 'planned' });
    expect(t.next).toBe('FOLLOW');
  });

  it('CLOSE with only a past date is not done: the result is asked for before the payments', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'โทร' }, QUOTATION: { d: '2026-09-10', n: 'QT' }, 'CLOSED DEAL': { d: '2026-10-01' } });
    const t = stageTrack(s, d, TODAY);
    expect(t.states['CLOSED DEAL']).toBe('next');
    expect(t.next).toBe('CLOSED DEAL');
    expect(t.states.PAY1).toBe('future');
  });

  it('a decision meeting booked ahead is planned and next (the steps before it were skipped)', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'x' }, 'CLOSED DEAL': { d: '2026-10-30' } });
    const t = stageTrack(s, d, TODAY);
    expect(t.states).toMatchObject({ 'CLOSED DEAL': 'planned', QUOTATION: 'skipped', FOLLOW: 'skipped' });
    expect(t.next).toBe('CLOSED DEAL');
  });

  it('waiting for the result, won (payment next) and lost (nothing more)', () => {
    const w = mk({ 'CLOSED DEAL': { d: '2026-10-01', n: 'รอผู้บริหาร' } });
    expect(stageTrack(w.s, w.d, TODAY).next).toBe('CLOSED DEAL');
    const won = mk({ 'CLOSED DEAL': { d: '2026-10-01', n: 'YES' } });
    expect(stageTrack(won.s, won.d, TODAY)).toMatchObject({ next: 'PAY1', result: 'YES' });
    expect(quickMatch(won.s, won.d, 'payment', TODAY)).toBe(true);
    // a single PAY without a plan: recorded is paid (nothing says less came in)
    won.s.steps['x/PAY1'] = { d: '2026-10-05', n: 'รับแล้ว' };
    expect(stageTrack(won.s, won.d, TODAY)).toMatchObject({ next: '', done: 2, total: 5 });
    expect(quickMatch(won.s, won.d, 'payment', TODAY)).toBe(false);
    expect(quickMatch(won.s, won.d, 'ready', TODAY)).toBe(true);
    const lost = mk({ CALL1: { d: '2026-09-01', n: 'x' }, 'CLOSED DEAL': { d: '2026-10-01', n: 'NO' } });
    const t = stageTrack(lost.s, lost.d, TODAY);
    expect(t.next).toBe('');
    expect(t.states.PAY1).toBe('off');
  });

  it('a stage of the team\'s own (an import) keeps its place; one after the payments does not make an undecided deal look finished', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'x' }, MEETING: { d: '2026-09-05', n: 'ประชุม' } }, ['MEETING']);
    expect(ids(s, d)).toEqual(['CONTACT', 'QUOTATION', 'FOLLOW', 'CLOSED DEAL', 'PAY1', 'MEETING']);
    const t = stageTrack(s, d, TODAY);
    expect(t.next).toBe('CLOSED DEAL');
    expect(quickMatch(s, d, 'payment', TODAY)).toBe(false);
    const won = mk({ 'CLOSED DEAL': { d: '2026-09-01', n: 'YES' }, PAY1: { d: '2026-09-02', n: 'x' }, PAY2: { d: '2026-09-03', n: 'x' } }, ['MEETING']);
    expect(quickMatch(won.s, won.d, 'payment', TODAY)).toBe(false); // MEETING is not a payment
    // one placed between the old stages stays after the step they are read into
    const mid = mk({}, []);
    mid.s.cfg.stages = ['CALL1', 'CALL2', 'SITE VISIT', 'QUOTATION', 'FOLLOW1', 'FOLLOW2', 'CLOSED DEAL', 'PAY1', 'PAY2'];
    expect(ids(mid.s, mid.d)).toEqual(['CONTACT', 'SITE VISIT', 'QUOTATION', 'FOLLOW', 'CLOSED DEAL', 'PAY1']);
  });

  it('only one step is next', () => {
    const { s, d } = mk({ CALL1: { d: '2026-09-01', n: 'x' }, FOLLOW1: { d: '2026-10-20' }, 'CLOSED DEAL': { d: '2026-10-01' } });
    const t = stageTrack(s, d, TODAY);
    expect(Object.values(dealSteps(s, d, TODAY).steps).filter((v) => v.state === 'next').length).toBeLessThanOrEqual(1);
    expect(t.next).toBe('FOLLOW');
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
