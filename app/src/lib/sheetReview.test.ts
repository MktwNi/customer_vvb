/**
 * The review list of certificate-sheet rows (lib/sheetReview.ts): the record a row that cannot be applied leaves, its reasons,
 * the stable id, the duplicates, and the reviewer's decisions. Synthetic data only.
 */
import { describe, expect, it } from 'vitest';
import type { CertFields, CertLine } from './registryXlsx';
import { decideReview, makeReview, REVIEW_REASONS, reviewDuplicate, reviewIdOf, toReviewRec } from './sheetReview';

const F = (o: Partial<CertFields> = {}): CertFields => ({
  cert: 'SR-1', org: 'บริษัท สิบ ทดสอบ จำกัด', branch: '', act: '', addr: '', zip: '', prov: '', ind: '', size: '', ap: '2025-01-01',
  ex: '2027-01-01', fy: '', s1: 0.6, s2: null, s3: null, note: '', webId: '', ...o,
});
const line = (o: Partial<CertFields> = {}, gcc = 'GCC-000010'): CertLine => ({
  rowNo: 4, f: F(o), errors: [], gcc, email: 'a@x.co', emailSt: 'พบ', vals: { 'เลขที่ใบรับรอง': 'SR-1', 'ชื่อองค์กร': 'บริษัท สิบ ทดสอบ จำกัด' },
});
const AT = '2026-10-27T00:00:00.000Z';
const LATER = '2026-10-28T00:00:00.000Z';

describe('the review record', () => {
  it('keeps the row: its values as the sheet gives them, the reason, the file and the time, waiting (p)', () => {
    const r = makeReview(line(), REVIEW_REASONS[0], 'file.xlsx', AT, 'ทดสอบ');
    expect(r).toMatchObject({
      reason: 'ไม่พบบริษัทในระบบ', cert: 'SR-1', org: 'บริษัท สิบ ทดสอบ จำกัด', gcc: 'GCC-000010', email: 'a@x.co', emailSt: 'พบ',
      file: 'file.xlsx', at: AT, by: 'ทดสอบ', st: 'p', co: null,
    });
    expect(r.vals['ชื่อองค์กร']).toBe('บริษัท สิบ ทดสอบ จำกัด');
    expect(r.f.cert).toBe('SR-1');
  });
  it('the reasons are the owner rules (R1, R3), in Thai', () => {
    expect([...REVIEW_REASONS]).toEqual([
      'ไม่พบบริษัทในระบบ', 'รหัส GCC ไม่พบในระบบ', 'พบบริษัทซ้ำ', 'รหัส GCC กับชื่อไม่ตรงกัน', 'รหัส GCC ไม่ตรงกับบริษัทของใบรับรองนี้',
    ]);
  });
  it('the id is stable: the certificate number, the organisation and the GCC code as written make it; any change of them makes another', () => {
    const id = reviewIdOf('SR-1', 'บริษัท สิบ ทดสอบ จำกัด', 'GCC-000010');
    expect(id).toMatch(/^r[0-9a-z]+$/);
    expect(reviewIdOf(' SR-1 ', 'บริษัท สิบ   ทดสอบ จำกัด ', 'GCC-000010')).toBe(id);
    expect(reviewIdOf('SR-2', 'บริษัท สิบ ทดสอบ จำกัด', 'GCC-000010')).not.toBe(id);
    expect(reviewIdOf('SR-1', 'บริษัท สิบเอ็ด ทดสอบ จำกัด', 'GCC-000010')).not.toBe(id);
    expect(reviewIdOf('SR-1', 'บริษัท สิบ ทดสอบ จำกัด', '')).not.toBe(id);
    // the reason does not change the record's identity: the same row is the same record whichever reason it was kept for
    expect(makeReview(line(), REVIEW_REASONS[1], 'b.xlsx', AT, 'ทดสอบ').id).toBe(id);
  });
  it('a duplicate: a waiting record means already in review, a rejected one declined before; an accepted one is no duplicate', () => {
    expect(reviewDuplicate('p')).toBe('already in review');
    expect(reviewDuplicate('r')).toBe('declined before');
    expect(reviewDuplicate('a')).toBeUndefined();
    expect(reviewDuplicate(undefined)).toBeUndefined();
  });
  it('accept needs a company that exists and is shared, and the required fields; it records the company and the decider', () => {
    const rec = makeReview(line(), REVIEW_REASONS[0], 'f.xlsx', AT, 'ทดสอบ');
    const shared = (id: number) => id === 77;
    expect(decideReview(rec, 'accept', { by: 'ผู้ตรวจ', at: LATER, attachable: shared })).toEqual({ msg: 'เลือกบริษัทที่มีในระบบก่อนรับ' });
    expect(decideReview(rec, 'accept', { co: 5, by: 'ผู้ตรวจ', at: LATER, attachable: shared })).toEqual({
      msg: 'บริษัทนี้ไม่มีในระบบ หรือเก็บไว้ในเครื่องนี้เท่านั้น รับเข้าไม่ได้',
    });
    expect(decideReview(rec, 'accept', { co: 77, by: 'ผู้ตรวจ', at: LATER, attachable: shared })).toMatchObject({
      rec: { st: 'a', co: 77, dBy: 'ผู้ตรวจ', dAt: LATER },
    });
    const noCert = makeReview(line({ cert: '' }), REVIEW_REASONS[0], 'f.xlsx', AT, 'ทดสอบ');
    expect(decideReview(noCert, 'accept', { co: 77, by: 'ผู้ตรวจ', at: LATER, attachable: shared })).toEqual({ msg: 'ต้องกรอก เลขที่ใบรับรอง' });
  });
  it('reject keeps the row as rejected; a decided record is not decided again', () => {
    const rec = makeReview(line(), REVIEW_REASONS[0], 'f.xlsx', AT, 'ทดสอบ');
    const rej = decideReview(rec, 'reject', { by: 'ผู้ตรวจ', at: LATER });
    expect(rej).toMatchObject({ rec: { st: 'r', co: null, dBy: 'ผู้ตรวจ' } });
    if (!('rec' in rej)) throw new Error('reject should decide');
    expect(decideReview(rej.rec, 'accept', { co: 77, by: 'x', at: LATER, attachable: () => true })).toEqual({ msg: 'รายการนี้ตัดสินไปแล้ว' });
    expect(decideReview(rej.rec, 'reject', { by: 'x', at: LATER })).toEqual({ msg: 'รายการนี้ตัดสินไปแล้ว' });
    const acc = decideReview(rec, 'accept', { co: 77, by: 'x', at: LATER, attachable: () => true });
    if (!('rec' in acc)) throw new Error('accept should decide');
    expect(decideReview(acc.rec, 'reject', { by: 'x', at: LATER })).toEqual({ msg: 'รายการนี้ตัดสินไปแล้ว' });
  });
  it('a record read back keeps its values; a value that is not a record is refused', () => {
    const rec = makeReview(line(), REVIEW_REASONS[0], 'f.xlsx', AT, 'ทดสอบ');
    expect(toReviewRec(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
    expect(toReviewRec({ id: 'x', st: 'z' })).toBeNull();
    expect(toReviewRec(null)).toBeNull();
    expect(toReviewRec({ id: 'r1', st: 'p', cert: 'C', org: 'O', f: 'bad' })).toBeNull();
  });
});
