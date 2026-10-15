/**
 * The month check for accounting (lib/payCheck.ts, cash impl-note "Follow-up: month check" §F): the demo
 * world of the Cashflow tests (Mon 12 Oct 2569) with checks layered on it, the figures against the
 * Cashflow bars, staleness from the fingerprint, orphans, the go-live month, closing a month, the
 * self-check, the records as the team sync applies them, and the .xlsx file.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { cashKpis, cashLines, cashYear, emptySales, newDeal, type Deal, type DealDoc, type DealLog, type PayLine, type SalesState } from './sales';
import {
  PAYCHK_CFG0, afterClose, barOf, basisWord, canClose, canConfirm, canReturn, canTick, canUndo, carriedLate, changeWords, chipOf, chkCounts, chkFileName, chkMatch, chkRows, chkSheets, closeRecord,
  closeStateOf, dealChecks, docLineId, docWord, evidenceWord, fpDiff, instOf, isChkF, lineIdOf, lineLabel, noteOf, parsePayChkCfg, planCheckWords, recordersOf, logsByDeal, sameFp, splitKey, sumRows, sumTotal, toMonthClose, toPayCheck,
  waitingElsewhere, yearCheck, ymOf, ymTh, type ChkRow, type PayCheck,
} from './payCheck';
import { colName, excelSerial, sheetName, sheetXml, xlsxBytes, xlsxFiles } from './xlsx';
import { applyRow, localRecords, noEffects, type SharedState } from './teamSync';

const T = '2026-10-12';
const L = (p: Partial<PayLine> = {}): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, fullAt: null, add: false, at: '2026-05-02T03:00:00.000Z', by: 'หมิว', ...p });
const doc = (p: Partial<DealDoc>): DealDoc => ({
  id: 'r', deal: 'x', kind: 'receipt', name: 'r.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: '', docDate: '', amount: 100, target: 'actual', detected: 100, basis: 'total', stage: 'PAY1', at: '2026-10-01T00:00:00.000Z', by: 'ปลา', ...p,
});
function world(spec: Record<string, { d?: Partial<Deal>; steps?: Record<string, [string, string]>; pays?: Record<string, Partial<PayLine>> }>): SalesState {
  const s = emptySales();
  for (const [id, x] of Object.entries(spec)) {
    s.deals[id] = newDeal({ id, client: 'บริษัท ' + id, year: '2569', ...x.d }, 'หมิว', '2026-01-05T03:00:00.000Z');
    Object.entries(x.steps || {}).forEach(([p, [d, n]]) => (s.steps[`${id}/${p}`] = { d, n }));
    Object.entries(x.pays || {}).forEach(([p, v]) => (s.pays[`${id}/${p}`] = L(v)));
  }
  return s;
}
const YES = (d: string): Record<string, [string, string]> => ({ 'CLOSED DEAL': [d, 'YES'] });
/** The Cashflow tests' demo world (the mockups' figures less the joint quotation, which package quotes adds). */
function demo(): SalesState {
  return world({
    c1: { d: { client: 'อมตะ คอร์ปอเรชัน', jobStatus: 'closed', closedDate: '2026-08-20', forecast: 240000, resp: 'ปลา', section: 'TGO' }, steps: YES('2026-06-10'), pays: { PAY1: { amt: 120000, due: '2026-06-30', rcv: '2026-06-30' }, PAY2: { amt: 120000, due: '2026-08-15', rcv: '2026-08-15' } } },
    c2: { d: { client: 'พฤกษา โฮลดิ้ง', jobStatus: 'closed', closedDate: '2026-10-06', forecast: 180000, actual: 180000, resp: 'คุณเอ' }, steps: { ...YES('2026-08-28'), PAY1: ['2026-09-25', 'รับงวด 1'], PAY2: ['2026-10-05', 'รับงวด 2'] } },
    c4: { d: { client: 'ดับบลิวเอชเอ', jobStatus: 'closed', closedDate: '2026-04-30', forecast: 95000, actual: 95000 }, steps: { ...YES('2026-03-12'), PAY1: ['2026-04-20', 'รับครบ'] } },
    w1: { d: { client: 'แสนสิริ กรีน พร็อพเพอร์ตี้', forecast: 214000, resp: 'หมิว' }, steps: YES('2026-09-04'), pays: { PAY1: { amt: 107000, due: '2026-09-20', rcv: '2026-09-19' }, PAY2: { amt: 107000, due: '2026-10-20' } } },
    w2: { d: { client: 'ไทยออยล์ เอนเนอร์ยี่', forecast: 160500, resp: 'คุณเอ' }, steps: YES('2026-10-03'), pays: { PAY1: { amt: 80250, due: '2026-10-08' }, PAY2: { amt: 80250, due: '2026-11-15' } } },
    w3: { d: { client: 'เบทาโกร ฟู้ด', forecast: 98000 }, steps: YES('2026-10-09'), pays: { PAY1: { amt: 49000, due: '2026-10-15' }, PAY2: { amt: 49000, due: '2026-11-30' } } },
    demo3: { d: { client: 'คงธนา เซอร์วิส', forecast: 250000, actual: 125000, resp: 'มกร' }, steps: { ...YES('2026-09-27'), PAY1: ['2026-10-06', 'รับงวดที่ 1 แล้ว'] } },
    dep2: { d: { client: 'ปทุมธานี ฟาร์มา', forecast: 530000, section: 'Depa', resp: 'คุณบี' }, steps: YES('2026-10-08'), pays: { PAY1: { amt: 212000, due: '2026-11-15' }, PAY2: { amt: 159000, due: '2026-12-15' }, PAY3: { amt: 159000, due: '2027-02-15' } } },
    demo7: { d: { forecast: 140000 }, steps: { 'CLOSED DEAL': ['2026-09-07', 'NO'] }, pays: { PAY1: { amt: 140000, due: '2026-10-01' } } },
  });
}
const lines = (s: SalesState) => cashLines(s, Object.values(s.deals), T);
const rec = (p: Partial<PayCheck> & Pick<PayCheck, 'amt' | 'd'>): PayCheck => ({ s: 'ok', by: 'ฝน', at: '2026-10-12T03:00:00.000Z', f: '', ...p });
const rowsOf = (s: SalesState, checks: Record<string, PayCheck> = s.pchk || {}, since = PAYCHK_CFG0.since) => chkRows(s, lines(s), checks, since);
const byKey = (rows: ChkRow[], k: string) => rows.find((r) => r.key === k)!;
const month = (rows: ChkRow[], ym: string) => rows.filter((r) => r.ym === ym);
/** Day and month are joined by a no-break space on screen (format.ts dmTh): compared as plain spaces. */
const sp = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/\u00a0/g, ' '));
const log = (s: SalesState, deal: string, action: string, by: string, at: string, detail = '') => {
  const id = 'L' + Object.keys(s.log).length;
  s.log[id] = { id, at, by, action, client: s.deals[deal]?.client || '', detail, deal } as DealLog;
};

