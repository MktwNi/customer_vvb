/**
 * Capabilities, custom roles, extras, permission requests, the key table, read redaction and the
 * version gate of the team script (team-sync/Code.gs, protocol v4), run through the simulator.
 * The tables here restate plan.md §1 and roles/impl-note.md independently of the script, so a change
 * on either side shows up; every secret is generated while the tests run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';

type Caps = Record<string, 1 | 'own'>;
type Reply = ReturnType<GasSim['post']>;

const T0 = Date.parse('2026-10-08T03:00:00.000Z'); // 10:00 in Bangkok
const MIN = 60000, H = 60 * MIN, DAY = 24 * H;
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const REFRESH = 'มีเวอร์ชันใหม่ กรุณารีเฟรชหน้าเว็บ (F5)';

// ------------------------------------------------------------------ the catalogue as designed

const IDS = ['view.sales', 'view.plan', 'view.money', 'view.cash', 'view.comm', 'docs.open', 'edit.cust', 'edit.deal', 'edit.task', 'edit.pay', 'docs.up', 'edit.ctag', 'edit.jqt', 'edit.share', 'del.rec', 'del.log', 'qt.check', 'pay.check', 'notify.mail', 'set.lists', 'set.units', 'set.dedup', 'set.data', 'set.users'];
const NEEDS: Record<string, string> = { 'view.cash': 'view.money', 'view.comm': 'view.money', 'docs.open': 'view.money', 'edit.deal': 'view.money', 'edit.pay': 'view.money', 'docs.up': 'view.money', 'edit.jqt': 'view.money', 'edit.share': 'view.comm', 'qt.check': 'view.money', 'pay.check': 'view.cash', 'set.units': 'view.comm' };
const SCOPED = ['edit.deal', 'edit.pay', 'del.log'];
const REAL = ['view.money', 'view.comm'];
const ones = (l: string[]): Caps => Object.fromEntries(l.map((c) => [c, 1]));
const VIEW = ['view.sales', 'view.plan', 'view.money', 'view.cash', 'docs.open'];
const SALES = [...VIEW, 'edit.cust', 'edit.deal', 'edit.task', 'edit.pay', 'docs.up', 'edit.ctag', 'edit.jqt', 'notify.mail'];
const BUILT: Record<string, Caps> = { admin: ones(IDS), sales: { ...ones(SALES), 'del.log': 'own' }, viewer: ones(VIEW) };
// the custom roles of the mockups
const HEAD: Caps = { ...ones(SALES), 'view.comm': 1, 'edit.share': 1, 'del.rec': 1, 'del.log': 1, 'qt.check': 1 };
const ACCT: Caps = ones(['view.sales', 'view.plan', 'view.money', 'view.cash', 'view.comm', 'docs.open', 'edit.pay', 'docs.up', 'qt.check', 'pay.check', 'notify.mail', 'set.units']);

/**
 * plan.md §1 "Consolidated server allow-list": [prefix, write, delete]; a list = any one of them;
 * null = nobody. `scfg/<plain>` needs set.lists; anything else set.users.
 */
const TABLE: [string, string | string[] | null, string | string[] | null][] = [
  ['stage/', 'edit.cust', 'edit.cust'],
  ['owner/', 'edit.cust', 'edit.cust'],
  ['watch/', 'edit.cust', 'edit.cust'],
  ['contact/', 'edit.cust', 'edit.cust'],
  ['cust/', 'edit.cust', 'del.rec'],
  ['person/', 'edit.cust', 'del.rec'],
  ['log/', 'edit.cust', 'del.log'],
  ['task/', 'edit.task', 'edit.task'],
  ['deal/', 'edit.deal', 'del.rec'],
  ['dstep/', 'edit.deal', 'edit.deal'],
  ['dact/', 'edit.deal', 'del.log'],
  ['dlog/', ['edit.deal', 'edit.pay', 'docs.up', 'edit.jqt', 'edit.share', 'pay.check'], 'set.users'],
  ['ddoc/', 'docs.up', 'docs.up'],
  ['dpay/', 'edit.pay', 'edit.pay'],
  ['ctag/', 'edit.ctag', 'edit.ctag'],
  ['jqt/', 'edit.jqt', 'del.rec'],
  ['jqm/', 'edit.jqt', 'edit.jqt'],
  ['dshare/', 'edit.share', 'edit.share'],
  ['ccol/', 'edit.cust', 'edit.cust'],
  ['qchk/', null, null],
  ['dchk/', 'pay.check', 'pay.check'],
  ['mclose/', 'pay.check', 'pay.check'],
  ['scfg/paychk.', 'set.users', 'set.users'],
  ['scfg/ct.', 'set.lists', 'set.lists'],
  ['scfg/cc.', 'set.lists', 'set.lists'],
  ['scfg/unit.', 'set.units', 'set.units'],
  ['scfg/unitm.', 'set.units', 'set.units'],
  ['scfg/notify.', 'set.users', 'set.users'],
  ['dedup/', 'set.dedup', 'set.dedup'],
  ['team/', 'set.users', 'set.users'],
  ['dundo/', 'set.data', 'set.data'],
];
/** What the table gives `caps` for key k (own-work capabilities count, the records here are nobody's yet). */
function model(caps: Caps, k: string, del: boolean) {
  const row = TABLE.find(([p]) => k.startsWith(p));
  const need = row ? (del ? row[2] : row[1]) : /^scfg\/[^.]*$/.test(k) ? 'set.lists' : 'set.users';
  if (need === null) return false;
  return (Array.isArray(need) ? need : [need]).some((c) => !!caps[c]);
}

// ------------------------------------------------------------------ helpers

