/**
 * E-mail notifications and the quotation check in the team script (team-sync/Code.gs), run through the
 * simulator: setupNotify, the account's e-mail settings (notify_me / notify_verify / notify_test /
 * notify_status, user_save em), qt_check, the time-driven notifyTick (quotations, results, requests,
 * the weekday digest, reminders) and the Code.gs port of sales.ts payDue / lineView, compared with the
 * web app's own functions on random data. Addresses are example.com; every secret is generated here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasMail, type GasSim } from '../../../team-sync/sim.mjs';
import { applyRow, noEffects, type SharedState, type SyncRow } from './teamSync';
import { DEFAULT_STAGES, emptySales, lineView, payDue, planLines, type Deal } from './sales';
import type { Crm } from './types';

type Caps = Record<string, 1 | 'own'>;

// Monday 12 Oct 2026, 06:00 in Bangkok (a weekday before anyone's digest time)
const T0 = Date.parse('2026-10-11T23:00:00.000Z');
const MIN = 60000, H = 60 * MIN, DAY = 24 * H;
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const iso = (ms = 0) => new Date(T0 + ms).toISOString();
const SITE = 'https://gcc.example.com/app/';

// ------------------------------------------------------------------ helpers

const seen: { s: GasSim; replies: string[] }[] = [];
function mk(opts: Parameters<typeof createGasSim>[0] = {}): GasSim {
  const s = createGasSim({ kdfIter: 1000, ...opts });
  const rec = { s, replies: [] as string[] };
  seen.push(rec);
  const post = s.post;
  s.post = (body) => {
    const r = post(body);
    rec.replies.push(JSON.stringify(r));
    return r;
  };
  return s;
}
const call = (s: GasSim, tok: string, action: string, extra: Record<string, unknown> = {}) => s.post({ action, cv: 4, tok, ...extra });
const login = (s: GasSim, u: string, pw: string) => s.post({ action: 'login', cv: 4, u, pk: s.pk(u, pw), rm: true });
function member(s: GasSim, admin: string, u: string, name: string, role: string) {
  expect(call(s, admin, 'user_save', { create: true, u, name, role, pk: s.pk(u, 'temp-' + u) })).toMatchObject({ ok: true });
  const t = login(s, u, 'temp-' + u);
  const r = call(s, String(t.tok), 'passwd', { old: s.pk(u, 'temp-' + u), pk: s.pk(u, 'own-' + u) });
  expect(r).toMatchObject({ ok: true });
  return String(r.tok);
}
const VIEW = ['view.sales', 'view.plan', 'view.money', 'view.cash', 'docs.open'];
const ones = (l: string[]): Caps => Object.fromEntries(l.map((c) => [c, 1]));
const HEAD: Caps = ones([...VIEW, 'edit.cust', 'edit.deal', 'edit.task', 'edit.pay', 'docs.up', 'edit.ctag', 'edit.jqt', 'notify.mail', 'view.comm', 'edit.share', 'del.rec', 'del.log', 'qt.check']);
const ACCT: Caps = ones([...VIEW, 'view.comm', 'edit.pay', 'docs.up', 'qt.check', 'pay.check', 'notify.mail', 'set.units']);
const lastMailTo = (s: GasSim, to: string) => [...s.mail.sent].reverse().find((m) => m.to === to);
const codeOf = (m: GasMail | undefined) => (/รหัสยืนยันอีเมล: (\d{6})/.exec(String(m?.subject)) || [])[1];
/** Give account `tok` the address `em` and verify it with the code mailed there. */
function verify(s: GasSim, tok: string, em: string) {
  expect(call(s, tok, 'notify_me', { em })).toMatchObject({ ok: true, sent: 1 });
  const code = codeOf(lastMailTo(s, em));
  expect(code).toMatch(/^\d{6}$/);
  expect(call(s, tok, 'notify_verify', { code })).toMatchObject({ ok: true, me: { notify: { em, ok: 1 } } });
}
/**
 * The mockups' team: หัวหน้า (admin), มินท์ (หัวหน้าฝ่ายขาย, checks quotations), เอก (sales), ฝน
 * (บัญชี/การเงิน, checks quotations), ปลา (viewer); every address verified. The team settings point
 * the links at SITE. Returns the tokens.
 */
function crew(o: { verified?: boolean } = {}) {
  at(0);
  const s = mk();
  const lead = s.bootstrapAdmin({ u: 'lead', name: 'หัวหน้า', pw: 'lead-password-1' });
  const head = String(call(s, lead, 'role_save', { n: 'หัวหน้าฝ่ายขาย', c: HEAD }).id);
  const acct = String(call(s, lead, 'role_save', { n: 'บัญชี/การเงิน', c: ACCT }).id);
  const t = {
    s,
    lead,
    mint: member(s, lead, 'mint', 'มินท์', head),
    ek: member(s, lead, 'eak', 'เอก', 'sales'), // usernames are 3+ characters; the address is ek@example.com
    fon: member(s, lead, 'fon', 'ฝน', acct),
    pla: member(s, lead, 'pla', 'ปลา', 'viewer'),
  };
  if (o.verified !== false) for (const u of ['lead', 'mint', 'ek', 'fon', 'pla'] as const) verify(s, t[u], u + '@example.com');
  expect(call(s, lead, 'push', { ops: [{ k: 'scfg/notify.cfg', v: { site: SITE + 'index.html', sender: 'GCC Sales Tracker' } }] })).toMatchObject({ ok: true, n: 1 });
  s.mail.sent.length = 0;
  s.mail.calls.length = 0;
  return t;
}
type Crew = ReturnType<typeof crew>;
const push = (s: GasSim, tok: string, ops: unknown[]) => {
  const r = call(s, tok, 'push', { ops });
  expect(r).toMatchObject({ ok: true, denied: [] });
  return r;
};
const tick = (s: GasSim) => s.run<Record<string, unknown>>('notifyTick');
const now = () => new Date().toISOString();
const deal = (id: string, o: Record<string, unknown> = {}) => ({ k: 'deal/' + id, v: { client: 'บริษัท ดูราฟลอร์ จำกัด', resp: 'เอก', jobStatus: 'open', year: '2569', at: now(), by: 'เอก', ...o } });
const QT = { kind: 'quotation', target: 'forecast', amount: 101650, detected: 101650, basis: 'total', docNo: 'QT-2569-021', docDate: '2026-10-12', name: 'QT-2569-021.pdf', mime: 'application/pdf', size: 37702, fileId: '1abcFILE', stage: 'QUOTATION', by: 'เอก' };
const qt = (dealId: string, docId: string, o: Record<string, unknown> = {}) => ({ k: `ddoc/${dealId}/${docId}`, v: { ...QT, at: now(), cAt: now(), ...o } });
const fp = (o: Record<string, unknown> = {}) => {
  const v = { ...QT, ...o } as typeof QT;
  return { a: v.amount, n: v.docNo, d: v.docDate, f: v.name + '|' + v.size };
};
const rowsOf = (s: GasSim, tok: string) => call(s, tok, 'pull', { since: 0 }).rows!;
const latest = (s: GasSim, tok: string, k: string) => [...rowsOf(s, tok)].reverse().find((r) => r.k === k);
const logOf = (s: GasSim) => (s.sheetOf('notify')?.rows || []).slice(1).filter((r) => r[0]).map((r) => ({ at: r[0], kind: r[1], u: r[2], key: r[3], fp: r[4], result: r[5] }));
const sentTo = (s: GasSim) => s.mail.sent.map((m) => m.to);
/** The s= part of the quotation link in a mail. */
const linkOf = (m: GasMail | undefined) => {
  const h = /href="([^"]*#go=qt&amp;doc=[^"]*)"/.exec(String(m?.htmlBody))?.[1].replace(/&amp;/g, '&');
  return h ? Object.fromEntries(new URLSearchParams(h.slice(h.indexOf('#') + 1))) : null;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
});
afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------ setupNotify and hello

