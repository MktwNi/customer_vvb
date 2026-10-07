import { describe, expect, it } from 'vitest';
import { analyzeDocText, bahtTextToNumber, factsScore, repairThaiText } from './docExtract';

// Texts below are shaped like what docText.ts hands over: lines rebuilt from pdf.js item positions
// (columns separated by 3+ spaces), raw pdf.js items (one per line), or Tesseract output.
const doc = (...lines: string[]) => lines.join('\n');

describe('bahtTextToNumber', () => {
  it.each([
    ['หนึ่งแสนเจ็ดพันบาทถ้วน', 107000],
    ['สองร้อยสามสิบเอ็ดบาทห้าสิบสตางค์', 231.5],
    ['(หนึ่งหมื่นเจ็ดร้อยบาทถ้วน)', 10700],
    ['สิบบาท', 10],
    ['สิบเอ็ดบาท', 11],
    ['ยี่สิบเอ็ดบาทถ้วน', 21],
    ['หนึ่งร้อยเอ็ดบาท', 101],
    ['เจ็ดสิบบาทยี่สิบห้าสตางค์', 70.25],
    ['ห้าสิบสตางค์', 0.5],
    ['ศูนย์บาทถ้วน', 0],
    ['หนึ่งล้านบาทถ้วน', 1_000_000],
    ['ล้านบาท', 1_000_000],
    ['สามสิบล้านบาทถ้วน', 30_000_000],
    ['หนึ่งร้อยล้านบาท', 100_000_000],
    ['สิบสองล้านสามแสนสี่หมื่นห้าพันหกร้อยเจ็ดสิบแปดบาทเก้าสิบเก้าสตางค์', 12_345_678.99],
    ['หนึ่งล้านล้านบาท', 1e12],
    ['ห้าล้านล้านสามล้านบาท', 5_000_003_000_000],
    ['หนึ่งล้านสองแสนล้านบาท', 1_200_000_000_000],
    ['สองพันห้าร้อยหกสิบเก้า', 2569],
    // OCR: spaced out, tone marks dropped or misread, stray characters
    ['หนึ่ง หมื่น เจ็ด ร้อย บาท ถ้วน', 10700],
    ['สีหมืนหาพันบาท', 45000],
    ['-ห้าหมื่นสามพันห้าร้อยบาทถ้วน-', 53500],
    ['บาท หนึ่งพันบาทถ้วน', 1000],
    ['ห น ึ ่ ง แ ส น บาท ถ ้ ว น', 100000],
  ])('%s → %d', (s, n) => expect(bahtTextToNumber(s)).toBe(n));

  it('returns null when there is no number', () => {
    expect(bahtTextToNumber('บาทถ้วน')).toBeNull();
    expect(bahtTextToNumber('')).toBeNull();
    expect(bahtTextToNumber('Grand total')).toBeNull();
  });
});

describe('repairThaiText', () => {
  it('decodes legacy TIS-620 fonts read as Latin-1, PUA tone marks and split sara am', () => {
    const tis = 'ใบเสนอราคา จำนวนเงินรวมทั้งสิ้น หนึ่งหมื่นบาท'.replace(/[ก-๛]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0d60));
    expect(repairThaiText(tis)).toBe('ใบเสนอราคา จำนวนเงินรวมทั้งสิ้น หนึ่งหมื่นบาท');
    const pua = 'ทั' + String.fromCharCode(0xf70b) + 'ง'; // tone mark in its lowered presentation form
    expect(repairThaiText(pua)).toBe('ทั้ง');
    expect(repairThaiText('จ' + String.fromCharCode(0x0e4d, 0x0e32) + 'นวน')).toBe('จำนวน');
    expect(repairThaiText('Café crème brûlée')).toBe('Café crème brûlée');
  });
});

