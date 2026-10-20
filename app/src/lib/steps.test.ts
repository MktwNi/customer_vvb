/**
 * The five steps (lib/steps.ts, sales.ts dealSteps): CONTACT · QUOTATION · FOLLOW · CLOSE · PAY per installment,
 * read from the records as they are stored — the eight stages of older records (CALL1, CALL2, FOLLOW1, FOLLOW2,
 * PAY2 …) included, nothing rewritten, nothing recorded left out.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_STEPS, CONTACT_STEP, DEAL_STAGE, FOLLOW_STEP, coveredStage, dealSteps, emptySales, isOldStage, isPayKey, isStepKey, listPays, newDeal, payState, closeReady,
  quickMatch, readStep, stageTrack, stepIdOf, stepKeys, stepLabel, stepWords, teamSteps, trackerStatus, dealStatus, lastContactInfo, withActIndex,
  type DealAct, type DealDoc, type PayLine, type SalesState,
} from './sales';

const TODAY = '2026-10-12';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '', ...p });
let n = 0;
/** Deal "x": steps (stage → date or [date, note]), contacts, documents, plan lines; `stages` replaces the team's list. */
function mk(o: { steps?: Record<string, string | [string, string]>; acts?: Partial<DealAct>[]; docs?: Partial<DealDoc>[]; pays?: Record<string, Partial<PayLine>>; stages?: string[]; forecast?: number | null; actual?: number | null } = {}) {
  const s: SalesState = emptySales();
  if (o.stages) s.cfg.stages = o.stages;
  const d = newDeal({ id: 'x', client: 'บริษัท ทดสอบ จำกัด', year: '2569', forecast: o.forecast ?? null, actual: o.actual ?? null }, 'A', '2026-09-01T03:00:00.000Z');
  s.deals.x = d;
  Object.entries(o.steps || {}).forEach(([k, v]) => (s.steps['x/' + k] = typeof v === 'string' ? { d: v, n: 'ok' } : { d: v[0], n: v[1] }));
  (o.acts || []).forEach((a) => {
    const id = 'a' + ++n;
    s.acts!['x/' + id] = { id, deal: 'x', d: TODAY, type: 'call', note: '', stage: '', pid: '', by: 'A', at: `2026-10-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`, ...a };
  });
  (o.docs || []).forEach((x) => {
    const id = 'doc' + ++n;
    s.docs['x/' + id] = { id, deal: 'x', kind: 'receipt', name: id + '.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: '', docDate: '', amount: null, target: 'actual', detected: null, basis: 'total', stage: '', at: '2026-10-01T00:00:00.000Z', by: 'A', ...x };
  });
  Object.entries(o.pays || {}).forEach(([k, v]) => (s.pays['x/' + k] = L(v)));
  return { s, d };
}
const YES: Record<string, string | [string, string]> = { CALL1: '2026-08-01', QUOTATION: '2026-08-10', 'CLOSED DEAL': ['2026-08-20', 'YES'] };
const view = (s: SalesState, id: string) => dealSteps(s, s.deals.x, TODAY).steps.find((v) => v.id === id)!;
const pays = (s: SalesState) => dealSteps(s, s.deals.x, TODAY).steps.filter((v) => v.kind === 'pay').map((v) => [v.id, v.code, v.state, v.counted, v.outside || '']);

describe('the steps and the stages they read', () => {
  it('five steps; an older stage reads into its step; anything else is itself', () => {
    expect(BASE_STEPS.map(stepWords)).toEqual(['CONTACT ติดต่อประสานงาน', 'QUOTATION ส่งใบเสนอราคา', 'FOLLOW ติดตามผล', 'CLOSE ผลการขาย (YES / NO)']);
    expect(['CALL1', 'CALL2', 'CONTACT', 'FOLLOW1', 'FOLLOW2', 'QUOTATION', 'CLOSED DEAL', 'PAY1', 'MEETING'].map(stepIdOf)).toEqual([
      CONTACT_STEP, CONTACT_STEP, CONTACT_STEP, FOLLOW_STEP, FOLLOW_STEP, 'QUOTATION', DEAL_STAGE, 'PAY1', 'MEETING',
    ]);
    expect(['CALL1', 'FOLLOW2', 'CONTACT', 'QUOTATION'].map(isOldStage)).toEqual([true, true, false, false]);
    // what an import or a backup never adds to the team's list: the steps read it anyway
    expect(['CALL1', 'CALL2', 'FOLLOW1', 'FOLLOW2', 'CONTACT', 'FOLLOW', 'QUOTATION', 'CLOSED DEAL', 'PAY1', 'PAY2', 'PAY3', 'MEETING', 'PAYMENT'].map(coveredStage)).toEqual([
      true, true, true, true, true, true, true, true, true, true, true, false, false,
    ]);
    expect([isPayKey('PAY12'), isPayKey('PAYX'), isPayKey('PAY')]).toEqual([true, false, false]);
  });

  it("the team's steps: the default list is the five; a stage of the team's own keeps its place", () => {
    const cfg = emptySales().cfg;
    expect(teamSteps(cfg).map((x) => x.code)).toEqual(['CONTACT', 'QUOTATION', 'FOLLOW', 'CLOSE', 'PAY']);
    expect(teamSteps({ stages: ['CALL1', 'SITE VISIT', 'CALL2', 'QUOTATION', 'FOLLOW1', 'CLOSED DEAL', 'PAY1', 'PAY2', 'PAY3', 'MEETING'] }).map((x) => x.id)).toEqual([
      'CONTACT', 'SITE VISIT', 'QUOTATION', 'FOLLOW', 'CLOSED DEAL', 'PAY', 'MEETING',
    ]);
    // a list without some of them (an admin's): the five are there anyway
    expect(teamSteps({ stages: ['CALL1', 'CLOSED DEAL'] }).map((x) => x.id)).toEqual(['CONTACT', 'QUOTATION', 'FOLLOW', 'CLOSED DEAL', 'PAY']);
    expect(teamSteps({ stages: ['INTRO', 'CALL1'] })[0]).toMatchObject({ id: 'INTRO', kind: 'custom' });
    expect(listPays(cfg)).toEqual(['PAY1', 'PAY2']);
    expect([isStepKey(cfg, 'CALL2'), isStepKey(cfg, 'PAY9'), isStepKey(cfg, 'MEETING'), isStepKey({ stages: [...cfg.stages, 'MEETING'] }, 'MEETING')]).toEqual([true, true, false, true]);
  });
});

describe('CONTACT and FOLLOW read their older stages', () => {
  it('the newest date wins; the older records stay, as entries, newest first', () => {
    const { s } = mk({ steps: { CALL1: ['2026-09-17', 'โทรแนะนำ'], CALL2: ['2026-09-25', 'ขอใบเสนอราคา'], FOLLOW1: ['2026-10-01', 'ส่งอีเมล'], FOLLOW2: ['2026-10-09', 'โทรตาม'] } });
    const c = view(s, 'CONTACT'), f = view(s, 'FOLLOW');
    expect(c).toMatchObject({ code: 'CONTACT', state: 'done', date: '2026-09-25', top: { stage: 'CALL2', n: 'ขอใบเสนอราคา' }, own: { d: '', n: '' } });
    expect(c.entries.map((e) => [e.kind, e.stage, e.d])).toEqual([['old', 'CALL2', '2026-09-25'], ['old', 'CALL1', '2026-09-17']]);
    expect(f).toMatchObject({ state: 'done', date: '2026-10-09', top: { stage: 'FOLLOW2' } });
    expect(readStep(s, 'x', 'CONTACT')).toEqual({ stage: 'CALL2', d: '2026-09-25', n: 'ขอใบเสนอราคา' });
    expect(readStep(s, 'x', 'FOLLOW')).toMatchObject({ stage: 'FOLLOW2', n: 'โทรตาม' });
  });

  it('old and new ids on one deal: the step\'s own record is newest, the older ones are entries', () => {
    const { s } = mk({ steps: { CALL1: ['2026-09-17', 'โทรแนะนำ'], CONTACT: ['2026-10-02', 'คุยรายละเอียด'], FOLLOW1: ['2026-10-05', 'ตาม'], FOLLOW: ['2026-10-08', 'ตามอีกครั้ง'] } });
    expect(view(s, 'CONTACT')).toMatchObject({ date: '2026-10-02', top: { stage: 'CONTACT' }, own: { n: 'คุยรายละเอียด' } });
    expect(view(s, 'CONTACT').entries.map((e) => e.stage)).toEqual(['CALL1']);
    expect(view(s, 'FOLLOW').entries.map((e) => e.stage)).toEqual(['FOLLOW1']);
    // the same day: the step's own first
    s.steps['x/CALL2'] = { d: '2026-10-02', n: 'วันเดียวกัน' };
    expect(readStep(s, 'x', 'CONTACT').stage).toBe('CONTACT');
  });

  it('a date ahead is planned (a call booked); undated notes count as done', () => {
    const { s } = mk({ steps: { CALL1: ['2026-09-01', 'โทร'], CALL2: ['2026-10-20', ''] } });
    expect(view(s, 'CONTACT')).toMatchObject({ state: 'planned', date: '2026-10-20' });
    expect(dealSteps(s, s.deals.x, TODAY).next?.id).toBe('CONTACT');
    const u = mk({ steps: { FOLLOW1: ['', 'ส่งอีเมลแล้ว'] } });
    expect(view(u.s, 'FOLLOW')).toMatchObject({ state: 'done', date: '', filled: true });
  });

  it('contact records complete CONTACT and FOLLOW (up to today), never QUOTATION, CLOSE or a payment', () => {
    const { s } = mk({
      acts: [
        { d: '2026-09-20', type: 'email', stage: 'CALL1', note: 'ส่งโบรชัวร์' },
        { d: '2026-10-03', type: 'meet', stage: 'FOLLOW', note: 'ประชุม' },
        { d: '2026-10-04', type: 'line', stage: 'QUOTATION', note: 'ถามเรื่องราคา' },
        { d: '2026-10-05', type: 'call', stage: 'CLOSED DEAL' },
        { d: '2026-10-06', type: 'call', stage: 'PAY1' },
        { d: '2026-10-30', type: 'call', stage: 'CONTACT', note: 'ยังไม่ถึง' },
      ],
    });
    const t = dealSteps(s, s.deals.x, TODAY);
    expect(t.steps.map((v) => [v.code, v.state, v.entries.length])).toEqual([
      ['CONTACT', 'done', 2], ['QUOTATION', 'skipped', 1], ['FOLLOW', 'done', 1], ['CLOSE', 'next', 1], ['PAY', 'future', 1],
    ]);
    expect(view(s, 'CONTACT').date).toBe('2026-09-20'); // the one ahead is not a contact yet
    expect([t.done, t.total, t.contacts]).toEqual([2, 5, 6]);
    expect(dealStatus(s, s.deals.x).started).toBe(true); // a deal with contacts only has started
    expect(quickMatch(s, s.deals.x, 'notstarted', TODAY)).toBe(false);
    expect(quickMatch(s, s.deals.x, 'active', TODAY)).toBe(true);
  });

  it('a contact or a document at a stage nothing reads goes to "other"; none is lost', () => {
    const { s } = mk({ acts: [{ stage: 'GONE' }, { stage: '' }], docs: [{ stage: '', kind: 'other', target: 'none' }, { stage: 'GONE', kind: 'other', target: 'none' }, { stage: 'CALL2', kind: 'other', target: 'none' }] });
    const t = dealSteps(s, s.deals.x, TODAY);
    expect([t.other.acts.length, t.other.docs.length]).toEqual([2, 2]);
    expect(view(s, 'CONTACT').docs).toHaveLength(1);
  });
});

describe('a deal from the eight-stage tracker', () => {
  it('every old stage filled: complete under the five steps, and every record still shows', () => {
    const { s, d } = mk({
      steps: {
        CALL1: ['2026-07-01', 'โทร 1'], CALL2: ['2026-07-05', 'โทร 2'], QUOTATION: ['2026-07-10', 'QT-1'], FOLLOW1: ['2026-07-15', 'ตาม 1'], FOLLOW2: ['2026-07-20', 'ตาม 2'],
        'CLOSED DEAL': ['2026-07-25', 'YES'], PAY1: ['2026-08-01', 'รับงวด 1'], PAY2: ['2026-09-01', 'รับงวด 2'],
      },
    });
    const t = dealSteps(s, d, TODAY);
    expect(t.steps.map((v) => [v.code, v.state])).toEqual([['CONTACT', 'done'], ['QUOTATION', 'done'], ['FOLLOW', 'done'], ['CLOSE', 'yes'], ['PAY1', 'done'], ['PAY2', 'done']]);
    expect([t.done, t.total, t.next]).toEqual([6, 6, null]);
    expect(closeReady(s, d, TODAY)).toBe(true);
    expect(quickMatch(s, d, 'ready', TODAY)).toBe(true);
    // nothing recorded is left out: every stored stage is a step's own record, its top or an entry
    const shown = new Set(t.steps.flatMap((v) => [v.own === s.steps[`x/${v.id}`] ? v.id : '', v.top.stage, ...v.entries.map((e) => e.stage)]));
    for (const k of Object.keys(s.steps)) expect(shown.has(k.slice(2))).toBe(true);
    expect(stepKeys(s, d).sort()).toEqual(expect.arrayContaining(['CALL1', 'CALL2', 'FOLLOW1', 'FOLLOW2', 'PAY1', 'PAY2']));
    expect(trackerStatus(s, d, TODAY)).toBe('ได้งาน');
    expect(lastContactInfo(s, d, TODAY)).toEqual({ date: '2026-09-01', from: 'PAY2' });
  });

  it('stepLabel: a stored stage in words, by the deal\'s steps', () => {
    const one = mk({ steps: YES, pays: { PAY1: { amt: 1 } } }), three = mk({ steps: YES, pays: { PAY1: { amt: 1 }, PAY2: { amt: 1 }, PAY3: { amt: 1 } } });
    expect(stepLabel(one.s, one.d, 'CALL2', TODAY)).toEqual({ code: 'CONTACT', th: 'ติดต่อประสานงาน' });
    expect(stepLabel(one.s, one.d, 'CLOSED DEAL', TODAY)).toEqual({ code: 'CLOSE', th: 'ผลการขาย (YES / NO)' });
    expect(stepLabel(one.s, one.d, 'PAY1', TODAY)).toEqual({ code: 'PAY', th: 'ชำระเงิน' });
    expect(stepLabel(three.s, three.d, 'PAY3', TODAY)).toEqual({ code: 'PAY3', th: 'ชำระงวดที่ 3' });
    expect(stepLabel(one.s, null, 'PAY4', TODAY)).toEqual({ code: 'PAY4', th: 'ชำระงวดที่ 4' });
    expect(stepLabel(one.s, one.d, 'GONE', TODAY)).toEqual({ code: 'GONE', th: '' });
  });
});

describe('PAY follows the payment plan', () => {
  it('a plan of one installment: a single PAY step (no PAY2 "ไม่มีงวดนี้ในแผน"); its record stays PAY1', () => {
    const { s } = mk({ steps: YES, pays: { PAY1: { amt: 1000, due: '2026-10-20' } } });
    expect(pays(s)).toEqual([['PAY1', 'PAY', 'planned', true, '']]);
    expect(view(s, 'PAY1')).toMatchObject({ th: 'ชำระเงิน', date: '2026-10-20', line: { stage: 'PAY1', code: 'PAY' } });
    expect(dealSteps(s, s.deals.x, TODAY).total).toBe(5);
  });

  it('a plan of three: PAY1 … PAY3, ชำระงวดที่ n; received, due later, late (never skipped)', () => {
    const { s } = mk({
      steps: YES,
      docs: [{ stage: 'PAY2', amount: 1000 }],
      pays: { PAY1: { amt: 1000, due: '2026-09-30' }, PAY2: { amt: 1000 }, PAY3: { amt: 1000, due: '2026-12-01' } },
    });
    expect(pays(s)).toEqual([['PAY1', 'PAY1', 'next', true, ''], ['PAY2', 'PAY2', 'done', true, ''], ['PAY3', 'PAY3', 'planned', true, '']]);
    expect(view(s, 'PAY3').th).toBe('ชำระงวดที่ 3');
    const t = dealSteps(s, s.deals.x, TODAY);
    expect([t.done, t.total, t.next?.id]).toEqual([4, 7, 'PAY1']); // FOLLOW was skipped
    expect(payState(s, s.deals.x, TODAY).left).toEqual(['PAY1', 'PAY3']);
  });

  it('a plan made smaller (3 → 1): PAY2 and PAY3 keep what they hold, outside the plan, not counted, closing not blocked', () => {
    const { s, d } = mk({
      steps: { ...YES, PAY2: ['2026-09-01', 'วางบิลแล้ว'] },
      acts: [{ stage: 'PAY3', note: 'โทรถามงวด 3' }],
      docs: [{ stage: 'PAY1', amount: 1000 }],
      pays: { PAY1: { amt: 1000 } },
    });
    expect(pays(s)).toEqual([['PAY1', 'PAY', 'done', true, ''], ['PAY2', 'PAY2', 'done', false, 'plan'], ['PAY3', 'PAY3', 'off', false, 'plan']]);
    expect(view(s, 'PAY3').entries.map((e) => e.act?.note)).toEqual(['โทรถามงวด 3']);
    expect(dealSteps(s, d, TODAY).total).toBe(5);
    expect(closeReady(s, d, TODAY)).toBe(true);
  });

  it('a plan before YES is a draft: its installments are steps still to come', () => {
    const { s } = mk({ steps: { CALL1: '2026-09-01' }, pays: { PAY1: { amt: 1 }, PAY2: { amt: 1 } } });
    expect(pays(s)).toEqual([['PAY1', 'PAY1', 'future', true, ''], ['PAY2', 'PAY2', 'future', true, '']]);
  });

  it('no plan: a single PAY written to PAY1; another installment holding a record or a payment shows and counts', () => {
    expect(pays(mk({ steps: YES }).s)).toEqual([['PAY1', 'PAY', 'next', true, '']]);
    expect(pays(mk({ steps: { ...YES, PAY1: '2026-09-01', PAY3: '2026-09-15' } }).s)).toEqual([['PAY1', 'PAY1', 'done', true, ''], ['PAY3', 'PAY3', 'done', true, '']]);
    expect(pays(mk({ steps: YES, docs: [{ stage: 'PAY2', amount: 500 }] }).s)).toEqual([['PAY1', 'PAY1', 'next', true, ''], ['PAY2', 'PAY2', 'done', true, '']]);
    // a contact or a document that is not a payment at an installment no step has: under the first PAY
    const o = mk({ steps: YES, acts: [{ stage: 'PAY2' }], docs: [{ stage: 'PAY3', kind: 'other', target: 'none' }] });
    expect(pays(o.s)).toEqual([['PAY1', 'PAY', 'next', true, '']]);
    expect([view(o.s, 'PAY1').entries.length, view(o.s, 'PAY1').docs.length]).toEqual([1, 1]);
  });

  it('no plan, paid in part (the money says so): the rest is one more installment, owed; demo3 is not ready to close', () => {
    // demo3: 125,000 of 250,000 received at PAY1
    const { s, d } = mk({ steps: { ...YES, PAY1: ['2026-09-10', 'รับงวดแรก'] }, docs: [{ stage: 'PAY1', amount: 125000 }], forecast: 250000 });
    expect(pays(s)).toEqual([['PAY1', 'PAY1', 'done', true, ''], ['PAY2', 'PAY2', 'next', true, '']]);
    expect(view(s, 'PAY2').short).toBe(125000);
    expect(payState(s, d, TODAY)).toMatchObject({ pays: ['PAY1', 'PAY2'], paid: ['PAY1'], left: ['PAY2'] });
    expect(closeReady(s, d, TODAY)).toBe(false);
    expect(quickMatch(s, d, 'payment', TODAY)).toBe(true);
    // recorded at PAY2 (a receipt, or a note: "ส่วนลด ไม่ต้องรับเพิ่ม"): done, no third one
    s.steps['x/PAY2'] = { d: '2026-10-01', n: 'ส่วนลดตามที่ตกลง' };
    expect(pays(s)).toEqual([['PAY1', 'PAY1', 'done', true, ''], ['PAY2', 'PAY2', 'done', true, '']]);
    expect(closeReady(s, d, TODAY)).toBe(true);
  });

  it('no plan, short by a withholding tax only (or the money unknown): paid in full', () => {
    // 107,000 with 3% withheld on 100,000: 104,000 came in
    const w = mk({ steps: { ...YES, PAY1: '2026-09-10' }, forecast: 107000, actual: 104000 });
    expect(pays(w.s)).toEqual([['PAY1', 'PAY', 'done', true, '']]);
    expect(closeReady(w.s, w.d, TODAY)).toBe(true);
    const u = mk({ steps: { ...YES, PAY1: '2026-09-10' }, forecast: 107000 });
    expect(closeReady(u.s, u.d, TODAY)).toBe(true);
    const more = mk({ steps: { ...YES, PAY1: '2026-09-10' }, forecast: 107000, actual: 107000 });
    expect(closeReady(more.s, more.d, TODAY)).toBe(true);
  });

  it('after NO: a single PAY "ไม่ต้องทำ" (a plan typed before is not followed)', () => {
    const { s, d } = mk({ steps: { CALL1: '2026-09-01', 'CLOSED DEAL': ['2026-10-01', 'NO'] }, pays: { PAY1: { amt: 1 }, PAY2: { amt: 1 } } });
    expect(pays(s)).toEqual([['PAY1', 'PAY', 'off', true, '']]);
    const t = dealSteps(s, d, TODAY);
    expect([t.next, t.done, t.total]).toEqual([null, 2, 5]);
  });

  it("a joint quotation's company: its PAY is the joint quotation's (not counted); its own record shows", () => {
    const { s, d } = mk({ steps: { ...YES, PAY2: ['2026-09-01', 'บันทึกจากเวอร์ชันเก่า'] } });
    s.deals.h = newDeal({ id: 'h', client: 'ผู้จ่าย', year: '2569' }, 'A');
    s.jqt = { h: { title: 'QT ร่วม', at: '', by: '' } };
    s.jqm = { 'h/x': { share: null, pct: null, at: '2026-09-01T00:00:00.000Z', by: '' } };
    expect(pays(s)).toEqual([['PAY1', 'PAY', 'off', false, 'joint'], ['PAY2', 'PAY2', 'done', false, 'joint']]);
    expect(dealSteps(s, d, TODAY).total).toBe(4);
  });

  it('a team list with its own PAY name keeps it as the first installment', () => {
    const { s } = mk({ steps: { ...YES, PAYMENT: '2026-09-01' }, stages: ['CALL1', 'QUOTATION', 'CLOSED DEAL', 'PAYMENT'] });
    expect(pays(s)).toEqual([['PAYMENT', 'PAY', 'done', true, '']]);
  });
});

describe('next step, readiness and the passes over many deals', () => {
  it('stageTrack keeps its shape for the screens: states by step id (an older stage reads its step\'s)', () => {
    const { s, d } = mk({ steps: { CALL1: '2026-09-01', FOLLOW2: ['2026-10-30', ''] } });
    const t = stageTrack(s, d, TODAY);
    expect(t).toMatchObject({ next: 'FOLLOW', done: 1, total: 5 });
    expect(t.states).toMatchObject({ CONTACT: 'done', CALL1: 'done', CALL2: 'done', QUOTATION: 'skipped', FOLLOW: 'planned', FOLLOW1: 'planned', 'CLOSED DEAL': 'future', PAY1: 'future' });
  });

  it('a pass over many deals works each deal out once, with the same answer', () => {
    const { s, d } = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 1 }] });
    const plain = dealSteps(s, d, TODAY);
    const inPass = withActIndex(s, () => [dealSteps(s, d, TODAY), dealSteps(s, d, TODAY)]);
    expect(inPass[0]).toBe(inPass[1]);
    expect(inPass[0]).toEqual(plain);
    // outside a pass nothing is kept: a change shows at once
    s.steps['x/FOLLOW'] = { d: '2026-10-01', n: 'ตาม' };
    expect(view(s, 'FOLLOW').state).toBe('done');
  });
});
