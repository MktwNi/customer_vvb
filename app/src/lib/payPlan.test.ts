/**
 * The payment plan (dpay records), attaching at a stage and the closing rule, as pure functions:
 * lib/sales.ts (data and derived values) and the dpay record in lib/teamSync.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  attachPreview, attachStage, closeReady, countedAt, dealMoney, dueOf, emptySales, filterDeals, hasPlan, isExtraPay, kindForStage, lastContactInfo, lineView, newDeal, overdueDays,
  payDue, payStageFor, payStages, payState, planCsv, planLines, planOf, quickMatch, receivables, salesStats, splitAmounts, stageDocs, stageTh, stageTrack, targetForStage, toPay,
  trackerStatus, whtRate, wonDate, type DealDoc, type PayLine, type SalesState,
} from './sales';
import { applyRow, isLocalOnly, keyOf, localRecords, noEffects, rebaseOp, type SharedState } from './teamSync';

const TODAY = '2026-10-08';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, at: '', by: '', ...p });
let docN = 0;
/** A deal "x" with stage steps, documents and plan lines; `stages` replaces the list. */
function mk(o: { steps?: Record<string, string | [string, string]>; docs?: Partial<DealDoc>[]; pays?: Record<string, Partial<PayLine>>; stages?: string[]; forecast?: number | null } = {}) {
  const s: SalesState = emptySales();
  if (o.stages) s.cfg.stages = o.stages;
  const d = newDeal({ id: 'x', client: 'บริษัท ทดสอบ จำกัด', forecast: o.forecast ?? null }, 'A', '2026-09-01T03:00:00.000Z');
  s.deals.x = d;
  Object.entries(o.steps || {}).forEach(([k, v]) => (s.steps['x/' + k] = typeof v === 'string' ? { d: v, n: 'ok' } : { d: v[0], n: v[1] }));
  (o.docs || []).forEach((x) => {
    const id = 'doc' + ++docN;
    s.docs['x/' + id] = { id, deal: 'x', kind: 'receipt', name: id + '.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: '', docDate: '', amount: null, target: 'actual', detected: null, basis: 'total', stage: '', at: `2026-10-0${docN % 9}T00:00:00.000Z`, by: 'A', ...x };
  });
  Object.entries(o.pays || {}).forEach(([k, v]) => (s.pays['x/' + k] = L(v)));
  return { s, d };
}
const YES: Record<string, string | [string, string]> = { CALL1: '2026-08-01', QUOTATION: '2026-08-10', 'CLOSED DEAL': ['2026-08-20', 'YES'] };
const view = (s: SalesState, stage: string) => planOf(s, s.deals.x, TODAY)!.lines.find((l) => l.stage === stage)!;

describe('the installment record (dpay/<deal>/<stage>)', () => {
  it('toPay keeps a good record and repairs or rejects a bad one', () => {
    const good = L({ amt: 53500, pct: 50, due: '2026-10-20', rel: 30, how: 'cheque', howT: 'KBank', note: 'มัดจำ', rcv: '2026-10-01', got: 52000, full: true, at: '2026-10-01T00:00:00.000Z', by: 'มกร' });
    expect(toPay(good)).toEqual(good);
    expect(toPay(null)).toBeNull();
    expect(toPay('x')).toBeNull();
    expect(toPay([1])).toBeNull();
    expect(toPay({ amt: '1,000', pct: 150, due: '20/10/2026', rel: 1.5, how: 'bitcoin', note: 'n'.repeat(400), got: -5, full: 'yes' })).toEqual(
      L({ amt: null, pct: null, due: '', rel: null, how: '', note: 'n'.repeat(300), got: null, full: false }),
    );
    expect(toPay({ amt: '120000', rel: 731 })).toMatchObject({ amt: 120000, rel: null });
    expect(toPay({ rel: -365 })).toMatchObject({ rel: -365 });
  });

  it('amounts split exactly; the rounding goes to the last installment', () => {
    expect(splitAmounts(100000, [1, 1, 1])).toEqual([33333, 33333, 33334]);
    expect(splitAmounts(107000, [50, 50])).toEqual([53500, 53500]);
    expect(splitAmounts(85000, [30, 70])).toEqual([25500, 59500]);
    expect(splitAmounts(1000.5, [1, 1])).toEqual([500, 500.5]);
    expect(splitAmounts(90, [0, 0, 0])).toEqual([30, 30, 30]); // no shares given: equal
    expect(splitAmounts(90, [])).toEqual([]);
  });

  it('the due date: typed wins; else days after the win; nothing before the win', () => {
    expect(dueOf({ due: '2026-11-01', rel: 30 }, '2026-08-20')).toBe('2026-11-01');
    expect(dueOf({ due: '', rel: 30 }, '2026-08-20')).toBe('2026-09-19');
    expect(dueOf({ due: '', rel: 0 }, '2026-08-20')).toBe('2026-08-20');
    expect(dueOf({ due: '', rel: 30 }, '')).toBe('');
    expect(dueOf({ due: '', rel: null }, '2026-08-20')).toBe('');
    // the won date is the CLOSED DEAL date of a YES, and a relative due follows it when it is corrected
    const { s, d } = mk({ steps: YES, pays: { PAY1: { amt: 1, rel: 30 } } });
    expect(wonDate(s, d)).toBe('2026-08-20');
    s.steps['x/CLOSED DEAL'].d = '2026-09-01';
    expect(view(s, 'PAY1').due).toBe('2026-10-01');
    s.steps['x/CLOSED DEAL'].n = 'รอผู้บริหาร';
    expect(wonDate(s, d)).toBe('');
  });
});

describe('stages: PAY list, kinds and targets, documents by stage', () => {
  it('payStages: the PAY stages after CLOSED DEAL', () => {
    const cfg = emptySales().cfg;
    expect(payStages(cfg)).toEqual(['PAY1', 'PAY2']);
    expect(payStages({ ...cfg, stages: [...cfg.stages, 'PAY3'] })).toEqual(['PAY1', 'PAY2', 'PAY3']);
    expect(payStages({ ...cfg, stages: [...cfg.stages, 'MEETING'] })).toEqual(['PAY1', 'PAY2']);
    expect(payStages({ ...cfg, stages: ['CALL1', 'CLOSED DEAL', 'pay1'] })).toEqual(['pay1']);
    expect(payStages({ ...cfg, stages: ['CALL1', 'PAY1'] })).toEqual([]);
    expect(payStageFor(cfg, 2)).toBe('PAY2');
    expect(payStageFor(cfg, 3)).toBe('PAY3');
    expect(isExtraPay(cfg, 'PAY3')).toBe(true);
    expect(isExtraPay(cfg, 'PAY2')).toBe(false);
    expect(isExtraPay(cfg, 'PAYX')).toBe(false);
    expect([stageTh('PAY2'), stageTh('PAY3'), stageTh('PAY12'), stageTh('MEETING')]).toEqual(['ชำระงวดที่ 2', 'ชำระงวดที่ 3', 'ชำระงวดที่ 12', '']);
  });

  it('what a document at a stage stands for and counts toward', () => {
    const cfg = emptySales().cfg;
    const kinds = ['quotation', 'invoice', 'receipt', 'other'] as const;
    const t = (p: string) => kinds.map((k) => targetForStage(cfg, p, k));
    expect(['QUOTATION', 'PAY1', 'CALL1', 'XYZ', 'PAY3'].map((p) => kindForStage(cfg, p))).toEqual(['quotation', 'invoice', 'other', 'other', 'invoice']);
    expect(t('QUOTATION')).toEqual(['forecast', 'actual', 'none', 'none']);
    expect(t('PAY1')).toEqual(['forecast', 'actual', 'actual', 'none']); // a receipt at PAY is Actual
    expect(t('CALL1')).toEqual(['forecast', 'actual', 'none', 'none']);
    expect(t('XYZ')).toEqual(['forecast', 'actual', 'none', 'none']);
    expect(t('PAY3')).toEqual(['forecast', 'actual', 'actual', 'none']); // an extra installment
  });

  it('documents by stage; no stage or a removed stage → เอกสารอื่น; an extra installment keeps its own', () => {
    const { s, d } = mk({ docs: [{ stage: 'PAY1', amount: 1 }, { stage: 'PAY1', amount: 2 }, { stage: '' }, { stage: 'OLD' }, { stage: 'PAY3' }], pays: { PAY3: { amt: 1 } } });
    const r = stageDocs(s, d);
    expect(r.by.PAY1.map((x) => x.amount)).toEqual([1, 2]);
    expect(r.by.PAY3).toHaveLength(1);
    expect(r.other.map((x) => x.stage)).toEqual(['', 'OLD']);
    expect(countedAt(s, d, 'PAY1').map((x) => x.amount)).toEqual([1, 2]);
  });
});

describe('the plan, installment by installment', () => {
  it('order: the PAY stages of the list, then extra ones by number; null without a plan', () => {
    expect(planLines(mk().s, mk().d)).toBeNull();
    const { s, d } = mk({ pays: { PAY10: {}, PAY3: {}, PAY2: {}, PAY1: {}, งวดท้าย: {} } });
    expect(planLines(s, d)!.map((x) => [x.stage, x.n, x.inList])).toEqual([
      ['PAY1', 1, true], ['PAY2', 2, true], ['PAY3', 3, false], ['PAY10', 4, false], ['งวดท้าย', 5, false],
    ]);
    expect(hasPlan(s, 'x')).toBe(true);
    expect(hasPlan(s, 'y')).toBe(false);
  });

  it('statuses: received by document or by hand (the document wins), part paid, counted complete', () => {
    const { s } = mk({
      steps: { ...YES, PAY1: ['2026-09-19', 'ใบเสร็จ RC-1'] },
      docs: [{ stage: 'PAY1', amount: 53500, docNo: 'RC-1', docDate: '2026-09-18' }, { stage: 'PAY2', amount: 50000 }, { stage: 'PAY3', amount: 30000, docDate: '2026-10-02' }],
      pays: {
        PAY1: { amt: 53500, rcv: '2026-09-01', got: 1 }, // a hand receipt too: the document wins
        PAY2: { amt: 53500 },
        PAY3: { amt: 30000 },
        PAY4: { amt: 20000, rcv: '2026-10-05', got: 19400, full: true },
        PAY5: { amt: 10000, rcv: '2026-10-06' }, // got null = the planned amount
      },
    });
    expect(view(s, 'PAY1')).toMatchObject({ status: 'paid', got: 53500, left: 0, rcvDate: '2026-09-19', hand: false, doc: { docNo: 'RC-1' } });
    expect(view(s, 'PAY2')).toMatchObject({ status: 'part', got: 50000, left: 3500 });
    expect(view(s, 'PAY3')).toMatchObject({ status: 'paid', rcvDate: '2026-10-02', inList: false }); // an extra one: the document date
    expect(view(s, 'PAY4')).toMatchObject({ status: 'paid', got: 19400, left: 0, hand: true, rcvDate: '2026-10-05' });
    expect(view(s, 'PAY5')).toMatchObject({ status: 'paid', got: 10000, hand: true });
  });

  it('statuses by due date: late, due within 7 days (today too), waiting; a part-paid one is late on what is left', () => {
    const { s } = mk({
      steps: YES,
      docs: [{ stage: 'PAY5', amount: 1000 }],
      pays: { PAY1: { amt: 1000, due: '2026-10-04' }, PAY2: { amt: 1000, due: '2026-10-15' }, PAY3: { amt: 1000, due: TODAY }, PAY4: { amt: 1000, due: '2026-10-16' }, PAY5: { amt: 3000, due: '2026-10-01' }, PAY6: { amt: 1000 } },
    });
    expect(view(s, 'PAY1')).toMatchObject({ status: 'late', lateDays: 4, left: 1000 });
    expect(view(s, 'PAY2')).toMatchObject({ status: 'due', lateDays: 0 });
    expect(view(s, 'PAY3')).toMatchObject({ status: 'due' });
    expect(view(s, 'PAY4')).toMatchObject({ status: 'wait', left: 1000 });
    expect(view(s, 'PAY5')).toMatchObject({ status: 'part', lateDays: 7, left: 2000 });
    expect(view(s, 'PAY6')).toMatchObject({ status: 'wait', due: '' });
    const P = planOf(s, s.deals.x, TODAY)!;
    expect(P.late.map((l) => l.stage)).toEqual(['PAY1', 'PAY5']);
    expect(P.next!.stage).toBe('PAY1');
  });

  it('typed before YES: a draft, owed nothing yet; after NO: cancelled, kept', () => {
    const before = mk({ steps: { CALL1: '2026-09-01' }, pays: { PAY1: { amt: 1000, rel: 0 }, PAY2: { amt: 1000, due: '2026-01-01' } } });
    expect(planOf(before.s, before.d, TODAY)!.lines.map((l) => [l.status, l.due, l.left, l.lateDays])).toEqual([['draft', '', 0, 0], ['draft', '2026-01-01', 0, 0]]);
    expect(lineView(before.s, before.d, planLines(before.s, before.d)![0], TODAY)).toMatchObject({ stage: 'PAY1', n: 1, inList: true, status: 'draft', amt: 1000 });
    const no = mk({ steps: { 'CLOSED DEAL': ['2026-09-01', 'NO'] }, pays: { PAY1: { amt: 1000, due: '2026-01-01' } } });
    expect(view(no.s, 'PAY1')).toMatchObject({ status: 'off', left: 0, lateDays: 0 });
  });

  it('totals against the Forecast, how many received, the next one', () => {
    const { s, d } = mk({ forecast: 245000, steps: YES, docs: [{ stage: 'PAY1', amount: 98000 }], pays: { PAY1: { amt: 98000 }, PAY2: { amt: 73500, rel: 45 }, PAY3: { amt: 66500, rel: 90 } } });
    const P = planOf(s, d, TODAY)!;
    expect(P).toMatchObject({ total: 238000, got: 98000, left: 140000, base: 245000, diff: -7000, n: 3, paidN: 1 });
    expect(P.next!.stage).toBe('PAY2');
    expect(P.next!.due).toBe('2026-10-04');
  });

  it('Actual counts hand receipts once: a document at that stage replaces the hand amount', () => {
    const hand = mk({ steps: YES, pays: { PAY1: { amt: 50000, rcv: '2026-10-01', got: 48500 }, PAY2: { amt: 50000 } } });
    expect(dealMoney(hand.s, hand.d)).toMatchObject({ actual: 48500, hand: 48500, acConfirmed: false });
    const both = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 50000 }], pays: { PAY1: { amt: 50000, rcv: '2026-10-01', got: 48500 }, PAY2: { amt: 50000, rcv: '2026-10-02' } } });
    expect(dealMoney(both.s, both.d)).toMatchObject({ actual: 100000, hand: 50000, acConfirmed: true, acDocs: 1 });
    // without a plan nothing changes: the typed actual when there is no document
    const typed = mk();
    typed.d.actual = 7000;
    expect(dealMoney(typed.s, typed.d)).toMatchObject({ actual: 7000, hand: 0 });
  });

  it('the withholding rate a short payment matches (on the amount before VAT)', () => {
    expect(whtRate(53500, 52000)).toBe(3); // 53,500 / 1.07 = 50,000; 3% = 1,500
    expect(whtRate(53500, 53000)).toBe(1);
    expect(whtRate(107000, 105000)).toBe(2);
    expect(whtRate(107000, 102000)).toBe(5);
    expect(whtRate(53500, 52001)).toBe(3); // within a baht
    expect(whtRate(53500, 51000)).toBe(5); // 2,500 = 5% of 50,000
    expect(whtRate(53500, 51200)).toBeNull();
    expect(whtRate(53500, 53500)).toBeNull();
    expect(whtRate(0, 0)).toBeNull();
  });
});