describe('analyzeDocText — Thai quotations', () => {
  it('reads a quotation laid out in columns (label and value on one line)', () => {
    const f = analyzeDocText(doc(
      'บริษัท โกลบอล คาร์บอน คอร์ปอเรชั่น จำกัด',
      'GLOBAL CARBON CORPORATION CO., LTD.',
      '99/9 หมู่ 3 ถนนพหลโยธิน ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120',
      'โทร 02-123-4567   เลขประจำตัวผู้เสียภาษี 0-1055-61234-56-7',
      'ใบเสนอราคา',
      'QUOTATION',
      'ลูกค้า   บริษัท ไทยสตีล อินดัสตรี จำกัด   เลขที่   QT2569-0012',
      'ที่อยู่   88 ถนนบางนา-ตราด แขวงบางนา เขตบางนา กรุงเทพฯ 10260   วันที่   6 ต.ค. 2569',
      'ลำดับ   รายการ   จำนวน   หน่วย   ราคาต่อหน่วย   จำนวนเงิน',
      '1   บริการทวนสอบคาร์บอนฟุตพริ้นท์องค์กร (CFO) ปี 2568   1   งาน   85,000.00   85,000.00',
      '2   ค่าเดินทางตรวจประเมิน ณ สถานประกอบการ   2   ครั้ง   7,500.00   15,000.00',
      '(หนึ่งแสนเจ็ดพันบาทถ้วน)   รวมเป็นเงิน   100,000.00',
      'ภาษีมูลค่าเพิ่ม 7%   7,000.00',
      'จำนวนเงินรวมทั้งสิ้น   107,000.00',
      'ยืนราคา 30 วัน   เงื่อนไขการชำระเงิน: มัดจำ 50% ก่อนเริ่มงาน',
    ));
    expect(f).toMatchObject({
      kind: 'quotation', docNo: 'QT2569-0012', docDate: '2026-10-06', total: 107000, subtotal: 100000, vat: 7000,
      words: 107000, wht: null, party: 'บริษัท ไทยสตีล อินดัสตรี จำกัด', confidence: 'high',
    });
    expect(f.candidates[0]).toMatchObject({ value: 107000, source: 'keyword', label: 'จำนวนเงินรวมทั้งสิ้น' });
    expect(f.candidates[0].line).toContain('107,000.00');
    // phone, tax id, postal code, quantities and the year are never offered as amounts
    const values = f.candidates.map((c) => c.value);
    for (const junk of [12120, 10260, 2568, 2569, 30, 50, 21234567, 1055]) expect(values).not.toContain(junk);
  });

  it('reads raw pdf.js items: one item per line, each value on the line after its label', () => {
    const f = analyzeDocText(doc(
      'ใบเสนอราคา', 'เลขที่', 'QT2569-0013', 'วันที่', '07/10/2569', 'เรียน', 'คุณสมชาย ใจดี', 'บริษัท เอเชีย พลาสติก จำกัด (มหาชน)',
      'ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'จำนวนเงิน',
      '1', 'ที่ปรึกษาจัดทำคาร์บอนฟุตพริ้นท์ผลิตภัณฑ์ (CFP)', '3', 'ผลิตภัณฑ์', '45,000.00', '135,000.00',
      'รวมเป็นเงิน', '135,000.00', 'ส่วนลด', '5,000.00', 'ยอดหลังหักส่วนลด', '130,000.00',
      'ภาษีมูลค่าเพิ่ม 7%', '9,100.00', 'รวมทั้งสิ้น', '139,100.00', '(หนึ่งแสนสามหมื่นเก้าพันหนึ่งร้อยบาทถ้วน)',
    ));
    expect(f).toMatchObject({
      kind: 'quotation', docNo: 'QT2569-0013', docDate: '2026-10-07', total: 139100, subtotal: 130000, vat: 9100, words: 139100,
      party: 'บริษัท เอเชีย พลาสติก จำกัด (มหาชน)', confidence: 'high',
    });
  });

  it('pairs column blocks: all labels first, then all values', () => {
    const f = analyzeDocText(doc('ใบเสนอราคา', 'รวมเป็นเงิน', 'ส่วนลด', 'ภาษีมูลค่าเพิ่ม 7%', 'จำนวนเงินรวมทั้งสิ้น', '60,000.00', '0.00', '4,200.00', '64,200.00'));
    expect(f).toMatchObject({ total: 64200, subtotal: 60000, vat: 4200, confidence: 'high' });
  });

  it('pairs values printed before their labels (right-aligned column emitted first)', () => {
    const f = analyzeDocText(doc('ใบเสนอราคา', '50,000.00', '3,500.00', '53,500.00', 'รวมเป็นเงิน', 'ภาษีมูลค่าเพิ่ม 7%', 'รวมทั้งสิ้น'));
    expect(f).toMatchObject({ total: 53500, subtotal: 50000, vat: 3500, confidence: 'high' });
    const g = analyzeDocText(doc('10,000.00', 'รวมเป็นเงิน', '700.00', 'ภาษีมูลค่าเพิ่ม', '10,700.00', 'รวมทั้งสิ้น'));
    expect(g).toMatchObject({ total: 10700, subtotal: 10000, vat: 700 });
  });

  it('keeps the deposit terms out of the total (มัดจำ 50%, งวดที่ 2 ส่วนที่เหลือ)', () => {
    const f = analyzeDocText(doc(
      'ใบเสนอราคา',
      'รวมเป็นเงิน   200,000.00',
      'ภาษีมูลค่าเพิ่ม 7%   14,000.00',
      'รวมทั้งสิ้น   214,000.00',
      'เงื่อนไขการชำระเงิน',
      'งวดที่ 1 มัดจำ 50% เป็นเงิน 107,000.00 บาท เมื่อลงนามสัญญา',
      'งวดที่ 2 ส่วนที่เหลือ 107,000.00 บาท เมื่อส่งมอบรายงาน',
    ));
    expect(f).toMatchObject({ kind: 'quotation', total: 214000, subtotal: 200000, vat: 14000, confidence: 'high' });
    expect(f.candidates.map((c) => c.value)).toContain(107000);
  });

  it('works out the subtotal after a discount when only the sum before it is printed', () => {
    const f = analyzeDocText(doc('ใบเสนอราคา', 'รวมเป็นเงิน 120,000.00', 'ส่วนลด 20,000.00', 'ภาษีมูลค่าเพิ่ม 7% 7,000.00', 'ยอดรวมทั้งสิ้น 107,000.00'));
    expect(f).toMatchObject({ total: 107000, subtotal: 100000, vat: 7000, confidence: 'high' });
  });

  it('adds VAT when the quotation says the price excludes it', () => {
    const f = analyzeDocText(doc(
      'ใบเสนอราคา',
      'ค่าบริการจัดทำ CFO ปี 2569   ราคา 120,000 บาท',
      'รวมเป็นเงิน   120,000.00',
      'หมายเหตุ: ราคาดังกล่าวยังไม่รวมภาษีมูลค่าเพิ่ม 7%',
    ));
    expect(f).toMatchObject({ total: 128400, subtotal: 120000, vat: 8400, confidence: 'medium' });
    expect(f.candidates.find((c) => c.value === 128400)?.source).toBe('vat');
    expect(f.candidates.find((c) => c.value === 120000)?.source).toBe('keyword');
  });

  it('reads a quotation from a business not registered for VAT', () => {
    const f = analyzeDocText(doc(
      'ใบเสนอราคา',
      'เรียน ฝ่ายจัดซื้อ บริษัท ชลบุรี ฟาร์ม จำกัด',
      'ค่าอบรมการจัดทำคาร์บอนฟุตพริ้นท์ 1 วัน   25,000.00',
      'รวมเป็นเงิน   25,000.00 บาท   (สองหมื่นห้าพันบาทถ้วน)',
      '(ผู้ประกอบการไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม)',
    ));
    expect(f).toMatchObject({ total: 25000, vat: null, subtotal: null, words: 25000, party: 'ฝ่ายจัดซื้อ บริษัท ชลบุรี ฟาร์ม จำกัด', confidence: 'high' });
  });

  it('offers both totals when a quotation has two options', () => {
    const f = analyzeDocText(doc(
      'ใบเสนอราคา',
      'ทางเลือก A: ทวนสอบ CFO อย่างเดียว',
      'รวมเป็นเงิน 80,000.00', 'ภาษีมูลค่าเพิ่ม 7% 5,600.00', 'รวมทั้งสิ้น 85,600.00',
      'ทางเลือก B: ทวนสอบ CFO + CFP',
      'รวมเป็นเงิน 150,000.00', 'ภาษีมูลค่าเพิ่ม 7% 10,500.00', 'รวมทั้งสิ้น 160,500.00',
    ));
    expect(f.total).toBe(160500);
    expect(f.confidence).toBe('medium'); // two different grand totals: the user has to choose
    expect(f.candidates.slice(0, 3).map((c) => c.value)).toContain(85600);
  });
});