describe('setupNotify', () => {
  it('installs one trigger and the notify tab, never mails what the sheet already holds, and is safe to run again', () => {
    const s = mk({ teamKey: 'test-key-123' });
    expect(s.post({ action: 'hello', cv: 4 })).toMatchObject({ notify: { on: 0, since: '' } });
    s.post({ action: 'push', key: 'test-key-123', cv: 4, ops: [{ k: 'stage/1', v: 'won' }, { k: 'stage/2', v: 'lost' }] });
    s.run('setupNotify');
    expect(s.triggers.map((t) => [t.getHandlerFunction(), t.every])).toEqual([['notifyTick', 10]]);
    expect(s.sheetOf('notify')!.rows[0]).toEqual(['at', 'kind', 'u', 'key', 'fp', 'result']);
    expect(s.props).toMatchObject({ NOTIFY_ON: '1', NOTIFY_SINCE: '2026-10-12', NOTIFY_SEQ: '2' });
    expect(s.logs.at(-1)).toMatch(/^การแจ้งเตือนทางอีเมลพร้อมใช้งาน: ตรวจทุก 10 นาที วันนี้ส่งได้อีก 100 ฉบับ/);
    expect(s.post({ action: 'hello', cv: 4 })).toMatchObject({ notify: { on: 1, since: '2026-10-12' } });
    // again, two days and some rows later: still one trigger, the go-live day and the position stay
    at(2 * DAY);
    s.post({ action: 'push', key: 'test-key-123', cv: 4, ops: [{ k: 'stage/3', v: 'won' }] });
    s.run('setupNotify');
    expect(s.triggers).toHaveLength(1);
    expect(s.props).toMatchObject({ NOTIFY_SINCE: '2026-10-12', NOTIFY_SEQ: '2' });
  });

  it('setup() installs it too (an owner who runs setup after pasting), and with accounts hello reads it from the cache', () => {
    const s = mk();
    s.bootstrapAdmin({ u: 'lead', name: 'หัวหน้า', pw: 'lead-password-1' });
    expect(s.triggers).toHaveLength(1);
    expect(s.logs).toContain('การแจ้งเตือนทางอีเมลพร้อมใช้งาน (ตรวจทุก 10 นาที)');
    s.stats.propRead = 0;
    expect(s.post({ action: 'hello', cv: 4 })).toMatchObject({ mode: 'accounts', notify: { on: 1, since: '2026-10-12' } });
    expect(s.stats.propRead).toBe(0);
    // without the mail permission setup still does its own work and says what to do; no trigger is left half-made
    const n = mk({ teamKey: '' });
    n.mail.fail = 'You do not have permission to call MailApp.getRemainingDailyQuota';
    n.setup();
    expect(n.logs).toContainEqual(expect.stringMatching(/^ยังเปิดการแจ้งเตือนทางอีเมลไม่ได้: .* — เลือก setupNotify แล้วกด Run และกดอนุญาต$/));
    expect(n.ownerCode()).toMatch(/^\d{4}-\d{4}$/);
    expect(n.triggers).toEqual([]);
    expect(() => n.run('setupNotify')).toThrow('permission');
    expect(n.post({ action: 'hello', cv: 4 })).toMatchObject({ notify: { on: 0 } });
  });

  it('a run without accounts, or before setup, mails nothing', () => {
    const s = mk({ teamKey: 'test-key-123' });
    expect(tick(s)).toMatchObject({ ok: 1, sent: 0 });
    s.run('setupNotify');
    expect(tick(s)).toMatchObject({ ok: 1, sent: 0 });
    expect(s.mail.sent).toEqual([]);
  });
});

// ------------------------------------------------------------------ one's own e-mail settings

describe('notify_me / notify_verify (one\'s own address and choices)', () => {
  it('me.notify has the defaults: everything but the 1-hour reminder, 07:30, the whole team for admins, own work for others', () => {
    const t = crew({ verified: false });
    const base = { em: '', ok: 0, on: { qt: 1, res: 1, dg: 1, pre: 0 }, t: '07:30' };
    expect(call(t.s, t.lead, 'me').me).toMatchObject({ notify: { ...base, sc: 'team' } });
    expect(call(t.s, t.ek, 'ping').me).toMatchObject({ notify: { ...base, sc: 'mine' } });
    expect(call(t.s, t.pla, 'notify_me', { get: true })).toMatchObject({ ok: true, me: { notify: { ...base, sc: 'mine' } } });
  });

  it('changes the choices; refuses bad ones', () => {
    const t = crew({ verified: false });
    const r = call(t.s, t.ek, 'notify_me', { on: { dg: 0, pre: true }, t: '08:30', sc: 'team' });
    expect(r).toMatchObject({ ok: true, me: { notify: { on: { qt: 1, res: 1, dg: 0, pre: 1 }, t: '08:30', sc: 'team' } } });
    expect(r).not.toHaveProperty('sent');
    for (const bad of [{ on: { dg: 2 } }, { on: { x: 1 } }, { on: [1] }, { t: '07:15' }, { t: '10:00' }, { sc: 'all' }]) expect(call(t.s, t.ek, 'notify_me', bad)).toMatchObject({ ok: false, error: 'bad_notify' });
    for (const em of ['nope', 'a@b', 'a b@example.com', 'x@example.com, y@example.com', 'a@'.padEnd(300, 'x') + '.com']) expect(call(t.s, t.ek, 'notify_me', { em })).toMatchObject({ ok: false, error: 'bad_email' });
    expect(call(t.s, t.ek, 'me').me).toMatchObject({ notify: { on: { dg: 0, pre: 1 }, t: '08:30', sc: 'team', em: '' } });
  });

  it('a new address gets a 6-digit code by mail, only to that address; the code verifies it', () => {
    const t = crew({ verified: false });
    const r = call(t.s, t.ek, 'notify_me', { em: '  EK@Example.com ' });
    expect(r).toMatchObject({ ok: true, sent: 1, me: { notify: { em: 'ek@example.com', ok: 0 } } });
    expect(sentTo(t.s)).toEqual(['ek@example.com']);
    const m = t.s.mail.sent[0];
    expect(m).toMatchObject({ name: 'GCC Sales Tracker', subject: expect.stringMatching(/^รหัสยืนยันอีเมล: \d{6}$/) });
    expect(m.htmlBody).toContain(codeOf(m));
    // only a hash of the code is stored
    expect(t.s.props.NCODE).not.toContain(codeOf(m)!);
    const wrong = String((Number(codeOf(m)) + 1) % 1e6).padStart(6, '0');
    expect(call(t.s, t.ek, 'notify_verify', { code: wrong })).toMatchObject({ ok: false, error: 'code_wrong' });
    expect(call(t.s, t.ek, 'notify_verify', { code: '12' })).toMatchObject({ ok: false, error: 'code_wrong' });
    expect(call(t.s, t.ek, 'notify_verify', { code: codeOf(m) })).toMatchObject({ ok: true, me: { notify: { em: 'ek@example.com', ok: 1 } } });
    // used up
    expect(call(t.s, t.ek, 'notify_verify', { code: codeOf(m) })).toMatchObject({ ok: false, error: 'code_expired' });
    // the same address again: nothing to verify, no mail
    expect(call(t.s, t.ek, 'notify_me', { em: 'ek@example.com' })).toMatchObject({ ok: true, me: { notify: { ok: 1 } } });
    expect(t.s.mail.sent).toHaveLength(1);
  });

  it('a code lasts 15 minutes and 5 wrong tries; at most 3 codes an hour', () => {
    const t = crew({ verified: false });
    call(t.s, t.ek, 'notify_me', { em: 'ek@example.com' });
    const c1 = codeOf(lastMailTo(t.s, 'ek@example.com'));
    at(16 * MIN);
    expect(call(t.s, t.ek, 'notify_verify', { code: c1 })).toMatchObject({ ok: false, error: 'code_expired' });
    expect(call(t.s, t.ek, 'notify_me', { resend: true })).toMatchObject({ ok: true, sent: 1 });
    const c2 = codeOf(lastMailTo(t.s, 'ek@example.com'))!;
    const wrong = String((Number(c2) + 1) % 1e6).padStart(6, '0');
    for (let i = 0; i < 5; i++) expect(call(t.s, t.ek, 'notify_verify', { code: wrong }).error).toBe('code_wrong');
    expect(call(t.s, t.ek, 'notify_verify', { code: c2 })).toMatchObject({ ok: false, error: 'code_expired' });
    expect(call(t.s, t.ek, 'notify_me', { em: 'ek2@example.com' })).toMatchObject({ ok: true, sent: 1 });
    expect(call(t.s, t.ek, 'notify_me', { em: 'ek3@example.com' })).toMatchObject({ ok: false, error: 'too_many_codes' });
    expect(call(t.s, t.ek, 'me').me).toMatchObject({ notify: { em: 'ek2@example.com', ok: 0 } }); // nothing changed by the refusal
    at(16 * MIN + H + MIN);
    expect(call(t.s, t.ek, 'notify_me', { em: 'ek3@example.com' })).toMatchObject({ ok: true, sent: 1 });
    // a code mailed to an address that is no longer the account's does not verify the new one
    const c3 = codeOf(lastMailTo(t.s, 'ek3@example.com'));
    call(t.s, t.ek, 'notify_me', { em: '' });
    expect(call(t.s, t.ek, 'me').me).toMatchObject({ notify: { em: '', ok: 0 } });
    expect(call(t.s, t.ek, 'notify_verify', { code: c3 })).toMatchObject({ ok: false, error: 'code_expired' });
  });

  it('a viewer manages its own address; an account that must change its password, or the team code, may not', () => {
    const t = crew({ verified: false });
    verify(t.s, t.pla, 'pla@example.com');
    expect(call(t.s, t.lead, 'user_save', { create: true, u: 'newbie', name: 'มือใหม่', role: 'sales', pk: t.s.pk('newbie', 'temp-1') }).ok).toBe(true);
    const mc = String(login(t.s, 'newbie', 'temp-1').tok);
    for (const a of ['notify_me', 'notify_verify', 'notify_test', 'qt_check']) expect(call(t.s, mc, a, { em: 'n@example.com' })).toMatchObject({ ok: false, error: 'must_change_password' });
    const legacy = mk({ teamKey: 'test-key-123' });
    for (const a of ['notify_me', 'notify_verify', 'notify_test', 'notify_status', 'qt_check']) expect(legacy.post({ action: a, cv: 4, key: 'test-key-123' })).toEqual({ ok: false, error: 'login_required' });
  });

  it('an admin sets an account\'s address (user_save em): the code goes to that address, the account verifies it', () => {
    const t = crew({ verified: false });
    const r = call(t.s, t.lead, 'user_save', { u: 'eak', em: 'ek@example.com' });
    expect(r).toMatchObject({ ok: true, sent: 1, user: { u: 'eak', em: 'ek@example.com', ok: 0, notify: { em: 'ek@example.com', ok: 0, sc: 'mine' } } });
    expect(sentTo(t.s)).toEqual(['ek@example.com']);
    expect(call(t.s, t.lead, 'user_save', { u: 'eak', em: 'not an address' })).toMatchObject({ ok: false, error: 'bad_email' });
    expect(call(t.s, t.ek, 'notify_verify', { code: codeOf(t.s.mail.sent[0]) })).toMatchObject({ ok: true });
    const users = call(t.s, t.lead, 'users').users as { u: string; em: string; ok: number }[];
    expect(users.map((x) => [x.u, x.em, x.ok])).toEqual([['lead', '', 0], ['mint', '', 0], ['eak', 'ek@example.com', 1], ['fon', '', 0], ['pla', '', 0]]);
    // a new account with its address in the same save
    expect(call(t.s, t.lead, 'user_save', { create: true, u: 'nok', name: 'นก', role: 'sales', pk: t.s.pk('nok', 'tmp'), em: 'nok@example.com' })).toMatchObject({ ok: true, sent: 1, user: { u: 'nok', em: 'nok@example.com', ok: 0 } });
    // the mail can't go out: saved anyway, and the reply says so
    t.s.mail.quota = 0;
    expect(call(t.s, t.lead, 'user_save', { u: 'pla', em: 'pla@example.com' })).toMatchObject({ ok: true, sent: 0, mail: 'no_quota', user: { em: 'pla@example.com', ok: 0 } });
  });
});

