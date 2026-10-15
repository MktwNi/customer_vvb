import { describe, expect, it } from 'vitest';
import { avatarFill, coreName, monoSize, monogram } from './CoAvatar';
import { CUST_PAL, slotOf } from '../lib/custColor';

describe('avatar colours', () => {
  it('a customer (colored with its key) takes its plan colour and that colour\'s monogram text', () => {
    const p = CUST_PAL[slotOf('26')];
    expect(avatarFill('บริษัท ซากิโนมิยะ ประเทศไทย จำกัด', true, '26')).toEqual({ bg: p.c, fg: p.on });
    // the key decides, not how the name is written (a deal's client text and the registry name agree)
    expect(avatarFill('ซากิโนมิยะ', true, '26')).toEqual(avatarFill('บริษัท ซากิโนมิยะ ประเทศไทย จำกัด', true, '26'));
  });
  it('a person (the top seller: colored, no key) keeps the name swatch, white text, never the customer palette', () => {
    const f = avatarFill('หมิว', true);
    expect(f.fg).toBe('#fff');
    expect(CUST_PAL.map((x) => x.c)).not.toContain(f.bg);
    expect(avatarFill('หมิว', true)).toEqual(f);
  });
  it('is the light tint when not coloured, key or not', () => {
    expect(avatarFill('บริษัท ก จำกัด')).toEqual({ bg: 'var(--info-bg)' });
    expect(avatarFill('บริษัท ก จำกัด', false, '26')).toEqual({ bg: 'var(--info-bg)' });
  });
});

describe('company monograms', () => {
  it('drop legal words and personal titles before taking the letter', () => {
    expect(coreName('บริษัท ปูนซิเมนต์ไทย จำกัด (มหาชน)')).toBe('ปูนซิเมนต์ไทย');
    expect(monogram('บริษัท ปูนซิเมนต์ไทย จำกัด (มหาชน)')).toBe('ป');
    expect(monogram('ห้างหุ้นส่วนสามัญนิติบุคคล ซีซีเอสเอส เซอร์วิส')).toBe('ซ');
    expect(monogram('ห้างหุ้นส่วนจำกัด ทองดี')).toBe('ท');
    expect(monogram('นางสาวปริศนา อุดมรัตน์')).toBe('ป');
    expect(monogram('นาย จักรี ดอกไม้หอม')).toBe('จ');
    expect(monogram('บริษัท เอ็มอีพี เฮคซ่า (ประเทศไทย) จำกัด (สำนักงานใหญ่)')).toBe('อ');
  });
  it('use two initials for English names', () => {
    expect(monogram('Thai Nippon Steel Co., Ltd.')).toBe('TN');
    expect(monogram('SCG Packaging Public Company Limited')).toBe('SP');
  });
  it('show a SET symbol only when it fits whole (a cut symbol can be another company)', () => {
    expect(monogram('ธนาคารทหารไทยธนชาต จำกัด (มหาชน)', 'TTB')).toBe('TTB');
    expect(monogram('บริษัท ทีมพรีซิชั่น จำกัด (มหาชน)', 'TEAMG')).toBe('ท');
    expect(monogram('บริษัท สยามแม็คโคร จำกัด (มหาชน)', 'MAKRO')).toBe('ส');
  });
  it('letters on the type scale and never under 12px, at every avatar size the app uses', () => {
    const SCALE = [12, 13, 14, 16, 18, 24, 28, 40];
    for (const size of [24, 26, 28, 30, 32, 34, 36, 40, 44, 72, 92])
      for (const n of [1, 2, 3, 4]) expect(SCALE).toContain(monoSize(size, n));
    // the plan list's 28px bubble with a SET symbol (was 8px), the person page's 72px one (was 30px)
    expect([monoSize(28, 3), monoSize(36, 1), monoSize(44, 1), monoSize(72, 1)]).toEqual([12, 14, 18, 28]);
  });
  it('never returns an empty picture', () => {
    expect(monogram('บริษัท จำกัด')).not.toBe('');
    expect(monogram('')).toBe('•');
  });
});
