/**
 * Accounts and roles in the team script (team-sync/Code.gs, protocol v3), run through the simulator.
 * Passwords become pk the way the web app derives them (PBKDF2 in Node, 1000 iterations in the
 * simulator). Every secret — salts, hashes, the token secret, setup codes, tokens — is generated
 * while the tests run; none is stored in the repo.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasSim, derivePk, type GasSim } from '../../../team-sync/sim.mjs';
import { canWriteKey } from './auth';
import type { Role } from './teamSync';

const KEY = 'test-key-123';
const TEAM_SYNC = join(__dirname, '..', '..', '..', 'team-sync');
const V2 = readFileSync(join(TEAM_SYNC, 'fixtures', 'Code.v2.gs'), 'utf8');
const OLD_CLIENT_MSG = 'ทีมเปลี่ยนเป็นระบบเข้าสู่ระบบแล้ว — รีเฟรชหน้าเว็บ (F5) แล้วเข้าสู่ระบบด้วยบัญชีของคุณ';
const T0 = Date.parse('2026-10-08T03:00:00.000Z');
const MIN = 60000, H = 60 * MIN, DAY = 24 * H;
const at = (ms: number) => vi.setSystemTime(T0 + ms);

// the parity test below checks the script against the web app's own write rule (canWriteKey)

// ------------------------------------------------------------------ helpers

type Reply = ReturnType<GasSim['post']>;

/** Every simulator of this file, with every reply it gave and every secret it held at the time. */
const seen: { replies: string[]; secrets: Set<string> }[] = [];
function secretsOf(s: GasSim, into: Set<string>) {
  const add = (v: unknown) => typeof v === 'string' && v.length >= 8 && into.add(v);
  add(s.props.AUTH_SECRET);
  if (s.props.OWNER_CODE) add(JSON.parse(s.props.OWNER_CODE).h);
  add(s.ownerCode());
  if (s.props.USERS)
    for (const x of Object.values(JSON.parse(s.props.USERS).users as Record<string, { s: string; h: string }>)) {
      add(x.s);
      add(x.h);
    }
}
/** A simulated deployment whose replies are kept for the secret scan at the end of the file. */
function mk(opts: Parameters<typeof createGasSim>[0] = {}): GasSim {
  const s = createGasSim({ kdfIter: 1000, ...opts });
  const rec = { replies: [] as string[], secrets: new Set<string>() };
  seen.push(rec);
  const post = s.post;
  s.post = (body) => {
    const r = post(body);
    rec.replies.push(JSON.stringify(r));
    secretsOf(s, rec.secrets);
    return r;
  };
  return s;
}
/** A team in accounts mode whose lead (admin "lead", display name หัวหน้า) is signed in. */
function team(opts: Parameters<typeof createGasSim>[0] = {}) {
  const s = mk(opts);
  const admin = s.bootstrapAdmin({ u: 'lead', name: 'หัวหน้า', pw: 'lead-password-1' });
  return { s, admin };
}
const call = (s: GasSim, tok: string, action: string, extra: Record<string, unknown> = {}) => s.post({ action, cv: 3, tok, ...extra });
const login = (s: GasSim, u: string, pw: string, rm = true) => s.post({ action: 'login', cv: 3, u, pk: s.pk(u, pw), rm });
const claim = (s: GasSim, code: string | undefined, u: string, name: string | undefined, pw: string, rm = true) =>
  s.post({ action: 'claim', cv: 3, code, u, name, pk: s.pk(u, pw), rm });
/** Admin creates an account with a temporary password (must change it at first sign-in). */
function addUser(s: GasSim, admin: string, u: string, name: string, role: Role, temp = 'temp-' + u) {
  const r = call(s, admin, 'user_save', { create: true, u, name, role, pk: s.pk(u, temp) });
  expect(r).toMatchObject({ ok: true, user: { u, name, role, on: 1, mc: true, ll: '' } });
  return r;
}
/** An account that signed in and set its own password ("own-<u>"); returns its token. */
function member(s: GasSim, admin: string, u: string, name: string, role: Role) {
  addUser(s, admin, u, name, role);
  const t = login(s, u, 'temp-' + u);
  expect(t).toMatchObject({ ok: true, mc: true });
  const r = call(s, String(t.tok), 'passwd', { old: s.pk(u, 'temp-' + u), pk: s.pk(u, 'own-' + u) });
  expect(r).toMatchObject({ ok: true, me: { u, name, role } });
  return String(r.tok);
}
const users = (s: GasSim) => JSON.parse(s.props.USERS).users as Record<string, { n: string; r: Role; on: number; sv: number; mc: number; ll: string; c: string }>;
const loginBody = (s: GasSim, u: string, pw: string) => ({ action: 'login', cv: 3, u, pk: s.pk(u, pw), rm: true });
/** The wrong-password counters and lockouts in the script cache (LF:, LK:, LG:). */
const counters = (s: GasSim) => Object.fromEntries(Object.entries(s.cache).filter(([k]) => /^L[FKG]:/.test(k)));
/**
 * Requests sent at the same moment, run the way Apps Script runs them side by side: none sees what
 * the others wrote before it reads the cache. One that reaches the user lock waits there while the
 * next one starts, and the waiting ones then take the lock one at a time (the last to arrive first);
 * one that never takes it starts from the counters as they were, and its writes land after all of
 * them, the last one winning (CacheService has no increment). Replies in the order sent.
 */
