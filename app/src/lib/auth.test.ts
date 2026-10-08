/** Team accounts on the browser side: the password key, the write rule, the password checklist and
 *  the protocol helpers (hello / call). */
import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { can, canWriteKey, derivePk, initials, MIN_IT, passwordChecks, tempPassword } from './auth';
import { call, hello, TeamSyncError, type Transport } from './teamSync';

const node = (tid: string, it: number, u: string, pw: string) =>
  pbkdf2Sync(Buffer.from(pw.normalize('NFC'), 'utf8'), Buffer.from(`gcc-team|v1|${tid}|${u}`, 'utf8'), it, 32, 'sha256').toString('base64url');

describe('derivePk', () => {
  it('is PBKDF2-HMAC-SHA256 over the password, salted with the team id and username', async () => {
    const V: [string, number, string, string][] = [
      ['a1b2c3d4e5f6', 1000, 'mod', 'new-pass-123'],
      ['tid-xyz', 2000, 'lead.k', 'รหัสผ่านไทย99'],
      ['0f0f0f0f', 1500, 'sales_2', 'p@ss w0rd!'],
    ];
    for (const [tid, n, u, pw] of V) {
      const pk = await derivePk(tid, n, u, pw);
      expect(pk).toBe(node(tid, n, u, pw));
      expect(pk).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
  it('normalises the password to NFC and the username to lower case', async () => {
    const nfc = 'café-ก่อน', nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(await derivePk('t1', 1000, 'mod', nfd)).toBe(await derivePk('t1', 1000, 'mod', nfc));
    expect(await derivePk('t1', 1000, ' MoD ', 'x-12345678')).toBe(node('t1', 1000, 'mod', 'x-12345678'));
  });
  it('refuses a script asking for too few rounds, or without a team id', async () => {
    await expect(derivePk('t1', MIN_IT - 1, 'mod', 'pw-12345678')).rejects.toThrow(/Code\.gs/);
    await expect(derivePk('', 1000, 'mod', 'pw-12345678')).rejects.toThrow();
  });
});

describe('the write rule (same as Code.gs)', () => {
  const keys = ['stage/1', 'owner/1', 'watch/1', 'task/t1', 'log/1/a', 'contact/1', 'dedup/x', 'deal/d1', 'dstep/d1/s1', 'ddoc/x', 'dlog/d1/a', 'scfg/sources', 'cust/1', 'person/p1', 'dundo/x', 'team/มด', 'zzz/1'];
  it('admin and no accounts: everything', () => {
    for (const k of keys) for (const del of [false, true]) {
      expect(canWriteKey(null, k, del)).toBe(true);
      expect(canWriteKey('admin', k, del)).toBe(true);
    }
  });
  it('viewer: nothing', () => {
    for (const k of keys) for (const del of [false, true]) expect(canWriteKey('viewer', k, del)).toBe(false);
  });
  it('sales: no lists, dedup, team list or undo; no deleting deals, customers or people', () => {
    const deny = ['dedup/x', 'scfg/sources', 'dundo/x', 'team/มด'];
    const noDel = ['deal/d1', 'cust/1', 'person/p1'];
    for (const k of keys) {
      expect(canWriteKey('sales', k, false)).toBe(!deny.includes(k));
      expect(canWriteKey('sales', k, true)).toBe(!deny.includes(k) && !noDel.includes(k));
    }
  });
  it('can()', () => {
    for (const c of ['edit', 'delete', 'admin'] as const) {
      expect(can(null, c)).toBe(true);
      expect(can('admin', c)).toBe(true);
      expect(can('viewer', c)).toBe(false);
    }
    expect([can('sales', 'edit'), can('sales', 'delete'), can('sales', 'admin')]).toEqual([true, false, false]);
  });
});

describe('passwords', () => {
  it('the checklist: length, not guessable, both fields the same', () => {
    expect(passwordChecks('short', 'mod', 'มด', 'short')).toEqual({ len: false, notGuessable: true, match: true });
    expect(passwordChecks('12345678', 'mod', 'มด', '12345678').notGuessable).toBe(false);
    expect(passwordChecks('Password', 'mod', 'มด', 'Password').notGuessable).toBe(false);
    expect(passwordChecks('somchai.k', 'somchai.k', 'สมชาย', 'somchai.k').notGuessable).toBe(false);
    expect(passwordChecks('สมชายใจดี', 'mod', 'สมชายใจดี', 'สมชายใจดี').notGuessable).toBe(false);
    expect(passwordChecks('green-tea-42', 'mod', 'มด', 'green-tea-4')).toEqual({ len: true, notGuessable: true, match: false });
    expect(passwordChecks('green-tea-42', 'mod', 'มด', 'green-tea-42')).toEqual({ len: true, notGuessable: true, match: true });
    expect(passwordChecks('', 'mod', 'มด', '')).toEqual({ len: false, notGuessable: false, match: false });
  });
  it('a temporary password: xxxx-xxxx-xx from letters and digits that are easy to read', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = tempPassword();
      expect(p).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{2}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
  it('initials skip คุณ / K.', () => {
    expect(initials('คุณมด')).toBe('ม');
    expect(initials('k. somchai')).toBe('S');
    expect(initials('')).toBe('?');
  });
});

describe('protocol helpers', () => {
  const URL = 'https://script.google.com/macros/s/c/exec';
  const reply = (r: Record<string, unknown>): Transport => async () => r;
  it('hello: a team-code script (v2) refuses it; a v3 script says its mode', async () => {
    for (const error of ['unauthorized', 'no_team_key', 'unknown_action']) expect(await hello(reply({ ok: false, error }), URL)).toEqual({ v: 2 });
    expect(await hello(reply({ ok: true, v: 3, mode: 'accounts', tid: 'abc', it: 200000, files: true }), URL)).toEqual({ v: 3, mode: 'accounts', tid: 'abc', it: 200000, files: true });
    expect((await hello(reply({ ok: true, v: 3, mode: 'odd', tid: 'abc', it: 1000 }), URL)).mode).toBe('legacy');
    await expect(hello(reply({ ok: false, error: 'busy' }), URL)).rejects.toBeInstanceOf(TeamSyncError);
    await expect(hello(async () => { throw new TypeError('Failed to fetch'); }, URL)).rejects.toBeInstanceOf(TypeError);
  });
  it('call: the team code as key, a session as tok, neither for sign-in; always cv 3', async () => {
    const sent: Record<string, unknown>[] = [];
    const t: Transport = async (_u, b) => (sent.push(b), { ok: true });
    await call(t, URL, 'team-code-1', { action: 'ping' });
    await call(t, URL, { tok: 'g1.a.b' }, { action: 'pull', since: 0 });
    await call(t, URL, null, { action: 'login', u: 'mod', pk: 'x' });
    expect(sent).toEqual([
      { action: 'ping', cv: 3, key: 'team-code-1' },
      { action: 'pull', since: 0, cv: 3, tok: 'g1.a.b' },
      { action: 'login', u: 'mod', pk: 'x', cv: 3 },
    ]);
  });
  it('call: a refusal is a TeamSyncError with its code, a Thai message and the reply', async () => {
    const e = await call(reply({ ok: false, error: 'locked', retryIn: 600 }), URL, null, { action: 'login' }).catch((x) => x);
    expect(e).toBeInstanceOf(TeamSyncError);
    expect(e.code).toBe('locked');
    expect(e.message).toMatch(/[ก-๙]/);
  });
});