describe('notify_test / notify_status', () => {
  it('a test mail goes to one\'s own verified address, needs notify.mail, and keeps the reserve for quotations', () => {
    const t = crew();
    expect(call(t.s, t.pla, 'notify_test')).toMatchObject({ ok: false, error: 'forbidden' }); // viewers get no mail
    expect(call(t.s, t.ek, 'notify_test')).toMatchObject({ ok: true });
    expect(t.s.mail.sent.map((m) => [m.to, m.subject])).toEqual([['ek@example.com', 'อีเมลทดสอบจาก Sales Tracker']]);
    expect(t.s.mail.sent[0].htmlBody).toContain(SITE + 'icon-192.png');
    call(t.s, t.ek, 'notify_me', { em: '' });
    expect(call(t.s, t.ek, 'notify_test')).toMatchObject({ ok: false, error: 'no_email' });
    t.s.mail.quota = 5;
    expect(call(t.s, t.lead, 'notify_test')).toMatchObject({ ok: false, error: 'no_quota' });
    t.s.mail.quota = 50;
    t.s.mail.fail = 'You do not have permission to call MailApp.sendEmail';
    expect(call(t.s, t.lead, 'notify_test')).toMatchObject({ ok: false, error: 'mail_failed' });
  });

  it('the status card: on with its trigger, the quota left, mails sent today, the last run; admins only', () => {
    const t = crew();
    expect(call(t.s, t.ek, 'notify_status')).toMatchObject({ ok: false, error: 'forbidden' });
    call(t.s, t.lead, 'notify_test');
    tick(t.s);
    const r = call(t.s, t.lead, 'notify_status');
    expect(r).toMatchObject({ ok: true, on: 1, since: '2026-10-12', triggers: 1, every: 10, quotaLeft: 94, last: { at: iso(), ok: 1, sent: 0, deferred: 0, err: '' } });
    // the codes of crew() and the test mail were sent today
    expect(r.sentToday).toBe(6);
    t.s.triggers.length = 0; // the owner deleted the trigger
    expect(call(t.s, t.lead, 'notify_status')).toMatchObject({ on: 0, triggers: 0 });
  });
});

// ------------------------------------------------------------------ qt_check