function burst(s: GasSim, bodies: Record<string, unknown>[]): Reply[] {
  const start = counters(s);
  const late: [string, string | undefined][] = [];
  const out: Reply[] = [];
  const send = (i: number) => {
    let queued = false;
    s.beforeLock(() => {
      queued = true;
      if (i + 1 < bodies.length) send(i + 1);
    }, 'user');
    out[i] = s.post(bodies[i]);
    if (queued) return;
    s.beforeLock(null, 'user');
    const now = counters(s);
    for (const k of new Set([...Object.keys(start), ...Object.keys(now)])) if (now[k] !== start[k]) late.push([k, now[k]]);
    for (const k of Object.keys(now)) delete s.cache[k];
    Object.assign(s.cache, start);
    if (i + 1 < bodies.length) send(i + 1);
  };
  send(0);
  for (const [k, v] of late) {
    if (v === undefined) delete s.cache[k];
    else s.cache[k] = v;
  }
  return out;
}
const rows = (s: GasSim, tok: string) => call(s, tok, 'pull', { since: 0 }).rows!;
const expired = { ok: false, error: 'session_expired' };
const upload = { docId: 'deal-1.q1', name: 'q.pdf', mime: 'application/pdf', data: 'JVBERg==' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ 1. legacy mode

describe('legacy mode (team code, no accounts) is unchanged', () => {
  it('answers exactly like the v2 script, reply for reply', () => {
    const v2 = mk({ code: V2 });
    const v3 = mk();
    const reqs: unknown[] = [
      { action: 'ping', key: KEY },
      { action: 'ping', key: 'wrong-key-1' },
      { action: 'ping' },
      { action: 'pull', key: KEY, since: 0 },
      {
        action: 'push',
        key: KEY,
        ops: [
          { k: 'stage/1', v: 'won', by: 'มกร' },
          { k: 'deal/d1', v: null },
          { k: 'deal/d2' },
          { k: 'scfg/sources', v: ['a'], by: 'x'.repeat(150) },
          { k: 'log/1/a', v: { at: 'x', type: 'call', by: 'ใครก็ได้' }, by: 'ใครก็ได้' },
          { k: 'x/big', v: 'x'.repeat(46000) },
          { k: '' },
          null,
        ],
      },
      { action: 'push', key: KEY, ops: [{ k: 'watch/1', del: true }] },
      { action: 'push', key: KEY, ops: 'nope' },
      { action: 'push', key: KEY, ops: Array.from({ length: 1001 }, (_, i) => ({ k: 'a/' + i, v: 1 })) },
      { action: 'pull', key: KEY, since: 0 },
      { action: 'pull', key: KEY, since: 2, limit: 1 },
      { action: 'pull', key: KEY, since: 99 },
      { action: 'ping', key: KEY },
      { action: 'nope', key: KEY },
      { action: ['ping'], key: KEY },
      { key: KEY },
      'not json',
    ];
    for (const r of reqs) expect(JSON.stringify(v3.post(r))).toBe(JSON.stringify(v2.post(r)));
    for (const k of ['', '1234567']) expect(JSON.stringify(mk({ teamKey: k }).post({ action: 'ping', key: k }))).toBe(JSON.stringify(mk({ code: V2, teamKey: k }).post({ action: 'ping', key: k })));
  });

  it('a team-code push reply has no denied or me, and rows keep the by the web app sent', () => {
    const s = mk();
    expect(s.post({ action: 'push', key: KEY, ops: [{ k: 'scfg/x', v: 1, by: 'คุณเอ' }] })).toEqual({ ok: true, seq: 1, n: 1, rejected: [] });
    expect(s.post({ action: 'pull', key: KEY, since: 0, cv: 3 })).toEqual({ ok: true, seq: 1, rows: [{ seq: 1, k: 'scfg/x', v: 1, del: false, by: 'คุณเอ', at: new Date(T0).toISOString() }], more: false });
    expect(s.post({ action: 'ping', key: KEY, cv: 3 })).toEqual({ ok: true, seq: 1, files: true });
  });

  it('a token is refused while the team has no accounts; account actions need a sign-in', () => {
    const s = mk();
    const other = team().admin; // a real token, but from another team
    for (const tok of [other, 'g1.x.y']) expect(s.post({ action: 'pull', since: 0, tok, cv: 3 })).toEqual(expired);
    for (const action of ['me', 'passwd', 'logout', 'users', 'user_save']) expect(s.post({ action, key: KEY, cv: 3 })).toEqual({ ok: false, error: 'login_required' });
    expect(s.post({ action: 'login', cv: 3, u: 'lead', pk: 'x'.repeat(43) })).toEqual({ ok: false, error: 'no_accounts' });
  });
});

// ------------------------------------------------------------------ 2. hello

describe('hello', () => {
  it('needs no key and tells the mode, the team id and the iteration count', () => {
    const fresh = mk({ teamKey: '' });
    const h = fresh.post({ action: 'hello', cv: 3 });
    expect(h).toEqual({ ok: true, app: 'gcc-team-sync', v: 3, files: true, mode: 'setup', tid: expect.stringMatching(/^[0-9a-f]{16}$/), it: 1000 });
    // created on first use, then permanent
    expect(fresh.props.TEAM_ID).toBe(h.tid);
    expect(fresh.props.AUTH_SECRET).toMatch(/^[0-9a-f-]{72}$/);
    expect(fresh.post({ action: 'hello' }).tid).toBe(h.tid);
    expect(mk({ teamKey: KEY }).post({ action: 'hello', cv: 3 })).toMatchObject({ ok: true, v: 3, files: true, mode: 'legacy', it: 1000 });
    const { s } = team();
    const a = s.post({ action: 'hello', cv: 3 });
    expect(a).toEqual({ ok: true, app: 'gcc-team-sync', v: 3, files: true, mode: 'accounts', tid: s.props.TEAM_ID, it: 1000 });
    expect(JSON.stringify(a)).not.toMatch(/lead|หัวหน้า/);
    // a real script starts at 200000 iterations
    const real = mk({ teamKey: '' });
    delete real.props.KDF_ITER;
    expect(real.post({ action: 'hello' }).it).toBe(200000);
    expect(real.props.KDF_ITER).toBe('200000');
  });

  it('the v2 script answers with errors, which is how the web app recognises it', () => {
    expect(mk({ code: V2 }).post({ action: 'hello', cv: 3 })).toEqual({ ok: false, error: 'unauthorized' });
    expect(mk({ code: V2, teamKey: '' }).post({ action: 'hello', cv: 3 })).toEqual({ ok: false, error: 'no_team_key' });
    expect(mk({ code: V2 }).post({ action: 'hello', cv: 3, key: KEY })).toEqual({ ok: false, error: 'unknown_action' });
    expect(V2.split('\n')[0]).toBe('// frozen copy of protocol v2 for tests — never deploy');
  });
});

// ------------------------------------------------------------------ 3. setup()

describe('setup()', () => {
  it('prints a one-time setup code; once accounts exist, a recovery code; each run replaces the last', () => {
    const s = mk({ teamKey: '' });
    s.setup();
    expect(s.logs.some((l) => l.startsWith('พร้อมใช้งาน: สร้างชีต "sync"'))).toBe(true);
    expect(s.logs.at(-1)).toMatch(/^รหัสตั้งค่าผู้ดูแลระบบ: \d{4}-\d{4} \(ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง\)$/);
    const first = s.ownerCode()!;
    let second = first;
    while (second === first) {
      s.setup();
      second = s.ownerCode()!;
    }
    expect(claim(s, first, 'lead', 'หัวหน้า', 'pw-lead-01')).toEqual({ ok: false, error: 'bad_code' });
    expect(claim(s, second, 'lead', 'หัวหน้า', 'pw-lead-01').ok).toBe(true);
    expect(s.logs.some((l) => l.startsWith('ชื่อผู้ใช้ผู้ดูแลระบบ'))).toBe(false);
    s.setup();
    expect(s.logs.at(-1)).toMatch(/^รหัสกู้คืนผู้ดูแลระบบ \(ใช้เมื่อลืมรหัสผ่าน\): \d{4}-\d{4} \(ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง\)$/);
    // the usernames a recovery code is for, just above it (only the admins)
    const admin = String(login(s, 'lead', 'pw-lead-01').tok);
    addUser(s, admin, 'somchai', 'สมชาย', 'sales');
    addUser(s, admin, 'boss2', 'รองหัวหน้า', 'admin');
    s.setup();
    expect(s.logs.at(-2)).toBe('ชื่อผู้ใช้ผู้ดูแลระบบ: lead, boss2');
    // only a hash of the code is stored
    expect(s.props.OWNER_CODE).not.toContain(s.ownerCode()!.replace('-', ''));
    expect(JSON.parse(s.props.OWNER_CODE)).toEqual({ h: expect.stringMatching(/^[0-9a-f]{64}$/), exp: T0 + DAY, n: 0 });
  });

  it('needs no TEAM_KEY, but refuses one shorter than 8 characters', () => {
    const s = mk({ teamKey: '' });
    expect(() => s.setup()).not.toThrow();
    expect(s.sheet()!.rows[0][0]).toBe('seq');
    expect(s.props).toMatchObject({ TEAM_ID: expect.any(String), AUTH_SECRET: expect.any(String), KDF_ITER: '1000' });
    for (const k of ['a', '1234567']) expect(() => mk({ teamKey: k }).setup()).toThrow('TEAM_KEY ต้องยาวอย่างน้อย 8 ตัวอักษร (หรือเว้นว่างไว้ถ้าใช้บัญชีผู้ใช้อย่างเดียว)');
    expect(() => mk({ teamKey: KEY }).setup()).not.toThrow();
  });
});

// ------------------------------------------------------------------ 4. claim

describe('claim (first admin and recovery)', () => {
  const ready = () => {
    const s = mk({ teamKey: '' });
    s.setup();
    const code = s.ownerCode()!;
    return { s, code, wrong: code === '0000-0000' ? '1111-1111' : '0000-0000' };
  };

  it('a wrong code is refused, and the fifth wrong try uses the code up', () => {
    const a = ready();
    for (let i = 0; i < 4; i++) expect(claim(a.s, a.wrong, 'lead', 'หัวหน้า', 'pw-lead-01')).toEqual({ ok: false, error: 'bad_code' });
    expect(claim(a.s, a.code, 'lead', 'หัวหน้า', 'pw-lead-01').ok).toBe(true);
    const b = ready();
    for (let i = 0; i < 5; i++) expect(claim(b.s, b.wrong, 'lead', 'หัวหน้า', 'pw-lead-01').error).toBe('bad_code');
    expect(b.s.props.OWNER_CODE).toBeUndefined();
    expect(claim(b.s, b.code, 'lead', 'หัวหน้า', 'pw-lead-01')).toEqual({ ok: false, error: 'bad_code' });
    // a code that isn't 8 digits is no try at all; spaces and dashes don't matter
    const c = ready();
    for (const x of ['', '123', '1234-56789', undefined]) expect(claim(c.s, x, 'lead', 'หัวหน้า', 'pw-lead-01').error).toBe('bad_code');
    expect(JSON.parse(c.s.props.OWNER_CODE).n).toBe(0);
    expect(claim(c.s, ' ' + c.code.replace('-', ' ') + ' ', 'lead', 'หัวหน้า', 'pw-lead-01').ok).toBe(true);
  });

  it('a code lasts 24 hours and works once', () => {
    const a = ready(), b = ready();
    at(DAY - 1000);
    expect(claim(b.s, b.code, 'lead', 'หัวหน้า', 'pw-lead-01').ok).toBe(true);
    expect(claim(b.s, b.code, 'second', 'รอง', 'pw-second-1')).toEqual({ ok: false, error: 'bad_code' });
    at(DAY + 1000);
    expect(claim(a.s, a.code, 'lead', 'หัวหน้า', 'pw-lead-01')).toEqual({ ok: false, error: 'bad_code' });
  });

  it('a mistyped username, password data or name does not use up the code', () => {
    const { s, code } = ready();
    for (const u of ['ab', 'มกร', 'has space', '-lead', 'x'.repeat(33)]) expect(claim(s, code, u, 'หัวหน้า', 'pw-lead-01')).toEqual({ ok: false, error: 'bad_user' });
    for (const pk of [undefined, '', 'short', 'x'.repeat(44), '!'.repeat(43)])
      expect(s.post({ action: 'claim', cv: 3, code, u: 'lead', name: 'หัวหน้า', pk })).toEqual({ ok: false, error: 'bad_password_data' });
    for (const name of [undefined, '', '   ', 'ก'.repeat(41), 'a\u0001b']) expect(claim(s, code, 'lead', name, 'pw-lead-01')).toEqual({ ok: false, error: 'bad_name' });
    expect(JSON.parse(s.props.OWNER_CODE).n).toBe(0);
    expect(claim(s, code, 'lead', '  หัวหน้า   ทีม ', 'pw-lead-01')).toMatchObject({ ok: true, me: { u: 'lead', name: 'หัวหน้า ทีม', role: 'admin' } });
  });

  it('creates the first admin, signs them in and switches the team to accounts', () => {
    const { s, code } = ready();
    expect(s.post({ action: 'hello' }).mode).toBe('setup');
    // usernames are case-insensitive (the web app derives pk with the lower-case name)
    const r = s.post({ action: 'claim', cv: 3, code, u: ' Lead ', name: 'หัวหน้า', pk: s.pk('lead', 'pw-lead-01'), rm: true });
    expect(r).toEqual({ ok: true, tok: expect.stringMatching(/^g1\.[\w-]+=*\.[\w-]+=*$/), exp: T0 + 30 * DAY, me: { u: 'lead', name: 'หัวหน้า', role: 'admin' }, mc: false });
    expect(users(s).lead).toEqual({ n: 'หัวหน้า', r: 'admin', on: 1, sv: 1, s: expect.any(String), h: expect.any(String), mc: 0, c: new Date(T0).toISOString(), ll: new Date(T0).toISOString() });
    expect(s.props.OWNER_CODE).toBeUndefined();
    expect(s.post({ action: 'hello' }).mode).toBe('accounts');
    expect(call(s, String(r.tok), 'ping')).toEqual({ ok: true, seq: 0, files: true, me: { u: 'lead', name: 'หัวหน้า', role: 'admin' } });
    expect(login(s, 'lead', 'pw-lead-01', false)).toMatchObject({ ok: true, exp: T0 + 12 * H, mc: false });
    // the helper the other tests use does the same
    const t = mk({ teamKey: '' });
    expect(call(t, t.bootstrapAdmin({ u: 'boss', name: 'บอส', pw: 'pw-boss-01' }), 'me')).toMatchObject({ ok: true, me: { u: 'boss', role: 'admin' } });
  });

  it('with accounts: an admin who forgot the password gets back in, and old sessions end', () => {
    const { s, admin } = team();
    s.setup();
    const r = claim(s, s.ownerCode(), 'lead', 'ignored', 'new-lead-pw-1');
    expect(r).toMatchObject({ ok: true, me: { u: 'lead', name: 'หัวหน้า', role: 'admin' }, mc: false });
    expect(users(s).lead).toMatchObject({ n: 'หัวหน้า', sv: 2 });
    expect(call(s, admin, 'ping')).toEqual(expired);
    expect(login(s, 'lead', 'lead-password-1')).toEqual({ ok: false, error: 'bad_login' });
    expect(login(s, 'lead', 'new-lead-pw-1').ok).toBe(true);
  });

  it('with accounts: recovery makes a disabled, locked-out account an active admin', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, admin, 'user_save', { u: 'somchai', on: 0 }).ok).toBe(true);
    for (let i = 0; i < 5; i++) login(s, 'somchai', 'nope');
    expect(login(s, 'somchai', 'own-somchai').error).toBe('locked');
    s.setup();
    expect(claim(s, s.ownerCode(), 'somchai', undefined, 'new-pw-0001')).toMatchObject({ ok: true, me: { u: 'somchai', name: 'สมชาย', role: 'admin' }, mc: false });
    expect(users(s).somchai).toMatchObject({ r: 'admin', on: 1, mc: 0 });
    expect(call(s, tok, 'ping')).toEqual(expired);
    expect(login(s, 'somchai', 'new-pw-0001')).toMatchObject({ ok: true, me: { role: 'admin' } }); // no longer locked
  });

  it('with accounts: a new username becomes another admin, under a display name nobody has', () => {
    const { s } = team();
    s.setup();
    const code = s.ownerCode();
    expect(claim(s, code, 'second', 'หัวหน้า', 'pw-second-1')).toEqual({ ok: false, error: 'name_taken' });
    for (const name of ['', '   ']) expect(claim(s, code, 'second', name, 'pw-second-1')).toEqual({ ok: false, error: 'bad_name' });
    expect(claim(s, code, 'second', 'รองหัวหน้า', 'pw-second-1')).toMatchObject({ ok: true, me: { u: 'second', name: 'รองหัวหน้า', role: 'admin' } });
    expect(Object.keys(users(s))).toEqual(['lead', 'second']);
  });

  it('with accounts: a recovery (no display name) for a username that does not exist answers unknown_user', () => {
    const { s } = team();
    s.setup();
    const code = s.ownerCode()!;
    const wrong = code === '0000-0000' ? '1111-1111' : '0000-0000';
    // without the right code nobody learns which usernames exist
    for (const u of ['leader', 'lead']) expect(claim(s, wrong, u, undefined, 'new-lead-pw-1')).toEqual({ ok: false, error: 'bad_code' });
    // a mistyped username is not taken for a new admin, and leaves the code usable
    expect(claim(s, code, 'leader', undefined, 'new-lead-pw-1')).toEqual({ ok: false, error: 'unknown_user' });
    expect(JSON.parse(s.props.OWNER_CODE).n).toBe(2);
    expect(claim(s, code, 'lead', undefined, 'new-lead-pw-1')).toMatchObject({ ok: true, me: { u: 'lead', role: 'admin' } });
    expect(Object.keys(users(s))).toEqual(['lead']);
  });
});

