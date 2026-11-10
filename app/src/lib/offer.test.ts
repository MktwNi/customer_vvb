import { describe, expect, it } from 'vitest';
import { OFFER_RESULT, OFFER_TEXT, OFFER_TYPE, offerNote, offerOf } from './offer';
import type { LogEntry } from './types';

const L = (at: string, type: string, result?: string, text = ''): LogEntry => ({ at, by: 'ทดสอบ', type, result, text });

describe('เสนอบริการ: the offer a company is still waiting on', () => {
  it('the offer is an e-mail entry whose result waits for a reply, with its own text', () => {
    expect([OFFER_TYPE, OFFER_RESULT, OFFER_TEXT]).toEqual(['email', 'รอติดต่อกลับ', 'เสนอบริการงานทวนสอบผ่านอีเมล']);
  });
  it('the latest contact decides: an offer that nothing after it answered is the company\'s offer', () => {
    const o = L('2026-11-10T03:00:00Z', OFFER_TYPE, OFFER_RESULT, OFFER_TEXT);
    expect(offerOf([L('2026-11-01T03:00:00Z', 'call', 'ติดต่อได้'), o])).toBe(o);
  });
  it('a later contact with another result ends the wait; a later note does not', () => {
    const o = L('2026-11-10T03:00:00Z', OFFER_TYPE, OFFER_RESULT);
    expect(offerOf([o, L('2026-11-11T03:00:00Z', 'call', 'ติดต่อได้')])).toBeNull();
    expect(offerOf([o, L('2026-11-12T03:00:00Z', 'note', undefined, 'โน้ต')])).toBe(o);
  });
  it('a stage or owner change is not a contact, and nothing logged is no offer', () => {
    expect(offerOf([L('2026-11-10T03:00:00Z', 'stage', undefined, 'เปลี่ยนสถานะ')])).toBeNull();
    expect(offerOf(undefined)).toBeNull();
    expect(offerOf([])).toBeNull();
  });
  it('the words the bar says after it is written', () => {
    expect(offerNote(3)).toBe('เสนอบริการ 3 บริษัทแล้ว บันทึกเป็นอีเมล ผลรอติดต่อกลับ');
  });
});