describe('the month card against the Cashflow bars', () => {
  const s = demo(), Y = cashYear(lines(s), '2569'), rows = rowsOf(s);
  it('October: 305,000 in · 156,000 to come · 80,250 late; the sum is the ต.ค. bar (541,250)', () => {
    const c = sumRows(month(rows, '2026-10'));
    expect([c.got, c.owed, c.late]).toEqual([305000, 156000, 80250]);
    expect(sumTotal(c)).toBe(541250);
    expect(barOf(c)).toEqual(Y.months[9]);
    expect([c.gotN, c.owedN, c.lateN, c.lastGot, c.dues, c.firstLate]).toEqual([2, 2, 1, '2026-10-06', ['2026-10-15', '2026-10-20'], '2026-10-08']);
  });
  it('every month of 2569 equals its bar; the year equals the Cashflow cards', () => {
    for (let i = 0; i < 12; i++) expect(barOf(sumRows(month(rows, ymOf(2026, i)))), 'month ' + i).toEqual(Y.months[i]);
    const yc = yearCheck(rows, 2026, {}, T);
    const K = cashKpis(Y, '2569', T);
    expect(yc.total.got).toBe(K.got);
    expect(yc.total.owed + yc.total.late).toBe(K.owed);
    expect(yc.total.late).toBe(K.late);
    expect(sumTotal(yc.total)).toBe(K.total);
    expect(yc.months.map((m) => sumTotal(m.sum))).toEqual(Y.months.map((m) => m.got + m.late + m.wait));
  });
  it('a check never changes a money figure', () => {
    const t = demo();
    t.pchk = { 'c1/PAY1': rec({ amt: 120000, d: '2026-06-30' }), 'w1/PAY1': rec({ s: 'back', amt: 1, d: '2026-09-19', note: 'x' }), 'w2/PAY1': rec({ amt: 80250, d: '2026-10-08' }) };
    expect(cashYear(lines(t), '2569')).toEqual(Y);
    const after = rowsOf(t);
    for (let i = 0; i < 12; i++) expect(barOf(sumRows(month(after, ymOf(2026, i))))).toEqual(Y.months[i]);
  });
  it('the received lines and their ids: a plan stage, typed, a document', () => {
    const got = rows.filter((r) => r.kind === 'got').map((r) => r.key);
    expect(got).toEqual(['c4/typed', 'c1/PAY1', 'c1/PAY2', 'w1/PAY1', 'c2/typed', 'demo3/typed']);
    expect(rows.filter((r) => r.kind === 'got').every((r) => r.state === 'wait')).toBe(true);
    const t = demo();
    t.docs['c4/rc1'] = doc({ id: 'rc1', deal: 'c4', amount: 95000, stage: 'PAY1', docDate: '2026-04-20' });
    const l = lines(t).find((x) => x.deal.id === 'c4' && x.kind === 'got')!;
    expect(lineIdOf(l)).toBe('doc.rc1');
    expect(lineIdOf(lines(t).find((x) => x.kind === 'owed')!)).toBeNull();
    expect(splitKey('c4/doc.rc1')).toEqual({ dealId: 'c4', lineId: 'doc.rc1' });
  });
});

