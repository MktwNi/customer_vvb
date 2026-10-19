import { describe, expect, it } from 'vitest';
import { CUST_COLOR_V, CUST_PAL, ccVars, custColor, custKey, dealKey, homeSlot, slotOf, type CustLookup } from './custColor';
import { ckeyOfCompany, ckeyOfDeal, localId, nameKey, validCKey } from './ckey';
import { CUSTOM_ID_MIN, isLocalId } from './teamSync';

/** A registry of three companies; 7 was merged into 26 (its alias). */
const CO: Record<number, { id: number; name: string }> = {
  26: { id: 26, name: 'บริษัท ซากิโนมิยะ ประเทศไทย จำกัด' },
  41: { id: 41, name: 'บริษัท ดูราฟลอร์ จำกัด' },
  // a company from the TGO website sync: its id differs on each device
  900123: { id: 900123, name: 'บริษัท ลำปาง เซรามิก จำกัด' },
  // one added by hand (shared id)
  [CUSTOM_ID_MIN + 5]: { id: CUSTOM_ID_MIN + 5, name: 'บริษัท สยามคราฟท์อุตสาหกรรม จำกัด' },
};
const ALIAS: Record<number, number> = { 7: 26 };
const E: CustLookup = {
  company: (id) => CO[ALIAS[id] ?? id],
  canonical: (id) => ALIAS[id] ?? id,
};

// WCAG relative luminance and contrast
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// hue in degrees (HSL)
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('customer colours: the palette', () => {
  it('is the frozen, validated order of version 1 (reordering recolours every customer)', () => {
    expect(CUST_COLOR_V).toBe(1);
    expect(CUST_PAL.map((p) => p.c)).toEqual(['#B04E90', '#17A1C8', '#4A488D', '#089487', '#805EBD', '#D97298', '#3065BE', '#7A2C7E', '#8C87E8', '#00769D']);
    expect(CUST_PAL.map((p) => p.name)).toEqual(['บานเย็น', 'ฟ้า', 'คราม', 'น้ำทะเล', 'ม่วง', 'ชมพู', 'น้ำเงิน', 'ม่วงเข้ม', 'ม่วงอ่อน', 'ฟ้าเข้ม']);
    expect(Object.isFrozen(CUST_PAL) && CUST_PAL.every((p) => Object.isFrozen(p))).toBe(true);
  });
  it('is readable: every mark ≥ 3:1 on white, its monogram ≥ 4.5:1, ink on every tint ≥ 14:1', () => {
    for (const p of CUST_PAL) {
      expect(contrast(p.c, '#FFFFFF'), p.name).toBeGreaterThanOrEqual(3);
      expect(contrast(p.on, p.c), p.name).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#0E1430', p.bg), p.name).toBeGreaterThanOrEqual(14);
    }
  });
  it('has no status hue: no red, orange, amber, yellow or green', () => {
    // status marks sit at about 20° (late), 37° (due) and 142° (paid); the palette keeps 0–170° free except
    // the teal (174°), which reads as blue-green beside its name
    for (const p of CUST_PAL) {
      const h = hue(p.c);
      expect(h > 170 && h < 345, `${p.name} ${Math.round(h)}°`).toBe(true);
    }
  });
});