describe('qt_check', () => {
  function withQt(o: Record<string, unknown> = {}) {
    const t = crew();
    push(t.s, t.lead, [deal('d1')]);
    push(t.s, t.ek, [qt('d1', 'q1', o)]);
    return t;
  }

  it('only holders of qt.check; a bad key or status is refused', () => {
    const t = withQt();
    const k = 'ddoc/d1/q1';
    expect(call(t.s, t.ek, 'qt_check', { k, st: 'ok', fp: fp() })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(call(t.s, t.pla, 'qt_check', { k, st: 'ok', fp: fp() })).toMatchObject({ ok: false, error: 'forbidden' });
    for (const bad of [{ k: 'deal/d1' }, { k: 'ddoc/d1' }, { k: 'ddoc/d1/q1/x' }, { st: 'yes' }, { st: undefined }]) expect(call(t.s, t.mint, 'qt_check', { k, st: 'ok', fp: fp(), ...bad })).toMatchObject({ ok: false, error: 'bad_req' });
    push(t.s, t.ek, [{ k: 'ddoc/d1/i1', v: { ...QT, kind: 'invoice', target: 'actual', stage: 'PAY1' } }]);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/i1', st: 'ok', fp: fp() })).toMatchObject({ ok: false, error: 'bad_req' });
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/none', st: 'ok', fp: fp() })).toMatchObject({ ok: false, error: 'changed' });
  });

  it('writes the check and a deal-history row with the next seqs, in the checker\'s name and the server\'s time', () => {
    const t = withQt();
    at(5 * MIN);
    const before = Number(t.s.props.SEQ);
    const r = call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp(), by: 'someone else', at: '2020-01-01' });
    const rec = { st: 'ok', by: 'มินท์', at: iso(5 * MIN), fp: fp(), via: 'app', u: 'mint' };
    expect(r).toMatchObject({ ok: true, seq: before + 2, chk: rec });
    const rows = rowsOf(t.s, t.lead).slice(-2);
    expect(rows).toEqual([
      { seq: before + 1, k: 'qchk/q1', v: rec, del: false, by: 'มินท์', at: iso(5 * MIN) },
      {
        seq: before + 2, k: expect.stringMatching(/^dlog\/qc-q1-/), del: false, by: 'มินท์', at: iso(5 * MIN),
        v: { id: rows[1].k.slice(5), at: iso(5 * MIN), by: 'มินท์', action: 'ตรวจใบเสนอราคาแล้ว', client: 'บริษัท ดูราฟลอร์ จำกัด', detail: 'QT-2569-021', deal: 'd1' },
      },
    ]);
    // a later push gets the seq after them
    expect(push(t.s, t.ek, [{ k: 'stage/1', v: 'won' }]).seq).toBe(before + 3);
    // sent back: a note is required, and goes into the record and the history
    expect(call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'back', fp: fp() })).toMatchObject({ ok: false, error: 'req_note' });
    expect(call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'back', fp: fp(), note: 'x'.repeat(301) })).toMatchObject({ ok: false, error: 'req_note' });
    expect(call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'back', fp: fp(), note: ' VAT ผิด ' })).toMatchObject({ ok: true, chk: { st: 'back', by: 'ฝน', note: 'VAT ผิด', u: 'fon' } });
    expect(latest(t.s, t.lead, 'qchk/q1')!.v).toMatchObject({ st: 'back', note: 'VAT ผิด' });
    expect(rowsOf(t.s, t.lead).at(-1)!.v).toMatchObject({ action: 'ส่งใบเสนอราคากลับแก้ไข', detail: 'QT-2569-021 · VAT ผิด' });
  });

  it('nobody pushes a check: refused for an admin, a checker and the team code alike', () => {
    const t = withQt();
    const op = { k: 'qchk/q1', v: { st: 'ok', by: 'หัวหน้า', at: iso(), fp: fp(), via: 'app', u: 'lead' } };
    expect(call(t.s, t.lead, 'push', { ops: [op] })).toMatchObject({ ok: true, n: 0, denied: ['qchk/q1'] });
    expect(call(t.s, t.mint, 'push', { ops: [op] })).toMatchObject({ ok: true, n: 0, denied: ['qchk/q1'] });
    const legacy = mk({ teamKey: 'test-key-123' });
    expect(legacy.post({ action: 'push', key: 'test-key-123', cv: 4, ops: [op] })).toMatchObject({ ok: true, n: 0, rejected: ['qchk/q1'] });
  });

  it('the attacher, or whoever wrote the record last, may not check it, unless the team allows it', () => {
    const t = withQt();
    // fon has qt.check and docs.up: attached by เอก, then fon corrected the amount
    push(t.s, t.mint, [qt('d1', 'q2', { by: 'มินท์' })]);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q2', st: 'ok', fp: fp() })).toMatchObject({ ok: false, error: 'self_check' });
    push(t.s, t.fon, [qt('d1', 'q1', { amount: 95000 })]);
    expect(call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp({ amount: 95000 }) })).toMatchObject({ ok: false, error: 'self_check' });
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp({ amount: 95000 }) })).toMatchObject({ ok: true });
    push(t.s, t.lead, [{ k: 'scfg/notify.cfg', v: { site: SITE, self: true } }]);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q2', st: 'ok', fp: fp() })).toMatchObject({ ok: true });
  });

  it('the record must be what the checker saw: the fingerprint, and the latest live key of that document', () => {
    const t = withQt();
    for (const f of [fp({ amount: 95000 }), fp({ docNo: 'QT-2569-022' }), fp({ docDate: '2026-10-13' }), fp({ size: 1 }), fp({ name: 'other.pdf' }), null, 'x'])
      expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: f })).toMatchObject({ ok: false, error: 'changed' });
    // a new file id (the upload backfill) is not part of it; a number sent as text is the same number
    push(t.s, t.ek, [qt('d1', 'q1', { fileId: '1otherFILE' })]);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: { ...fp(), a: '101650' } })).toMatchObject({ ok: true });
    // merged into a joint quotation: the record moved to the header deal under the same id
    push(t.s, t.lead, [deal('h1', { client: 'มจพ' })]);
    push(t.s, t.ek, [{ k: 'ddoc/d1/q1', del: true }, qt('h1', 'q1')]);
    expect(call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp() })).toMatchObject({ ok: false, error: 'changed' });
    expect(call(t.s, t.fon, 'qt_check', { k: 'ddoc/h1/q1', st: 'ok', fp: fp() })).toMatchObject({ ok: true, chk: { by: 'ฝน' } });
    expect(rowsOf(t.s, t.lead).at(-1)!.v).toMatchObject({ client: 'มจพ', deal: 'h1' });
  });

  it('undo: one\'s own latest check within 10 minutes; it removes the check and its history row', () => {
    const t = withQt();
    const r = call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp() });
    const lid = rowsOf(t.s, t.lead).at(-1)!.k;
    expect(call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'undo' })).toMatchObject({ ok: false, error: 'changed' });
    at(9 * MIN);
    const u = call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'undo' });
    expect(u).toMatchObject({ ok: true, seq: Number(r.seq) + 2 });
    expect(rowsOf(t.s, t.lead).slice(-2).map((x) => [x.k, x.del, x.v])).toEqual([['qchk/q1', true, null], [lid, true, null]]);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'undo' })).toMatchObject({ ok: false, error: 'changed' });
    // too late
    call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp() });
    at(20 * MIN);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'undo' })).toMatchObject({ ok: false, error: 'too_late' });
    // checked again by someone else since: not one's own latest any more
    call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp() });
    call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'back', fp: fp(), note: 'ขาดลายเซ็น' });
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'undo' })).toMatchObject({ ok: false, error: 'changed' });
  });

  it('without view.money the check\'s amount is hidden like the document\'s, and money in its note is "…"', () => {
    const t = withQt();
    const blind = String(call(t.s, t.lead, 'role_save', { n: 'ไม่เห็นยอด', c: ones(['view.sales', 'view.plan']) }).id);
    const nm = member(t.s, t.lead, 'nomoney', 'ไม่เห็นเงิน', blind);
    call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'back', fp: fp(), note: 'ควรเป็น 95,000 บาท' });
    const mine = latest(t.s, nm, 'qchk/q1')!.v as { fp: { a: unknown; n: string }; note: string };
    expect(mine.fp).toEqual({ ...fp(), a: null });
    expect(mine.note).toBe('ควรเป็น …');
    expect((latest(t.s, nm, 'ddoc/d1/q1')!.v as { amount: unknown }).amount).toBeNull();
    expect(JSON.stringify(rowsOf(t.s, nm))).not.toMatch(/101,?650|95,?000/);
    expect((latest(t.s, t.ek, 'qchk/q1')!.v as { fp: { a: number } }).fp.a).toBe(101650);
  });

  it('via: "mail" only with a valid link for this document as it is now; a forwarded link works and is logged', () => {
    const t = withQt();
    tick(t.s); // mails mint and fon (screen 01)
    const lm = linkOf(lastMailTo(t.s, 'mint@example.com'))!;
    const lf = linkOf(lastMailTo(t.s, 'fon@example.com'))!;
    expect(lm).toMatchObject({ go: 'qt', doc: 'q1', s: expect.stringMatching(/^[0-9a-z]+\.[\w-]{22}\.mint$/) });
    const check = (tok: string, s: string, o: Record<string, unknown> = {}) => call(t.s, tok, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp(), s, ...o });
    const [exp, sig] = lm.s.split('.');
    const swap = (i: number, x: string) => lm.s.split('.').map((p, j) => (j === i ? x : p)).join('.');
    expect(check(t.mint, swap(2, 'fon'))).toMatchObject({ chk: { via: 'app' } }); // another account
    expect(check(t.mint, swap(0, (parseInt(exp, 36) + 1).toString(36)))).toMatchObject({ chk: { via: 'app' } }); // a longer life
    expect(check(t.mint, swap(1, sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')))).toMatchObject({ chk: { via: 'app' } });
    expect(check(t.mint, 'junk')).toMatchObject({ chk: { via: 'app' } });
    expect(check(t.mint, lm.s)).toMatchObject({ chk: { via: 'mail', u: 'mint' } });
    // a link for another document does not count for this one
    push(t.s, t.ek, [qt('d1', 'q9')]);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q9', st: 'ok', fp: fp(), s: lm.s })).toMatchObject({ chk: { via: 'app' } });
    // forwarded: fon's link used by mint, allowed with mint's own qt.check, logged
    expect(check(t.mint, lf.s)).toMatchObject({ chk: { via: 'mail', u: 'mint', by: 'มินท์' } });
    expect(logOf(t.s).filter((r) => r.kind === 'fwd')).toMatchObject([{ u: 'mint', key: expect.stringMatching(/^qchk\/q1:/), result: 'via:fon' }]);
    // the document changed since the mail: the old link no longer matches it
    push(t.s, t.ek, [qt('d1', 'q1', { amount: 99000 })]);
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp({ amount: 99000 }), s: lm.s })).toMatchObject({ chk: { via: 'app' } });
    // expired after 30 days
    push(t.s, t.ek, [qt('d1', 'q1')]);
    at(31 * DAY);
    const again = String(login(t.s, 'mint', 'own-mint').tok);
    expect(check(again, lm.s)).toMatchObject({ chk: { via: 'app' } });
  });
});

// ------------------------------------------------------------------ notifyTick: quotations and results

