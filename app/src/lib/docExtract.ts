/**
 * Document amount extraction — finds the money amounts (plus kind, number, date and customer) in
 * the text of a quotation (ใบเสนอราคา), invoice (ใบแจ้งหนี้ / ใบวางบิล), tax invoice or receipt
 * (ใบกำกับภาษี / ใบเสร็จ), so the user only has to confirm them.
 *
 * Pure (no DOM). The text comes from docText.ts — a PDF text layer (one pdf.js item per line, or
 * lines rebuilt from item positions) or OCR — so everything here tolerates a label and its value
 * on different lines or in separate column blocks, Thai digits, spaced-out Thai and misread tone
 * marks (OCR), O/l read for 0/1, and legacy Thai fonts without a Unicode map.
 *
 * Deliberately no regex lookbehind: Safari < 16.4 cannot even parse a module containing one, which
 * would take the whole app down once the UI imports this file.
 */

export type DocKind = 'quotation' | 'invoice' | 'receipt' | 'other';
export interface AmountCandidate { value: number; label: string; source: 'words' | 'keyword' | 'vat' | 'largest'; score: number; line: string }
export interface DocFacts {
  kind: DocKind | null;
  docNo: string;
  /** ISO yyyy-mm-dd; Buddhist-era years converted */
  docDate: string;
  /** grand total including VAT */
  total: number | null;
  /** before VAT (after discount) */
  subtotal: number | null;
  vat: number | null;
  /** withholding tax (ภาษีหัก ณ ที่จ่าย) */
  wht: number | null;
  /** amount payable after withholding tax */
  netPay: number | null;
  /** amount written in Thai words, e.g. (หนึ่งหมื่นเจ็ดร้อยบาทถ้วน) */
  words: number | null;
  /** customer named after ลูกค้า / เรียน / Customer / Bill to */
  party: string;
  /** possible amounts for the user to pick from, best first, one per value */
  candidates: AmountCandidate[];
  confidence: 'high' | 'medium' | 'low';
}

// ------------------------------------------------------------------ text normalisation

/** Windows Thai fonts map their positional variants (lowered/shifted tone marks, tail-less ฐ ญ)
 *  to U+F700–U+F71A; pdf.js passes those through when a PDF has no proper ToUnicode map. */
const PUA_THAI = [
  0x0e10, 0x0e34, 0x0e35, 0x0e36, 0x0e37, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b,
  0x0e4c, 0x0e0d, 0x0e31, 0x0e4d, 0x0e47, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c, 0x0e38, 0x0e39, 0x0e3a,
];
const TONE = /[\u0E47-\u0E4E]/;
const TONES = /[\u0E47-\u0E4E]/g;

/**
 * Repairs Thai text as PDF text layers often deliver it: legacy (non-Unicode) Thai fonts whose
 * TIS-620 codes come out as Latin-1 letters ("ãºàÊ¹ÍÃÒ¤Ò" → "ใบเสนอราคา"), Windows presentation
 * forms in the Private Use Area, and sara am written as nikhahit + sara aa.
 */
export function repairThaiText(s: string): string {
  const legacy = (s.match(/[\u00A1-\u00FB]/g) || []).length;
  if (legacy >= 20) {
    const latin = (s.match(/[A-Za-z]/g) || []).length, thai = (s.match(/[\u0E01-\u0E5B]/g) || []).length;
    if (legacy > 0.3 * (legacy + latin) && thai < legacy / 10)
      s = s.replace(/[\u00A1-\u00FB]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x0d60));
  }
  return s
    .replace(/[\uF700-\uF71A]/g, (c) => String.fromCharCode(PUA_THAI[c.charCodeAt(0) - 0xf700]))
    .replace(/\u0E4D([\u0E48-\u0E4B]?)\u0E32/g, '$1\u0E33')
    .normalize('NFC');
}

function normalizeText(text: string) {
  return repairThaiText(text || '')
    .replace(/[\u0E50-\u0E59]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[\uFF10-\uFF19]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[\uFF0C\u201A]/g, ',')
    .replace(/\uFF0E/g, '.')
    .replace(/\uFF1A/g, ':')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/\t/g, '   ')
    .replace(/\r\n?|[\u2028\u2029\f\v]/g, '\n');
}

/** Characters left out of match keys, so "Sub-Total", "Sub Total" and "SUBTOTAL:" all read
 *  "subtotal", and OCR's spaced-out or tone-mark-less Thai still matches. */
const KEY_DROP = /[\s.\-_:()[\]/\\|*'"“”‘’,;!?#]/;

/** Per UTF-16 code: 0 = not seen yet, 1 = left out of match keys, 2 = kept. */
const KEY_CHAR = new Uint8Array(0x10000);
/** Every line's key is needed by several finders; analyzeDocText keeps them for one run. */
let keyMemo: Map<string, { k: string; m: number[] }> | null = null;

/** Match key of `s` plus, for each key character, its index in `s`. */
function keyMap(s: string) {
  const hit = keyMemo?.get(s);
  if (hit) return hit;
  let k = '';
  const m: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    let t = KEY_CHAR[code];
    if (!t) t = KEY_CHAR[code] = TONE.test(s[i]) || KEY_DROP.test(s[i]) ? 1 : 2;
    if (t === 1) continue;
    if (code >= 65 && code <= 90) k += String.fromCharCode(code + 32);
    else if (code < 128 || (code >= 0x0e00 && code <= 0x0e7f)) k += s[i];
    else {
      const l = s[i].toLowerCase();
      k += l.length === 1 ? l : s[i];
    }
    m.push(i);
  }
  const r = { k, m };
  keyMemo?.set(s, r);
  return r;
}
const key = (s: string) => keyMap(s).k;
/** Original-text end of the key span ending at key index `e` (exclusive), past trailing tone marks. */
function endAt(s: string, m: number[], e: number) {
  let j = m[e - 1] + 1;
  while (j < s.length && TONE.test(s[j])) j++;
  return j;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs a global regex over `s`, skipping matches whose preceding character matches `notBefore`
 *  (stands in for a lookbehind). */
function eachMatch(s: string, re: RegExp, notBefore: RegExp | null, fn: (m: RegExpExecArray) => void) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (notBefore && m.index > 0 && notBefore.test(s[m.index - 1])) {
      re.lastIndex = m.index + 1;
      continue;
    }
    fn(m);
  }
}

const blank = (s: string, a: number, b: number) => s.slice(0, a) + ' '.repeat(b - a) + s.slice(b);

// OCR reads 0 as O/o and 1 as l/I inside numbers; fixed only where the result is clearly an amount.
const OCR_TOKEN = /[0-9OoIl][0-9OoIl,.]*[0-9OoIl]/g;
const MONEY_SHAPE = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})$/;
function fixOcrDigits(line: string) {
  let out = line;
  if (/[OoIl]/.test(line))
    eachMatch(line, OCR_TOKEN, /[A-Za-z]/, (m) => {
      const t = m[0];
      if (!/[OoIl]/.test(t) || !/\d/.test(t) || /[A-Za-z]/.test(line[m.index + t.length] || '')) return;
      const f = t.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
      if (MONEY_SHAPE.test(f)) out = out.slice(0, m.index) + f + out.slice(m.index + t.length);
    });
  // dots for thousands (OCR, some templates), OCR's space for the decimal point: "10.700.00", "4.200 00" → "10,700.00";
  // OCR's space for the thousands separator: "107 000.00", "1 250 000.00" → "107,000.00"
  return out
    .replace(/(^|[^\d.,])(\d{1,3})((?:\.\d{3})+)[. ](\d{2})(?![\d.,])/g, (_, p, a, b, c) => p + a + b.replace(/\./g, ',') + '.' + c)
    .replace(/(^|[^\d.,])(\d{1,3})((?: \d{3})+)\.(\d{2})(?![\d.,])/g, (_, p, a, b, c) => p + a + b.replace(/ /g, ',') + '.' + c);
}

