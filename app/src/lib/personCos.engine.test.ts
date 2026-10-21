/**
 * One person, several companies (person/<pid>/co/<gid>, lib/people.ts PCo) and two records of one human merged into
 * one (person/<gone>/into/<keep>), in the engine, end to end with the real team script (team-sync/Code.gs in the
 * simulator): a consultant who deals with several companies is listed at each, offered in their deals with no
 * "another company" line, found again instead of recorded twice, merged; what a tab still on the older build
 * (cv 5) does to it; who may change it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN } from './caps';
import { actPeople, contactChoices, pcoValue, personKey, toPerson } from './people';
import { CV, type Role } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/pc/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));

// each browser has its own localStorage (prefs: peopleGone, the session)
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

const T0 = new Date('2026-10-21T03:00:00Z');
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 200);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Tab { e: GccEngine; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  vi.setSystemTime(T0);
});
/** A browser; `name`: who it is on a team-code team (accounts: the account's name). */
function mk(browser: string, name?: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-21';
  raw.store = memoryStore();
  if (name) (raw as unknown as { me: () => string }).me = () => name;
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => sim.post(body) as Record<string, unknown>;
  raw.transport = post;
  raw.fileTransport = post;
  const e = new Proxy(raw, {
    get(t, p) {
      cur = browser;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? (...a: unknown[]) => ((cur = browser), (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
    },
  });
  const tab = { e, browser };
  tabs.push(tab);
  return tab;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...ts: Tab[]) {
  for (let i = 0; i < 3; i++)
    for (const t of ts) {
      await t.e.teamSyncNow();
      await tick();
    }
}
/** Two people on a team-code team. */
async function team() {
  sim = createGasSim({ teamKey: KEY });
  const A = mk('A', 'เอ'), B = mk('B', 'บี');
  for (const t of [A, B]) expect(await t.e.teamConnect(URL, KEY)).toBe(true);
  return [A, B] as const;
}
const rows = (pre: string) => sim.post({ action: 'pull', key: KEY, since: 0, cv: CV }).rows!.filter((x) => x.k.startsWith(pre));
const last = (k: string) => rows(k).filter((r) => r.k === k).at(-1);
/** Registry companies each test may use (no deal, no person yet), one name each (an import links by name). */
function companies(t: Tab): Company[] {
  const n = new Map<string, number>();
  t.e.B.companies.forEach((c) => n.set(c.name.trim(), (n.get(c.name.trim()) || 0) + 1));
  return t.e.B.companies.filter((c) => n.get(c.name.trim()) === 1 && !t.e.dealsOf(c.id).length && !t.e.peopleOf(c.id).length);
}
const hist = (t: Tab, dealId: string) => Object.values(t.e.sales.log).filter((l) => l.deal === dealId).sort((a, b) => a.at.localeCompare(b.at));
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);
const actWith = (t: Tab, dealId: string) => {
  const d = t.e.sales.deals[dealId];
  return actPeople(t.e.dealPeople(d.id), t.e.dealPool(d), (p) => t.e.contactElsewhere(d, p));
};
const cosOf = (t: Tab, pid: string) => t.e.personCos(t.e.people[pid]).map((x) => [x.gid, x.main, x.pos, x.st]);
/** A third browser on the same team. */
async function third(name = 'ซี') {
  const C = mk('C', name);
  expect(await C.e.teamConnect(URL, KEY)).toBe(true);
  return C;
}
const file = (data: unknown, name = 'b.json') => Object.assign(new Blob([JSON.stringify(data)]), { name }) as File;

describe('one person, several companies', () => {
  it('the owner\'s case: a consultant is one record, listed at each company with their position there; their deals offer them with no "another company" line', async () => {
    const [A, B] = await team();
    const [c1, c2, c3] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, pos: 'ที่ปรึกษาโครงการ', phone: '080-000-0303' });
    expect(A.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษาด้าน CFO', role: 'influencer' })).toBe(true);
    expect(A.e.addCompanyToPerson(pid, c3.id)).toBe(true);
    expect(A.e.addCompanyToPerson(pid, c3.id)).toBe(true); // again: nothing new
    await settle(A, B);
    for (const t of [A, B]) {
      expect(Object.keys(t.e.people)).toEqual([pid]);
      expect(cosOf(t, pid)).toEqual([[c1.id, true, 'ที่ปรึกษาโครงการ', 'active'], [c2.id, false, 'ที่ปรึกษาด้าน CFO', 'active'], [c3.id, false, '', 'active']]);
      expect(t.e.peopleOf(c2.id).map((p) => [p.id, p.pos, p.role, p.ncos, p.extra])).toEqual([[pid, 'ที่ปรึกษาด้าน CFO', 'influencer', 3, true]]);
      expect(t.e.peopleOf(c1.id).map((p) => [p.id, p.pos, p.extra])).toEqual([[pid, 'ที่ปรึกษาโครงการ', false]]);
    }
    // on the sheet: one record per company, whole, never a name in it; nothing deleted
    expect(rows(`person/${pid}/co/`).map((r) => r.k).sort()).toEqual([`person/${pid}/co/${c2.id}`, `person/${pid}/co/${c3.id}`].sort());
    expect(last(`person/${pid}/co/${c2.id}`)!.v).toEqual({ on: 1, st: 'active', pos: 'ที่ปรึกษาด้าน CFO', dept: '', role: 'influencer', at: T0.toISOString(), by: 'เอ', upAt: T0.toISOString(), upBy: 'เอ' });
    // a deal of the second company: the company's only person, one tap; linked: not "อยู่ที่ … ไม่ใช่บริษัทของดีลนี้"
    const d = B.e.addDeal({ gid: c2.id, year: '2569', section: 'TGO' });
    expect(contactChoices(B.e.dealPool(d)).map((p) => [p.id, p.pos])).toEqual([[pid, 'ที่ปรึกษาด้าน CFO']]);
    expect(B.e.linkPerson(d.id, pid)).toBe(true);
    expect(B.e.contactElsewhere(B.e.sales.deals[d.id], B.e.people[pid])).toBe(false);
    expect(B.e.personView(B.e.people[pid], c2.id)).toMatchObject({ pos: 'ที่ปรึกษาด้าน CFO', ncos: 3 });
    // the "กับ" of a contact record: them, chosen
    expect(actWith(B, d.id)).toMatchObject({ pid });
    // a send from the person's page to a company of theirs that is not their main one: they are its contact
    const s = B.e.addDealsFromCompanies([c3.id], { year: '2569', pid });
    expect(B.e.dealPeople(s.ids[0]).map((p) => p.id)).toEqual([pid]);
    await settle(A, B);
    // the person counts across their companies; a company only its own
    expect(A.e.personDeals(pid).map((x) => x.gid).sort()).toEqual([c2.id, c3.id].sort());
    A.e.addPersonLog(pid, 'call', 'คุยแล้ว', 'โทรคุยเรื่อง CFO', c2.id);
    expect(A.e.crm.log[c2.id].map((l) => l.text)).toEqual(['โทรคุยเรื่อง CFO']);
    expect(A.e.crm.log[c1.id] || []).toEqual([]);
    expect(A.e.personLogs(A.e.people[pid]).length).toBe(1);
    // without a company of theirs it goes to the main one
    A.e.addPersonLog(pid, 'note', '', 'ชอบ LINE', 999999);
    expect(A.e.crm.log[c1.id].map((l) => l.text)).toEqual(['ชอบ LINE']);
  });

  it('a deal of a company whose one person is the consultant: them, one tap; with another person too: both offered, nobody linked without asking', async () => {
    const [A] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id });
    A.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
    // the company's one person is the consultant (another company of theirs): a send makes them its contact
    const one = A.e.addDealsFromCompanies([c2.id], { year: '2568' });
    expect(A.e.dealPeople(one.ids[0]).map((p) => p.id)).toEqual([pid]);
    const p2 = A.e.addPerson({ name: 'คุณวิภา ศรีสุข', gid: c2.id, role: 'decision' });
    const r = A.e.addDealsFromCompanies([c2.id], { year: '2569' });
    expect(A.e.dealPeople(r.ids[0])).toEqual([]);
    expect(contactChoices(A.e.dealPool(A.e.sales.deals[r.ids[0]])).map((p) => p.id)).toEqual([p2, pid]);
  });

  it('ไม่อยู่แล้ว at one company: not offered there, still at the others; left only when no company is left; added again: back; เอาออก: off, never deleted', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณสมศักดิ์ ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการกลุ่ม' });
    A.e.addCompanyToPerson(pid, c2.id, { pos: 'กรรมการ' });
    const d1 = A.e.addDeal({ gid: c1.id, year: '2569' }), d2 = A.e.addDeal({ gid: c2.id, year: '2569' });
    A.e.updatePersonCo(pid, c2.id, { st: 'left' }, { st: 'active' });
    expect(contactChoices(A.e.dealPool(d2))).toEqual([]);
    expect(A.e.peopleOf(c2.id).map((p) => [p.id, p.status])).toEqual([[pid, 'left']]);
    expect(contactChoices(A.e.dealPool(d1)).map((p) => p.id)).toEqual([pid]);
    expect(A.e.personActive(A.e.people[pid])).toBe(true);
    A.e.updatePersonCo(pid, null, { st: 'left' }, { st: 'active' }); // the main one: the person record's status
    expect(A.e.people[pid].status).toBe('left');
    expect(A.e.personActive(A.e.people[pid])).toBe(false);
    await settle(A, B);
    expect(B.e.personActive(B.e.people[pid])).toBe(false);
    B.e.addCompanyToPerson(pid, c2.id);
    expect(contactChoices(B.e.dealPool(d2)).map((p) => [p.id, p.pos])).toEqual([[pid, 'กรรมการ']]);
    expect(B.e.personCoUsed(B.e.people[pid], c2.id)).toBe(false);
    B.e.removePersonCo(pid, c2.id);
    expect(B.e.peopleOf(c2.id)).toEqual([]);
    await settle(A, B);
    expect(A.e.peopleOf(c2.id)).toEqual([]);
    expect(rows('person/').filter((r) => r.del)).toEqual([]);
    expect(last(`person/${pid}/co/${c2.id}`)!.v).toMatchObject({ on: 0 });
  });

  it('ใช้เป็นบริษัทหลัก: one swap of the main company and another; an older reader sees the person at the new main one', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณวรรณา ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการ', role: 'decision' });
    A.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา', role: 'influencer' });
    later();
    expect(A.e.setMainCompany(pid, c2.id)).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.people[pid]).toMatchObject({ gid: c2.id, company: c2.name, pos: 'ที่ปรึกษา', role: 'influencer', status: 'active' });
      expect(cosOf(t, pid)).toEqual([[c2.id, true, 'ที่ปรึกษา', 'active'], [c1.id, false, 'ผู้จัดการ', 'active']]);
      expect(t.e.personCos(t.e.people[pid])[1].role).toBe('decision');
    }
    const old = sim.post({ action: 'pull', key: KEY, since: 0, cv: 5 }).rows!.filter((r) => r.k === 'person/' + pid).at(-1)!;
    expect(toPerson(old.v, pid)).toMatchObject({ gid: c2.id, pos: 'ที่ปรึกษา' });
    // "เปลี่ยน" the main company to one of theirs: the two swap (said once each; the one so far stays theirs)
    A.e.updatePerson(pid, { gid: c1.id, company: c1.name });
    expect(cosOf(A, pid).map((x) => [x[0], x[1], x[3]])).toEqual([[c1.id, true, 'active'], [c2.id, false, 'active']]);
  });

  it('a tab on the older build (cv 5): no phantom person from the records; its whole-record writes of the people keep the companies and the merge', async () => {
    const [A, B] = await team();
    const [c1, c2, c3] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    const dup = A.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c2.id, phone: '0800000303' });
    A.e.addCompanyToPerson(pid, c3.id, { pos: 'ที่ปรึกษา' });
    later();
    expect(A.e.mergePeople(pid, dup)).toBe(true);
    await settle(A, B);
    // what the older builds pull and how they read person/ rows: 3e4deab reads every one as a person (no name: none),
    // ab2bb50 skips a key of three parts
    const pulled = sim.post({ action: 'pull', key: KEY, since: 0, cv: 5 }).rows!;
    const persons = pulled.filter((r) => r.k.startsWith('person/') && !r.del).map((r) => toPerson(r.v, r.k.slice(7))).filter(Boolean);
    expect(persons.map((p) => p!.id).sort()).toEqual([pid, dup].sort());
    expect(pulled.filter((r) => r.k.startsWith('person/') && r.k.split('/').length === 4).length).toBe(3); // co c3, co c2 (from the merge), into
    // it writes both people whole, as it knows them
    const vOf = (id: string) => pulled.filter((r) => r.k === 'person/' + id).at(-1)!.v as Record<string, unknown>;
    const r = sim.post({ action: 'push', key: KEY, cv: 5, ops: [
      { k: 'person/' + pid, v: { ...vOf(pid), note: 'แก้จากแท็บเก่า' }, by: 'ซี' },
      { k: 'person/' + dup, v: { ...vOf(dup), status: 'active', phone: '0800000303' }, by: 'ซี' },
    ] });
    expect(r.ok).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.people[pid].note).toBe('แก้จากแท็บเก่า');
      expect(cosOf(t, pid)).toEqual([[c1.id, true, '', 'active'], [c3.id, false, 'ที่ปรึกษา', 'active'], [c2.id, false, '', 'active']]);
      expect(t.e.isMerged(dup)).toBe(true);
      expect(t.e.livePeople().map((p) => p.id)).toEqual([pid]);
    }
    expect(CV).toBe(5); // no new client version: the team script needs no update
  });

  it('three browsers changing a consultant\'s companies at once: every change stays', async () => {
    const [A, B] = await team();
    const C = await third();
    const [c1, c2, c3] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id });
    A.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
    await settle(A, B, C);
    later();
    A.e.addCompanyToPerson(pid, c3.id, { pos: 'กรรมการ' });
    B.e.updatePersonCo(pid, c2.id, { pos: 'ที่ปรึกษาด้าน CFO' }, { pos: 'ที่ปรึกษา' });
    C.e.updatePersonCo(pid, c2.id, { role: 'influencer' }, { role: '' });
    C.e.updatePerson(pid, { phone: '080-000-0303' }, { phone: '' });
    await settle(A, B, C);
    for (const t of [A, B, C]) {
      expect(cosOf(t, pid)).toEqual([[c1.id, true, '', 'active'], [c2.id, false, 'ที่ปรึกษาด้าน CFO', 'active'], [c3.id, false, 'กรรมการ', 'active']]);
      expect(t.e.personCos(t.e.people[pid])[1].role).toBe('influencer');
      expect(t.e.people[pid].phone).toBe('080-000-0303');
    }
  });
});

