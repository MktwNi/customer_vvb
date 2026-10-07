/**
 * Contact persons (ผู้ติดต่อ): the helpers, and people shared between browsers through the real team
 * script (team-sync/Code.gs in the simulator).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { nameKey, personInitial, personSuggestions, phoneKeys, toPerson } from './people';
import { applyRow, keyOf, localRecords, noEffects } from './teamSync';
import { newDeal } from './sales';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/p/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));

describe('people helpers', () => {
  it('reads a person record defensively and keeps fields a later version adds', () => {
    expect(toPerson({ name: '  ' }, 'x')).toBeNull();
    expect(toPerson('nope', 'x')).toBeNull();
    const p = toPerson({ name: 'คุณสมชาย ใจดี', gid: '42', role: 'boss', status: 'gone', note: 'x'.repeat(6000), later: 'kept', nested: { a: 1 } }, 'p1')!;
    expect(p).toMatchObject({ id: 'p1', name: 'คุณสมชาย ใจดี', gid: 42, role: '', status: 'active', later: 'kept' });
    expect(p.note.length).toBe(5000);
    expect('nested' in p).toBe(false);
    expect(toPerson({ name: 'A', gid: null }, 'p2')!.gid).toBeNull();
  });

  it('matches the same person typed differently', () => {
    expect(nameKey('คุณสมชาย ใจดี')).toBe(nameKey('สมชาย  ใจดี'));
    expect(nameKey('Mr. John Smith')).toBe(nameKey('john smith'));
    expect(nameKey('ดร.สมหญิง')).toBe(nameKey('สมหญิง'));
    expect(phoneKeys('+66 81 234 5678 | 02-111-2222 ต่อ 12')).toEqual(['0812345678', '021112222' + '12']);
    expect(personInitial('คุณสมชาย')).toBe('ส');
    expect(personInitial('Dr. Anna')).toBe('A');
  });

  it('suggests contacts named in the Sales Tracker once, and not ones already recorded or hidden', () => {
    const d = (id: string, contactName: string, gid: number | null, phone = '') => newDeal({ id, client: 'บริษัท ' + id, contactName, gid, phone }, 'x');
    const deals = [d('a', 'คุณสมชาย', 10, '081-111-1111'), d('b', 'สมชาย', 10), d('c', 'คุณบี', 10, '0812222222'), d('e', 'คุณดี', null), d('f', '', 11)];
    const people = [toPerson({ name: 'คุณบีบี', gid: 10, phone: '081 222 2222' }, 'p1')!];
    const s = personSuggestions(people, deals, [], (g) => g, new Set());
    expect(s.map((x) => x.name).sort()).toEqual(['คุณดี', 'คุณสมชาย']); // บี has the same phone as บีบี
    expect(s.find((x) => x.name === 'คุณดี')).toMatchObject({ gid: null, company: 'บริษัท e' });
    // the same id on every browser, so two people importing it make one record
    const again = personSuggestions(people, deals.slice().reverse(), [], (g) => g, new Set());
    expect(again.map((x) => x.id).sort()).toEqual(s.map((x) => x.id).sort());
    expect(personSuggestions(people, deals, [], (g) => g, new Set([s[0].id])).length).toBe(1);
  });

  it('person records are shared records, and a malformed row is skipped', () => {
    const st = { crm: { stages: {}, notes: {}, tasks: [], log: {}, owners: {}, watch: [], team: [] }, contacts: {}, dec: {}, sales: { cfg: { sections: [], sources: [], services: [], stages: [] }, deals: {}, steps: {}, docs: {}, log: {} }, custom: {}, people: {} } as never as Parameters<typeof applyRow>[0];
    const fx = noEffects();
    applyRow(st, { seq: 1, k: keyOf.person('p1'), v: { name: 'คุณเอ', gid: 5 }, del: false, by: 'A', at: '' }, fx);
    applyRow(st, { seq: 2, k: keyOf.person('p2'), v: { name: '' }, del: false, by: 'A', at: '' }, fx);
    expect(Object.keys(st.people!)).toEqual(['p1']);
    expect(fx.people).toBe(true);
    expect(localRecords(st).has('person/p1')).toBe(true);
    applyRow(st, { seq: 3, k: keyOf.person('p1'), v: null, del: true, by: 'B', at: '' }, fx);
    expect(st.people).toEqual({});
  });
});

describe('people shared between browsers', () => {
  let base: Dataset, R: RoundRaw[], sim: GasSim;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
    const g = json('gcc.json'), c = json('gcc-certs.json');
    const rows = g.rows.slice(0, 300);
    const ids = new Set(rows.map((r: unknown[]) => r[0]));
    base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
    R = json('rounds.json');
  });
  afterAll(() => vi.useRealTimers());
  const mk = (name: string, store = memoryStore()) => {
    const e = new GccEngine();
    e.base = structuredClone(base);
    e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
    e.ref = '2026-10-06';
    e.store = store;
    (e as unknown as { me: () => string }).me = () => name;
    e.rebuild();
    e.loading = false;
    e.transport = async (_u, body) => sim.post(body);
    return e;
  };
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const settle = async (...es: GccEngine[]) => {
    for (let i = 0; i < 3; i++) for (const e of es) (await e.teamSyncNow(), await tick());
  };
  const team = async () => {
    sim = createGasSim({ teamKey: KEY });
    const A = mk('คุณเอ'), B = mk('คุณบี');
    for (const e of [A, B]) expect(await e.teamConnect(URL, KEY)).toBe(true);
    return [A, B];
  };
  const sheet = (k: string) => {
    const r = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k === k).pop();
    return !r ? undefined : r.del ? null : r.v;
  };

  it('a person added on one browser reaches the other, linked to the same company', async () => {
    const [A, B] = await team();
    const c = A.B.companies[3];
    const id = A.addPerson({ name: 'คุณสมชาย ใจดี', pos: 'ผู้จัดการฝ่ายจัดซื้อ', gid: c.id, phone: '081-111-1111' });
    await settle(A, B);
    expect(B.people[id]).toMatchObject({ name: 'คุณสมชาย ใจดี', pos: 'ผู้จัดการฝ่ายจัดซื้อ', gid: c.id, company: c.name, by: 'คุณเอ' });
    expect(B.peopleOf(c.id).map((p) => p.id)).toEqual([id]);
    A.dispose();
    B.dispose();
  });

  it('two people editing different fields of one person both keep theirs; a deletion wins over a stale edit', async () => {
    const [A, B] = await team();
    const id = A.addPerson({ name: 'คุณบี', gid: A.B.companies[4].id });
    await settle(A, B);
    const open = { ...B.people[id] }; // B opens the form
    A.updatePerson(id, { phone: '02-111-1111' });
    await A.teamSync();
    B.updatePerson(id, { ...open, pos: 'CFO' }, open); // B has not pulled A's phone
    await settle(B, A);
    for (const e of [A, B]) expect(e.people[id]).toMatchObject({ phone: '02-111-1111', pos: 'CFO' });
    A.deletePerson(id);
    await A.teamSync();
    B.updatePerson(id, { line: 'bee' });
    await settle(B, A);
    expect(sheet('person/' + id)).toBeNull();
    for (const e of [A, B]) expect(e.people[id]).toBeUndefined();
    A.dispose();
    B.dispose();
  });

  it('a contact from the Sales Tracker imported on two browsers at once becomes one person, keeping the first', async () => {
    const [A, B] = await team();
    const d = A.addDeal({ client: 'นำเข้าคน', section: 'Partner', year: '2569', contactName: 'คุณดีดี', phone: '0899999999' });
    await settle(A, B);
    const sa = A.personSuggestions().find((x) => x.name === 'คุณดีดี')!;
    const sb = B.personSuggestions().find((x) => x.name === 'คุณดีดี')!;
    expect(sa.id).toBe(sb.id);
    A.addPerson({ name: sa.name, gid: sa.gid, company: sa.company, phone: sa.phone, pos: 'จาก A' }, { id: sa.id, nx: true });
    await A.teamSync();
    B.addPerson({ name: sb.name, gid: sb.gid, company: sb.company, phone: sb.phone, pos: 'จาก B' }, { id: sb.id, nx: true });
    await settle(B, A);
    for (const e of [A, B]) {
      expect(Object.values(e.people).filter((p) => p.name === 'คุณดีดี').length).toBe(1);
      expect(e.people[sa.id].pos).toBe('จาก A');
      expect(e.personSuggestions().some((x) => x.name === 'คุณดีดี')).toBe(false);
    }
    expect(d.id).toBeTruthy();
    A.dispose();
    B.dispose();
  });

  it('calls and notes with a person are shared in the company log, and stay with a person who has no company', async () => {
    const [A, B] = await team();
    const c = A.B.companies[6];
    const p1 = A.addPerson({ name: 'คุณมีบริษัท', gid: c.id });
    const p2 = A.addPerson({ name: 'คุณไม่มีบริษัท', company: 'ร้านเล็ก ๆ' });
    A.addPersonLog(p1, 'call', 'ติดต่อได้', 'คุยเรื่อง CFO');
    A.addPersonLog(p2, 'note', '', 'ชอบให้ส่ง LINE');
    await settle(A, B);
    expect(B.personLogs(B.people[p1]).map((x) => x.l.text)).toEqual(['คุยเรื่อง CFO']);
    expect((B.crm.log[c.id] || []).some((l) => l.pid === p1)).toBe(true); // the company page shows it too
    expect(B.personLogs(B.people[p2]).map((x) => x.l.text)).toEqual(['ชอบให้ส่ง LINE']);
    expect(B.stage(c.id)).toBe('contacted'); // a logged call on a company with no stage, as from the company page
    A.dispose();
    B.dispose();
  });

  it('a person added before connecting is uploaded on the first connect; one at a company on this device only is shared by name', async () => {
    sim = createGasSim({ teamKey: KEY });
    const A = mk('คุณเอ'), B = mk('คุณบี');
    const id = A.addPerson({ name: 'คุณก่อนเชื่อม', gid: A.B.companies[8].id });
    const local = A.addPerson({ name: 'คุณเว็บ TGO', gid: 900123, company: 'บริษัท จากเว็บ จำกัด' }); // not a company everyone has
    expect(A.people[local]).toMatchObject({ gid: null, company: 'บริษัท จากเว็บ จำกัด' });
    for (const e of [A, B]) expect(await e.teamConnect(URL, KEY)).toBe(true);
    await settle(A, B);
    expect(B.people[id]?.name).toBe('คุณก่อนเชื่อม');
    expect(B.people[local]?.company).toBe('บริษัท จากเว็บ จำกัด');
    A.dispose();
    B.dispose();
  });

  it('an appointment made from a person\'s page keeps who it is with through teammates\' edits', async () => {
    const [A, B] = await team();
    const c = A.B.companies[9];
    const pid = A.addPerson({ name: 'คุณนัด', gid: c.id });
    A.addTasks([c.id], { type: 'call', date: '2026-10-09', time: '', note: '' }, 0, pid);
    await settle(A, B);
    const t = B.crm.tasks.find((x) => x.pid === pid)!;
    B.toggleTask(t);
    B.updateTask(t.id, { type: 'meet', date: '2026-10-12', time: '10:00', note: 'นัดที่ออฟฟิศ' });
    await settle(B, A);
    expect(A.crm.tasks.find((x) => x.id === t.id)).toMatchObject({ pid, done: true, type: 'meet' });
    A.dispose();
    B.dispose();
  });
});