// ------------------------------------------------------------------ dates

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const thaiLoose = (w: string, sep: string) => [...w.replace(TONES, '')].map((c) => esc(c) + '[\\u0E47-\\u0E4E]*').join(sep);
const TH_MONTH_ALT = TH_MONTHS.map((m, i) => `(${thaiLoose(m, '\\s?')}|${TH_ABBR[i].split('.').filter(Boolean).map((p) => thaiLoose(p, '')).join('\\s?\\.?\\s?')}\\s?\\.?)`).join('|');
const ERA = '(?:(?:พ|ค)\\s?\\.?\\s?ศ\\s?\\.?\\s*)?';
const RE_TH_DATE = new RegExp(`(\\d{1,2})\\s*(?:${TH_MONTH_ALT})\\s*${ERA}(\\d{4}|\\d{2})(?!\\d)`, 'g');
const EN_ALT = `(${EN_MONTHS.join('|')})[a-z]*\\.?`;
const RE_EN_DMY = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-/.]*${EN_ALT}[\\s\\-/.,]*(\\d{4}|\\d{2})(?!\\d)`, 'gi');
const RE_EN_MDY = new RegExp(`${EN_ALT}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, 'gi');
const RE_NUM_DATE = /(\d{1,2})\s?([/.-])\s?(\d{1,2})\s?\2\s?(\d{4}|\d{2})(?!\d)/g;
const RE_ISO_DATE = /(\d{4})\s?([/.-])\s?(\d{1,2})\s?\2\s?(\d{1,2})(?!\d)/g;
/** OCR misreads the second letter of a month abbreviation (ต.ค. → ต.ด.); the first one mostly decides. */
const RE_TH_ABBR_OCR = new RegExp(`(\\d{1,2})\\s*(เม|มี|มิ|[มกพสตธ])[\\u0E47-\\u0E4E]*\\s?\\.\\s?([\\u0E01-\\u0E2E])[\\u0E47-\\u0E4E]*\\s?\\.?\\s*${ERA}(\\d{4}|\\d{2})(?!\\d)`, 'g');
function ocrMonth(a: string, b: string) {
  const k = 'คดศฅต'.includes(b), p = 'พฟผ'.includes(b), y = 'ยขบษ'.includes(b);
  const m: Record<string, number> = { มี: 3, เม: 4, มิ: 6, ส: 8, ต: 10, ธ: 12, ม: k ? 1 : 0, ก: p ? 2 : k ? 7 : y ? 9 : 0, พ: k ? 5 : y ? 11 : 0 };
  return m[a] || 0;
}

/** ISO date, or '' when invalid. 4-digit years above 2400 are Buddhist era; 2-digit years ≥ 40 are
 *  taken as BE (69 → 2569 → 2026), below as CE (26 → 2026). */
function isoDate(y: number, m: number, d: number, yDigits: number) {
  y = yDigits <= 2 ? (y >= 40 ? y + 1957 : y + 2000) : y > 2400 ? y - 543 : y;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2200) return '';
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface DateHit { s: number; e: number; iso: string }
function findDates(line: string): DateHit[] {
  const hits: DateHit[] = [];
  const add = (m: RegExpExecArray, iso: string) => iso && hits.push({ s: m.index, e: m.index + m[0].length, iso });
  eachMatch(line, RE_TH_DATE, /\d/, (m) => {
    const mi = m.slice(2, 14).findIndex((x) => x !== undefined);
    add(m, isoDate(+m[14], mi + 1, +m[1], m[14].length));
  });
  eachMatch(line, RE_EN_DMY, /[\dA-Za-z]/, (m) => add(m, isoDate(+m[3], EN_MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1], m[3].length)));
  eachMatch(line, RE_EN_MDY, /[A-Za-z]/, (m) => add(m, isoDate(+m[3], EN_MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2], 4)));
  eachMatch(line, RE_ISO_DATE, /[\d,.]/, (m) => add(m, isoDate(+m[1], +m[3], +m[4], 4)));
  eachMatch(line, RE_NUM_DATE, /[\d,.]/, (m) => {
    let d = +m[1], mo = +m[3];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // month/day/year
    add(m, isoDate(+m[4], mo, d, m[4].length));
  });
  eachMatch(line, RE_TH_ABBR_OCR, /\d/, (m) => add(m, isoDate(+m[4], ocrMonth(m[2], m[3]), +m[1], m[4].length)));
  hits.sort((a, b) => a.s - b.s);
  return hits.filter((h, i) => !hits.slice(0, i).some((o) => h.s < o.e && o.s < h.e));
}

// ------------------------------------------------------------------ numbers

