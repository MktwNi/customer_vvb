/**
 * A deal typed by its client name (no registry company yet) and the contact linked to it: one action links the deal's
 * company and the contact's company too (engine linkDealCompany, lib/dealCompany.ts), end to end with the real team
 * script (team-sync/Code.gs in the simulator). The owner's case (the typed company from "คนนี้มีอยู่แล้ว"), the other
 * ways a contact gets linked (made from the deal, typed on it), a deal that already has its company, the links made
 * before this, who may link, and a tab on the older build (cv 5). The same name, two companies: the exact name first, the
 * contact's own company among ties, two browsers picking alike, and the duplicate prompt's pick of another company (the
 * person gets that company only; the deal waits for its card's button).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { norm } from './core';
import { CUSTOM_ID_MIN, CV, type Role } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/dc/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const SCG = 'เอสซีจี (ประเทศไทย)';

// each browser has its own localStorage (prefs: the session)
const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

const T0 = new Date('2026-10-22T03:00:00Z');
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
  raw.ref = '2026-10-22';
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
/** Registry companies each test may use (no deal, no person yet), one name each. */
function companies(t: Tab): Company[] {
  const n = new Map<string, number>();
  t.e.B.companies.forEach((c) => n.set(c.name.trim(), (n.get(c.name.trim()) || 0) + 1));
  return t.e.B.companies.filter((c) => n.get(c.name.trim()) === 1 && !t.e.dealsOf(c.id).length && !t.e.peopleOf(c.id).length);
}
const cosOf = (t: Tab, pid: string) => t.e.personCos(t.e.people[pid]).map((x) => [x.gid, x.main, x.pos, x.st]);
/** The companies on the sheet with a name (a company made by hand is one record: its name normalised). */
const madeNamed = (name: string) => rows('cust/').filter((r) => !r.del && norm((r.v as { name: string }).name) === norm(name));
/** The companies of this name a browser has (registry or added by hand). */
const namedIn = (t: Tab, name: string) => t.e.B.companies.filter((c) => norm(c.name) === norm(name)).length;
const sheetText = () => JSON.stringify(sim.post({ action: 'pull', key: KEY, since: 0, cv: CV }).rows);