describe('notifyTick: new quotations to the checkers', () => {
  it('mails every checker once per version (screen 01), never the attacher, a viewer or an unverified address; the link opens the check', () => {
    const t = crew();
    call(t.s, t.fon, 'notify_me', { em: 'fon2@example.com' }); // now unverified
    t.s.mail.sent.length = 0;
    push(t.s, t.lead, [deal('d1', { email: 'customer@example.com' })]);
    at(2 * MIN);
    push(t.s, t.ek, [qt('d1', 'q1')]);
    at(5 * MIN);
    expect(tick(t.s)).toMatchObject({ ok: 1, sent: 2, deferred: 0 });
    expect(sentTo(t.s).sort()).toEqual(['lead@example.com', 'mint@example.com']);
    const m = lastMailTo(t.s, 'mint@example.com')!;
    expect(m).toMatchObject({ subject: 'ใบเสนอราคาใหม่รอตรวจ: บริษัท ดูราฟลอร์ จำกัด · QT-2569-021 · 101,650 บาท', name: 'GCC Sales Tracker', replyTo: 'ek@example.com' });
    expect(m.htmlBody).toContain('ตรวจและอนุมัติ');
    expect(m.htmlBody).toContain('เอก แนบเมื่อ 12 ต.ค. 2569 06:02');
    expect(m.htmlBody).toContain('ส่งให้ หัวหน้า ด้วย คนใดคนหนึ่งตรวจก็พอ');
    expect(m.htmlBody).toContain(SITE + '#go=notify');
    expect(m.body).toContain('ตรวจและอนุมัติ: ' + SITE + '#go=qt&doc=q1&s=');
    // the button signs the check in as coming from the mail
    expect(call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q1', st: 'ok', fp: fp(), s: linkOf(m)!.s })).toMatchObject({ chk: { via: 'mail' } });
    // once only; mint's check reaches เอก 10 minutes after it was made
    at(15 * MIN);
    tick(t.s);
    expect(t.s.mail.sent.map((m) => m.subject).slice(2)).toEqual(['ใบเสนอราคาตรวจแล้ว: บริษัท ดูราฟลอร์ จำกัด · QT-2569-021']);
    expect(JSON.stringify(t.s.mail.sent)).not.toContain('customer@example.com');
    expect(logOf(t.s).filter((r) => r.kind === 'qt').map((r) => [r.u, r.result])).toEqual([['lead', 'sent'], ['mint', 'sent']]);
  });

  it('an amount edit or a revision (a new document) mails again; a new file id alone does not', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1')]);
    push(t.s, t.ek, [qt('d1', 'q1')]);
    tick(t.s);
    expect(sentTo(t.s)).toEqual(['lead@example.com', 'mint@example.com', 'fon@example.com']);
    at(10 * MIN);
    push(t.s, t.ek, [qt('d1', 'q1', { fileId: '1newFILE' })]);
    tick(t.s);
    expect(t.s.mail.sent).toHaveLength(3);
    at(20 * MIN);
    push(t.s, t.ek, [qt('d1', 'q1', { amount: 95000, cAt: iso(20 * MIN) })]);
    tick(t.s);
    expect(t.s.mail.sent.slice(3).map((m) => m.subject)).toEqual(Array(3).fill('ใบเสนอราคาใหม่รอตรวจ: บริษัท ดูราฟลอร์ จำกัด · QT-2569-021 · 95,000 บาท'));
    at(30 * MIN);
    push(t.s, t.ek, [qt('d1', 'q1', { target: 'none' }), qt('d1', 'q1v2', { docNo: 'QT-2569-021/1', at: iso(30 * MIN), cAt: iso(30 * MIN) })]);
    tick(t.s);
    expect(t.s.mail.sent.slice(6).map((m) => m.subject)).toEqual(Array(3).fill('ใบเสนอราคาใหม่รอตรวจ: บริษัท ดูราฟลอร์ จำกัด · QT-2569-021/1 · 101,650 บาท'));
  });

  it('waits for the file to reach Drive, up to 30 minutes', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1'), deal('d2', { client: 'บริษัท เบทาโกร จำกัด' })]);
    push(t.s, t.ek, [qt('d1', 'q1', { fileId: '' }), qt('d2', 'q2', { fileId: '' })]);
    tick(t.s);
    expect(t.s.mail.sent).toEqual([]);
    at(10 * MIN);
    push(t.s, t.ek, [qt('d1', 'q1', { fileId: '1q1FILE' })]); // uploaded
    tick(t.s);
    expect(t.s.mail.sent.map((m) => m.subject)).toEqual(Array(3).fill(expect.stringContaining('ดูราฟลอร์')));
    at(25 * MIN);
    tick(t.s);
    expect(t.s.mail.sent).toHaveLength(3);
    at(31 * MIN);
    tick(t.s);
    expect(t.s.mail.sent.slice(3).map((m) => m.subject)).toEqual(Array(3).fill(expect.stringContaining('เบทาโกร')));
  });

  it('nothing for quotations before the go-live day, on closed deals, not the Forecast, already checked, or older than 48 hours', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1'), deal('d2', { jobStatus: 'closed' })]);
    push(t.s, t.ek, [
      qt('d1', 'old', { at: '2026-10-10T03:00:00.000Z', cAt: '2026-10-10T03:00:00.000Z' }), // before NOTIFY_SINCE
      qt('d2', 'closed'),
      qt('d1', 'none', { target: 'none' }),
      qt('d1', 'inv', { kind: 'invoice', target: 'actual', stage: 'PAY1' }),
      qt('d1', 'other', { stage: 'FOLLOW1' }),
      qt('d1', 'chk'),
    ]);
    call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/chk', st: 'ok', fp: fp() });
    tick(t.s);
    expect(t.s.mail.sent).toEqual([]);
    expect(logOf(t.s).filter((r) => r.kind === 'qt')).toMatchObject([{ key: expect.stringMatching(/^qt:chk:/), result: 'checked' }]);
    // confirmed 3 days ago, synced only now (a device that was offline): not news any more
    at(3 * DAY);
    push(t.s, t.ek, [qt('d1', 'late', { at: iso(), cAt: iso() })]);
    at(3 * DAY + 5 * MIN);
    tick(t.s);
    expect(t.s.mail.sent.filter((m) => m.subject.startsWith('ใบเสนอราคาใหม่'))).toEqual([]);
    expect(logOf(t.s).filter((r) => r.key.startsWith('qt:late:'))).toMatchObject([{ result: 'skipped-old' }]);
  });

  it('an import (more than 20 at once) is logged and not mailed, then or later', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1')]);
    push(t.s, t.ek, Array.from({ length: 21 }, (_, i) => qt('d1', 'imp' + i)));
    tick(t.s);
    at(40 * MIN);
    tick(t.s);
    expect(t.s.mail.sent).toEqual([]);
    expect(logOf(t.s).filter((r) => r.result === 'skipped-bulk')).toHaveLength(21);
  });

  it('the lock is never held while mail goes out, and pushes during a run are not lost', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1')]);
    push(t.s, t.ek, [qt('d1', 'q1')]);
    t.s.mail.log = () => {
      // a teammate's push while the mail is sent: possible only because the run holds no lock
      expect(call(t.s, t.ek, 'push', { ops: [{ k: 'stage/9', v: 'won' }] })).toMatchObject({ ok: true });
    };
    tick(t.s);
    expect(t.s.mail.calls.length).toBe(3);
    expect(t.s.mail.calls.every((c) => !c.locked)).toBe(true);
    // the run's position is from before those pushes: the next run looks at them
    t.s.mail.log = null;
    push(t.s, t.ek, [qt('d1', 'q2')]);
    at(10 * MIN);
    tick(t.s);
    expect(t.s.mail.calls.length).toBe(6);
    expect(t.s.mail.calls.every((c) => !c.locked)).toBe(true);
  });

  it('the result goes to the attacher 10 minutes after the check; an undone check sends nothing', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1')]);
    push(t.s, t.ek, [qt('d1', 'q1'), qt('d1', 'q2', { docNo: 'QT-2569-030' })]);
    tick(t.s);
    t.s.mail.sent.length = 0;
    at(2 * MIN);
    call(t.s, t.fon, 'qt_check', { k: 'ddoc/d1/q1', st: 'back', fp: fp(), note: 'VAT ผิด' });
    call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q2', st: 'ok', fp: fp({ docNo: 'QT-2569-030' }) });
    at(5 * MIN);
    tick(t.s);
    expect(t.s.mail.sent).toEqual([]);
    call(t.s, t.mint, 'qt_check', { k: 'ddoc/d1/q2', st: 'undo' });
    at(13 * MIN);
    tick(t.s);
    expect(t.s.mail.sent.map((m) => [m.to, m.subject, m.replyTo])).toEqual([['ek@example.com', 'ใบเสนอราคาถูกส่งกลับแก้ไข: บริษัท ดูราฟลอร์ จำกัด · QT-2569-021', 'fon@example.com']]);
    expect(t.s.mail.sent[0].htmlBody).toContain('VAT ผิด');
    expect(t.s.mail.sent[0].htmlBody).toContain(SITE + '#go=deal&amp;id=d1');
    at(30 * MIN);
    tick(t.s);
    expect(t.s.mail.sent).toHaveLength(1);
  });
});

