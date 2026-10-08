/**
 * Several people (and one person with two tabs) changing the same records within the 30-second poll
 * window, or while a push fails, run against the real team script (team-sync/Code.gs in the
 * simulator). Each case keeps both people's changes, or lets a deletion stand, instead of the stale
 * copy of one browser undoing the other's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { TeamSyncError } from './teamSync';
import type { PlanInput } from './sales';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/c/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));

/** A browser's network: offline, the next push failing (no reply, or HTTP 500), or held in flight. */
interface Net { offline: boolean; fail: null | 'drop' | 'http500'; hold: null | Promise<void> }
type Store = ReturnType<typeof memoryStore>;

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

function mk(name: string, store: Store, net: Net) {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = '2026-10-06';
  e.store = store;
  (e as unknown as { me: () => string }).me = () => name;
  e.rebuild();
  e.loading = false;
  e.transport = async (_u, body) => {
    if (net.offline) throw new TypeError('Failed to fetch');
    if (body.action === 'push' && net.hold) {
      const h = net.hold;
      net.hold = null;
      await h;
    }
    if (body.action === 'push' && net.fail) {
      const f = net.fail;
      net.fail = null;
      if (f === 'drop') throw new TypeError('Failed to fetch');
      throw new TeamSyncError('เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP 500)'); // no code: it may have been delivered
    }
    return sim.post(body);
  };
  return e;
}
/** People (separate browsers); `tab: true` = a second tab of the previous person's browser. */
async function team(...spec: { name: string; tab?: boolean }[]) {
  sim = createGasSim({ teamKey: KEY });
  const out: { e: GccEngine; net: Net }[] = [];
  let prev: { store: Store; net: Net } | null = null;
  for (const s of spec) {
    const store: Store = s.tab && prev ? prev.store : memoryStore();
    const net: Net = s.tab && prev ? prev.net : { offline: false, fail: null, hold: null };
    out.push({ e: mk(s.name, store, net), net });
    prev = { store, net };
  }
  for (const x of out) expect(await x.e.teamConnect(URL, KEY)).toBe(true);
  await settle(...out.map((x) => x.e));
  return out;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
/** Everyone syncs until nothing is left to exchange. */
async function settle(...es: GccEngine[]) {
  for (let i = 0; i < 3; i++)
    for (const e of es) {
      await e.teamSyncNow();
      await tick();
    }
}
/** Wait until this tab's queued changes are stored (shared with its other tabs). */
const stored = (e: GccEngine) => (e as unknown as { pq: Promise<unknown> }).pq;
function sheet(k: string): unknown {
  const r = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k === k);
  const l = r[r.length - 1];
  return !l ? undefined : l.del ? null : l.v;
}
const later = (s: number) => vi.setSystemTime(Date.now() + s * 1000);
const done = (...es: GccEngine[]) => es.forEach((e) => e.dispose());