const seen: { replies: string[]; s: GasSim }[] = [];
function mk(): GasSim {
  const s = createGasSim({ kdfIter: 1000 });
  const rec = { replies: [] as string[], s };
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
/** A team whose lead (admin "lead", หัวหน้า) is signed in. */
function team() {
  const s = mk();
  const admin = s.bootstrapAdmin({ u: 'lead', name: 'หัวหน้า', pw: 'lead-password-1' });
  return { s, admin };
}
/** An account with role `role` that signed in and set its own password; returns its token. */
function member(s: GasSim, admin: string, u: string, name: string, role: string) {
  expect(call(s, admin, 'user_save', { create: true, u, name, role, pk: s.pk(u, 'temp-' + u) })).toMatchObject({ ok: true });
  const t = login(s, u, 'temp-' + u);
  const r = call(s, String(t.tok), 'passwd', { old: s.pk(u, 'temp-' + u), pk: s.pk(u, 'own-' + u) });
  expect(r).toMatchObject({ ok: true });
  return String(r.tok);
}
/** A custom role with exactly these capabilities; returns its id. */
function role(s: GasSim, admin: string, n: string, c: Caps) {
  const r = call(s, admin, 'role_save', { n, c });
  expect(r).toMatchObject({ ok: true, id: expect.stringMatching(/^r[0-9a-f]{6}$/) });
  return String(r.id);
}
const props = (s: GasSim, k: string) => JSON.parse(s.props[k] || '{}');
const usersOf = (s: GasSim) => JSON.parse(s.props.USERS).users as Record<string, { r: string; on: number }>;
const rowsOf = (r: Reply) => r.rows!;
/** `me` of a reply, and the roles of an admin reply. */
const meOf = (r: Reply) => r.me as { caps: Caps; [k: string]: unknown };
const rolesOf = (r: Reply) => r.roles as Record<string, { n: string; c: Caps }>;
const audit = (s: GasSim) => (s.sheetOf('audit')?.rows || []).slice(1).filter((r) => r[0]).map((r) => ({ actor: r[1], u: r[2], action: r[3], detail: JSON.parse(r[4]), note: r[5] }));
const upload = { docId: 'deal-1.q1', name: 'q.pdf', mime: 'application/pdf', data: 'JVBERg==' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ 1. the catalogue

describe('the capability catalogue (CAPS_)', () => {
  const { CAPS_, KEY_CAP, BUILTIN_ROLES } = mk().consts;

  it('has exactly the 24 designed ids, in the designed order, with their needs, scopes and real redaction', () => {
    expect(CAPS_!.map((c) => c.id)).toEqual(IDS);
    for (const c of CAPS_!) {
      expect([c.id, c.needs ?? null]).toEqual([c.id, NEEDS[c.id] ?? null]);
      expect([c.id, !!c.scope]).toEqual([c.id, SCOPED.includes(c.id)]);
      expect([c.id, !!c.real]).toEqual([c.id, REAL.includes(c.id)]);
      expect(c.th).toMatch(/[ก-๙]/);
      expect(['v', 'e', 'a']).toContain(c.g);
      if (c.needs) expect(IDS).toContain(c.needs);
    }
    // the ดูได้ group reads "ดู…", as the other packages name them
    for (const id of ['view.money', 'view.cash', 'view.comm']) expect(CAPS_!.find((c) => c.id === id)!.th.startsWith('ดู')).toBe(true);
  });

  it('the built-in roles reproduce the designed defaults; set.users is admin only', () => {
    expect(BUILTIN_ROLES!.map((r) => [r.id, r.n])).toEqual([['admin', 'ผู้ดูแลระบบ'], ['sales', 'พนักงานขาย'], ['viewer', 'ดูอย่างเดียว']]);
    BUILTIN_ROLES!.forEach((r, i) => {
      const got = Object.fromEntries(CAPS_!.filter((c) => c.d[i]).map((c) => [c.id, c.d[i]]));
      expect([r.id, got]).toEqual([r.id, BUILT[r.id]]);
    });
    expect(CAPS_!.find((c) => c.id === 'set.users')!.d).toEqual([1, 0, 0]);
  });

  it('KEY_CAP lists every prefix of the consolidated allow-list, phase-3 prefixes included, with the same capabilities', () => {
    const server = new Map(KEY_CAP!.map((r) => [r.p, r]));
    for (const [p, w, d] of TABLE) {
      const r = server.get(p);
      expect([p, r && (r.w || null), r && (r.d || null)]).toEqual([p, w, d]);
    }
    expect(KEY_CAP!.length).toBe(TABLE.length);
    // own work: deal resp for deal records, the stored author for log entries and contacts
    expect(KEY_CAP!.filter((r) => r.ow || r.od).map((r) => [r.p, r.ow || '', r.od || ''])).toEqual([
      ['log/', '', 'by'],
      ['deal/', 'deal', ''],
      ['dstep/', 'resp', 'resp'],
      ['dact/', 'resp', 'by'],
      ['dpay/', 'resp', 'resp'],
    ]);
  });
});

// ------------------------------------------------------------------ 2. key table × role parity

describe('what each role may push: the script equals the allow-list, prefix by prefix', () => {
  const KEYS = [...TABLE.map(([p]) => p), 'scfg/', 'scfg/zzz.', 'zzz/', 'catalog/'];
  const ops = KEYS.flatMap((p, i) => [
    { k: `${p}w${i}`, op: { k: `${p}w${i}`, v: { a: 1 } }, del: false },
    { k: `${p}d${i}`, op: { k: `${p}d${i}`, del: true }, del: true },
    { k: `${p}n${i}`, op: { k: `${p}n${i}`, v: null }, del: true },
  ]);
  const ROLES: [string, Caps][] = [
    ['admin', BUILT.admin],
    ['sales', BUILT.sales],
    ['หัวหน้าฝ่ายขาย', HEAD],
    ['บัญชี/การเงิน', ACCT],
    ['รับเงินอย่างเดียว', ones(['view.money', 'edit.pay'])],
    ['ตรวจรับเงินอย่างเดียว', ones(['view.money', 'view.cash', 'pay.check'])],
    ['ตั้งค่ารายการ', ones(['set.lists'])],
    ['หน่วยงาน', ones(['view.money', 'view.comm', 'set.units', 'edit.share'])],
  ];

  it.each(ROLES)('%s', (name, caps) => {
    const { s, admin } = team();
    let tok = admin;
    if (name === 'sales') tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    else if (name !== 'admin') tok = member(s, admin, 'somchai', 'สมชาย', role(s, admin, name, caps));
    const allowed = ops.filter((x) => model(caps, x.k, x.del)).map((x) => x.k);
    const shares = allowed.filter((k) => /^deal\/[dn]/.test(k)).map((k) => 'dshare/' + k.slice(5));
    const r = call(s, tok, 'push', { ops: ops.map((x) => x.op) });
    expect(r).toMatchObject({ ok: true, n: allowed.length + shares.length, rejected: [] });
    expect(r.denied).toEqual(ops.filter((x) => !allowed.includes(x.k)).map((x) => x.k));
    const stored = rowsOf(call(s, admin, 'pull', { since: 0 })).map((x) => x.k);
    expect(stored).toEqual([...allowed, ...shares]);
    // the special rows of plan.md §5
    expect(allowed.filter((k) => k.startsWith('qchk/'))).toEqual([]);
    expect(allowed.some((k) => k.startsWith('zzz/') || k.startsWith('scfg/zzz.'))).toBe(name === 'admin');
    if (['รับเงินอย่างเดียว', 'ตรวจรับเงินอย่างเดียว'].includes(name)) expect(allowed.filter((k) => k.startsWith('dlog/'))).toEqual(['dlog/w11']);
    expect(allowed.includes('dchk/w20')).toBe(['admin', 'บัญชี/การเงิน', 'ตรวจรับเงินอย่างเดียว'].includes(name));
  });

  it('viewer, and a role with read capabilities only: no push at all (forbidden), nothing stored', () => {
    const { s, admin } = team();
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    const q = member(s, admin, 'qee', 'คิว', role(s, admin, 'ผู้ตรวจ', ones(['view.money', 'qt.check', 'notify.mail'])));
    for (const tok of [v, q]) expect(call(s, tok, 'push', { ops: ops.map((x) => x.op) })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(Number(s.props.SEQ || 0)).toBe(0);
  });

  it('qchk/ is refused for an admin too, and with the team code it is not stored either', () => {
    const { s, admin } = team();
    expect(call(s, admin, 'push', { ops: [{ k: 'qchk/q1', v: { st: 'ok' } }, { k: 'qchk/q1', del: true }] })).toMatchObject({ ok: true, n: 0, denied: ['qchk/q1', 'qchk/q1'] });
    const legacy = createGasSim({ teamKey: 'test-key-123' });
    expect(legacy.post({ action: 'push', key: 'test-key-123', ops: [{ k: 'qchk/q1', v: { st: 'ok' } }, { k: 'stage/1', v: 'won' }] })).toEqual({ ok: true, seq: 1, n: 1, rejected: ['qchk/q1'] });
  });

  it('an unknown role id (USERS edited by hand) has no capabilities: default deny, shown as viewer', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'ghost', 'ผี', 'sales');
    const db = JSON.parse(s.props.USERS);
    db.users.ghost.r = 'gone';
    s.props.USERS = JSON.stringify(db);
    s.evictCache();
    const fileId = String(call(s, admin, 'upload', upload).fileId);
    expect(call(s, tok, 'me')).toMatchObject({ ok: true, me: { u: 'ghost', role: 'viewer', rid: 'gone', rn: '', caps: {} } });
    expect(call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'won' }] }).error).toBe('forbidden');
    expect(call(s, tok, 'file', { fileId }).error).toBe('forbidden');
    expect(call(s, tok, 'upload', upload).error).toBe('forbidden');
    expect(call(s, tok, 'pull', { since: 0 }).ok).toBe(true); // pages are hidden by the web app; money is redacted
  });

  it('upload / delfile need docs.up, file needs docs.open', () => {
    const { s, admin } = team();
    const fileId = String(call(s, admin, 'upload', upload).fileId);
    const up = member(s, admin, 'upper', 'แนบ', role(s, admin, 'แนบเอกสาร', ones(['view.money', 'docs.up'])));
    const open = member(s, admin, 'opener', 'เปิด', role(s, admin, 'เปิดเอกสาร', ones(['view.money', 'docs.open'])));
    expect(call(s, up, 'file', { fileId }).error).toBe('forbidden');
    expect(call(s, up, 'upload', { ...upload, docId: 'x' })).toMatchObject({ ok: true });
    expect(call(s, open, 'file', { fileId })).toMatchObject({ ok: true, data: 'JVBERg==' });
    expect(call(s, open, 'upload', upload).error).toBe('forbidden');
    expect(call(s, open, 'delfile', { fileId }).error).toBe('forbidden');
    expect(call(s, up, 'delfile', { fileId })).toMatchObject({ ok: true });
  });
});

// ------------------------------------------------------------------ 3. own work