describe('notifyTick: the send log and the quota', () => {
  it('a quotation mail that found no quota left is sent on a later run, once', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1')]);
    push(t.s, t.ek, [qt('d1', 'q1')]);
    t.s.mail.quota = 0;
    expect(tick(t.s)).toMatchObject({ sent: 0, deferred: 3, err: 'quota' });
    at(10 * MIN);
    push(t.s, t.ek, [{ k: 'stage/1', v: 'won' }]); // other rows after it do not move it out of reach
    t.s.mail.quota = 100;
    expect(tick(t.s)).toMatchObject({ sent: 3, deferred: 0, err: '' });
    at(20 * MIN);
    expect(tick(t.s)).toMatchObject({ sent: 0 });
    expect(sentTo(t.s)).toEqual(['lead@example.com', 'mint@example.com', 'fon@example.com']);
  });

  it('keeps 90 days of log rows (what was sent, and what was decided not to send)', () => {
    const t = crew();
    push(t.s, t.lead, [deal('d1')]);
    push(t.s, t.ek, [qt('d1', 'q1')]);
    tick(t.s);
    const n = logOf(t.s).length;
    expect(n).toBeGreaterThan(5);
    at(91 * DAY);
    call(t.s, String(login(t.s, 'lead', 'lead-password-1').tok), 'notify_test');
    expect(logOf(t.s).length).toBe(n + 1);
    at(91 * DAY + 10 * MIN);
    tick(t.s);
    expect(logOf(t.s).map((r) => r.kind)).toEqual(['test']);
  });
});

// ------------------------------------------------------------------ notifyTick: requests

describe('notifyTick: permission requests to the admins', () => {
  it('each admin with a verified address gets one mail per request; the requester and other accounts none', () => {
    const t = crew();
    const lead2 = member(t.s, t.lead, 'boss2', 'รองหัวหน้า', 'admin');
    verify(t.s, lead2, 'boss2@example.com');
    t.s.mail.sent.length = 0;
    expect(call(t.s, t.ek, 'req_send', { k: 'caps', caps: ['qt.check'], note: 'ช่วยตรวจใบเสนอราคาช่วงหัวหน้าลา', until: '2026-10-31' })).toMatchObject({ ok: true });
    tick(t.s);
    expect(t.s.mail.sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      ['boss2@example.com', 'คำขอสิทธิ์จาก เอก: ขอสิทธิ์ ตรวจ/อนุมัติใบเสนอราคา'],
      ['lead@example.com', 'คำขอสิทธิ์จาก เอก: ขอสิทธิ์ ตรวจ/อนุมัติใบเสนอราคา'],
    ]);
    expect(t.s.mail.sent[0].htmlBody).toContain('ช่วยตรวจใบเสนอราคาช่วงหัวหน้าลา');
    expect(t.s.mail.sent[0].htmlBody).toContain('ถึง 31 ต.ค. 2569');
    at(10 * MIN);
    tick(t.s);
    expect(t.s.mail.sent).toHaveLength(2);
    // an admin's own request does not exist; a role request names the role
    expect(call(t.s, t.pla, 'req_send', { k: 'role', role: 'sales', note: 'ขอแก้ข้อมูลลูกค้า' })).toMatchObject({ ok: true });
    tick(t.s);
    expect(t.s.mail.sent.slice(2).map((m) => m.subject)).toEqual(Array(2).fill('คำขอสิทธิ์จาก ปลา: ขอบทบาท พนักงานขาย'));
  });
});

// ------------------------------------------------------------------ notifyTick: the digest