describe('two people editing the same record within the poll window', () => {
  it('a company contact: one changes the phone, the other (stale) the e-mail — both are kept', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = A.B.companies.find((x) => x.ids.length === 1 && !x.email)!;
    const open = { phone: c.phone || '', email: '', web: c.web || '', note: '' };
    A.saveContact(A.company(c.id)!, { ...open, phone: '02-111-1111' });
    await A.teamSync();
    later(15);
    B.saveContact(B.company(c.id)!, { ...open, email: 'buyer@example.co.th' }); // B has not pulled A's phone
    await settle(B, A);
    for (const e of [A, B]) expect(e.contacts[c.id]).toMatchObject({ phone: '02-111-1111', email: 'buyer@example.co.th' });
    done(A, B);
  });

  it('a contact form opened before a teammate\'s change only writes what was changed in it', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = A.B.companies.find((x) => x.ids.length === 1 && !x.email)!;
    const open = { phone: c.phone || '', email: '', web: c.web || '', note: '' }; // B opens the form
    A.saveContact(A.company(c.id)!, { ...open, phone: '02-222-2222' });
    await settle(A, B); // B has A's phone now, but its open form still shows the old one
    B.saveContact(B.company(c.id)!, { ...open, note: 'คุณสมชาย ฝ่ายจัดซื้อ' }, open);
    await settle(B, A);
    for (const e of [A, B]) expect(e.contacts[c.id]).toMatchObject({ phone: '02-222-2222', note: 'คุณสมชาย ฝ่ายจัดซื้อ' });
    done(A, B);
  });

  it('an appointment: a reschedule and a "done" tick from a stale browser are both kept, in either order', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const [c1, c2] = A.B.companies.slice(0, 2);
    A.addTasks([c1.id, c2.id], { type: 'call', date: '2026-10-08', time: '', note: '' });
    await settle(A, B);
    const [t1, t2] = A.crm.tasks.slice(-2);
    A.updateTask(t1.id, { type: 'call', date: '2026-10-15', time: '14:00', note: 'ลูกค้าขอเลื่อน' });
    await A.teamSync();
    B.toggleTask(B.crm.tasks.find((t) => t.id === t1.id)!); // stale: still the 8th
    B.toggleTask(B.crm.tasks.find((t) => t.id === t2.id)!);
    await B.teamSync();
    A.updateTask(t2.id, { type: 'meet', date: '2026-10-20', time: '', note: '' }); // A has not seen B's tick
    await settle(A, B);
    for (const e of [A, B]) {
      expect(e.crm.tasks.find((t) => t.id === t1.id)).toMatchObject({ date: '2026-10-15', time: '14:00', note: 'ลูกค้าขอเลื่อน', done: true });
      expect(e.crm.tasks.find((t) => t.id === t2.id)).toMatchObject({ type: 'meet', date: '2026-10-20', done: true });
    }
    done(A, B);
  });

  it('an appointment a teammate deleted stays deleted when a stale browser ticks it', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    A.addTasks([A.B.companies[0].id], { type: 'call', date: '2026-10-08', time: '', note: '' });
    await settle(A, B);
    const id = A.crm.tasks[A.crm.tasks.length - 1].id;
    A.delTask(A.crm.tasks.find((t) => t.id === id)!);
    await A.teamSync();
    later(20);
    B.toggleTask(B.crm.tasks.find((t) => t.id === id)!);
    await settle(B, A);
    expect(sheet('task/' + id)).toBeNull();
    for (const e of [A, B]) expect(e.crm.tasks.some((t) => t.id === id)).toBe(false);
    done(A, B);
  });

  it('a stage step: a date set from a stale view keeps the note a teammate just wrote', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const d = A.addDeal({ client: 'ขั้นตอนพร้อมกัน', section: 'Partner', year: '2569' });
    await settle(A, B);
    A.setStep(d.id, 'FOLLOW1', { d: '2026-10-06', n: 'ลูกค้าขอใบเสนอราคาใหม่' });
    await A.teamSync();
    B.setStep(d.id, 'FOLLOW1', { d: '2026-10-05', n: '' }); // B's inline date box, with the empty note it saw
    await settle(B, A);
    for (const e of [A, B]) expect(e.sales.steps[`${d.id}/FOLLOW1`]).toEqual({ d: '2026-10-05', n: 'ลูกค้าขอใบเสนอราคาใหม่' });
    done(A, B);
  });

  it('a stage step a teammate cleared keeps what a stale browser writes there', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const d = A.addDeal({ client: 'ล้างขั้นตอน', section: 'Partner', year: '2569' });
    A.setStep(d.id, 'CALL1', { d: '2026-10-01', n: 'โทรแล้ว' });
    await settle(A, B);
    A.setStep(d.id, 'CALL1', { d: '', n: '' });
    await A.teamSync();
    B.setStep(d.id, 'CALL1', { d: '2026-10-01', n: 'โทรแล้ว นัดพรุ่งนี้' });
    await settle(B, A);
    for (const e of [A, B]) expect(e.sales.steps[`${d.id}/CALL1`]).toEqual({ d: '2026-10-01', n: 'โทรแล้ว นัดพรุ่งนี้' });
    done(A, B);
  });

  it('SOURCE / Services: two people ticking different items on one deal both keep their tick', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const src = A.sales.cfg.sources;
    const d = A.addDeal({ client: 'ติ๊กพร้อมกัน', section: 'Partner', year: '2569', source: [src[0]], service: [] });
    await settle(A, B);
    A.updateDeal(d.id, { source: [src[0], src[1]] }); // as DealPanel's chip does: the whole new list
    await A.teamSync();
    later(2);
    B.updateDeal(d.id, { source: [src[0], src[2]] });
    B.updateDeal(d.id, { source: [src[2]] }); // and unticks the first
    await settle(B, A);
    for (const e of [A, B]) expect([...e.sales.deals[d.id].source].sort()).toEqual([src[1], src[2]].sort());
    done(A, B);
  });

  it('logging a call from a stale browser never moves a teammate\'s sales stage back to "contacted"', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = A.B.companies[5];
    A.setStage(c.id, 'proposal');
    await A.teamSync();
    later(5);
    B.addLog(c.id, 'call', '', 'โทรหาฝ่ายจัดซื้อ'); // B still sees no stage: sets "contacted" automatically
    expect(B.stage(c.id)).toBe('contacted');
    await settle(B, A);
    for (const e of [A, B]) {
      expect(e.stage(c.id)).toBe('proposal');
      expect((e.crm.log[c.id] || []).some((l) => l.text === 'โทรหาฝ่ายจัดซื้อ')).toBe(true);
    }
    done(A, B);
  });
});

