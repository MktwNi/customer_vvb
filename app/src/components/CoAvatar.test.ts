import { describe, expect, it } from 'vitest';
import { coreName, monogram } from './CoAvatar';

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
  it('never returns an empty picture', () => {
    expect(monogram('บริษัท จำกัด')).not.toBe('');
    expect(monogram('')).toBe('•');
  });
});