/** Spans that look numeric but are not amounts; blanked before amounts are read. */
const MASKS: [RegExp, RegExp | null][] = [
  [/\d{1,2}[:.]\d{2}\s?(?:น\.?|นาฬิกา|hrs?\.?|am|pm)/gi, /\d/], // times
  [/\d{1,2}:\d{2}(?::\d{2})?/g, /\d/],
  [/\d+(?:[.,]\d+)?\s?%/g, /[\d.,]/], // rates: VAT 7%, หัก 3%, มัดจำ 50%
  [/\d[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2}[-\s]?\d(?!\d)/g, /\d/], // 13-digit tax id
  [/(?:\+66[-\s]?|0)\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}(?!\d)(?![,.]\d)/g, /[\d,.]/], // phones
  [/\d+(?:-\d+){2,}/g, /[\d,.]/], // bank accounts, codes
  [/\d+(?:\s?\/\s?\d+)+/g, /[\d,.]/], // house numbers 99/9, doc no 0012/2569, pages 1/2
  [/(?:iso|tis|มอก\.?)\s?\d+(?:[-:]\d+)*/gi, /[A-Za-z]/], // standards: ISO 14064-1
  [/[A-Za-z]{1,6}[-#]?\d[\w\-/]*(?![\w\-/])(?![,.]\d)/g, /[A-Za-z]/], // codes: QT2569-001, INV-0045, CO2
  [/\d{9,}(?!\d)/g, /[\d,.]/], // long ids
  [/(?:พ\s?\.?\s?ศ\s?\.?|ค\s?\.?\s?ศ\s?\.?|ปี|year|fy)\s?\d{4}(?!\d)/gi, null], // years
];
const NUM_RE = /(\d{1,3}(?:\s?,\s?\d{3})+|\d+)(?:\.(\d{1,2})(?!\d)|\.\s(\d{2})(?!\d)|,(\d{2})(?!\d))?/g;
const UNIT_AFTER = /^\s*(?:ชิ้น|ตัน|กก|kg|หน่วย|งาน|ชุด|เครื่อง|ครั้ง|วัน|เดือน|ปี|คน|ราย|แห่ง|หน้า|ข้อ|รายการ|ระบบ|ลิตร|เมตร|ใบ|เล่ม|กล่อง|โครงการ|สาขา|sites?|pcs?|units?|days?|months?|years?|tons?|items?|lots?|sets?|hrs?|hours?|tco2)/i;
const CUR_BEFORE = /(?:฿|thb|usd|\$)\s*$/i;
const CUR_AFTER = /^\s*(?:บาท|baht|thb|\.\s?-|\.=|\/-)/i;

/** `used` = taken by a label; `ign` = taken by a non-amount label (เลขที่, โทร, …) */
interface Num { v: number; s: number; e: number; q: number; qty: boolean; used: boolean; ign?: boolean }

function maskLine(line: string) {
  let s = line;
  for (const h of findDates(s)) s = blank(s, h.s, h.e);
  for (const [re, nb] of MASKS) {
    const spans: [number, number][] = [];
    eachMatch(s, re, nb, (m) => spans.push([m.index, m.index + m[0].length]));
    for (const [a, b] of spans) s = blank(s, a, b);
  }
  return s;
}

/** Amounts on a (masked) line. `q` = how money-like: 2-digit decimals 3, thousands commas 2,
 *  currency mark 2; a bare integer ≥ 1000 is 1, a smaller one 0. */
function readNums(m: string): Num[] {
  const out: Num[] = [];
  eachMatch(m, NUM_RE, /[\d,.]/, (x) => {
    const int = x[1];
    let dec = x[2] ?? x[3] ?? '';
    let end = x.index + x[0].length;
    if (x[4] !== undefined) {
      if (int.includes(',')) dec = x[4]; // OCR comma for the decimal point: 17,120,00
      else end = x.index + int.length;
    }
    const v = Math.round(parseFloat(int.replace(/[\s,]/g, '') + (dec ? '.' + dec : '')) * 100) / 100;
    if (!isFinite(v)) return;
    const comma = int.includes(','), cur = CUR_BEFORE.test(m.slice(Math.max(0, x.index - 5), x.index)) || CUR_AFTER.test(m.slice(end, end + 8));
    let q = (dec.length === 2 ? 3 : dec ? 1 : 0) + (comma ? 2 : 0) + (cur ? 2 : 0);
    if (!q && v >= 1000) q = 1;
    out.push({ v, s: x.index, e: end, q, qty: UNIT_AFTER.test(m.slice(end, end + 12)), used: false });
  });
  return out;
}

// ------------------------------------------------------------------ labels

type Field = 'total' | 'sum' | 'subtotal' | 'vat' | 'wht' | 'netPay' | 'discount' | 'deposit' | 'ignore';
/** [field, weight, phrases, anchored]. Longer phrases win (matched first, then consumed); an
 *  anchored phrase only counts at the start of a line or column (bare "รวม", "Total"). */
const RULES: [Field, number, string[], boolean?][] = [
  ['total', 95, ['จำนวนเงินรวมทั้งสิ้น', 'ยอดเงินรวมทั้งสิ้น', 'ยอดรวมทั้งสิ้น', 'รวมเงินทั้งสิ้น', 'รวมยอดทั้งสิ้น', 'ราคารวมทั้งสิ้น', 'รวมเป็นเงินทั้งสิ้น', 'เงินรวมทั้งสิ้น', 'จำนวนเงินทั้งสิ้น', 'รวมทั้งสิ้น', 'grand total', 'total incl vat', 'total including vat', 'total inc vat', 'total amount incl vat', 'total amount including vat', 'ราคารวมภาษีมูลค่าเพิ่ม', 'ราคารวมภาษี']],
  ['total', 85, ['ยอดรวมสุทธิ', 'จำนวนเงินรวมสุทธิ', 'ยอดเงินรวมสุทธิ', 'รวมเงินสุทธิ', 'รวมสุทธิ', 'net total', 'total net', 'รวมภาษีมูลค่าเพิ่มแล้ว', 'รวมภาษีแล้ว', 'รวม vat แล้ว']],
  ['total', 80, ['total amount', 'ยอดสุทธิ', 'จำนวนเงินสุทธิ', 'ยอดเงินสุทธิ']],
  ['total', 75, ['amount due', 'total due', 'total amount due', 'ยอดเงินรวม']],
  ['sum', 60, ['รวมเป็นเงิน', 'รวมจำนวนเงิน', 'รวมราคา', 'total price', 'ราคาสุทธิ']],
  ['sum', 45, ['จำนวนเงิน']],
  ['sum', 45, ['ยอดรวม', 'รวมเงิน', 'ราคารวม', 'total', 'รวม'], true],
  ['subtotal', 90, ['ราคาก่อนภาษีมูลค่าเพิ่ม', 'ราคาก่อนภาษี', 'ยอดก่อนภาษีมูลค่าเพิ่ม', 'ยอดก่อนภาษี', 'ยอดเงินก่อนภาษี', 'จำนวนเงินก่อนภาษี', 'มูลค่าก่อนภาษี', 'รวมก่อนภาษี', 'ก่อนภาษีมูลค่าเพิ่ม', 'ก่อนภาษี', 'ยอดก่อน vat', 'ราคาก่อน vat', 'รวมก่อน vat', 'ก่อน vat', 'total before vat', 'amount before vat', 'total excl vat', 'total excluding vat', 'before vat', 'excl vat', 'excluding vat', 'ราคาไม่รวมภาษีมูลค่าเพิ่ม', 'ราคาไม่รวมภาษี', 'ยอดไม่รวมภาษี', 'มูลค่าไม่รวมภาษี']],
  ['subtotal', 85, ['จำนวนเงินหลังหักส่วนลด', 'ยอดเงินหลังหักส่วนลด', 'ยอดหลังหักส่วนลด', 'ราคาหลังหักส่วนลด', 'หลังหักส่วนลด', 'หลังส่วนลด', 'total after discount', 'after discount']],
  ['subtotal', 80, ['sub total', 'subtotal']],
  ['subtotal', 70, ['มูลค่าสินค้าหรือบริการ', 'มูลค่าสินค้า', 'มูลค่าบริการ', 'มูลค่าที่ต้องเสียภาษี', 'ฐานภาษี', 'net amount', 'taxable amount']],
  ['vat', 90, ['ภาษีมูลค่าเพิ่ม', 'value added tax', 'vat', 'ภาษีขาย', 'ภาษี 7%']],
  ['wht', 90, ['ภาษีหัก ณ ที่จ่าย', 'หักภาษี ณ ที่จ่าย', 'หัก ณ ที่จ่าย', 'ภาษี ณ ที่จ่าย', 'withholding tax', 'withholding', 'wht', 'w/h tax', 'w/h']],
  ['netPay', 90, ['ยอดชำระสุทธิ', 'ยอดเงินชำระสุทธิ', 'จำนวนเงินชำระสุทธิ', 'ยอดชำระเงินสุทธิ', 'ยอดสุทธิที่ต้องชำระ', 'จำนวนเงินที่ต้องชำระ', 'ยอดเงินที่ต้องชำระ', 'ยอดที่ต้องชำระ', 'ชำระสุทธิ', 'net amount payable', 'net payable', 'amount payable', 'net payment', 'net amount to pay', 'total payable']],
  ['netPay', 75, ['ยอดชำระ', 'จำนวนเงินที่ชำระ', 'จำนวนเงินที่ได้รับ', 'ได้รับเงินจำนวน', 'รับเงินจำนวน', 'amount received', 'amount paid']],
  ['discount', 80, ['ส่วนลดพิเศษ', 'หักส่วนลด', 'ส่วนลด', 'discount']],
  ['deposit', 60, ['หักเงินมัดจำ', 'หักมัดจำ', 'เงินมัดจำ', 'มัดจำ', 'deposit', 'down payment', 'advance payment', 'เงินล่วงหน้า', 'งวดที่', 'installment', 'ชำระแล้ว', 'less amount paid', 'less amount received', 'less payments', 'less payment', 'less paid', 'paid', 'ยอดคงเหลือ', 'คงเหลือ', 'ส่วนที่เหลือ', 'balance due', 'balance', 'remaining']],
  ['ignore', 0, ['ราคาต่อหน่วย', 'ราคา/หน่วย', 'หน่วยละ', 'unit price', 'price/unit', 'จำนวน', 'qty', 'quantity', 'เลขประจำตัวผู้เสียภาษีอากร', 'เลขประจำตัวผู้เสียภาษี', 'เลขผู้เสียภาษี', 'tax id', 'taxpayer id', 'vat reg', 'vat registration', 'vat no', 'vat id', 'เลขที่', 'no', 'number', 'วันที่', 'date', 'โทรศัพท์', 'โทรสาร', 'โทร', 'tel', 'fax', 'แฟกซ์', 'มือถือ', 'mobile', 'phone', 'สาขา', 'branch', 'เลขที่บัญชี', 'บัญชี', 'account', 'a/c', 'อ้างอิง', 'ref', 'po', 'เครดิต', 'credit', 'ยืนราคา', 'ลำดับ', 'item', 'รหัส', 'code', 'หมู่', 'moo', 'ซอย', 'soi']],
];
/** `bi` = the phrase's character pairs, to skip fuzzy matching on lines that cannot contain it */
interface Phrase { k: string; f: Field; w: number; anchored: boolean; bi: string[] }
const bigrams = (k: string) => Array.from({ length: Math.max(0, k.length - 1) }, (_, i) => k.slice(i, i + 2));
function compile(rules: [Field, number, string[], boolean?][]): Phrase[] {
  const seen = new Set<string>(), out: Phrase[] = [];
  for (const [f, w, list, anchored] of rules)
    for (const p of list) {
      const k = key(p);
      if (!seen.has(k)) seen.add(k), out.push({ k, f, w, anchored: !!anchored, bi: bigrams(k) });
    }
  return out.sort((a, b) => b.k.length - a.k.length);
}
const PHRASES = compile(RULES);
const FAMILY: Record<Field, string> = { total: 'T', sum: 'T', subtotal: 'S', vat: 'V', wht: 'W', netPay: 'N', discount: 'D', deposit: 'P', ignore: '' };

interface Lab { f: Field; w: number; s: number; e: number; text: string; fuzzy: boolean; val?: Num; vli?: number; pen: number }
interface Hit { s: number; e: number; p: Phrase; fuzzy: boolean }

const isLatin = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
/** Start of a line (after bullets / item numbers) or of a column (2+ spaces, a bar, a colon). */
const anchoredAt = (before: string) => /^[\s\-–—•*()[\]|:#.\d]*$/.test(before) || /(\s{2,}|[|:)\]]\s*)$/.test(before);

/** Best approximate occurrence of `p` in `t` with at most `k` edits (Sellers' algorithm). */
function approxFind(t: string, p: string, k: number) {
  const m = p.length;
  let prev = Array.from({ length: m + 1 }, (_, i) => i), ps = new Array<number>(m + 1).fill(0);
  let cur = new Array<number>(m + 1), cs = new Array<number>(m + 1);
  let best: { s: number; e: number; d: number } | null = null;
  for (let j = 1; j <= t.length; j++) {
    cur[0] = 0;
    cs[0] = j;
    for (let i = 1; i <= m; i++) {
      const sub = prev[i - 1] + (p[i - 1] === t[j - 1] ? 0 : 1), del = prev[i] + 1, ins = cur[i - 1] + 1;
      if (sub <= del && sub <= ins) (cur[i] = sub), (cs[i] = ps[i - 1]);
      else if (del <= ins) (cur[i] = del), (cs[i] = ps[i]);
      else (cur[i] = ins), (cs[i] = cs[i - 1]);
    }
    if (cur[m] <= k && (!best || cur[m] < best.d)) best = { s: cs[m], e: j, d: cur[m] };
    [prev, cur] = [cur, prev];
    [ps, cs] = [cs, ps];
  }
  return best;
}

/** Occurrences of `phrases` in `line`, longest first and non-overlapping; then, for OCR, phrases of
 *  7+ characters with one or two misread characters in what is left. Returns original-text spans. */
function findPhrases(line: string, phrases: Phrase[], fuzzy: boolean): Hit[] {
  const { k, m } = keyMap(line);
  const used = new Uint8Array(k.length);
  const hits: Hit[] = [];
  const free = (a: number, b: number) => !used.subarray(a, b).some((x) => x);
  const take = (a: number, b: number, p: Phrase, fz: boolean) => {
    used.fill(1, a, b);
    hits.push({ s: m[a], e: endAt(line, m, b), p, fuzzy: fz });
  };
  for (const p of phrases) {
    for (let from = 0, i: number; (i = k.indexOf(p.k, from)) >= 0; ) {
      from = i + 1;
      const e = i + p.k.length;
      if (!free(i, e)) continue;
      if (isLatin(p.k[0]) && isLatin(line[m[i] - 1])) continue;
      if (isLatin(p.k[p.k.length - 1]) && isLatin(line[endAt(line, m, e)])) continue;
      if (p.anchored && !anchoredAt(line.slice(0, m[i]))) continue;
      take(i, e, p, false);
      from = e;
    }
  }
  if (fuzzy) {
    const lineBi = new Set(bigrams(k));
    let masked = '';
    for (const p of phrases) {
      if (p.k.length < 7 || p.w < 60) continue;
      const edits = p.k.length >= 12 ? 2 : 1;
      // each edit breaks at most two character pairs
      if (p.bi.filter((b) => lineBi.has(b)).length < p.bi.length - 2 * edits) continue;
      masked = masked || [...k].map((c, i) => (used[i] ? '\u0000' : c)).join('');
      const r = approxFind(masked, p.k, edits);
      if (r && r.e - r.s >= p.k.length - 2 && free(r.s, r.e)) {
        take(r.s, r.e, p, true);
        masked = '';
      }
    }
  }
  return hits.sort((a, b) => a.s - b.s);
}

// ------------------------------------------------------------------ line model

interface Ln { i: number; raw: string; masked: string; nums: Num[]; labs: Lab[]; rest: number; blank: boolean }

function parseLine(raw: string, i: number): Ln {
  if (!raw.trim()) return { i, raw, masked: raw, nums: [], labs: [], rest: 0, blank: true };
  const masked = maskLine(raw);
  const nums = readNums(masked);
  const hits = findPhrases(raw, PHRASES, /[\u0E00-\u0E7FA-Za-z]{4}/.test(raw));
  let labs: Lab[] = hits.map((h) => ({ f: h.p.f, w: h.p.w, s: h.s, e: h.e, text: raw.slice(h.s, h.e).trim(), fuzzy: h.fuzzy, pen: 0 }));
  // bilingual / compound labels ("รวมเป็นเงิน / Sub Total", "ภาษีมูลค่าเพิ่ม 7% (VAT)") act as one:
  // the more specific one names it; a wide gap (2+ spaces) means separate columns instead
  const merged: Lab[] = [];
  for (const l of labs) {
    const p = merged[merged.length - 1];
    if (p && p.f !== 'ignore' && l.f !== 'ignore') {
      const gap = masked.slice(p.e, l.s);
      if (!/\d/.test(gap) && key(gap).length <= 3 && (!/\s{2,}/.test(gap) || /[/(]/.test(gap) || FAMILY[p.f] === FAMILY[l.f])) {
        const keep = l.w > p.w ? l : p;
        merged[merged.length - 1] = { ...keep, s: p.s, e: l.e, text: raw.slice(p.s, l.e).replace(/\s+/g, ' ').trim(), fuzzy: p.fuzzy && l.fuzzy };
        continue;
      }
    }
    merged.push(l);
  }
  labs = merged;
  let rest = masked;
  for (const l of labs) rest = blank(rest, l.s, l.e);
  for (const n of nums) rest = blank(rest, n.s, n.e);
  const restKey = key(rest.replace(/บาท|baht|thb|฿|=|%/gi, ''));
  return { i, raw, masked, nums, labs, rest: restKey.length, blank: !raw.trim() };
}

const pending = (L: Ln) => L.labs.filter((l) => l.f !== 'ignore' && !l.val);
const freeMoney = (L: Ln) => L.nums.filter((n) => !n.used && !n.qty && n.q >= 1);
const isLabelLine = (L: Ln) => pending(L).length > 0 && !freeMoney(L).length && L.rest <= 14;
const isValueLine = (L: Ln) => !L.labs.length && freeMoney(L).length > 0 && L.rest <= 3;

function assign(l: Lab, n: Num, li: number, pen: number) {
  l.val = n;
  l.vli = li;
  l.pen = pen;
  n.used = true;
}

/** Pairs labels with amounts: same line first, then a label/value split across lines (pdf.js
 *  items, right-aligned columns) — value after the label (`next`) or before it (`prev`), single
 *  lines or whole column blocks. Both orders are tried; the caller keeps the one that adds up. */
function pairLabels(lines: Ln[], order: 'next' | 'prev') {
  for (const L of lines) {
    // ignore-labels (เลขที่, โทร, จำนวน, ...) take the number right after them, unless it is an amount
    for (const l of L.labs.filter((x) => x.f === 'ignore')) {
      const n = L.nums.find((x) => !x.used && x.s >= l.e && x.s - l.e <= 6);
      if (n && n.q < 3) n.used = n.ign = true;
    }
    segments(L).forEach(([l, seg]) => {
      const best = seg.filter((n) => n.q >= 1).pop();
      if (best) assign(l, best, L.i, 0);
    });
    // the amount written before its label: "107,000 บาท (รวมภาษีมูลค่าเพิ่มแล้ว)"
    const first = L.labs.find((l) => l.f !== 'ignore');
    if (first && !first.val) {
      const before = L.nums.filter((n) => !n.used && !n.qty && n.q >= 1 && n.e <= first.s).pop();
      if (before) assign(first, before, L.i, 10);
    }
  }
  if (order === 'prev') pairBackward(lines);
  pairForward(lines);
  if (order === 'next') pairBackward(lines);
  // last resort, once the other lines had their chance: a bare small number after the label ("VAT 700")
  for (const L of lines)
    segments(L).forEach(([l, seg]) => {
      if (!l.val && seg.length) assign(l, seg[seg.length - 1], L.i, 12);
    });
}

/** Each amount label with the free numbers between it and the next amount label on its line. */
const segments = (L: Ln): [Lab, Num[]][] => {
  const money = L.labs.filter((l) => l.f !== 'ignore');
  return money.map((l, j) => {
    const end = j + 1 < money.length ? money[j + 1].s : Infinity;
    return [l, L.nums.filter((n) => !n.used && !n.qty && n.s >= l.e && n.s < end)];
  });
};

/** Label lines queue up; the next value-only lines take them in order. */
function pairForward(lines: Ln[]) {
  let queue: Lab[] = [], mode = '', gap = 0, size = 0;
  for (const L of lines) {
    if (L.blank) continue;
    if (isLabelLine(L)) {
      if (mode !== 'label') (queue = []), (size = 0);
      queue.push(...pending(L));
      size = queue.length;
      mode = 'label';
      gap = 0;
      continue;
    }
    const free = freeMoney(L);
    if (queue.length && !L.labs.length && free.length) {
      if (L.rest <= 3) {
        for (const n of free) {
          const l = queue.shift();
          if (!l) break;
          assign(l, n, L.i, 4 + (size > 1 ? 4 : 0) + 3 * gap);
        }
        mode = 'value';
        continue;
      }
      if (queue.length === 1 && size === 1 && mode === 'label' && !gap) assign(queue.shift()!, free[0], L.i, 8);
    }
    if (mode === 'value' || ++gap > 2) (queue = []), (mode = '');
  }
}

/** A block of label lines takes the value-only lines right above it. */
function pairBackward(lines: Ln[]) {
  for (let a = 0; a < lines.length; a++) {
    if (!isLabelLine(lines[a]) || pending(lines[a]).length !== lines[a].labs.filter((l) => l.f !== 'ignore').length) continue;
    const block: Lab[] = [];
    let b = a;
    for (; b < lines.length && (lines[b].blank || isLabelLine(lines[b])); b++) block.push(...pending(lines[b]));
    const vals: [Num, number][] = [];
    for (let c = a - 1; c >= 0 && (lines[c].blank || isValueLine(lines[c])); c--) vals.unshift(...freeMoney(lines[c]).map((n): [Num, number] => [n, c]));
    if (vals.length && vals.length === block.length) block.forEach((l, j) => assign(l, vals[j][0], vals[j][1], 10));
    else if (block.length === 1 && vals.length) assign(block[0], vals[vals.length - 1][0], vals[vals.length - 1][1], 12);
    a = b - 1;
  }
}

// ------------------------------------------------------------------ Thai baht text

const W_DIGIT: Record<string, number> = { ศูนย: 0, หนึง: 1, เอด: 1, สอง: 2, ยี: 2, สาม: 3, สี: 4, หา: 5, หก: 6, เจด: 7, แปด: 8, เกา: 9 };
const W_UNIT: Record<string, number> = { สิบ: 10, รอย: 100, พัน: 1000, หมืน: 10000, แสน: 100000 };
const W_ALL = [...Object.keys(W_DIGIT), ...Object.keys(W_UNIT), 'ลาน', 'บาท', 'สตางค', 'ถวน', 'ตรง'].sort((a, b) => b.length - a.length);
const W_RUN = new RegExp(`(?:${W_ALL.join('|')})+`, 'g');

/** Thai number words (tone marks already stripped) → integer; null when there are none. */
function wordsInt(toks: string[]): number | null {
  let total = 0, section = 0, pend: number | null = null, any = false;
  for (const t of toks) {
    if (t in W_DIGIT) {
      if (pend !== null) section += pend; // OCR doubled a digit word: keep both rather than fail
      pend = W_DIGIT[t];
      any = true;
    } else if (t in W_UNIT) {
      section += (pend ?? 1) * W_UNIT[t];
      pend = null;
      any = true;
    } else if (t === 'ลาน') {
      section += pend ?? 0;
      pend = null;
      if (!any) section = 1; // "ล้านบาท" = one million
      // ล้าน multiplies everything below a million-million (หนึ่งล้านสองแสนล้าน = 1.2e12),
      // but not a part already counted in ล้านล้าน (ห้าล้านล้านสามล้าน = 5e12 + 3e6)
      const high = Math.floor(total / 1e12) * 1e12;
      total = high + (total - high + section) * 1e6;
      section = 0;
      any = true;
    }
  }
  return any ? total + section + (pend ?? 0) : null;
}

/**
 * Thai baht text → number: 'หนึ่งแสนเจ็ดพันบาทถ้วน' → 107000, 'สองร้อยสามสิบเอ็ดบาทห้าสิบสตางค์' → 231.5.
 * Handles เอ็ด/ยี่, ล้าน (incl. ล้านล้าน), a missing หนึ่ง ('สิบบาท', 'ล้านบาท'), and ignores
 * spaces, brackets, misread tone marks and stray characters. null when there is no number in it.
 */
export function bahtTextToNumber(s: string): number | null {
  const t = repairThaiText(s || '').replace(TONES, '').replace(/[^\u0E01-\u0E3A\u0E40-\u0E46]/g, '');
  const toks: string[] = [];
  for (let i = 0; i < t.length; ) {
    const w = W_ALL.find((x) => t.startsWith(x, i));
    if (w) (toks.push(w), (i += w.length));
    else i++;
  }
  while (toks.length && !(toks[0] in W_DIGIT || toks[0] in W_UNIT || toks[0] === 'ลาน')) toks.shift();
  const b = toks.indexOf('บาท'), st = toks.indexOf('สตางค');
  const bahtToks = b >= 0 ? toks.slice(0, b) : st >= 0 ? [] : toks;
  const satToks = st >= 0 ? toks.slice(b >= 0 ? b + 1 : 0, st) : [];
  const baht = wordsInt(bahtToks), sat = wordsInt(satToks);
  if (baht === null && sat === null) return null;
  return Math.round(((baht ?? 0) + (sat !== null && sat < 100 ? sat / 100 : 0)) * 100) / 100;
}

/** `sure` = false when the number words are glued to other Thai letters ("(สจมหมื่น…": OCR garbled
 *  the first word, so the value is probably missing its leading digit). */
interface WordsHit { v: number; li: number; sure: boolean }
const WORDS_AFTER = ['เงิน', 'อักษร', 'จำนวน', 'ยอด', 'รวม', 'ชำระ', 'เป็น', 'ได้รับ', 'ทั้งสิ้น'].map((w) => w.replace(TONES, ''));
function findWords(lines: string[]): WordsHit[] {
  const out: WordsHit[] = [];
  const scan = (s: string, li: number) => {
    let t = '';
    const map: number[] = [];
    for (let i = 0; i < s.length; i++) if (!TONE.test(s[i]) && !/\s/.test(s[i])) (t += s[i]), map.push(i);
    eachMatch(t, W_RUN, null, (m) => {
      if (!/บาท|สตางค/.test(m[0])) return;
      const v = bahtTextToNumber(m[0]);
      if (v === null || v <= 0) return;
      const i = m.index;
      const glued = i > 0 && /[\u0E01-\u0E2E\u0E30-\u0E3A\u0E40-\u0E46]/.test(t[i - 1]) && !/\s/.test(s.slice(map[i - 1] + 1, map[i]));
      out.push({ v, li, sure: !glued || WORDS_AFTER.some((w) => t.slice(0, i).endsWith(w)) });
    });
  };
  lines.forEach((l, i) => scan(l, i));
  // baht text wrapped onto the next line
  if (!out.length) for (let i = 0; i + 1 < lines.length; i++) scan(lines[i] + lines[i + 1], i + 1);
  return out;
}

// ------------------------------------------------------------------ kind, number, date, party

const KINDS: [DocKind, string[]][] = [
  ['quotation', ['ใบเสนอราคา', 'ใบเสนอ', 'quotation']],
  ['invoice', ['ใบแจ้งหนี้', 'ใบวางบิล', 'ใบแจ้งชำระเงิน', 'ใบแจ้งยอด', 'billing note', 'billing', 'invoice']],
  ['receipt', ['ใบเสร็จรับเงิน', 'ใบเสร็จ', 'ใบรับเงิน', 'ใบกำกับภาษี', 'tax invoice', 'receipt']],
  ['other', ['ใบสั่งซื้อ', 'purchase order', 'ใบส่งของ', 'ใบส่งสินค้า', 'delivery order', 'delivery note', 'ใบลดหนี้', 'credit note', 'ใบเพิ่มหนี้', 'debit note', 'สัญญา', 'contract']],
];
const KIND_PHRASES = KINDS.flatMap(([kd, list]) => list.map((p) => ({ k: key(p), kd }))).sort((a, b) => b.k.length - a.k.length);
const REF_BEFORE = ['อ้างอิง', 'อ้างถึง', 'ตาม', 'ref', 'reference', 'refer', 'แนบ'].map(key);
const FIELD_BEFORE = ['เลขที่', 'no', 'วันที่'].map(key);
const FIELD_AFTER = ['no', 'number', 'เลขที่', 'date', 'วันที่', 'to', 'ref'].map(key);
const DOCNO_PREFIX: [RegExp, DocKind][] = [
  [/^(?:qt|qo|quo|qtn)/i, 'quotation'],
  [/^(?:inv|iv|bl|bn|bil)/i, 'invoice'],
  [/^(?:rc|re|rct|rt|ti|tiv|tax)/i, 'receipt'],
];

/** Title line decides (ใบแจ้งหนี้/ใบกำกับภาษี → invoice); "Invoice No." style fields come next;
 *  references ("อ้างอิงใบเสนอราคา") never count. */
function findKind(lines: string[], docNo: string): DocKind | null {
  const title: DocKind[][] = [], field: DocKind[] = [];
  lines.forEach((line, li) => {
    const { k, m } = keyMap(line);
    const used = new Uint8Array(k.length);
    const kinds: DocKind[] = [];
    for (const p of KIND_PHRASES)
      for (let from = 0, i: number; (i = k.indexOf(p.k, from)) >= 0; from = i + 1) {
        const e = i + p.k.length;
        if (used.subarray(i, e).some((x) => x)) continue;
        if (isLatin(p.k[0]) && isLatin(line[m[i] - 1])) continue;
        if (isLatin(p.k[p.k.length - 1]) && isLatin(line[endAt(line, m, e)])) continue;
        // ใบสั่งซื้อ, สัญญา, … name the document only as a heading, not inside a sentence ("เมื่อลงนามสัญญา")
        if (p.kd === 'other' && !anchoredAt(line.slice(0, m[i]))) continue;
        used.fill(1, i, e);
        const before = k.slice(Math.max(0, i - 10), i), after = k.slice(i + p.k.length);
        if (isRef(before)) continue;
        if (FIELD_BEFORE.some((r) => before.endsWith(r)) || FIELD_AFTER.some((r) => after.startsWith(r))) field.push(p.kd);
        else kinds.push(p.kd);
      }
    if (kinds.length) title[li] = kinds;
  });
  const first = title.findIndex((x) => x);
  if (first >= 0) {
    const ks = new Set(title[first]);
    // bilingual titles span two lines: ใบแจ้งหนี้ / ใบกำกับภาษี ⏎ INVOICE / TAX INVOICE
    for (const li of [first + 1, first + 2]) if (title[li] && key(lines[li]).length <= 40) title[li].forEach((x) => ks.add(x));
    for (const kd of ['quotation', 'invoice', 'receipt', 'other'] as DocKind[]) if (ks.has(kd)) return kd;
  }
  if (field.length) return field[0];
  for (const [re, kd] of DOCNO_PREFIX) if (re.test(docNo)) return kd;
  return null;
}

const DOCNO_LABELS: [DocKind | null, string[]][] = [
  ['quotation', ['เลขที่ใบเสนอราคา', 'ใบเสนอราคาเลขที่', 'quotation no', 'quotation number', 'quote no']],
  ['invoice', ['เลขที่ใบแจ้งหนี้', 'ใบแจ้งหนี้เลขที่', 'เลขที่ใบวางบิล', 'invoice no', 'invoice number', 'inv no', 'billing no', 'bill no']],
  ['receipt', ['เลขที่ใบกำกับภาษี', 'เลขที่ใบเสร็จรับเงิน', 'เลขที่ใบเสร็จ', 'ใบกำกับภาษีเลขที่', 'ใบเสร็จรับเงินเลขที่', 'tax invoice no', 'receipt no', 'receipt number']],
  [null, ['เลขที่เอกสาร', 'document no', 'doc no', 'เลขที่', 'no', 'number']],
];
const DOCNO_PHRASES = DOCNO_LABELS.flatMap(([kd, list]) => list.map((p) => ({ k: key(p), kd }))).sort((a, b) => b.k.length - a.k.length);
const DOCNO_NOT_AFTER = ['เลขประจำตัว', 'ผู้เสียภาษี', 'taxid', 'tax', 'vat', 'บัญชี', 'account', 'สาขา', 'branch', 'โทร', 'tel', 'fax', 'po', 'ใบสั่งซื้อ', 'purchaseorder', 'อ้างอิง', 'ref', 'customer', 'ลูกค้า', 'item', 'page', 'หน้า'].map(key);
const isRef = (before: string) => REF_BEFORE.some((r) => before.endsWith(r) || (r.length > 3 && before.includes(r)));
const ADDRESS_AFTER = /^\s*(?:หมู่|ม\.|ถนน|ถ\.|ซอย|ซ\.|ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.|อาคาร|ชั้น|moo|soi|road|rd\.|street|st\.|building|floor)/i;
const DOCNO_TOKEN = /^[\s:#.()/]*(?:no\.?|number|เลขที่)?[\s:#.()/]*([A-Za-z0-9][A-Za-z0-9\-/_.]*)/i;
const DOCNO_ANY = /(^|[^A-Za-z0-9])((?:QTN|QUO|QT|QO|INV|IV|RCT|RC|RE|RT|TIV|TI|BIL|BL|BN)[-/ ]?\d[A-Za-z0-9\-/]*)/;

function cleanDocNo(t: string) {
  const v = t.replace(/[.\-/_]+$/, '');
  if (v.length < 3 || v.length > 30 || !/\d/.test(v)) return '';
  if (findDates(v).some((d) => d.e - d.s >= v.length - 1) || /^\d{13}$/.test(v.replace(/-/g, ''))) return '';
  return v;
}

function findDocNo(lines: string[], kindHint: DocKind | null): string {
  const found: { v: string; kd: DocKind | null; li: number; generic: boolean }[] = [];
  lines.forEach((line, li) => {
    const { k, m } = keyMap(line);
    const used = new Uint8Array(k.length);
    for (const p of DOCNO_PHRASES)
      for (let from = 0, i: number; (i = k.indexOf(p.k, from)) >= 0; from = i + 1) {
        const e = i + p.k.length;
        if (used.subarray(i, e).some((x) => x)) continue;
        if (isLatin(p.k[0]) && isLatin(line[m[i] - 1])) continue;
        if (isLatin(p.k[p.k.length - 1]) && isLatin(line[endAt(line, m, e)])) continue;
        used.fill(1, i, e);
        const before = k.slice(Math.max(0, i - 14), i);
        if (!p.kd && DOCNO_NOT_AFTER.some((r) => before.endsWith(r))) continue;
        if (isRef(before)) continue;
        let rest = line.slice(endAt(line, m, e));
        if (!rest.trim() && li + 1 < lines.length) rest = lines[li + 1];
        const t = DOCNO_TOKEN.exec(rest);
        if (!t) continue;
        const after = rest.slice(t.index + t[0].length);
        // "เลขที่ 99/9 หมู่ 3" is an address; a bare short number after a generic label is too
        if (!p.kd && (ADDRESS_AFTER.test(after) || /^\d{1,3}(?:\/\d+)?$/.test(t[1]))) continue;
        const v = cleanDocNo(t[1]);
        if (v) found.push({ v, kd: p.kd, li, generic: !p.kd });
      }
  });
  const pick =
    found.find((f) => f.kd && f.kd === kindHint) ||
    found.find((f) => f.generic && /[A-Za-z]/.test(f.v)) ||
    found.find((f) => f.generic) ||
    found.find((f) => !kindHint && f.kd);
  if (pick) return pick.v;
  for (const line of lines) {
    const m = DOCNO_ANY.exec(line);
    if (m && isRef(key(line.slice(0, m.index + m[1].length)))) continue;
    if (m) {
      const v = cleanDocNo(m[2].replace(/\s/g, ''));
      if (v) return v;
    }
  }
  return '';
}

const DATE_LABELS = ['วันที่ออก', 'วันที่เอกสาร', 'ลงวันที่', 'วันที่', 'issue date', 'invoice date', 'quotation date', 'document date', 'date', 'dated'].map(key);
const DATE_NOT = ['ครบกำหนด', 'กำหนดชำระ', 'กำหนดส่ง', 'ส่งของ', 'ส่งมอบ', 'ยืนราคา', 'ใช้ได้ถึง', 'หมดอายุ', 'due', 'valid', 'expir', 'delivery', 'ship', 'เริ่ม', 'สิ้นสุด', 'start', 'end'].map(key);

function findDocDate(lines: string[]): string {
  let fallback = '';
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const dates = findDates(line);
    const { k, m } = keyMap(line);
    for (const lab of DATE_LABELS) {
      const i = k.indexOf(lab);
      if (i < 0 || (isLatin(lab[0]) && isLatin(line[m[i] - 1]))) continue;
      const before = k.slice(Math.max(0, i - 12), i + lab.length + 10);
      if (DATE_NOT.some((x) => before.includes(x))) continue;
      const at = m[i];
      const d = dates.find((x) => x.s >= at) || (li + 1 < lines.length && !line.slice(at).match(/\d/) ? findDates(lines[li + 1])[0] : undefined);
      if (d) return d.iso;
    }
    if (!fallback && dates.length && !DATE_NOT.some((x) => k.includes(x))) fallback = dates[0].iso;
  }
  return fallback;
}

const PARTY_LABELS = [
  { k: key('ชื่อลูกค้า'), strong: true }, { k: key('นามลูกค้า'), strong: true }, { k: key('ลูกค้า'), strong: true },
  { k: key('customer name'), strong: true }, { k: key('customer'), strong: true }, { k: key('bill to'), strong: true },
  { k: key('billed to'), strong: true }, { k: key('sold to'), strong: true }, { k: key('invoice to'), strong: true },
  { k: key('ได้รับเงินจาก'), strong: true }, { k: key('received from'), strong: true }, { k: key('ผู้ว่าจ้าง'), strong: true }, { k: key('ผู้รับบริการ'), strong: true }, { k: key('ผู้ซื้อ'), strong: true },
  { k: key('เรียน'), strong: false }, { k: key('attention'), strong: false }, { k: key('attn'), strong: false },
].sort((a, b) => b.k.length - a.k.length);
const PARTY_NOT_BEFORE = ['รหัส', 'ลายมือชื่อ', 'ลงชื่อ', 'ผู้รับ', 'สำหรับ', 'signature'].map(key);
const PARTY_NOT_AFTER = ['no', 'id', 'code', 'รหัส', 'เลขที่', 'signature', 'ลงนาม'].map(key);
const PARTY_CUT = /\s{3,}|\s(?:เลขที่|วันที่|เลขประจำตัว|โทร|tel\.?|fax|date|no\.|tax\s?id|อ้างอิง|ref\.?|e-?mail|อีเมล)(?![A-Za-z])/i;
const COMPANY = /บริษัท|บจก|บมจ|ห้างหุ้นส่วน|หจก|จำกัด|มหาชน|co\.|ltd|limited|company|corporation|inc\b|public|องค์การ|กรม|มหาวิทยาลัย|โรงงาน|โรงพยาบาล|สำนักงาน|เทศบาล/i;

function cleanParty(s: string) {
  const t = s.replace(/^[\s:：\-–/|)]+/, '').split(PARTY_CUT)[0].replace(/[._…]{3,}.*$/, '').replace(/[\s,:;|/(-]+$/, '').replace(/\s+/g, ' ').trim();
  return (t.match(/[A-Za-z\u0E01-\u0E2E]/g) || []).length >= 3 ? t.slice(0, 120) : '';
}

function findParty(lines: string[]): string {
  let weak = '';
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const { k, m } = keyMap(line);
    for (const p of PARTY_LABELS) {
      const i = k.indexOf(p.k);
      if (i < 0) continue;
      const e = i + p.k.length;
      if (isLatin(p.k[0]) && isLatin(line[m[i] - 1])) continue;
      if (isLatin(p.k[p.k.length - 1]) && isLatin(line[endAt(line, m, e)])) continue;
      if (PARTY_NOT_BEFORE.some((r) => k.slice(Math.max(0, i - 10), i).endsWith(r))) continue;
      if (PARTY_NOT_AFTER.some((r) => k.slice(e).startsWith(r))) continue;
      const lineAt = (j: number) => (j < lines.length ? cleanParty(lines[j]) : '');
      let v = cleanParty(line.slice(endAt(line, m, e))), vi = li;
      if (!v && key(line).length <= p.k.length + 3) (v = lineAt(li + 1)), (vi = li + 1); // label alone on its line
      // "เรียน คุณสมชาย" ⏎ "บริษัท ... จำกัด": the company is the party
      const next = lineAt(vi + 1);
      if (v && !COMPANY.test(v) && next && COMPANY.test(next) && !/^\d/.test(next)) v = next;
      if (!v) continue;
      if (p.strong) return v;
      if (!weak) weak = v;
    }
  }
  return weak;
}

// ------------------------------------------------------------------ resolution

/** `w` = weight of the label's rule, `score` = w less pairing / number-shape penalties; `under` =
 *  printed totals a worked-out total must rank below */
interface Cand { f: Field | 'words' | 'derived' | 'largest'; w: number; value: number; score: number; label: string; line: string; li: number; under?: Cand[] }
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;
const r2 = (x: number) => Math.round(x * 100) / 100;
const vatTol = (base: number) => Math.max(0.06, Math.abs(base) * 0.0003);
const display = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

const EXCL_VAT = ['ยังไม่รวมภาษี', 'ไม่รวมภาษีมูลค่าเพิ่ม', 'ราคาไม่รวมvat', 'ไม่รวมvat', 'excludingvat', 'exclusiveofvat', 'vatexcluded', 'plusvat', '+vat'].map(key);
const WHT_RATES = [0.01, 0.015, 0.02, 0.03, 0.05, 0.1];

/** Rate printed next to a VAT / WHT label ("ภาษีมูลค่าเพิ่ม 7%"), as a fraction. */
function rateOn(line: string) {
  const m = /(\d{1,2}(?:[.,]\d{1,2})?)\s?%/.exec(line);
  const r = m ? parseFloat(m[1].replace(',', '.')) / 100 : NaN;
  return r > 0 && r <= 0.2 ? r : null;
}

type Amounts = Pick<DocFacts, 'total' | 'subtotal' | 'vat' | 'wht' | 'netPay' | 'words' | 'candidates' | 'confidence'> & { quality: number };

/** Lines analysed at most; longer texts (a 50-page PDF has 2,000+ lines) keep the first HEAD_LINES
 *  (title, number, date, customer) and the last PAGE_TAIL lines of each page, where totals sit —
 *  pages of a PDF text layer are separated by a blank line — the first and the last pages first. */
const MAX_LINES = 600, HEAD_LINES = 80, PAGE_TAIL = 40;
export function capLines(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines;
  const pages: [number, number][] = [];
  for (let i = 0; i < lines.length; ) {
    while (i < lines.length && !lines[i].trim()) i++;
    const s = i;
    while (i < lines.length && lines[i].trim()) i++;
    if (i > s) pages.push([s, i]);
  }
  const keep = new Uint8Array(lines.length);
  let n = 0;
  const take = (from: number, to: number) => {
    for (let i = from; i >= to && n < MAX_LINES; i--) if (!keep[i]) (keep[i] = 1), n++;
  };
  take(Math.min(HEAD_LINES, lines.length) - 1, 0);
  for (const [s, e] of pages.length ? [pages[0], ...pages.slice(1).reverse()] : []) take(e - 1, Math.max(s, e - PAGE_TAIL));
  take(lines.length - 1, 0); // budget left (a long text without page breaks): its end
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l);
    else if (out.length && out[out.length - 1] !== '') out.push(''); // a cut separates like a page break
  });
  return out;
}

