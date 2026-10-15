/**
 * Notifications and the quotation check in the engine (package notify): against the team script deployed
 * today (team-sync/Code.gs in the simulator: no `notify` in hello, no qt_check / notify_* actions), and
 * against a script with notifications, played here by a thin layer over the same simulator that adds what
 * the notify impl-note defines: hello's `notify:{on, since}`, me.notify, `qt_check` (fingerprint, latest
 * row, self-check, note, undo: it appends the `qchk/` row and a history line), `notify_me`,
 * `notify_verify`, `notify_test`, `notify_status`. The layer is the contract, not the server.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { NOTIFY_CFG0, bellItems, fpOf, sameFp, type QtFp } from './notify';
import { sameName } from './caps';
import type { Role } from './teamSync';
import type { DealDoc } from './sales';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/n/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));

const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 80);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The notification side of the stand-in script (null: today's script). */
interface Nf { on: boolean; since: string; self: boolean; users: Record<string, Record<string, unknown>>; codes: Record<string, string>; tests: string[] }
let nf: Nf | null = null;
const sent: Record<string, unknown>[] = [];
interface Tab { e: GccEngine; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  nf = null;
  sent.length = 0;
});

const fail = (error: string) => ({ ok: false, error });
function layer(body: Record<string, unknown>): Record<string, unknown> {
  sent.push(body);
  const a = String(body.action);
  if (!nf) return sim.post(body);
  if (a === 'hello') return { ...sim.post(body), notify: { on: nf.on ? 1 : 0, since: nf.since } };
  const mine = ['qt_check', 'notify_me', 'notify_verify', 'notify_test', 'notify_status'];
  if (!mine.includes(a)) {
    const r = sim.post(body) as Record<string, unknown>;
    const u = (r.me as { u?: string } | undefined)?.u;
    if (u && r.me) r.me = { ...(r.me as object), notify: nf.users[u] || { em: '', ok: 0, on: { qt: 1, res: 1, dg: 1, pre: 0 }, t: '07:30', sc: 'mine' } };
    return r;
  }
  const who = sim.post({ ...body, action: 'me' }) as Record<string, unknown>;
  if (!who.ok) return who;
  const me = who.me as { u: string; name: string; role: string };
  const reply = (x: Record<string, unknown> = {}) => ({ ok: true, ...x, me: { ...me, notify: nf!.users[me.u] } });
  const tok = body.tok;
  switch (a) {
    case 'qt_check': {
      if (me.role !== 'admin') return fail('forbidden'); // (before configurable roles: qt.check = admin)
      const k = String(body.k), docId = k.split('/')[2];
      const rows = sim.post({ action: 'pull', tok, cv: 4, since: 0 }).rows!;
      const now = new Date().toISOString();
      if (body.st === 'undo') {
        const last = rows.filter((r) => r.k === 'qchk/' + docId).at(-1);
        if (!last || last.del || last.by !== me.name || Date.parse(now) - Date.parse(last.at || now) > 10 * 60000) return fail('too_late');
        sim.post({ action: 'push', tok, cv: 4, ops: [{ k: 'qchk/' + docId, del: true }] });
        return reply({ rec: null });
      }
      // the latest non-deleted row for this document, and its fingerprint as sent
      const row = rows.filter((r) => r.k.startsWith('ddoc/') && r.k.endsWith('/' + docId)).at(-1);
      if (!row || row.del || row.k !== k) return fail('changed');
      const doc = row.v as DealDoc;
      if (!sameFp(fpOf(doc), body.fp as QtFp)) return fail('changed');
      if (!nf.self && (sameName(doc.by, me.name) || sameName(row.by, me.name))) return fail('self_check');
      const note = String(body.note || '').trim();
      if (body.st === 'back' && !note) return fail('note_required');
      const rec = { st: body.st, by: me.name, at: now, fp: body.fp, ...(note ? { note } : {}), via: body.s === 'good-sig' ? 'mail' : 'app', u: me.u };
      const r = sim.post({ action: 'push', tok, cv: 4, ops: [{ k: 'qchk/' + docId, v: rec }, { k: 'dlog/c' + docId + now, v: { at: now, by: me.name, action: body.st === 'ok' ? 'ตรวจใบเสนอราคาแล้ว' : 'ส่งใบเสนอราคากลับแก้ไข', client: '', detail: note, deal: k.split('/')[1] } }] });
      return r.ok ? reply({ rec }) : r;
    }
    case 'notify_me': {
      const u = me.u, cur = nf.users[u] || { em: '', ok: 0, on: { qt: 1, res: 1, dg: 1, pre: 0 }, t: '07:30', sc: 'mine' };
      if (body.get) return reply();
      const next: Record<string, unknown> = { ...cur, on: body.on, t: body.t, sc: body.sc };
      if (typeof body.em === 'string' && body.em !== cur.em) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.em)) return fail('bad_email');
        next.em = body.em;
        next.ok = 0;
        nf.codes[u] = '123456';
      }
      nf.users[u] = next;
      return reply();
    }
    case 'notify_verify': {
      if (body.code !== nf.codes[me.u]) return fail('code_wrong');
      nf.users[me.u] = { ...nf.users[me.u], ok: 1 };
      return reply();
    }
    case 'notify_test':
      if (!nf.users[me.u]?.ok) return fail('no_email');
      nf.tests.push(me.u);
      return reply();
    case 'notify_status':
      if (me.role !== 'admin') return fail('forbidden');
      return reply({ on: nf.on ? 1 : 0, since: nf.since, last: { at: '2026-10-12T03:00:00Z', ok: true, sent: 2 }, quota: { sent: 14, left: 86 }, from: 'owner@example.com', users: nf.users });
  }
  return fail('unknown_action');
}

