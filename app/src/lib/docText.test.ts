import { describe, expect, it } from 'vitest';
import { analyzeDocText } from './docExtract';
import { hasTextLayer, layoutLines, readDocText, sniff } from './docText';

const file = (bytes: (number | string)[], type = '', name = 'file') =>
  Object.assign(new Blob([new Uint8Array(bytes.flatMap((b) => (typeof b === 'string' ? [...b].map((c) => c.charCodeAt(0)) : [b])))], { type }), { name });
/** An ISO media file header: an ftyp box with its major and compatible brands. */
const ftyp = (major: string, ...compatible: string[]) => file([0, 0, 0, 16 + 4 * compatible.length, 'ftyp', major, 0, 0, 0, 0, ...compatible, 0, 0, 0, 8, 'meta']);

describe('sniff (file type from the first bytes)', () => {
  it.each([
    ['a PDF', file(['%PDF-1.7\n']), 'pdf'],
    ['a PDF with junk before the header', file(['\r\n\r\n', '%PDF-1.4']), 'pdf'],
    ['a PNG', file([0x89, 'PNG\r\n', 0x1a, '\n']), 'image'],
    ['a JPEG', file([0xff, 0xd8, 0xff, 0xe0]), 'image'],
    ['a WEBP', file(['RIFF', 0, 0, 0, 0, 'WEBPVP8 ']), 'image'],
    ['an AVIF', ftyp('avif', 'avif', 'mif1', 'miaf', 'MA1B'), 'image'],
    ['an AVIF whose major brand is mif1', ftyp('mif1', 'mif1', 'avif', 'miaf'), 'image'],
    ['an AVIF image sequence', ftyp('avis', 'avis', 'msf1', 'miaf'), 'image'],
    ['a HEIC photo', ftyp('heic', 'mif1', 'heic'), 'heic'],
    ['a HEIF image', ftyp('mif1', 'mif1', 'heic'), 'heic'],
    ['a HEVC sequence', ftyp('hevc', 'msf1', 'hevc'), 'heic'],
  ])('%s', async (_, f, kind) => expect(await sniff(f)).toBe(kind));

  it('falls back to the type and the name', async () => {
    expect(await sniff(file(['....'], 'image/png'))).toBe('image');
    expect(await sniff(file(['....'], '', 'scan.PDF'))).toBe('pdf');
    expect(await sniff(file(['hello'], 'text/plain', 'notes.txt'))).toBe('other');
  });
});

describe('readDocText (without a browser)', () => {
  it('refuses a file over the 10 MB limit with a Thai message', async () => {
    const big = Object.assign(new Blob([new TextEncoder().encode('%PDF-1.4\n'), new Uint8Array(10 * 1024 * 1024)], { type: 'application/pdf' }), { name: 'big.pdf' });
    await expect(readDocText(big)).rejects.toThrow('ไฟล์ใหญ่เกิน 10 MB');
  });

  it('returns no text for a file it does not read', async () => {
    expect(await readDocText(file(['hello'], 'text/plain', 'notes.txt'))).toEqual({ text: '', method: 'none', pages: 0 });
  });

  it('rejects with the abort reason once cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(readDocText(file(['hello'], 'text/plain'), { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('turns an unreadable HEIC photo into a Thai message', async () => {
    await expect(readDocText(ftyp('heic', 'mif1', 'heic'))).rejects.toThrow('HEIC');
  });
});

describe('hasTextLayer (one PDF page)', () => {
  it('is false for a scanned page with only a scanner stamp, on every page of the scan', () => {
    expect(hasTextLayer('Scanned with CamScanner')).toBe(false);
    expect(hasTextLayer('')).toBe(false);
    // the whole-document count this replaced passed two such pages as a text layer
    expect(['Scanned with CamScanner', 'Scanned with CamScanner'].every((p) => !hasTextLayer(p))).toBe(true);
  });

  it('is true for a page with words, or a short page with an amount', () => {
    expect(hasTextLayer('ใบเสนอราคา QUOTATION เลขที่ QT2569-0031 วันที่ 01/10/2569 ลูกค้า: บริษัท เอเชีย พลาสติก จำกัด')).toBe(true);
    expect(hasTextLayer('รวมทั้งสิ้น   195,810.00')).toBe(true);
  });

  it('is false for a broken font that gives private-use characters', () => {
    expect(hasTextLayer('\uE001\uE002\uE003 '.repeat(30) + 'ab12')).toBe(false);
  });
});

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