describe('notifyTick: the weekday digest "สรุปวันนี้"', () => {
  /** The team with the demo's money and appointments (screen 02), on Monday 12 Oct. */
  function demo() {
    const t = crew();
    push(t.s, t.lead, [
      deal('d1', { client: 'บริษัท ไทยออยล์ เอนเนอร์ยี่ จำกัด', resp: 'เอก' }),
      { k: 'dstep/d1/CLOSED DEAL', v: { d: '2026-09-01', n: 'YES' } },
      { k: 'dpay/d1/PAY1', v: { amt: 80250, due: '2026-10-08' } }, // late 4 days
      { k: 'dpay/d1/PAY2', v: { amt: 49000, due: '2026-10-15' } }, // due in 3 days
      deal('d2', { client: 'บริษัท เบทาโกร ฟู้ด จำกัด', resp: 'มินท์' }),
      { k: 'dstep/d2/CLOSED DEAL', v: { d: '2026-09-20', n: 'YES' } },
      { k: 'dpay/d2/PAY1', v: { amt: 12000, rel: 22 } }, // 20 Sep + 22 days = today
      deal('d3', { client: 'บริษัท ปิดงานแล้ว จำกัด', resp: 'เอก', jobStatus: 'closed' }),
      { k: 'dstep/d3/CLOSED DEAL', v: { d: '2026-08-01', n: 'YES' } },
      { k: 'dpay/d3/PAY1', v: { amt: 5000, due: '2026-10-11' } }, // a closed job still owing, late 1 day
      deal('d4', { client: 'บริษัท ไม่ได้งาน จำกัด', resp: 'เอก' }),
      { k: 'dstep/d4/CLOSED DEAL', v: { d: '2026-09-01', n: 'NO' } },
      { k: 'dpay/d4/PAY1', v: { amt: 7000, due: '2026-10-09' } },
      deal('d5', { client: 'บริษัท ซากิโนมิยะ ประเทศไทย จำกัด', resp: 'หัวหน้า' }),
      { k: 'dstep/d5/FOLLOW1', v: { d: '2026-10-13', n: '' } }, // a planned follow-up tomorrow
      { k: 'owner/101', v: 'เอก' },
      { k: 'task/t1', v: { gid: 101, title: 'บริษัท ฝาจีบ จำกัด (มหาชน)', type: 'call', date: '2026-10-12', time: '', note: 'ตามผลบอร์ด', done: false } },
      { k: 'task/t2', v: { gid: 101, title: 'บริษัท ฝาจีบ จำกัด (มหาชน)', type: 'call', date: '2026-10-09', time: '14:00', note: 'โทรตามใบเสนอราคา', done: false } },
      { k: 'task/t3', v: { gid: 101, title: 'บริษัท ฝาจีบ จำกัด (มหาชน)', type: 'meet', date: '2026-10-12', time: '10:00', note: 'ทำแล้ว', done: true } },
    ]);
    push(t.s, t.ek, [qt('d5', 'q5', { at: iso(-H), cAt: iso(-H) })]);
    tick(t.s); // the quotation mails
    t.s.mail.sent.length = 0;
    return t;
  }
  const digest = (t: Crew, u: string) => t.s.mail.sent.find((m) => m.to === u + '@example.com' && m.subject.startsWith('สรุปวันนี้'));

  it('goes out at each person\'s time, once a day, weekdays only, and not when there is nothing', () => {
    const t = demo();
    call(t.s, t.mint, 'notify_me', { t: '08:00' });
    at(85 * MIN); // 07:25
    tick(t.s);
    expect(t.s.mail.sent).toEqual([]);
    at(95 * MIN); // 07:35
    tick(t.s);
    // ปลา (viewer): no notify.mail; มินท์: 08:00
    expect(t.s.mail.sent.map((m) => m.to).sort()).toEqual(['ek@example.com', 'fon@example.com', 'lead@example.com']);
    at(105 * MIN);
    tick(t.s);
    expect(t.s.mail.sent).toHaveLength(3);
    at(125 * MIN); // 08:05
    tick(t.s);
    expect(t.s.mail.sent.map((m) => m.to)).toContain('mint@example.com');
    // Saturday: none
    t.s.mail.sent.length = 0;
    at(5 * DAY + 95 * MIN);
    tick(t.s);
    expect(t.s.mail.sent.filter((m) => m.subject.startsWith('สรุปวันนี้'))).toEqual([]);
    // nothing to say: no mail, logged as empty
    const q = crew();
    at(95 * MIN);
    tick(q.s);
    expect(q.s.mail.sent).toEqual([]);
    expect(logOf(q.s).filter((r) => r.kind === 'dg').map((r) => r.result)).toEqual(Array(4).fill('empty'));
  });

  it('the whole team for an admin: quotations to check, instalments late / today / soon with the total, appointments (screen 02)', () => {
    const t = demo();
    at(95 * MIN);
    tick(t.s);
    const m = digest(t, 'lead')!;
    expect(m.subject).toBe('สรุปวันนี้ จ. 12 ต.ค.: รอตรวจ 1 · งวดเงิน 4 · นัดหมาย 3');
    const h = m.htmlBody!;
    expect(h).toContain('สรุปวันนี้ · จันทร์ 12 ต.ค. 2569');
    expect(h).toContain('สวัสดีตอนเช้า หัวหน้า · งานของทั้งทีม');
    expect(h).toContain('QT-2569-021 · เอก แนบ 12 ต.ค.');
    expect(h).toContain('รวม 146,250 บาท'); // 80,250 + 5,000 + 12,000 + 49,000
    expect(h).toContain('PAY1 · ครบกำหนด 8 ต.ค. · เอก');
    expect(h).toContain('เลยกำหนด 4 วัน');
    expect(h).toContain('บริษัท ปิดงานแล้ว จำกัด'); // still owing after the job was closed
    expect(h).toContain('ครบกำหนดวันนี้');
    expect(h).toContain('PAY2 · ครบกำหนด พฤ. 15 ต.ค. · เอก');
    expect(h).toContain('ถึงกำหนด 3 วัน');
    expect(h).not.toContain('ไม่ได้งาน');
    expect(h).toContain('โทร · ตามผลบอร์ด · เอก');
    expect(h).toContain('FOLLOW1 ติดตามครั้งที่ 1 · หัวหน้า');
    expect(h).toContain('เกินกำหนด 3 วัน');
    expect(h).not.toContain('ทำแล้ว');
    expect(h).toContain(SITE + '#go=deal&amp;id=d1');
    expect(h).toContain(SITE + '#go=plan&amp;d=2026-10-09');
    expect(m.body).toContain('งวดเงิน 4 รายการ รวม 146,250 บาท');
  });

  it('own work only for sales (scope mine), no quotation section without qt.check; the team scope on request', () => {
    const t = demo();
    at(95 * MIN);
    tick(t.s);
    const m = digest(t, 'ek')!;
    expect(m.subject).toBe('สรุปวันนี้ จ. 12 ต.ค.: งวดเงิน 3 · นัดหมาย 2');
    expect(m.htmlBody).not.toContain('เบทาโกร');
    expect(m.htmlBody).not.toContain('ใบเสนอราคารอตรวจ');
    expect(m.htmlBody).toContain('สวัสดีตอนเช้า เอก · งานที่ฉันรับผิดชอบ');
    // fon checks quotations, scope mine: only the quotations section matters to her
    expect(digest(t, 'fon')!.subject).toBe('สรุปวันนี้ จ. 12 ต.ค.: รอตรวจ 1');
    call(t.s, t.ek, 'notify_me', { sc: 'team' });
    at(DAY + 95 * MIN);
    t.s.mail.sent.length = 0;
    tick(t.s);
    expect(digest(t, 'ek')!.htmlBody).toContain('เบทาโกร');
  });

  it('late instalments: every day, Mondays and the first late day, or the first late day only', () => {
    const t = demo();
    const late = (mode: string, day: number) => {
      push(t.s, t.lead, [{ k: 'scfg/notify.cfg', v: { site: SITE, late: mode } }]);
      at(day * DAY + 95 * MIN);
      t.s.mail.sent.length = 0;
      tick(t.s);
      const h = digest(t, 'lead')?.htmlBody || '';
      // ไทยออยล์ PAY1 was due on the 8th, the closed job's PAY1 on the 11th
      return ['ครบกำหนด 8 ต.ค.', 'ครบกำหนด 11 ต.ค.'].filter((x) => h.includes(x));
    };
    expect(late('once', 0)).toEqual(['ครบกำหนด 11 ต.ค.']); // Monday: only what became late since Friday's digest
    expect(late('mon', 1)).toEqual([]); // Tuesday: both have been late for days
    expect(late('daily', 2)).toEqual(['ครบกำหนด 8 ต.ค.', 'ครบกำหนด 11 ต.ค.']);
    expect(late('mon', 7)).toEqual(['ครบกำหนด 8 ต.ค.', 'ครบกำหนด 11 ต.ค.']); // the next Monday
  });

  it('waits when the day\'s quota is down to the reserve; quotations still go out; sent on a later run', () => {
    const t = demo();
    at(95 * MIN);
    t.s.mail.quota = 5;
    push(t.s, t.ek, [qt('d5', 'q6', { docNo: 'QT-2569-040', at: iso(95 * MIN), cAt: iso(95 * MIN) })]);
    const r = tick(t.s);
    // the three checkers got the new quotation; the four digests wait
    expect(r).toMatchObject({ ok: 1, sent: 3, deferred: 4, err: 'quota' });
    expect(t.s.mail.sent.map((m) => m.subject)).toEqual(Array(3).fill(expect.stringContaining('QT-2569-040')));
    expect(logOf(t.s).at(-1)).toMatchObject({ kind: 'quota', key: 'quota:2026-10-12' });
    t.s.mail.quota = 100;
    at(105 * MIN);
    expect(tick(t.s)).toMatchObject({ ok: 1, sent: 4, deferred: 0 });
    expect(t.s.mail.sent.slice(3).every((m) => m.subject.startsWith('สรุปวันนี้'))).toBe(true);
    expect(call(t.s, t.lead, 'notify_status')).toMatchObject({ last: { sent: 4, err: '' } });
  });

  it('the reminder about an hour before a timed appointment, once, for whoever chose it', () => {
    const t = demo();
    call(t.s, t.ek, 'notify_me', { on: { pre: 1, dg: 0 } });
    push(t.s, t.lead, [{ k: 'task/t9', v: { gid: 101, title: 'บริษัท ฝาจีบ จำกัด (มหาชน)', type: 'meet', date: '2026-10-12', time: '11:00', note: 'นำเสนอ', done: false } }]);
    at(3 * H + 45 * MIN); // 09:45: 75 minutes before
    tick(t.s);
    expect(t.s.mail.sent.filter((m) => m.to === 'ek@example.com')).toEqual([]);
    at(3 * H + 55 * MIN); // 09:55
    tick(t.s);
    expect(t.s.mail.sent.filter((m) => m.to === 'ek@example.com').map((m) => m.subject)).toEqual(['อีกประมาณ 1 ชั่วโมง: บริษัท ฝาจีบ จำกัด (มหาชน) 11:00 น.']);
    at(4 * H + 5 * MIN);
    tick(t.s);
    expect(t.s.mail.sent.filter((m) => m.to === 'ek@example.com')).toHaveLength(1);
  });

  it('without a site address the mails still go out, without links or the logo', () => {
    const t = demo();
    push(t.s, t.lead, [{ k: 'scfg/notify.cfg', v: { sender: 'ทีมขาย GCC' } }]);
    at(95 * MIN);
    tick(t.s);
    const m = digest(t, 'lead')!;
    expect(m.name).toBe('ทีมขาย GCC');
    expect(m.htmlBody).not.toMatch(/href=|<img/);
  });
});

// ------------------------------------------------------------------ parity with sales.ts

