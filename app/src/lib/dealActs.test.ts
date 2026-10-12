/**
 * Contacts beyond the stages (dact records) and the document check at the money figures, as pure
 * functions: reading a record, the last contact, the stage a contact defaults to, the records the team
 * sheet gets, and the derived "ไม่ตรงเอกสาร".
 */
import { describe, expect, it } from 'vitest';
import { canWriteKey } from './auth';
import {
  actStage, actsOf, docMismatch, emptySales, filterDeals, lastContact, lastContactInfo, mismatchText, newDeal, overdueDays, planOf, stageActs, toAct, toDoc,
  type Deal, type DealAct, type DealDoc, type SalesState,
} from './sales';
import { acFig, docFig, fcFig, lineFig } from './salesUi';
import { applyRow, keyOf, localRecords, noEffects, type SharedState } from './teamSync';
import type { Crm } from './types';

const TODAY = '2026-10-08';
const emptyCrm = (): Crm => ({ stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} });
const deal = (p: Partial<Deal> = {}): Deal => newDeal({ id: p.id || 'd' + Math.random().toString(36).slice(2), client: 'บริษัท ก', year: '2569', ...p }, 'me', '2026-09-01T00:00:00.000Z');
const state = (deals: Deal[], steps: SalesState['steps'] = {}, acts: DealAct[] = []): SalesState => ({
  ...emptySales(), deals: Object.fromEntries(deals.map((d) => [d.id, d])), steps, acts: Object.fromEntries(acts.map((a) => [`${a.deal}/${a.id}`, a])),
});
const act = (deal: string, id: string, d: string, p: Partial<DealAct> = {}): DealAct => ({ id, deal, d, type: 'call', note: '', stage: 'CALL1', pid: '', by: 'เอ', at: d + 'T03:00:00.000Z', ...p });
const doc = (p: Partial<DealDoc>): DealDoc => ({
  id: 'q', deal: 'x', kind: 'quotation', name: 'q.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: 'QT-1', docDate: '', amount: 100, target: 'forecast', detected: 100, basis: 'total', stage: 'QUOTATION', at: '2026-10-01T00:00:00.000Z', by: '', ...p,
});