describe('capabilities limited to the account\'s own work', () => {
  function setup() {
    const { s, admin } = team();
    const own = role(s, admin, 'ขายเฉพาะงานตัวเอง', { ...ones(['view.money', 'edit.cust']), 'edit.deal': 'own', 'edit.pay': 'own', 'del.log': 'own' });
    const tok = member(s, admin, 'somchai', 'สมชาย', own);
    expect(call(s, admin, 'push', {
      ops: [
        { k: 'deal/d1', v: { title: 'ของสมชาย', resp: ' สมชาย ' } },
        { k: 'deal/d2', v: { title: 'ของคนอื่น', resp: 'คุณบี' } },
        { k: 'deal/d9', v: { title: 'ลบแล้ว', resp: 'สมชาย' } },
        { k: 'deal/d9', del: true },
        { k: 'log/1/a', v: { text: 'โดยหัวหน้า' } },
        { k: 'dact/d1/z', v: { note: 'โดยหัวหน้า', by: 'หัวหน้า' } },
      ],
    })).toMatchObject({ ok: true });
    return { s, admin, tok };
  }

  it('deals, steps, contacts and payments: only where the deal\'s ผู้รับผิดชอบ is the account', () => {
    const { s, admin, tok } = setup();
    const r = call(s, tok, 'push', {
      ops: [
        { k: 'deal/d1', v: { title: 'แก้ของตัวเอง', resp: 'สมชาย' } },
        { k: 'deal/d2', v: { title: 'ยึดงานคนอื่น', resp: 'สมชาย' } },
        { k: 'deal/d3', v: { title: 'งานใหม่', resp: 'สมชาย' } },
        { k: 'deal/d4', v: { title: 'งานใหม่ให้คนอื่น', resp: 'คุณบี' } },
        { k: 'deal/d9', v: { title: 'ลบไปแล้ว สร้างใหม่', resp: 'สมชาย' } },
        { k: 'dstep/d1/CALL1', v: { d: '2026-10-08', n: '' } },
        { k: 'dstep/d2/CALL1', v: { d: '2026-10-08', n: '' } },
        { k: 'dstep/d3/CALL1', v: { d: '2026-10-08', n: '' } }, // the deal this push created
        { k: 'dstep/d5/CALL1', v: { d: '2026-10-08', n: '' } }, // no such deal
        { k: 'dpay/d1/PAY1', v: { amt: 1 } },
        { k: 'dpay/d2/PAY1', v: { amt: 1 } },
        { k: 'dpay/d2/PAY2', del: true },
        { k: 'dact/d1/a', v: { note: 'โทร', by: 'X' } },
        { k: 'dact/d2/a', v: { note: 'โทร', by: 'X' } },
        { k: 'dstep/d2/CALL2', del: true },
        { k: 'deal/d1', v: { title: 'ยกให้คนอื่น', resp: 'คุณบี' } },
      ],
    });
    expect(r.denied).toEqual(['deal/d2', 'deal/d4', 'dstep/d2/CALL1', 'dstep/d5/CALL1', 'dpay/d2/PAY1', 'dpay/d2/PAY2', 'dact/d2/a', 'dstep/d2/CALL2', 'deal/d1']);
    expect(r.n).toBe(7);
    const last = new Map(rowsOf(call(s, admin, 'pull', { since: 0 })).map((x) => [x.k, x]));
    expect(last.get('deal/d1')!.v).toEqual({ title: 'แก้ของตัวเอง', resp: 'สมชาย' });
    expect(last.get('deal/d2')!.v).toEqual({ title: 'ของคนอื่น', resp: 'คุณบี' });
    expect(last.get('dact/d1/a')!.v).toEqual({ note: 'โทร', by: 'สมชาย' });
  });

  it('a log entry or contact may be deleted only by whoever wrote it (the sheet\'s author column)', () => {
    const { s, tok } = setup();
    expect(call(s, tok, 'push', { ops: [{ k: 'log/1/b', v: { text: 'ของฉัน' } }, { k: 'dact/d1/y', v: { note: 'ของฉัน', by: 'สมชาย' } }] }).n).toBe(2);
    const r = call(s, tok, 'push', { ops: [{ k: 'log/1/a', del: true }, { k: 'log/1/b', del: true }, { k: 'dact/d1/z', v: null }, { k: 'dact/d1/y' }, { k: 'log/1/never', del: true }] });
    expect(r).toMatchObject({ n: 3, denied: ['log/1/a', 'dact/d1/z'] });
    // in one push: written then deleted is the account's own
    expect(call(s, tok, 'push', { ops: [{ k: 'log/2/c', v: { text: 'x' } }, { k: 'log/2/c', del: true }] })).toMatchObject({ n: 2, denied: [] });
  });

  it('the built-in sales role (del.log own work) can no longer delete a teammate\'s log entry', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    call(s, admin, 'push', { ops: [{ k: 'log/1/a', v: { text: 'โดยหัวหน้า' } }] });
    call(s, tok, 'push', { ops: [{ k: 'log/1/b', v: { text: 'โดยสมชาย' } }] });
    expect(call(s, tok, 'push', { ops: [{ k: 'log/1/a', del: true }, { k: 'log/1/b', del: true }] })).toMatchObject({ n: 1, denied: ['log/1/a'] });
  });

  it('the sheet is read once per push, and only when an own-work rule needs it', () => {
    const { s, tok } = setup();
    const sh = s.sheet()! as unknown as { getRange: (...a: number[]) => unknown };
    const spy = vi.spyOn(sh, 'getRange');
    call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'won' }, { k: 'log/1/x', v: { text: 'x' } }] });
    const plain = spy.mock.calls.filter(([r, c, , n]) => r === 2 && c === 2 && n === 4).length;
    call(s, tok, 'push', { ops: [{ k: 'dstep/d1/CALL1', v: { d: '', n: '' } }, { k: 'dpay/d1/PAY1', v: { amt: 1 } }, { k: 'log/1/a', del: true }] });
    const own = spy.mock.calls.filter(([r, c, , n]) => r === 2 && c === 2 && n === 4).length - plain;
    expect([plain, own]).toEqual([0, 1]);
  });
});

// ------------------------------------------------------------------ 4. stamping and cascades

describe('names, times and cascades the script writes itself', () => {
  it('payment checks and month closes carry the checker\'s name and the server\'s time; an admin\'s are kept', () => {
    const { s, admin } = team();
    const acct = member(s, admin, 'fon', 'ฝน', role(s, admin, 'บัญชี/การเงิน', ACCT));
    at(5 * MIN);
    const v = { s: 'ok', by: 'ปลอม', at: '2020-01-01T00:00:00.000Z', amt: 107000, d: '2026-10-05', f: ['doc1'] };
    expect(call(s, acct, 'push', { ops: [{ k: 'dchk/d1/PAY1', v }, { k: 'mclose/2026-10', v: { n: 1, amt: 107000 } }, { k: 'dlog/x1', v: { action: 'ตรวจรับเงิน PAY1', by: 'ปลอม' } }] })).toMatchObject({ n: 3, denied: [] });
    const last = new Map(rowsOf(call(s, admin, 'pull', { since: 0 })).map((x) => [x.k, x]));
    const now = new Date(T0 + 5 * MIN).toISOString();
    expect(last.get('dchk/d1/PAY1')!.v).toEqual({ ...v, by: 'ฝน', at: now });
    expect(Object.keys(last.get('dchk/d1/PAY1')!.v as object)).toEqual(Object.keys(v)); // key order kept
    expect(last.get('mclose/2026-10')!.v).toEqual({ n: 1, amt: 107000, by: 'ฝน', at: now });
    expect(last.get('dlog/x1')!.v).toEqual({ action: 'ตรวจรับเงิน PAY1', by: 'ฝน' });
    // sales, viewer and a sales head may not check at all
    const head = member(s, admin, 'mint', 'มินท์', role(s, admin, 'หัวหน้าฝ่ายขาย', HEAD));
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    for (const tok of [head, sales]) expect(call(s, tok, 'push', { ops: [{ k: 'dchk/d1/PAY1', v }, { k: 'mclose/2026-10', del: true }] }).denied).toEqual(['dchk/d1/PAY1', 'mclose/2026-10']);
    // an admin's push (e.g. restoring records) keeps them
    call(s, admin, 'push', { ops: [{ k: 'dchk/d2/PAY1', v }] });
    expect(rowsOf(call(s, admin, 'pull', { since: 0 })).find((x) => x.k === 'dchk/d2/PAY1')!.v).toEqual(v);
  });

  it('deleting a deal also deletes its revenue split (dshare/), once', () => {
    const { s, admin } = team();
    const head = member(s, admin, 'mint', 'มินท์', role(s, admin, 'หัวหน้าฝ่ายขาย', HEAD));
    call(s, admin, 'push', { ops: [{ k: 'deal/d1', v: { resp: 'x' } }, { k: 'dshare/d1', v: { lines: [{ u: 'a', p: 100 }] } }, { k: 'deal/d2', v: { resp: 'x' } }] });
    expect(call(s, head, 'push', { ops: [{ k: 'deal/d1', del: true }] })).toMatchObject({ n: 2, seq: 5 });
    // the web app's own cascade in the same push: no second tombstone
    expect(call(s, head, 'push', { ops: [{ k: 'deal/d2', v: null }, { k: 'dshare/d2', del: true }] })).toMatchObject({ n: 2, denied: [] });
    const rows = rowsOf(call(s, admin, 'pull', { since: 3 }));
    // (a value of null is a deletion too: the web app applies it as one)
    expect(rows.map((r) => [r.k, r.del, r.v, r.by])).toEqual([['deal/d1', true, null, 'มินท์'], ['dshare/d1', true, null, 'มินท์'], ['deal/d2', false, null, 'มินท์'], ['dshare/d2', true, null, 'มินท์']]);
  });
});