// ------------------------------------------------------------------ 5. the team code after the claim

describe('once the first admin exists', () => {
  it('the team code grants nothing: login_required for the web app, a Thai sentence for older builds', () => {
    const s = mk();
    expect(s.post({ action: 'push', key: KEY, ops: [{ k: 'stage/1', v: 'won' }] }).ok).toBe(true);
    const admin = s.bootstrapAdmin({ u: 'lead', name: 'หัวหน้า', pw: 'lead-password-1' });
    const fileId = String(call(s, admin, 'upload', upload).fileId);
    const bodies = [
      { action: 'ping' },
      { action: 'pull', since: 0 },
      { action: 'push', ops: [{ k: 'stage/2', v: 'won' }] },
      { action: 'upload', ...upload, docId: 'other' },
      { action: 'file', fileId },
      { action: 'delfile', fileId },
    ];
    for (const b of bodies) {
      expect(s.post({ ...b, key: KEY, cv: 3 })).toEqual({ ok: false, error: 'login_required' });
      expect(s.post({ ...b, key: KEY })).toEqual({ ok: false, error: OLD_CLIENT_MSG });
      expect(s.post({ ...b, cv: 3 })).toEqual({ ok: false, error: 'login_required' });
      expect(s.post({ ...b, tok: '', cv: 3 })).toEqual({ ok: false, error: 'login_required' });
    }
    expect(rows(s, admin).map((r) => r.k)).toEqual(['stage/1']);
    expect(s.drive.list().filter((x) => x.kind === 'file' && !x.trashed)).toHaveLength(1);
    expect(call(s, admin, 'file', { fileId })).toMatchObject({ ok: true, data: 'JVBERg==' });
  });

  it('a team-code push that waited for the lock while the lead claimed is refused (claim race)', () => {
    const s = mk();
    expect(s.post({ action: 'ping', key: KEY }).ok).toBe(true); // legacy, "no accounts" cached
    s.setup();
    const code = s.ownerCode();
    s.beforeLock(() => expect(claim(s, code, 'lead', 'หัวหน้า', 'pw-lead-01').ok).toBe(true));
    expect(s.post({ action: 'push', key: KEY, cv: 3, ops: [{ k: 'stage/9', v: 'won' }] })).toEqual({ ok: false, error: 'login_required' });
    expect(s.sheet()!.getLastRow()).toBe(1); // the header only
    expect(Number(s.props.SEQ || 0)).toBe(0);
    expect(s.post({ action: 'ping', key: KEY, cv: 3 })).toEqual({ ok: false, error: 'login_required' });
  });

  it('a token works even while a stale cache still says the team has no accounts', () => {
    const { s, admin } = team();
    s.cache.AUTHC = '{"m":"none"}'; // written by a request that read Properties just before the claim
    expect(call(s, admin, 'ping')).toMatchObject({ ok: true, me: { u: 'lead' } });
    expect(JSON.parse(s.cache.AUTHC).m).toBe('accounts');
  });
});