describe('no duplicates', () => {
  it('"คนนี้มีอยู่แล้ว — เพิ่มบริษัทนี้ให้คนเดิม": the company is added with the position typed, the new number too, the deal linked; never renamed', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303', email: 'pornwimon@example.com' });
    const d = A.e.addDeal({ gid: c2.id, year: '2569' });
    const t = { name: 'คุณพรวิมล', phone: '0800000303 | 089-999-0000', email: '' };
    const f = A.e.findExisting(t, c2.id);
    expect(f.map((x) => [x.p.id, x.by, x.here])).toEqual([[pid, ['phone'], false]]);
    expect(A.e.addToExisting(pid, { gid: c2.id, pos: 'ที่ปรึกษา', phone: t.phone, email: t.email }, { id: d.id })).toBe(true);
    expect(A.e.findExisting(t, c2.id)[0].here).toBe(true);
    await settle(A, B);
    expect(B.e.people[pid]).toMatchObject({ name: 'ดร.พรวิมล ตัวอย่าง', phone: '080-000-0303 | 089-999-0000' });
    expect(B.e.peopleOf(c2.id).map((p) => [p.id, p.pos])).toEqual([[pid, 'ที่ปรึกษา']]);
    expect(B.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
    expect(Object.keys(B.e.people)).toEqual([pid]);
  });

  it('"บันทึกเป็นผู้ติดต่อ" / เพิ่มลูกค้า: the same name and a number of theirs is the person (their company added); a name alone is someone new', async () => {
    const [A] = await team();
    const [c1, c2, c3] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    const d2 = A.e.addDeal({ gid: c2.id, year: '2569', contactName: 'พรวิมล ตัวอย่าง', phone: '080-000-0303' });
    expect(A.e.saveTypedContact(d2.id)).toBe(pid);
    expect(A.e.dealPeople(d2.id).map((p) => p.id)).toEqual([pid]);
    expect(A.e.dealsWith(A.e.people[pid], c2.id)).toBe(true);
    // a name alone (no number of theirs typed): a new person, the duplicates line catches it later
    const d3 = A.e.addDeal({ gid: c3.id, year: '2569', contactName: 'พรวิมล ตัวอย่าง', phone: '', email: '' });
    const other = A.e.saveTypedContact(d3.id);
    expect(other).not.toBe(pid);
    expect(A.e.likelyDups().map((x) => x.key)).toEqual([[pid, other].sort().join('|')]);
    // the card's "เพิ่มบริษัทนี้ให้ <ชื่อ>": the person chosen
    A.e.unlinkPerson(d3.id, other);
    expect(A.e.saveTypedContact(d3.id, undefined, { pid })).toBe(pid);
    expect(A.e.dealPeople(d3.id).map((p) => p.id)).toEqual([pid]);
  });

  it('a suggestion from the Sales Tracker for someone recorded at another company: "เพิ่ม <บริษัท> ให้ <ชื่อ>"; known at a company of theirs: not suggested', async () => {
    const [A] = await team();
    const [c1, c2, c3] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    A.e.addDeal({ gid: c2.id, year: '2569', contactName: 'คุณวิม', phone: '0800000303' });
    A.e.addDeal({ gid: c3.id, year: '2569', contactName: 'คุณพรวิมล ตัวอย่าง' });
    A.e.addCompanyToPerson(pid, c3.id);
    const s = A.e.personSuggestions();
    expect(s.map((x) => [x.gid, x.same?.id])).toEqual([[c2.id, pid]]);
  });

  it('an import links someone who deals with the company as another one of theirs', async () => {
    const [A] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id });
    A.e.addCompanyToPerson(pid, c2.id);
    const f = file({ rows: [{ type: 'section', name: 'TGO' }, { type: 'client', client: c2.name, contactName: 'ดร.พรวิมล ตัวอย่าง' }] }, 'old.json');
    expect((await A.e.importTracker(f, '2565')).deals).toBe(1);
    const d = A.e.dealsOf(c2.id).find((x) => x.year === '2565')!;
    expect(A.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
  });
});