// ------------------------------------------------------------------ 5. redaction

describe('pull without view.money / view.comm', () => {
  const MONEY = ['350000', '350,000', '107000', '107,000', '374500', '374,500', '187250', '187,250', '561750', '561,750', '120000'];
  const fixture = [
    { k: 'deal/d1', v: { title: 'A', resp: 'หัวหน้า', client: 'บริษัท ก', forecast: 350000, actual: 107000 } },
    { k: 'ddoc/d1/q1', v: { id: 'q1', deal: 'd1', kind: 'quotation', name: 'QT.pdf', docNo: 'QT-1', amount: 374500, detected: 374500, target: 'forecast', auto: { stage: 'QUOTATION', n: 'ใบเสนอราคา QT-1 · 374,500 บาท', d: '2026-10-01' } } },
    { k: 'dpay/d1/PAY1', v: { amt: 187250, pct: 50, due: '2026-11-01', rcv: '2026-10-05', got: 187250, full: true, fullAt: 187250, note: 'มัดจำ' } },
    { k: 'dstep/d1/QUOTATION', v: { d: '2026-10-01', n: 'ใบเสนอราคา QT-1 · 374,500 บาท' } },
    { k: 'dlog/l1', v: { action: 'รับชำระ PAY1', detail: '187,250 บาท · โอน', deal: 'd1' } },
    { k: 'dlog/l2', v: { action: 'ตั้งแผนชำระ', detail: '2 งวด · 187,250 + 187,250' } },
    { k: 'dlog/l3', v: { action: 'จำนวนเงินจากไฟล์เดิม', detail: 'Forecast เดิม "350,000-561,750" — ตรวจตัวเลขอีกครั้ง' } },
    { k: 'jqm/h1/d1', v: { share: 120000, pct: 32 } },
    { k: 'dchk/d1/PAY1', v: { s: 'back', amt: 187250, d: '2026-10-05', f: [], note: 'ยอดไม่ตรง 187,250 บาท' } },
    { k: 'mclose/2026-10', v: { n: 3, amt: 561750 } },
    { k: 'dshare/d1', v: { lines: [{ u: 'sales', p: 60 }, { u: 'cons', p: 40 }] } },
    { k: 'scfg/unit.sales', v: { n: 'ฝ่ายขาย', c: 1, o: 0, rates: [{ from: '', r: 5 }] } },
    { k: 'scfg/unitm.ฝน', v: { unit: 'acct' } },
    { k: 'stage/1', v: 'won' },
    { k: 'log/1/a', v: { text: 'ลูกค้าบอกราคา 999999 ต่อรองได้' } }, // typed by a person: stays
  ];
  function setup() {
    const { s, admin } = team();
    expect(call(s, admin, 'push', { ops: fixture }).n).toBe(fixture.length);
    const blind = member(s, admin, 'pla', 'ปลา', role(s, admin, 'ดูไม่เห็นยอดเงิน', ones(['view.sales', 'view.plan', 'edit.cust'])));
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    return { s, admin, blind, sales };
  }
  const byKey = (r: Reply) => Object.fromEntries(rowsOf(r).map((x) => [x.k, x]));

  it('without view.money: money fields are null, the app\'s amounts in notes are "…", nothing else changes', () => {
    const { s, admin, blind } = setup();
    const full = call(s, admin, 'pull', { since: 0 });
    const r = call(s, blind, 'pull', { since: 0 });
    // the same rows in the same places: the reader's position in the log is everyone's
    expect(rowsOf(r).map((x) => [x.seq, x.k, x.by, x.at])).toEqual(rowsOf(full).map((x) => [x.seq, x.k, x.by, x.at]));
    expect([r.seq, r.more]).toEqual([full.seq, full.more]);
    const g = byKey(r);
    expect(g['deal/d1'].v).toEqual({ title: 'A', resp: 'หัวหน้า', client: 'บริษัท ก', forecast: null, actual: null });
    expect(g['ddoc/d1/q1'].v).toMatchObject({ amount: null, detected: null, docNo: 'QT-1', auto: { stage: 'QUOTATION', n: 'ใบเสนอราคา QT-1 · …', d: '2026-10-01' } });
    expect(g['dpay/d1/PAY1'].v).toEqual({ amt: null, pct: null, due: '2026-11-01', rcv: '2026-10-05', got: null, full: true, fullAt: null, note: 'มัดจำ' });
    expect(g['dstep/d1/QUOTATION'].v).toEqual({ d: '2026-10-01', n: 'ใบเสนอราคา QT-1 · …' });
    expect(g['dlog/l1'].v).toMatchObject({ action: 'รับชำระ PAY1', detail: '… · โอน' });
    expect(g['dlog/l2'].v).toMatchObject({ detail: '2 งวด · … + …' });
    expect(g['dlog/l3'].v).toMatchObject({ detail: 'Forecast เดิม "…-…" — ตรวจตัวเลขอีกครั้ง' });
    expect(g['jqm/h1/d1'].v).toEqual({ share: null, pct: null });
    expect(g['dchk/d1/PAY1'].v).toEqual({ s: 'back', amt: null, d: '2026-10-05', f: [], note: 'ยอดไม่ตรง …' });
    expect(g['mclose/2026-10'].v).toEqual({ n: 3, amt: null });
    // view.comm needs view.money: no split and no rates either
    expect(g['dshare/d1']).toMatchObject({ v: null, del: true });
    expect(g['scfg/unit.sales'].v).toEqual({ n: 'ฝ่ายขาย', c: 1, o: 0 });
    expect(g['scfg/unitm.ฝน'].v).toEqual({ unit: 'acct' });
    expect(g['stage/1'].v).toBe('won');
    expect(g['log/1/a'].v).toEqual({ text: 'ลูกค้าบอกราคา 999999 ต่อรองได้' });
    const text = JSON.stringify(r);
    for (const m of MONEY) expect(text.includes(m), m).toBe(false);
    // the sheet itself is untouched
    expect(byKey(call(s, admin, 'pull', { since: 0 }))['deal/d1'].v).toMatchObject({ forecast: 350000 });
  });

  it('with view.money but not view.comm (sales): amounts stay; splits come as deletions, units without rates', () => {
    const { s, admin, sales } = setup();
    const g = byKey(call(s, sales, 'pull', { since: 0 }));
    const a = byKey(call(s, admin, 'pull', { since: 0 }));
    for (const k of Object.keys(a)) if (k !== 'dshare/d1' && k !== 'scfg/unit.sales') expect([k, g[k]]).toEqual([k, a[k]]);
    expect(g['dshare/d1']).toEqual({ ...a['dshare/d1'], v: null, del: true });
    expect(g['scfg/unit.sales'].v).toEqual({ n: 'ฝ่ายขาย', c: 1, o: 0 });
    expect(a['scfg/unit.sales'].v).toMatchObject({ rates: [{ from: '', r: 5 }] });
    expect(a['dshare/d1']).toMatchObject({ del: false, v: { lines: [{ u: 'sales', p: 60 }, { u: 'cons', p: 40 }] } });
  });

  it('pages of a long pull are redacted the same way; older builds\' pulls too', () => {
    const { s, admin, blind } = setup();
    const page = call(s, blind, 'pull', { since: 0, limit: 4 });
    expect(page).toMatchObject({ more: true });
    expect(rowsOf(page).map((x) => x.k)).toEqual(fixture.slice(0, 4).map((x) => x.k));
    expect(byKey(page)['deal/d1'].v).toMatchObject({ forecast: null });
    const old = s.post({ action: 'pull', since: 0, tok: blind, cv: 3 });
    expect(old).toMatchObject({ ok: true, me: { role: 'sales' } });
    for (const m of MONEY) expect(JSON.stringify(old).includes(m), m).toBe(false);
    expect(byKey(call(s, admin, 'pull', { since: 0 }))['dpay/d1/PAY1'].v).toMatchObject({ amt: 187250 });
  });

  it('a capability given later shows the amounts on the next pull (the web app pulls again from 0)', () => {
    const { s, admin, blind } = setup();
    expect(byKey(call(s, blind, 'pull', { since: 0 }))['deal/d1'].v).toMatchObject({ forecast: null });
    expect(call(s, admin, 'grant_save', { u: 'pla', c: [{ k: 'view.comm' }] })).toMatchObject({ ok: true });
    const r = call(s, blind, 'pull', { since: 0 });
    expect(r.me).toMatchObject({ caps: { 'view.money': 1, 'view.comm': 1 } });
    expect(byKey(r)['deal/d1'].v).toMatchObject({ forecast: 350000 });
    expect(byKey(r)['dshare/d1']).toMatchObject({ del: false });
  });
});