// ------------------------------------------------------------------ 6. login

describe('login', () => {
  it('signs in, tells whether the password must be changed, and records the time', () => {
    const { s, admin } = team();
    addUser(s, admin, 'somchai', 'สมชาย', 'sales', 'temp-pw-1');
    at(H);
    const r = login(s, 'somchai', 'temp-pw-1', false);
    expect(r).toEqual({ ok: true, tok: expect.stringMatching(/^g1\./), exp: T0 + H + 12 * H, me: { u: 'somchai', name: 'สมชาย', role: 'sales' }, mc: true });
    expect(users(s).somchai.ll).toBe(new Date(T0 + H).toISOString());
    expect(s.post({ action: 'login', u: ' SomChai ', pk: s.pk('somchai', 'temp-pw-1') }).ok).toBe(true);
  });

  it('a wrong password and an unknown username get the very same answer', () => {
    const { s, admin } = team();
    addUser(s, admin, 'somchai', 'สมชาย', 'sales', 'temp-pw-1');
    const bad = { ok: false, error: 'bad_login' };
    expect(login(s, 'somchai', 'nope')).toEqual(bad);
    expect(login(s, 'nobody', 'nope')).toEqual(bad);
    expect(login(s, 'constructor', 'nope')).toEqual(bad);
    for (const body of [{ u: 'somchai', pk: 'not-a-pk' }, { u: 'somchai' }, {}, { u: 'ab', pk: s.pk('ab', 'x') }]) expect(s.post({ action: 'login', cv: 3, ...body })).toEqual(bad);
  });

  it('the fifth wrong password locks the username for 15 minutes, even with the right password', () => {
    const { s } = team();
    for (let i = 0; i < 4; i++) expect(login(s, 'lead', 'nope' + i).error).toBe('bad_login');
    expect(login(s, 'lead', 'nope')).toEqual({ ok: false, error: 'locked', retryIn: 900 });
    expect(login(s, 'lead', 'lead-password-1')).toEqual({ ok: false, error: 'locked', retryIn: 900 });
    at(10 * MIN);
    expect(login(s, 'lead', 'lead-password-1')).toEqual({ ok: false, error: 'locked', retryIn: 300 });
    at(15 * MIN + 1000);
    expect(login(s, 'lead', 'lead-password-1').ok).toBe(true);
    // wrong passwords further apart than 15 minutes never add up
    for (let i = 0; i < 4; i++) expect(login(s, 'lead', 'nope').error).toBe('bad_login');
    at(31 * MIN + 1000);
    for (let i = 0; i < 4; i++) expect(login(s, 'lead', 'nope').error).toBe('bad_login');
    expect(login(s, 'lead', 'lead-password-1').ok).toBe(true);
  });

  it('more than 30 wrong passwords team-wide stop every login for a while; sessions keep working', () => {
    const { s, admin } = team();
    for (let i = 0; i < 31; i++) expect(login(s, 'guess' + i, 'nope').error).toBe('bad_login');
    expect(login(s, 'lead', 'lead-password-1')).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(call(s, admin, 'pull', { since: 0 }).ok).toBe(true);
    at(10 * MIN);
    expect(login(s, 'lead', 'lead-password-1').error).toBe('too_many_attempts'); // the previous window still counts
    at(20 * MIN);
    expect(login(s, 'lead', 'lead-password-1').ok).toBe(true);
  });

  it('a disabled account is told so only after the right password', () => {
    const { s, admin } = team();
    member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, admin, 'user_save', { u: 'somchai', on: 0 }).ok).toBe(true);
    expect(login(s, 'somchai', 'nope')).toEqual({ ok: false, error: 'bad_login' });
    expect(login(s, 'somchai', 'own-somchai')).toEqual({ ok: false, error: 'account_disabled' });
  });

  it('a sign-in that waited while a password change, a recovery or a disable was saved gets no token', () => {
    // beforeLock runs the other request while this sign-in, its password already checked against the
    // copy it read, waits for the script lock to record the time
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    let r: Reply | undefined;
    // the account's owner changes the password while someone who knows the old one signs in
    s.beforeLock(() => (r = call(s, tok, 'passwd', { old: s.pk('somchai', 'own-somchai'), pk: s.pk('somchai', 'pw-2-somchai') })));
    expect(login(s, 'somchai', 'own-somchai')).toEqual({ ok: false, error: 'bad_login' });
    expect(r).toMatchObject({ ok: true });
    expect(login(s, 'somchai', 'pw-2-somchai').ok).toBe(true);
    // the Sheet's owner takes the lead's account back with a recovery code
    s.setup();
    const code = s.ownerCode();
    s.beforeLock(() => (r = claim(s, code, 'lead', undefined, 'recovered-pw-1')));
    expect(login(s, 'lead', 'lead-password-1')).toEqual({ ok: false, error: 'bad_login' });
    expect(r).toMatchObject({ ok: true, me: { u: 'lead', role: 'admin' } });
    expect(call(s, admin, 'ping')).toEqual(expired);
    const lead = String(r!.tok);
    // disabled meanwhile: no token now, so none that re-enabling the account would bring back
    s.beforeLock(() => (r = call(s, lead, 'user_save', { u: 'somchai', on: 0 })));
    expect(login(s, 'somchai', 'pw-2-somchai')).toEqual({ ok: false, error: 'account_disabled' });
    expect(r).toMatchObject({ ok: true, user: { on: 0 } });
    expect(call(s, lead, 'user_save', { u: 'somchai', on: 1 }).ok).toBe(true);
    expect(login(s, 'somchai', 'pw-2-somchai').ok).toBe(true);
    // only signed out everywhere meanwhile: the password is still the right one, so the sign-in stands
    s.beforeLock(() => (r = call(s, lead, 'user_save', { u: 'somchai', kick: true })));
    const k = login(s, 'somchai', 'pw-2-somchai');
    expect(r).toMatchObject({ ok: true });
    expect(call(s, String(k.tok), 'ping')).toMatchObject({ ok: true, me: { u: 'somchai' } });
  });

  it('a password is checked and counted only under the user lock, which syncing never takes', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const release = s.holdLock('user'); // another sign-in being checked right now
    try {
      expect(login(s, 'somchai', 'nope')).toEqual({ ok: false, error: 'busy' });
      expect(login(s, 'somchai', 'own-somchai')).toEqual({ ok: false, error: 'busy' });
      expect(call(s, tok, 'passwd', { old: s.pk('somchai', 'nope'), pk: s.pk('somchai', 'x-new-pw-1') })).toEqual({ ok: false, error: 'busy' });
      expect(counters(s)).toEqual({}); // nothing is counted outside it
      expect(call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'won' }] }).ok).toBe(true);
      expect(call(s, tok, 'pull', { since: 0 }).ok).toBe(true);
    } finally {
      release();
    }
    expect(login(s, 'somchai', 'own-somchai').ok).toBe(true);
  });

  it('wrong passwords sent at the same moment are checked and counted one after another', () => {
    // 30 at one username, the right password sent first (so it waits longest): only 5 are checked
    const a = team().s;
    let bodies = [loginBody(a, 'lead', 'lead-password-1'), ...Array.from({ length: 29 }, (_, i) => loginBody(a, 'lead', 'guess-' + i))];
    let hmac = vi.spyOn(a.Utilities, 'computeHmacSha256Signature'); // one call per password checked
    let r = burst(a, bodies);
    expect(hmac).toHaveBeenCalledTimes(5);
    expect(r.filter((x) => x.error === 'bad_login')).toHaveLength(4);
    expect(r.filter((x) => x.error === 'locked' && x.retryIn === 900)).toHaveLength(26);
    expect(r[0]).toEqual({ ok: false, error: 'locked', retryIn: 900 });
    hmac.mockRestore();
    // team-wide: 40 at different usernames, then the lead's right password; 31 are checked
    const b = team().s;
    bodies = [loginBody(b, 'lead', 'lead-password-1'), ...Array.from({ length: 40 }, (_, i) => loginBody(b, 'guess' + i, 'nope'))];
    hmac = vi.spyOn(b.Utilities, 'computeHmacSha256Signature');
    r = burst(b, bodies);
    expect(hmac).toHaveBeenCalledTimes(31);
    expect(r.filter((x) => x.error === 'bad_login')).toHaveLength(31);
    expect(r.filter((x) => x.error === 'too_many_attempts')).toHaveLength(10);
    expect(r[0]).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(login(b, 'lead', 'lead-password-1').error).toBe('too_many_attempts');
  });

  it('a wrong password never takes the script lock or writes Properties', () => {
    const { s, admin } = team();
    addUser(s, admin, 'somchai', 'สมชาย', 'sales', 'temp-pw-1');
    const writes = s.stats.propWrite;
    const release = s.holdLock(); // e.g. a long push in progress
    try {
      expect(login(s, 'somchai', 'nope')).toEqual({ ok: false, error: 'bad_login' });
      expect(login(s, 'nobody', 'nope')).toEqual({ ok: false, error: 'bad_login' });
      for (let i = 0; i < 4; i++) login(s, 'somchai', 'nope');
      expect(login(s, 'somchai', 'nope').error).toBe('locked');
      expect(s.stats.propWrite).toBe(writes);
    } finally {
      release();
    }
  });
});