describe('a person with two tabs, and pushes that fail', () => {
  it('a field changed in one tab is not overwritten by the other tab\'s edit of another field', async () => {
    const [{ e: T1, net }, { e: T2 }, { e: B }] = await team({ name: 'A' }, { name: 'A', tab: true }, { name: 'B' });
    const d = B.addDeal({ client: 'สองแท็บ', section: 'Partner', year: '2569' });
    await settle(B, T1, T2);
    net.offline = true;
    T2.updateDeal(d.id, { forecast: 500000 });
    await stored(T2);
    await T1.teamSync(); // fails offline, but loads the queue the tabs share
    T1.updateDeal(d.id, { phone: '021234567' });
    await stored(T1);
    net.offline = false;
    await settle(T1, T2, B);
    expect(sheet('deal/' + d.id)).toMatchObject({ forecast: 500000, phone: '021234567' });
    for (const e of [T1, T2, B]) expect(e.sales.deals[d.id]).toMatchObject({ forecast: 500000, phone: '021234567' });
    done(T1, T2, B);
  });

  it('a change one tab queued on an older copy does not undo what the other tab already pulled', async () => {
    const [{ e: T1 }, { e: T2 }, { e: B }] = await team({ name: 'A' }, { name: 'A', tab: true }, { name: 'B' });
    const d = B.addDeal({ client: 'แท็บเก่า', section: 'Partner', year: '2569' });
    await settle(B, T1, T2);
    B.updateDeal(d.id, { jobStatus: 'closed' });
    await B.teamSync();
    await T2.teamSync(); // T2 pulls the closing; T1 has not
    T1.updateDeal(d.id, { phone: '024444444' });
    await stored(T1);
    await T2.teamSync(); // T2 sends T1's queued change
    await settle(T1, T2, B);
    expect(sheet('deal/' + d.id)).toMatchObject({ jobStatus: 'closed', phone: '024444444' });
    done(T1, T2, B);
  });

  it('a list edited twice before the first edit reaches the sheet is applied once', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const cur = A.sales.cfg.services.slice();
    A.setSalesList('sections', [...A.sales.cfg.sections, 'Webinr']);
    A.renameSection('Webinr', 'Webinar'); // fixing the typo right away
    A.setSalesList('services', [...cur, 'ทดลอง']);
    A.setSalesList('services', cur); // added, then removed
    await settle(A, B);
    for (const e of [A, B]) {
      expect(e.sales.cfg.sections.filter((x) => x.startsWith('Webin'))).toEqual(['Webinar']);
      expect(e.sales.cfg.services).toEqual(cur);
    }
    done(A, B);
  });

  it('a change made while the previous push was in flight is not lost when its own push fails', async () => {
    const [{ e: A, net }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = A.B.companies[7];
    A.setStage(c.id, 'interested');
    let release!: () => void;
    net.hold = new Promise<void>((r) => (release = r));
    const round = A.teamSync();
    await tick();
    A.setStage(c.id, 'won'); // while 'interested' is being pushed
    await stored(A);
    net.fail = 'drop'; // the push that carries 'won' gets no reply
    release();
    await round;
    await settle(A, B);
    expect(sheet('stage/' + c.id)).toBe('won');
    for (const e of [A, B]) expect(e.stage(c.id)).toBe('won');
    done(A, B);
  });

  it('a deletion whose push got no reply still wins over a teammate\'s edit made meanwhile', async () => {
    const [{ e: A }, { e: B, net }] = await team({ name: 'A' }, { name: 'B' });
    const d = A.addDeal({ client: 'ลบแล้วส่งไม่ผ่าน', section: 'Partner', year: '2569' });
    await settle(A, B);
    net.fail = 'http500';
    B.deleteDeal(d.id);
    await B.teamSync(); // HTTP 500: it may or may not have reached the sheet
    A.updateDeal(d.id, { phone: '029999999' });
    await A.teamSync();
    await settle(B, A);
    expect(sheet('deal/' + d.id)).toBeNull();
    for (const e of [A, B]) expect(e.sales.deals[d.id]).toBeUndefined();
    done(A, B);
  });

  it('a delivered push whose own row was compacted away is not sent again over a teammate\'s later change', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = A.B.companies[9];
    const t = A.transport;
    A.transport = async (u, body) => {
      const r = await t(u, body);
      if (body.action === 'push') throw new TypeError('Failed to fetch'); // reached the sheet, reply lost
      return r;
    };
    A.setStage(c.id, 'proposal');
    await A.teamSync();
    A.transport = t;
    await B.teamSync();
    B.setStage(c.id, 'won');
    await B.teamSync();
    sim.props.COMPACT_AT = '10'; // the sheet is compacted: A's superseded row goes
    sim.post({ action: 'push', key: KEY, ops: Array.from({ length: 60 }, (_, i) => ({ k: 'team/Z', v: 1, by: 'Z' + i })) });
    await settle(A, B);
    expect(sheet('stage/' + c.id)).toBe('won');
    for (const e of [A, B]) expect(e.stage(c.id)).toBe('won');
    done(A, B);
  });

  it('a record the other tab already saw deleted stays deleted when it sends a stale tab\'s edit', async () => {
    const [{ e: T1 }, { e: T2 }, { e: B }] = await team({ name: 'A' }, { name: 'A', tab: true }, { name: 'B' });
    const d = B.addDeal({ client: 'ลบแล้วแท็บเก่า', section: 'Partner', year: '2569' });
    B.addTasks([B.B.companies[0].id], { type: 'call', date: '2026-10-08', time: '', note: '' });
    await settle(B, T1, T2);
    const tid = B.crm.tasks[B.crm.tasks.length - 1].id;
    B.deleteDeal(d.id);
    B.delTask(B.crm.tasks.find((x) => x.id === tid)!);
    await B.teamSync();
    await T2.teamSync(); // T2 pulls the deletions; T1 has not
    T1.updateDeal(d.id, { phone: '021112222' });
    T1.toggleTask(T1.crm.tasks.find((x) => x.id === tid)!);
    await stored(T1);
    await T2.teamSync(); // T2 sends T1's queued changes
    await settle(T1, T2, B);
    expect(sheet('deal/' + d.id)).toBeNull();
    expect(sheet('task/' + tid)).toBeNull();
    for (const e of [T1, T2, B]) {
      expect(e.sales.deals[d.id]).toBeUndefined();
      expect(e.crm.tasks.some((x) => x.id === tid)).toBe(false);
    }
    done(T1, T2, B);
  });

  it('a stage set automatically in one tab yields to the stage set by hand in the other', async () => {
    const [{ e: T1, net }, { e: T2 }, { e: B }] = await team({ name: 'A' }, { name: 'A', tab: true }, { name: 'B' });
    const c = T1.B.companies[11];
    net.offline = true;
    T2.setStage(c.id, 'proposal');
    await stored(T2);
    T1.addLog(c.id, 'call', '', 'โทรแล้ว'); // T1 still shows no stage: sets "contacted" automatically
    await stored(T1);
    net.offline = false;
    await settle(T1, T2, B);
    expect(sheet('stage/' + c.id)).toBe('proposal');
    for (const e of [T1, T2, B]) expect(e.stage(c.id)).toBe('proposal');
    done(T1, T2, B);
  });

  it('SOURCE ticks queued before a disconnect still merge with a teammate\'s after reconnecting', async () => {
    const [{ e: A, net }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const src = A.sales.cfg.sources;
    const d = A.addDeal({ client: 'ต่อใหม่', section: 'Partner', year: '2569', source: [src[0]], service: [] });
    await settle(A, B);
    net.offline = true;
    A.updateDeal(d.id, { source: [src[0], src[1]] });
    await stored(A);
    B.updateDeal(d.id, { source: [src[0], src[2]] });
    await B.teamSync();
    A.teamDisconnect();
    net.offline = false;
    expect(await A.teamConnect(URL, KEY)).toBe(true);
    await settle(A, B);
    for (const e of [A, B]) expect([...e.sales.deals[d.id].source].sort()).toEqual([src[0], src[1], src[2]].sort());
    done(A, B);
  });

  it('ticking and unticking an item on an imported deal not shared yet leaves it as imported', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const s0 = A.sales.cfg.sources[0], s1 = A.sales.cfg.sources[1];
    const f = () => Object.assign(new Blob([JSON.stringify({ sources: [s0], rows: [{ type: 'section', name: 'TGO' }, { type: 'client', client: 'นำเข้าซ้ำ', source: [s0] }] })]), { name: 'same.json' }) as File;
    await A.importTracker(f(), '2561');
    await A.teamSync();
    await B.importTracker(f(), '2561'); // B has not pulled A's import: create-only rows
    await stored(B);
    const d = Object.values(B.sales.deals).find((x) => x.client === 'นำเข้าซ้ำ')!;
    const before = [...d.source];
    B.updateDeal(d.id, { source: [...before, s1] });
    await stored(B);
    B.updateDeal(d.id, { source: before });
    await stored(B);
    B.updateDeal(d.id, { source: before.filter((x) => x !== s0) });
    await stored(B);
    B.updateDeal(d.id, { source: before });
    await stored(B);
    await settle(B, A);
    for (const e of [A, B]) expect(e.sales.deals[d.id].source).toEqual(before);
    done(A, B);
  });

  it('a push that was delivered but whose reply was lost is not sent again over a teammate\'s later change', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const c = A.B.companies[9];
    const t = A.transport;
    A.transport = async (u, body) => {
      const r = await t(u, body);
      if (body.action === 'push') throw new TypeError('Failed to fetch'); // reached the sheet, reply lost
      return r;
    };
    A.setStage(c.id, 'proposal');
    await A.teamSync();
    A.transport = t;
    await B.teamSync();
    B.setStage(c.id, 'won');
    await B.teamSync();
    await settle(A, B);
    expect(sheet('stage/' + c.id)).toBe('won');
    for (const e of [A, B]) expect(e.stage(c.id)).toBe('won');
    done(A, B);
  });
});