describe('the state of a received line', () => {
  it('no record waits; a record matching the line holds; a different amount, date or evidence is "changed"', () => {
    const s = demo();
    s.pchk = { 'c1/PAY1': rec({ amt: 120000, d: '2026-06-30' }), 'c1/PAY2': rec({ amt: 120000, d: '2026-08-14' }), 'c2/typed': rec({ s: 'back', amt: 180000, d: '2026-10-05', note: 'ขอใบเสร็จ' }) };
    let rows = rowsOf(s);
    expect(byKey(rows, 'w1/PAY1').state).toBe('wait');
    expect(byKey(rows, 'c1/PAY1').state).toBe('ok');
    expect(byKey(rows, 'c2/typed').state).toBe('back');
    const ch = byKey(rows, 'c1/PAY2');
    expect(ch.state).toBe('changed');
    expect(ch.diff).toEqual({ amt: null, d: ['2026-08-14', '2026-08-15'], add: [], rm: [] });
    expect(changeWords(s, ch)).toBe('วันที่รับจาก 14 ส.ค. 2569 เป็น 15 ส.ค. 2569');
    // a receipt attached at the checked stage replaces the hand receipt: evidence (and here the amount) changed
    s.docs['c1/rc9'] = doc({ id: 'rc9', deal: 'c1', amount: 118000, stage: 'PAY1', docNo: 'RC-2569-031', docDate: '2026-06-30', basis: 'netPay' });
    rows = rowsOf(s);
    const r = byKey(rows, 'c1/PAY1');
    expect(r.state).toBe('changed');
    expect(r.diff).toMatchObject({ amt: [120000, 118000], add: ['rc9'], rm: [] });
    expect(changeWords(s, r)).toBe('ยอดจาก 120,000 เป็น 118,000 บาท · แนบใบเสร็จ RC-2569-031');
    expect(evidenceWord(r)).toBe('ใบเสร็จ RC-2569-031');
    expect(basisWord(r)).toBe('หลังหัก ณ ที่จ่าย');
    expect(chipOf(r)).toEqual({ word: 'รอตรวจ', cls: 'chip', meta: 'เปลี่ยนหลังตรวจ' });
    expect(sp(chipOf(byKey(rows, 'c2/typed')))).toEqual({ word: 'ส่งกลับแก้ไข', cls: 'chip', meta: 'ฝน 12 ต.ค.' });
  });
  it('a part-paid line: a second receipt changes the amount, so it waits again', () => {
    const s = world({ p1: { d: { forecast: 100000 }, steps: YES('2026-09-01'), pays: { PAY1: { amt: 100000, due: '2026-09-30', rcv: '2026-09-28', got: 60000 } } } });
    let rows = rowsOf(s);
    const got = byKey(rows, 'p1/PAY1');
    expect([got.kind, got.amt, got.fp]).toEqual(['got', 60000, { amt: 60000, d: '2026-09-28', f: '' }]);
    expect(rows.find((r) => r.kind === 'late')!.amt).toBe(40000);
    s.pchk = { 'p1/PAY1': rec({ amt: 60000, d: '2026-09-28' }) };
    expect(byKey(rowsOf(s), 'p1/PAY1').state).toBe('ok');
    s.pays['p1/PAY1'].add = true; // the rest by receipt, counted on top of the hand receipt
    s.docs['p1/rc2'] = doc({ id: 'rc2', deal: 'p1', amount: 40000, stage: 'PAY1', docDate: '2026-09-28' });
    rows = rowsOf(s);
    expect(byKey(rows, 'p1/PAY1')).toMatchObject({ state: 'changed', amt: 100000, diff: { amt: [60000, 100000], add: ['rc2'] } });
  });
  it('fingerprints: an amount the script hid matches; f as a list is read sorted', () => {
    expect(sameFp({ amt: null, d: '2026-10-05', f: '' }, { amt: 180000, d: '2026-10-05', f: '' })).toBe(true);
    expect(sameFp({ amt: 180000.001, d: '2026-10-05', f: 'a,b' }, { amt: 180000, d: '2026-10-05', f: 'a,b' })).toBe(true);
    expect(sameFp({ amt: 180000, d: '2026-10-05', f: 'a' }, { amt: 180000, d: '2026-10-05', f: 'a,b' })).toBe(false);
    expect(fpDiff({ amt: 1, d: 'x', f: 'a,b' }, { amt: 1, d: 'x', f: 'b,c' })).toEqual({ amt: null, d: null, add: ['c'], rm: ['a'] });
    expect(toPayCheck({ s: 'back', amt: 187250, d: '2026-10-05', f: ['z', 'a'], note: 'ยอดไม่ตรง', by: 'ฝน', at: 'x' })).toEqual({ s: 'back', by: 'ฝน', at: 'x', amt: 187250, d: '2026-10-05', f: 'a,z', note: 'ยอดไม่ตรง' });
    expect(toPayCheck({ s: 'ok', amt: null, d: 'bad', f: '' })).toMatchObject({ amt: null, d: '' });
    expect(toPayCheck({ s: 'maybe' })).toBeNull();
    expect(toPayCheck('x')).toBeNull();
    expect(toMonthClose({ by: 'ฝน', at: 'a', n: '2', amt: 601500 })).toEqual({ by: 'ฝน', at: 'a', n: 2, amt: 601500 });
    expect(toMonthClose([1])).toBeNull();
  });
});

