/**
 * The amount a tax invoice / receipt is counted at, read from the text of a real one (anonymised:
 * __fixtures__/INV2026090004.txt, the pdf.js text layer of a 4-page file — ต้นฉบับ pages 1–2, สำเนา pages
 * 3–4): 57,692.33 + VAT 4,038.44 = 61,730.77, less 3% withholding tax 1,730.77 = ยอดชำระ 60,000. The
 * money that came in is 60,000, and the copy pages are never another amount.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeDocText, dropCopies, proposedAmount, repairThaiText } from './docExtract';

const TEXT = readFileSync(join(__dirname, '__fixtures__', 'INV2026090004.txt'), 'utf8');
const pages = TEXT.split('\n\n');
const doc = (...lines: string[]) => lines.join('\n');

describe('the sample receipt (ต้นฉบับ + สำเนา, หัก ณ ที่จ่าย 3%)', () => {
  it('reads every figure once, and proposes the amount paid after withholding tax', () => {
    expect(pages).toHaveLength(4);
    const f = analyzeDocText(TEXT);
    expect(f).toMatchObject({
      kind: 'receipt', docNo: 'INV2026090004', docDate: '2026-09-28',
      total: 61730.77, subtotal: 57692.33, vat: 4038.44, wht: 1730.77, netPay: 60000, words: 61730.77,
      confidence: 'high', copies: 2, party: 'บริษัท ตัวอย่างลูกค้า จำกัด (สำนักงานใหญ่)',
    });
    expect(proposedAmount(f)).toEqual({ basis: 'netPay', value: 60000 });
    // one candidate per value: the copy adds none
    const values = f.candidates.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(expect.arrayContaining([61730.77, 60000, 57692.33, 4038.44, 1730.77]));
    expect(f.candidates[0]).toMatchObject({ value: 61730.77, source: 'keyword' });
  });

  it('the copy pages are left out: the file reads as its original pages alone', () => {
    const all = analyzeDocText(TEXT), orig = analyzeDocText(pages.slice(0, 2).join('\n\n'));
    const { copies, ...rest } = all;
    expect(copies).toBe(2);
    expect(orig.copies).toBeUndefined();
    expect(rest).toEqual(orig);
    // the copy alone (สำเนา) reads the same as the original
    expect(analyzeDocText(pages.slice(2).join('\n\n'))).toMatchObject({ total: 61730.77, netPay: 60000, wht: 1730.77 });
  });

  it('an OCR read of the first three pages (two originals and one copy) gives the same figures', () => {
    expect(analyzeDocText(pages.slice(0, 3).join('\n\n'))).toMatchObject({ total: 61730.77, netPay: 60000, copies: 1 });
  });
});

describe('proposedAmount', () => {
  const facts = (o: Partial<Parameters<typeof proposedAmount>[0]>) => ({ total: null, wht: null, netPay: null, candidates: [], ...o });
  it('is the net amount when the document shows withholding tax, else the total including VAT', () => {
    expect(proposedAmount(facts({ total: 107000, wht: 3000, netPay: 104000 }))).toEqual({ basis: 'netPay', value: 104000 });
    expect(proposedAmount(facts({ total: 107000 }))).toEqual({ basis: 'total', value: 107000 });
    // a "ยอดชำระ" equal to the total, no withholding: the total
    expect(proposedAmount(facts({ total: 107000, netPay: 107000 }))).toEqual({ basis: 'total', value: 107000 });
    // no total read: the best amount found, typed
    expect(proposedAmount(facts({ candidates: [{ value: 5000, label: '', source: 'largest', score: 25, line: '' }] }))).toEqual({ basis: 'manual', value: 5000 });
    expect(proposedAmount(facts({}))).toEqual({ basis: 'manual', value: null });
  });

  it('follows the same rule for a quotation, so Forecast and Actual compare', () => {
    const qt = analyzeDocText(doc(
      'ใบเสนอราคา', 'เลขที่ QT2026080001', 'วันที่ 20/08/2026',
      'รวมเป็นเงิน   57,692.33', 'ภาษีมูลค่าเพิ่ม 7%   4,038.44', 'จำนวนเงินรวมทั้งสิ้น   61,730.77',
      'หักภาษี ณ ที่จ่าย 3%   1,730.77', 'ยอดชำระสุทธิ   60,000.00',
    ));
    expect(qt).toMatchObject({ kind: 'quotation', total: 61730.77, wht: 1730.77, netPay: 60000 });
    expect(proposedAmount(qt)).toEqual({ basis: 'netPay', value: 60000 });
    const plain = analyzeDocText(doc('ใบเสนอราคา', 'รวมเป็นเงิน   100,000.00', 'ภาษีมูลค่าเพิ่ม 7%   7,000.00', 'จำนวนเงินรวมทั้งสิ้น   107,000.00'));
    expect(proposedAmount(plain)).toEqual({ basis: 'total', value: 107000 });
  });
});

describe('dropCopies', () => {
  const page = (mark: string, n: string, amount: string) => [n, 'ใบเสร็จรับเงิน', mark, 'เลขที่ RC-0001', 'รวมทั้งสิ้น   ' + amount, 'หน้า 1/1'];
  it('leaves out a page that repeats an earlier one apart from its copy mark and set number', () => {
    const lines = [...page('ต้นฉบับ', '1', '10,700.00'), '', ...page('สำเนา', '2', '10,700.00')];
    expect(dropCopies(lines)).toEqual({ lines: page('ต้นฉบับ', '1', '10,700.00'), copies: 1 });
    // English marks too
    expect(dropCopies([...page('ORIGINAL', '1', '10,700.00'), '', ...page('COPY', '2', '10,700.00')]).copies).toBe(1);
  });
  it('keeps pages that differ, and a document without a copy mark as it is', () => {
    const two = [...page('ต้นฉบับ', '1', '10,700.00'), '', ...page('ต้นฉบับ', '1', '21,400.00')];
    expect(dropCopies(two)).toEqual({ lines: two, copies: 0 });
    const plain = ['ใบเสร็จรับเงิน', 'รวมทั้งสิ้น   100.00', '', 'ใบเสร็จรับเงิน', 'รวมทั้งสิ้น   100.00'];
    expect(dropCopies(plain)).toEqual({ lines: plain, copies: 0 });
  });
  it('repairs sara am written as ำ + า', () => {
    expect(repairThaiText('ยอดชำาระ จำานวนเงิน')).toBe('ยอดชำระ จำนวนเงิน');
  });
});
