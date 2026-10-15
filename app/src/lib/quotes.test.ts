import { describe, expect, it } from 'vitest';
import { dealMoney, emptySales, newDeal, salesStats, type DealDoc, type SalesState } from './sales';
import { isQtVersion, qtDelText, qtDiffText, qtFigWords, qtPrev, qtVerLabel, qtVerShort, qtVerText, qtVersions, qtView, swapCheck, thList } from './quotes';
import type { DocFacts } from './docExtract';
import { dmTh } from './format';
import { HELP_TOPICS, searchHelp } from './helpContent';

const TODAY = '2026-10-12';
/** A deal with its documents (by id: `at`, `cAt` and the rest given per document). */
function world(docs: Partial<DealDoc>[], forecast: number | null = null, fcAt?: string) {
  const s: SalesState = emptySales();
  const d = newDeal({ id: 'd1', client: 'บริษัท ซากิโนมิยะ ประเทศไทย จำกัด', section: 'TGO', year: '2569', forecast }, 'หมิว', '2026-09-01T00:00:00.000Z');
  if (fcAt) d.fcAt = fcAt;
  s.deals[d.id] = d;
  docs.forEach((x) => {
    const doc: DealDoc = {
      id: x.id!, deal: 'd1', kind: 'quotation', name: x.id + '.pdf', mime: 'application/pdf', size: 72000, fileId: '', docNo: 'QT-2569-014', docDate: '', amount: null, target: 'forecast',
      detected: null, basis: 'total', stage: 'QUOTATION', at: '', by: 'หมิว', ...x,
    };
    s.docs[`d1/${doc.id}`] = doc;
  });
  return { s, d: s.deals.d1 };
}
const facts = (o: Partial<DocFacts>): DocFacts => ({ kind: 'quotation', docNo: '', docDate: '', total: null, subtotal: null, vat: null, wht: null, netPay: null, words: null, party: '', candidates: [], confidence: 'high', ...o });