describe('orphans: a check whose line is gone', () => {
  it('a typed Actual replaced by a document: the old check is "ยกเลิกหลังตรวจ" in its month, the document waits', () => {
    const s = demo();
    s.pchk = { 'demo3/typed': rec({ amt: 125000, d: '2026-10-06' }) };
    expect(byKey(rowsOf(s), 'demo3/typed').state).toBe('ok');
    s.docs['demo3/rc3'] = doc({ id: 'rc3', deal: 'demo3', amount: 125000, stage: 'PAY1', docDate: '2026-10-06' });
    const rows = rowsOf(s);
    const o = byKey(rows, 'demo3/typed');
    expect([o.kind, o.ym, o.amt, o.state, o.line]).toEqual(['orphan', '2026-10', 125000, 'ok', null]);
    expect(byKey(rows, 'demo3/doc.rc3').state).toBe('wait');
    expect(sp(chipOf(o))).toEqual({ word: 'ยกเลิกหลังตรวจ', cls: 'chip', meta: 'ฝน 12 ต.ค.' });
    expect(instOf(o, s)).toEqual({ text: 'ไม่มีแผน', sub: 'Actual พิมพ์เอง' });
    const c = sumRows(month(rows, '2026-10'));
    expect([c.orphans, c.n, c.got]).toEqual([1, 2, 305000]);
  });
  it('a check on money not received (a cancelled receipt) is an orphan, never in the progress', () => {
    const s = demo();
    s.pchk = { 'w2/PAY1': rec({ amt: 80250, d: '2026-10-08' }) };
    const rows = rowsOf(s);
    expect(byKey(rows, 'w2/PAY1').kind).toBe('orphan');
    const c = sumRows(month(rows, '2026-10'));
    expect([c.n, c.ok, c.orphans, c.late]).toEqual([2, 0, 1, 80250]);
    // the receipt cancelled: who and when, from the history
    log(s, 'w2', 'ยกเลิกการรับ PAY1', 'คุณเอ', '2026-10-12T05:00:00.000Z');
    const n = sp(noteOf(s, byKey(rowsOf(s), 'w2/PAY1'))!);
    expect(n.head).toBe('ยกเลิกหลังตรวจ · คุณเอ ยกเลิกการรับ PAY1 เมื่อ 12 ต.ค.');
    expect(n.body).toBe('ฝน ตรวจไว้เมื่อ 12 ต.ค. ที่ยอด 80,250 บาท รับ 8 ต.ค. 2569 · ตอนนี้ไม่ได้นับเป็นเงินเข้าแล้ว');
  });
  it('a deleted deal leaves its checks as orphans; a renamed stage too', () => {
    const s = demo();
    s.pchk = { 'gone/PAY1': rec({ amt: 5000, d: '2026-09-01' }), 'w1/PAY9': rec({ amt: 107000, d: '2026-09-19' }) };
    const rows = rowsOf(s);
    expect(byKey(rows, 'gone/PAY1')).toMatchObject({ kind: 'orphan', deal: null, ym: '2026-09' });
    expect(noteOf(s, byKey(rows, 'gone/PAY1'))!.head).toBe('ยกเลิกหลังตรวจ · งานนี้ถูกลบแล้ว');
    expect(byKey(rows, 'w1/PAY9')).toMatchObject({ kind: 'orphan', lineId: 'PAY9' });
    expect(instOf(byKey(rows, 'w1/PAY9'))).toEqual({ text: 'PAY9', sub: 'งวดที่ยกเลิก' });
  });
});

describe('late money carried, other months waiting', () => {
  it('a line due in September still unpaid is September\'s late figure; October says it is carried', () => {
    const s = demo();
    s.deals.s9 = newDeal({ id: 's9', client: 'บริษัท ค้างจ่าย', year: '2569' }, 'หมิว', '2026-01-05T03:00:00.000Z');
    s.steps['s9/CLOSED DEAL'] = { d: '2026-08-01', n: 'YES' };
    s.pays['s9/PAY1'] = L({ amt: 30000, due: '2026-09-25' });
    const rows = rowsOf(s);
    expect(sumRows(month(rows, '2026-09')).late).toBe(30000);
    expect(sumRows(month(rows, '2026-10')).late).toBe(80250);
    expect(carriedLate(rows, '2026-10')).toEqual({ n: 1, amt: 30000 });
    expect(carriedLate(rows, '2026-09')).toEqual({ n: 0, amt: 0 });
  });
  it('lines waiting in other months of the year, by month', () => {
    const rows = rowsOf(demo());
    const w = waitingElsewhere(rows, '2026-10');
    expect(w.months).toEqual([{ ym: '2026-04', n: 1 }, { ym: '2026-06', n: 1 }, { ym: '2026-08', n: 1 }, { ym: '2026-09', n: 1 }]);
    expect(w.words).toBe('เม.ย. 1 · มิ.ย. 1 · ส.ค. 1 · ก.ย. 1');
    expect(waitingElsewhere(rows.filter((r) => r.ym !== '2026-04' && r.ym !== '2026-06' && r.ym !== '2026-09'), '2026-10').words).toBe('ส.ค.');
  });
});