describe('paid stages and ready to close', () => {
  it('without a plan: done or holding an Actual document; a planned date alone is not paid', () => {
    const a = mk({ steps: { ...YES, PAY1: '2026-09-01', PAY2: ['2026-10-20', ''] } });
    expect(payState(a.s, a.d, TODAY)).toMatchObject({ pays: ['PAY1', 'PAY2'], paid: ['PAY1'], left: ['PAY2'], plan: null });
    expect(closeReady(a.s, a.d, TODAY)).toBe(false);
    const b = mk({ steps: { ...YES, PAY1: '2026-09-01', PAY2: ['2026-10-20', ''] }, docs: [{ stage: 'PAY2', amount: 1 }] });
    expect(payState(b.s, b.d, TODAY).left).toEqual([]);
    expect(closeReady(b.s, b.d, TODAY)).toBe(true);
    const c = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: null, target: 'none' }] });
    expect(payState(c.s, c.d, TODAY).paid).toEqual([]);
    // a note (whatever its date) on a past or undated stage is done
    const n = mk({ steps: { ...YES, PAY1: ['', 'โอนแล้ว'], PAY2: ['2026-10-01', 'โอนแล้ว'] } });
    expect(closeReady(n.s, n.d, TODAY)).toBe(true);
  });

  it('NO is ready; WAIT and no result are not; YES with no PAY stage is', () => {
    expect(closeReady(mk({ steps: { 'CLOSED DEAL': ['2026-09-01', 'NO'] } }).s, mk().d, TODAY)).toBe(true);
    const w = mk({ steps: { 'CLOSED DEAL': ['2026-09-01', 'รอผู้บริหาร'] } });
    expect(closeReady(w.s, w.d, TODAY)).toBe(false);
    expect(closeReady(mk().s, mk().d, TODAY)).toBe(false);
    const none = mk({ steps: YES, stages: ['CALL1', 'QUOTATION', 'CLOSED DEAL'] });
    expect(closeReady(none.s, none.d, TODAY)).toBe(true);
  });

  it('with a plan of fewer installments than PAY stages, the unused one is not needed', () => {
    const { s, d } = mk({ steps: YES, pays: { PAY1: { amt: 1000 } } });
    expect(closeReady(s, d, TODAY)).toBe(false);
    s.pays['x/PAY1'].rcv = '2026-10-01';
    expect(payState(s, d, TODAY)).toMatchObject({ pays: ['PAY1'], paid: ['PAY1'], left: [] });
    expect(closeReady(s, d, TODAY)).toBe(true);
  });

  it('with more installments than PAY stages, the extra one must come in too; short ones only when counted complete', () => {
    const { s, d } = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 1000 }, { stage: 'PAY2', amount: 1000 }], pays: { PAY1: { amt: 1000 }, PAY2: { amt: 1000 }, PAY3: { amt: 1000 } } });
    expect(payState(s, d, TODAY).left).toEqual(['PAY3']);
    expect(closeReady(s, d, TODAY)).toBe(false);
    s.pays['x/PAY3'] = L({ amt: 1000, rcv: TODAY, got: 970 });
    expect(closeReady(s, d, TODAY)).toBe(false);
    s.pays['x/PAY3'].full = true;
    expect(closeReady(s, d, TODAY)).toBe(true);
  });

  it('the track of a won deal with a plan: received = done, due later = planned, late = next (never skipped), unused = off', () => {
    const late = mk({ steps: YES, pays: { PAY1: { amt: 1000, due: '2026-09-30' } }, docs: [] });
    const t = stageTrack(late.s, late.d, TODAY);
    expect(t.states).toMatchObject({ PAY1: 'next', PAY2: 'off' });
    expect(t.next).toBe('PAY1');
    const two = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 1000 }], pays: { PAY1: { amt: 1000 }, PAY2: { amt: 1000, due: '2026-11-01' } } });
    const t2 = stageTrack(two.s, two.d, TODAY);
    expect(t2.states).toMatchObject({ PAY1: 'done', PAY2: 'planned' });
    expect(t2.next).toBe('PAY2');
    // PAY1 still owed (late) while PAY2 came in: PAY1 is the next one, not skipped
    const out = mk({ steps: YES, docs: [{ stage: 'PAY2', amount: 1000 }], pays: { PAY1: { amt: 1000, due: '2026-09-01' }, PAY2: { amt: 1000 } } });
    const t3 = stageTrack(out.s, out.d, TODAY);
    expect(t3.states).toMatchObject({ PAY1: 'next', PAY2: 'done' });
    // before YES the plan changes nothing
    const draft = mk({ steps: { CALL1: '2026-09-01' }, pays: { PAY1: { amt: 1 } } });
    expect(stageTrack(draft.s, draft.d, TODAY).states.PAY2).toBe('future');
  });

  it('no follow-up reminder once ready to close, or for a won deal followed by its plan', () => {
    const no = mk({ steps: { 'CLOSED DEAL': ['2026-08-01', 'NO'] } });
    expect(overdueDays(no.s, no.d, TODAY)).toBeNull();
    const paid = mk({ steps: { ...YES, PAY1: '2026-08-21', PAY2: '2026-08-22' } });
    expect(overdueDays(paid.s, paid.d, TODAY)).toBeNull();
    const left = mk({ steps: { ...YES, PAY1: '2026-09-18' } });
    expect(overdueDays(left.s, left.d, TODAY)).toBe(20);
    const plan = mk({ steps: { ...YES, PAY1: '2026-09-18' }, pays: { PAY2: { amt: 1, due: '2026-09-20' } } });
    expect(overdueDays(plan.s, plan.d, TODAY)).toBeNull();
  });

  it('quick views: waiting for payment, ready to close, an installment past due', () => {
    const planned = mk({ steps: { ...YES, PAY1: '2026-09-01', PAY2: ['2026-10-20', ''] } });
    expect(quickMatch(planned.s, planned.d, 'payment', TODAY)).toBe(true); // a planned-only PAY is not paid
    expect(quickMatch(planned.s, planned.d, 'ready', TODAY)).toBe(false);
    const no = mk({ steps: { 'CLOSED DEAL': ['2026-08-01', 'NO'] } });
    expect(quickMatch(no.s, no.d, 'ready', TODAY)).toBe(true);
    no.d.jobStatus = 'closed';
    expect(quickMatch(no.s, no.d, 'ready', TODAY)).toBe(false);
    const late = mk({ steps: YES, pays: { PAY1: { amt: 1, due: '2026-10-01' } } });
    expect(quickMatch(late.s, late.d, 'paylate', TODAY)).toBe(true);
    expect(quickMatch(planned.s, planned.d, 'paylate', TODAY)).toBe(false);
  });

  it('the generic status line counts installments of a won deal with a plan', () => {
    const { s, d } = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 1 }], pays: { PAY1: { amt: 1 }, PAY2: { amt: 1 } } });
    expect(trackerStatus(s, d, TODAY)).toBe('ได้งาน · รับแล้ว 1/2 งวด');
    delete s.pays['x/PAY1'];
    delete s.pays['x/PAY2'];
    expect(trackerStatus(s, d, TODAY)).toBe('ได้งาน');
  });

  it('the last contact says where it came from; a planned date does not count', () => {
    const { s, d } = mk({ steps: { CALL1: '2026-09-01', CALL2: ['2026-10-20', 'นัด'] } });
    expect(lastContactInfo(s, d, TODAY)).toEqual({ date: '2026-09-01', from: 'CALL1' });
    d.contactDate = '2026-09-05';
    expect(lastContactInfo(s, d, TODAY)).toEqual({ date: '2026-09-05', from: 'typed' });
    expect(lastContactInfo(mk().s, mk().d, TODAY)).toEqual({ date: '', from: '' });
  });

  it('search finds a deal by the words of its plan', () => {
    const { s } = mk({ pays: { PAY1: { note: 'เมื่อส่งรายงาน CFO', howT: 'กสิกรไทย' } } });
    s.deals.x.year = '2569';
    expect(filterDeals(s, { year: '2569', q: 'รายงาน cfo' }).length).toBe(1);
    expect(filterDeals(s, { year: '2569', q: 'กสิกรไทย' }).length).toBe(1);
    expect(filterDeals(s, { year: '2569', q: 'ไม่มีคำนี้' }).length).toBe(0);
  });
});