// ------------------------------------------------------------------ 6. older builds (version gate)

describe('tabs open on a build from before capabilities (cv < 4)', () => {
  it('may read, but push, upload and delfile answer the refresh message, and nothing is stored', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const fileId = String(call(s, admin, 'upload', upload).fileId);
    call(s, admin, 'push', { ops: [{ k: 'stage/1', v: 'won' }] });
    for (const cv of [3, undefined, '3', 0]) {
      const old = (action: string, extra: Record<string, unknown> = {}) => s.post({ action, tok, ...(cv === undefined ? {} : { cv }), ...extra });
      expect(old('push', { ops: [{ k: 'stage/2', v: 'won' }] })).toMatchObject({ ok: false, error: REFRESH, me: { u: 'somchai', role: 'sales' } });
      expect(old('upload', { ...upload, docId: 'x' })).toMatchObject({ ok: false, error: REFRESH });
      expect(old('delfile', { fileId })).toMatchObject({ ok: false, error: REFRESH });
      expect(old('pull', { since: 0 })).toMatchObject({ ok: true, rows: [{ k: 'stage/1' }] });
      expect(old('ping')).toMatchObject({ ok: true, seq: 1 });
      expect(old('file', { fileId })).toMatchObject({ ok: true, data: 'JVBERg==' });
      expect(old('me')).toMatchObject({ ok: true, me: { role: 'sales' } });
    }
    // an older viewer's tab gets the same message (it would otherwise be told it may not write)
    const v = member(s, admin, 'vee', 'วี', 'viewer');
    expect(s.post({ action: 'push', tok: v, cv: 3, ops: [] }).error).toBe(REFRESH);
    expect(Number(s.props.SEQ)).toBe(1);
    expect(s.drive.list().filter((x) => x.kind === 'file' && !x.trashed)).toHaveLength(1);
    expect(s.post({ action: 'push', tok, cv: '4', ops: [{ k: 'stage/2', v: 'won' }] })).toMatchObject({ ok: true, n: 1 });
    // the team code (no accounts) works as before, whatever cv says
    const legacy = createGasSim({ teamKey: 'test-key-123' });
    expect(legacy.post({ action: 'push', key: 'test-key-123', cv: 3, ops: [{ k: 'stage/1', v: 'won' }] })).toMatchObject({ ok: true, n: 1 });
  });

  it('me.role keeps the old names for older builds: admin = set.users, sales = any write, else viewer', () => {
    const { s, admin } = team();
    const acct = member(s, admin, 'fon', 'ฝน', role(s, admin, 'บัญชี/การเงิน', ACCT));
    const look = member(s, admin, 'pla', 'ปลา', role(s, admin, 'ดูและตรวจ', ones(['view.sales', 'view.money', 'qt.check'])));
    expect(call(s, admin, 'me').me).toMatchObject({ role: 'admin', rid: 'admin', rn: 'ผู้ดูแลระบบ', rq: 0 });
    expect(call(s, acct, 'me').me).toMatchObject({ role: 'sales', rn: 'บัญชี/การเงิน', caps: ACCT });
    expect(call(s, acct, 'me').me).not.toHaveProperty('rq');
    expect(call(s, look, 'me').me).toMatchObject({ role: 'viewer', rn: 'ดูและตรวจ' });
    expect(login(s, 'fon', 'own-fon').me).toMatchObject({ u: 'fon', role: 'sales', caps: ACCT });
  });
});

// ------------------------------------------------------------------ 7. roles

describe('roles (set.users)', () => {
  it('creates a role, applies it on the next request, and edits it for every member', () => {
    const { s, admin } = team();
    const id = role(s, admin, 'หัวหน้าฝ่ายขาย', HEAD);
    const tok = member(s, admin, 'mint', 'มินท์', id);
    expect(call(s, tok, 'me').me).toMatchObject({ rid: id, rn: 'หัวหน้าฝ่ายขาย', caps: HEAD, role: 'sales' });
    const r = call(s, admin, 'role_save', { id, c: { ...HEAD, 'qt.check': 0, 'set.units': 1 }, d: 'คำอธิบาย' });
    expect(r).toMatchObject({ ok: true, id, roles: { [id]: { n: 'หัวหน้าฝ่ายขาย', d: 'คำอธิบาย', c: { ...ones(Object.keys(HEAD).filter((k) => k !== 'qt.check')), 'set.units': 1 } } } });
    expect(call(s, tok, 'pull', { since: 0 }).me).toMatchObject({ caps: { 'set.units': 1 } });
    expect(meOf(call(s, tok, 'me')).caps).not.toHaveProperty('qt.check');
    expect(audit(s).filter((a) => a.action === 'role_save').map((a) => a.detail)).toEqual([
      { id, n: 'หัวหน้าฝ่ายขาย', add: Object.keys(HEAD), del: [], new: true },
      { id, n: 'หัวหน้าฝ่ายขาย', add: ['set.units'], del: ['qt.check'], new: false },
    ]);
  });

  it('copies another role (from), keeps own-work scopes, drops capabilities whose needs are missing', () => {
    const { s, admin } = team();
    const r = call(s, admin, 'role_save', { n: 'ขายพิเศษ', from: 'sales' });
    expect(rolesOf(r)[String(r.id)]).toMatchObject({ n: 'ขายพิเศษ', c: BUILT.sales });
    const r2 = call(s, admin, 'role_save', { n: 'ไม่ครบ', c: { 'edit.share': 1, 'pay.check': 1, 'view.money': 1, 'del.log': 'own', 'edit.cust': 'own' } });
    expect(rolesOf(r2)[String(r2.id)].c).toEqual({ 'view.money': 1, 'del.log': 'own', 'edit.cust': 1 });
    const r3 = call(s, admin, 'role_save', { n: 'จากผู้ดูแล', from: 'admin' });
    expect(rolesOf(r3)[String(r3.id)].c).toEqual(ones(IDS.filter((c) => c !== 'set.users')));
  });

  it('refuses: admin locked, set.users or an unknown capability, a taken or bad name, more than 10 roles', () => {
    const { s, admin } = team();
    expect(call(s, admin, 'role_save', { id: 'admin', n: 'บอส', c: {} }).error).toBe('role_locked');
    expect(call(s, admin, 'role_save', { n: 'ซุปเปอร์', c: { 'set.users': 1 } }).error).toBe('bad_cap');
    expect(call(s, admin, 'role_save', { n: 'ซุปเปอร์', c: { 'view.everything': 1 } }).error).toBe('bad_cap');
    expect(call(s, admin, 'role_save', { n: 'ซุปเปอร์', c: ['view.sales'] }).error).toBe('bad_cap');
    for (const n of ['', '   ', 'ก'.repeat(31), undefined]) expect(call(s, admin, 'role_save', { n, c: {} }).error).toBe('bad_name');
    for (const n of ['พนักงานขาย', 'ผู้ดูแลระบบ', ' ดูอย่างเดียว ']) expect(call(s, admin, 'role_save', { n, c: {} }).error).toBe('name_taken');
    expect(call(s, admin, 'role_save', { id: 'nope', n: 'x', c: {} }).error).toBe('bad_role');
    for (let i = 0; i < 7; i++) role(s, admin, 'บทบาท ' + i, ones(['view.sales']));
    expect(call(s, admin, 'role_save', { n: 'บทบาทที่ 11', c: {} }).error).toBe('too_many_roles');
    expect(Object.keys(call(s, admin, 'users').roles!)).toHaveLength(10);
    // a built-in may still be edited
    expect(call(s, admin, 'role_save', { id: 'viewer', c: { ...BUILT.viewer, 'docs.open': 0 } })).toMatchObject({ ok: true, roles: { viewer: { n: 'ดูอย่างเดียว', bi: 1, c: ones(['view.sales', 'view.plan', 'view.money', 'view.cash']) } } });
    // names up to 30 characters, at most about 8.5 kB stored with the longest descriptions
    expect(JSON.stringify(props(s, 'ROLES')).length).toBeLessThan(8500);
  });

  it('a built-in edited by an admin applies to its accounts (sales without edit.pay)', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, tok, 'push', { ops: [{ k: 'dpay/d/PAY1', v: { amt: 1 } }] }).denied).toEqual([]);
    call(s, admin, 'role_save', { id: 'sales', c: { ...BUILT.sales, 'edit.pay': 0 } });
    expect(call(s, tok, 'push', { ops: [{ k: 'dpay/d/PAY1', v: { amt: 2 } }] }).denied).toEqual(['dpay/d/PAY1']);
  });

  it('deleting a role moves its accounts and temporary roles; built-ins and roles in use without a target are refused', () => {
    const { s, admin } = team();
    const id = role(s, admin, 'ชั่วคราว', ones(['view.sales']));
    const keep = role(s, admin, 'ปลายทาง', ones(['view.sales', 'view.plan']));
    member(s, admin, 'aaa', 'เอ', id);
    const bb = member(s, admin, 'bbb', 'บี', 'viewer');
    call(s, bb, 'req_send', { k: 'role', role: id, note: 'ขอชั่วคราว', until: '2026-12-31' });
    expect(call(s, admin, 'req_decide', { u: 'bbb', ok: true })).toMatchObject({ ok: true });
    for (const b of ['admin', 'sales', 'viewer']) expect(call(s, admin, 'role_del', { id: b, to: keep }).error).toBe('role_locked');
    expect(call(s, admin, 'role_del', { id }).error).toBe('role_in_use');
    expect(call(s, admin, 'role_del', { id, to: 'admin' }).error).toBe('bad_role');
    expect(call(s, admin, 'role_del', { id, to: id }).error).toBe('bad_role');
    expect(call(s, admin, 'role_del', { id: 'nope', to: keep }).error).toBe('bad_role');
    const r = call(s, admin, 'role_del', { id, to: keep });
    expect(r).toMatchObject({ ok: true, grants: { bbb: { r: { id: keep, until: '2026-12-31' } } } });
    expect(r.roles).not.toHaveProperty(id);
    expect(usersOf(s).aaa.r).toBe(keep);
    expect(call(s, bb, 'me').me).toMatchObject({ rid: keep, rn: 'ปลายทาง' });
    expect(audit(s).at(-1)).toMatchObject({ action: 'role_del', detail: { id, n: 'ชั่วคราว', to: keep, users: ['aaa', 'bbb'] } });
    // an unused role needs no target
    const lone = role(s, admin, 'ไม่มีใครใช้', {});
    expect(call(s, admin, 'role_del', { id: lone })).toMatchObject({ ok: true });
  });

  it('user_save accepts any existing role, keeps last_admin and not_self, and ends a temporary role', () => {
    const { s, admin } = team();
    const id = role(s, admin, 'บัญชี/การเงิน', ACCT);
    expect(call(s, admin, 'user_save', { u: 'lead', role: id }).error).toBe('last_admin');
    const boss = member(s, admin, 'boss2', 'รองหัวหน้า', 'admin');
    expect(call(s, admin, 'user_save', { u: 'lead', role: id }).error).toBe('not_self');
    expect(call(s, boss, 'user_save', { u: 'lead', role: id })).toMatchObject({ ok: true, user: { role: id } });
    expect(call(s, boss, 'user_save', { u: 'boss2', role: id }).error).toBe('last_admin'); // and not_self
    expect(call(s, admin, 'users').error).toBe('forbidden');
    expect(call(s, boss, 'user_save', { u: 'lead', role: 'nope' }).error).toBe('bad_role');
    // a temporary role ends when an admin sets the account's role
    const tok = member(s, boss, 'nid', 'นิด', 'viewer');
    call(s, tok, 'req_send', { k: 'role', role: 'sales', note: 'ช่วยงานขาย', until: '2026-12-31' });
    call(s, boss, 'req_decide', { u: 'nid', ok: true });
    expect(call(s, tok, 'me').me).toMatchObject({ rid: 'sales', role: 'sales' });
    expect(call(s, boss, 'user_save', { u: 'nid', role: id })).toMatchObject({ ok: true });
    expect(props(s, 'GRANTS')).not.toHaveProperty('nid');
    expect(call(s, tok, 'me').me).toMatchObject({ rid: id });
    expect(audit(s).filter((a) => a.action === 'user_role').map((a) => [a.u, a.detail])).toEqual([['lead', { from: 'admin', to: id }], ['nid', { from: 'viewer', to: id }]]);
  });

  it('non-admins may not use users, user_save, role_*, grant_* or req_decide', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'mint', 'มินท์', role(s, admin, 'หัวหน้าฝ่ายขาย', HEAD));
    for (const action of ['users', 'user_save', 'role_save', 'role_del', 'grant_save', 'grant_del', 'req_decide']) expect([action, call(s, tok, action, { u: 'lead', n: 'x', c: {} }).error]).toEqual([action, 'forbidden']);
    // legacy team code: account actions need a sign-in
    const legacy = createGasSim({ teamKey: 'test-key-123' });
    for (const action of ['req_send', 'req_cancel', 'req_ack', 'role_save', 'grant_save', 'req_decide']) expect(legacy.post({ action, key: 'test-key-123', cv: 4 }).error).toBe('login_required');
  });
});

