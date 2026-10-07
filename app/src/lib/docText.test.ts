import { describe, expect, it } from 'vitest';
import { analyzeDocText } from './docExtract';
import { layoutLines } from './docText';

// pdf.js text items: transform = [scaleX, skewY, skewX, scaleY, x, y] in PDF units (y grows upwards)
const item = (str: string, x: number, y: number, width: number, size = 10) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, hasEOL: false });

describe('layoutLines (pdf.js items → lines)', () => {
  it('orders lines top to bottom and items left to right, whatever order pdf.js gives', () => {
    const items = [item('7,000.00', 480, 600, 40), item('ภาษีมูลค่าเพิ่ม 7%', 300, 600, 80), item('รวมเป็นเงิน', 300, 615, 50), item('100,000.00', 470, 615, 50)];
    expect(layoutLines(items)).toBe('รวมเป็นเงิน   100,000.00\nภาษีมูลค่าเพิ่ม 7%   7,000.00');
  });

  it('keeps a row together despite small baseline differences (bold or larger values)', () => {
    expect(layoutLines([item('จำนวนเงินรวมทั้งสิ้น', 300, 500, 90), item('107,000.00', 470, 501.8, 55, 12)])).toBe('จำนวนเงินรวมทั้งสิ้น   107,000.00');
  });

  it('joins pieces of one word, spaces words, and marks wide gaps as column breaks', () => {
    const items = [item('ใบเสนอ', 100, 700, 30), item('ราคา', 130.2, 700, 20), item('QUOTATION', 153, 700, 50), item('No.', 400, 700, 15)];
    expect(layoutLines(items)).toBe('ใบเสนอราคา QUOTATION   No.');
  });

  it('skips empty items and items without positions (marked content)', () => {
    expect(layoutLines([{ type: 'beginMarkedContent' }, item('  ', 10, 10, 5), item('Total', 10, 10, 20), { str: 'x' }])).toBe('Total');
  });

  it('feeds analyzeDocText the same way as a real right-aligned summary block', () => {
    const items = [
      item('ใบแจ้งหนี้', 450, 780, 60, 16),
      item('(ห้าหมื่นสามพันห้าร้อยบาทถ้วน)', 60, 300, 150),
      item('รวมเป็นเงิน', 330, 300, 50), item('50,000.00', 500, 300, 45),
      item('ภาษีมูลค่าเพิ่ม 7%', 330, 285, 80), item('3,500.00', 505, 285, 40),
      item('จำนวนเงินรวมทั้งสิ้น', 330, 270, 90), item('53,500.00', 500, 270, 45),
    ];
    expect(analyzeDocText(layoutLines(items))).toMatchObject({ kind: 'invoice', total: 53500, subtotal: 50000, vat: 3500, words: 53500, confidence: 'high' });
  });
});