describe('where a document goes, and what attaching it would change', () => {
  it('attached at a stage: that stage, if configured or an installment of the plan', () => {
    const { s, d } = mk({ steps: YES, pays: { PAY3: { amt: 1 } } });
    const at = (stage: string) => attachStage(s, d, { kind: 'invoice', target: 'actual', stage }, TODAY);
    expect([at('PAY2'), at('PAY3'), at('PAY4'), at('PAYX'), at('')]).toEqual(['PAY2', 'PAY3', '', '', '']);
  });

  it('not at a stage: QUOTATION for a quotation (when configured); Actual to the first installment not received', () => {
    const auto = (s: SalesState, target: 'forecast' | 'actual' | 'none', kind: 'quotation' | 'invoice' | 'other' = 'invoice') => attachStage(s, s.deals.x, { kind, target }, TODAY);
    expect(auto(mk().s, 'forecast', 'quotation')).toBe('QUOTATION');
    expect(auto(mk().s, 'none', 'quotation')).toBe('QUOTATION');
    expect(auto(mk({ stages: ['CALL1', 'CLOSED DEAL', 'PAY1'] }).s, 'forecast', 'quotation')).toBe('');
    expect(auto(mk().s, 'none', 'other')).toBe('');
    // no plan: a planned-only PAY1 is the first not paid (it used to go to PAY2)
    expect(auto(mk({ steps: { ...YES, PAY1: ['2026-10-20', ''] } }).s, 'actual')).toBe('PAY1');
    const three = mk({ steps: YES, stages: [...emptySales().cfg.stages, 'PAY3'], docs: [{ stage: 'PAY1', amount: 1 }, { stage: 'PAY2', amount: 1 }] });
    expect(auto(three.s, 'actual')).toBe('PAY3');
    expect(auto(mk({ steps: YES, stages: ['CALL1', 'CLOSED DEAL'] }).s, 'actual')).toBe('');
    // all paid: the last one
    expect(auto(mk({ steps: { ...YES, PAY1: '2026-09-01', PAY2: '2026-09-02' } }).s, 'actual')).toBe('PAY2');
    // a plan: its first line not received, an extra one too
    expect(auto(mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 1 }, { stage: 'PAY2', amount: 1 }], pays: { PAY1: { amt: 1 }, PAY2: { amt: 1 }, PAY3: { amt: 1 } } }).s, 'actual')).toBe('PAY3');
  });

  it('the preview: a full installment makes the deal ready; a short one offers "ถือว่ารับครบ" at the withholding rate', () => {
    const { s, d } = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 53500 }], pays: { PAY1: { amt: 53500 }, PAY2: { amt: 53500 } } });
    const full = attachPreview(s, d, { kind: 'receipt', amount: 53500, target: 'actual', docDate: '2026-10-07', stage: 'PAY2' }, TODAY);
    expect(full).toMatchObject({ stage: 'PAY2', short: 0, wht: null, actual: 107000, ready: true, line: { status: 'paid', got: 53500 } });
    const short = attachPreview(s, d, { kind: 'receipt', amount: 52000, target: 'actual', docDate: '', stage: 'PAY2' }, TODAY);
    expect(short).toMatchObject({ short: 1500, wht: 3, ready: false, readyIfFull: true, line: { status: 'part' } });
    // the state itself is untouched
    expect(Object.keys(s.docs)).toHaveLength(1);
    // replacing the counted document: no double count
    const old = Object.values(s.docs)[0];
    expect(attachPreview(s, d, { kind: 'receipt', amount: 53500, target: 'actual', docDate: '', stage: 'PAY1', replace: old.id }, TODAY).actual).toBe(53500);
    expect(attachPreview(s, d, { kind: 'receipt', amount: 53500, target: 'actual', docDate: '', stage: 'PAY1' }, TODAY).actual).toBe(107000);
    // without a plan: the stage becomes done, the Forecast reached
    const np = mk({ forecast: 107000, steps: { ...YES, PAY1: '2026-09-01' }, docs: [{ stage: 'PAY1', amount: 53500 }] });
    expect(attachPreview(np.s, np.d, { kind: 'invoice', amount: 53500, target: 'actual', docDate: '', stage: 'PAY2' }, TODAY)).toMatchObject({ line: null, actual: 107000, fcFull: true, ready: true });
  });
});