// ------------------------------------------------------------------ 8. requests

describe('permission requests', () => {
  it('a role request: sent, shown to the requester and counted for admins, approved, seen, hidden', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'pla', 'ปลา', 'viewer');
    const id = role(s, admin, 'บัญชี/การเงิน', ACCT);
    at(H);
    expect(call(s, tok, 'req_send', { k: 'role', role: id, note: '  ช่วยตรวจรับเงินสิ้นเดือน  ' })).toMatchObject({
      ok: true,
      me: { req: { st: 'p', id: expect.stringMatching(/^[0-9a-f]{12}$/), k: 'role', role: id, note: 'ช่วยตรวจรับเงินสิ้นเดือน', at: new Date(T0 + H).toISOString() } },
    });
    expect(call(s, admin, 'ping').me).toMatchObject({ rq: 1 });
    const reqs = call(s, admin, 'users').reqs as Record<string, { id: string }>;
    expect(Object.keys(reqs)).toEqual(['pla']);
    at(2 * H);
    const r = call(s, admin, 'req_decide', { u: 'pla', ok: true, note: 'อนุมัติ', id: reqs.pla.id });
    expect(r).toMatchObject({ ok: true, reqs: {}, me: { rq: 0 } });
    expect(usersOf(s).pla.r).toBe(id);
    const me = call(s, tok, 'ping').me!;
    expect(me).toMatchObject({ rid: id, rn: 'บัญชี/การเงิน', caps: ACCT, role: 'sales', req: { st: 'r', ok: true, by: 'หัวหน้า', note: 'อนุมัติ', k: 'role', role: id, at: new Date(T0 + 2 * H).toISOString() } });
    const acked = call(s, tok, 'req_ack');
    expect(acked).toMatchObject({ ok: true });
    expect(acked.me).not.toHaveProperty('req');
    expect(call(s, tok, 'ping').me).not.toHaveProperty('req');
    expect(audit(s).filter((a) => a.action.startsWith('req_')).map((a) => [a.actor, a.u, a.action, a.note])).toEqual([
      ['ปลา', 'pla', 'req_send', 'ช่วยตรวจรับเงินสิ้นเดือน'],
      ['หัวหน้า', 'pla', 'req_ok', 'อนุมัติ'],
    ]);
  });

  it('me lists every role for the request dialog; an account sees its own extras with their dates; the history names the old role', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'pla', 'ปลา', 'viewer');
    const id = role(s, admin, 'บัญชี/การเงิน', ACCT);
    const r = call(s, tok, 'me');
    expect(Object.keys(rolesOf(r))).toEqual(['admin', 'sales', 'viewer', id]);
    expect(rolesOf(r)[id]).toMatchObject({ n: 'บัญชี/การเงิน', c: ACCT });
    expect(rolesOf(r).admin.c).toEqual(BUILT.admin);
    expect(meOf(r)).not.toHaveProperty('grants'); // none yet
    call(s, tok, 'req_send', { k: 'role', role: id, note: 'ช่วงปิดงบ', until: '2026-10-31' });
    call(s, admin, 'req_decide', { u: 'pla', ok: true });
    expect(call(s, admin, 'grant_save', { u: 'pla', c: [{ k: 'del.rec', until: '2026-10-20' }] })).toMatchObject({ ok: true });
    expect(meOf(call(s, tok, 'ping'))).toMatchObject({ rid: id, grants: { r: { id, until: '2026-10-31', by: 'หัวหน้า' }, c: [{ k: 'del.rec', s: 'all', until: '2026-10-20', by: 'หัวหน้า' }] } });
    // only one's own: another account's reply carries none of it
    expect(meOf(call(s, admin, 'ping'))).not.toHaveProperty('grants');
    expect(audit(s).find((a) => a.action === 'req_ok')!.detail).toEqual({ k: 'role', role: id, until: '2026-10-31', from: 'viewer' });
  });

  it('a capability request adds what it needs; approved, it is an extra of that account only', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const other = member(s, admin, 'makorn', 'มกร', 'sales');
    const r = call(s, tok, 'req_send', { k: 'caps', caps: [{ k: 'edit.share' }, { k: 'del.log', s: 'all' }], note: 'แบ่งสัดส่วนงานร่วม', until: '2026-11-30' });
    expect(r.me).toMatchObject({ req: { st: 'p', k: 'caps', caps: [{ k: 'view.comm', s: 'all' }, { k: 'edit.share', s: 'all' }, { k: 'del.log', s: 'all' }], until: '2026-11-30' } });
    call(s, admin, 'req_decide', { u: 'somchai', ok: true });
    expect(call(s, tok, 'me').me).toMatchObject({ rid: 'sales', caps: { ...BUILT.sales, 'view.comm': 1, 'edit.share': 1, 'del.log': 1 } });
    expect(call(s, other, 'me').me).toMatchObject({ caps: BUILT.sales });
    expect(props(s, 'GRANTS').somchai.c.map((e: { k: string; s: string; until?: string; by: string }) => [e.k, e.s, e.until, e.by])).toEqual([
      ['view.comm', 'all', '2026-11-30', 'หัวหน้า'],
      ['edit.share', 'all', '2026-11-30', 'หัวหน้า'],
      ['del.log', 'all', '2026-11-30', 'หัวหน้า'],
    ]);
    expect(call(s, tok, 'push', { ops: [{ k: 'dshare/d1', v: { lines: [] } }] }).denied).toEqual([]);
  });

  it('refused: no note, a note over 300 characters, a past or impossible date, admin, unknown, held or set.users', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const send = (o: Record<string, unknown>) => call(s, tok, 'req_send', { k: 'caps', caps: [{ k: 'view.comm' }], note: 'เหตุผล', ...o }).error;
    for (const note of [undefined, '', '   ', 'ก'.repeat(301)]) expect(send({ note })).toBe('req_note');
    expect(send({ note: 'ก'.repeat(300) })).toBeUndefined();
    for (const until of ['2026-10-07', '2026-02-30', '31/12/2026', 'tomorrow', 20261231]) expect(send({ until })).toBe('bad_until');
    expect(send({ until: '2026-10-08' })).toBeUndefined(); // today counts through today
    expect(send({ k: 'role', role: 'admin' })).toBe('role_locked');
    expect(send({ k: 'role', role: 'nope' })).toBe('bad_role');
    expect(send({ k: 'role', role: 'sales' })).toBe('cap_held');
    expect(send({ k: 'boss' })).toBe('bad_req');
    for (const caps of [[{ k: 'set.users' }], [{ k: 'view.everything' }], [], 'view.comm', undefined]) expect(send({ caps })).toBe('bad_cap');
    expect(send({ caps: [{ k: 'edit.deal' }] })).toBe('cap_held');
    expect(send({ caps: [{ k: 'del.log', s: 'own' }] })).toBe('cap_held');
    expect(send({ caps: [{ k: 'del.log', s: 'all' }] })).toBeUndefined(); // own work → all work is a change
    // an admin has everything: nothing to ask for
    expect(call(s, admin, 'req_send', { k: 'caps', caps: [{ k: 'view.comm' }], note: 'x' }).error).toBe('forbidden');
  });

  it('one pending request per account: a new one replaces it and hides the last result; cancel withdraws it', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    call(s, tok, 'req_send', { k: 'caps', caps: [{ k: 'view.comm' }], note: 'ครั้งแรก' });
    call(s, admin, 'req_decide', { u: 'somchai', ok: false, note: 'ยังไม่จำเป็น' });
    expect(call(s, tok, 'me').me).toMatchObject({ req: { st: 'r', ok: false, note: 'ยังไม่จำเป็น', k: 'caps' } });
    call(s, tok, 'req_send', { k: 'caps', caps: [{ k: 'view.comm' }], note: 'ครั้งที่สอง' });
    const first = (props(s, 'REQS').somchai as { id: string }).id;
    expect(call(s, tok, 'me').me).toMatchObject({ req: { st: 'p', note: 'ครั้งที่สอง' } });
    expect(props(s, 'RESULTS')).toEqual({});
    call(s, tok, 'req_send', { k: 'role', role: 'viewer', note: 'ครั้งที่สาม' });
    expect(Object.keys(props(s, 'REQS'))).toEqual(['somchai']);
    expect(call(s, admin, 'req_decide', { u: 'somchai', ok: true, id: first }).error).toBe('changed');
    const cancelled = call(s, tok, 'req_cancel');
    expect(cancelled).toMatchObject({ ok: true, me: { u: 'somchai' } });
    expect(cancelled.me).not.toHaveProperty('req'); // the reply itself says it is gone
    expect(call(s, tok, 'me').me).not.toHaveProperty('req');
    expect(call(s, tok, 'req_cancel')).toMatchObject({ ok: true });
    expect(call(s, admin, 'req_decide', { u: 'somchai', ok: true }).error).toBe('no_request');
    expect(audit(s).map((a) => a.action).filter((a) => a.startsWith('req_'))).toEqual(['req_send', 'req_no', 'req_send', 'req_send', 'req_cancel']);
  });

  it('nobody decides their own request; a refusal changes nothing; an mc account may not send one', () => {
    const { s, admin } = team();
    const boss = member(s, admin, 'boss2', 'รองหัวหน้า', 'admin');
    expect(call(s, admin, 'req_decide', { u: 'lead', ok: true }).error).toBe('not_self');
    expect(call(s, boss, 'req_decide', { u: 'BOSS2', ok: true }).error).toBe('not_self');
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    call(s, tok, 'req_send', { k: 'role', role: 'viewer', note: 'x' });
    expect(call(s, boss, 'req_decide', { u: 'somchai', ok: false, note: 'ก'.repeat(301) }).error).toBe('req_note');
    expect(call(s, boss, 'req_decide', { u: 'somchai', ok: 'yes', note: 'ไม่' })).toMatchObject({ ok: true }); // only true or 1 approves
    expect(usersOf(s).somchai.r).toBe('sales');
    expect(props(s, 'GRANTS')).toEqual({});
    call(s, admin, 'user_save', { create: true, u: 'newbie', name: 'มือใหม่', role: 'viewer', pk: s.pk('newbie', 'temp-1') });
    const mc = String(login(s, 'newbie', 'temp-1').tok);
    for (const action of ['req_send', 'req_cancel', 'req_ack']) expect(call(s, mc, action, { k: 'role', role: 'sales', note: 'x' }).error).toBe('must_change_password');
  });

  it('a temporary role or extra lasts through its end date in Bangkok, then grants nothing and is removed on users', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'pla', 'ปลา', 'viewer');
    call(s, tok, 'req_send', { k: 'role', role: 'sales', note: 'ช่วงงานเยอะ', until: '2026-10-09' });
    call(s, admin, 'req_decide', { u: 'pla', ok: true });
    call(s, admin, 'grant_save', { u: 'pla', c: [{ k: 'view.comm', until: '2026-10-08' }] });
    expect(call(s, tok, 'me').me).toMatchObject({ rid: 'sales', role: 'sales', caps: { 'view.comm': 1 } });
    vi.setSystemTime(Date.parse('2026-10-08T16:59:59.000Z')); // 23:59:59 on the 8th in Bangkok
    expect(meOf(call(s, tok, 'me')).caps).toHaveProperty('view.comm');
    vi.setSystemTime(Date.parse('2026-10-08T17:00:00.000Z')); // midnight in Bangkok
    expect(meOf(call(s, tok, 'me')).caps).not.toHaveProperty('view.comm');
    expect(call(s, tok, 'me').me).toMatchObject({ rid: 'sales' });
    vi.setSystemTime(Date.parse('2026-10-09T17:00:00.000Z'));
    expect(call(s, tok, 'me').me).toMatchObject({ rid: 'viewer', role: 'viewer', caps: BUILT.viewer });
    expect(call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'won' }] }).error).toBe('forbidden');
    expect(props(s, 'GRANTS')).toHaveProperty('pla');
    const r = call(s, admin, 'users');
    expect(r.grants).toEqual({});
    expect(props(s, 'GRANTS')).toEqual({});
    // newest first
    expect((r.audit as { action: string; u: string; detail: unknown }[]).filter((a) => a.action === 'grant_expired').map((a) => [a.u, a.detail])).toEqual([
      ['pla', { k: 'view.comm', until: '2026-10-08' }],
      ['pla', { role: 'sales', until: '2026-10-09' }],
    ]);
  });

  it('REQS keeps within the Properties limit (too_many_reqs); RESULTS drops the oldest results instead', () => {
    const { s, admin } = team();
    const note = 'ข'.repeat(300); // 900 bytes in UTF-8
    const toks = Array.from({ length: 12 }, (_, i) => member(s, admin, 'user' + i, 'คนที่ ' + i, 'viewer'));
    const sent = toks.map((t) => call(s, t, 'req_send', { k: 'caps', caps: [{ k: 'edit.cust' }], note }).error ?? 'ok');
    expect(sent.slice(0, 8)).toEqual(Array(8).fill('ok'));
    expect(sent.slice(8)).toContain('too_many_reqs');
    expect(new TextEncoder().encode(s.props.REQS).length).toBeLessThanOrEqual(8500);
    const decided: string[] = [];
    const decideAll = () =>
      Object.keys(props(s, 'REQS')).forEach((u) => {
        at(decided.length * MIN);
        expect(call(s, admin, 'req_decide', { u, ok: false, note }).ok).toBe(true);
        decided.push(u);
      });
    decideAll();
    // the others ask now that there is room, and are refused too: 12 results do not fit
    toks.forEach((t, i) => !decided.includes('user' + i) && expect(call(s, t, 'req_send', { k: 'caps', caps: [{ k: 'edit.cust' }], note }).ok).toBe(true));
    decideAll();
    expect(decided).toHaveLength(12);
    expect(new TextEncoder().encode(s.props.RESULTS).length).toBeLessThanOrEqual(8500);
    const kept = Object.keys(props(s, 'RESULTS'));
    expect(kept.length).toBeGreaterThan(4);
    expect(kept.length).toBeLessThan(12);
    expect(kept).toEqual(expect.arrayContaining(decided.slice(-4))); // the newest stay
    expect(kept).not.toContain(decided[0]);
  });
});