// ------------------------------------------------------------------ 7. tokens

describe('session tokens', () => {
  // the token format, so a test can sign one with any secret
  const b64 = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const forge = (payload: object, secret: string) => {
    const P = b64(Buffer.from(JSON.stringify(payload)));
    return 'g1.' + P + '.' + b64(createHmac('sha256', secret).update(P).digest());
  };

  it('only a token signed by this script, for an existing account and its current sessions, is accepted', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const [g, P, S] = tok.split('.');
    const payload = JSON.parse(Buffer.from(P, 'base64url').toString());
    expect(payload).toEqual({ u: 'somchai', sv: 2, exp: T0 + 30 * DAY, rm: 1 });
    const flip = (x: string, i: number) => x.slice(0, i) + (x[i] === 'A' ? 'B' : 'A') + x.slice(i + 1);
    const enc = (o: object) => b64(Buffer.from(JSON.stringify(o)));
    const bad = [
      `${g}.${flip(P, 5)}.${S}`,
      `${g}.${P}.${flip(S, 5)}`,
      `${g}.${enc({ ...payload, u: 'lead' })}.${S}`,
      `${g}.${enc({ ...payload, exp: payload.exp + DAY })}.${S}`,
      `g2.${P}.${S}`,
      `${g}.${P}`,
      `${tok}.x`,
      forge(payload, 'another-secret'),
      forge({ ...payload, u: 'ghost' }, s.props.AUTH_SECRET),
      forge({ ...payload, sv: 1 }, s.props.AUTH_SECRET),
      forge({ ...payload, exp: T0 - 1 }, s.props.AUTH_SECRET),
      team().admin, // another team's
      'garbage',
      'g1..',
    ];
    for (const t of bad) expect(call(s, t, 'ping')).toEqual(expired);
    expect(call(s, forge(payload, s.props.AUTH_SECRET), 'ping')).toMatchObject({ ok: true, me: { u: 'somchai' } });
    expect(call(s, tok, 'ping')).toMatchObject({ ok: true, me: { u: 'somchai', name: 'สมชาย', role: 'sales' } });
  });

  it('a session without "remember me" ends after 12 hours and is never renewed', () => {
    const { s } = team();
    const tok = String(login(s, 'lead', 'lead-password-1', false).tok);
    at(12 * H - 1000);
    const r = call(s, tok, 'ping');
    expect(r).toEqual({ ok: true, seq: 0, files: true, me: { u: 'lead', name: 'หัวหน้า', role: 'admin' } });
    at(12 * H + 1);
    expect(call(s, tok, 'ping')).toEqual(expired);
  });

  it('a remembered session is renewed once fewer than 15 days remain, and ends after 30 days unused', () => {
    const { s, admin } = team();
    at(15 * DAY - 1000);
    expect(call(s, admin, 'pull', { since: 0 })).not.toHaveProperty('tok');
    at(15 * DAY + 1000);
    const r = call(s, admin, 'pull', { since: 0 });
    expect(r).toMatchObject({ ok: true, tok: expect.stringMatching(/^g1\./), exp: T0 + 15 * DAY + 1000 + 30 * DAY });
    const renewed = String(r.tok);
    expect(call(s, renewed, 'me')).toEqual({ ok: true, mc: false, me: { u: 'lead', name: 'หัวหน้า', role: 'admin' } });
    for (const action of ['ping', 'me', 'users']) expect(call(s, admin, action)).toHaveProperty('tok'); // any reply renews
    at(30 * DAY + 1000);
    expect(call(s, admin, 'ping')).toEqual(expired);
    expect(call(s, renewed, 'ping').ok).toBe(true);
    at(15 * DAY + 1000 + 30 * DAY + 1000);
    expect(call(s, renewed, 'ping')).toEqual(expired);
  });

  it('a role change applies on the next request, without signing in again', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'won' }] }).ok).toBe(true);
    expect(call(s, admin, 'user_save', { u: 'somchai', role: 'viewer' })).toMatchObject({ ok: true, user: { role: 'viewer' } });
    expect(call(s, tok, 'pull', { since: 0 })).toMatchObject({ ok: true, me: { u: 'somchai', role: 'viewer' } });
    expect(call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'lost' }] })).toMatchObject({ ok: false, error: 'forbidden', me: { role: 'viewer' } });
    call(s, admin, 'user_save', { u: 'somchai', role: 'admin' });
    expect(call(s, tok, 'users')).toMatchObject({ ok: true, me: { role: 'admin' } });
  });

  it('disabling, a password change, an admin reset, "sign out everywhere" and logout{all} end older sessions', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    // disabled: told so (not just "expired"), and re-enabling does not revive the session
    call(s, admin, 'user_save', { u: 'somchai', on: 0 });
    expect(call(s, tok, 'ping')).toEqual({ ok: false, error: 'account_disabled' });
    call(s, admin, 'user_save', { u: 'somchai', on: 1 });
    expect(call(s, tok, 'ping')).toEqual(expired);
    // a password change ends the other device's session too, and hands this one a new token
    const a = String(login(s, 'somchai', 'own-somchai').tok), b = String(login(s, 'somchai', 'own-somchai').tok);
    const p = call(s, a, 'passwd', { old: s.pk('somchai', 'own-somchai'), pk: s.pk('somchai', 'pw-2-somchai') });
    expect(p).toEqual({ ok: true, tok: expect.any(String), exp: T0 + 30 * DAY, me: { u: 'somchai', name: 'สมชาย', role: 'sales' } });
    for (const t of [a, b]) expect(call(s, t, 'ping')).toEqual(expired);
    expect(call(s, String(p.tok), 'ping').ok).toBe(true);
    // reset by an admin (new temporary password)
    const c = String(login(s, 'somchai', 'pw-2-somchai').tok);
    expect(call(s, admin, 'user_save', { u: 'somchai', pk: s.pk('somchai', 'temp-again') })).toMatchObject({ ok: true, user: { mc: true } });
    expect(call(s, c, 'ping')).toEqual(expired);
    expect(login(s, 'somchai', 'pw-2-somchai').error).toBe('bad_login');
    const d = login(s, 'somchai', 'temp-again');
    expect(d).toMatchObject({ ok: true, mc: true });
    const e = String(call(s, String(d.tok), 'passwd', { old: s.pk('somchai', 'temp-again'), pk: s.pk('somchai', 'pw-3-somchai') }).tok);
    // "sign out everywhere" by an admin
    expect(call(s, admin, 'user_save', { u: 'somchai', kick: true }).ok).toBe(true);
    expect(call(s, e, 'ping')).toEqual(expired);
    // logout: a plain one leaves other sessions alone, all:true ends every session
    const f = String(login(s, 'somchai', 'pw-3-somchai').tok), g = String(login(s, 'somchai', 'pw-3-somchai').tok);
    expect(call(s, f, 'logout')).toEqual({ ok: true });
    expect(call(s, g, 'ping').ok).toBe(true);
    expect(call(s, g, 'logout', { all: true })).toEqual({ ok: true });
    for (const t of [f, g]) expect(call(s, t, 'ping')).toEqual(expired);
    // a password change keeps a short session short unless asked otherwise
    const h = String(login(s, 'somchai', 'pw-3-somchai', false).tok);
    expect(call(s, h, 'passwd', { old: s.pk('somchai', 'pw-3-somchai'), pk: s.pk('somchai', 'pw-4-somchai') }).exp).toBe(T0 + 12 * H);
  });
});