describe('a deal typed by name: its company and the contact\'s, in one action', () => {
  it('the owner\'s case: "คนนี้มีอยู่แล้ว → เพิ่มบริษัทนี้ให้คนเดิม" on a deal typed เอสซีจี (ประเทศไทย): the deal gets the company, the person has it too, once; the other browser sees the same; linking again changes nothing', async () => {
    const [A, B] = await team();
    const [c1] = companies(A);
    expect(A.e.B.companies.some((c) => norm(c.name) === norm(SCG))).toBe(false); // not in the registry: one is added
    const pid = A.e.addPerson({ name: 'คุณสุรชัย ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการ', phone: '080-000-0404' });
    const d = A.e.addDeal({ client: SCG, year: '2569' });
    expect(d.gid).toBeNull();
    expect(A.e.addToExisting(pid, { gid: null, company: SCG, pos: 'ที่ปรึกษา', phone: '', email: '' }, { id: d.id, main: true })).toBe(true);
    await settle(A, B);
    const gid = A.e.sales.deals[d.id].gid!;
    expect(gid).not.toBeNull();
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(gid);
      expect(t.e.company(gid)?.name).toBe(SCG);
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
      expect(t.e.dealContact(t.e.sales.deals[d.id]).name).toBe('คุณสุรชัย ตัวอย่าง');
      expect(cosOf(t, pid)).toEqual([[c1.id, true, 'ผู้จัดการ', 'active'], [gid, false, 'ที่ปรึกษา', 'active']]);
      expect(t.e.peopleOf(gid).map((p) => [p.id, p.pos, p.extra])).toEqual([[pid, 'ที่ปรึกษา', true]]);
      expect(t.e.contactElsewhere(t.e.sales.deals[d.id], t.e.people[pid])).toBe(false);
    }
    // the company made once: on the sheet, and the same company for the other browser
    expect(madeNamed(SCG).length).toBe(1);
    expect(B.e.B.companies.filter((c) => norm(c.name) === norm(SCG)).length).toBe(1);
    // linking again (the same person from the deal, and from the person): nothing written
    const before = sheetText();
    expect(A.e.linkPerson(d.id, pid)).toBe(true);
    expect(A.e.addToExisting(pid, { gid: null, company: SCG, pos: 'ที่ปรึกษา' }, { id: d.id })).toBe(true);
    await settle(A, B);
    expect(sheetText()).toBe(before);
    expect(madeNamed(SCG).length).toBe(1);
  });

  it('the other ways a contact is linked on a typed deal ("เพิ่มผู้ติดต่อ" = a person made with the company typed, then linked; "บันทึกเป็นผู้ติดต่อ"): one company for the same name, the contact at it', async () => {
    const [A, B] = await team();
    const d = A.e.addDeal({ client: SCG, year: '2569' });
    const d2 = A.e.addDeal({ client: 'บริษัท เอสซีจี (ประเทศไทย) จำกัด', year: '2570', contactName: 'คุณอีกคน เอสซีจี', phone: '080-000-0505' });
    // AddPerson's create: the form's person with the company typed, then the deal's contact
    const pid = A.e.addPerson({ name: 'คุณใหม่ เอสซีจี', company: SCG, gid: null, phone: '080-000-0303' });
    expect(A.e.linkPerson(d.id, pid, { main: true })).toBe(true);
    // "บันทึกเป็นผู้ติดต่อ" on the other deal, the same company written another way
    const other = A.e.saveTypedContact(d2.id);
    expect(other).toBeTruthy();
    await settle(A, B);
    const gid = A.e.sales.deals[d.id].gid!;
    expect(gid).not.toBeNull();
    expect(A.e.sales.deals[d2.id].gid).toBe(gid);
    expect(madeNamed(SCG).length).toBe(1);
    for (const t of [A, B]) {
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
      expect(t.e.dealPeople(d2.id).map((p) => p.id)).toEqual([other]);
      expect(cosOf(t, pid)).toEqual([[gid, true, '', 'active']]);
      expect(cosOf(t, other)).toEqual([[gid, true, '', 'active']]);
    }
  });

  it('a deal that already has its company: the contact is linked as before (not the company added by it), and the card\'s button adds the company to them', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณทดสอบ ที่ปรึกษา', gid: c1.id });
    const d = A.e.addDeal({ gid: c2.id, year: '2569' });
    expect(A.e.linkPerson(d.id, pid)).toBe(true);
    expect(cosOf(A, pid)).toEqual([[c1.id, true, '', 'active']]);
    expect(A.e.contactNotHere(A.e.sales.deals[d.id], A.e.people[pid])).toBe(true);
    // the card's one button: the same helper
    expect(A.e.linkDealCompany(d.id, pid, { pos: 'ที่ปรึกษา' })).toBe(c2.id);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(cosOf(t, pid)).toEqual([[c1.id, true, '', 'active'], [c2.id, false, 'ที่ปรึกษา', 'active']]);
      expect(t.e.contactNotHere(t.e.sales.deals[d.id], t.e.people[pid])).toBe(false);
    }
    expect(A.e.linkDealCompany(d.id, pid)).toBe(c2.id);
    expect(cosOf(A, pid)).toEqual([[c1.id, true, '', 'active'], [c2.id, false, 'ที่ปรึกษา', 'active']]);
  });

  it('a link made before this (the contact on a typed deal, its company not linked): the next link of them, or the card\'s button, makes the company theirs and the deal\'s', async () => {
    const [A, B] = await team();
    const [c1] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณเก่า ลิงก์', gid: c1.id });
    const d = A.e.addDeal({ client: SCG, year: '2569' });
    // what the older build wrote: the link only
    expect(sim.post({ action: 'push', key: KEY, cv: CV, ops: [{ k: `person/${pid}/${d.id}`, v: { on: 1, at: T0.toISOString(), by: 'เอ', o: 1 }, by: 'เอ' }] }).ok).toBe(true);
    await settle(A, B);
    expect(A.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
    expect(A.e.sales.deals[d.id].gid).toBeNull();
    expect(A.e.contactNotHere(A.e.sales.deals[d.id], A.e.people[pid])).toBe(true);
    // a link of them again (the same action as before): the deal and they get the company
    expect(A.e.linkPerson(d.id, pid)).toBe(true);
    await settle(A, B);
    const gid = A.e.sales.deals[d.id].gid!;
    expect(gid).not.toBeNull();
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(gid);
      expect(cosOf(t, pid)).toEqual([[c1.id, true, '', 'active'], [gid, false, '', 'active']]);
    }
    expect(madeNamed(SCG).length).toBe(1);
    // another typed deal of theirs: its own company, made once, theirs too
    const d2 = A.e.addDeal({ client: 'บริษัท ทดสอบซ้ำ ตัวอย่าง จำกัด', year: '2570' });
    expect(A.e.linkPerson(d2.id, pid)).toBe(true);
    expect(A.e.contactNotHere(A.e.sales.deals[d2.id], A.e.people[pid])).toBe(false);
  });

  it('who may link: a viewer and an account with ดีลและขั้นตอน but not ลูกค้าและผู้ติดต่อ are refused (nothing made, the deal stays without a company); sales may', async () => {
    const L = await lead();
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    const { id: dealOnly } = await L.e.roleSave({ n: 'ดีลอย่างเดียว', d: '', c: { 'view.sales': 'all', 'view.money': 'all', 'edit.deal': 'all' } });
    const D = await member(L, 'dao', 'ดาว', dealOnly);
    const pid = L.e.addPerson({ name: 'คุณทดสอบ สิทธิ์', company: '' });
    const d = L.e.addDeal({ client: SCG, year: '2569', resp: 'หมิว' });
    await settle(L, V, D);
    expect(V.e.canLink(V.e.sales.deals[d.id])).toBe(false);
    expect(V.e.linkPerson(d.id, pid)).toBe(false);
    expect(V.e.linkDealCompany(d.id, pid)).toBeNull();
    expect(D.e.canLink(D.e.sales.deals[d.id])).toBe(false);
    expect(D.e.linkPerson(d.id, pid)).toBe(false);
    await settle(L, V, D);
    expect(L.e.sales.deals[d.id].gid).toBeNull();
    expect(namedIn(L, SCG)).toBe(0);
    expect(L.e.dealPeople(d.id)).toEqual([]);
    // the lead may: the company and the contact
    expect(L.e.linkPerson(d.id, pid)).toBe(true);
    await settle(L, V, D);
    expect(V.e.sales.deals[d.id].gid).not.toBeNull();
    expect(namedIn(L, SCG)).toBe(1);
  });

  it('a tab on the older build (cv 5) that pulled the link writes the deal and the person whole: the company stays with both', async () => {
    const [A, B] = await team();
    const [c1] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณสุรชัย ตัวอย่าง', gid: c1.id, pos: 'ผู้จัดการ' });
    const d = A.e.addDeal({ client: SCG, year: '2569' });
    A.e.addToExisting(pid, { gid: null, company: SCG, pos: 'ที่ปรึกษา' }, { id: d.id });
    await settle(A, B);
    const gid = A.e.sales.deals[d.id].gid!;
    const pulled = sim.post({ action: 'pull', key: KEY, since: 0, cv: 5 }).rows!;
    const deal = pulled.filter((r) => r.k === 'deal/' + d.id).at(-1)!.v as Record<string, unknown>;
    const person = pulled.filter((r) => r.k === 'person/' + pid).at(-1)!.v as Record<string, unknown>;
    const r = sim.post({ action: 'push', key: KEY, cv: 5, ops: [
      { k: 'deal/' + d.id, v: { ...deal, resp: 'คุณซี' }, by: 'ซี' },
      { k: 'person/' + pid, v: { ...person, note: 'แก้จากแท็บเก่า' }, by: 'ซี' },
    ] });
    expect(r.ok).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id]).toMatchObject({ gid, resp: 'คุณซี' });
      expect(t.e.people[pid].note).toBe('แก้จากแท็บเก่า');
      expect(cosOf(t, pid)).toEqual([[c1.id, true, 'ผู้จัดการ', 'active'], [gid, false, 'ที่ปรึกษา', 'active']]);
    }
    expect(CV).toBe(5); // no new client version: the team script needs no update
  });
});

