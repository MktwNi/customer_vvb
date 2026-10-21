/**
 * One person, several companies (lib/people.ts PCo: person/<pid>/co/<gid>), records found to be the same human
 * merged into one (person/<gone>/into/<keep>), and the duplicate checks: the records, how they are shared (and how
 * the builds that do not know them skip them), and the helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  aliasIndex, coKey, coRecOf, cosOf, dupPairs, findExisting, foundWhy, intoKey, isMobile, linkIndex, mergePlan, nameWords, pairKey, pcoValue,
  peopleCsv, personIdOf, personKey, personSuggestions, reachPatch, toPCo, toPerson, type PCo, type PLink,
} from './people';
import { applyRow, keyOf, localRecords, noEffects, rebaseOp, type SharedState } from './teamSync';
import { emptySales, newDeal } from './sales';
import type { Person } from './types';

const P = (id: string, o: Partial<Person> = {}) => toPerson({ name: 'คุณ ' + id, gid: 7, at: '2026-09-01T03:00:00.000Z', ...o }, id)!;
const T = (n: number) => new Date(Date.UTC(2026, 9, 1, 3) + n * 60000).toISOString();
const C = (n: number, o: Partial<PCo> = {}): PCo => ({ on: 1, st: 'active', pos: '', dept: '', role: '', at: T(n), by: 'เอ', upAt: T(n), upBy: 'เอ', o: 0, ...o });
const L = (n: number, on: 0 | 1 = 1): PLink => ({ on, at: T(n), by: 'เอ', o: n });
const state = (): SharedState => ({ crm: { stages: {}, notes: {}, tasks: [], log: {}, owners: {}, watch: [], team: [] }, contacts: {}, dec: {}, sales: emptySales(), custom: {}, people: {} });

describe('the records', () => {
  it('person/<pid>/co/<gid> is one more company, person/<gone>/into/<keep> a merge; anything else under person/ stays nothing', () => {
    expect(keyOf.pco('p1', 26)).toBe('person/p1/co/26');
    expect(keyOf.pinto('p2', 'p1')).toBe('person/p2/into/p1');
    expect('person/' + coKey('p1', 26)).toBe(keyOf.pco('p1', 26));
    expect('person/' + intoKey('p2', 'p1')).toBe(keyOf.pinto('p2', 'p1'));
    expect(personKey('p1/co/26')).toEqual({ pid: 'p1', co: 26 });
    expect(personKey('p1/co/1000000000123')).toEqual({ pid: 'p1', co: 1000000000123 });
    expect(personKey('p2/into/p1')).toEqual({ pid: 'p2', into: 'p1' });
    // (unchanged: a person, a deal link)
    expect(personKey('p1')).toEqual({ pid: 'p1' });
    expect(personKey('p1/d1')).toEqual({ pid: 'p1', deal: 'd1' });
    expect([personKey('p1/co/x'), personKey('p1/co/'), personKey('p1/co/-3'), personKey('p1/into/p1'), personKey('p1/into/'), personKey('p1/x/2'), personKey('p1/co/2/3')]).toEqual([null, null, null, null, null, null, null]);
    // neither is a person (a deletion of one never cascades as a person's)
    expect([personIdOf('person/p1/co/26'), personIdOf('person/p2/into/p1')]).toEqual(['', '']);
  });

  it('a company record is read defensively; it is written without a name or an order', () => {
    expect(toPCo(null)).toBeNull();
    expect(toPCo('x')).toBeNull();
    expect(toPCo([1])).toBeNull();
    const c = toPCo({ on: 1, st: 'gone', pos: 'x'.repeat(400), role: 'boss', at: T(1), by: 'เอ', name: 'คุณอื่น' })!;
    expect(c).toMatchObject({ on: 1, st: 'active', role: '', upAt: T(1), upBy: 'เอ', o: 0 });
    expect(c.pos.length).toBe(200);
    expect('name' in c).toBe(false);
    expect(toPCo({ on: 1, st: 'left', pos: 'ที่ปรึกษา', role: 'influencer', at: T(1), upAt: T(5) })).toMatchObject({ st: 'left', pos: 'ที่ปรึกษา', role: 'influencer', upAt: T(5) });
    expect(toPCo({ at: T(1) })!.on).toBe(0);
    const v = pcoValue(C(1, { pos: 'ที่ปรึกษา' }));
    expect(v).toEqual({ on: 1, st: 'active', pos: 'ที่ปรึกษา', dept: '', role: '', at: T(1), by: 'เอ', upAt: T(1), upBy: 'เอ' });
    expect('name' in v || 'o' in v).toBe(false);
  });

  it('every older build skips both: the build before deal links reads them as a person without a name; ab2bb50 as no key it knows', () => {
    // 3e4deab's applyRow for person/: `const p = toPerson(row.v, rest); if (!p) return;`
    expect(toPerson(pcoValue(C(1, { pos: 'ที่ปรึกษา' })), 'p1/co/26')).toBeNull();
    expect(toPerson({ on: 1, at: T(1), by: 'เอ' }, 'p2/into/p1')).toBeNull();
    // ab2bb50's personKey: one part a person, two a deal link, anything else null (the row is skipped)
    const ab2bb50 = (rest: string) => {
      const p = rest.split('/');
      if (!p[0]) return null;
      if (p.length === 1) return { pid: p[0] };
      return p.length === 2 && p[1] ? { pid: p[0], deal: p[1] } : null;
    };
    expect([ab2bb50('p1/co/26'), ab2bb50('p2/into/p1')]).toEqual([null, null]);
  });

  it('pulled rows go to the links map (a company record checked as one), a malformed one is skipped; they are uploaded like any record', () => {
    const s = state(), fx = noEffects();
    applyRow(s, { seq: 1, k: 'person/p1', v: { name: 'คุณเอ', gid: 7 }, del: false, by: 'A', at: '' }, fx);
    applyRow(s, { seq: 2, k: 'person/p1/co/26', v: pcoValue(C(1, { pos: 'ที่ปรึกษา' })), del: false, by: 'A', at: '' }, fx);
    applyRow(s, { seq: 3, k: 'person/p2/into/p1', v: { on: 1, at: T(2), by: 'A' }, del: false, by: 'A', at: '' }, fx);
    applyRow(s, { seq: 4, k: 'person/p1/co/x', v: pcoValue(C(1)), del: false, by: 'A', at: '' }, fx);
    applyRow(s, { seq: 5, k: 'person/p1/co/27', v: 'junk', del: false, by: 'A', at: '' }, fx);
    expect(Object.keys(s.people!)).toEqual(['p1']);
    expect(Object.keys(s.plinks!).sort()).toEqual(['p1/co/26', 'p2/into/p1']);
    expect(s.plinks!['p1/co/26']).toMatchObject({ pos: 'ที่ปรึกษา', st: 'active', on: 1 });
    const m = localRecords(s);
    expect(m.get('person/p1/co/26')).toEqual(pcoValue(C(1, { pos: 'ที่ปรึกษา' })));
    expect(m.get('person/p2/into/p1')).toMatchObject({ on: 1 });
    // no deal comes out of them
    expect([...linkIndex(s.plinks!).byDeal.keys()]).toEqual([]);
  });

  it('two people changing one company record at once both keep their change (field-wise, like a person)', () => {
    const op = { k: 'person/p1/co/26', v: pcoValue(C(1, { pos: 'ที่ปรึกษาโครงการ' })), f: ['pos', 'upAt', 'upBy'], id: 'x', t: 1 };
    const r = rebaseOp({ seq: 9, k: 'person/p1/co/26', v: pcoValue(C(2, { st: 'left' })), del: false, by: 'B', at: '' }, op) as { v: Record<string, unknown> };
    expect(r.v).toMatchObject({ pos: 'ที่ปรึกษาโครงการ', st: 'left' });
  });
});

describe('a person\'s companies', () => {
  const p = P('p1', { gid: 7, company: 'บริษัท หลัก จำกัด', pos: 'ที่ปรึกษาโครงการ' });
  it('the main one first (from the person record), then the others in the order added; merged ids collapse, the newest record wins', () => {
    const canon = (g: number) => (g === 31 ? 30 : g);
    const cos = cosOf(p, [
      ['p1/co/40', C(5, { pos: 'ที่ปรึกษา' })],
      ['p1/co/30', C(1, { pos: 'เก่า' })],
      ['p1/co/31', C(2, { pos: 'ใหม่', upAt: T(9) })], // the same company merged: the newer wins
      ['p1/co/7', C(3)], // the main company: the person record says it
      ['p1/co/50', C(4, { on: 0 })], // taken off
      ['p1/co/60', C(6, { st: 'left' })], // left: kept
      ['p9/co/70', C(1)], // someone else's
      ['p1/d1', C(1)], // not a company record
    ], canon);
    expect(cos.map((x) => [x.gid, x.main, x.pos, x.st])).toEqual([
      [7, true, 'ที่ปรึกษาโครงการ', 'active'],
      [30, false, 'ใหม่', 'active'],
      [40, false, 'ที่ปรึกษา', 'active'],
      [60, false, '', 'left'],
    ]);
    expect(cos[1].key).toBe('p1/co/31');
    // a record taken off after it was on: off (the newest)
    expect(cosOf(p, [['p1/co/30', C(1)], ['p1/co/31', C(2, { on: 0 })]], canon).length).toBe(1);
    expect(coRecOf('p1', 30, [['p1/co/30', C(1)], ['p1/co/31', C(2, { on: 0 })]], canon)![0]).toBe('p1/co/31');
    expect(coRecOf('p1', 99, [['p1/co/30', C(1)]], canon)).toBeNull();
  });
  it('a person with a name typed as their company: that is their main one; with none at all, only the others', () => {
    expect(cosOf(P('p2', { gid: null, company: 'ร้านพิมพ์เอง' }), []).map((x) => [x.gid, x.company, x.main])).toEqual([[null, 'ร้านพิมพ์เอง', true]]);
    expect(cosOf(P('p3', { gid: null, company: '' }), [['p3/co/5', C(1)]]).map((x) => [x.gid, x.main])).toEqual([[5, false]]);
  });
});

describe('merged records', () => {
  it('a merge of a merge leads to the last one kept; one taken back is not; a loop keeps its smallest id', () => {
    const a = aliasIndex({ 'b/into/a': L(1), 'c/into/b': L(2), 'd/into/a': L(3, 0), 'p1/d1': L(1), 'p1/co/5': L(1) });
    expect([...a].sort()).toEqual([['b', 'a'], ['c', 'a']]);
    // two merges made at once, the other way round
    expect([...aliasIndex({ 'x/into/y': L(1), 'y/into/x': L(2) })]).toEqual([['y', 'x']]);
    // the newest record per person wins
    expect([...aliasIndex({ 'b/into/a': L(1), 'b/into/c': L(5) })]).toEqual([['b', 'c']]);
  });
});

describe('no duplicates', () => {
  const pw = P('pw', { name: 'ดร.พรวิมล ตัวอย่าง', gid: 7, phone: '080-000-0303', email: 'Pornwimon@example.com' });
  const nok = P('nok', { name: 'คุณนก', gid: 8, phone: '02-111-0000', email: 'info@example.com' });
  const nok2 = P('nok2', { name: 'คุณนก', gid: 9, phone: '02-111-0000 | 02-222-0000', email: 'info@example.com' });
  const vi = P('vi', { name: 'คุณวิภา ศรีสุข', gid: 7, phone: '081-234-5678' });
  const all = [pw, nok, nok2, vi];
  it('a mobile number, an e-mail nobody else has, or a full name: the person; a switchboard, a shared address or a one-word name never', () => {
    expect(isMobile('0800000303') && !isMobile('021110000') && isMobile('0912345678') && isMobile('0612345678')).toBe(true);
    expect(nameWords('ดร.พรวิมล ตัวอย่าง')).toBe(2);
    expect(nameWords('คุณนก')).toBe(1);
    expect(findExisting({ name: 'คุณพรวิมล', phone: '+66 80 000 0303', email: '' }, all).map((x) => [x.p.id, x.by])).toEqual([['pw', ['phone']]]);
    expect(findExisting({ name: '', phone: '', email: 'PORNWIMON@example.com' }, all).map((x) => [x.p.id, x.by])).toEqual([['pw', ['email']]]);
    expect(findExisting({ name: 'คุณพรวิมล ตัวอย่าง', phone: '', email: '' }, all).map((x) => [x.p.id, x.by])).toEqual([['pw', ['name']]]);
    // a switchboard two people share, an address two share, a one-word name
    expect(findExisting({ name: 'คุณนก', phone: '02-111-0000', email: 'info@example.com' }, all)).toEqual([]);
    // a landline only one person has counts; never the company's own number
    expect(findExisting({ name: '', phone: '02-222-0000', email: '' }, all).map((x) => x.p.id)).toEqual(['nok2']);
    expect(findExisting({ name: '', phone: '080-000-0303', email: '' }, all, () => false, ['0800000303'])).toEqual([]);
  });
  it('those who deal with the company already first; several are all returned', () => {
    const twin = P('pw2', { name: 'พรวิมล ตัวอย่าง', gid: 9 });
    const f = findExisting({ name: 'ดร. พรวิมล ตัวอย่าง', phone: '080-000-0303', email: '' }, [...all, twin], (p) => p.id === 'pw2');
    expect(f.map((x) => [x.p.id, x.here, x.by])).toEqual([['pw2', true, ['name']], ['pw', false, ['phone', 'name']]]);
    expect(foundWhy(['phone', 'name'])).toBe('เบอร์โทรและชื่อตรงกัน');
  });
  it('pairs that may be one human: a mobile or e-mail just the two have, or a full name; not a switchboard, not a pair said "ไม่ใช่"', () => {
    const pw2 = P('pw2', { name: 'พรวิมล ตัวอย่าง', gid: 9, phone: '0800000303' });
    const pairs = dupPairs([...all, pw2]);
    expect(pairs.map((x) => [x.key, x.by.sort()])).toEqual([[pairKey('pw', 'pw2'), ['name', 'phone']]]);
    expect(dupPairs([...all, pw2], [], new Set([pairKey('pw2', 'pw')]))).toEqual([]);
    expect(dupPairs([...all, pw2], ['0800000303']).map((x) => x.by)).toEqual([['name']]);
  });
  it('what a typed contact adds to the person: numbers and e-mails they lack, never one they have', () => {
    expect(reachPatch(pw, { phone: '0800000303 | 089-999-0000', email: 'pornwimon@EXAMPLE.com' })).toEqual({ phone: '080-000-0303 | 089-999-0000' });
    expect(reachPatch(pw, { phone: '', email: '' })).toEqual({});
  });
});

describe('merging two records', () => {
  it('phones, e-mails and LINE of both without repeats; a nickname or ผู้ดูแล only where empty; both notes; the companies of both', () => {
    const keep = P('k', { name: 'ดร.พรวิมล ตัวอย่าง', gid: 7, company: 'หลัก', pos: '', phone: '080-000-0303', email: 'a@example.com', line: 'pw.demo', owner: 'หมิว', note: 'ชอบ LINE' });
    const gone = P('g', { name: 'พรวิมล ตัวอย่าง', gid: 9, company: 'ดีไวน์', pos: 'ที่ปรึกษา', phone: '0800000303 | 089-999-0000', email: 'A@example.com | b@example.com', line: 'pw.demo', nick: 'วิม', owner: 'เอ', note: 'ที่ปรึกษาอิสระ', status: 'left' });
    const kc = cosOf(keep, [['k/co/8', C(1, { pos: '' })]]);
    const gc = cosOf(gone, [['g/co/8', C(1, { pos: 'ที่ปรึกษาด้าน CFO' })], ['g/co/7', C(2, { pos: 'ที่ปรึกษาโครงการ' })]]);
    const plan = mergePlan(keep, gone, kc, gc);
    expect(plan.patch).toEqual({ phone: '080-000-0303 | 089-999-0000', email: 'a@example.com | b@example.com', nick: 'วิม', note: 'ชอบ LINE\n\nที่ปรึกษาอิสระ', pos: 'ที่ปรึกษาโครงการ' });
    expect(plan.cos).toEqual([
      { gid: 9, pos: 'ที่ปรึกษา', dept: '', role: '', st: 'left' },
      { gid: 8, pos: 'ที่ปรึกษาด้าน CFO', dept: '', role: '', st: 'active', fill: true },
    ]);
    expect(plan.typedCo).toBe('');
  });
  it('a kept person without a company gets the other\'s main one; a company only typed by name is said, not lost silently', () => {
    const keep = P('k', { gid: null, company: '' });
    const gone = P('g', { gid: 9, company: 'ดีไวน์', pos: 'ที่ปรึกษา' });
    expect(mergePlan(keep, gone, cosOf(keep, []), cosOf(gone, [['g/co/8', C(1)]]))).toMatchObject({ patch: { gid: 9, company: 'ดีไวน์', pos: 'ที่ปรึกษา' }, cos: [{ gid: 8 }] });
    const typed = P('t', { gid: null, company: 'ร้านพิมพ์เอง' });
    expect(mergePlan(P('k2'), typed, cosOf(P('k2'), []), cosOf(typed, [])).typedCo).toBe('ร้านพิมพ์เอง');
  });
});

describe('suggestions and the CSV', () => {
  it('someone known at another company of theirs is not suggested; one surely at another company is said as `same`', () => {
    const pw = P('pw', { name: 'ดร.พรวิมล ตัวอย่าง', gid: 7, phone: '080-000-0303' });
    const d1 = newDeal({ id: 'd1', client: 'ดีไวน์', gid: 26, contactName: 'คุณพรวิมล ตัวอย่าง' }, 'เอ');
    const d2 = newDeal({ id: 'd2', client: 'ซากิ', gid: 27, contactName: 'คุณวิม', phone: '0800000303' }, 'เอ');
    const g = (x: number) => x;
    // known at 26 as one more company: not suggested there
    const s1 = personSuggestions([pw], [d1, d2], [], g, new Set(), (x) => [x], () => false, { cos: () => [26], live: [pw] });
    expect(s1.map((x) => [x.gid, x.name, x.same?.id])).toEqual([[27, 'คุณวิม', 'pw']]);
    // without it: both, each the same person elsewhere
    const s2 = personSuggestions([pw], [d1, d2], [], g, new Set(), (x) => [x], () => false, { live: [pw] });
    expect(s2.map((x) => x.same?.id)).toEqual(['pw', 'pw']);
  });
  it('one row per person, their other companies in one cell; a phone Excel keeps as written', () => {
    const p = P('pw', { name: 'ดร.พรวิมล ตัวอย่าง', phone: '080-000-0303', email: 'p@example.com', owner: 'หมิว' });
    const csv = peopleCsv([{ p, cos: [{ name: 'หลัก', pos: 'ที่ปรึกษาโครงการ', main: true, st: 'active' }, { name: 'ซากิ', pos: 'ที่ปรึกษาด้าน CFO', main: false, st: 'active' }, { name: 'ฝาจีบ', pos: '', main: false, st: 'left' }], last: '5 วันก่อน', next: '', active: true }]);
    const [head, row] = csv.split('\r\n');
    expect(head.split(',')[4]).toBe('"บริษัทอื่นที่ติดต่อด้วย"');
    expect(row).toContain('"หลัก","ที่ปรึกษาโครงการ","ซากิ (ที่ปรึกษาด้าน CFO) | ฝาจีบ (ไม่อยู่แล้ว)","=""080-000-0303""","p@example.com"');
    expect(row).toContain('"ยังติดต่อได้"');
  });
});