// ------------------------------------------------------------------ 8. must change password

describe('temporary password (must change)', () => {
  it('a new account can only read its status, change its password or sign out', () => {
    const { s, admin } = team();
    const fileId = call(s, admin, 'upload', upload).fileId;
    addUser(s, admin, 'nid', 'นิด', 'admin', 'temp-1');
    const t = login(s, 'nid', 'temp-1');
    expect(t).toMatchObject({ ok: true, mc: true, me: { u: 'nid', role: 'admin' } });
    const tok = String(t.tok);
    const blocked: [string, Record<string, unknown>][] = [
      ['ping', {}],
      ['pull', { since: 0 }],
      ['push', { ops: [{ k: 'stage/1', v: 'won' }] }],
      ['upload', upload],
      ['file', { fileId }],
      ['delfile', { fileId }],
      ['users', {}],
      ['user_save', { u: 'lead', kick: true }],
    ];
    for (const [action, extra] of blocked) expect(call(s, tok, action, extra)).toMatchObject({ ok: false, error: 'must_change_password' });
    expect(call(s, tok, 'me')).toEqual({ ok: true, mc: true, me: { u: 'nid', name: 'นิด', role: 'admin' } });
    expect(call(s, tok, 'passwd', { old: s.pk('nid', 'nope'), pk: s.pk('nid', 'mine-0001') })).toEqual({ ok: false, error: 'wrong_password' });
    expect(call(s, tok, 'passwd', { old: s.pk('nid', 'temp-1'), pk: 'short' })).toEqual({ ok: false, error: 'bad_password_data' });
    const p = call(s, tok, 'passwd', { old: s.pk('nid', 'temp-1'), pk: s.pk('nid', 'mine-0001') });
    expect(p).toMatchObject({ ok: true, me: { u: 'nid', name: 'นิด', role: 'admin' } });
    expect(call(s, tok, 'me')).toEqual(expired);
    expect(call(s, String(p.tok), 'me')).toMatchObject({ ok: true, mc: false });
    expect(call(s, String(p.tok), 'pull', { since: 0 }).ok).toBe(true);
    expect(users(s).nid.mc).toBe(0);
    expect(login(s, 'nid', 'temp-1').error).toBe('bad_login');
    expect(login(s, 'nid', 'mine-0001')).toMatchObject({ ok: true, mc: false });
    expect(s.drive.list().find((x) => x.id === fileId)!.trashed).toBe(false);
  });

  it('wrong current passwords count toward the lockout', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    for (let i = 0; i < 5; i++) expect(call(s, tok, 'passwd', { old: s.pk('somchai', 'guess' + i), pk: s.pk('somchai', 'x-new-pw-1') }).error).toBe('wrong_password');
    expect(call(s, tok, 'passwd', { old: s.pk('somchai', 'own-somchai'), pk: s.pk('somchai', 'x-new-pw-1') })).toEqual({ ok: false, error: 'locked', retryIn: 900 });
    expect(login(s, 'somchai', 'own-somchai').error).toBe('locked');
    expect(call(s, tok, 'ping').ok).toBe(true); // the session itself goes on
  });
});

// ------------------------------------------------------------------ 9. role matrix

describe('what each role may write (parity with the web app\'s rule)', () => {
  const PREFIXES = ['stage', 'owner', 'watch', 'task', 'log', 'contact', 'dedup', 'deal', 'dstep', 'ddoc', 'dlog', 'scfg', 'cust', 'person', 'dundo', 'team', 'zzz'];
  // a write, and a delete in each of the three forms the web app may send
  const FORMS = [
    { name: 'write', op: (k: string) => ({ k, v: { a: 1 } }), del: false },
    { name: 'del', op: (k: string) => ({ k, del: true }), del: true },
    { name: 'vnull', op: (k: string) => ({ k, v: null }), del: true },
    { name: 'nov', op: (k: string) => ({ k }), del: true },
  ];
  const all = PREFIXES.flatMap((p) => FORMS.map((f) => ({ k: `${p}/${f.name}-1`, del: f.del, op: f.op(`${p}/${f.name}-1`) })));

  it.each([null, 'admin', 'sales'] as const)('%s: the script stores exactly what canWriteKey allows', (role) => {
    let s: GasSim, push: (ops: unknown[]) => Reply, pull: () => Reply;
    if (role === null) {
      s = mk();
      push = (ops) => s.post({ action: 'push', key: KEY, ops });
      pull = () => s.post({ action: 'pull', key: KEY, since: 0 });
    } else {
      const t = team();
      s = t.s;
      const tok = role === 'admin' ? t.admin : member(s, t.admin, 'somchai', 'สมชาย', 'sales');
      push = (ops) => call(s, tok, 'push', { ops });
      pull = () => call(s, tok, 'pull', { since: 0 });
    }
    const allowed = all.filter((x) => canWriteKey(role, x.k, x.del)).map((x) => x.k);
    const r = push(all.map((x) => x.op));
    expect(r.n).toBe(allowed.length);
    expect(r.seq).toBe(allowed.length); // refused ops use no seq
    if (role === null) expect(r).not.toHaveProperty('denied');
    else expect(r.denied).toEqual(all.filter((x) => !allowed.includes(x.k)).map((x) => x.k));
    const stored = new Set(pull().rows!.map((x) => x.k));
    for (const x of all) expect([x.k, stored.has(x.k)]).toEqual([x.k, canWriteKey(role, x.k, x.del)]);
    if (role === 'sales') expect(allowed.length).toBe(all.length - 4 * 4 - 3 * 3); // 4 prefixes refused, 3 more only as deletes
  });

  it('viewer: push, upload and delete are forbidden, reading and opening files work', () => {
    const { s, admin } = team();
    const fileId = String(call(s, admin, 'upload', upload).fileId);
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    expect(all.every((x) => !canWriteKey('viewer', x.k, x.del))).toBe(true);
    expect(call(s, v, 'push', { ops: all.map((x) => x.op) })).toEqual({ ok: false, error: 'forbidden', me: { u: 'vee', name: 'วี', role: 'viewer' } });
    expect(call(s, v, 'push', { ops: [] }).error).toBe('forbidden');
    expect(call(s, v, 'upload', { ...upload, docId: 'x' }).error).toBe('forbidden');
    expect(call(s, v, 'delfile', { fileId }).error).toBe('forbidden');
    expect(call(s, v, 'file', { fileId })).toMatchObject({ ok: true, name: 'q.pdf', data: 'JVBERg==', me: { role: 'viewer' } });
    expect(call(s, v, 'pull', { since: 0 })).toMatchObject({ ok: true, rows: [], me: { role: 'viewer' } });
    expect(Number(s.props.SEQ || 0)).toBe(0);
    expect(s.drive.list().find((x) => x.id === fileId)!.trashed).toBe(false);
  });

  it('sales may attach and remove documents', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const up = call(s, tok, 'upload', upload);
    expect(up).toMatchObject({ ok: true, size: 4, me: { role: 'sales' } });
    expect(call(s, tok, 'delfile', { fileId: up.fileId })).toMatchObject({ ok: true });
  });
});

// ------------------------------------------------------------------ 10. stamping