// ------------------------------------------------------------------ 9. extras given directly

describe('extras for one account (grant_save / grant_del)', () => {
  it('an admin gives and removes an extra; it needs no request and applies on the next request', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'makorn', 'มกร', 'sales');
    const r = call(s, admin, 'grant_save', { u: 'makorn', c: [{ k: 'edit.share', until: '2026-11-08' }] });
    expect(r).toMatchObject({ ok: true, grants: { makorn: { c: [{ k: 'view.comm', s: 'all', until: '2026-11-08', by: 'หัวหน้า' }, { k: 'edit.share', s: 'all', until: '2026-11-08', by: 'หัวหน้า' }] } } });
    expect(meOf(call(s, tok, 'me')).caps).toMatchObject({ 'view.comm': 1, 'edit.share': 1 });
    // given again: replaced (a new end date), with what it needs
    call(s, admin, 'grant_save', { u: 'makorn', c: [{ k: 'edit.share' }] });
    expect(props(s, 'GRANTS').makorn.c.map((e: { k: string; until?: string }) => [e.k, e.until ?? ''])).toEqual([['view.comm', ''], ['edit.share', '']]);
    expect(call(s, admin, 'grant_del', { u: 'makorn', k: 'view.comm' })).toMatchObject({ ok: true });
    // edit.share needs view.comm: it no longer counts
    expect(meOf(call(s, tok, 'me')).caps).not.toHaveProperty('edit.share');
    expect(call(s, admin, 'grant_del', { u: 'makorn', k: 'edit.share' })).toMatchObject({ ok: true, grants: {} });
    expect(call(s, admin, 'grant_del', { u: 'makorn', k: 'edit.share' })).toMatchObject({ ok: true }); // already gone
    expect(audit(s).filter((a) => a.action.startsWith('grant_')).map((a) => [a.action, a.u])).toEqual([['grant_save', 'makorn'], ['grant_save', 'makorn'], ['grant_del', 'makorn'], ['grant_del', 'makorn']]);
  });

  it('refuses: oneself, set.users, unknown, a capability the role already gives, an admin, a bad date', () => {
    const { s, admin } = team();
    member(s, admin, 'makorn', 'มกร', 'sales');
    member(s, admin, 'boss2', 'รองหัวหน้า', 'admin');
    const g = (u: string, c: unknown) => call(s, admin, 'grant_save', { u, c }).error;
    expect(g('lead', [{ k: 'view.comm' }])).toBe('not_self');
    expect(call(s, admin, 'grant_del', { u: 'lead', k: 'view.comm' }).error).toBe('not_self');
    expect(g('makorn', [{ k: 'set.users' }])).toBe('bad_cap');
    expect(g('makorn', [{ k: 'nope' }])).toBe('bad_cap');
    expect(g('makorn', [])).toBe('bad_cap');
    expect(g('makorn', [{ k: 'edit.deal' }])).toBe('cap_held');
    expect(g('makorn', [{ k: 'view.comm', until: '2026-10-07' }])).toBe('bad_until');
    expect(g('boss2', [{ k: 'view.comm' }])).toBe('cap_held');
    expect(g('ghost', [{ k: 'view.comm' }])).toBe('unknown_user');
    expect(props(s, 'GRANTS')).toEqual({});
  });

  it('an own-work extra does not narrow what the role gives; an all-work extra widens an own-work role', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, admin, 'grant_save', { u: 'somchai', c: [{ k: 'del.log', s: 'own' }] }).error).toBe('cap_held');
    call(s, admin, 'grant_save', { u: 'somchai', c: [{ k: 'del.log', s: 'all' }] });
    expect(meOf(call(s, tok, 'me')).caps['del.log']).toBe(1);
    call(s, admin, 'push', { ops: [{ k: 'log/1/a', v: { text: 'x' } }] });
    expect(call(s, tok, 'push', { ops: [{ k: 'log/1/a', del: true }] }).denied).toEqual([]);
  });
});