describe('analyzeDocText — invoices, tax invoices, receipts', () => {
  it('reads an invoice / tax invoice with withholding tax', () => {
    const f = analyzeDocText(doc(
      'ใบแจ้งหนี้/ใบกำกับภาษี',
      'INVOICE/TAX INVOICE',
      'เลขที่ IV6910-0021   วันที่ 15/10/2569',
      'ลูกค้า: บริษัท สยามฟู้ด จำกัด (สำนักงานใหญ่)',
      'เลขประจำตัวผู้เสียภาษี 0105556012345',
      '1   ค่าบริการทวนสอบ CFO งวดสุดท้าย   1.00   50,000.00   50,000.00',
      'รวมเป็นเงิน   50,000.00',
      'ภาษีมูลค่าเพิ่ม 7%   3,500.00',
      'รวมทั้งสิ้น   53,500.00',
      'หัก ภาษี ณ ที่จ่าย 3%   1,500.00',
      'ยอดชำระสุทธิ   52,000.00',
      '(ห้าหมื่นสามพันห้าร้อยบาทถ้วน)',
    ));
    expect(f).toMatchObject({
      kind: 'invoice', docNo: 'IV6910-0021', docDate: '2026-10-15', total: 53500, subtotal: 50000, vat: 3500, wht: 1500, netPay: 52000,
      words: 53500, party: 'บริษัท สยามฟู้ด จำกัด (สำนักงานใหญ่)', confidence: 'high',
    });
  });

  it('calls ใบกำกับภาษี/ใบแจ้งหนี้ an invoice whichever comes first', () => {
    expect(analyzeDocText(doc('ใบกำกับภาษี/ใบแจ้งหนี้', 'รวมทั้งสิ้น 1,070.00')).kind).toBe('invoice');
    expect(analyzeDocText(doc('ใบกำกับภาษี/ใบเสร็จรับเงิน', 'รวมทั้งสิ้น 1,070.00')).kind).toBe('receipt');
    expect(analyzeDocText(doc('TAX INVOICE', 'Grand Total 1,070.00')).kind).toBe('receipt');
    expect(analyzeDocText(doc('ใบวางบิล / BILLING NOTE', 'รวมทั้งสิ้น 1,070.00')).kind).toBe('invoice');
    expect(analyzeDocText(doc('ใบสั่งซื้อ / PURCHASE ORDER', 'รวมทั้งสิ้น 1,070.00')).kind).toBe('other');
    expect(analyzeDocText(doc('รวมทั้งสิ้น 1,070.00')).kind).toBeNull();
    // words inside sentences or other words are not titles
    expect(analyzeDocText(doc('ชำระมัดจำ 50% เมื่อลงนามสัญญา', 'Subcontractor fee 1,000.00', 'ใบเสนอราคา', 'รวมทั้งสิ้น 1,070.00')).kind).toBe('quotation');
  });

  it('ignores references to other documents when deciding the kind and number', () => {
    const f = analyzeDocText(doc(
      'บริษัท โกลบอล คาร์บอน คอร์ปอเรชั่น จำกัด',
      'อ้างอิงใบเสนอราคาเลขที่ QT2569-0012',
      'ใบเสร็จรับเงิน',
      'RECEIPT',
      'เลขที่ RC2569/0102',
      'วันที่ 20 ตุลาคม 2569',
      'ได้รับเงินจาก บริษัท เอบีซี จำกัด',
      'ค่าบริการตามใบแจ้งหนี้เลขที่ IV6910-0021',
      'จำนวนเงิน 52,000.00 บาท',
      '(ห้าหมื่นสองพันบาทถ้วน)',
      'ชำระโดย โอนเงินเข้าบัญชี ธนาคารกสิกรไทย เลขที่บัญชี 123-4-56789-0',
    ));
    expect(f).toMatchObject({ kind: 'receipt', docNo: 'RC2569/0102', docDate: '2026-10-20', total: 52000, words: 52000, party: 'บริษัท เอบีซี จำกัด', confidence: 'high' });
  });

  it('reads an English invoice with a right-aligned amount column', () => {
    const f = analyzeDocText(doc(
      'INVOICE',
      'Invoice No.: INV-2026-0045',
      'Date: 6 October 2026',
      'Bill To: Siam Cement Trading Co., Ltd.',
      'Description                      Qty     Unit Price         Amount',
      'GHG verification service          1      120,000.00     120,000.00',
      'Subtotal                                               120,000.00',
      'VAT 7%                                                   8,400.00',
      'Total Amount Due                                       128,400.00',
      'Payment terms: 30 days',
    ));
    expect(f).toMatchObject({
      kind: 'invoice', docNo: 'INV-2026-0045', docDate: '2026-10-06', total: 128400, subtotal: 120000, vat: 8400, party: 'Siam Cement Trading Co., Ltd.', confidence: 'high',
    });
  });

  it('reads an English receipt with withholding tax and net payable', () => {
    const f = analyzeDocText(doc(
      'OFFICIAL RECEIPT / TAX INVOICE',
      'Receipt No. RC-2026-0310',
      'Date: Oct 15, 2026',
      'Received from: PTT Global Chemical Public Company Limited',
      'Amount before VAT   200,000.00',
      'VAT 7%   14,000.00',
      'Total   214,000.00',
      'Less Withholding Tax 3%   6,000.00',
      'Net Payable   208,000.00',
    ));
    expect(f).toMatchObject({
      kind: 'receipt', docNo: 'RC-2026-0310', docDate: '2026-10-15', total: 214000, subtotal: 200000, vat: 14000, wht: 6000, netPay: 208000,
      party: 'PTT Global Chemical Public Company Limited', confidence: 'high',
    });
  });

  it('merges bilingual labels on one line ("รวมเป็นเงิน / Sub Total")', () => {
    const f = analyzeDocText(doc(
      'ใบเสร็จรับเงิน/ใบกำกับภาษี',
      'RECEIPT/TAX INVOICE',
      'รวมเป็นเงิน / Sub Total   30,000.00',
      'ภาษีมูลค่าเพิ่ม 7% / VAT   2,100.00',
      'จำนวนเงินรวมทั้งสิ้น / Grand Total   32,100.00',
    ));
    expect(f).toMatchObject({ kind: 'receipt', total: 32100, subtotal: 30000, vat: 2100, confidence: 'high' });
    expect(f.candidates[0].label).toBe('จำนวนเงินรวมทั้งสิ้น / Grand Total');
  });

  it('reads a horizontal summary row (labels in one row, values in the next)', () => {
    const f = analyzeDocText(doc(
      'Quotation',
      'Sub Total      Discount      VAT 7%      Grand Total',
      '95,000.00      5,000.00      6,300.00    96,300.00',
    ));
    expect(f).toMatchObject({ kind: 'quotation', total: 96300, vat: 6300, subtotal: 90000, confidence: 'high' });
  });

  it('reads a deposit invoice (งวดที่ 1 มัดจำ 50%)', () => {
    const f = analyzeDocText(doc(
      'ใบแจ้งหนี้ (Invoice)',
      'เลขที่ INV6910-007',
      'ลูกค้า บริษัท กรีนเอนเนอร์จี จำกัด',
      'รายการ: ค่าที่ปรึกษาโครงการ T-VER งวดที่ 1 มัดจำ 50% ของมูลค่าโครงการ 300,000.00 บาท   150,000.00',
      'รวมเป็นเงิน   150,000.00',
      'ภาษีมูลค่าเพิ่ม 7%   10,500.00',
      'จำนวนเงินรวมทั้งสิ้น   160,500.00',
    ));
    expect(f).toMatchObject({ kind: 'invoice', docNo: 'INV6910-007', total: 160500, subtotal: 150000, vat: 10500, party: 'บริษัท กรีนเอนเนอร์จี จำกัด', confidence: 'high' });
  });

  it('reads a billing note that lists several invoices', () => {
    const f = analyzeDocText(doc(
      'ใบวางบิล / BILLING NOTE',
      'เลขที่ BL6910-004',
      'ลูกค้า บริษัท ไทยออยล์ จำกัด (มหาชน)',
      '1   IV6909-0012   15/09/2569   53,500.00',
      '2   IV6910-0021   15/10/2569   107,000.00',
      'รวมเงินทั้งสิ้น   160,500.00',
      '(หนึ่งแสนหกหมื่นห้าร้อยบาทถ้วน)',
    ));
    expect(f).toMatchObject({ kind: 'invoice', docNo: 'BL6910-004', docDate: '2026-09-15', total: 160500, words: 160500, confidence: 'high' });
  });

  it('counts the original and the copy on one page once', () => {
    const page = ['ใบกำกับภาษี/ใบเสร็จรับเงิน', 'รวมเป็นเงิน 10,000.00', 'ภาษีมูลค่าเพิ่ม 7% 700.00', 'จำนวนเงินรวมทั้งสิ้น 10,700.00'];
    const f = analyzeDocText(doc('ต้นฉบับ (ORIGINAL)', ...page, 'สำเนา (COPY)', ...page));
    expect(f).toMatchObject({ total: 10700, subtotal: 10000, vat: 700, confidence: 'high' });
    expect(f.candidates.filter((c) => c.value === 10700)).toHaveLength(1);
  });

  it('reads Thai digits', () => {
    const f = analyzeDocText(doc('ใบแจ้งหนี้', 'เลขที่ ๒๕๖๙/๐๐๓๑   วันที่ ๑๒ ตุลาคม ๒๕๖๙', 'รวมเป็นเงิน ๘๐,๐๐๐.๐๐', 'ภาษีมูลค่าเพิ่ม ๗% ๕,๖๐๐.๐๐', 'จำนวนเงินรวมทั้งสิ้น ๘๕,๖๐๐.๐๐'));
    expect(f).toMatchObject({ kind: 'invoice', docNo: '2569/0031', docDate: '2026-10-12', total: 85600, subtotal: 80000, vat: 5600, confidence: 'high' });
  });

  it('reads amounts written with THB and without decimals', () => {
    const f = analyzeDocText(doc('Quotation', 'Quotation No.: QT-26-118', 'Total: THB 45,000', 'VAT (7%): THB 3,150', 'Amount Due: THB 48,150'));
    expect(f).toMatchObject({ kind: 'quotation', docNo: 'QT-26-118', total: 48150, subtotal: 45000, vat: 3150, confidence: 'high' });
  });

  it('reads "53,500.- บาท" and a label that ends in a colon', () => {
    const f = analyzeDocText(doc('ใบเสนอราคา', 'รวมเป็นเงิน: 50,000.- บาท', 'ภาษีมูลค่าเพิ่ม 7%: 3,500.- บาท', 'รวมทั้งสิ้น: 53,500.- บาท'));
    expect(f).toMatchObject({ total: 53500, subtotal: 50000, vat: 3500, confidence: 'high' });
  });
});

