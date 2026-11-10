import { fmtN } from './format';
import type { LogEntry } from './types';

/**
 * เสนอบริการงานทวนสอบผ่านอีเมล: the offer the bar writes on each picked company. It is an e-mail entry whose
 * result waits for the company's reply (รอติดต่อกลับ). The app records it and sends no e-mail; the company's
 * plan stage (สถานะในแผนติดต่อ) stays as it is, the offer is not a sale step.
 */
export const OFFER_TYPE = 'email';
export const OFFER_RESULT = 'รอติดต่อกลับ';
export const OFFER_TEXT = 'เสนอบริการงานทวนสอบผ่านอีเมล';

/** The entry types a contact is made in (a note or a stage or owner change is not one). */
const CONTACT_TYPES = ['call', 'email', 'meet', 'follow'];

/**
 * The company's latest contact, when it is an offer still waiting for a reply: that entry, else null. A later
 * contact with another result (or a later note) decides the company is no longer waiting. Two entries written in
 * the same millisecond: the one written last (later in the list) is the later one.
 */
export function offerOf(logs: readonly LogEntry[] | undefined): LogEntry | null {
  let last: LogEntry | null = null;
  for (const l of logs || []) {
    if (!CONTACT_TYPES.includes(l.type) || !l.result) continue;
    if (!last || l.at >= last.at) last = l;
  }
  return last && last.result === OFFER_RESULT ? last : null;
}

/** What the bar says after the offer was written. */
export const offerNote = (n: number) => `เสนอบริการ ${fmtN(n)} บริษัทแล้ว บันทึกเป็นอีเมล ผลรอติดต่อกลับ`;