function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-12';
  raw.store = memoryStore();
  raw.rebuild();
  raw.loading = false;
  raw.transport = async (_u, body) => layer(body);
  raw.fileTransport = async (_u, body) => layer(body);
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
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const qt = (amount: number, docNo = 'QT-2569-021') => ({ kind: 'quotation' as const, amount, target: 'forecast' as const, basis: 'total' as const, detected: amount, docNo, docDate: '2026-10-12', stage: 'QUOTATION' });
const docIn = (t: Tab, d: DealDoc) => t.e.sales.docs[`${d.deal}/${d.id}`];
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('against the team script deployed today (no notifications)', () => {
  it('no check anywhere and the setup state; the bell has payments and appointments only; the actions say which update they need', async () => {
    const L = await lead();
    const S = await member(L, 'ekk', 'เอก', 'sales');
    const d = S.e.addDeal({ client: 'บริษัท ดูราฟลอร์ จำกัด' });
    const doc = await S.e.attachDoc(d.id, pdf('QT-2569-021.pdf'), qt(101650));
    await settle(S, L);
    // the script was asked (accounts mode too) and said nothing about notifications
    expect(sent.some((b) => b.action === 'hello')).toBe(true);
    expect(L.e.notifyLive).toBeNull();
    expect(L.e.qtLive).toBe(false);
    expect(L.e.qtCheckFor(docIn(L, doc))).toBeNull();
    expect(L.e.checkBlock(docIn(L, doc))).toBe('off');
    expect(L.e.myNotifyLive).toBe(false);
    const b = bellItems({ S: L.e.sales, tasks: [], owners: {}, coName: () => '', me: 'หมิว', caps: L.e.myCaps(), live: L.e.notifyLive, checks: L.e.checks(), cfg: L.e.notifyCfg(), scope: 'team', today: '2026-10-12' });
    expect(b.groups.some((g) => g.kind === 'chk' || g.kind === 'mine')).toBe(false);
    await expect(L.e.qtCheck(docIn(L, doc), 'ok')).rejects.toThrow(/ยังไม่รองรับการแจ้งเตือนและการตรวจใบเสนอราคา/);
    await expect(S.e.notifyMe()).rejects.toThrow(/ยังไม่รองรับการแจ้งเตือน/);
    // the bell's scope is kept in this browser until then
    expect(S.e.bellScope()).toBe('mine');
    S.e.setBellScope('team');
    expect(S.e.bellScope()).toBe('team');
    expect(L.e.bellScope()).toBe('team');
  });
});