describe('analyzeDocText — OCR and broken text', () => {
  it('reads OCR output: spaced-out Thai, O for 0, l for 1, spaced dots in dates', () => {
    const f = analyzeDocText(doc(
      'ใบ เสนอ ราคา',
      'เลข ที่ QT2569-0015      วัน ที่ 9 ต . ค . 2569',
      'รวม เป็น เงิน     2O,OOO.OO',
      'ภาษี มูลค่า เพิ่ม 7 %     l,4OO.OO',
      'รวม ทั้ง สิ้น     21,4OO.OO',
    ));
    expect(f).toMatchObject({ kind: 'quotation', docNo: 'QT2569-0015', docDate: '2026-10-09', total: 21400, subtotal: 20000, vat: 1400, confidence: 'high' });
  });

  it('reads OCR output with dropped tone marks, a misread vowel and broken number spacing', () => {
    const f = analyzeDocText(doc(
      'ใบแจงหนี',
      'รวมเปนเงิน 16, 000.00',
      'ภาษีมลคาเพิม 1,120,00',
      'จํานวนเงินรวมทังสิน 17 ,120.00',
      '(หนึงหมืนเจ็ดพันหนึงรอยยีสิบบาทถวน)',
    ));
    expect(f).toMatchObject({ kind: 'invoice', total: 17120, subtotal: 16000, vat: 1120, words: 17120, confidence: 'high' });
  });

  // the next two are real Tesseract (tha+eng) output from dev/run-doc-harness.cjs samples
  it('reads Tesseract output of a blurred, rotated phone photo of a quotation', () => {
    const f = analyzeDocText(doc(
      'บริษัท โกลบอล คาร์บอน คอร์ปอเรชั่น จำกัด (สำนักงานใหญ่)                                    ใบเสนอราคา',
      'GLOBAL CARBON CORPORATION CO., LTD                                                                         QUOTATION',
      '999 wy 3 ถนนพหลโยธิน ดำบลคดลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120',
      'โทร 02-123-4567 แฟกซ์ 02-123-4568 เลขประจำตัวผู้เสียภาษี 0105561234567',
      'ลูกค้า: บริษัท กรีนเอนเนอร์จื จำกัด                                              เลขที @12569-0020',
      'เรียน: ฝ่ายจัดซื้อ                                                                             วันที่ 9 ต.ด. 2569',
      '1 ค่าที่ปรึกษาขึ้นทะเบียนโครงการ T-VER (ระยะที่ 1)                1       งาน          60.000.00 60.000.00',
      '(หกหมื่นสีพันสองร้อยบาทถ้วน)                                         รวมเป็นเงิน                                   60.000.00',
      'ภาษีมูลค่าเพิ่ม 7%                          4.200 00',
      'จำนวนเงินรวมทั้งสิ้น                          64,200.00',
      'ผู้รับเอกสาร                                                     ผู้มิอำนาจลงนาม',
    ));
    // "QT" came out as "@1": better no number than a wrong one
    expect(f).toMatchObject({ kind: 'quotation', docNo: '', docDate: '2026-10-09', total: 64200, subtotal: 60000, vat: 4200, words: 64200, party: 'บริษัท กรีนเอนเนอร์จื จำกัด', confidence: 'high' });
  });

  it('reads Tesseract output of a scanned tax invoice (stray marks, split title, misread vowels)', () => {
    const f = analyzeDocText(doc(
      '.                    :             |                      2      oe               dS oa               ๐ a',
      ' บริษัท โกลบอล คาร์บอน คอร์ปอเรชัน จำกัด (สำนักงานใหญ่) 7.          ใบเสร็จรับเงิน / ใบกำกับ',
      '        GLOBAL CARBON CORPORATION CO, LTD                            )                                              :        -',
      '99/9 wij-3 ถนนพหลโยธิน ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี       .                                  ภาษ',
      '12120                                                :                    RECEIPT / TAX INVOICE',
      '-        โทร 02-123-4567 แฟกซ์ 02-123-4568 เลขประจำตัวผู้เสียภาษี 0105561234567 -                  .       \'            \'',
      'น         ได้รับเงินจาก: บริษัท .ไทยอ่อยล์ จำกัด (มหาชน)                  | .เลขที่ RC2569/0102          |',
      '5551 ถนนวิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900 =~ /      :         วันที่ 20 ตุลาคม 2569   .                      .',
      '1.7 ค่าที่ปรึกษาจัดทำรายงานก๊าซเรือนกระจก งวดที่1 ,.           1 \' งาน          30,000.00" . 30,000.00 ,',
      ')        (สจมหมื่นสองพันหนึ่งร้อย์บาทถ้วน)                                  รวมเป็นเงิน        .     :   )            . 30,000.00         -',
      'i                 :             |       ” . ภาษีมู่ลค่าเพิ่ม7% 3         Tn       2,100.00. -',
      '        )               จำน่วนเงินรวมทั้งสิ้น                     \' 32,100.00 :',
      'ซำระโดย: โอนเงิน ธนาคารไทยพาณิชย์ วันที่ 20/10/2569 0              )                :',
    ));
    expect(f).toMatchObject({ kind: 'receipt', docNo: 'RC2569/0102', docDate: '2026-10-20', total: 32100, subtotal: 30000, vat: 2100, confidence: 'high' });
    // "(สจมหมื่น…)" — สาม misread — reads 12,100: reported as written, but offered last
    expect(f.words).toBe(12100);
    expect(f.candidates.map((c) => c.value).slice(0, 3)).toEqual([32100, 30000, 2100]);
    expect(f.candidates[f.candidates.length - 1]).toMatchObject({ value: 12100, source: 'words' });
  });

  it('trusts baht text that follows a label word but not one glued to garbage', () => {
    const sure = analyzeDocText(doc('ใบเสร็จรับเงิน', 'จำนวนเงินหนึ่งหมื่นสองพันบาทถ้วน')).candidates[0];
    const unsure = analyzeDocText(doc('ใบเสร็จรับเงิน', '(สจมหมื่นสองพันบาทถ้วน)')).candidates[0];
    expect(sure).toMatchObject({ value: 12000, source: 'words' });
    expect(unsure).toMatchObject({ value: 12000, source: 'words' });
    expect(sure.score - unsure.score).toBe(22);
  });

  it('prefers the amount on the next line over stray small numbers next to the label', () => {
    const f = analyzeDocText(doc('ใบเสร็จรับเงิน', 'รวมเป็นเงิน 1', '30,000.00', 'ภาษีมูลค่าเพิ่ม 7% 2', '2,100.00', 'จำนวนเงินรวมทั้งสิ้น 1', '32,100.00'));
    expect(f).toMatchObject({ total: 32100, subtotal: 30000, vat: 2100, confidence: 'high' });
    // …but takes a bare number when nothing better is around
    expect(analyzeDocText(doc('ใบเสนอราคา', 'รวมเป็นเงิน 10000', 'ภาษีมูลค่าเพิ่ม 700', 'รวมทั้งสิ้น 10700'))).toMatchObject({ total: 10700, subtotal: 10000, vat: 700 });
  });

  it('takes the value from the next line when it shares it with the baht text', () => {
    const f = analyzeDocText(doc('ใบเสร็จรับเงิน', 'จำนวนเงินรวมทั้งสิ้น', '32,100.00 (สามหมื่นสองพันหนึ่งร้อยบาทถ้วน)'));
    expect(f).toMatchObject({ kind: 'receipt', total: 32100, words: 32100, confidence: 'high' });
  });

  it('reads a PDF made with a legacy (non-Unicode) Thai font', () => {
    const tis = (s: string) => s.replace(/[ก-๛]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0d60));
    const f = analyzeDocText(tis(doc('ใบเสนอราคา', 'รวมเป็นเงิน 10,000.00', 'ภาษีมูลค่าเพิ่ม 7% 700.00', 'จำนวนเงินรวมทั้งสิ้น 10,700.00', '(หนึ่งหมื่นเจ็ดร้อยบาทถ้วน)')));
    expect(f).toMatchObject({ kind: 'quotation', total: 10700, subtotal: 10000, vat: 700, words: 10700, confidence: 'high' });
  });

  it('falls back to the largest amount when nothing is labelled', () => {
    const f = analyzeDocText(doc(
      'บริษัท ตัวอย่าง จำกัด โทร 081-234-5678',
      'เลขประจำตัวผู้เสียภาษี 0105561234567',
      'วันที่ 01/10/2569',
      'ค่าบริการที่ปรึกษา 45,000.00',
      'ค่าเดินทาง 3,500.00',
    ));
    expect(f).toMatchObject({ kind: null, total: 45000, confidence: 'low', docDate: '2026-10-01' });
    expect(f.candidates.map((c) => [c.value, c.source])).toEqual([[45000, 'largest'], [3500, 'largest']]);
  });

  it('uses the baht text when the amount line is unreadable', () => {
    const f = analyzeDocText(doc('ใบเสร็จรับเงิน', 'จำนวนเงินรวมทั้งสิ้น  ###,#@#.##', '(หนึ่งหมื่นสองพันแปดร้อยสี่สิบบาทถ้วน)'));
    expect(f).toMatchObject({ total: 12840, words: 12840, confidence: 'medium' });
    expect(f.candidates[0]).toMatchObject({ value: 12840, source: 'words' });
  });

  it('returns nothing for empty text', () => {
    expect(analyzeDocText('')).toEqual({
      kind: null, docNo: '', docDate: '', total: null, subtotal: null, vat: null, wht: null, netPay: null, words: null, party: '', candidates: [], confidence: 'low',
    });
  });
});