describe('the first month checked (go-live)', () => {
  it('defaults to ม.ค. 2569; lines before `since` have no status and are not counted', () => {
    expect(parsePayChkCfg(undefined)).toEqual({ since: '2026-01-01' });
    expect(parsePayChkCfg({ since: '2026-07-01' })).toEqual({ since: '2026-07-01' });
    expect(parsePayChkCfg({ since: 'July' })).toEqual({ since: '2026-01-01' });
    const s = demo();
    s.pchk = { 'c4/typed': rec({ amt: 95000, d: '2026-04-20' }) };
    const rows = rowsOf(s, s.pchk, '2026-07-01');
    expect(byKey(rows, 'c4/typed')).toMatchObject({ state: 'none', rec: null });
    expect(byKey(rows, 'c1/PAY1').state).toBe('none');
    expect(chipOf(byKey(rows, 'c1/PAY1'))).toBeNull();
    const y = sumRows(rows);
    expect([y.gotN, y.n, y.got, y.amt]).toEqual([6, 4, 747000, 532000]);
    // a record before the first month is not an orphan either
    s.pchk = { 'gone/PAY1': rec({ amt: 1, d: '2026-03-01' }) };
    expect(rowsOf(s, s.pchk, '2026-07-01').some((r) => r.kind === 'orphan')).toBe(false);
    expect(yearCheck(rows, 2026, {}, T).months[3].state).toBe('none');
  });
});

describe('closing a month', () => {
  it('not the current month, not with a line waiting or sent back, not with an orphan; after a close an edit reopens a line', () => {
    const s = demo();
    let rows = rowsOf(s);
    const sep = () => sumRows(month(rows, '2026-09'));
    expect(closeStateOf(sep(), '2026-09', null, T)).toBe('open');
    expect(canClose(sumRows(month(rows, '2026-10')), '2026-10', T)).toBe(false);
    expect(closeStateOf(sumRows(month(rows, '2026-10')), '2026-10', null, T)).toBe('current');
    expect(closeStateOf(sumRows(month(rows, '2026-11')), '2026-11', null, T)).toBe('future');
    expect(closeStateOf(sumRows(month(rows, '2026-07')), '2026-07', null, T)).toBe('none');
    s.pchk = { 'w1/PAY1': rec({ s: 'back', amt: 107000, d: '2026-09-19', note: 'x' }) };
    rows = rowsOf(s);
    expect(canClose(sep(), '2026-09', T)).toBe(false);
    s.pchk = { 'w1/PAY1': rec({ amt: 107000, d: '2026-09-19' }) };
    rows = rowsOf(s);
    expect(canClose(sep(), '2026-09', T)).toBe(true);
    const close = closeRecord(sep(), 'ฝน', '2026-10-12T04:00:00.000Z');
    expect(close).toEqual({ by: 'ฝน', at: '2026-10-12T04:00:00.000Z', n: 1, amt: 107000 });
    expect(closeStateOf(sep(), '2026-09', close, T)).toBe('closed');
    expect(afterClose(sep())).toBe(0);
    // the receipt's date corrected after the close: the line waits again
    s.pays['w1/PAY1'].rcv = '2026-09-20';
    rows = rowsOf(s);
    expect(afterClose(sep())).toBe(1);
    expect(yearCheck(rows, 2026, { '2026-09': close }, T)).toMatchObject({ closed: 1 });
    // an orphan in the month also stops a close
    s.pays['w1/PAY1'].rcv = '2026-09-19';
    s.pchk['gone/PAY1'] = rec({ amt: 5, d: '2026-09-02' });
    rows = rowsOf(s);
    expect(canClose(sep(), '2026-09', T)).toBe(false);
  });
});