describe('merging two records of one human', () => {
  it('links, calls, contact records and appointments are the kept person\'s; the other is shown nowhere; one note says it', async () => {
    const [A, B] = await team();
    const [c1, c2, c3] = companies(A);
    const keep = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, pos: 'ที่ปรึกษาโครงการ', phone: '080-000-0303', email: 'pornwimon@example.com' });
    const gone = A.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c2.id, pos: 'ที่ปรึกษา', phone: '0800000303 | 089-999-0000', nick: 'วิม' });
    const other = A.e.addPerson({ name: 'คุณเอกชัย มั่นคง', gid: c2.id });
    const dA = A.e.addDeal({ gid: c2.id, year: '2569' }), dB = A.e.addDeal({ gid: c1.id, year: '2569' });
    A.e.linkPerson(dA.id, gone);
    later();
    A.e.linkPerson(dA.id, other);
    A.e.linkPerson(dB.id, keep);
    A.e.addPersonLog(gone, 'call', 'คุยแล้ว', 'โทรคุยเรื่อง CFO');
    A.e.addAct(dA.id, { type: 'meet', note: 'ประชุมเปิดงาน', pid: gone });
    A.e.addTasks([c2.id], { type: 'call', date: '2026-10-25', time: '10:00', note: 'โทรตาม' }, 0, gone);
    expect(A.e.likelyDups().map((x) => [x.key, x.by.sort()])).toEqual([[[keep, gone].sort().join('|'), ['name', 'phone']]]);
    await settle(A, B);
    const before = hist(B, dA.id).length;
    expect(B.e.mergePeople(keep, gone)).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      // the deal's main contact stays its main one, now the kept person; no line in the deal's history
      expect(t.e.dealPeople(dA.id).map((p) => p.id)).toEqual([keep, other]);
      expect(t.e.plinks[`${gone}/${dA.id}`].on).toBe(0);
      expect(t.e.personDeals(keep).map((d) => d.id).sort()).toEqual([dA.id, dB.id].sort());
      // what was recorded with the other record is theirs (read through the alias, not rewritten)
      const logs = t.e.personLogs(t.e.people[keep]);
      expect(logs.map((x) => x.l.text)).toEqual(expect.arrayContaining(['โทรคุยเรื่อง CFO']));
      expect(logs.filter((x) => (x.l.text || '').startsWith('รวมรายชื่อซ้ำ “พรวิมล ตัวอย่าง”')).length).toBe(1);
      expect(t.e.personActs(keep).map((a) => a.note)).toEqual(['ประชุมเปิดงาน']);
      expect(t.e.personTasks(t.e.people[keep]).map((x) => x.note)).toEqual(['โทรตาม']);
      expect(t.e.crm.tasks.find((x) => x.note === 'โทรตาม')!.pid).toBe(gone);
      // one record: the companies, phones and nickname of both
      expect(t.e.people[keep]).toMatchObject({ phone: '080-000-0303 | 089-999-0000', nick: 'วิม', email: 'pornwimon@example.com' });
      expect(cosOf(t, keep)).toEqual([[c1.id, true, 'ที่ปรึกษาโครงการ', 'active'], [c2.id, false, 'ที่ปรึกษา', 'active']]);
      // the other shown nowhere
      expect(t.e.livePeople().map((p) => p.id).sort()).toEqual([keep, other].sort());
      expect(t.e.peopleOf(c2.id).map((p) => p.id).sort()).toEqual([keep, other].sort());
      expect(t.e.people[gone].status).toBe('left'); // (an older tab: ย้ายงานแล้ว)
      expect(t.e.likelyDups()).toEqual([]);
    }
    expect(hist(B, dA.id).length).toBe(before);
    // a link a tab on the older build makes to the other record after the merge: the kept person; taken off as theirs
    const d3 = A.e.addDeal({ gid: c3.id, year: '2569' });
    await settle(A, B);
    expect(sim.post({ action: 'push', key: KEY, cv: 5, ops: [{ k: `person/${gone}/${d3.id}`, v: { on: 1, at: new Date().toISOString(), by: 'ซี', o: 1 }, by: 'ซี' }] }).ok).toBe(true);
    await settle(A, B);
    expect(A.e.dealPeople(d3.id).map((p) => p.id)).toEqual([keep]);
    expect(actWith(A, d3.id).list.map((p) => p.id)).toEqual([keep]);
    expect(A.e.unlinkPerson(d3.id, keep)).toBe(true);
    expect(A.e.dealPeople(d3.id)).toEqual([]);
    await settle(A, B);
    expect(last(`person/${gone}/${d3.id}`)!.v).toMatchObject({ on: 0 });
    // linking the kept person where the other is linked: one contact, not two
    expect(sim.post({ action: 'push', key: KEY, cv: 5, ops: [{ k: `person/${gone}/${d3.id}`, v: { on: 1, at: new Date().toISOString(), by: 'ซี', o: 1 }, by: 'ซี' }] }).ok).toBe(true);
    await settle(A, B);
    expect(A.e.linkPerson(d3.id, keep, { main: true })).toBe(true);
    expect(A.e.dealPeople(d3.id).map((p) => p.id)).toEqual([keep]);
    // deleting the kept person: the merged record goes with them from every list
    A.e.deletePerson(keep);
    await settle(A, B);
    expect(B.e.livePeople().map((p) => p.id)).toEqual([other]);
    expect(B.e.dealPeople(dA.id).map((p) => p.id)).toEqual([other]);
  });

  it('the suggestion the other record was made from stays answered', async () => {
    const [A] = await team();
    const [c1, c2] = companies(A);
    A.e.addDeal({ gid: c2.id, year: '2569', contactName: 'พรวิมล ตัวอย่าง' });
    const s = A.e.personSuggestions();
    expect(s.length).toBe(1);
    const gone = A.e.addPerson({ name: s[0].name, gid: s[0].gid, company: s[0].company }, { id: s[0].id, nx: true });
    const keep = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id });
    expect(A.e.mergePeople(keep, gone)).toBe(true);
    expect(A.e.personSuggestions()).toEqual([]);
  });

  it('a backup carries the companies and merges; a browser on ab2bb50 imports none of them (one "/" only)', async () => {
    sim = createGasSim({ teamKey: KEY });
    const C = mk('C', 'ซี');
    const [c1, c2] = companies(C);
    const pid = C.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id });
    const dup = C.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c1.id });
    C.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
    C.e.mergePeople(pid, dup);
    const E = mk('E', 'อี');
    await E.e.importCrm(file({ kind: 'gcc-crm-backup', v: 1, crm: {}, contacts: {}, dedup: {}, custom: {}, sales: {}, people: C.e.people, plinks: { ...C.e.plinks, 'x/co/abc': { on: 1 } } }));
    expect(Object.keys(E.e.plinks).sort()).toEqual([`${pid}/co/${c2.id}`, `${dup}/into/${pid}`].sort());
    expect(E.e.livePeople().map((p) => p.id)).toEqual([pid]);
    expect(cosOf(E, pid)).toEqual([[c1.id, true, '', 'active'], [c2.id, false, 'ที่ปรึกษา', 'active']]);
    // ab2bb50's check: a link key has exactly one "/"
    const ab = (k: string) => { const i = k.indexOf('/'); return i > 0 && i < k.length - 1 && !k.includes('/', i + 1); };
    expect(Object.keys(C.e.plinks).filter(ab)).toEqual([]);
    // uploaded when connecting, like any record
    expect(await C.e.teamConnect(URL, KEY)).toBe(true);
    await settle(C);
    expect(last(`person/${pid}/co/${c2.id}`)!.v).toMatchObject({ pos: 'ที่ปรึกษา' });
    expect(last(`person/${dup}/into/${pid}`)!.v).toMatchObject({ on: 1 });
    expect(personKey(`${dup}/into/${pid}`)).toEqual({ pid: dup, into: pid });
    expect(pcoValue(C.e.plinks[`${pid}/co/${c2.id}`] as never)).not.toHaveProperty('name');
  });
});