describe('the people already there: one company, nobody twice', () => {
  it('a contact typed only at the client\'s name is not at a deal typed by name that has no team company yet: the card\'s button makes that company theirs and the deal\'s, once', async () => {
    const [A, B] = await team();
    const pid = A.e.addPerson({ name: 'คุณพิมพ์เอง ตัวอย่าง', company: SCG, gid: null, phone: '' });
    const d = A.e.addDeal({ client: SCG, year: '2569' });
    expect(A.e.contactNotHere(A.e.sales.deals[d.id], A.e.people[pid])).toBe(true);
    const gid = A.e.linkDealCompany(d.id, pid);
    expect(gid).not.toBeNull();
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(gid);
      expect(cosOf(t, pid)).toEqual([[gid, true, '', 'active']]);
      expect(t.e.contactNotHere(t.e.sales.deals[d.id], t.e.people[pid])).toBe(false);
    }
    expect(madeNamed(SCG).length).toBe(1);
    const before = sheetText();
    expect(A.e.linkDealCompany(d.id, pid)).toBe(gid);
    await settle(A, B);
    expect(sheetText()).toBe(before);
  });

  it('"บันทึกเป็นผู้ติดต่อ" on a deal typed by name: the typed-only person of the client\'s name is the contact, not a second record; the company is theirs once', async () => {
    const [A, B] = await team();
    const pid = A.e.addPerson({ name: 'คุณเดิม พิมพ์เอง', company: SCG, gid: null, phone: '' });
    const d = A.e.addDeal({ client: SCG, year: '2569' });
    expect(A.e.saveTypedContact(d.id, { name: 'คุณเดิม พิมพ์เอง', phone: '', email: '' })).toBe(pid);
    await settle(A, B);
    const gid = A.e.sales.deals[d.id].gid!;
    expect(gid).not.toBeNull();
    expect(Object.values(A.e.people).filter((p) => norm(p.name) === norm('คุณเดิม พิมพ์เอง')).length).toBe(1);
    for (const t of [A, B]) {
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
      expect(cosOf(t, pid)).toEqual([[gid, true, '', 'active']]);
    }
    expect(madeNamed(SCG).length).toBe(1);
  });

  it('the duplicate prompt\'s "เพิ่มบริษัทนี้ให้คนเดิม" on a deal typed by name (the card\'s button for someone recorded elsewhere): the deal\'s company is added to them as one more company and they are the contact; again: nothing written', async () => {
    const [A, B] = await team();
    const [c1] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณซ้ำ ตัวอย่าง', gid: c1.id, phone: '080-000-0606' });
    const d = A.e.addDeal({ client: SCG, year: '2569', contactName: 'คุณซ้ำ ตัวอย่าง', phone: '080-000-0606' });
    expect(A.e.saveTypedContact(d.id, undefined, { pid })).toBe(pid);
    await settle(A, B);
    const gid = A.e.sales.deals[d.id].gid!;
    expect(gid).not.toBeNull();
    expect(madeNamed(SCG).length).toBe(1);
    for (const t of [A, B]) {
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
      expect(cosOf(t, pid)).toEqual([[c1.id, true, '', 'active'], [gid, false, '', 'active']]);
    }
    const before = sheetText();
    expect(A.e.saveTypedContact(d.id, undefined, { pid })).toBe(pid);
    await settle(A, B);
    expect(sheetText()).toBe(before);
  });

  it('the duplicate prompt in the dialog with the company box left blank on a deal typed by name: the deal\'s company is still theirs, with the position typed', async () => {
    const [A, B] = await team();
    const [c1] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณว่าง ตัวอย่าง', gid: c1.id });
    const d = A.e.addDeal({ client: SCG, year: '2569' });
    expect(A.e.addToExisting(pid, { gid: null, company: '', pos: 'ที่ปรึกษา', phone: '', email: '' }, { id: d.id, main: true })).toBe(true);
    await settle(A, B);
    const gid = A.e.sales.deals[d.id].gid!;
    expect(gid).not.toBeNull();
    for (const t of [A, B]) {
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
      expect(cosOf(t, pid)).toEqual([[c1.id, true, '', 'active'], [gid, false, 'ที่ปรึกษา', 'active']]);
    }
    expect(madeNamed(SCG).length).toBe(1);
  });
});