describe('who may check (the self-check)', () => {
  it('the recorder of a hand receipt is the author of its "รับชำระ" history row, not the plan line\'s last writer', () => {
    const s = demo();
    log(s, 'c1', 'รับชำระ PAY1', 'ปลา', '2026-06-30T08:00:00.000Z', '120,000 บาท · โอน');
    s.pays['c1/PAY1'].by = 'หมิว'; // a later plan edit by someone else
    const rows = rowsOf(s);
    const r = byKey(rows, 'c1/PAY1');
    expect(r.by).toEqual(['ปลา']);
    expect(canTick(r, 'ปลา')).toBe(false);
    expect(canConfirm(r, ' ปลา ')).toBe(false);
    expect(canReturn(r, 'ปลา')).toBe(false);
    expect(canTick(r, 'ฝน')).toBe(true);
    expect(canTick(r, 'หมิว')).toBe(true);
    expect(canTick(r, '')).toBe(false);
    // old data without the row: the plan line's writer
    expect(byKey(rows, 'c1/PAY2').by).toEqual(['หมิว']);
  });
  it('a document\'s attacher; a typed Actual\'s editor; both a hand receipt and a receipt counted together', () => {
    const s = demo();
    s.docs['demo3/rc3'] = doc({ id: 'rc3', deal: 'demo3', amount: 125000, stage: 'PAY1', by: 'มกร' });
    log(s, 'c2', 'แก้ไข', 'คุณเอ', '2026-10-05T03:00:00.000Z', 'Actual');
    log(s, 'c2', 'แก้ไข', 'หมิว', '2026-10-06T03:00:00.000Z', 'ผู้รับผิดชอบ');
    s.pays['w1/PAY1'].add = true;
    s.docs['w1/rc5'] = doc({ id: 'rc5', deal: 'w1', amount: 1000, stage: 'PAY1', by: 'ปลา', at: '2026-09-20T00:00:00.000Z' });
    log(s, 'w1', 'รับชำระ PAY1', 'หมิว', '2026-09-19T05:00:00.000Z');
    const ls = lines(s), logs = logsByDeal(s);
    const of = (id: string) => recordersOf(s, ls.find((l) => l.deal.id === id && l.kind === 'got')!, logs);
    expect(of('demo3')).toEqual(['มกร']);
    expect(of('c2')).toEqual(['คุณเอ']);
    expect(of('w1')).toEqual(['ปลา', 'หมิว']); // the newest first
    expect(of('c4')).toEqual(['หมิว']); // typed, no history row: the deal's last writer
  });
  it('"select all" picks only lines waiting (a returned line has no tick box); undo is one\'s own, 10 minutes', () => {
    const s = demo();
    s.pchk = { 'c1/PAY1': rec({ amt: 120000, d: '2026-06-30' }), 'c2/typed': rec({ s: 'back', amt: 180000, d: '2026-10-05', note: 'x' }), 'c1/PAY2': rec({ amt: 1, d: '2026-08-15' }) };
    const rows = rowsOf(s);
    expect(rows.filter((r) => canTick(r, 'ฝน')).map((r) => r.key)).toEqual(['c4/typed', 'c1/PAY2', 'w1/PAY1', 'demo3/typed']);
    expect(canTick(byKey(rows, 'c2/typed'), 'ฝน')).toBe(false);
    expect(canConfirm(byKey(rows, 'c2/typed'), 'ฝน')).toBe(true);
    expect(canReturn(byKey(rows, 'c2/typed'), 'ฝน')).toBe(false);
    expect(canConfirm(byKey(rows, 'c1/PAY1'), 'ฝน')).toBe(false);
    const at = Date.parse('2026-10-12T03:00:00.000Z');
    expect(canUndo(s.pchk['c1/PAY1'], 'ฝน', at + 9 * 60000)).toBe(true);
    expect(canUndo(s.pchk['c1/PAY1'], 'ฝน', at + 11 * 60000)).toBe(false);
    expect(canUndo(s.pchk['c1/PAY1'], 'มกร', at)).toBe(false);
  });
});

describe('the filter and the words', () => {
  it('chips count the lines of each kind; รอตรวจ holds never-checked and changed lines', () => {
    const s = demo();
    s.pchk = { 'c2/typed': rec({ s: 'back', amt: 180000, d: '2026-10-05', note: 'ยอดไม่ตรง' }), 'demo3/typed': rec({ amt: 125000, d: '2026-10-06' }) };
    const oct = month(rowsOf(s), '2026-10');
    expect(chkCounts(oct)).toEqual({ all: 5, wait: 0, ok: 1, back: 1, owed: 2, late: 1 });
    expect(oct.filter((r) => chkMatch(r, 'owed')).map((r) => r.dealId)).toEqual(['w3', 'w1']);
    expect(isChkF('late')).toBe(true);
    expect(isChkF('x')).toBe(false);
    const back = byKey(oct, 'c2/typed');
    log(s, 'c2', 'แก้ไข', 'คุณเอ', '2026-10-05T03:00:00.000Z', 'Actual');
    const n = sp(noteOf(s, byKey(month(rowsOf(s), '2026-10'), 'c2/typed'))!);
    expect(n).toEqual({ head: 'สิ่งที่ต้องแก้ จาก ฝน · 12 ต.ค. · ส่งถึง คุณเอ', body: 'ยอดไม่ตรง', to: 'คุณเอ' });
    expect(instOf(back)).toEqual({ text: 'ไม่มีแผน', sub: 'รับที่ PAY2' });
    expect(basisWord(back)).toBe('พิมพ์เอง');
    expect(evidenceWord(back)).toBe('ไม่มีไฟล์');
    expect(lineLabel(back)).toBe('รับที่ PAY2 · พิมพ์เอง');
    expect(basisWord(byKey(oct, oct.find((r) => r.kind === 'late')!.key))).toBe('ตามแผน');
    expect(docWord({ kind: 'invoice', docNo: 'INV-1' })).toBe('ใบแจ้งหนี้ INV-1');
    expect(ymTh('2026-10')).toBe('ตุลาคม 2569');
    expect(ymTh('2026-10', true)).toBe('ต.ค. 2569');
    expect(chkFileName('2026-10', 2026)).toBe('ตรวจรับเงิน_2569-10.xlsx');
    expect(chkFileName(null, 2026)).toBe('ตรวจรับเงิน_2569.xlsx');
  });
  it('a line changed after its check names the change, who made it and when', () => {
    const s = demo();
    s.pchk = { 'c1/PAY2': rec({ amt: 120000, d: '2026-08-14', at: '2026-09-02T03:00:00.000Z' }) };
    s.docs['c1/rc47'] = doc({ id: 'rc47', deal: 'c1', amount: 120000, stage: 'PAY2', docNo: 'RC-2569-047', docDate: '2026-08-15', by: 'ปลา' });
    s.steps['c1/PAY2'] = { d: '2026-08-15', n: 'รับ' };
    log(s, 'c1', 'แนบใบเสร็จ / ใบกำกับภาษี', 'ปลา', '2026-10-10T03:00:00.000Z', 'rc.pdf · 120,000 บาท');
    log(s, 'c1', 'ตรวจรับเงิน PAY1', 'ฝน', '2026-10-11T03:00:00.000Z');
    const r = byKey(rowsOf(s), 'c1/PAY2');
    expect(r.state).toBe('changed');
    const n = sp(noteOf(s, r)!);
    expect(n.head).toBe('เปลี่ยนหลังตรวจ · ปลา แก้เมื่อ 10 ต.ค. (แนบใบเสร็จ / ใบกำกับภาษี)');
    expect(n.body).toBe('วันที่รับจาก 14 ส.ค. 2569 เป็น 15 ส.ค. 2569 · แนบใบเสร็จ RC-2569-047 · ฝน ตรวจไว้เมื่อ 2 ก.ย. ที่ยอด 120,000 บาท ยอดไม่เปลี่ยน');
  });
});