describe('who may change a person\'s companies and merge', () => {
  async function lead() {
    sim = createGasSim({ teamKey: '', kdfIter: 1000 });
    sim.setup();
    const L = mk('L');
    expect(await L.e.teamOpen(URL)).toBe('setup');
    await L.e.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
    return L;
  }
  async function member(L: Tab, u: string, name: string, role: Role) {
    const { temp } = await L.e.adminCreate({ u, name, role });
    const M = mk(u);
    expect(await M.e.teamOpen(URL)).toBe('accounts');
    await M.e.teamLogin(u, temp, true);
    await M.e.teamChangePassword('', u + '-pass-123');
    await settle(M);
    return M;
  }
  it('a viewer reads them and changes nothing (the script refuses it too); sales may add, edit and merge without deleting; own work only: its own deals', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    const { id: own } = await L.e.roleSave({ n: 'ขายเฉพาะงานตัวเอง', d: '', c: { ...BUILTIN.sales.c, 'edit.deal': 'own' } });
    const O = await member(L, 'orn', 'อร', own);
    const [c1, c2, c3] = companies(L);
    const pid = L.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    const dup = L.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c3.id, phone: '0800000303' });
    L.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
    const d = L.e.addDeal({ gid: c2.id, year: '2569', resp: 'หมิว' });
    await settle(L, S, V, O);
    // the viewer: everything shows, nothing changes
    expect(V.e.peopleOf(c2.id).map((p) => p.id)).toEqual([pid]);
    expect(V.e.addCompanyToPerson(pid, c3.id)).toBe(false);
    expect(V.e.mergePeople(pid, dup)).toBe(false);
    V.e.updatePersonCo(pid, c2.id, { pos: 'แก้' }, { pos: 'ที่ปรึกษา' });
    expect(V.e.personCos(V.e.people[pid])[1].pos).toBe('ที่ปรึกษา');
    const refused = sim.post({ action: 'push', tok: V.e.session!.tok, cv: CV, ops: [{ k: `person/${pid}/co/${c3.id}`, v: { on: 1, st: 'active', at: T0.toISOString(), by: 'ปลา' } }] });
    expect(refused).toMatchObject({ ok: false, error: 'forbidden' });
    // sales (no ลบดีล ลูกค้า และผู้ติดต่อ): adds, edits, merges
    expect(S.e.can('del.rec')).toBe(false);
    expect(S.e.addCompanyToPerson(pid, c3.id, { pos: 'กรรมการ' })).toBe(true);
    expect(S.e.mergePeople(pid, dup)).toBe(true);
    // own work only: links on its own deals (the picker's "pick someone from outside" needs canLink), not others'
    expect(O.e.canLink(O.e.sales.deals[d.id])).toBe(false);
    expect(O.e.addCompanyToPerson(pid, c2.id)).toBe(true); // ลูกค้าและผู้ติดต่อ has no own-work scope
    const mine = O.e.addDeal({ gid: c2.id, year: '2570' });
    expect(O.e.linkPerson(mine.id, pid)).toBe(true);
    await settle(L, S, V, O);
    for (const t of [L, V]) {
      expect(cosOf(t, pid).map((x) => x[0])).toEqual([c1.id, c2.id, c3.id]);
      expect(t.e.livePeople().map((p) => p.id)).toEqual([pid]);
      expect(t.e.dealPeople(mine.id).map((p) => p.id)).toEqual([pid]);
    }
  });
});