describe('review fixes: one company per typed name, its fields kept, the duplicate prompt on a linked deal', () => {
  it('a browser that never pulled the company another made for the same typed name does not blank the phone and jur typed for it later', async () => {
    const [A, B] = await team();
    const [c1] = companies(A);
    const pa = A.e.addPerson({ name: 'คุณทับ ข้อมูล เอ', gid: c1.id });
    const d = A.e.addDeal({ client: 'บริษัท ทับ ข้อมูล จำกัด', year: '2569' });
    expect(A.e.linkPerson(d.id, pa)).toBe(true);
    await settle(A); // B has not pulled the company
    const gid = A.e.sales.deals[d.id].gid!;
    A.e.updateCustomer(gid, { phone: '02-555-0101', jur: '0105500000001' });
    await settle(A);
    // B types the same client from its copy, which does not have the company yet
    const pb = B.e.addPerson({ name: 'คุณทับ ข้อมูล บี', gid: c1.id });
    const db = B.e.addDeal({ client: 'ทับ ข้อมูล', year: '2569' });
    expect(B.e.linkPerson(db.id, pb)).toBe(true);
    await settle(A, B);
    expect(B.e.sales.deals[db.id].gid).toBe(gid);
    for (const t of [A, B]) {
      expect(t.e.company(gid)?.phone).toBe('02-555-0101');
      expect(t.e.company(gid)?.jur).toBe('0105500000001');
    }
    const last = rows('cust/').filter((r) => r.k === 'cust/' + gid).at(-1)!;
    expect(last.del).toBeFalsy();
    expect(last.v).toMatchObject({ phone: '02-555-0101', jur: '0105500000001' });
  });

  it('two team companies of one name (two juristic ids, made on two browsers): every browser picks the same one, so the deal and both contacts share it', async () => {
    const [A, B] = await team();
    const pA = A.e.addPerson({ name: 'คุณสองเลข เอ' });
    const pB = B.e.addPerson({ name: 'คุณสองเลข บี' });
    const blank = { prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' };
    const x1 = A.e.addCustomer({ name: 'สองเลขคู่ ทดสอบ', jur: '0105500000011', ...blank });
    const x2 = B.e.addCustomer({ name: 'สองเลขคู่ ทดสอบ', jur: '0105500000022', ...blank });
    const dX = A.e.addDeal({ client: 'สองเลขคู่ ทดสอบ', year: '2569' });
    await settle(A, B);
    expect(A.e.linkPerson(dX.id, pA)).toBe(true);
    expect(B.e.linkPerson(dX.id, pB)).toBe(true);
    await settle(A, B);
    const g = A.e.sales.deals[dX.id].gid!;
    expect(g).toBe(Math.min(x1, x2));
    for (const t of [A, B]) {
      expect(t.e.sales.deals[dX.id].gid).toBe(g);
      expect(cosOf(t, pA).map((x) => x[0])).toContain(g);
      expect(cosOf(t, pB).map((x) => x[0])).toContain(g);
    }
  });

  it('a company a teammate deleted: the same typed name later makes a new company, which stands on both browsers (it does not vanish on sync)', async () => {
    const [A, B] = await team();
    const pa = A.e.addPerson({ name: 'คุณลบแล้ว เอ' });
    const d1 = A.e.addDeal({ client: 'ลบแล้ว ทดสอบ', year: '2569' });
    expect(A.e.linkPerson(d1.id, pa)).toBe(true);
    await settle(A, B);
    const old = A.e.sales.deals[d1.id].gid!;
    A.e.deleteCustomer(old);
    await settle(A, B);
    expect(B.e.company(old)).toBeUndefined();
    // B makes a new deal of the same name and links a contact to it
    const pb = B.e.addPerson({ name: 'คุณลบแล้ว บี' });
    const d2 = B.e.addDeal({ client: 'ลบแล้ว ทดสอบ', year: '2569' });
    expect(B.e.linkPerson(d2.id, pb)).toBe(true);
    await settle(A, B);
    const gid = B.e.sales.deals[d2.id].gid!;
    expect(gid).not.toBeNull();
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d2.id].gid).toBe(gid);
      expect(t.e.company(gid)?.name).toBe('ลบแล้ว ทดสอบ');
      expect(cosOf(t, pb)).toEqual([[gid, true, '', 'active']]);
    }
    expect(rows('cust/').filter((r) => r.k === 'cust/' + gid).at(-1)!.del).toBeFalsy();
  });

  it('a browser that has not pulled the team\'s deletion of a company, and types its name for a new deal: its company stands on both browsers (the deletion does not stop it)', async () => {
    const [A, B] = await team();
    const [c1] = companies(A);
    const pa = A.e.addPerson({ name: 'คุณเก่า เอ', gid: c1.id });
    const d1 = A.e.addDeal({ client: 'เก่า ลบ ทดสอบ', year: '2569' });
    expect(A.e.linkPerson(d1.id, pa)).toBe(true);
    await settle(A); // B has not pulled the company
    const old = A.e.sales.deals[d1.id].gid!;
    A.e.deleteCustomer(old);
    await settle(A); // the deletion is on the sheet; B has not pulled it
    // B types the name for a new deal and links a contact (its copy has no company of the name)
    const pb = B.e.addPerson({ name: 'คุณเก่า บี' });
    const d2 = B.e.addDeal({ client: 'เก่า ลบ ทดสอบ', year: '2569' });
    expect(B.e.linkPerson(d2.id, pb)).toBe(true);
    await settle(A, B);
    const gid = B.e.sales.deals[d2.id].gid!;
    expect(gid).not.toBeNull();
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d2.id].gid).toBe(gid);
      expect(t.e.company(gid)?.name).toBe('เก่า ลบ ทดสอบ');
      expect(cosOf(t, pb)).toEqual([[gid, true, '', 'active']]);
    }
    expect(rows('cust/').filter((r) => r.k === 'cust/' + gid).at(-1)!.del).toBeFalsy();
  });

  it('the duplicate prompt on a deal already linked to its company, no company picked (or the deal\'s own name typed): the contact gets the deal\'s company once, with the position typed; again: nothing written', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณมีบริษัท', gid: c1.id });
    const d = A.e.addDeal({ gid: c2.id, client: c2.name, year: '2569' });
    expect(A.e.addToExisting(pid, { gid: null, company: '', pos: 'ผู้จัดการฝ่ายขาย', phone: '', email: '' }, { id: d.id, main: true })).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(cosOf(t, pid)).toContainEqual([c2.id, false, 'ผู้จัดการฝ่ายขาย', 'active']);
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
      expect(t.e.sales.deals[d.id].gid).toBe(c2.id);
    }
    // the deal's name typed in the box: the same company, no note saying it is not in the registry
    const pid2 = A.e.addPerson({ name: 'คุณชื่อเดียวกัน', gid: c1.id });
    const d2 = A.e.addDeal({ gid: c2.id, client: c2.name, year: '2569' });
    expect(A.e.addToExisting(pid2, { gid: null, company: c2.name, pos: '', phone: '', email: '' }, { id: d2.id })).toBe(true);
    await settle(A, B);
    expect(cosOf(B, pid2).map((x) => x[0])).toContain(c2.id);
    expect(B.e.personLogs(B.e.people[pid2]).some((x) => /ไม่ได้อยู่ในทะเบียน/.test(x.l.text || ''))).toBe(false);
    // again: nothing written
    const before = sheetText();
    expect(A.e.addToExisting(pid, { gid: null, company: '', pos: 'ผู้จัดการฝ่ายขาย' }, { id: d.id, main: true })).toBe(true);
    await settle(A, B);
    expect(sheetText()).toBe(before);
  });
});

