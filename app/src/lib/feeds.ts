import type { Company, Dicts, FeedKey } from './types';
import { fmtN, isoTh, money, ymTh } from './format';

/** One-line context shown next to a company in a tracking feed. */
export const feedMeta = (D: Dicts, k: FeedKey, c: Company) =>
  k === 'cfoSoon' ? `เหลือ ${fmtN(c.days)} วัน`
  : k === 'cfoExp' ? `หมด ${isoTh(c.cfoEx)}`
  : k === 'giSoon' ? `ระดับ ${c.giLive} · ${isoTh(c.giUntil)}`
  : k === 'giDown' ? `เคยได้ระดับ ${c.giMax} ตอนนี้ ${c.giLive || 'หมดอายุ'}`
  : k === 'newFac' ? `${ymTh(c.newYm)} · ${money(c.invest)}`
  : k === 'setNew' ? c.set
  : k === 'noContact' ? `กลุ่ม ${c.tgt + 1}`
  : D.prov[c.prov];