describe('the records through the team sync', () => {
  const shared = (): SharedState => ({ crm: { stages: {}, owners: {}, watch: [], team: [], tasks: [], log: {} } as unknown as SharedState['crm'], contacts: {}, dec: {}, sales: demo(), custom: {} });
  it('dchk/ and mclose/ apply as whole records, deletions remove them, malformed ones are skipped; scfg/paychk.cfg', () => {
    const s = shared(), fx = noEffects();
    applyRow(s, { seq: 1, k: 'dchk/w1/PAY1', v: { s: 'ok', by: 'ฝน', at: 'a', amt: 107000, d: '2026-09-19', f: '' }, del: false, by: 'ฝน', at: 'a' }, fx);
    applyRow(s, { seq: 2, k: 'dchk/c4/doc.rc1', v: { s: 'back', by: 'ฝน', at: 'a', amt: null, d: '2026-04-20', f: ['rc1'], note: 'ขอใบเสร็จ' }, del: false, by: 'ฝน', at: 'a' }, fx);
    applyRow(s, { seq: 3, k: 'dchk/w1', v: { s: 'ok' }, del: false, by: '', at: '' }, fx); // no line id
    applyRow(s, { seq: 4, k: 'dchk/w2/PAY1', v: { s: 'nope' }, del: false, by: '', at: '' }, fx);
    applyRow(s, { seq: 5, k: 'mclose/2026-09', v: { by: 'ฝน', at: 'a', n: 1, amt: 107000 }, del: false, by: 'ฝน', at: 'a' }, fx);
    applyRow(s, { seq: 6, k: 'mclose/sep', v: { by: 'ฝน', n: 1 }, del: false, by: 'ฝน', at: 'a' }, fx);
    applyRow(s, { seq: 7, k: 'scfg/paychk.cfg', v: { since: '2026-07-01' }, del: false, by: 'หมิว', at: 'a' }, fx);
    expect(fx.sales).toBe(true);
    expect(Object.keys(s.sales.pchk!)).toEqual(['w1/PAY1', 'c4/doc.rc1']);
    expect(s.sales.pchk!['c4/doc.rc1']).toMatchObject({ s: 'back', amt: null, f: 'rc1', note: 'ขอใบเสร็จ' });
    expect(s.sales.mclose).toEqual({ '2026-09': { by: 'ฝน', at: 'a', n: 1, amt: 107000 } });
    expect(s.sales.pcfg).toEqual({ since: '2026-07-01' });
    // the records are the team's: a browser connecting seeds them like any other
    const m = localRecords(s);
    expect(m.get('dchk/w1/PAY1')).toMatchObject({ s: 'ok', amt: 107000 });
    expect(m.get('mclose/2026-09')).toMatchObject({ n: 1 });
    expect(m.get('scfg/paychk.cfg')).toEqual({ since: '2026-07-01' });
    applyRow(s, { seq: 8, k: 'dchk/w1/PAY1', v: null, del: true, by: 'ฝน', at: 'b' }, fx);
    applyRow(s, { seq: 9, k: 'mclose/2026-09', v: null, del: true, by: 'ฝน', at: 'b' }, fx);
    expect(Object.keys(s.sales.pchk!)).toEqual(['c4/doc.rc1']);
    expect(s.sales.mclose).toEqual({});
  });
});