describe('customer colours: who a customer is', () => {
  it('a company is its primary id: a merged alias, a linked deal and the company give one key and one colour', () => {
    const k = custKey(E, 26, 'whatever the task says');
    expect(k).toBe('26');
    expect(custKey(E, 7, 'บริษัท ซากิโนมิยะ ประเทศไทย จำกัด')).toBe('26');
    expect(dealKey(E, { gid: 26, client: 'ซากิโนมิยะ (ชื่อในตาราง)' })).toBe('26');
    expect(dealKey(E, { gid: 7, client: 'ซากิ' })).toBe('26');
    expect(dealKey(E, { gid: 26, client: '' })).toBe(ckeyOfDeal({ gid: 26, client: '' }, CO[26]));
    expect(new Set([custKey(E, 26, ''), custKey(E, 7, ''), dealKey(E, { gid: 7, client: 'x' })].map((x) => slotOf(x))).size).toBe(1);
    // a company added by hand is shared by id too
    expect(custKey(E, CUSTOM_ID_MIN + 5, '')).toBe(String(CUSTOM_ID_MIN + 5));
  });
  it('a TGO-sync company (device-local id) and an unlinked client go by name, so every device agrees', () => {
    const k = custKey(E, 900123, 'บริษัท ลำปาง เซรามิก จำกัด');
    expect(k).toBe(nameKey('บริษัท ลำปาง เซรามิก จำกัด'));
    expect(k).toBe(ckeyOfCompany(CO[900123]));
    // the same customer typed on a deal with no company
    expect(dealKey(E, { gid: null, client: 'บริษัท ลำปาง เซรามิก จำกัด' })).toBe(k);
    expect(custKey(E, null, 'บจก. ลำปาง เซรามิก')).toBe(k);
    // a deal linked to the TGO-sync id (not shared) goes by its client's name too
    expect(dealKey(E, { gid: 900123, client: 'ลำปาง เซรามิก' })).toBe(k);
  });
  it('a company not loaded here keeps its shared id (as a deal does), a local one its name', () => {
    expect(custKey(E, 555, 'บริษัท ไม่มีในเครื่อง จำกัด')).toBe('555');
    expect(dealKey(E, { gid: 555, client: 'x' })).toBe('555');
    expect(custKey(E, 950000, 'บริษัท ไม่มีในเครื่อง จำกัด')).toBe(nameKey('ไม่มีในเครื่อง'));
  });
  it('never hashes "" for a name too short to be a key: it falls back to the title', () => {
    expect(nameKey('AB')).toBe('');
    const a = custKey(E, null, 'AB'), b = dealKey(E, { gid: null, client: ' AB ' }), c = custKey(E, null, 'XY');
    expect(a).toBe('t:AB');
    expect(b).toBe('t:AB');
    expect(c).toBe('t:XY');
    expect([a, b, c].every((k) => k !== '' && k !== 't:')).toBe(true);
  });
  it('the copy of the customer-types keys agrees with the team sync about device-local ids', () => {
    for (const id of [1, 899999, 900000, 123456789, CUSTOM_ID_MIN - 1, CUSTOM_ID_MIN, CUSTOM_ID_MIN + 1e9]) expect(localId(id), String(id)).toBe(isLocalId(id));
    expect(validCKey('26')).toBe(true);
    expect(validCKey('900123')).toBe(false);
    expect(validCKey(nameKey('ลำปาง เซรามิก'))).toBe(true);
    expect(validCKey('t:AB')).toBe(false);
  });
});

describe('customer colours: the home slot', () => {
  it('is stable: pinned for five keys (a change here recolours every customer)', () => {
    expect(['26', '41', '1000000000123', 'n:ซากิโนมิยะประเทศไทย', 't:AB'].map(homeSlot)).toEqual([5, 0, 8, 1, 0]);
    expect(homeSlot('26')).toBe(homeSlot('26'));
    expect(custColor('26')).toBe(CUST_PAL[5]);
    expect(ccVars('26')).toEqual({ '--c': CUST_PAL[5].c, '--cb': CUST_PAL[5].bg });
  });
  it('spreads customers evenly over the ten colours', () => {
    const n = Array(CUST_PAL.length).fill(0);
    for (let i = 1; i <= 5000; i++) n[homeSlot(String(i))]++;
    for (let i = 0; i < 3000; i++) n[homeSlot(nameKey('บริษัท ลูกค้า ' + i))]++;
    // 800 a slot on average
    expect(Math.min(...n)).toBeGreaterThan(700);
    expect(Math.max(...n)).toBeLessThan(900);
  });
  it('a valid override wins; an invalid one (out of range, not an integer, a bad key) is ignored', () => {
    expect(slotOf('26', { 26: 9 })).toBe(9);
    expect(slotOf('26', { 26: 0 })).toBe(0);
    expect(slotOf('26', { 26: 10 })).toBe(homeSlot('26'));
    expect(slotOf('26', { 26: -1 })).toBe(homeSlot('26'));
    expect(slotOf('26', { 26: 2.5 })).toBe(homeSlot('26'));
    expect(slotOf('26', { 26: '3' })).toBe(homeSlot('26'));
    expect(slotOf('t:AB', { 't:AB': 3 })).toBe(homeSlot('t:AB'));
    expect(slotOf('900123', { 900123: 3 })).toBe(homeSlot('900123'));
    expect(slotOf('41', { 26: 9 })).toBe(homeSlot('41'));
    expect(slotOf('toString', {})).toBe(homeSlot('toString'));
  });
});
