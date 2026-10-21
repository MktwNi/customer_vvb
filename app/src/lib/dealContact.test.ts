/**
 * A deal's contact as a link to a person (lib/people.ts PLink): the record, how it is shared (and how a build
 * that does not know it skips it), and the helpers every screen reads a deal's contact through.
 */
import { describe, expect, it } from 'vitest';
import {
  actPeople, contactChoices, dealContact, linkIndex, linkOrder, linkedPeople, personIdOf, personKey, personSuggestions, sameContact, suggestionId, toPLink, toPerson,
  personExtras, typedAny, typedExtras, typedMatch, typedPerson, type PLink,
} from './people';
import { applyRow, keyOf, localRecords, noEffects, rebaseOp, type SharedState } from './teamSync';
import { filterDeals, newDeal, emptySales, type Deal } from './sales';
import { liveCount, monthCounts, trackerFields } from './salesUi';
import { planRows } from './planList';
import type { Person } from './types';

const P = (id: string, o: Partial<Person> = {}) => toPerson({ name: 'คุณ ' + id, gid: 7, ...o }, id)!;
const L = (o: number, on: 0 | 1 = 1): PLink => ({ on, at: new Date(o).toISOString(), by: 'เอ', o });
const deal = (o: Partial<Deal> = {}) => newDeal({ id: 'd1', client: 'บริษัท ตัวอย่าง จำกัด', gid: 7, ...o }, 'เอ');
const state = (): SharedState => ({ crm: { stages: {}, notes: {}, tasks: [], log: {}, owners: {}, watch: [], team: [] }, contacts: {}, dec: {}, sales: emptySales(), custom: {}, people: {} });

describe('the link record', () => {
  it('is read defensively: on only when said so, the order from `o` or else its time', () => {
    expect(toPLink(null)).toBeNull();
    expect(toPLink('x')).toBeNull();
    expect(toPLink([1])).toBeNull();
    expect(toPLink({ on: 1, at: '2026-10-21T03:00:00.000Z', by: 'เอ', o: 5 })).toEqual({ on: 1, at: '2026-10-21T03:00:00.000Z', by: 'เอ', o: 5 });
    expect(toPLink({ on: 0, at: '2026-10-21T03:00:00.000Z' })).toMatchObject({ on: 0, o: Date.parse('2026-10-21T03:00:00.000Z') });
    expect(toPLink({ at: 'x' })).toMatchObject({ on: 0, o: 0, by: '' });
    expect(toPLink({ on: true, o: '12' })!.o).toBe(12);
  });

  it('person/<pid>/<deal> is a link, person/<pid> a person; anything else under person/ is neither', () => {
    expect(keyOf.plink('p1', 'd1')).toBe('person/p1/d1');
    expect(personKey('p1')).toEqual({ pid: 'p1' });
    expect(personKey('p1/d1')).toEqual({ pid: 'p1', deal: 'd1' });
    expect([personKey(''), personKey('/d1'), personKey('p1/'), personKey('p1/d1/x')]).toEqual([null, null, null, null]);
    expect(personIdOf('person/p1')).toBe('p1');
    expect([personIdOf('person/p1/d1'), personIdOf('deal/p1'), personIdOf('person/')]).toEqual(['', '', '']);
  });

  it('a pulled link goes to the links, not the people; a malformed one is skipped; links are uploaded like any record', () => {
    const s = state(), fx = noEffects();
    applyRow(s, { seq: 1, k: 'person/p1', v: { name: 'คุณเอ', gid: 7 }, del: false, by: 'A', at: '' }, fx);
    applyRow(s, { seq: 2, k: 'person/p1/d1', v: L(10), del: false, by: 'A', at: '' }, fx);
    applyRow(s, { seq: 3, k: 'person/p1/d1/x', v: L(10), del: false, by: 'A', at: '' }, fx);
    applyRow(s, { seq: 4, k: 'person/p2/d1', v: 'junk', del: false, by: 'A', at: '' }, fx);
    expect(Object.keys(s.people!)).toEqual(['p1']);
    expect(s.plinks).toEqual({ 'p1/d1': L(10) });
    expect(fx.plinks && fx.people).toBe(true);
    const m = localRecords(s);
    expect(m.get('person/p1/d1')).toEqual(L(10));
    expect(m.has('person/p1')).toBe(true);
    // taken off: a whole record of its own with on 0 (a deletion, which nobody sends, is applied too)
    applyRow(s, { seq: 5, k: 'person/p1/d1', v: L(10, 0), del: false, by: 'B', at: '' }, fx);
    expect(s.plinks!['p1/d1'].on).toBe(0);
    applyRow(s, { seq: 6, k: 'person/p1/d1', v: null, del: true, by: 'B', at: '' }, fx);
    expect(s.plinks).toEqual({});
    expect(Object.keys(s.people!)).toEqual(['p1']);
  });

  it('a build before links reads one as a person without a name and skips it (toPerson, unchanged since origin/main)', () => {
    // origin/main's applyRow for person/: `const p = toPerson(row.v, rest); if (!p) return;`
    expect(toPerson(L(10), 'p1/d1')).toBeNull();
    expect(toPerson({ on: 1, at: '2026-10-21T03:00:00.000Z', by: 'หมิว', o: 1 }, 'sabc/d9')).toBeNull();
  });

  it('a queued link is a whole value: a teammate\'s row for it never merges into it (no rebase)', () => {
    const op = { k: 'person/p1/d1', v: L(20), id: 'x', t: 1 };
    expect(rebaseOp({ seq: 9, k: 'person/p1/d1', v: L(10, 0), del: false, by: 'B', at: '' }, op)).toBeNull();
  });
});