// ------------------------------------------------------------------ 10. the audit tab and the directory cache

describe('the audit tab and the cached directory', () => {
  it('users returns the last 50 audit rows, newest first; rows older than a year are dropped', () => {
    const { s, admin } = team();
    for (let i = 0; i < 30; i++) role(s, admin, 'r' + i, {}) && call(s, admin, 'role_del', { id: Object.keys(call(s, admin, 'users').roles!).find((k) => !['admin', 'sales', 'viewer'].includes(k)) });
    const r = call(s, admin, 'users');
    const a = r.audit as { at: string; action: string; detail: { n: string } }[];
    expect(a).toHaveLength(50);
    expect(a[0]).toMatchObject({ action: 'role_del', detail: { n: 'r29' } });
    expect(audit(s)).toHaveLength(60);
    expect(s.sheetOf('audit')!.rows[0]).toEqual(['at', 'actor', 'u', 'action', 'detail', 'note']);
    expect(s.sheetOf('audit')!.getMaxColumns()).toBe(6);
    at(366 * DAY);
    const tok = String(login(s, 'lead', 'lead-password-1').tok);
    call(s, tok, 'role_save', { n: 'ใหม่', c: {} });
    expect(call(s, tok, 'users').audit).toEqual([expect.objectContaining({ action: 'role_save', detail: expect.objectContaining({ n: 'ใหม่' }) })]);
    expect(audit(s)).toHaveLength(1);
  });

  it('roles, extras and requests are in the cached directory: polling reads no Properties, and a change applies at once', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'somchai', 'สมชาย', 'sales');
    call(s, admin, 'grant_save', { u: 'somchai', c: [{ k: 'view.comm' }] });
    call(s, tok, 'req_send', { k: 'role', role: 'viewer', note: 'x' });
    call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'won' }] });
    const before = s.stats.propRead;
    for (let i = 0; i < 20; i++) {
      expect(call(s, tok, 'ping').me).toMatchObject({ caps: { 'view.comm': 1 }, req: { st: 'p' } });
      expect(call(s, admin, 'pull', { since: i % 2 }).me).toMatchObject({ rq: 1 });
    }
    expect(s.stats.propRead).toBe(before);
    call(s, admin, 'grant_del', { u: 'somchai', k: 'view.comm' });
    expect(meOf(call(s, tok, 'ping')).caps).not.toHaveProperty('view.comm');
    const c = JSON.parse(s.cache.AUTHC);
    // ntf / nf: the e-mail settings and the notification state (notify.server.test.ts)
    expect(Object.keys(c)).toEqual(['m', 'sec', 'tid', 'it', 'u', 'roles', 'grants', 'rqs', 'res', 'ntf', 'nf']);
    // lost: rebuilt from Properties on the next request
    s.evictCache();
    expect(call(s, tok, 'ping').me).toMatchObject({ req: { st: 'p' } });
  });
});

// ------------------------------------------------------------------ secrets

describe('secrets', () => {
  it('no reply in this file contained the token secret, a salt or a password hash', () => {
    let n = 0;
    for (const { replies, s } of seen) {
      const text = replies.join('\n');
      n += replies.length;
      const secrets = [s.props.AUTH_SECRET, ...Object.values(JSON.parse(s.props.USERS || '{"users":{}}').users as Record<string, { s: string; h: string }>).flatMap((x) => [x.s, x.h])].filter(Boolean);
      for (const x of secrets) expect(text.includes(x)).toBe(false);
      expect(text).not.toMatch(/"(sec|AUTH_SECRET|OWNER_CODE|USERS|h)":/);
    }
    expect(n).toBeGreaterThan(300);
  });
});