describe('payment plan installments (dpay) edited by two people', () => {
  const line = (stage: string, amt: number, o: Partial<PlanInput> = {}): PlanInput => ({ stage, amt, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', ...o });
  /** A won deal with a two-installment plan that both browsers have. */
  async function planned(A: GccEngine, B: GccEngine, client: string) {
    const d = A.addDeal({ client, section: 'Partner', year: '2569' });
    A.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    A.setPlan(d.id, [line('PAY1', 53500, { rel: 0 }), line('PAY2', 53500, { due: '2026-10-20' })]);
    await settle(A, B);
    expect(B.sales.pays[`${d.id}/PAY2`]).toMatchObject({ amt: 53500 });
    return d;
  }

  it('one records a payment while the other (stale) edits the terms: both are kept, in either order', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const d = await planned(A, B, 'แผนชำระพร้อมกัน');
    A.markPaid(d.id, 'PAY2', { date: '2026-10-05', amount: 52000, how: 'cheque' });
    await A.teamSync();
    later(10);
    B.updatePayLine(d.id, 'PAY2', { note: 'เมื่อส่งรายงาน CFO', due: '2026-10-25' }); // has not seen the payment
    await settle(B, A);
    for (const e of [A, B]) expect(e.sales.pays[`${d.id}/PAY2`]).toMatchObject({ rcv: '2026-10-05', got: 52000, how: 'cheque', note: 'เมื่อส่งรายงาน CFO', due: '2026-10-25', amt: 53500 });
    A.updatePayLine(d.id, 'PAY1', { amt: 50000, note: 'มัดจำ' });
    await A.teamSync();
    later(10);
    B.markPaid(d.id, 'PAY1', { date: '2026-10-06', amount: null }); // the stale one records the payment
    await settle(B, A);
    for (const e of [A, B]) expect(e.sales.pays[`${d.id}/PAY1`]).toMatchObject({ amt: 50000, note: 'มัดจำ', rcv: '2026-10-06', got: null });
    expect(sheet(`dpay/${d.id}/PAY1`)).toMatchObject({ amt: 50000, rcv: '2026-10-06' });
    done(A, B);
  });

  it('different fields of one installment both stay; the same field: the later edit', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const d = await planned(A, B, 'แก้งวดพร้อมกัน');
    A.updatePayLine(d.id, 'PAY2', { amt: 60000 });
    await A.teamSync();
    B.updatePayLine(d.id, 'PAY2', { how: 'cash' });
    await settle(B, A);
    for (const e of [A, B]) expect(e.sales.pays[`${d.id}/PAY2`]).toMatchObject({ amt: 60000, how: 'cash' });
    A.updatePayLine(d.id, 'PAY2', { note: 'ของเอ' });
    await A.teamSync();
    later(5);
    B.updatePayLine(d.id, 'PAY2', { note: 'ของบี' });
    await settle(B, A);
    for (const e of [A, B]) expect(e.sales.pays[`${d.id}/PAY2`].note).toBe('ของบี');
    done(A, B);
  });

  it('an installment one person removed stays removed when a stale browser edits it', async () => {
    const [{ e: A }, { e: B }] = await team({ name: 'A' }, { name: 'B' });
    const d = await planned(A, B, 'ลบงวดพร้อมกัน');
    expect(A.setPlan(d.id, [line('PAY1', 107000, { rel: 0 })])).toEqual({ kept: [] });
    await A.teamSync();
    B.updatePayLine(d.id, 'PAY2', { note: 'แก้ทีหลัง' });
    await settle(B, A);
    for (const e of [A, B]) {
      expect(e.sales.pays[`${d.id}/PAY2`]).toBeUndefined();
      expect(e.sales.pays[`${d.id}/PAY1`]).toMatchObject({ amt: 107000 });
    }
    expect(sheet(`dpay/${d.id}/PAY2`)).toBeNull();
    done(A, B);
  });

  it('a plan made in one tab and a payment recorded in the other tab of the same browser both go out', async () => {
    const [{ e: A }, { e: A2 }, { e: B }] = await team({ name: 'A' }, { name: 'A', tab: true }, { name: 'B' });
    const d = await planned(A, B, 'สองแท็บแผนชำระ');
    await settle(A2);
    A.updatePayLine(d.id, 'PAY1', { note: 'แก้ในแท็บแรก' });
    await stored(A);
    A2.markPaid(d.id, 'PAY1', { date: '2026-10-04', amount: null });
    await settle(A2, A, B);
    for (const e of [A, A2, B]) expect(e.sales.pays[`${d.id}/PAY1`]).toMatchObject({ note: 'แก้ในแท็บแรก', rcv: '2026-10-04' });
    done(A, A2, B);
  });
});
