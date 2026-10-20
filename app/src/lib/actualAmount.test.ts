/**
 * The amount a tax invoice / receipt is counted at, read from the text of a real one (anonymised:
 * __fixtures__/INV2026090004.txt, the pdf.js text layer of a 4-page file — ต้นฉบับ pages 1–2, สำเนา pages
 * 3–4): 57,692.33 + VAT 4,038.44 = 61,730.77, less 3% withholding tax 1,730.77 = ยอดชำระ 60,000. The
 * money that came in is 60,000, and the copy pages are never another amount.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeDocText, dropCopies, netOf, proposedAmount, repairThaiText } from './docExtract';

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
  const facts = (o: Partial<Parameters<typeof proposedAmount>[0]>) => ({ total: null, subtotal: null, vat: null, wht: null, netPay: null, candidates: [], ...o });
  it('is the net amount when the document shows withholding tax, else the total including VAT', () => {
    expect(proposedAmount(facts({ total: 107000, subtotal: 100000, wht: 3000, netPay: 104000 }))).toEqual({ basis: 'netPay', value: 104000 });
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

const RECEIPT = ['ใบกำกับภาษี/ใบเสร็จรับเงิน', 'เลขที่ INV2026090004', 'รวมเป็นเงิน   57,692.33', 'ภาษีมูลค่าเพิ่ม 7%   4,038.44', 'จำนวนเงินรวมทั้งสิ้น   61,730.77'];
const QUOTE = ['ใบเสนอราคา', 'เลขที่ QT2026-1001', 'วันที่ 01/10/2026', 'ค่าที่ปรึกษาจัดทำคาร์บอนฟุตพริ้นท์องค์กร   1   งาน   100,000.00   100,000.00', 'รวมเป็นเงิน   100,000.00', 'ภาษีมูลค่าเพิ่ม 7%   7,000.00', 'จำนวนเงินรวมทั้งสิ้น   107,000.00', '(หนึ่งแสนเจ็ดพันบาทถ้วน)'];

describe('the amount payable is proposed only when the figures add up', () => {
  it('a withholding note with a rate or a form number is not an amount: the quotation proposes its total', () => {
    for (const note of [
      'หมายเหตุ 1. ลูกค้านิติบุคคลหักภาษี ณ ที่จ่ายร้อยละ 3',
      'เงื่อนไข: ชำระภายใน 30 วัน หลังส่งมอบงาน หักภาษี ณ ที่จ่าย ร้อยละ 3 ของค่าบริการ',
      'ผู้ว่าจ้างหักภาษี ณ ที่จ่าย 3 เปอร์เซ็นต์',
      'ภาษีหัก ณ ที่จ่าย 1 ฉบับ',
      'หักภาษี ณ ที่จ่าย ภ.ง.ด. 3',
      'หักภาษี ณ ที่จ่าย 3% (ภ.ง.ด.53)',
      'หักภาษี ณ ที่จ่ายตามมาตรา 3 เตรส',
      'WHT (Form PND 53)',
      'Withholding tax 3 percent to be deducted by the customer',
    ]) {
      const f = analyzeDocText(doc(...QUOTE, note));
      expect({ note, total: f.total, wht: f.wht, netPay: f.netPay }).toEqual({ note, total: 107000, wht: null, netPay: null });
      expect(proposedAmount(f)).toEqual({ basis: 'total', value: 107000 });
    }
  });

  it('an amount payable or a withholding amount misread (OCR) leaves the total proposed', () => {
    for (const tail of [
      ['หักภาษี ณ ที่จ่าย 3%   1,730.77', 'ยอดชำระ   6,000.00'],
      ['หักภาษี ณ ที่จ่าย 3%   1,730.77', 'ยอดชำระ   50,000.00'],
      ['หักภาษี ณ ที่จ่าย 3%   7,730.77', 'ยอดชำระ   60,000.00'],
    ]) {
      const f = analyzeDocText(doc(...RECEIPT, ...tail));
      expect(netOf(f)).toBeNull();
      expect(proposedAmount(f)).toEqual({ basis: 'total', value: 61730.77 });
    }
    // the same lines read right: the amount payable
    const ok = analyzeDocText(doc(...RECEIPT, 'หักภาษี ณ ที่จ่าย 3%   1,730.77', 'ยอดชำระ   60,000.00'));
    expect(netOf(ok)).toEqual({ wht: 1730.77, deduct: 0, net: 60000 });
  });

  it('a withholding amount printed without decimals counts when it is the rate of the amount', () => {
    const f = analyzeDocText(doc('ใบเสร็จรับเงิน', 'รวมเป็นเงิน   10,000.00', 'ภาษีมูลค่าเพิ่ม 7%   700.00', 'รวมทั้งสิ้น   10,700.00', 'หัก ณ ที่จ่าย 3%   300', 'ยอดชำระ   10,400.00'));
    expect(f).toMatchObject({ total: 10700, wht: 300, netPay: 10400 });
    expect(proposedAmount(f)).toEqual({ basis: 'netPay', value: 10400 });
  });
});

describe('a deposit already paid taken off the total', () => {
  it('the final receipt proposes what is left to pay, in Thai and English', () => {
    for (const lines of [
      ['ใบกำกับภาษี/ใบเสร็จรับเงิน', 'เลขที่ RC2026-0902', 'รวมเป็นเงิน   100,000.00', 'ภาษีมูลค่าเพิ่ม 7%   7,000.00', 'จำนวนเงินรวมทั้งสิ้น   107,000.00', 'หักเงินมัดจำ (ใบเสร็จ RC2026-0901)   32,100.00', 'ยอดชำระ   74,900.00'],
      ['ใบแจ้งหนี้', 'เลขที่ INV2026-0902', 'รวมเป็นเงิน   100,000.00', 'ภาษีมูลค่าเพิ่ม 7%   7,000.00', 'รวมทั้งสิ้น   107,000.00', 'หักชำระแล้ว   32,100.00', 'คงเหลือชำระ   74,900.00'],
      ['TAX INVOICE', 'Invoice No. INV-0902', 'Sub Total   100,000.00', 'VAT 7%   7,000.00', 'Grand Total   107,000.00', 'Less Deposit   32,100.00', 'Balance Due   74,900.00'],
    ]) {
      const f = analyzeDocText(doc(...lines));
      expect(f).toMatchObject({ total: 107000, deduct: 32100, netPay: 74900, wht: null });
      expect(netOf(f)).toEqual({ wht: 0, deduct: 32100, net: 74900 });
      expect(proposedAmount(f)).toEqual({ basis: 'netPay', value: 74900 });
    }
  });

  it('a deposit and withholding tax on the rest', () => {
    const f = analyzeDocText(doc('ใบกำกับภาษี/ใบเสร็จรับเงิน', 'รวมเป็นเงิน   100,000.00', 'ภาษีมูลค่าเพิ่ม 7%   7,000.00', 'จำนวนเงินรวมทั้งสิ้น   107,000.00', 'หักเงินมัดจำ   32,100.00', 'หักภาษี ณ ที่จ่าย 3%   2,100.00', 'ยอดชำระ   72,800.00'));
    expect(netOf(f)).toEqual({ wht: 2100, deduct: 32100, net: 72800 });
    expect(proposedAmount(f)).toEqual({ basis: 'netPay', value: 72800 });
  });

  it('the deposit invoice itself (มัดจำ 30% · ยอดคงเหลือ) is not a deduction', () => {
    const f = analyzeDocText(doc('ใบแจ้งหนี้', 'เลขที่ INV2026-0901', 'รวมเป็นเงิน   100,000.00', 'ภาษีมูลค่าเพิ่ม 7%   7,000.00', 'จำนวนเงินรวมทั้งสิ้น   107,000.00', 'เงินมัดจำ 30%   32,100.00', 'ยอดคงเหลือ   74,900.00'));
    expect(f.deduct).toBeUndefined();
    expect(proposedAmount(f)).toEqual({ basis: 'total', value: 107000 });
  });
});

describe('the documents a document names', () => {
  it('a receipt names the invoice it pays, not its own number', () => {
    const f = analyzeDocText(doc('ใบเสร็จรับเงิน', 'เลขที่ RC2026-0701', 'วันที่ 10/10/2026', 'ชำระตามใบแจ้งหนี้เลขที่ INV2026-0601   จำนวนเงิน   53,500.00', 'รวมทั้งสิ้น   53,500.00'));
    expect(f).toMatchObject({ kind: 'receipt', docNo: 'RC2026-0701', total: 53500, refs: ['INV2026-0601'] });
    expect(analyzeDocText(TEXT).refs ?? []).not.toContain('INV2026090004');
  });
});

describe('a revised quotation keeps the figure of the version it follows', () => {
  const f = analyzeDocText(TEXT);
  it('the same amount at whatever basis, else the same basis', () => {
    // counted at the total before (the old default): the same price, not a cut of 1,730.77
    expect(proposedAmount(f, { basis: 'total', amount: 61730.77 })).toEqual({ basis: 'total', value: 61730.77 });
    // typed 60,000 before: the amount payable is that figure
    expect(proposedAmount(f, { basis: 'manual', amount: 60000 })).toEqual({ basis: 'netPay', value: 60000 });
    // a new price: at the basis of the version it follows
    expect(proposedAmount(f, { basis: 'total', amount: 50000 })).toEqual({ basis: 'total', value: 61730.77 });
    expect(proposedAmount(f, { basis: 'netPay', amount: 58000 })).toEqual({ basis: 'netPay', value: 60000 });
    // typed before at another figure: as a first quotation
    expect(proposedAmount(f, { basis: 'manual', amount: 58000 })).toEqual({ basis: 'netPay', value: 60000 });
  });
});