describe('money owed (KPI ค้างรับ), the calendar, the CSV', () => {
  it('owed, late and due this month count won, open deals only; a plan typed before YES owes nothing yet', () => {
    const { s } = mk({
      steps: YES,
      docs: [{ stage: 'PAY1', amount: 50000 }],
      pays: { PAY1: { amt: 53500 }, PAY2: { amt: 53500, due: '2026-10-01' }, PAY3: { amt: 20000, due: '2026-10-25' }, PAY4: { amt: 10000, due: '2026-11-05' } },
    });
    s.pays['x/PAY1'].due = '2026-09-01'; // part paid and late: 3,500 is late
    const d2 = newDeal({ id: 'y', client: 'ข', forecast: 100000 }, 'A');
    s.deals.y = d2;
    s.steps['y/CLOSED DEAL'] = { d: '2026-09-01', n: 'YES' };
    s.steps['y/PAY1'] = { d: '2026-09-02', n: 'โอนแล้ว' };
    s.docs['y/a'] = { ...Object.values(s.docs)[0], id: 'a', deal: 'y', stage: 'PAY1', amount: 40000 };
    const d3 = newDeal({ id: 'z', client: 'ค' }, 'A');
    s.deals.z = d3;
    s.pays['z/PAY1'] = L({ amt: 99999, due: '2026-10-01' }); // before YES
    const deals = Object.values(s.deals);
    expect(receivables(s, deals, TODAY)).toEqual({ receivable: 3500 + 53500 + 20000 + 10000 + 60000, late: 3500 + 53500, lateN: 2, dueMonth: 20000, dueMonthN: 1 });
    expect(salesStats(s, deals, TODAY)).toMatchObject({ receivable: 147000, late: 57000, dueMonth: 20000 });
    s.deals.x.jobStatus = 'closed';
    expect(receivables(s, deals, TODAY).receivable).toBe(60000);
    // the calendar: installments to receive in a range (late ones with from = '')
    s.deals.x.jobStatus = 'open';
    expect(payDue(s, deals, '2026-10-01', '2026-10-31', TODAY).map((x) => x.line.stage)).toEqual(['PAY2', 'PAY3']);
    expect(payDue(s, deals, '', '2026-10-31', TODAY).map((x) => x.line.stage)).toEqual(['PAY1', 'PAY2', 'PAY3']);
  });

  it('one CSV cell lists the plan', () => {
    const { s, d } = mk({ steps: YES, docs: [{ stage: 'PAY1', amount: 53500 }], pays: { PAY1: { amt: 53500, due: '2026-08-22' }, PAY2: { amt: 53500, due: '2026-10-20' }, PAY3: { amt: null, rel: 0, how: '' } } });
    expect(planCsv(s, d, TODAY)).toBe('PAY1 53,500 (22/08/2026 โอน) รับแล้ว; PAY2 53,500 (20/10/2026 โอน); PAY3 - (20/08/2026) เลยกำหนด');
    expect(planCsv(mk().s, mk().d, TODAY)).toBe('');
  });
});

