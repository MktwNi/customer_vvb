/**
 * Notifications and the quotation check in the engine (package notify), end to end with the real team
 * script in the simulator:
 * - against the script deployed before this release (team-sync/fixtures/Code.v3.gs: no `notify` in hello,
 *   no qt_check / notify_* actions): the setup state, the bell with payments and appointments only;
 * - against this release's script (team-sync/Code.gs, set up with its e-mail trigger): a quotation attached
 *   by one account waits in a checker's bell, is approved (the record and its history line reach everyone),
 *   waits again after an edit or a revision; sent back with a note; undone; the self-check rule; the team's
 *   rules record; one's own e-mail settings with the code the script mails; the admin's status; and the
 *   trigger's mails (the new quotation, the morning digest) from the same records.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasMail, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { NOTIFY_CFG0, bellItems, fpOf } from './notify';
import type { Role } from './teamSync';
import type { DealDoc } from './sales';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const URL = 'https://script.google.com/macros/s/n/exec';
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
/** The team script deployed before this release (no notifications). */
const V3 = readFileSync(join(ROOT, 'team-sync', 'fixtures', 'Code.v3.gs'), 'utf8');

const LS = new Map<string, Map<string, string>>();
let cur = '';
const ls = () => LS.get(cur) || (LS.set(cur, new Map()), LS.get(cur)!);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls().get(k) ?? null,
  setItem: (k: string, v: string) => void ls().set(k, String(v)),
  removeItem: (k: string) => void ls().delete(k),
});

const T0 = new Date('2026-10-12T03:00:00Z'); // Monday 10:00 in Bangkok
let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
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

const sent: Record<string, unknown>[] = [];
interface Tab { e: GccEngine; browser: string }
const tabs: Tab[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.e.dispose());
  LS.clear();
  sent.length = 0;
  vi.setSystemTime(T0);
});