// ---------------------------------------------------------------- the review's findings (round 1), each as it was found
describe('review fixes: changes made at the same time, merges, the main company', () => {
  it('"เพิ่มทั้งหมด" for one contact typed at three companies: one person with the three companies (two browsers at once: still one)', async () => {
    const [A, B] = await team();
    const [c1, c2, c3] = companies(A);
    for (const c of [c1, c2, c3]) A.e.addDeal({ gid: c.id, year: '2569', contactName: 'ดร.พรวิมล ตัวอย่าง', phone: '080-000-0303' });
    await settle(A, B);
    const s = A.e.personSuggestions();
    // the list says it: one row, then "the same as above" twice
    expect(s.map((x) => [x.gid, !!x.same, x.dupOf?.id || ''])).toEqual(expect.arrayContaining([[s[0].gid, false, '']]));
    expect(s.filter((x) => x.dupOf?.id === s[0].id).length).toBe(2);
    const all = (t: Tab) => t.e.personSuggestions().filter((x) => !x.same).map((x) => ({ id: x.id, name: x.name, gid: x.gid, company: x.company, phone: x.phone, email: x.email }));
    expect(A.e.addPeople(all(A))).toBe(1);
    expect(B.e.addPeople(all(B))).toBe(1);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.livePeople().length).toBe(1);
      const p = t.e.livePeople()[0];
      expect(cosOf(t, p.id).map((x) => x[0]).sort()).toEqual([c1.id, c2.id, c3.id].sort());
      expect(t.e.likelyDups()).toEqual([]);
      expect(t.e.personSuggestions()).toEqual([]);
    }
  });

  it('a teammate who has not had the merge yet adds a company and an e-mail to the merged-away record: the company is the kept person\'s; the e-mail is shown on their page, one tap keeps it', async () => {
    const [A, B] = await team();
    const [c1, c2, c3] = companies(A);
    const keep = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    const gone = A.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c2.id, phone: '0800000303' });
    await settle(A, B);
    later();
    A.e.mergePeople(keep, gone);
    later(1000);
    B.e.addCompanyToPerson(gone, c3.id, { pos: 'ที่ปรึกษา' });
    B.e.updatePerson(gone, { email: 'pw.new@example.com' }, { email: '' });
    await settle(A, B);
    for (const t of [A, B]) {
      expect(cosOf(t, keep)).toEqual([[c1.id, true, '', 'active'], [c2.id, false, '', 'active'], [c3.id, false, 'ที่ปรึกษา', 'active']]);
      expect(t.e.peopleOf(c3.id).map((p) => [p.id, p.pos])).toEqual([[keep, 'ที่ปรึกษา']]);
      expect(t.e.livePeople().map((p) => p.id)).toEqual([keep]);
      expect(t.e.lateReach(t.e.people[keep])).toMatchObject({ patch: { email: 'pw.new@example.com' }, from: [{ id: gone }] });
    }
    // "เพิ่มให้คนนี้"
    const late = A.e.lateReach(A.e.people[keep])!;
    A.e.updatePerson(keep, late.patch, { email: '' });
    await settle(A, B);
    expect(B.e.people[keep].email).toBe('pw.new@example.com');
    expect(B.e.lateReach(B.e.people[keep])).toBeNull();
    // the merge's own write of the other record is not "saved since"
    expect(A.e.lateReach(A.e.people[keep])).toBeNull();
  });

  it('a merge while a teammate deletes the kept person: the other record is shown again, as it was, in their place (deals included); a deletion made knowing the merge takes both', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const keep = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    const gone = A.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c2.id, phone: '0800000303' });
    const d = A.e.addDeal({ gid: c2.id, year: '2569' });
    A.e.linkPerson(d.id, gone);
    await settle(A, B);
    later();
    A.e.mergePeople(keep, gone);
    B.e.deletePerson(keep);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.livePeople().map((p) => [p.id, p.status])).toEqual([[gone, 'active']]);
      expect(t.e.personActive(t.e.people[gone])).toBe(true);
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([gone]);
      expect(t.e.personDeals(gone).map((x) => x.id)).toEqual([d.id]);
      expect(t.e.peopleOf(c2.id).map((p) => [p.id, p.status])).toEqual([[gone, 'active']]);
    }
    // its next save writes the status it shows
    A.e.updatePerson(gone, { nick: 'วิม' }, { nick: '' });
    await settle(A, B);
    expect(last('person/' + gone)!.v).toMatchObject({ status: 'active', nick: 'วิม' });
    // the deliberate way (knowing the merge): both go
    const k2 = A.e.addPerson({ name: 'คุณเอกชัย มั่นคง', gid: c1.id, phone: '081-111-2222' });
    const g2 = A.e.addPerson({ name: 'เอกชัย มั่นคง', gid: c2.id, phone: '0811112222' });
    A.e.mergePeople(k2, g2);
    A.e.deletePerson(k2);
    await settle(A, B);
    for (const t of [A, B]) expect(t.e.livePeople().map((p) => p.id)).toEqual([gone]);
  });

  it('two people make two different companies the main one at the same time: neither company is lost', async () => {
    const [A, B] = await team();
    const [c1, c2, c3] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณวรรณา ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการ' });
    A.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
    A.e.addCompanyToPerson(pid, c3.id, { pos: 'กรรมการ' });
    await settle(A, B);
    later();
    A.e.setMainCompany(pid, c2.id);
    B.e.setMainCompany(pid, c3.id);
    await settle(A, B);
    for (const t of [A, B]) expect(cosOf(t, pid)).toEqual([[c3.id, true, 'กรรมการ', 'active'], [c1.id, false, 'ผู้จัดการ', 'active'], [c2.id, false, 'ที่ปรึกษา', 'active']]);
  });

  it('a swap of the main company and ไม่อยู่แล้ว at the main company at the same time: either one wins whole, never ไม่อยู่แล้ว on the other company', async () => {
    for (const order of ['swap-last', 'left-last'] as const) {
      const [A, B] = await team();
      const [c1, c2] = companies(A);
      const pid = A.e.addPerson({ name: 'คุณวรรณา ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการ' });
      A.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
      await settle(A, B);
      later();
      A.e.setMainCompany(pid, c2.id);
      B.e.updatePersonCo(pid, c1.id, { st: 'left' }, { st: 'active' });
      if (order === 'left-last') await settle(A, B);
      else await settle(B, A);
      const want = order === 'left-last'
        ? [[c1.id, true, 'ผู้จัดการ', 'left'], [c2.id, false, 'ที่ปรึกษา', 'active']]
        : [[c2.id, true, 'ที่ปรึกษา', 'active'], [c1.id, false, 'ผู้จัดการ', 'active']];
      for (const t of [A, B]) expect(cosOf(t, pid)).toEqual(want);
      tabs.splice(0).forEach((t) => t.e.dispose());
    }
  });

  it('a form opened for the main company, saved after a teammate made another one the main one: the change goes to the company it was opened for', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณวรรณา ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการ' });
    A.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
    await settle(A, B);
    later();
    A.e.setMainCompany(pid, c2.id);
    await settle(A, B);
    // B's form was opened on c1 as the main company
    B.e.updatePersonCo(pid, c1.id, { pos: 'ผู้จัดการทั่วไป' }, { pos: 'ผู้จัดการ' });
    await settle(A, B);
    for (const t of [A, B]) expect(cosOf(t, pid)).toEqual([[c2.id, true, 'ที่ปรึกษา', 'active'], [c1.id, false, 'ผู้จัดการทั่วไป', 'active']]);
  });

  it('two merges of one pair the other way round at the same time: one person, still ยังติดต่อได้ at their main company; one marked ไม่อยู่แล้ว since stays so', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const x = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    const y = A.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c2.id, phone: '0800000303' });
    await settle(A, B);
    later();
    A.e.mergePeople(x, y);
    B.e.mergePeople(y, x);
    await settle(A, B);
    const s = x < y ? x : y;
    for (const t of [A, B]) {
      expect(t.e.livePeople().map((p) => [p.id, p.status])).toEqual([[s, 'active']]);
      expect(cosOf(t, s).map((r) => [r[0], r[3]])).toEqual([[s === x ? c1.id : c2.id, 'active'], [s === x ? c2.id : c1.id, 'active']]);
    }
    later();
    A.e.updatePersonCo(s, null, { st: 'left' }, { st: 'active' });
    await settle(A, B);
    for (const t of [A, B]) expect(t.e.personNow(t.e.people[s]).status).toBe('left');
  });

  it('"เปลี่ยน" the main company: kept as ไม่อยู่แล้ว where a deal or a call was with them, gone where nothing was', async () => {
    const [A, B] = await team();
    const [c1, c2, c3] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณวรรณา ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการ' });
    const d = A.e.addDeal({ gid: c1.id, year: '2569' });
    A.e.linkPerson(d.id, pid);
    A.e.updatePerson(pid, { gid: c2.id, company: c2.name }, { gid: c1.id, company: c1.name });
    await settle(A, B);
    for (const t of [A, B]) {
      expect(cosOf(t, pid)).toEqual([[c2.id, true, 'ผู้จัดการ', 'active'], [c1.id, false, 'ผู้จัดการ', 'left']]);
      expect(t.e.peopleOf(c1.id).map((p) => [p.id, p.status])).toEqual([[pid, 'left']]);
      expect(t.e.contactElsewhere(t.e.sales.deals[d.id], t.e.people[pid])).toBe(false);
    }
    // nothing recorded at c2: changed again, it goes
    A.e.updatePerson(pid, { gid: c3.id, company: c3.name }, { gid: c2.id, company: c2.name });
    expect(cosOf(A, pid).map((x) => [x[0], x[3]])).toEqual([[c3.id, 'active'], [c1.id, 'left']]);
  });

  it('a merge where both records are on one deal with someone between them: the main contact stays the main one', async () => {
    const [A] = await team();
    const [c1, c2] = companies(A);
    const keep = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id, phone: '080-000-0303' });
    const gone = A.e.addPerson({ name: 'พรวิมล ตัวอย่าง', gid: c2.id, phone: '0800000303' });
    const other = A.e.addPerson({ name: 'คุณเอกชัย มั่นคง', gid: c2.id });
    const d = A.e.addDeal({ gid: c2.id, year: '2569' });
    A.e.linkPerson(d.id, gone);
    later();
    A.e.linkPerson(d.id, other);
    later();
    A.e.linkPerson(d.id, keep);
    A.e.mergePeople(keep, gone);
    expect(A.e.dealPeople(d.id).map((p) => p.id)).toEqual([keep, other]);
  });

  it('two registry records of one company merged after the person was added to both and one taken off: they still deal with it', async () => {
    const [A] = await team();
    const g0 = A.e.B.groups[0];
    A.e.decide(g0.key, 'split');
    const g = A.e.B.groups.find((x) => x.key === g0.key)!;
    const [x, y] = g.ids;
    const [c1] = companies(A).filter((c) => !g.ids.includes(c.id));
    const pid = A.e.addPerson({ name: 'ดร.พรวิมล ตัวอย่าง', gid: c1.id });
    A.e.addCompanyToPerson(pid, x, { pos: 'ที่ปรึกษา' });
    later();
    A.e.addCompanyToPerson(pid, y);
    later();
    A.e.removePersonCo(pid, y);
    A.e.decide(g.key, 'merge');
    const m = A.e.canonical(x);
    expect(cosOf(A, pid).map((r) => [r[0], r[2], r[3]])).toEqual([[c1.id, '', 'active'], [m, 'ที่ปรึกษา', 'active']]);
    expect(A.e.peopleOf(m).map((p) => p.id)).toEqual([pid]);
    // taken off now (the merged company): every record of it goes off
    A.e.removePersonCo(pid, m);
    expect(A.e.peopleOf(m)).toEqual([]);
  });

  it('two browsers add a company to a person who has none, at the same time: both companies stay', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณสมชาย ตัวอย่าง', company: '' });
    await settle(A, B);
    later();
    A.e.addCompanyToPerson(pid, c1.id, { pos: 'ผู้จัดการ' });
    B.e.addCompanyToPerson(pid, c2.id, { pos: 'ที่ปรึกษา' });
    await settle(A, B);
    for (const t of [A, B]) expect(cosOf(t, pid)).toEqual([[c2.id, true, 'ที่ปรึกษา', 'active'], [c1.id, false, 'ผู้จัดการ', 'active']]);
  });
});