describe('a contact record (dact/<deal>/<id>)', () => {
  it('is read with its keys from the record key, a type it knows, and a stage without "/"', () => {
    expect(toAct({ d: '2026-10-05', type: 'email', note: 'ส่งราคา', stage: 'QUOTATION', pid: 'p1', by: 'เอ', at: '2026-10-05T03:00:00.000Z' }, 'x', 'a1')).toEqual({
      id: 'a1', deal: 'x', d: '2026-10-05', type: 'email', note: 'ส่งราคา', stage: 'QUOTATION', pid: 'p1', by: 'เอ', at: '2026-10-05T03:00:00.000Z',
    });
    // a type a later build adds reads as อื่นๆ; a stage with "/" cannot be a record key part
    expect(toAct({ d: '2026-10-05', type: 'fax', stage: 'A/B' }, 'x', 'a2')).toMatchObject({ type: 'other', stage: 'A-B', note: '', pid: '' });
    // no date: the day it was written; neither: not a record this app can sort or count
    expect(toAct({ at: '2026-10-04T10:00:00.000Z', type: 'call' }, 'x', 'a3')?.d).toBe('2026-10-04');
    for (const bad of [null, 'x', [1], { type: 'call' }, { d: 'เมื่อวาน' }]) expect(toAct(bad, 'x', 'a4')).toBeNull();
    expect(toAct({ d: '2026-10-05' }, '', 'a5')).toBeNull();
  });

  it('counts toward the last contact (a later one wins, a planned one does not), so ค้าง goes away', () => {
    const d = deal({ id: 'x', contactDate: '2026-08-01' });
    const S = state([d], { 'x/CALL1': { d: '2026-08-20', n: 'โทรแล้ว' } });
    expect(lastContactInfo(S, d, TODAY)).toEqual({ date: '2026-08-20', from: 'CALL1' });
    expect(overdueDays(S, d, TODAY)).toBe(49);
    S.acts = { 'x/a1': act('x', 'a1', '2026-10-06', { type: 'meet' }), 'x/a2': act('x', 'a2', '2026-10-20') };
    const lc = lastContactInfo(S, d, TODAY);
    expect(lc).toMatchObject({ date: '2026-10-06', from: 'act' });
    expect(lc.act?.id).toBe('a1');
    expect(overdueDays(S, d, TODAY)).toBeNull();
    // an older record leaves a newer stage date as it is
    S.acts = { 'x/a1': act('x', 'a1', '2026-08-02') };
    expect(lastContact(S, d, TODAY)).toBe('2026-08-20');
  });

  it('is found by the table search and the contact month / day filters', () => {
    const d = deal({ id: 'x' }), o = deal({ id: 'o', client: 'บริษัท ข' });
    const S = state([d, o], {}, [act('x', 'a1', '2026-07-14', { note: 'ขอใบรับรองโรงงาน' })]);
    expect(filterDeals(S, { year: '2569', q: 'ใบรับรองโรงงาน' }).map((x) => x.id)).toEqual(['x']);
    expect(filterDeals(S, { year: '2569', month: '07', day: '14' }).map((x) => x.id)).toEqual(['x']);
  });

  it('belongs by default to the stage the deal is at: the last one done, else the next one', () => {
    const d = deal({ id: 'x' });
    const S = state([d]);
    expect(actStage(S, d, TODAY)).toBe('CALL1'); // nothing done yet
    S.steps = { 'x/CALL1': { d: '2026-09-01', n: 'a' }, 'x/CALL2': { d: '2026-09-10', n: 'b' } };
    expect(actStage(S, d, TODAY)).toBe('CALL2'); // a third call is one more after CALL2
    S.steps['x/QUOTATION'] = { d: '2026-12-01', n: 'นัดส่ง' }; // planned only: not done yet
    expect(actStage(S, d, TODAY)).toBe('CALL2');
    S.steps['x/CLOSED DEAL'] = { d: '2026-09-20', n: 'NO' };
    expect(actStage(S, d, TODAY)).toBe('CLOSED DEAL');
  });

  it('is listed newest first, by its stage; a stage no longer in the list goes to "other"', () => {
    const d = deal({ id: 'x' });
    const S = state([d], {}, [act('x', 'a', '2026-10-01'), act('x', 'b', '2026-10-03', { stage: 'QUOTATION' }), act('x', 'c', '2026-10-02', { stage: 'OLD' }), act('y', 'z', '2026-10-09')]);
    expect(actsOf(S, 'x').map((a) => a.id)).toEqual(['b', 'c', 'a']);
    const by = stageActs(S, d);
    expect(Object.fromEntries(Object.entries(by.by).map(([k, v]) => [k, v.map((a) => a.id)]))).toEqual({ CALL1: ['a'], QUOTATION: ['b'] });
    expect(by.other.map((a) => a.id)).toEqual(['c']);
  });

  it('travels as its own record without its key fields, and a teammate\'s row adds or removes it', () => {
    const S = state([deal({ id: 'x' })], {}, [act('x', 'a1', '2026-10-05', { note: 'โทร' })]);
    const shared: SharedState = { crm: emptyCrm(), contacts: {}, dec: {}, sales: S, custom: {}, people: {} };
    const recs = localRecords(shared);
    expect(recs.get(keyOf.dact('x', 'a1'))).toEqual({ d: '2026-10-05', type: 'call', note: 'โทร', stage: 'CALL1', pid: '', by: 'เอ', at: '2026-10-05T03:00:00.000Z' });
    const fx = noEffects();
    applyRow(shared, { seq: 1, k: 'dact/x/b2', v: { d: '2026-10-06', type: 'line', note: 'ส่งใบแจ้งหนี้', by: 'บี', at: '' }, del: false, by: 'บี', at: '' }, fx);
    expect(fx.sales).toBe(true);
    expect(S.acts!['x/b2']).toMatchObject({ deal: 'x', id: 'b2', type: 'line', by: 'บี' });
    applyRow(shared, { seq: 2, k: 'dact/x/a1', v: null, del: true, by: 'บี', at: '' }, noEffects());
    expect(Object.keys(S.acts!)).toEqual(['x/b2']);
    // a malformed row is skipped, a key without its record id too
    applyRow(shared, { seq: 3, k: 'dact/x/c3', v: { type: 'call' }, del: false, by: '', at: '' }, noEffects());
    applyRow(shared, { seq: 4, k: 'dact/x', v: { d: '2026-10-06' }, del: false, by: '', at: '' }, noEffects());
    expect(Object.keys(S.acts!)).toEqual(['x/b2']);
  });

  it('sales may add and remove one, a viewer may not, and it is not an admin-only deletion', () => {
    for (const del of [false, true]) {
      expect(canWriteKey('sales', 'dact/x/a1', del)).toBe(true);
      expect(canWriteKey('viewer', 'dact/x/a1', del)).toBe(false);
      expect(canWriteKey('admin', 'dact/x/a1', del)).toBe(true);
    }
  });
});