describe('against a script with notifications', () => {
  async function world() {
    nf = { on: true, since: '2026-10-01', self: false, users: {}, codes: {}, tests: [] };
    const L = await lead();
    const S = await member(L, 'ekk', 'เอก', 'sales');
    await settle(L);
    const d = S.e.addDeal({ client: 'บริษัท ดูราฟลอร์ จำกัด' });
    const doc = await S.e.attachDoc(d.id, pdf('QT-2569-021.pdf'), qt(101650));
    await settle(S, L, S);
    return { L, S, d, doc };
  }

  it('hello says it is on and since when; it is remembered in this browser; a new quotation waits for a checker', async () => {
    const { L, S, doc } = await world();
    expect(L.e.notifyLive).toEqual({ on: true, since: '2026-10-01' });
    expect(L.e.qtLive).toBe(true);
    expect(JSON.parse(LS.get('L')!.get('gcc-notify-live')!)).toMatchObject({ url: URL, f: { on: true, since: '2026-10-01' } });
    expect(L.e.qtCheckFor(docIn(L, doc))).toMatchObject({ status: 'wait', rec: null, stale: null });
    expect(L.e.checkBlock(docIn(L, doc))).toBe('');
    // the uploader (a sales account without the check) reads only
    expect(S.e.checkBlock(doc)).toBe('cap');
    // me.notify came with the replies
    expect(S.e.myNotifyLive).toBe(true);
    expect(S.e.myNotify()).toMatchObject({ em: '', ok: false, sc: 'mine' });
  });

  it('approve: the record shows at once and reaches the uploader with its history line; an edit makes it wait again', async () => {
    const { L, S, d, doc } = await world();
    await L.e.qtCheck(docIn(L, doc), 'ok', '', 'good-sig');
    expect(L.e.qtCheckFor(docIn(L, doc))).toMatchObject({ status: 'ok', rec: { by: 'หมิว', st: 'ok' } });
    await settle(L, S);
    expect(S.e.qtCheckFor(docIn(S, doc))).toMatchObject({ status: 'ok', rec: { by: 'หมิว', via: 'mail', u: 'lead' } });
    expect(Object.values(S.e.sales.log).some((x) => x.action === 'ตรวจใบเสนอราคาแล้ว' && x.deal === d.id)).toBe(true);
    // the uploader corrects the amount: waiting again, nothing written
    S.e.updateDoc(d.id, doc.id, { amount: 95000 });
    expect(S.e.qtCheckFor(docIn(S, doc))).toMatchObject({ status: 'wait', stale: { st: 'ok' } });
    // a checker with the old figure is refused: changed
    const old = { ...docIn(L, doc) };
    await settle(S, L);
    await expect(L.e.qtCheck(old, 'ok')).rejects.toMatchObject({ code: 'changed', message: expect.stringMatching(/เพิ่งถูกแก้ไข/) });
    expect(L.e.qtCheckFor(docIn(L, doc))!.status).toBe('wait');
  });

  it('send back needs a note; the note reaches the uploader; undo takes the checker\'s own latest back', async () => {
    const { L, S, doc } = await world();
    await expect(L.e.qtCheck(docIn(L, doc), 'back', '  ')).rejects.toThrow('ใส่ข้อความบอกว่าต้องแก้อะไร');
    await L.e.qtCheck(docIn(L, doc), 'back', 'เลขที่ซ้ำกับใบของ ดีไวน์สตาร์ช');
    await settle(L, S);
    expect(S.e.qtCheckFor(docIn(S, doc))).toMatchObject({ status: 'back', rec: { note: 'เลขที่ซ้ำกับใบของ ดีไวน์สตาร์ช' } });
    const b = bellItems({ S: S.e.sales, tasks: [], owners: {}, coName: () => '', me: 'เอก', caps: S.e.myCaps(), live: S.e.notifyLive, checks: S.e.checks(), cfg: S.e.notifyCfg(), scope: 'mine', today: '2026-10-12' });
    expect(b.groups[0]).toMatchObject({ kind: 'mine', n: 1 });
    later(60000);
    await L.e.qtCheck(docIn(L, doc), 'undo');
    expect(L.e.qtCheckFor(docIn(L, doc))!.status).toBe('wait');
    await settle(L, S);
    expect(S.e.qtCheckFor(docIn(S, doc))!.status).toBe('wait');
    // too late now: nothing to take back
    await expect(L.e.qtCheck(docIn(L, doc), 'undo')).rejects.toThrow(/เลิกทำได้ภายใน 10 นาที/);
  });

  it('the uploader may not check their own quotation unless the team allows it (here and on the script)', async () => {
    const { L } = await world();
    const d = L.e.addDeal({ client: 'บริษัท ของหมิว จำกัด' });
    const own = await L.e.attachDoc(d.id, pdf('QT-9.pdf'), qt(5000, 'QT-9'));
    await settle(L);
    expect(L.e.checkBlock(own)).toBe('self');
    await expect(L.e.qtCheck(own, 'ok')).rejects.toThrow('ใบเสนอราคาที่คุณแนบหรือแก้เอง ให้ผู้ตรวจคนอื่นตรวจ');
    L.e.saveNotifyCfg({ ...NOTIFY_CFG0, self: true });
    nf!.self = true;
    expect(L.e.checkBlock(own)).toBe('');
    await L.e.qtCheck(own, 'ok');
    expect(L.e.qtCheckFor(own)!.status).toBe('ok');
  });

  it('the team rules are one record an admin saves (with the site\'s address); a sales account cannot', async () => {
    const { L, S } = await world();
    L.e.saveNotifyCfg({ ...NOTIFY_CFG0, pre: 3, late: 'mon', sender: 'ทีมขาย GCC' });
    await settle(L, S);
    expect(S.e.notifyCfg()).toMatchObject({ pre: 3, late: 'mon', appt: 'today+1', sender: 'ทีมขาย GCC' });
    expect(sim.post({ action: 'pull', since: 0, cv: 4, tok: L.e.session!.tok }).rows!.some((r) => r.k === 'scfg/notify.cfg')).toBe(true);
    S.e.saveNotifyCfg({ ...NOTIFY_CFG0, pre: 14 });
    expect(S.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    expect(S.e.notifyCfg().pre).toBe(3);
  });

  it('my settings: a new address waits for its code; a wrong code is refused; confirmed, the test mail goes; the scope is the bell\'s', async () => {
    const { L, S } = await world();
    await expect(S.e.notifyTest()).rejects.toThrow('ยังไม่มีอีเมลที่ยืนยันแล้ว');
    await S.e.saveNotifyMe({ on: { qt: false, res: true, dg: true, pre: true }, t: '08:00', sc: 'team', em: 'ek@example.com' });
    expect(S.e.myNotify()).toMatchObject({ em: 'ek@example.com', ok: false, t: '08:00', sc: 'team', on: { pre: true } });
    expect(S.e.bellScope()).toBe('team');
    await expect(S.e.verifyEmail('000000')).rejects.toThrow('รหัสยืนยันไม่ถูกต้อง');
    await S.e.verifyEmail('123-456');
    expect(S.e.myNotify().ok).toBe(true);
    await S.e.notifyTest();
    expect(nf!.tests).toEqual(['ekk']);
    // read back from the script (another device saved meanwhile)
    nf!.users.ekk = { ...nf!.users.ekk, t: '06:30' };
    expect((await S.e.notifyMe()).t).toBe('06:30');
    // the admin's status card
    const st = await L.e.notifyStatus();
    expect(st).toMatchObject({ on: true, sent: 14, left: 86, from: 'owner@example.com' });
    expect(st.users.ekk).toMatchObject({ em: 'ek@example.com', ok: true, t: '06:30' });
    await expect(S.e.notifyStatus()).rejects.toThrow('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
  });

  it('notifications switched off again (the trigger gone): checks stop showing, the records stay', async () => {
    const { L, doc } = await world();
    await L.e.qtCheck(docIn(L, doc), 'ok');
    nf!.on = false;
    later(11 * 60000); // hello is asked again after 10 minutes
    await settle(L);
    await settle(L);
    expect(L.e.notifyLive).toEqual({ on: false, since: '2026-10-01' });
    expect(L.e.qtCheckFor(docIn(L, doc))).toBeNull();
    expect(L.e.checks()[doc.id]).toMatchObject({ st: 'ok' });
  });
});