/** A line longer than any printed one (a text layer without line breaks) is cut into pieces at
 *  spaces, so the per-line patterns stay fast. */
const MAX_LINE = 1000;
function splitLong(l: string): string[] {
  if (l.length <= MAX_LINE) return [l];
  const out: string[] = [];
  for (let i = 0; i < l.length; ) {
    let j = Math.min(l.length, i + MAX_LINE);
    const sp = j < l.length ? l.lastIndexOf(' ', j) : -1;
    if (sp > i + MAX_LINE / 2) j = sp;
    out.push(l.slice(i, j));
    i = j;
  }
  return out;
}

export function analyzeDocText(text: string): DocFacts {
  keyMemo = new Map();
  try {
    const raw = capLines(normalizeText(text).split('\n').flatMap(splitLong)).map((l) => fixOcrDigits(l.replace(/\s+$/, '')));
    const words = findWords(raw);
    const parsed = raw.map(parseLine);
    const a = amounts(parsed, raw, words, 'next'), b = amounts(parsed, raw, words, 'prev');
    const { quality: _q, ...best } = b.quality > a.quality + 1e-9 ? b : a;
    const docNo0 = findDocNo(raw, null);
    const kind = findKind(raw, docNo0);
    return { kind, docNo: kind ? findDocNo(raw, kind) : docNo0, docDate: findDocDate(raw), ...best, party: findParty(raw) };
  } finally {
    keyMemo = null;
  }
}