describe('quotation versions', () => {
  it('are numbered by when they were attached, not by when they were last confirmed', () => {
    // a revision set v1 to "not counted": that re-stamped v1's cAt after v2's
    const { s, d } = world([
      { id: 'v2', amount: 182970, at: '2026-10-09T03:00:00.000Z', cAt: '2026-10-09T03:00:00.000Z', docDate: '2026-10-09' },
      { id: 'v1', amount: 192600, target: 'none', at: '2026-10-04T03:00:00.000Z', cAt: '2026-10-09T03:00:00.001Z', docDate: '2026-10-04' },
    ]);
    expect(qtVersions(s, d).map((x) => x.id)).toEqual(['v1', 'v2']);
    const v = qtView(s, d);
    expect(v.versions.map((x) => [x.doc.id, x.n, x.state])).toEqual([['v1', 1, 'old'], ['v2', 2, 'cur']]);
    expect(v.head).toBe(v.cur);
    expect(v.cur!.doc.id).toBe('v2');
    expect(v.typed).toBe(false);
    // the same moment: the id decides, so every browser numbers them alike
    const t = '2026-10-04T03:00:00.000Z';
    const w = world([{ id: 'b', amount: 1, at: t }, { id: 'a', amount: 2, at: t, target: 'none' }]);
    expect(qtVersions(w.s, w.d).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('only quotations at QUOTATION are versions; the newest confirmed one counts, once', () => {
    const { s, d } = world([
      { id: 'v1', amount: 192600, target: 'none', at: '2026-10-04T03:00:00.000Z', cAt: '2026-10-09T03:00:00.001Z' },
      { id: 'v2', amount: 182970, at: '2026-10-09T03:00:00.000Z', cAt: '2026-10-09T03:00:00.000Z' },
      { id: 'po', kind: 'other', amount: null, target: 'none', at: '2026-10-10T03:00:00.000Z' },
      { id: 'inv', kind: 'invoice', stage: 'PAY1', amount: 50000, target: 'actual', at: '2026-10-11T03:00:00.000Z' },
      { id: 'other', stage: '', amount: 5000, target: 'none', at: '2026-10-11T03:00:00.000Z' },
    ]);
    expect(qtVersions(s, d).map((x) => x.id)).toEqual(['v1', 'v2']);
    expect(isQtVersion({ kind: 'quotation', stage: '' })).toBe(false);
    expect(isQtVersion({ kind: 'invoice', stage: 'QUOTATION' })).toBe(false);
    expect(dealMoney(s, d)).toMatchObject({ forecast: 182970, fcConfirmed: true });
    expect(salesStats(s, [d], TODAY)).toMatchObject({ forecast: 182970, fcConfirmed: 182970 });
  });

  it('a Forecast typed after the quotations: none is in use, the newest is the card\'s', () => {
    const { s, d } = world(
      [
        { id: 'v1', amount: 192600, target: 'none', at: '2026-10-04T03:00:00.000Z', cAt: '2026-10-09T03:00:00.001Z' },
        { id: 'v2', amount: 182970, at: '2026-10-09T03:00:00.000Z', cAt: '2026-10-09T03:00:00.000Z' },
      ],
      175000,
      '2026-10-10T00:00:00.000Z',
    );
    const v = qtView(s, d);
    expect(v.cur).toBeNull();
    expect(v.typed).toBe(true);
    expect(v.versions.map((x) => x.state)).toEqual(['old', 'last']);
    expect(v.head!.doc.id).toBe('v2');
    expect(qtVerLabel(v.head!)).toBe('ฉบับที่ 2 · ล่าสุด');
    expect(qtVerText(v.head!, v.typed)).toBe('9 ต.ค. 2569 · 182,970 บาท · Forecast พิมพ์เองทีหลัง');
    expect(qtDelText(v, d)).toBe('Forecast ที่พิมพ์ไว้ยังเหมือนเดิม');
    expect(salesStats(s, [d], TODAY).forecast).toBe(175000);
  });

  it('the one before the version in use: the nearest earlier with an amount', () => {
    const docs = [
      { id: 'v1', amount: 100 },
      { id: 'v2', amount: null },
      { id: 'v3', amount: 300 },
    ] as DealDoc[];
    expect(qtPrev(docs, 'v3')!.id).toBe('v1');
    expect(qtPrev(docs, 'v1')).toBeNull();
    expect(qtPrev(docs, 'nope')).toBeNull();
  });

  it('says what deleting the version in use does to the Forecast', () => {
    const two = world([
      { id: 'v1', amount: 192600, target: 'none', at: '2026-10-04T03:00:00.000Z', cAt: '2026-10-09T03:00:00.001Z' },
      { id: 'v2', amount: 182970, at: '2026-10-09T03:00:00.000Z', cAt: '2026-10-09T03:00:00.000Z' },
    ]);
    expect(qtDelText(qtView(two.s, two.d), two.d)).toBe('ฉบับที่ 1 กลับมาเป็น Forecast');
    const typed = world([{ id: 'v1', amount: 192600, at: '2026-10-04T03:00:00.000Z', cAt: '2026-10-04T03:00:00.000Z' }], 150000, '2026-10-01T00:00:00.000Z');
    expect(qtDelText(qtView(typed.s, typed.d), typed.d)).toBe('Forecast กลับเป็นยอดที่พิมพ์ไว้ 150,000');
    const one = world([{ id: 'v1', amount: 192600, at: '2026-10-04T03:00:00.000Z' }]);
    expect(qtDelText(qtView(one.s, one.d), one.d)).toBe('ไม่มี Forecast จากใบเสนอราคาแล้ว');
    expect(qtDelText(qtView(world([]).s, world([]).d), world([]).d)).toBe('');
  });

  it('words for the card, the phone and the table', () => {
    const { s, d } = world([
      { id: 'v1', amount: 192600, target: 'none', at: '2026-10-04T03:00:00.000Z', cAt: '2026-10-09T03:00:00.001Z', docDate: '2026-10-04' },
      { id: 'v2', amount: 182970, at: '2026-10-09T03:00:00.000Z', cAt: '2026-10-09T03:00:00.000Z', docDate: '2026-10-09' },
    ]);
    const v = qtView(s, d), [v1, v2] = v.versions;
    expect(qtVerLabel(v2)).toBe('ฉบับที่ 2 · ใช้อยู่');
    expect(qtVerLabel(v1)).toBe('ฉบับที่ 1 · ฉบับเดิม');
    expect(qtVerText(v2, false)).toBe('9 ต.ค. 2569 · 182,970 บาท · นับเป็น Forecast');
    expect(qtVerText(v1, false)).toBe('4 ต.ค. 2569 · 192,600 บาท · ไม่นับยอด');
    expect(qtVerShort(v1)).toBe(`192,600 · ${dmTh('2026-10-04')} · ไม่นับยอด`);
    expect(qtFigWords(v, 'v2')).toEqual({ text: 'ฉบับที่ 2', title: 'จากเอกสาร QT-2569-014 ฉบับที่ 2 (ฉบับที่ 1 192,600 ไม่นับแล้ว)' });
    // one version: the table keeps the document number
    const one = world([{ id: 'v1', amount: 192600, at: '2026-10-04T03:00:00.000Z' }]);
    expect(qtFigWords(qtView(one.s, one.d), 'v1')).toBeNull();
    // no date on the document: the day it was attached
    const nd = world([{ id: 'v1', amount: null, target: 'none', at: '2026-10-04T03:00:00.000Z' }]);
    expect(qtVerText(qtView(nd.s, nd.d).versions[0], false)).toBe('4 ต.ค. 2569 · ไม่ระบุยอด · ไม่นับยอด');
  });

  it('compares a revision with the version it follows', () => {
    expect(qtDiffText(192600, 182970)).toBe('ฉบับแก้ไขน้อยกว่าเดิม 9,630 บาท (ลด 5%)');
    expect(qtDiffText(100000, 112000)).toBe('ฉบับแก้ไขมากกว่าเดิม 12,000 บาท (เพิ่ม 12%)');
    expect(qtDiffText(100000, 100400)).toBe('ฉบับแก้ไขมากกว่าเดิม 400 บาท (เพิ่มไม่ถึง 1%)');
    expect(qtDiffText(107000, 107000)).toBe('ยอดเท่ากับฉบับเดิม');
    expect(qtDiffText(0, 5000)).toBe('ฉบับแก้ไขมากกว่าเดิม 5,000 บาท');
    expect(qtDiffText(null, 5000)).toBe('');
    expect(qtDiffText(5000, null)).toBe('');
  });
});

describe('swapping a quotation\'s file', () => {
  const old = { amount: 182970, docNo: 'QT-2569-014', docDate: '2026-10-09', basis: 'total' as const };
  it('agrees when the new file shows the same amount (at any of its figures), number and date', () => {
    expect(swapCheck(old, facts({ total: 182970, subtotal: 171000, docNo: 'QT 2569-014', docDate: '2026-10-09' }))).toMatchObject({ tone: 'ok', amount: 182970, differs: [] });
    // the stored figure was the one before VAT
    expect(swapCheck({ ...old, amount: 171000, basis: 'subtotal' }, facts({ total: 182970, subtotal: 171000 }))).toMatchObject({ tone: 'ok', amount: 171000 });
    // what the file does not show is not held against it
    expect(swapCheck(old, facts({ total: 182970 }))).toMatchObject({ tone: 'ok', differs: [] });
  });
  it('names what differs (then it is probably a revision)', () => {
    expect(swapCheck(old, facts({ total: 192600, docNo: 'QT-2569-014', docDate: '2026-10-04' }))).toMatchObject({ tone: 'warn', amount: 192600, differs: ['ยอด', 'วันที่'] });
    expect(swapCheck(old, facts({ total: 182970, docNo: 'QT-2569-099' }))).toMatchObject({ tone: 'warn', differs: ['เลขที่'] });
    expect([thList(['ยอด']), thList(['ยอด', 'วันที่']), thList(['ยอด', 'เลขที่', 'วันที่'])]).toEqual(['ยอด', 'ยอดและวันที่', 'ยอด เลขที่ และวันที่']);
  });
  it('says nothing was read when nothing was', () => {
    expect(swapCheck(old, null).tone).toBe('none');
    expect(swapCheck(old, facts({})).tone).toBe('none');
    // only a number among the other figures: that one is shown
    expect(swapCheck(old, facts({ candidates: [{ value: 182970, label: '', source: 'largest', score: 1, line: '' }] }))).toMatchObject({ tone: 'ok', amount: 182970 });
  });
});

describe('help centre', () => {
  it('finds the revision steps by the words people type', () => {
    for (const q of ['ฉบับแก้ไข', 'แนบใหม่', 'เปลี่ยนไฟล์', 'แก้ใบเสนอราคา', 'ฉบับเดิม']) expect(searchHelp(q).topics[0]?.id, q).toBe('sales-revise-qt');
    expect(ids(searchHelp('แนบฉบับแก้ไข').faq)).toContain('revise-qt');
    const t = HELP_TOPICS.find((x) => x.id === 'sales-revise-qt')!;
    expect(t.group).toBe('sales');
    // the buttons it names are the ones on screen
    for (const w of ['แนบฉบับแก้ไข', 'แก้ไขข้อมูล', 'เปลี่ยนไฟล์', 'อ่านค่าจากไฟล์อีกครั้ง', 'แนบใบเสนอราคาฉบับแก้ไข']) expect([...t.steps, ...t.tips].join(' ')).toContain(`“${w}”`);
  });
});
const ids = (r: { id: string }[]) => r.map((x) => x.id);