describe('a document against the figure it backs', () => {
  it('kept figure: the user kept theirs against the document\'s own ("คงยอดเดิม", stored as such)', () => {
    expect(docMismatch(doc({ amount: 160000, detected: 160500, basis: 'manual', kept: true }))).toEqual({ doc: 160500, kept: 160000, diff: -500 });
    expect(docMismatch(doc({ amount: 160500, detected: 160500, basis: 'manual', kept: true }))).toBeNull();
    // chosen from what the reader found (before VAT): the document's own figure, whatever `detected` says
    expect(docMismatch(doc({ amount: 150000, detected: 160500, basis: 'subtotal' }))).toBeNull();
    expect(docMismatch(doc({ amount: 1, detected: null, basis: 'manual', kept: true }))).toBeNull();
    // typed or picked without keeping: a misread corrected, a figure before VAT, what an older build
    // stored (detected = the total read, basis manual) — the user's reading, not a mismatch
    expect(docMismatch(doc({ amount: 100000, detected: 107000, basis: 'manual' }))).toBeNull();
    expect(toDoc({ amount: 100000, detected: 107000, basis: 'manual', kept: true, target: 'forecast' }, 'x', 'q')!.kept).toBe(true);
    expect(toDoc({ amount: 100000, detected: 107000, basis: 'manual', kept: 'yes', target: 'forecast' }, 'x', 'q')!.kept).toBeUndefined();
    expect(mismatchText(160500, 160000, 'แผน')).toBe('ยอดในเอกสาร 160,500 บาท ไม่ตรงกับแผน 160,000 บาท (ต่าง 500)');
    // an English word is set off with a space
    expect(mismatchText(351000, 350000, 'Forecast ที่ใช้')).toBe('ยอดในเอกสาร 351,000 บาท ไม่ตรงกับ Forecast ที่ใช้ 350,000 บาท (ต่าง 1,000)');
    expect(docFig(doc({ amount: 160000, detected: 160500, basis: 'manual', kept: true }))).toMatchObject({ kind: 'warn', word: 'ไม่ตรงเอกสาร' });
    expect(docFig(doc({ amount: 160000, detected: 160500, basis: 'manual' }))).toMatchObject({ kind: 'ok', word: 'จากเอกสาร' });
    expect(docFig(doc({}))).toMatchObject({ kind: 'ok', word: 'จากเอกสาร', docNo: 'QT-1' });
  });

  it('the Forecast says where it comes from: a document, typed, or typed against a newer quotation', () => {
    const d = deal({ id: 'x', forecast: 350000, fcAt: '2026-09-01T00:00:00.000Z' });
    const S = state([d]);
    expect(fcFig(S, d)).toMatchObject({ kind: 'typed', word: 'พิมพ์เอง' });
    S.docs = { 'x/q': doc({ amount: 351000, detected: 351000, cAt: '2026-10-01T00:00:00.000Z' }) };
    expect(fcFig(S, d)).toMatchObject({ kind: 'ok', docNo: 'QT-1' });
    // kept: the quotation confirms the user's figure, the document says another
    S.docs['x/q'] = doc({ amount: 350000, detected: 351000, basis: 'manual', kept: true, cAt: '2026-10-01T00:00:00.000Z' });
    expect(fcFig(S, d)).toMatchObject({ kind: 'warn', title: 'ใบเสนอราคา QT-1: ยอดในเอกสาร 351,000 บาท ไม่ตรงกับ Forecast ที่ใช้ 350,000 บาท (ต่าง 1,000)' });
    // typed after the quotation: the typed figure stands, and says the document disagrees
    S.docs['x/q'] = doc({ amount: 351000, detected: 351000, cAt: '2026-10-01T00:00:00.000Z' });
    S.deals.x = { ...d, fcAt: '2026-10-02T00:00:00.000Z' };
    expect(fcFig(S, S.deals.x)).toMatchObject({ kind: 'warn', word: 'ไม่ตรงเอกสาร' });
    S.deals.x = { ...d, forecast: 351000, fcAt: '2026-10-02T00:00:00.000Z' };
    expect(fcFig(S, S.deals.x)).toMatchObject({ kind: 'ok' });
  });

  it('an installment and the Actual: the document at its stage, a kept figure first, a hand receipt, or the plan', () => {
    const d = deal({ id: 'x' });
    const S = state([d], { 'x/CLOSED DEAL': { d: '2026-10-01', n: 'YES' } });
    const line = { amt: 160000, pct: 50, due: '', rel: 30, how: 'transfer' as const, howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '', by: '' };
    S.pays = { 'x/PAY1': line, 'x/PAY2': { ...line, rcv: '2026-10-05' } };
    S.docs = { 'x/r1': doc({ id: 'r1', kind: 'receipt', target: 'actual', stage: 'PAY1', docNo: 'RC-1', amount: 160000, detected: 160500, basis: 'manual', kept: true }) };
    const L = planOf(S, d, TODAY)!.lines;
    expect(L[0]).toMatchObject({ got: 160000, status: 'paid' });
    expect(lineFig(L[0])).toMatchObject({ kind: 'warn' });
    expect(lineFig(L[1])).toMatchObject({ kind: 'hand', word: 'บันทึกเอง' });
    expect(acFig(S, d)).toMatchObject({ kind: 'warn', word: 'ไม่ตรงเอกสาร' });
    S.docs['x/r1'] = { ...S.docs['x/r1'], amount: 160500, basis: 'total' };
    expect(acFig(S, d)).toMatchObject({ kind: 'ok', docNo: 'RC-1' });
    delete S.pays['x/PAY2'];
    expect(lineFig(planOf(S, d, TODAY)!.lines[0])).toMatchObject({ kind: 'ok' });
  });
});
