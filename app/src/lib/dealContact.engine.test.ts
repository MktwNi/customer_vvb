/**
 * A deal's contact linked to a person (person/<pid>/<deal>, lib/people.ts PLink), in the engine, end to end with
 * the real team script (team-sync/Code.gs in the simulator): linking in one tap, the deals made by an explicit
 * action that get the company's one person, a person made from a deal, an older deal's typed contact, what a tab
 * still on the older build (cv 5) does to it, and who may change it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { BUILTIN } from './caps';
import { contactChoices, suggestionId, toPerson } from './people';
import { CV, type Role, type SyncOp } from './teamSync';
import type { Company, Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/dc/exec';
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
const queued = async (t: Tab) => {
  await (t.e as unknown as { pq: Promise<unknown> }).pq;
  return (await t.e.store.get<SyncOp[]>('teamPending:' + URL)) || [];
};
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

describe('a deal\'s contact is a person in ผู้ติดต่อ (one record, linked)', () => {
  it('the owner\'s case: the company\'s one person is offered, nothing is written until "ใช้คนนี้"; then every screen follows the person', async () => {
    const [A, B] = await team();
    const co = companies(A)[0];
    const pid = A.e.addPerson({ name: 'ดร.วรรณา ตัวอย่าง', gid: co.id, pos: 'ที่ปรึกษาโครงการ', role: 'coordinator', phone: '080-000-0101', email: 'wanna@example.com' });
    const d = A.e.addDeal({ gid: co.id, section: 'Retention', year: '2569' });
    await settle(A, B);
    // offered, not written: reading the deal (any number of times, by anyone) queues nothing
    expect(contactChoices(B.e.dealPool(B.e.sales.deals[d.id])).map((p) => p.id)).toEqual([pid]);
    expect(B.e.dealContact(B.e.sales.deals[d.id])).toMatchObject({ name: '', person: null });
    expect((await queued(B)).length).toBe(0);
    expect(rows('person/' + pid + '/')).toEqual([]);

    // one tap
    expect(B.e.linkPerson(d.id, pid)).toBe(true);
    const q = await queued(B);
    const op = q.find((o) => o.k === `person/${pid}/${d.id}`)!;
    expect(op.v).toMatchObject({ on: 1, by: 'บี' });
    expect(op.f).toBeUndefined();
    expect(q.some((o) => o.k.startsWith('deal/'))).toBe(false); // the deal holds no copy
    expect(hist(B, d.id).at(-1)).toMatchObject({ action: 'เชื่อมผู้ติดต่อ', detail: 'ดร.วรรณา ตัวอย่าง' });
    await settle(B, A);
    for (const t of [A, B]) {
      const dd = t.e.sales.deals[d.id];
      expect(t.e.dealContact(dd)).toMatchObject({ name: 'ดร.วรรณา ตัวอย่าง', phone: '080-000-0101', email: 'wanna@example.com' });
      expect(dd.contactName).toBe('');
      expect(t.e.personDeals(pid).map((x) => x.id)).toEqual([d.id]);
      // the table's search, the CSV's contact columns
      expect(t.e.contactHay(dd)).toContain('วรรณา');
      expect(t.e.salesCsv([dd]).split('\r\n')[1]).toContain('ดร.วรรณา ตัวอย่าง');
    }
    // the phone changes on the person (from the deal's card or the person's page): the deal shows the new one
    A.e.updatePerson(pid, { phone: '080-000-0202' }, { phone: '080-000-0101' });
    expect((await queued(A)).find((o) => o.k === 'person/' + pid)!.f).toEqual(['phone', 'upAt', 'upBy']);
    await settle(A, B);
    expect(B.e.dealContact(B.e.sales.deals[d.id]).phone).toBe('080-000-0202');
    // a contact record "กับ" them counts on their page
    const a = B.e.addAct(d.id, { type: 'call', note: 'โทรนัดส่งร่างรายงาน', pid });
    expect(a?.pid).toBe(pid);
    expect(B.e.personActs(pid).map((x) => x.note)).toEqual(['โทรนัดส่งร่างรายงาน']);
  });

  it('change, add another, take off: whole records with on 0, the main one first; a deleted deal or person is left out', async () => {
    const [A, B] = await team();
    const co = companies(A)[1];
    const p1 = A.e.addPerson({ name: 'คุณวิภา ศรีสุข', gid: co.id, role: 'decision' });
    const p2 = A.e.addPerson({ name: 'คุณเอกชัย มั่นคง', gid: co.id });
    const p3 = A.e.addPerson({ name: 'คุณนที ทดลอง', gid: co.id });
    const d = A.e.addDeal({ gid: co.id, year: '2569', section: 'TGO' });
    A.e.linkPerson(d.id, p1);
    later();
    A.e.linkPerson(d.id, p2); // เพิ่มอีกคน
    expect(A.e.dealPeople(d.id).map((p) => p.id)).toEqual([p1, p2]);
    later();
    A.e.linkPerson(d.id, p3, { main: true }); // เปลี่ยนผู้ติดต่อ: p3 in p1's place
    expect(A.e.dealPeople(d.id).map((p) => p.id)).toEqual([p3, p2]);
    expect(A.e.plinks[`${p1}/${d.id}`].on).toBe(0);
    expect(hist(A, d.id).at(-1)).toMatchObject({ action: 'เปลี่ยนผู้ติดต่อ', detail: 'คุณวิภา ศรีสุข เป็น คุณนที ทดลอง' });
    A.e.unlinkPerson(d.id, p2);
    await settle(A, B);
    expect(B.e.dealPeople(d.id).map((p) => p.id)).toEqual([p3]);
    // never a deletion on the sheet (a sales account may not delete records)
    expect(rows('person/').filter((r) => r.k.split('/').length === 3 && r.del)).toEqual([]);
    expect(last(`person/${p2}/${d.id}`)!.v).toMatchObject({ on: 0 });
    // a person deleted: the deal has no contact (its typed fields as they were); a deal deleted: not theirs any more
    A.e.deletePerson(p3);
    await settle(A, B);
    expect(B.e.dealPeople(d.id)).toEqual([]);
    const d2 = A.e.addDeal({ gid: co.id, year: '2570', section: 'TGO' });
    A.e.linkPerson(d2.id, p1);
    A.e.deleteDeal(d2.id);
    await settle(A, B);
    expect(B.e.personDeals(p1)).toEqual([]);
  });
});

describe('deals made by an explicit action get the company\'s one person', () => {
  it('a send (one or many): exactly one person still there is linked, said in the history; several or none: offered later', async () => {
    const [A] = await team();
    const [c1, c2, c3, c4] = companies(A);
    const one = A.e.addPerson({ name: 'คุณมานพ ตัวอย่าง', gid: c1.id });
    A.e.addPerson({ name: 'คุณเก่า ย้ายแล้ว', gid: c1.id, status: 'left' });
    A.e.addPerson({ name: 'คุณสอง หนึ่ง', gid: c2.id });
    A.e.addPerson({ name: 'คุณสอง สอง', gid: c2.id });
    const r = A.e.addDealsFromCompanies([c1.id, c2.id, c4.id], { year: '2569' });
    expect(r.added).toBe(3);
    const of = (c: Company) => A.e.dealsOf(c.id).find((x) => x.year === '2569')!;
    expect(A.e.dealPeople(of(c1).id).map((p) => p.id)).toEqual([one]);
    expect(hist(A, of(c1).id)[0].detail).toContain('ผู้ติดต่อ คุณมานพ ตัวอย่าง (เชื่อมให้อัตโนมัติ)');
    expect(A.e.dealPeople(of(c2).id)).toEqual([]);
    expect(A.e.dealPeople(of(c4).id)).toEqual([]);
    // sent from a person's page: that person, whoever else the company has
    const two = A.e.addPerson({ name: 'คุณที่สาม', gid: c3.id });
    A.e.addPerson({ name: 'คุณที่สี่', gid: c3.id });
    A.e.addDealsFromCompanies([c3.id], { year: '2569', pid: two });
    expect(A.e.dealPeople(of(c3).id).map((p) => p.id)).toEqual([two]);
    expect(hist(A, of(c3).id)[0].detail).toContain('ผู้ติดต่อ คุณที่สาม');
    // a deal added by hand (no explicit choice) is left alone: the card offers the person
    expect(A.e.dealPeople(A.e.addDeal({ gid: c1.id, year: '2570' }).id)).toEqual([]);
  });

  it('"เลิกทำ" a send: the rows go, their links point at nothing; a contact someone chose after the send keeps the row', async () => {
    const [A] = await team();
    const [c1, c2] = companies(A);
    const p1 = A.e.addPerson({ name: 'คุณหนึ่ง', gid: c1.id });
    A.e.addPerson({ name: 'คุณสอง ก', gid: c2.id });
    const p2b = A.e.addPerson({ name: 'คุณสอง ข', gid: c2.id });
    const r = A.e.addDealsFromCompanies([c1.id, c2.id], { year: '2569' });
    later(1000);
    const d2 = A.e.dealsOf(c2.id)[0];
    A.e.linkPerson(d2.id, p2b);
    expect(A.e.undoSent(r.k)).toMatchObject({ removed: 1, kept: 1 });
    expect(A.e.personDeals(p1)).toEqual([]);
    expect(A.e.personDeals(p2b).map((x) => x.id)).toEqual([d2.id]);
  });

  it('a new customer with a contact typed: one person at it, the deal\'s contact (not a People suggestion any more)', async () => {
    const [A, B] = await team();
    const id = A.e.addCustomer({ name: 'บริษัท ลูกค้าใหม่ทดลอง จำกัด', jur: '', prov: '', ind: '', biz: '', addr: '', phone: '02-000-0001', email: '', web: '', contact: 'คุณมานี ตัวอย่าง', note: '' });
    const d = A.e.addDeal({ gid: id, year: '2569' });
    const pid = A.e.saveTypedContact(d.id);
    expect(pid).toBe(suggestionId(id, 'บริษัท ลูกค้าใหม่ทดลอง จำกัด', 'คุณมานี ตัวอย่าง'));
    // the company's switchboard is the company's, not the person's
    expect(A.e.people[pid]).toMatchObject({ name: 'คุณมานี ตัวอย่าง', gid: id, phone: '' });
    expect(A.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
    expect(A.e.personSuggestions()).toEqual([]);
    await settle(A, B);
    expect(B.e.dealContact(B.e.sales.deals[d.id])).toMatchObject({ name: 'คุณมานี ตัวอย่าง', phone: '02-000-0001' });
  });

  it('a joint quotation\'s new row of a company carries that company row\'s contacts; a registry company gets its one person', async () => {
    const [A, B] = await team();
    const [c1, c2] = companies(A);
    const p1 = A.e.addPerson({ name: 'คุณร่วม หนึ่ง', gid: c1.id });
    const p2 = A.e.addPerson({ name: 'คุณร่วม สอง', gid: c2.id });
    A.e.addPerson({ name: 'คุณร่วม สาม', gid: c1.id });
    const own = A.e.addDeal({ gid: c1.id, year: '2569', section: 'Partner', resp: 'เอ' });
    A.e.linkPerson(own.id, p1);
    A.e.updateDeal(own.id, { jobStatus: 'closed' }); // a job of its own: a new row joins
    later();
    const { hid } = await A.e.createJoint({
      title: 'CFP ร่วม', payer: 'ผู้จ่ายทดลอง', payerGid: null, year: '2569', section: 'Partner', resp: 'เอ', service: ['CFP'], total: 100000, docNo: 'QT-J9', docDate: '2026-10-21', basis: 'total', detected: 100000,
      members: [{ deal: own.id, share: null, pct: null }, { gid: c2.id, share: null, pct: null }],
    });
    const mem = Object.keys(A.e.sales.jqm || {}).filter((k) => k.startsWith(hid + '/')).map((k) => A.e.sales.deals[k.slice(hid.length + 1)]);
    const m1 = mem.find((x) => x.gid === c1.id)!, m2 = mem.find((x) => x.gid === c2.id)!;
    expect(m1.id).not.toBe(own.id);
    expect(A.e.dealPeople(m1.id).map((p) => p.id)).toEqual([p1]);
    expect(A.e.dealPeople(m2.id).map((p) => p.id)).toEqual([p2]);
    await settle(A, B);
    expect(B.e.dealPeople(m1.id).map((p) => p.id)).toEqual([p1]);
  });

  it('an import links a typed contact to the one person of its company it names; never a new person, never a guess', async () => {
    const [A] = await team();
    const [c1, c2, c3] = companies(A);
    const p = A.e.addPerson({ name: 'คุณธนพล ใจกว้าง', gid: c1.id, pos: 'ผู้จัดการโรงงาน' });
    A.e.addPerson({ name: 'คุณซ้ำ ชื่อ', gid: c3.id });
    A.e.addPerson({ name: 'คุณซ้ำ ชื่อ', gid: c3.id, phone: '081-000-0000' });
    const n0 = Object.keys(A.e.people).length;
    const f = Object.assign(new Blob([JSON.stringify({ rows: [
      { type: 'section', name: 'TGO' },
      { type: 'client', client: c1.name, contactName: 'ธนพล ใจกว้าง', phone: '02-555-1234' },
      { type: 'client', client: c2.name, contactName: 'คุณไม่มีในรายชื่อ' },
      { type: 'client', client: c3.name, contactName: 'ซ้ำ ชื่อ' },
    ] })]), { name: 'old.json' }) as File;
    const res = await A.e.importTracker(f, '2565');
    expect(res.deals).toBe(3);
    const of = (c: Company) => A.e.dealsOf(c.id).find((x) => x.year === '2565')!;
    expect(A.e.dealPeople(of(c1).id).map((x) => x.id)).toEqual([p]);
    expect(A.e.dealPeople(of(c2).id)).toEqual([]);
    expect(A.e.dealPeople(of(c3).id)).toEqual([]);
    expect(Object.keys(A.e.people).length).toBe(n0);
    // the typed fields stay as the file had them
    expect(of(c1)).toMatchObject({ contactName: 'ธนพล ใจกว้าง', phone: '02-555-1234' });
    // created only if the team has no row for it yet (as the imported deal)
    expect((await queued(A)).find((o) => o.k === `person/${p}/${of(c1).id}`)!.nx).toBe(true);
  });
});

describe('an older deal\'s typed contact', () => {
  it('"บันทึกเป็นผู้ติดต่อ" on two browsers at once: one person, one link, the typed fields as they were', async () => {
    const [A, B] = await team();
    const co = companies(A)[0];
    const d = A.e.addDeal({ gid: co.id, year: '2569', contactName: 'คุณสมชาย ใจดี', phone: '081-234-5678', email: 'somchai@example.com' });
    await settle(A, B);
    const a = A.e.saveTypedContact(d.id), b = B.e.saveTypedContact(d.id);
    expect(a).toBe(b);
    expect(a).toBe(suggestionId(co.id, d.client, 'คุณสมชาย ใจดี'));
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.peopleOf(co.id).map((p) => [p.id, p.name, p.phone, p.email])).toEqual([[a, 'คุณสมชาย ใจดี', '081-234-5678', 'somchai@example.com']]);
      expect(t.e.dealPeople(d.id).map((p) => p.id)).toEqual([a]);
      expect(t.e.sales.deals[d.id]).toMatchObject({ contactName: 'คุณสมชาย ใจดี', phone: '081-234-5678' });
    }
    expect(rows('person/' + a).filter((r) => r.k === 'person/' + a).length).toBeGreaterThan(0);
    // deleted later: the next deal's same typed name becomes a new person, not the deleted record again
    A.e.deletePerson(a);
    await settle(A, B);
    const d2 = B.e.addDeal({ gid: co.id, year: '2570', contactName: 'คุณสมชาย ใจดี' });
    const c = B.e.saveTypedContact(d2.id);
    expect(c).not.toBe(a);
    expect(B.e.people[c].name).toBe('คุณสมชาย ใจดี');
  });

  it('"เพิ่มให้": numbers typed in the deal that the person lacks go on their record, nothing else changes', async () => {
    const [A] = await team();
    const co = companies(A)[0];
    const p = A.e.addPerson({ name: 'คุณธนพล ใจกว้าง', gid: co.id, phone: '081-111-1111' });
    const d = A.e.addDeal({ gid: co.id, year: '2569', contactName: 'ธนพล ใจกว้าง', phone: '02-555-1234 | 081-111-1111', email: 'tp@example.com' });
    A.e.linkPerson(d.id, p);
    A.e.addTypedToPerson(d.id, p);
    expect(A.e.people[p]).toMatchObject({ phone: '081-111-1111 | 02-555-1234', email: 'tp@example.com' });
    expect(A.e.sales.deals[d.id]).toMatchObject({ phone: '02-555-1234 | 081-111-1111', email: 'tp@example.com' });
  });
});

describe('two browsers, an older build', () => {
  it('links made at the same moment both stay, with a teammate\'s edit of the deal and of the person', async () => {
    const [A, B] = await team();
    const co = companies(A)[0];
    const p1 = A.e.addPerson({ name: 'คุณคนแรก', gid: co.id, phone: '080-000-0001' });
    const p2 = A.e.addPerson({ name: 'คุณคนที่สอง', gid: co.id });
    const d = A.e.addDeal({ gid: co.id, year: '2569', resp: 'เอ' });
    await settle(A, B);
    A.e.linkPerson(d.id, p1);
    B.e.linkPerson(d.id, p2);
    B.e.updateDeal(d.id, { resp: 'บี', referral: 'งานสัมมนา' });
    B.e.updatePerson(p1, { phone: '080-000-0009' }, { phone: '080-000-0001' });
    A.e.updatePerson(p1, { pos: 'ผู้จัดการ' }, { pos: '' });
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.dealPeople(d.id).map((p) => p.id).sort()).toEqual([p1, p2].sort());
      expect(t.e.sales.deals[d.id]).toMatchObject({ resp: 'บี', referral: 'งานสัมมนา' });
      expect(t.e.people[p1]).toMatchObject({ phone: '080-000-0009', pos: 'ผู้จัดการ' });
    }
  });

  it('a tab on the older build (cv 5): reads no person from a link, and its whole-record writes of the deal and the person leave the link as it is', async () => {
    const [A, B] = await team();
    const co = companies(A)[0];
    const pid = A.e.addPerson({ name: 'ดร.วรรณา ตัวอย่าง', gid: co.id, phone: '080-000-0101' });
    const d = A.e.addDeal({ gid: co.id, year: '2569', section: 'Retention' });
    A.e.linkPerson(d.id, pid);
    await settle(A, B);
    // what the older build pulls (its gate is a minimum: cv 5 is still served) and how it reads person/ rows
    const pulled = sim.post({ action: 'pull', key: KEY, since: 0, cv: 5 }).rows!;
    const persons = pulled.filter((r) => r.k.startsWith('person/') && !r.del).map((r) => toPerson(r.v, r.k.slice(7))).filter(Boolean);
    expect(persons.map((p) => p!.id)).toEqual([pid]); // no phantom person from the link
    // it writes the deal and the person whole, as it knows them
    const deal = pulled.filter((r) => r.k === 'deal/' + d.id).at(-1)!.v as Record<string, unknown>;
    const person = pulled.filter((r) => r.k === 'person/' + pid).at(-1)!.v as Record<string, unknown>;
    const r = sim.post({ action: 'push', key: KEY, cv: 5, ops: [
      { k: 'deal/' + d.id, v: { ...deal, resp: 'คุณซี', contactName: '' }, by: 'ซี' },
      { k: 'person/' + pid, v: { ...person, phone: '080-000-0303' }, by: 'ซี' },
    ] });
    expect(r.ok).toBe(true);
    await settle(A, B);
    for (const t of [A, B]) {
      expect(t.e.dealContact(t.e.sales.deals[d.id])).toMatchObject({ name: 'ดร.วรรณา ตัวอย่าง', phone: '080-000-0303' });
      expect(t.e.sales.deals[d.id].resp).toBe('คุณซี');
    }
  });

  it('links made before connecting are uploaded; a backup carries them to a browser that lacks them', async () => {
    sim = createGasSim({ teamKey: KEY });
    const C = mk('C', 'ซี');
    const co = companies(C)[0];
    const pid = C.e.addPerson({ name: 'คุณก่อนเชื่อม', gid: co.id });
    const d = C.e.addDeal({ gid: co.id, year: '2569' });
    expect(C.e.linkPerson(d.id, pid)).toBe(true); // this browser alone: no accounts
    expect(await C.e.teamConnect(URL, KEY)).toBe(true);
    await settle(C);
    expect(last(`person/${pid}/${d.id}`)!.v).toMatchObject({ on: 1 });
    const file = Object.assign(new Blob([JSON.stringify({ kind: 'gcc-crm-backup', v: 1, crm: {}, contacts: {}, dedup: {}, custom: {}, sales: { deals: { [d.id]: C.e.sales.deals[d.id] } }, people: C.e.people, plinks: { ...C.e.plinks, junk: { on: 1 } } })]), { name: 'b.json' }) as File;
    const E = mk('E', 'อี');
    await E.e.importCrm(file);
    expect(Object.keys(E.e.plinks)).toEqual([`${pid}/${d.id}`]);
    expect(E.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
    expect(CV).toBe(5); // no new client version: the team script needs no update
  });
});

describe('who may set a deal\'s contact', () => {
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
  it('a viewer reads it and changes nothing (the script refuses it too); sales may; own work only: own deals; deals without contacts: types as before', async () => {
    const L = await lead();
    const S = await member(L, 'aek', 'เอก', 'sales');
    const V = await member(L, 'pla', 'ปลา', 'viewer');
    const { id: own } = await L.e.roleSave({ n: 'ขายเฉพาะงานตัวเอง', d: '', c: { ...BUILTIN.sales.c, 'edit.deal': 'own' } });
    const { id: dealOnly } = await L.e.roleSave({ n: 'ดีลอย่างเดียว', d: '', c: { 'view.sales': 'all', 'view.money': 'all', 'edit.deal': 'all' } });
    const O = await member(L, 'orn', 'อร', own);
    const D = await member(L, 'dao', 'ดาว', dealOnly);
    const co = companies(L)[0];
    const pid = L.e.addPerson({ name: 'คุณทดสอบ สิทธิ์', gid: co.id });
    const p2 = L.e.addPerson({ name: 'คุณอีกคน', gid: co.id });
    const d = L.e.addDeal({ gid: co.id, year: '2569', resp: 'หมิว' });
    expect(L.e.linkPerson(d.id, pid)).toBe(true);
    await settle(L, S, V, O, D);
    // the viewer sees the contact and may not change it
    expect(V.e.dealContact(V.e.sales.deals[d.id]).name).toBe('คุณทดสอบ สิทธิ์');
    expect(V.e.canLink(V.e.sales.deals[d.id])).toBe(false);
    expect(V.e.linkPerson(d.id, p2)).toBe(false);
    expect(V.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
    const refused = sim.post({ action: 'push', tok: V.e.session!.tok, cv: CV, ops: [{ k: `person/${pid}/${d.id}`, v: { on: 0, at: T0.toISOString(), by: 'ปลา', o: 1 } }] });
    // (an account that can only read sends nothing at all)
    expect(refused).toMatchObject({ ok: false, error: 'forbidden' });
    // sales: yes
    expect(S.e.canLink(S.e.sales.deals[d.id])).toBe(true);
    // own work only: another person's deal no, its own yes
    expect(O.e.canLink(O.e.sales.deals[d.id])).toBe(false);
    expect(O.e.linkPerson(d.id, p2)).toBe(false);
    const mine = O.e.addDeal({ gid: co.id, year: '2570' });
    expect(O.e.linkPerson(mine.id, p2)).toBe(true);
    // ดีลและขั้นตอน without ลูกค้าและผู้ติดต่อ: no linking (here or on the script); the typed fields as before
    expect(D.e.canLink(D.e.sales.deals[d.id])).toBe(false);
    expect(D.e.linkPerson(d.id, p2)).toBe(false);
    const theirs = D.e.addDeal({ client: 'บริษัท พิมพ์เอง จำกัด', year: '2569', resp: 'ดาว' });
    D.e.updateDeal(theirs.id, { contactName: 'คุณพิมพ์ เอง', phone: '080-000-0404' });
    expect(sim.post({ action: 'push', tok: D.e.session!.tok, cv: CV, ops: [{ k: `person/${p2}/${theirs.id}`, v: { on: 1, at: T0.toISOString(), by: 'ดาว', o: 1 } }] }).denied).toEqual([`person/${p2}/${theirs.id}`]);
    await settle(L, S, V, O, D);
    expect(L.e.sales.deals[theirs.id]).toMatchObject({ contactName: 'คุณพิมพ์ เอง', phone: '080-000-0404' });
    expect(L.e.dealPeople(mine.id).map((p) => p.id)).toEqual([p2]);
    expect(L.e.dealPeople(d.id).map((p) => p.id)).toEqual([pid]);
  });
});