describe('the same name, two companies: the exact name first, the contact\'s own company, the duplicate prompt\'s pick', () => {
  // (companies added by hand, with ids fixed so the order of the ties is known)
  const blank = { jur: '', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' };

  it('name first: the company whose name is the typed name beats one that only matches after normalising, the lower id notwithstanding', async () => {
    const [A, B] = await team();
    const loose = A.e.addCustomer({ name: 'บริษัท สามทดสอบ จำกัด', ...blank }, { id: CUSTOM_ID_MIN + 11 });
    const exact = A.e.addCustomer({ name: 'สามทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 12 });
    const pid = A.e.addPerson({ name: 'คุณสาม ทดสอบ' });
    const d = A.e.addDeal({ client: 'สามทดสอบ', year: '2569' });
    expect(A.e.linkPerson(d.id, pid)).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(exact);
      expect(cosOf(t, pid).map((x) => x[0])).toEqual([exact]);
    }
    expect(loose).not.toBe(exact);
    expect(madeNamed('สามทดสอบ').length).toBe(2); // the two companies are kept: nothing merged, nothing made again
  });

  it('the contact\'s own company beats a tie: of two companies of one exact name, the one the contact is at, whatever the id; a contact at neither gets the lowest id', async () => {
    const [A, B] = await team();
    const lo = A.e.addCustomer({ name: 'สองที่ ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 21 });
    const hi = A.e.addCustomer({ name: 'สองที่ ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 22 });
    const pid = A.e.addPerson({ name: 'คุณที่ สองที่', gid: hi });
    const d = A.e.addDeal({ client: 'สองที่ ทดสอบ', year: '2569' });
    expect(A.e.linkPerson(d.id, pid)).toBe(true);
    const pid2 = A.e.addPerson({ name: 'คุณเปล่า สองที่' });
    const d2 = A.e.addDeal({ client: 'สองที่ ทดสอบ', year: '2570' });
    expect(A.e.linkPerson(d2.id, pid2)).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(hi);
      expect(t.e.sales.deals[d2.id].gid).toBe(lo);
      expect(cosOf(t, pid).map((x) => x[0])).toEqual([hi]);
      expect(cosOf(t, pid2).map((x) => x[0])).toEqual([lo]);
    }
  });

  it('a card\'s pick of someone at the second of two same-name companies: the deal\'s phone that is that company\'s switchboard is not copied to them; the mobile typed for them is', async () => {
    const [A, B] = await team();
    A.e.addCustomer({ name: 'สองเบอร์ ทดสอบ', ...blank, phone: '02-111-1111' }, { id: CUSTOM_ID_MIN + 71 });
    const hi = A.e.addCustomer({ name: 'สองเบอร์ ทดสอบ', ...blank, phone: '02-222-2222' }, { id: CUSTOM_ID_MIN + 72 });
    const pid = A.e.addPerson({ name: 'คุณเบอร์ ทดสอบ', gid: hi });
    const d = A.e.addDeal({ client: 'สองเบอร์ ทดสอบ', year: '2569', contactName: 'คุณเบอร์ ทดสอบ', phone: '02-222-2222 | 081-333-4444' });
    // the card's "เพิ่มบริษัทนี้ให้ <ชื่อ>": the contact is at hi, so the deal's company for them is hi (not the lower id)
    expect(A.e.saveTypedContact(d.id, undefined, { pid })).toBe(pid);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(hi);
      expect(cosOf(t, pid).map((x) => x[0])).toEqual([hi]);
      expect(t.e.people[pid].phone).toBe('081-333-4444');
    }
  });

  it('two browsers pick the same company for the same typed name and contact, each from its own copy', async () => {
    const [A, B] = await team();
    A.e.addCustomer({ name: 'สองเบราว์เซอร์ ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 31 });
    const hi = A.e.addCustomer({ name: 'สองเบราว์เซอร์ ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 32 });
    await settle(A, B);
    const pa = A.e.addPerson({ name: 'คุณเอ ตัวอย่าง', gid: hi });
    const d = A.e.addDeal({ client: 'สองเบราว์เซอร์ ทดสอบ', year: '2569' });
    await settle(A, B);
    expect(B.e.linkPerson(d.id, pa)).toBe(true);
    expect(A.e.linkPerson(d.id, pa)).toBe(true);
    await settle(A, B);
    expect(A.e.sales.deals[d.id].gid).toBe(hi);
    expect(B.e.sales.deals[d.id].gid).toBe(hi);
    // a contact with no company, on B: the lowest id, the same on A
    const pb = B.e.addPerson({ name: 'คุณบี ตัวอย่าง' });
    const d2 = B.e.addDeal({ client: 'สองเบราว์เซอร์ ทดสอบ', year: '2570' });
    expect(B.e.linkPerson(d2.id, pb)).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) expect(t.e.sales.deals[d2.id].gid).toBe(CUSTOM_ID_MIN + 31);
  });

  it('the duplicate prompt picks a different team company: the person gets that company only, the deal stays unlinked, no company made for the typed client, the card offers the deal\'s company', async () => {
    const [A, B] = await team();
    const [, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณคนเดิม ตัวอย่าง' });
    const d = A.e.addDeal({ client: 'ทดสอบห้าง จำกัด', year: '2569' });
    expect(A.e.addToExisting(pid, { gid: c2.id, pos: 'ที่ปรึกษา', phone: '', email: '' }, { id: d.id, main: true })).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(cosOf(t, pid)).toEqual([[c2.id, true, 'ที่ปรึกษา', 'active']]);
      expect(t.e.sales.deals[d.id].gid).toBeNull();
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
      expect(t.e.pickedIsDealCompany(d.id, pid, c2.id)).toBe(false);
      expect(t.e.contactNotHere(t.e.sales.deals[d.id], t.e.people[pid])).toBe(true); // the card's one button
    }
    expect(namedIn(A, 'ทดสอบห้าง จำกัด')).toBe(0);
    expect(madeNamed('ทดสอบห้าง จำกัด').length).toBe(0);
    // the card's button: the deal's company made once, and the contact has it too
    const before = sheetText();
    const gid = A.e.linkDealCompany(d.id, pid);
    expect(gid).not.toBeNull();
    await settle(A, B);
    expect(sheetText()).not.toBe(before);
    expect(madeNamed('ทดสอบห้าง จำกัด').length).toBe(1);
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(gid);
      expect(cosOf(t, pid).map((x) => x[0])).toEqual([c2.id, gid]);
      expect(t.e.contactNotHere(t.e.sales.deals[d.id], t.e.people[pid])).toBe(false);
    }
  });

  it('the duplicate prompt picks the company the deal gets: as before, the deal linked to it and the person has it once', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const pid = A.e.addPerson({ name: 'คุณตรงกัน ตัวอย่าง', gid: c1.id });
    const d = A.e.addDeal({ client: c2.name, year: '2569' });
    expect(A.e.pickedIsDealCompany(d.id, pid, c2.id)).toBe(true);
    expect(A.e.addToExisting(pid, { gid: c2.id, pos: 'ที่ปรึกษา' }, { id: d.id, main: true })).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.sales.deals[d.id].gid).toBe(c2.id);
      expect(cosOf(t, pid)).toEqual([[c1.id, true, '', 'active'], [c2.id, false, 'ที่ปรึกษา', 'active']]);
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
    }
    // the same company at the deal already: the card has no button for the contact there
    const at = A.e.addPerson({ name: 'คุณอยู่แล้ว ตัวอย่าง', gid: c2.id });
    const d2 = A.e.addDeal({ client: c2.name, year: '2570' });
    expect(A.e.contactNotHere(A.e.sales.deals[d2.id], A.e.people[at])).toBe(false);
    expect(A.e.contactNotHere(A.e.sales.deals[d2.id], A.e.people[pid])).toBe(false);
  });

  it('the duplicate prompt\'s pick is refused for a viewer and for an account that may not link: nothing written, the deal stays as it was', async () => {
    const L = await lead();
    const V = await member(L, 'pla2', 'ปลา', 'viewer');
    const { id: dealOnly } = await L.e.roleSave({ n: 'ดีลอย่างเดียว สอง', d: '', c: { 'view.sales': 'all', 'view.money': 'all', 'edit.deal': 'all' } });
    const D = await member(L, 'dao2', 'ดาว', dealOnly);
    const [c1, c2] = companies(L);
    const pid = L.e.addPerson({ name: 'คุณถูกห้าม สิทธิ์', gid: c1.id });
    const d = L.e.addDeal({ client: 'ห้ามเชื่อม สอง', year: '2569', resp: 'หมิว' });
    await settle(L, V, D);
    const before = sheetText();
    expect(V.e.addToExisting(pid, { gid: c2.id, pos: 'ที่ปรึกษา' }, { id: d.id, main: true })).toBe(false);
    expect(D.e.addToExisting(pid, { gid: c2.id, pos: 'ที่ปรึกษา' }, { id: d.id, main: true })).toBe(false);
    await settle(L, V, D);
    expect(sheetText()).toBe(before);
    expect(L.e.sales.deals[d.id].gid).toBeNull();
    expect(L.e.dealPeople(d.id)).toEqual([]);
    expect(cosOf(L, pid)).toEqual([[c1.id, true, '', 'active']]);
    expect(namedIn(L, 'ห้ามเชื่อม สอง')).toBe(0);
  });
});

// ---- the accounts (as the who-may-link tests of dealContact.engine.test.ts)
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