function mk(browser: string): Tab {
  const raw = new GccEngine();
  raw.homeTeam = '';
  raw.base = structuredClone(base);
  raw.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  raw.ref = '2026-10-12';
  raw.store = memoryStore();
  raw.rebuild();
  raw.loading = false;
  const post = async (_u: string, body: Record<string, unknown>) => (sent.push(body), sim.post(body) as Record<string, unknown>);
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
async function lead(code?: string) {
  sim = createGasSim({ teamKey: '', kdfIter: 1000, ...(code ? { code } : {}) });
  sim.setup(); // this release's setup also installs the e-mail trigger (setupNotify)
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
const bell = (t: Tab, me: string, scope: 'mine' | 'team' = 'team') =>
  bellItems({ S: t.e.sales, tasks: [], owners: {}, coName: () => '', me, caps: t.e.myCaps(), live: t.e.notifyLive, checks: t.e.checks(), cfg: t.e.notifyCfg(), scope, today: '2026-10-12' });
const chkRows = (t: Tab, me: string) => bell(t, me).groups.find((g) => g.kind === 'chk')?.rows || [];
/** The 6-digit code the script mailed to `to` (the newest). */
const codeTo = (to: string) => /(\d{6})/.exec(sim.mail.sent.filter((m) => m.to === to && /รหัสยืนยันอีเมล/.test(m.subject)).at(-1)?.subject || '')?.[1] || '';
/** An account's verified address, as in การแจ้งเตือนของฉัน. */
async function verify(t: Tab, em: string) {
  await t.e.saveNotifyMe({ on: { qt: true, res: true, dg: true, pre: false }, t: '07:30', sc: t.e.myNotify().sc, em });
  await t.e.verifyEmail(codeTo(em));
  expect(t.e.myNotify()).toMatchObject({ em, ok: true });
}

describe('against the team script deployed before this release (no notifications)', () => {
  it('no check anywhere and the setup state; the bell has payments and appointments only; the actions say which update they need', async () => {
    const L = await lead(V3);
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
    expect(bell(L, 'หมิว').groups.some((g) => g.kind === 'chk' || g.kind === 'mine')).toBe(false);
    await expect(L.e.qtCheck(docIn(L, doc), 'ok')).rejects.toThrow(/ยังไม่รองรับการแจ้งเตือนและการตรวจใบเสนอราคา/);
    await expect(S.e.notifyMe()).rejects.toThrow(/ยังไม่รองรับการแจ้งเตือน/);
    await expect(L.e.notifyStatus()).rejects.toThrow(/ยังไม่รองรับการแจ้งเตือน/);
    // the bell's scope is kept in this browser until then
    expect(S.e.bellScope()).toBe('mine');
    S.e.setBellScope('team');
    expect(S.e.bellScope()).toBe('team');
    expect(L.e.bellScope()).toBe('team');
  });
});

describe('against the team script of this release (notifications set up)', () => {
  async function world() {
    const L = await lead();
    const S = await member(L, 'ekk', 'เอก', 'sales');
    await settle(L);
    const d = S.e.addDeal({ client: 'บริษัท ดูราฟลอร์ จำกัด' });
    const doc = await S.e.attachDoc(d.id, pdf('QT-2569-021.pdf'), qt(101650));
    await settle(S, L, S);
    return { L, S, d, doc };
  }

  it('hello says it is on and since when; it is remembered in this browser; a new quotation waits in a checker\'s bell', async () => {
    const { L, S, doc } = await world();
    expect(L.e.notifyLive).toEqual({ on: true, since: '2026-10-12' });
    expect(L.e.qtLive).toBe(true);
    expect(JSON.parse(LS.get('L')!.get('gcc-notify-live')!)).toMatchObject({ url: URL, f: { on: true, since: '2026-10-12' } });
    expect(L.e.qtCheckFor(docIn(L, doc))).toMatchObject({ status: 'wait', rec: null, stale: null });
    expect(L.e.checkBlock(docIn(L, doc))).toBe('');
    expect(chkRows(L, 'หมิว').map((r) => r.key)).toEqual(['q:' + doc.id]);
    // the uploader (a sales account without the check) reads only
    expect(S.e.checkBlock(doc)).toBe('cap');
    // me.notify came with the replies
    expect(S.e.myNotifyLive).toBe(true);
    expect(S.e.myNotify()).toMatchObject({ em: '', ok: false, sc: 'mine' });
    expect(L.e.myNotify()).toMatchObject({ sc: 'team' });
  });

  it('approve (from the e-mail link): the record shows at once and reaches the uploader with its history line; an edit or a revision waits again', async () => {
    const { L, S, d, doc } = await world();
    // the link's signed part, as the trigger mails it to หมิว
    const s = sim.run<string>('linkS_', sim.props.AUTH_SECRET, 'lead', doc.id, sim.run<string>('fpHash_', fpOf(docIn(L, doc))), Date.now());
    await L.e.qtCheck(docIn(L, doc), 'ok', '', s);
    expect(L.e.qtCheckFor(docIn(L, doc))).toMatchObject({ status: 'ok', rec: { by: 'หมิว', st: 'ok', via: 'mail' } });
    expect(chkRows(L, 'หมิว')).toEqual([]);
    await settle(L, S);
    expect(S.e.qtCheckFor(docIn(S, doc))).toMatchObject({ status: 'ok', rec: { by: 'หมิว', via: 'mail', u: 'lead' } });
    expect(Object.values(S.e.sales.log).some((x) => x.action === 'ตรวจใบเสนอราคาแล้ว' && x.deal === d.id)).toBe(true);
    // in the uploader's bell: checked lately, shown but not counted
    expect(bell(S, 'เอก', 'mine').groups.find((g) => g.kind === 'mine')).toMatchObject({ n: 0, rows: [{ key: 'm:' + doc.id, right: { text: 'ตรวจแล้ว', chip: 'info' } }] });
    // the uploader corrects the amount: waiting again, nothing written
    S.e.updateDoc(d.id, doc.id, { amount: 95000 });
    expect(S.e.qtCheckFor(docIn(S, doc))).toMatchObject({ status: 'wait', stale: { st: 'ok' } });
    // a checker with the old figure is refused: changed
    const old = { ...docIn(L, doc) };
    await settle(S, L);
    await expect(L.e.qtCheck(old, 'ok')).rejects.toMatchObject({ code: 'changed', message: expect.stringMatching(/เพิ่งถูกแก้ไข/) });
    expect(L.e.qtCheckFor(docIn(L, doc))!.status).toBe('wait');
    await L.e.qtCheck(docIn(L, doc), 'ok');
    expect(L.e.qtCheckFor(docIn(L, doc))!.status).toBe('ok');
    // a revised quotation is a new document: it waits; the old one leaves the check
    const rev = await S.e.attachDoc(d.id, pdf('QT-2569-021-1.pdf'), { ...qt(98000, 'QT-2569-021/1'), revise: doc.id });
    await settle(S, L);
    expect(L.e.qtCheckFor(docIn(L, rev))).toMatchObject({ status: 'wait' });
    expect(chkRows(L, 'หมิว').map((r) => r.key)).toEqual(['q:' + rev.id]);
  });

  it('send back needs a note; the note reaches the uploader; undo takes the checker\'s own latest back', async () => {
    const { L, S, doc } = await world();
    await expect(L.e.qtCheck(docIn(L, doc), 'back', '  ')).rejects.toThrow('ใส่ข้อความบอกว่าต้องแก้อะไร');
    await L.e.qtCheck(docIn(L, doc), 'back', 'เลขที่ซ้ำกับใบของ ดีไวน์สตาร์ช');
    await settle(L, S);
    expect(S.e.qtCheckFor(docIn(S, doc))).toMatchObject({ status: 'back', rec: { note: 'เลขที่ซ้ำกับใบของ ดีไวน์สตาร์ช' } });
    expect(bell(S, 'เอก', 'mine').groups[0]).toMatchObject({ kind: 'mine', n: 1 });
    later(60000);
    await L.e.qtCheck(docIn(L, doc), 'undo');
    expect(L.e.qtCheckFor(docIn(L, doc))!.status).toBe('wait');
    await settle(L, S);
    expect(S.e.qtCheckFor(docIn(S, doc))!.status).toBe('wait');
    // nothing to take back now
    await expect(L.e.qtCheck(docIn(L, doc), 'undo')).rejects.toThrow(/เลิกทำได้ภายใน 10 นาที/);
    // and after 10 minutes, too late
    await L.e.qtCheck(docIn(L, doc), 'ok');
    later(11 * 60000);
    await expect(L.e.qtCheck(docIn(L, doc), 'undo')).rejects.toMatchObject({ code: 'too_late' });
  });

  it('the uploader may not check their own quotation unless the team allows it (here and on the script)', async () => {
    const { L } = await world();
    const d = L.e.addDeal({ client: 'บริษัท ของหมิว จำกัด' });
    const own = await L.e.attachDoc(d.id, pdf('QT-9.pdf'), qt(5000, 'QT-9'));
    await settle(L);
    expect(L.e.checkBlock(own)).toBe('self');
    await expect(L.e.qtCheck(own, 'ok')).rejects.toThrow('ใบเสนอราคาที่คุณแนบหรือแก้เอง ให้ผู้ตรวจคนอื่นตรวจ');
    L.e.saveNotifyCfg({ ...NOTIFY_CFG0, self: true });
    expect(L.e.checkBlock(own)).toBe('');
    await settle(L); // the rule reaches the script with the next round
    await L.e.qtCheck(own, 'ok');
    expect(L.e.qtCheckFor(own)!.status).toBe('ok');
  });

  it('the team rules are one record an admin saves; a sales account cannot; nobody may push a check record', async () => {
    const { L, S, doc } = await world();
    L.e.saveNotifyCfg({ ...NOTIFY_CFG0, pre: 3, late: 'mon', sender: 'ทีมขาย GCC' });
    await settle(L, S);
    expect(S.e.notifyCfg()).toMatchObject({ pre: 3, late: 'mon', appt: 'today+1', sender: 'ทีมขาย GCC' });
    expect(sim.post({ action: 'pull', since: 0, cv: 4, tok: L.e.session!.tok }).rows!.some((r) => r.k === 'scfg/notify.cfg')).toBe(true);
    S.e.saveNotifyCfg({ ...NOTIFY_CFG0, pre: 14 });
    expect(S.e.teamNote).toBe('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
    expect(S.e.notifyCfg().pre).toBe(3);
    const forged = sim.post({ action: 'push', cv: 4, tok: L.e.session!.tok, ops: [{ k: 'qchk/' + doc.id, v: { st: 'ok', by: 'หมิว', at: '2026-10-12T03:00:00Z', fp: fpOf(doc) } }] });
    expect(forged.denied).toEqual(['qchk/' + doc.id]);
  });

  it('my settings: a new address waits for the code the script mails; a wrong code is refused; confirmed, the test mail goes; the admin sees it', async () => {
    const { L, S } = await world();
    await expect(S.e.notifyTest()).rejects.toThrow('ยังไม่มีอีเมลที่ยืนยันแล้ว');
    await S.e.saveNotifyMe({ on: { qt: false, res: true, dg: true, pre: true }, t: '08:00', sc: 'team', em: 'Ek@Example.com ' });
    expect(S.e.myNotify()).toMatchObject({ em: 'ek@example.com', ok: false, t: '08:00', sc: 'team', on: { pre: true } });
    expect(S.e.bellScope()).toBe('team');
    expect(codeTo('ek@example.com')).toMatch(/^\d{6}$/);
    await expect(S.e.verifyEmail(codeTo('ek@example.com') === '000000' ? '111111' : '000000')).rejects.toThrow('รหัสยืนยันไม่ถูกต้อง');
    const code = codeTo('ek@example.com');
    await S.e.verifyEmail(code.slice(0, 3) + '-' + code.slice(3));
    expect(S.e.myNotify().ok).toBe(true);
    const before = sim.mail.sent.length;
    await S.e.notifyTest();
    expect(sim.mail.sent.slice(before).map((m: GasMail) => m.to)).toEqual(['ek@example.com']);
    expect((await S.e.notifyMe()).t).toBe('08:00');
    // the admin's status card and recipients
    const st = await L.e.notifyStatus();
    expect(st).toMatchObject({ on: true, since: '2026-10-12', sent: 2 }); // the code and the test mail
    expect(st.left).toBeGreaterThan(5);
    const dir = await L.e.adminDir();
    expect(dir.users.find((u) => u.u === 'ekk')).toMatchObject({ em: 'ek@example.com', ok: 1, notify: { t: '08:00', sc: 'team' } });
    await expect(S.e.notifyStatus()).rejects.toThrow('บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้');
  });

  it('the trigger mails the new quotation to the checker (not the uploader) and the checker\'s morning digest lists it; the timer gone shows on the status', async () => {
    const L = await lead();
    const S = await member(L, 'ekk', 'เอก', 'sales');
    await verify(L, 'mew@example.com');
    await verify(S, 'ek@example.com');
    const d = S.e.addDeal({ client: 'บริษัท ดูราฟลอร์ จำกัด' });
    const doc = await S.e.attachDoc(d.id, pdf('QT-2569-021.pdf'), qt(101650));
    await settle(S, L);
    L.e.saveNotifyCfg({ ...NOTIFY_CFG0, site: 'https://example.com/gcc/' });
    await settle(L);
    const n0 = sim.mail.sent.length;
    sim.run('notifyTick');
    const mails = sim.mail.sent.slice(n0);
    const qtMail = mails.find((m) => /^ใบเสนอราคาใหม่รอตรวจ/.test(m.subject));
    expect(qtMail).toMatchObject({ to: 'mew@example.com', replyTo: 'ek@example.com' });
    expect(qtMail!.subject).toContain('QT-2569-021');
    expect(String(qtMail!.htmlBody)).toContain('https://example.com/gcc/#go=qt&amp;doc=' + doc.id + '&amp;s=');
    // its signed link opens the check and counts as from the mail
    const s = /#go=qt&amp;doc=[^&]+&amp;s=([\w.-]+)/.exec(String(qtMail!.htmlBody))![1];
    await settle(L);
    await L.e.qtCheck(docIn(L, doc), 'ok', '', s);
    expect(L.e.checks()[doc.id]).toMatchObject({ via: 'mail' });
    await L.e.qtCheck(docIn(L, doc), 'undo');
    // the morning digest (Monday, after 07:30): the checker's lists the quotation; the uploader's would be empty
    const digest = mails.filter((m) => /^สรุปวันนี้/.test(m.subject));
    expect(digest.map((m) => m.to)).toEqual(['mew@example.com']);
    expect(digest[0].subject).toMatch(/รอตรวจ 1/);
    expect(mails.some((m) => m.to === 'ek@example.com')).toBe(false);
    // once a day: the next tick sends nothing new for these
    const n1 = sim.mail.sent.length;
    later(10 * 60000);
    sim.run('notifyTick');
    expect(sim.mail.sent.slice(n1).filter((m) => /^ใบเสนอราคาใหม่รอตรวจ|^สรุปวันนี้/.test(m.subject))).toEqual([]);
    // the timer removed (not by the app): the status card says mail stops; the checks go on
    sim.triggers.length = 0;
    expect(await L.e.notifyStatus()).toMatchObject({ on: false });
    expect(L.e.qtLive).toBe(true);
  });
});