function amounts(parsed: Ln[], raw: string[], words: WordsHit[], order: 'next' | 'prev'): Amounts {
  // pairing marks labels and numbers as taken, so each order works on its own copy
  const lines = parsed.map((L) => ({ ...L, nums: L.nums.map((n) => ({ ...n })), labs: L.labs.map((l) => ({ ...l })) }));
  pairLabels(lines, order);

  const cands: Cand[] = [];
  let vatRate: number | null = null;
  for (const L of lines)
    for (const l of L.labs) {
      if (!l.val || l.f === 'ignore') continue;
      const vl = l.vli ?? L.i;
      const q = l.val.q;
      const score = l.w - l.pen - (q >= 3 ? 0 : q === 2 ? 2 : q === 1 ? 6 : 12) - (l.fuzzy ? 5 : 0);
      if (l.f === 'vat' && vatRate === null) vatRate = rateOn(L.raw);
      cands.push({ f: l.f, w: l.w, value: l.val.v, score, label: l.text, line: display(vl === L.i ? L.raw : `${L.raw} … ${lines[vl].raw}`), li: L.i });
    }
  const rate = vatRate ?? 0.07;
  const of = (...fs: Cand['f'][]) => cands.filter((c) => fs.includes(c.f));
  // a total or amount payable of 0 is a blank in a template ("Less Amount Paid 0.00", "หัก ณ ที่จ่าย 0.00")
  const T = of('total', 'sum', 'netPay').filter((c) => c.value > 0);
  const S = cands.filter((c) => c.f === 'subtotal' || c.f === 'sum' || (c.f === 'total' && c.w < 90));
  const V = of('vat');
  const W = of('wht').filter((c) => c.value > 0);
  const N = of('netPay').filter((c) => c.value > 0);
  const byScore = (cs: Cand[]) => [...cs].sort((a, b) => b.score - a.score)[0] as Cand | undefined;

  // a total that is not printed: subtotal + VAT. A printed grand total beats it — the sum of the
  // VAT-able items plus VAT leaves out non-VAT fees and VAT-exempt items — unless that "total" is
  // the subtotal it was worked out from ("ยอดรวมสุทธิ" before VAT)
  const printed = of('total').filter((t) => t.w >= 85 && t.value > 0);
  for (const s of S)
    for (const v of V)
      if (v.value > 0 && near(s.value * rate, v.value, vatTol(s.value)) && !T.some((t) => near(t.value, s.value + v.value)))
        T.push({ f: 'derived', w: 55, value: r2(s.value + v.value), score: 55, label: `${s.label} + ${v.label}`, line: s.line, li: Math.max(s.li, v.li), under: printed.filter((t) => !near(t.value, s.value)) });
  // the price says it excludes VAT and no VAT is printed: the total (else the subtotal) × 1.07 —
  // offered below a printed total, which may still be the figure the document means
  const exclVat = EXCL_VAT.some((x) => key(raw.join(' ')).includes(x));
  if (exclVat && !V.length) {
    const t = byScore(of('total').filter((c) => c.value > 0)), s = t || byScore(S);
    if (s) T.push({ f: 'derived', w: 50, value: r2(s.value * (1 + rate)), score: 50, label: `${s.label} + VAT ${Math.round(rate * 100)}%`, line: s.line, li: s.li, under: t ? [t] : undefined });
  }
  const byValue = (ws: WordsHit[]) => [...ws].sort((a, b) => b.v - a.v)[0];
  const wordsBest = words.find((w) => T.some((t) => near(t.value, w.v))) || byValue(words.filter((w) => w.sure)) || byValue(words);
  if (wordsBest) T.push({ f: 'words', w: 62, value: wordsBest.v, score: wordsBest.sure ? 62 : 40, label: 'จำนวนเงินตัวอักษร', line: display(raw[wordsBest.li]), li: wordsBest.li });

  // fallback: the largest amount-looking numbers anywhere
  const all = lines.flatMap((L) => L.nums.filter((n) => !n.qty && !n.ign && n.q >= 2 && n.v > 0 && n.v < 1e10).map((n) => ({ n, L })));
  const largest = [...new Map(all.sort((a, b) => b.n.v - a.n.v).map((x) => [x.n.v, x])).values()].slice(0, 3);
  largest.forEach(({ n, L }, i) => T.push({ f: 'largest', w: 0, value: n.v, score: [25, 15, 10][i], label: 'ตัวเลขที่มากที่สุดในเอกสาร', line: display(L.raw), li: L.i }));

  // pick the total: label strength + how well it agrees with subtotal / VAT / words / WHT
  interface Link { s?: Cand; v?: Cand; sub?: number; vat?: number }
  const n = lines.length || 1;
  type Scored = { t: Cand; final: number; link: Link | null; checked: boolean };
  const scored: Scored[] = [];
  const finals = new Map<Cand, number>();
  for (const t of T) {
    let bonus = 0, link: Link | null = null;
    if (t.f !== 'largest') {
      for (const v of V) {
        const sub = r2(t.value - v.value);
        if (sub <= 0 || !near(sub * rate, v.value, vatTol(sub))) continue;
        const s = S.find((x) => x !== t && near(x.value, sub));
        const b = s ? 35 + 0.15 * s.score + 0.1 * v.score : 25 + 0.1 * v.score;
        if (b > bonus) (bonus = b), (link = { s, v, sub, vat: v.value });
      }
      if (!link)
        for (const s of S) {
          if (s === t || !near(s.value * (1 + rate), t.value, vatTol(t.value))) continue;
          const b = 22 + 0.1 * s.score;
          if (b > bonus) (bonus = b), (link = { s, sub: s.value, vat: r2(t.value - s.value) });
        }
      // VAT-exempt: an explicit zero VAT with the same amount before and after
      if (!link && V.some((v) => v.value === 0) && S.some((s) => s !== t && near(s.value, t.value))) (bonus = 15), (link = { sub: t.value, vat: 0 });
    }
    const wordsOk = !!wordsBest && t.f !== 'words' && near(wordsBest.v, t.value);
    const whtOk = W.some((w) => N.some((x) => x !== t && near(t.value - w.value, x.value, 0.02)));
    const final = t.score + bonus + (wordsOk ? 20 : 0) + (whtOk ? 10 : 0) + (3 * t.li) / n - (t.f === 'netPay' && W.length ? 30 : 0) + (t.f === 'derived' && link ? -10 : 0);
    finals.set(t, final);
    const checked = (!!link && t.f !== 'derived') || wordsOk || whtOk;
    scored.push({ t, final, link, checked: checked && t.f !== 'largest' });
  }
  for (const x of scored)
    if (x.t.under?.length) finals.set(x.t, (x.final = Math.min(x.final, Math.max(...x.t.under.map((u) => finals.get(u) ?? u.score)) - 1)));
  let best: Scored | null = null;
  for (const x of scored) if (!best || x.final > best.final + 1e-9 || (near(x.final, best.final, 1e-9) && x.t.value > best.t.value)) best = x;

  const total = best ? best.t.value : null;
  // baht text that contradicts a total the VAT arithmetic confirms is an OCR misread: offer it last
  if (best?.link && wordsBest && !near(wordsBest.v, best.t.value))
    for (const [c, v] of finals) if (c.f === 'words') finals.set(c, Math.min(v, 20));
  let subtotal: number | null = null, vat: number | null = null;
  if (best?.link) {
    subtotal = best.link.sub ?? null;
    vat = best.link.vat ?? null;
  } else {
    const v = byScore(V), subs = of('subtotal');
    if (v) vat = v.value;
    if (total !== null && vat !== null && total > vat) {
      // the total less VAT — VAT-exempt items and non-VAT fees included — as printed when it is
      const d = r2(total - vat);
      subtotal = subs.find((x) => near(x.value, d))?.value ?? d;
    } else subtotal = byScore(subs)?.value ?? null;
    if (best?.t.f === 'derived' && exclVat && !v && subtotal === null) {
      subtotal = byScore(S)?.value ?? null;
      if (subtotal !== null && total !== null) vat = r2(total - subtotal);
    }
  }

  // withholding tax and the amount payable after it
  let wht: number | null = null, netPay: number | null = null;
  const sub0 = subtotal;
  const wBest = W.filter((w) => total === null || w.value < total).sort((a, b) => {
    const ok = (w: Cand) => (total !== null && N.some((x) => near(total - w.value, x.value, 0.02)) ? 20 : 0) + (sub0 !== null && WHT_RATES.some((r) => near(sub0 * r, w.value, vatTol(sub0 * r))) ? 10 : 0);
    return b.score + ok(b) - (a.score + ok(a));
  })[0];
  if (wBest) wht = wBest.value;
  const wht0 = wht;
  const nBest = [...N].sort((a, b) => {
    const ok = (x: Cand) => (total !== null && wht0 !== null && near(total - wht0, x.value, 0.02) ? 20 : 0) + (wht0 === null && total !== null && near(total, x.value) ? 10 : 0);
    return b.score + ok(b) - (a.score + ok(a));
  })[0];
  if (nBest && !(best?.t === nBest && wht !== null)) netPay = nBest.value;
  if (wht !== null && total !== null && (netPay === null || near(netPay, total))) netPay = r2(total - wht);
  if (wht === null && netPay !== null && total !== null && netPay < total && sub0 !== null) {
    const d = r2(total - netPay);
    if (WHT_RATES.some((r) => near(sub0 * r, d, vatTol(sub0 * r)))) wht = d;
  }

  // confidence: a labelled total that something else confirms is high
  let confidence: DocFacts['confidence'] = 'low';
  if (best && best.t.f !== 'largest') {
    const b = best;
    const strongOthers = of('total').filter((c) => c.score >= 80 && c.value > 0 && !near(c.value, b.t.value) && c.value !== subtotal && c.value !== netPay);
    // a weak label ("Total", "รวม") still counts when it is the only labelled amount offered as a total
    const alone = !T.some((c) => (c.f === 'total' || c.f === 'sum' || c.f === 'netPay') && !near(c.value, b.t.value));
    if (best.checked && best.t.f !== 'words' && !strongOthers.length) confidence = 'high';
    else if (best.checked || best.t.f === 'words' || best.t.f === 'derived' || best.t.score >= 60 || alone) confidence = 'medium';
    if (confidence === 'medium' && strongOthers.length && !best.checked) confidence = 'low';
  }

  // candidates: every amount the user may want, one per value, best first
  const src = (c: Cand): AmountCandidate['source'] => (c.f === 'words' ? 'words' : c.f === 'derived' ? 'vat' : c.f === 'largest' ? 'largest' : 'keyword');
  const pool: AmountCandidate[] = [
    ...T.map((c) => ({ c, score: finals.get(c) ?? c.score })),
    // other amounts rank below every total: the price before VAT first (often what a deal is worth)
    ...cands.filter((c) => !T.includes(c)).map((c) => ({ c, score: c.score * (c.f === 'subtotal' ? 0.6 : c.f === 'deposit' || c.f === 'discount' ? 0.3 : 0.45) })),
  ]
    .filter(({ c }) => c.value > 0)
    .map(({ c, score }) => ({ value: c.value, label: c.label, source: src(c), score: Math.max(0, Math.min(100, Math.round(score))), line: c.line }))
    .sort((a, b) => b.score - a.score || b.value - a.value);
  if (best) {
    // the chosen total leads even when clamping to 100 tied it with another value
    const v = best.t.value, i = pool.findIndex((p) => p.value === v);
    if (i > 0) {
      const [c] = pool.splice(i, 1);
      pool.unshift({ ...c, score: Math.max(c.score, pool[0].score) });
    }
  }
  const seen = new Set<number>();
  const candidates = pool.filter((p) => !seen.has(p.value) && seen.add(p.value));

  return {
    total,
    subtotal,
    vat,
    wht,
    netPay,
    words: wordsBest ? wordsBest.v : null,
    candidates,
    confidence,
    quality: best ? best.final + (best.checked ? 30 : 0) : 0,
  };
}

/** How completely a document was read, 0–100 (100 = a confirmed total): used to pick between OCR
 *  passes (docText.ts). Short of a confirmed total, more of the money fields found counts more. */
export function factsScore(f: DocFacts): number {
  if (f.total != null && f.confidence === 'high') return 100;
  const found = [f.subtotal, f.vat, f.wht, f.netPay, f.words].filter((x) => x != null).length + (f.docNo ? 1 : 0) + (f.docDate ? 1 : 0);
  return Math.min(95, (f.total != null ? 40 : 0) + (f.confidence === 'medium' ? 10 : 0) + 5 * found);
}