describe('analyzeDocText — dates', () => {
  it.each([
    ['วันที่ 6 ต.ค. 2569', '2026-10-06'],
    ['วันที่ 06/10/2569', '2026-10-06'],
    ['วันที่ 6 ตุลาคม พ.ศ. 2569', '2026-10-06'],
    ['Date: 2026-10-06', '2026-10-06'],
    ['Date: 6 October 2026', '2026-10-06'],
    ['Date: 06-Oct-26', '2026-10-06'],
    ['วันที่ 6/10/69', '2026-10-06'],
    ['Date: 10/25/2026', '2026-10-25'],
    ['วันที่ 9 ต.ด. 2569', '2026-10-09'], // OCR read ค as ด
    ['วันที่ 15 ก.ศ. 69', '2026-07-15'],
    ['วันที่ 2 พ.ข. 2569', '2026-11-02'],
  ])('%s → %s', (line, iso) => expect(analyzeDocText(doc('ใบแจ้งหนี้', line, 'รวมทั้งสิ้น 100.00')).docDate).toBe(iso));

  it('prefers the document date over the due date', () => {
    expect(analyzeDocText(doc('ใบแจ้งหนี้', 'วันที่ครบกำหนด 15/11/2569', 'วันที่ 16/10/2569')).docDate).toBe('2026-10-16');
    expect(analyzeDocText(doc('INVOICE', 'Due Date: 15 Nov 2026', 'Invoice Date: 16 Oct 2026')).docDate).toBe('2026-10-16');
  });
});

describe('factsScore (picks between OCR passes)', () => {
  it('a confirmed total is good enough; otherwise more money fields found score higher', () => {
    // what the two Tesseract layouts gave for the same invoice photo: the first lost the totals table
    const lost = 'ใบแจ้งหนี้\nเลขที่ INV2569-0088\n ค่าบริการที่ปรึกษา CFO งวดที่ 1          100,000.00        100,000.00\n(หนึ่งแสนเจ็ดพันบาทถ้วน)';
    const kept = 'ใบแจ้งหนี้\nเลขที่ INV2569-0088\nรวมเป็นเงิน        100,000.00\nภาษีมูลค่าเพิ่ม 7%          7,000.00\nจำนวนเงินรวมทั้งสิ้น        107,000.00\nหักภาษี ณ ที่จ่าย 3%          3,000.00\nยอดชำระสุทธิ        104,000.00\n(หนึ่งแสนเจ็ดพันบาทถ้วน)';
    const a = factsScore(analyzeDocText(lost)), b = factsScore(analyzeDocText(kept));
    expect(b).toBe(100);
    expect(a).toBeLessThan(100);
    expect(factsScore(analyzeDocText('สวัสดี'))).toBeLessThan(a);
  });
});