describe('who wrote it: the script stamps the account\'s name', () => {
  it('a row\'s by is the account\'s display name, whatever the web app sent', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    call(s, admin, 'push', { ops: [{ k: 'stage/1', v: 'won', by: 'ปลอม' }, { k: 'stage/2', v: 'lost' }] });
    call(s, tok, 'push', { ops: [{ k: 'stage/3', v: 'won', by: 'หัวหน้า' }, { k: 'watch/3', del: true, by: '' }] });
    expect(rows(s, admin).map((r) => [r.k, r.by])).toEqual([['stage/1', 'หัวหน้า'], ['stage/2', 'หัวหน้า'], ['stage/3', 'สมชาย'], ['watch/3', 'สมชาย']]);
  });

  it('sales contact-log entries carry the seller\'s own name, with the key order kept', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const v = { id: 'a', at: '2026-10-08T03:00:00.000Z', type: 'call', text: 'โทรแล้ว', by: 'X', res: 'ok' };
    const noBy = { at: '2026-10-08T03:00:00.000Z', type: 'note', text: 'ไม่มีชื่อ' };
    const r = call(s, tok, 'push', {
      ops: [
        { k: 'log/1/a', v },
        { k: 'dlog/d1/b', v: { ...v, id: 'b' } },
        { k: 'log/1/c', v: noBy },
        { k: 'deal/d1', v: { title: 'x', by: 'X' } }, // not a log entry: untouched
        { k: 'person/p1', v: { name: 'y', by: 'X', upBy: 'X' } },
        { k: 'log/1/d', v: null }, // a deletion: nothing to stamp
        { k: 'log/1/e', v: ['by'] },
        { k: 'catalog/1', v: { by: 'X' } },
      ],
    });
    expect(r).toMatchObject({ ok: true, n: 8, denied: [] });
    const got = Object.fromEntries(rows(s, admin).map((x) => [x.k, x.v]));
    expect(got['log/1/a']).toEqual({ ...v, by: 'สมชาย' });
    expect(Object.keys(got['log/1/a'] as object)).toEqual(['id', 'at', 'type', 'text', 'by', 'res']);
    expect((got['dlog/d1/b'] as { by: string }).by).toBe('สมชาย');
    expect(got['log/1/c']).toEqual(noBy);
    expect(got['deal/d1']).toEqual({ title: 'x', by: 'X' });
    expect(got['person/p1']).toEqual({ name: 'y', by: 'X', upBy: 'X' });
    expect(got['log/1/d']).toBeNull();
    expect(got['log/1/e']).toEqual(['by']);
    expect(got['catalog/1']).toEqual({ by: 'X' });
    // in the sheet itself, too
    const cell = s.sheet()!.rows.find((row) => row[1] === 'log/1/a')![2];
    expect(cell).toBe(JSON.stringify({ ...v, by: 'สมชาย' }));
  });

  it('an admin\'s push keeps the by inside values (imports carry the original authors)', () => {
    const { s, admin } = team();
    const v = { at: '2026-01-01T00:00:00.000Z', type: 'call', text: 'จากไฟล์สำรอง', by: 'คุณเอ' };
    call(s, admin, 'push', { ops: [{ k: 'log/1/a', v, by: 'คุณเอ' }] });
    expect(rows(s, admin)[0]).toMatchObject({ k: 'log/1/a', v, by: 'หัวหน้า' });
  });
});

// ------------------------------------------------------------------ 11. users and user_save

describe('managing users (admin only)', () => {
  it('sales and viewers are refused', () => {
    const { s, admin } = team();
    for (const [u, name, role] of [['somchai', 'สมชาย', 'sales'], ['vee', 'วี', 'viewer']] as const) {
      const tok = member(s, admin, u, name, role);
      expect(call(s, tok, 'users')).toEqual({ ok: false, error: 'forbidden', me: { u, name, role } });
      expect(call(s, tok, 'user_save', { create: true, u: 'x' + u, name: 'x' + name, role: 'admin', pk: s.pk('x' + u, 'pw') }).error).toBe('forbidden');
      expect(call(s, tok, 'user_save', { u, role: 'admin' }).error).toBe('forbidden');
      expect(call(s, tok, 'user_save', { u: 'lead', on: 0 }).error).toBe('forbidden');
    }
    expect(users(s).somchai.r).toBe('sales');
    expect(users(s).lead.on).toBe(1);
  });

  it('lists every account with its state, never a salt or a hash', () => {
    const { s, admin } = team();
    at(H);
    addUser(s, admin, 'somchai', 'สมชาย', 'sales');
    for (let i = 0; i < 5; i++) login(s, 'somchai', 'nope');
    at(H + 5 * MIN);
    const r = call(s, admin, 'users');
    expect(r).toEqual({
      ok: true,
      users: [
        { u: 'lead', name: 'หัวหน้า', role: 'admin', on: 1, mc: false, ll: new Date(T0).toISOString(), c: new Date(T0).toISOString(), locked: 0 },
        { u: 'somchai', name: 'สมชาย', role: 'sales', on: 1, mc: true, ll: '', c: new Date(T0 + H).toISOString(), locked: 600 },
      ],
      me: { u: 'lead', name: 'หัวหน้า', role: 'admin' },
    });
  });

  it('creating checks the username, the display name, the role and the password data', () => {
    const { s, admin } = team();
    const make = (o: Record<string, unknown>) => call(s, admin, 'user_save', { create: true, u: 'newbie', name: 'มือใหม่', role: 'sales', pk: s.pk('newbie', 'temp-1'), ...o });
    for (const u of ['ab', 'Has Space', '-dash', 'ก ข ค', 'x'.repeat(33), undefined]) expect(make({ u })).toMatchObject({ ok: false, error: 'bad_user' });
    expect(make({ u: 'lead' })).toMatchObject({ ok: false, error: 'user_exists' });
    expect(make({ u: 'LEAD' })).toMatchObject({ ok: false, error: 'user_exists' });
    for (const name of ['', '   ', 'ก'.repeat(41), 'a\u0001b', undefined]) expect(make({ name })).toMatchObject({ ok: false, error: 'bad_name' });
    expect(make({ name: 'หัวหน้า' })).toMatchObject({ ok: false, error: 'name_taken' });
    for (const role of ['boss', '', undefined]) expect(make({ role })).toMatchObject({ ok: false, error: 'bad_role' });
    for (const pk of ['', 'short', undefined]) expect(make({ pk })).toMatchObject({ ok: false, error: 'bad_password_data' });
    expect(Object.keys(users(s))).toEqual(['lead']);
    const r = make({ u: 'NewBie', name: '  คุณ   มือใหม่ ' });
    expect(r).toEqual({ ok: true, user: { u: 'newbie', name: 'คุณ มือใหม่', role: 'sales', on: 1, mc: true, ll: '', c: new Date(T0).toISOString(), locked: 0 }, me: { u: 'lead', name: 'หัวหน้า', role: 'admin' } });
    // display names are compared without case
    expect(make({ u: 'anna1', name: 'Anna' }).ok).toBe(true);
    expect(make({ u: 'anna2', name: 'ANNA' })).toMatchObject({ ok: false, error: 'name_taken' });
    expect(make({ u: 'ก'.repeat(3) })).toMatchObject({ ok: false, error: 'bad_user' });
    expect(login(s, 'newbie', 'temp-1')).toMatchObject({ ok: true, mc: true, me: { name: 'คุณ มือใหม่', role: 'sales' } });
  });

  it('allows at most 25 accounts, and keeps the stored list within its size limit', () => {
    const { s, admin } = team();
    for (let i = 1; i < 25; i++) expect(call(s, admin, 'user_save', { create: true, u: 'user' + i, name: 'คนที่ ' + i, role: 'viewer', pk: s.pk('user' + i, 'pw') }).ok).toBe(true);
    expect(call(s, admin, 'user_save', { create: true, u: 'user25', name: 'คนที่ 25', role: 'viewer', pk: s.pk('user25', 'pw') })).toMatchObject({ ok: false, error: 'too_many_users' });
    expect(Object.keys(users(s))).toHaveLength(25);
    // a list already near its 8500-character limit (an account with a long name written by hand
    // into Script Properties): one more account would not fit
    const t = team();
    const db = JSON.parse(t.s.props.USERS);
    db.users.big = { ...db.users.lead, n: '', r: 'viewer' };
    db.users.big.n = 'x'.repeat(8400 - JSON.stringify(db).length);
    t.s.props.USERS = JSON.stringify(db);
    t.s.evictCache();
    expect(t.s.props.USERS.length).toBe(8400);
    const before = t.s.props.USERS;
    expect(call(t.s, t.admin, 'user_save', { create: true, u: 'one-more', name: 'อีกคน', role: 'sales', pk: t.s.pk('one-more', 'pw') })).toMatchObject({ ok: false, error: 'too_many_users' });
    expect(t.s.props.USERS).toBe(before);
  });

  it('guards: unknown_user, last_admin, not_self, name_locked, name_taken, bad_role', () => {
    const { s, admin } = team();
    expect(call(s, admin, 'user_save', { u: 'ghost', role: 'sales' })).toEqual({ ok: false, error: 'unknown_user', me: { u: 'lead', name: 'หัวหน้า', role: 'admin' } });
    expect(call(s, admin, 'user_save', { u: '', kick: true }).error).toBe('unknown_user');
    // the only admin can't step down or switch themselves off
    expect(call(s, admin, 'user_save', { u: 'lead', role: 'sales' }).error).toBe('last_admin');
    expect(call(s, admin, 'user_save', { u: 'lead', on: 0 }).error).toBe('last_admin');
    // with a second admin it is still not allowed for oneself, only for the other admin
    const b = member(s, admin, 'boss2', 'รองหัวหน้า', 'admin');
    expect(call(s, admin, 'user_save', { u: 'lead', role: 'viewer' }).error).toBe('not_self');
    expect(call(s, admin, 'user_save', { u: 'lead', on: false }).error).toBe('not_self');
    expect(call(s, admin, 'user_save', { u: 'lead', role: 'admin', on: 1 }).ok).toBe(true); // no change is fine
    expect(call(s, b, 'user_save', { u: 'lead', role: 'sales' })).toMatchObject({ ok: true, user: { u: 'lead', role: 'sales' } });
    expect(call(s, admin, 'users').error).toBe('forbidden'); // applies at once
    expect(call(s, b, 'user_save', { u: 'boss2', role: 'sales' }).error).toBe('last_admin');
    // a disabled admin is no admin: lead is made admin again but switched off
    expect(call(s, b, 'user_save', { u: 'lead', role: 'admin', on: 0 }).ok).toBe(true);
    expect(call(s, b, 'user_save', { u: 'boss2', on: 0 }).error).toBe('last_admin');
    expect(call(s, b, 'user_save', { u: 'lead', on: 1 }).ok).toBe(true);
    expect(call(s, b, 'user_save', { u: 'lead', role: 'owner' }).error).toBe('bad_role');
    // display names: changeable only until the account's first sign-in, and never to a taken one
    addUser(s, b, 'nid', 'นิด', 'sales');
    addUser(s, b, 'anna', 'Anna', 'sales');
    expect(call(s, b, 'user_save', { u: 'nid', name: 'นิดา' })).toMatchObject({ ok: true, user: { name: 'นิดา' } });
    expect(call(s, b, 'user_save', { u: 'nid', name: 'anna' }).error).toBe('name_taken');
    expect(call(s, b, 'user_save', { u: 'nid', name: '' }).error).toBe('bad_name');
    login(s, 'nid', 'temp-nid');
    expect(call(s, b, 'user_save', { u: 'nid', name: 'นิดหน่อย' }).error).toBe('name_locked');
    expect(call(s, b, 'user_save', { u: 'nid', name: ' นิดา ' }).ok).toBe(true); // the same name
    expect(call(s, b, 'user_save', { u: 'nid', pk: 'short' }).error).toBe('bad_password_data');
    expect(users(s).nid).toMatchObject({ n: 'นิดา', r: 'sales', on: 1 });
  });

  it('unlock and a password reset clear a lockout; re-enabling keeps the account as it was', () => {
    const { s, admin } = team();
    member(s, admin, 'somchai', 'สมชาย', 'sales');
    for (let i = 0; i < 5; i++) login(s, 'somchai', 'nope');
    expect(call(s, admin, 'users').users).toEqual(expect.arrayContaining([expect.objectContaining({ u: 'somchai', locked: 900 })]));
    expect(call(s, admin, 'user_save', { u: 'somchai', unlock: true })).toMatchObject({ ok: true, user: { u: 'somchai', locked: 0, mc: false } });
    expect(login(s, 'somchai', 'own-somchai').ok).toBe(true);
    for (let i = 0; i < 5; i++) login(s, 'somchai', 'nope');
    expect(call(s, admin, 'user_save', { u: 'somchai', pk: s.pk('somchai', 'temp-2') })).toMatchObject({ ok: true, user: { locked: 0, mc: true } });
    expect(login(s, 'somchai', 'temp-2')).toMatchObject({ ok: true, mc: true });
    call(s, admin, 'user_save', { u: 'somchai', on: 0 });
    expect(call(s, admin, 'user_save', { u: 'somchai', on: 1 })).toMatchObject({ ok: true, user: { on: 1, role: 'sales', mc: true } });
  });

  it('an admin who signs out their own sessions gets no renewed token in that reply', () => {
    const { s, admin } = team();
    at(20 * DAY); // renewal would be due
    const r = call(s, admin, 'user_save', { u: 'lead', kick: true });
    expect(r).toMatchObject({ ok: true, me: { u: 'lead' } });
    expect(r).not.toHaveProperty('tok');
    expect(call(s, admin, 'ping')).toEqual(expired);
  });
});