describe('the Excel file', () => {
  it('October with the money to come: 5 lines and the head; amounts are numbers, dates real dates; a summary sheet', async () => {
    const s = demo();
    s.pchk = { 'c2/typed': rec({ s: 'back', amt: 180000, d: '2026-10-05', note: 'ยอดไม่ตรง' }), 'demo3/typed': rec({ amt: 125000, d: '2026-10-06' }) };
    const rows = month(rowsOf(s), '2026-10');
    const months = yearCheck(rowsOf(s), 2026, {}, T).months.filter((m) => m.ym === '2026-10');
    const [items, sum] = chkSheets(s, rows, months, true);
    expect(items.rows).toHaveLength(5);
    expect(chkSheets(s, rows, months, false)[0].rows).toHaveLength(2);
    expect(items.rows[0].slice(0, 7)).toEqual(['ต.ค. 2569', 'พฤกษา โฮลดิ้ง', '', 'ไม่มีแผน', 180000, 'พิมพ์เอง', { date: '2026-10-05' }]);
    expect(items.rows[0].slice(12)).toEqual(['ส่งกลับแก้ไข', 'ฝน', { date: '2026-10-12' }, 'ยอดไม่ตรง']);
    expect(sum.rows).toEqual([['ตุลาคม 2569', 305000, 156000, 80250, 541250, 2, 1, 125000, 0, 1, 'ยังไม่ปิด', '', null]]);
    const bytes = await xlsxBytes([items, sum]);
    const z = await JSZip.loadAsync(bytes);
    expect(Object.keys(z.files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].sort());
    const wb = await z.file('xl/workbook.xml')!.async('string');
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['รายการ', 'สรุป']);
    const sh1 = await z.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sh1.match(/<row /g)).toHaveLength(6);
    expect(sh1).toContain('<c r="E2" s="2"><v>180000</v></c>');
    expect(sh1).toContain(`<c r="G2" s="3"><v>${excelSerial('2026-10-05')}</v></c>`);
    expect(sh1).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">เดือน</t></is></c>');
    const ct = await z.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain('/xl/worksheets/sheet2.xml');
  });
  it('the writer: serials, columns, names and escapes', () => {
    expect(excelSerial('2026-10-05')).toBe(46300);
    expect(excelSerial('1900-03-01')).toBe(61);
    expect(excelSerial('2026-13-01')).not.toBe(46300);
    expect(excelSerial('x')).toBeNull();
    expect([colName(0), colName(25), colName(26), colName(27), colName(701)]).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ']);
    expect(sheetName('a/b[c]:*?', 0)).toBe('a b c');
    expect(sheetName('', 1)).toBe('Sheet2');
    const x = sheetXml({ name: 's', head: ['h'], rows: [['a & <b> "c"\u0001'], [null], [{ date: 'bad' }], [Infinity]] });
    expect(x).toContain('a &amp; &lt;b&gt; &quot;c&quot;</t>');
    expect(x).toContain('<row r="3"></row><row r="4"></row><row r="5"></row>');
    expect(Object.keys(xlsxFiles([{ name: 'a', head: [], rows: [] }]))).toContain('xl/worksheets/sheet1.xml');
  });
});

describe('the year table', () => {
  it('12 months, their close state, and the totals', () => {
    const s = demo();
    s.pchk = { 'c4/typed': rec({ amt: 95000, d: '2026-04-20' }), 'c1/PAY1': rec({ amt: 120000, d: '2026-06-30' }) };
    const Y = yearCheck(rowsOf(s), 2026, { '2026-04': { by: 'ฝน', at: '2026-05-05T03:00:00.000Z', n: 1, amt: 95000 } }, T);
    expect(Y.months.map((m) => m.state)).toEqual(['none', 'none', 'none', 'closed', 'none', 'can', 'none', 'open', 'open', 'current', 'future', 'future']);
    expect(Y.closed).toBe(1);
    expect([Y.total.ok, Y.total.n, Y.total.okAmt, Y.total.amt]).toEqual([2, 6, 215000, 747000]);
  });
});

describe('the deal panel', () => {
  it('one deal\'s received lines and its orphans, never another deal\'s; the plan\'s words; a document\'s line', () => {
    const s = demo();
    const checks = {
      'c1/PAY1': rec({ amt: 120000, d: '2026-06-30' }),
      'c1/PAY3': rec({ amt: 5000, d: '2026-07-01' }),
      'w1/PAY1': rec({ amt: 107000, d: '2026-09-19' }),
    };
    const rows = dealChecks(s, s.deals.c1, checks, PAYCHK_CFG0.since, T);
    // in date order, as the month card has them: the orphan sits on its checked date
    expect(rows.map((r) => [r.key, r.kind, r.state])).toEqual([
      ['c1/PAY1', 'got', 'ok'],
      ['c1/PAY3', 'orphan', expect.anything()],
      ['c1/PAY2', 'got', 'wait'],
    ]);
    expect(planCheckWords(rows)).toBe(' · บัญชีตรวจแล้ว 1 จาก 2 งวดที่รับ');
    // before the first month checked: nothing to say
    expect(planCheckWords(dealChecks(s, s.deals.c1, {}, '2027-01-01', T))).toBe('');
    expect(planCheckWords(dealChecks(s, s.deals.w3, {}, PAYCHK_CFG0.since, T))).toBe('');
    // a plan stage on a deal with a plan, the document's own line on one without
    expect(docLineId(s, { id: 'r1', deal: 'c1', stage: 'PAY2' })).toBe('PAY2');
    expect(docLineId(s, { id: 'rc1', deal: 'c4', stage: 'PAY1' })).toBe('doc.rc1');
  });
});