describe('the dpay record in team sync', () => {
  const shared = (s: SalesState): SharedState => ({ crm: { stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} }, contacts: {}, dec: {}, sales: s, custom: {} });
  it('is shared like the stage steps and documents: applyRow and localRecords agree, a bad row is skipped', () => {
    const { s } = mk({ pays: { PAY1: { amt: 1000, note: 'มัดจำ' } } });
    const rec = localRecords(shared(s));
    expect(keyOf.dpay('x', 'PAY1')).toBe('dpay/x/PAY1');
    expect(rec.get('dpay/x/PAY1')).toEqual(s.pays['x/PAY1']);
    expect(isLocalOnly('dpay/x/PAY1', rec.get('dpay/x/PAY1'))).toBe(false);
    const other = shared(emptySales());
    delete (other.sales as Partial<SalesState>).pays; // an older copy of the store
    const fx = noEffects();
    rec.forEach((v, k) => applyRow(other, { seq: 1, k, v, del: false, by: 'A', at: '' }, fx));
    expect(other.sales.pays).toEqual(s.pays);
    expect(fx.sales).toBe(true);
    applyRow(other, { seq: 2, k: 'dpay/x/PAY2', v: 'junk', del: false, by: 'A', at: '' }, noEffects());
    applyRow(other, { seq: 3, k: 'dpay/x', v: { amt: 1 }, del: false, by: 'A', at: '' }, noEffects());
    expect(Object.keys(other.sales.pays)).toEqual(['x/PAY1']);
    applyRow(other, { seq: 4, k: 'dpay/x/PAY1', v: null, del: true, by: 'A', at: '' }, noEffects());
    expect(other.sales.pays).toEqual({});
  });

  it('a queued change merges field by field with a teammate\'s; their deletion wins over an edit', () => {
    const mine = L({ amt: 1000, note: 'แก้โน้ต' });
    const theirs = L({ amt: 1000, rcv: '2026-10-01', got: 900 });
    expect(rebaseOp({ seq: 9, k: 'dpay/x/PAY1', v: theirs, del: false, by: 'B', at: '' }, { k: 'dpay/x/PAY1', v: mine, f: ['note'] })).toEqual({ v: { ...theirs, note: 'แก้โน้ต' } });
    expect(rebaseOp({ seq: 9, k: 'dpay/x/PAY1', v: null, del: true, by: 'B', at: '' }, { k: 'dpay/x/PAY1', v: mine, f: ['note'] })).toEqual({ drop: true });
    // a new line (whole record) stands
    expect(rebaseOp({ seq: 9, k: 'dpay/x/PAY1', v: theirs, del: false, by: 'B', at: '' }, { k: 'dpay/x/PAY1', v: mine })).toBeNull();
  });
});