describe('review fixes: no duplicates from the deal card, เพิ่มลูกค้า and the suggestions', () => {
  it('"สร้างคนใหม่" beside someone recorded elsewhere makes a new person; "ใช้ <ชื่อ>" uses them', async () => {
    const [A] = await team();
    const [c1] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณวิภา ศรีสุข', gid: c1.id, phone: '081-234-5678' });
    // a deal not linked to the registry, the same name and mobile typed
    const d = A.e.addDeal({ client: 'บริษัท แสนสิริ กรีน (ตัวอย่าง) จำกัด', year: '2569', contactName: 'คุณวิภา ศรีสุข', phone: '0812345678' });
    expect(A.e.findExisting({ name: 'คุณวิภา ศรีสุข', phone: '0812345678', email: '' }, null, d.client).map((x) => x.p.id)).toEqual([pid]);
    const fresh = A.e.saveTypedContact(d.id, undefined, { fresh: true });
    expect(fresh).not.toBe(pid);
    expect(A.e.dealPeople(d.id).map((p) => p.id)).toEqual([fresh]);
    expect(A.e.livePeople().length).toBe(2);
    // the other choice, on another such deal: them
    const d2 = A.e.addDeal({ client: 'บริษัท แสนสิริ กรีน (ตัวอย่าง) จำกัด', year: '2570', contactName: 'คุณวิภา ศรีสุข', phone: '0812345678' });
    expect(A.e.saveTypedContact(d2.id, undefined, { pid })).toBe(pid);
  });

  it('เพิ่มลูกค้า with a contact typed: the same name and mobile is the person already recorded, though the new customer has the mobile as its number; a short name with it is caught as a likely pair', async () => {
    const [A] = await team();
    const [c1] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณกมล รักษ์โลก', gid: c1.id, phone: '089-555-0101' });
    // what AddCustomer does: the customer, its job, then the contact typed
    const typed = { name: 'คุณกมล รักษ์โลก', phone: '089-555-0101', email: '' };
    const id = A.e.addCustomer({ name: 'บริษัท ทดสอบรีวิว ไม่ซ้ำ จำกัด', jur: '', prov: '', ind: '', biz: '', addr: '', phone: typed.phone, email: '', web: '', contact: typed.name, note: '' });
    const d = A.e.addDeal({ gid: id, year: '2569' });
    expect(A.e.saveTypedContact(d.id, typed)).toBe(pid);
    expect(A.e.livePeople().length).toBe(1);
    expect(A.e.dealsWith(A.e.people[pid], id)).toBe(true);
    // "คุณกมล" alone (one word) and the same mobile: someone new, and the pair is offered to merge
    const id2 = A.e.addCustomer({ name: 'บริษัท ทดสอบรีวิว สอง จำกัด', jur: '', prov: '', ind: '', biz: '', addr: '', phone: '0895550101', email: '', web: '', contact: 'คุณกมล', note: '' });
    const d2 = A.e.addDeal({ gid: id2, year: '2569' });
    const other = A.e.saveTypedContact(d2.id, { name: 'คุณกมล', phone: '0895550101', email: '' });
    expect(other).not.toBe(pid);
    expect(A.e.likelyDups().map((x) => [x.key, x.by])).toEqual([[[pid, other].sort().join('|'), ['phone']]]);
  });

  it('a suggestion from a deal not linked to the registry that is someone recorded: "ใช้ <ชื่อ>" (no second record; the company named in their notes, once)', async () => {
    const [A] = await team();
    const [c1] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณวิภา ศรีสุข', gid: c1.id, phone: '081-234-5678' });
    A.e.addDeal({ client: 'บริษัท แสนสิริ กรีน (ตัวอย่าง) จำกัด', year: '2569', contactName: 'คุณวิภา', phone: '0812345678 | 02-000-1111' });
    const s = A.e.personSuggestions();
    expect(s.map((x) => [x.gid, x.same?.id])).toEqual([[null, pid]]);
    // "เพิ่มทั้งหมด" leaves it; its own button
    expect(A.e.addPeople(s.filter((x) => !x.same).map((x) => ({ id: x.id, name: x.name, gid: x.gid, company: x.company, phone: x.phone, email: x.email })))).toBe(0);
    for (let i = 0; i < 2; i++) A.e.addToExisting(pid, { gid: null, company: s[0].company, phone: s[0].phone, email: s[0].email });
    A.e.hideSuggestion(s[0].id);
    expect(A.e.livePeople().length).toBe(1);
    expect(A.e.people[pid].phone).toBe('081-234-5678 | 02-000-1111');
    expect(A.e.personLogs(A.e.people[pid]).filter((x) => (x.l.text || '').includes('แสนสิริ')).length).toBe(1);
    expect(A.e.personSuggestions()).toEqual([]);
    // someone with no company at all: it becomes their main one (a name typed)
    const q = A.e.addPerson({ name: 'คุณใหม่ ไร้สังกัด', company: '' });
    A.e.addToExisting(q, { gid: null, company: 'ร้านตัวอย่างพิมพ์เอง', pos: 'เจ้าของ' });
    expect(A.e.people[q]).toMatchObject({ gid: null, company: 'ร้านตัวอย่างพิมพ์เอง', pos: 'เจ้าของ' });
  });
});