// ------------------------------------------------------------------ 12. quota

describe('Apps Script quota', () => {
  const delta = (s: GasSim, fn: () => void) => {
    const before = { ...s.stats };
    fn();
    return { propRead: s.stats.propRead - before.propRead, propWrite: s.stats.propWrite - before.propWrite };
  };

  it('signed-in polling reads and writes no Properties once the cache is warm', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'won' }] });
    const d = delta(s, () => {
      for (let i = 0; i < 50; i++) {
        expect(call(s, tok, 'ping').ok).toBe(true);
        expect(call(s, tok, 'pull', { since: i % 2 }).ok).toBe(true);
      }
    });
    expect(d).toEqual({ propRead: 0, propWrite: 0 });
  });

  it('after the cache is lost the next request still signs in, and tokens stay valid', () => {
    const { s, admin } = team();
    call(s, admin, 'push', { ops: [{ k: 'stage/1', v: 'won' }] });
    s.evictCache();
    expect(call(s, admin, 'pull', { since: 0 })).toMatchObject({ ok: true, rows: [{ k: 'stage/1' }], me: { u: 'lead' } });
    expect(JSON.parse(s.cache.AUTHC)).toMatchObject({ m: 'accounts', u: { lead: { r: 'admin', on: 1 } } });
    expect(s.cache.AUTHC).not.toMatch(/"[sh]":/);
    expect(delta(s, () => call(s, admin, 'pull', { since: 0 }))).toEqual({ propRead: 0, propWrite: 0 });
    // lost while a push holds the lock: answered from Properties, cached again only by a lock holder
    s.evictCache();
    const release = s.holdLock();
    try {
      expect(call(s, admin, 'ping').ok).toBe(true);
      expect(s.cache.AUTHC).toBeUndefined();
    } finally {
      release();
    }
    expect(call(s, admin, 'ping').ok).toBe(true);
    expect(s.cache.AUTHC).toBeDefined();
  });

  it('in legacy mode, polls after the first read no Properties (the "no accounts" marker is cached)', () => {
    const s = mk();
    const poll = () => {
      expect(s.post({ action: 'ping', key: KEY }).ok).toBe(true);
      expect(s.post({ action: 'pull', key: KEY, since: 0 }).ok).toBe(true);
    };
    expect(delta(s, poll).propRead).toBeGreaterThan(0);
    expect(JSON.parse(s.cache.AUTHC)).toEqual({ m: 'none' });
    expect(delta(s, () => Array.from({ length: 50 }, poll))).toEqual({ propRead: 0, propWrite: 0 });
    // the marker lasts 5 minutes
    at(5 * MIN + 1000);
    expect(delta(s, poll).propRead).toBe(1);
  });

  it('revocation is immediate, even with a warm cache', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    for (let i = 0; i < 3; i++) expect(call(s, tok, 'pull', { since: 0 }).ok).toBe(true);
    expect(call(s, admin, 'user_save', { u: 'somchai', on: 0 }).ok).toBe(true);
    expect(call(s, tok, 'pull', { since: 0 })).toEqual({ ok: false, error: 'account_disabled' });
  });
});

// ------------------------------------------------------------------ secrets in replies (runs last)

describe('secrets', () => {
  it('no reply in this file ever contained a salt, a hash, the token secret or a setup code', () => {
    let replies = 0, secrets = 0;
    for (const rec of seen) {
      const text = rec.replies.join('\n');
      replies += rec.replies.length;
      secrets += rec.secrets.size;
      for (const x of rec.secrets) expect(text.includes(x), 'a reply contains ' + x).toBe(false);
      for (const r of rec.replies) expect(r).not.toMatch(/"(s|h|sec|AUTH_SECRET|OWNER_CODE|USERS)":/);
    }
    expect(replies).toBeGreaterThan(500);
    expect(secrets).toBeGreaterThan(100);
  });

  it('pk matches the derivation the web app will use', () => {
    // PBKDF2-HMAC-SHA256, salt "gcc-team|v1|<tid>|<u>", 32 bytes, base64url without padding, NFC first
    expect(derivePk('0123456789abcdef', 1000, 'makorn', 'รหัสผ่าน')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(derivePk('0123456789abcdef', 1000, 'makorn', 'café')).toBe(derivePk('0123456789abcdef', 1000, 'makorn', 'café'));
    expect(derivePk('0123456789abcdef', 1000, 'makorn', 'x')).not.toBe(derivePk('0123456789abcdef', 1000, 'makorm', 'x'));
  });
});