describe('parity: Code.gs payDue_ / lineView_ = sales.ts payDue / lineView', () => {
  /** A small seeded generator, so a failure can be replayed. */
  function rng(seed: number) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(l: T[]) => l[Math.floor(next() * l.length)];
    const day = (base: string, span: number) => {
      const d = new Date(base + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + Math.floor(next() * (2 * span + 1)) - span);
      return d.toISOString().slice(0, 10);
    };
    return { next, pick, day };
  }
  const emptyCrm = (): Crm => ({ stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} });

  /** One random tracker as sync rows: deals, results, plans, documents, the stage list. */
  function caseOf(seed: number) {
    const R = rng(seed);
    const today = R.day('2026-10-12', 60);
    const rows: { k: string; v: unknown }[] = [];
    rows.push({ k: 'scfg/stages', v: R.pick([DEFAULT_STAGES, [...DEFAULT_STAGES, 'PAY3'], ['CALL1', 'QUOTATION', 'CLOSED DEAL', 'PAY1'], ['CALL1', 'PAY1'], DEFAULT_STAGES]) });
    const n = 1 + Math.floor(R.next() * 6);
    for (let i = 0; i < n; i++) {
      const id = 'd' + i;
      rows.push({ k: 'deal/' + id, v: { client: R.pick(['ก บริษัท', 'ข บริษัท', 'ก บริษัท', '', 'ABC Co']), resp: R.pick(['เอก', 'มินท์']), jobStatus: R.pick(['open', 'open', 'closed']), at: '2026-01-0' + (1 + (i % 9)) + 'T00:00:00Z' } });
      rows.push({ k: `dstep/${id}/CLOSED DEAL`, v: { d: R.pick([R.day(today, 90), '', 'bad']), n: R.pick(['YES', 'yes ', 'YES', 'NO', 'รอผู้บริหาร', '']) } });
      const lines = Math.floor(R.next() * 5);
      for (let j = 0; j < lines; j++) {
        const stage = R.pick(['PAY1', 'PAY2', 'PAY3', 'PAY10', 'PAYX', 'PAY2']);
        rows.push({
          k: `dpay/${id}/${stage}`,
          v: {
            amt: R.pick([10000, 53500.5, null, '20000', -5, 0, 7777]),
            pct: R.pick([null, 50]),
            due: R.pick([R.day(today, 30), R.day(today, 5), '', 'soon', R.day(today, 400)]),
            rel: R.pick([null, 0, 30, 15, 1.5, 900, '7']),
            rcv: R.pick(['', '', R.day(today, 20)]),
            got: R.pick([null, null, 5000, 10000, 0]),
            full: R.pick([false, true, 'yes']),
            fullAt: R.pick([null, 5000, 10000]),
            add: R.pick([false, true]),
          },
        });
        if (R.next() < 0.4)
          rows.push({
            k: `ddoc/${id}/a${j}`,
            v: { kind: R.pick(['invoice', 'receipt', 'quotation']), target: R.pick(['actual', 'actual', 'forecast', 'none', 'bogus']), amount: R.pick([10000, 3000, null, '2500', 'x']), stage, at: '2026-0' + (1 + j) + '-01T00:00:00Z', name: 'a.pdf', size: 1 },
          });
      }
      // later rows: deletions, and records that can't be read (the one before stays)
      if (R.next() < 0.15) rows.push({ k: `dpay/${id}/PAY1`, v: null });
      if (R.next() < 0.1) rows.push({ k: `ddoc/${id}/a0`, v: null });
      if (R.next() < 0.1) rows.push({ k: 'deal/' + id, v: 'not a record' });
      if (R.next() < 0.1) rows.push({ k: `dpay/${id}/PAY2`, v: [1, 2] });
      if (R.next() < 0.08) rows.push({ k: `dstep/${id}/CLOSED DEAL`, v: null });
      if (R.next() < 0.05) rows.push({ k: 'deal/' + id, v: null });
    }
    if (R.next() < 0.3) rows.push({ k: 'scfg/stages', v: 'not a list' });
    return { rows, today, from: R.pick(['', today, R.day(today, 10)]), to: R.day(today, 40) };
  }

  it('the same instalments, statuses, amounts and order on 200 random trackers', () => {
    const s = mk();
    let lines = 0, due = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const c = caseOf(seed);
      // the web app: rows applied the way a pull applies them
      const sh: SharedState = { crm: emptyCrm(), contacts: {}, dec: {}, sales: emptySales(), custom: {}, people: {} };
      const fx = noEffects();
      const rows: SyncRow[] = c.rows.map((r, i) => ({ seq: i + 1, k: r.k, v: r.v, del: r.v == null, by: 'x', at: '' }));
      rows.forEach((row) => applyRow(sh, row, fx));
      const S = sh.sales;
      const deals = Object.keys(S.deals).sort().map((id) => S.deals[id]);
      // Code.gs: the same rows, the latest of each key
      const G = s.run<Record<string, unknown> & { deals: Record<string, Deal> }>('salesOf_', rows);
      const gDeals = Object.keys(G.deals).sort().map((id) => G.deals[id]);
      const pick = (l: { deal: { id: string }; line: { stage: string; due: string; status: string; left: number; lateDays: number; amt: number; got: number } }[]) =>
        l.map((e) => [e.deal.id, e.line.stage, e.line.due, e.line.status, e.line.left, e.line.lateDays, e.line.amt, e.line.got]);
      const want = pick(payDue(S, deals, c.from, c.to, c.today));
      expect([seed, pick(s.run('payDue_', G, gDeals, c.from, c.to, c.today))]).toEqual([seed, want]);
      due += want.length;
      // every line of every plan, paid and cancelled ones included
      for (const d of deals) {
        const pl = planLines(S, d) || [];
        const gl = s.run<{ stage: string }[] | null>('planLines_', G, G.deals[d.id]) || [];
        expect([seed, d.id, gl.map((x) => x.stage)]).toEqual([seed, d.id, pl.map((x) => x.stage)]);
        pl.forEach((x, i) => {
          const a = lineView(S, d, x, c.today);
          const b = s.run<Record<string, unknown>>('lineView_', G, G.deals[d.id], gl[i], c.today);
          expect([seed, d.id, x.stage, b]).toEqual([seed, d.id, x.stage, { stage: a.stage, n: a.n, inList: a.inList, amt: a.amt, due: a.due, got: a.got, status: a.status, left: a.left, lateDays: a.lateDays }]);
          lines++;
        });
      }
    }
    // the cases cover something
    expect(lines).toBeGreaterThan(300);
    expect(due).toBeGreaterThan(50);
  });

  it('a joint quotation\'s member pays nothing of its own (quotes design); the header carries the plan once', () => {
    const s = mk();
    const rows = (
      [
        { k: 'deal/h1', v: { client: 'มจพ' } },
        { k: 'deal/m1', v: { client: 'สมาชิก' } },
        { k: 'jqt/h1', v: { title: 'CFP มจพ' } },
        { k: 'jqm/h1/m1', v: { share: 50 } },
        { k: 'dstep/h1/CLOSED DEAL', v: { d: '2026-10-01', n: 'YES' } },
        { k: 'dstep/m1/CLOSED DEAL', v: { d: '2026-10-01', n: 'YES' } },
        { k: 'dpay/h1/PAY1', v: { amt: 1000, due: '2026-10-10' } },
        { k: 'dpay/m1/PAY1', v: { amt: 500, due: '2026-10-10' } },
      ] as { k: string; v: unknown }[]
    ).map((r, i) => ({ seq: i + 1, k: r.k, v: r.v, del: false, by: '', at: '' }));
    const G = s.run<{ deals: Record<string, unknown> }>('salesOf_', rows);
    const out = s.run<{ deal: { id: string } }[]>('payDue_', G, [G.deals.h1, G.deals.m1], '', '2026-12-31', '2026-10-12');
    expect(out.map((e) => e.deal.id)).toEqual(['h1']);
  });
});

// ------------------------------------------------------------------ the manifest

describe('appsscript.json', () => {
  const TS = join(__dirname, '..', '..', '..', 'team-sync');
  const code = readFileSync(join(TS, 'Code.gs'), 'utf8');
  const man = JSON.parse(readFileSync(join(TS, 'appsscript.json'), 'utf8'));

  it('asks for exactly what the code uses: this sheet, Drive, sending mail, the timer; a web app as its owner for anyone', () => {
    const G = 'https://www.googleapis.com/auth/';
    expect(man.oauthScopes).toEqual([G + 'spreadsheets.currentonly', G + 'drive', G + 'script.send_mail', G + 'script.scriptapp']);
    expect(man).toMatchObject({ timeZone: 'Asia/Bangkok', runtimeVersion: 'V8', webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' } });
    expect(code).toMatch(/^\/\*\* @OnlyCurrentDoc \*\//);
    for (const svc of ['SpreadsheetApp', 'DriveApp', 'MailApp', 'ScriptApp']) expect(code).toContain(svc + '.');
    // a service that needs another permission would make the owner's consent screen differ from the README
    expect(code).not.toMatch(/\b(UrlFetchApp|GmailApp|CalendarApp|DocumentApp|FormApp|SlidesApp|ContactsApp|Session\.get(Active|Effective)User)\b/);
    // the TEAM_KEY line stays empty in the repo
    expect(code).toMatch(/^const TEAM_KEY = '';$/m);
  });
});

// ------------------------------------------------------------------ secrets

describe('secrets', () => {
  it('no reply or mail contained the token secret, a code hash or a password hash', () => {
    for (const { s, replies } of seen) {
      const all = replies.join('\n') + JSON.stringify(s.mail.sent);
      const bad = [s.props.AUTH_SECRET, ...Object.values(JSON.parse(s.props.NCODE || '{}') as Record<string, { h?: string }>).map((c) => c.h)].filter((x): x is string => !!x && x.length >= 8);
      if (s.props.USERS) for (const x of Object.values(JSON.parse(s.props.USERS).users as Record<string, { s: string; h: string }>)) bad.push(x.s, x.h);
      for (const b of bad) expect(all.includes(b)).toBe(false);
      expect(all).not.toMatch(/@(?!example\.com)[a-z0-9.-]+\.[a-z]{2,}/i);
    }
  });
});