describe('a deal\'s contacts', () => {
  const people = { a: P('a'), b: P('b'), c: P('c') };
  it('the main contact is the first by `o`; links taken off and people deleted since are left out', () => {
    const ix = linkIndex({ 'b/d1': L(5), 'a/d1': L(9), 'c/d1': L(1, 0), 'zz/d1': L(0), 'a/d2': L(3), junk: L(1) });
    expect(linkedPeople(ix, 'd1', people).map((p) => p.id)).toEqual(['b', 'a']);
    expect(ix.byPerson.get('a')!.sort()).toEqual(['d1', 'd2']);
    expect(ix.byPerson.has('c')).toBe(false);
    expect(linkedPeople(ix, 'd3', people)).toEqual([]);
  });

  it('a new link goes last, or first in place of the main one', () => {
    expect(linkOrder([], false, 100)).toBe(100);
    expect(linkOrder([L(5), L(9)], false, 7)).toBe(10);
    expect(linkOrder([L(5), L(9)], false, 50)).toBe(50);
    expect(linkOrder([L(5), L(9)], true, 50)).toBe(4);
    expect(linkOrder([L(5, 0)], true, 50)).toBe(50);
  });

  it('shows the person\'s details; without a link, what was typed; a typed number only when it was typed for them', () => {
    const p = P('a', { name: 'ดร.วรรณา ตัวอย่าง', phone: '080-000-0101', email: 'wanna@example.com' });
    expect(dealContact(deal({ contactName: '', phone: '02-000-0000' }), [])).toMatchObject({ name: '', phone: '02-000-0000', person: null });
    expect(dealContact(deal({ contactName: 'คุณเก่า', phone: '02-000-0000' }), [p])).toMatchObject({ name: 'ดร.วรรณา ตัวอย่าง', phone: '080-000-0101', email: 'wanna@example.com', person: p });
    const bare = P('b', { name: 'คุณธนพล ใจกว้าง' });
    // their own number typed in the deal before they were recorded
    expect(dealContact(deal({ contactName: 'ธนพล ใจกว้าง', phone: '02-555-0000' }), [bare]).phone).toBe('02-555-0000');
    // a number typed for someone else is not theirs
    expect(dealContact(deal({ contactName: 'คุณสมศรี', phone: '02-555-0000' }), [bare]).phone).toBe('');
  });

  it('matches a typed contact by name first, then by a phone or e-mail that is not the company\'s', () => {
    const pool = [P('a', { name: 'คุณธนพล ใจกว้าง', phone: '02-555-1234' }), P('b', { name: 'คุณวิภา', phone: '081-111-1111', email: 'wipa@example.com' }), P('c', { name: 'คุณธนพล ใจกว้าง' })];
    const ids = (m: { list: Person[] }) => m.list.map((p) => p.id);
    expect(typedMatch(deal({ contactName: 'ธนพล ใจกว้าง', phone: '081-111-1111' }), pool)).toMatchObject({ by: 'name' });
    expect(ids(typedMatch(deal({ contactName: 'ธนพล ใจกว้าง', phone: '081-111-1111' }), pool))).toEqual(['a', 'c']);
    expect(typedMatch(deal({ contactName: 'คุณใครไม่รู้', phone: '0811111111' }), pool)).toMatchObject({ by: 'phone' });
    expect(ids(typedMatch(deal({ contactName: 'คุณใครไม่รู้', phone: '0811111111' }), pool))).toEqual(['b']);
    expect(typedMatch(deal({ contactName: '', phone: '', email: 'WIPA@example.com' }), pool)).toMatchObject({ by: 'email' });
    expect(typedMatch(deal({ contactName: 'คุณใหม่' }), pool)).toEqual({ by: '', list: [] });
    // the company's own number (a switchboard copied in when sent) is nobody's in particular
    expect(typedMatch(deal({ contactName: 'คุณใครไม่รู้', phone: '02-555-1234' }), pool, { phone: '025551234' })).toEqual({ by: '', list: [] });
    expect(sameContact({ name: 'Dr. Anna', phone: '', email: '' }, { name: 'anna', phone: '', email: '' })).toBe(true);
  });

  it('a link made without asking is never a guess: the typed name, or with no name typed a number of its own', () => {
    // (review R1: the company's one person shares the number typed for someone else)
    const one = [P('s', { name: 'คุณสมหญิง ทดลอง', phone: '02-555-1234' })];
    expect(typedPerson(deal({ contactName: 'คุณสมชาย ตัวอย่าง', phone: '02-555-1234' }), one)).toBeNull();
    expect(typedPerson(deal({ contactName: 'สมหญิง ทดลอง', phone: '' }), one)!.id).toBe('s');
    expect(typedPerson(deal({ contactName: '', phone: '02 555 1234' }), one)!.id).toBe('s');
    expect(typedPerson(deal({ contactName: '', phone: '02-555-1234' }), one, { phone: '02-555-1234' })).toBeNull();
    const two = [...one, P('t', { name: 'คุณสมหญิง ทดลอง' })];
    expect(typedPerson(deal({ contactName: 'คุณสมหญิง ทดลอง' }), two)).toBeNull();
    // anything typed: a name, or a number that is not the company's
    expect(typedAny(deal({ contactName: '', phone: '02-000-0001' }), { phone: '02-000-0001' })).toBe(false);
    expect(typedAny(deal({ contactName: '', phone: '081-000-0001' }), { phone: '02-000-0001' })).toBe(true);
    expect(typedAny(deal({ contactName: 'คุณเอ' }))).toBe(true);
  });

  it('what the deal holds for its contact that their record lacks: all of it while they have none (as the deal shows it)', () => {
    const co = { phone: '02-000-0001', email: '' };
    const d = deal({ contactName: '', phone: '02-000-0001 | 081-222-3333', email: 'x@example.com' });
    expect(personExtras(d, { phone: '', email: '' }, co)).toEqual({ phones: ['02-000-0001', '081-222-3333'], emails: ['x@example.com'] });
    expect(personExtras(d, { phone: '089-999-9999', email: 'x@example.com' }, co)).toEqual({ phones: ['081-222-3333'], emails: [] });
    // the deal panel's header shows the same number for them (dealContact)
    expect(dealContact(d, [P('a', { phone: '', email: '' })]).phone).toBe(d.phone);
  });

  it('typed numbers and e-mails the person and the company don\'t have yet', () => {
    const d = deal({ phone: '02-111-2222 | 081-333-4444', email: 'a@example.com, b@example.com' });
    expect(typedExtras(d, null, undefined)).toEqual({ phones: ['02-111-2222', '081-333-4444'], emails: ['a@example.com', 'b@example.com'] });
    expect(typedExtras(d, { phone: '+66 81 333 4444', email: 'A@example.com' }, { phone: '021112222', email: '' })).toEqual({ phones: [], emails: ['b@example.com'] });
  });

  it('offers the people still at the company, the decision maker first; "กับ" starts at the deal\'s contact', () => {
    const pool = [P('a', { name: 'คุณเอก', role: 'coordinator' }), P('b', { name: 'คุณวิภา', role: 'decision' }), P('c', { name: 'คุณนที', status: 'left' }), P('d', { name: 'คุณกร' })];
    expect(contactChoices(pool).map((p) => p.id)).toEqual(['b', 'a', 'd']);
    expect(contactChoices(pool, ['b']).map((p) => p.id)).toEqual(['a', 'd']);
    const w = actPeople([pool[3]], pool);
    expect(w.pid).toBe('d');
    expect(w.list.map((p) => p.id)).toEqual(['d', 'b', 'a']);
    expect(actPeople([], pool).pid).toBe('');
    // a contact at another company now (the deal linked to another company since) is listed, not the default
    expect(actPeople([pool[3], pool[0]], pool, (p) => p.id === 'd').pid).toBe('a');
    expect(actPeople([pool[3]], pool, () => true)).toMatchObject({ pid: '' });
  });

  it('a deal whose typed name is a person linked to it is no longer a People suggestion; the id a typed contact is saved under is the suggestion\'s', () => {
    const d = deal({ contactName: 'คุณสมชาย ใจดี' });
    const s = personSuggestions([], [d], [], (g) => g, new Set());
    expect(s.map((x) => x.id)).toEqual([suggestionId(7, d.client, d.contactName)]);
    expect(personSuggestions([], [d], [], (g) => g, new Set(), undefined, (x) => x.id === 'd1')).toEqual([]);
  });

  it('the table\'s search and the plan list read the linked person', () => {
    const S = emptySales();
    S.deals.d1 = { ...deal({ year: '2569' }), contactName: 'คุณเก่า' };
    const hay = (x: Deal) => (x.id === 'd1' ? 'ดร.วรรณา ตัวอย่าง 080-000-0101' : '');
    expect(filterDeals(S, { year: '2569', q: 'วรรณา' }, '2026-10-21')).toEqual([]);
    expect(filterDeals(S, { year: '2569', q: 'วรรณา' }, '2026-10-21', hay).map((x) => x.id)).toEqual(['d1']);
    const rows = planRows({ company: () => undefined, watch: [], tasks: [], owners: {}, stages: {}, sales: S, year: '2569', today: '2026-10-21', phoneOf: () => '080-000-0101' });
    expect(rows[0].phone).toBe('080-000-0101');
  });

  it('the filter menu\'s counts follow the search through the linked person, as the rows do (review R9)', () => {
    const S = emptySales();
    S.deals.d1 = { ...deal({ year: '2569', contactName: '', resp: 'หมิว' }), at: '2026-10-05T03:00:00.000Z' };
    const hay = (x: Deal) => (x.id === 'd1' ? 'ดร.พรทดลอง ตัวอย่าง' : '');
    const F = { year: '2569', q: 'พรทดลอง' };
    const today = '2026-10-21';
    expect(filterDeals(S, F, today, hay).length).toBe(1);
    const resp = (h?: typeof hay) => trackerFields(S, F, { yearDeals: [S.deals.d1], job: 'open', me: '', today, hay: h }).find((f) => f.key === 'resp')!.options.map((o) => [o.v, o.n]);
    expect(resp()).toEqual([['หมิว', 0]]);
    expect(resp(hay)).toEqual([['หมิว', 1]]);
    expect(liveCount(S, F, 'resp', { v: ['หมิว'] }, 'open', today, hay)).toBe(1);
    expect(liveCount(S, F, 'resp', { v: ['หมิว'] }, 'open', today)).toBe(0);
    const added = (h?: typeof hay) => monthCounts(S, F, 'added', 2026, 'open', today, h)[9];
    expect([added(hay), added()]).toEqual([1, 0]);
  });
});
