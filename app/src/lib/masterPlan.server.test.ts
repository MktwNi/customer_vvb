/**
 * The CFO Master Plan page in the team script (team-sync/Code.gs, the mp_* actions), through the simulator.
 * What matters most: who can read a plan, and that plans never reach the sales web app or its sheet.
 */
import { describe, expect, it } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';

const call = (s: GasSim, tok: string, action: string, extra: Record<string, unknown> = {}) => s.post({ action, cv: 5, tok, ...extra });
const login = (s: GasSim, u: string, pw: string) => s.post({ action: 'login', cv: 5, u, pk: s.pk(u, pw), rm: true });
function team() {
  const s = createGasSim({ kdfIter: 1000 });
  const admin = s.bootstrapAdmin({ u: 'lead', name: 'หัวหน้า', pw: 'lead-password-1' });
  return { s, admin };
}
function member(s: GasSim, admin: string, u: string, name: string, role: string) {
  expect(call(s, admin, 'user_save', { create: true, u, name, role, pk: s.pk(u, 'temp-' + u) })).toMatchObject({ ok: true });
  const t = login(s, u, 'temp-' + u);
  const r = call(s, String(t.tok), 'passwd', { old: s.pk(u, 'temp-' + u), pk: s.pk(u, 'own-' + u) });
  expect(r).toMatchObject({ ok: true });
  return String(r.tok);
}
const plan = (client: string, extra: Record<string, unknown> = {}) => ({ schema: 'gcc-master-plan-cfo', version: 1, project: { client, projectNo: 'P-' + client }, activities: {}, signoff: {}, ...extra });
const rows = (s: GasSim) => (s.sheetOf('master_plan')?.rows || []).slice(1).filter((r) => r[0]);
const caseIn = (r: Record<string, unknown>) => r.cases as { id: string; v: number; by: string; at: string; data: string; del: number }[];

describe('who may use it', () => {
  it('hello tells a page the script supports Master Plan, without a token', () => {
    const { s } = team();
    expect(s.post({ action: 'hello' })).toMatchObject({ ok: true, mp: 1 });
  });

  it('an admin may read and write; sales and viewer accounts may do neither by default', () => {
    const { s, admin } = team();
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const viewer = member(s, admin, 'pla', 'ปลา', 'viewer');
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') })).toMatchObject({ ok: true, id: 'c1', v: 1 });
    for (const tok of [sales, viewer]) {
      const list = call(s, tok, 'mp_list');
      expect(list).toMatchObject({ ok: false, error: 'forbidden' });
      expect(JSON.stringify(list)).not.toContain('ลูกค้าเอ');
      expect(call(s, tok, 'mp_save', { id: 'c2', v: 0, data: plan('แอบใส่') })).toMatchObject({ ok: false, error: 'forbidden' });
      expect(call(s, tok, 'mp_del', { id: 'c1', v: 1 })).toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect(caseIn(call(s, admin, 'mp_list')).map((c) => c.id)).toEqual(['c1']);
  });

  it('nobody signed in gets anything, and a bad token gets no case', () => {
    const { s, admin } = team();
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') });
    for (const r of [s.post({ action: 'mp_list', cv: 5 }), s.post({ action: 'mp_list', cv: 5, key: 'test-key-123' }), s.post({ action: 'mp_list', cv: 5, tok: 'g1.bad.bad' })]) {
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain('ลูกค้าเอ');
    }
  });

  it('a grant gives one account access without touching its role; revoking it takes access back at once', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'nong', 'น้องแอดมิน', 'viewer');
    expect(call(s, tok, 'mp_list').error).toBe('forbidden');
    expect(call(s, admin, 'grant_save', { u: 'nong', c: [{ k: 'mp.edit' }] })).toMatchObject({ ok: true });
    const r = call(s, tok, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') });
    expect(r).toMatchObject({ ok: true, by: 'น้องแอดมิน' });
    expect(caseIn(call(s, tok, 'mp_list'))).toHaveLength(1);
    expect((call(s, tok, 'me').me as { caps: Record<string, unknown> }).caps).toMatchObject({ 'mp.view': 1, 'mp.edit': 1 });
    call(s, admin, 'grant_del', { u: 'nong', k: 'mp.edit' });
    call(s, admin, 'grant_del', { u: 'nong', k: 'mp.view' });
    expect(call(s, tok, 'mp_list').error).toBe('forbidden');
    expect(caseIn(call(s, admin, 'mp_list'))).toHaveLength(1);
  });

  it('mp.view alone reads and cannot write', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'boss', 'ผู้ตรวจ', 'viewer');
    call(s, admin, 'grant_save', { u: 'boss', c: [{ k: 'mp.view' }] });
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') });
    expect(caseIn(call(s, tok, 'mp_list'))).toHaveLength(1);
    expect(call(s, tok, 'mp_save', { id: 'c1', v: 1, data: plan('แก้') }).error).toBe('forbidden');
    expect(call(s, tok, 'mp_del', { id: 'c1', v: 1 }).error).toBe('forbidden');
  });

  it('a temporary password and a disabled account cannot reach it', () => {
    const { s, admin } = team();
    call(s, admin, 'user_save', { create: true, u: 'newbie', name: 'ใหม่', role: 'admin', pk: s.pk('newbie', 'temp-newbie') });
    const t = String(login(s, 'newbie', 'temp-newbie').tok);
    expect(call(s, t, 'mp_list').error).toBe('must_change_password');
    const tok = member(s, admin, 'gone', 'ออกแล้ว', 'admin');
    expect(call(s, tok, 'mp_list').ok).toBe(true);
    call(s, admin, 'user_save', { u: 'gone', on: 0 });
    expect(call(s, tok, 'mp_list').ok).toBe(false);
  });
});

describe('saving', () => {
  it('stores the plan as text in its own tab, with who and when written by the script', () => {
    const { s, admin } = team();
    const r = call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ', { id: 'someone-else', by: 'ปลอม' }) });
    expect(r).toMatchObject({ ok: true, id: 'c1', v: 1, by: 'หัวหน้า' });
    expect(s.sheetOf('master_plan')!.rows[0]).toEqual(['id', 'v', 'data', 'by', 'at', 'del']);
    expect(rows(s)).toHaveLength(1);
    const [c] = caseIn(call(s, admin, 'mp_list'));
    expect(c).toMatchObject({ id: 'c1', v: 1, by: 'หัวหน้า', del: 0 });
    expect(JSON.parse(c.data)).toMatchObject({ id: 'c1', project: { client: 'ลูกค้าเอ' } });
    expect(c.at).toBe(r.at);
  });

  it('a stale version is refused with what is stored, so nobody overwrites a colleague unknowingly', () => {
    const { s, admin } = team();
    const other = member(s, admin, 'lek', 'เล็ก', 'admin');
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ฉบับแรก') });
    expect(call(s, other, 'mp_save', { id: 'c1', v: 1, data: plan('ฉบับเล็ก') })).toMatchObject({ ok: true, v: 2, by: 'เล็ก' });
    const late = call(s, admin, 'mp_save', { id: 'c1', v: 1, data: plan('ฉบับหัวหน้า') });
    expect(late).toMatchObject({ ok: false, error: 'conflict', current: { id: 'c1', v: 2, by: 'เล็ก' } });
    expect(JSON.parse((late.current as { data: string }).data).project.client).toBe('ฉบับเล็ก');
    expect(JSON.parse(caseIn(call(s, admin, 'mp_list'))[0].data).project.client).toBe('ฉบับเล็ก');
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 2, data: plan('ฉบับหัวหน้า') })).toMatchObject({ ok: true, v: 3 });
  });

  it('a new case with an id already taken is a conflict, not an overwrite', () => {
    const { s, admin } = team();
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') });
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าบี') }).error).toBe('conflict');
  });

  it('refuses malformed requests', () => {
    const { s, admin } = team();
    for (const extra of [
      { id: 'c1', v: 0, data: { schema: 'something-else' } },
      { id: 'c1', v: 0, data: null },
      { id: 'c1', v: 0, data: 'text' },
      { id: '../x', v: 0, data: plan('ก') },
      { id: '', v: 0, data: plan('ก') },
      { id: 'c1', v: -1, data: plan('ก') },
      { id: 'c1', v: 1.5, data: plan('ก') },
      { id: 'c1', v: 'x', data: plan('ก') },
    ]) expect(call(s, admin, 'mp_save', extra).error, JSON.stringify(extra)).toBe('bad_data');
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ก', { pad: 'x'.repeat(46000) }) }).error).toBe('too_large');
    expect(rows(s)).toHaveLength(0);
  });

  it('text that looks like a formula or a date stays text', () => {
    const { s, admin } = team();
    const c = plan('=IMPORTXML("http://x","//a")');
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: c });
    expect(JSON.parse(caseIn(call(s, admin, 'mp_list'))[0].data).project.client).toBe('=IMPORTXML("http://x","//a")');
  });

  it('keeps going past the rows a new sheet starts with', () => {
    const { s, admin } = team();
    for (let i = 0; i < 1005; i++) expect(call(s, admin, 'mp_save', { id: 'c' + i, v: 0, data: plan('ลูกค้า' + i) }).ok).toBe(true);
    expect(caseIn(call(s, admin, 'mp_list'))).toHaveLength(1005);
  });

  it('answers busy when another request holds the lock', () => {
    const { s, admin } = team();
    const release = s.holdLock();
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') }).error).toBe('busy');
    release();
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') }).ok).toBe(true);
  });
});

describe('deleting', () => {
  it('hides the case but keeps the row, so the owner of the sheet can restore it', () => {
    const { s, admin } = team();
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') });
    expect(call(s, admin, 'mp_del', { id: 'c1', v: 1 })).toMatchObject({ ok: true, v: 2 });
    expect(caseIn(call(s, admin, 'mp_list'))).toEqual([]);
    expect(rows(s)[0]).toEqual(expect.arrayContaining(['c1', '1']));
    expect(String(rows(s)[0][2])).toContain('ลูกค้าเอ');
  });

  it('a stale delete is refused; deleting twice is fine; an unknown case is not_found', () => {
    const { s, admin } = team();
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ฉบับแรก') });
    call(s, admin, 'mp_save', { id: 'c1', v: 1, data: plan('ฉบับสอง') });
    expect(call(s, admin, 'mp_del', { id: 'c1', v: 1 }).error).toBe('conflict');
    expect(call(s, admin, 'mp_del', { id: 'c1', v: 2 }).ok).toBe(true);
    expect(call(s, admin, 'mp_del', { id: 'c1', v: 2 }).ok).toBe(true);
    expect(call(s, admin, 'mp_del', { id: 'nope', v: 0 }).error).toBe('not_found');
  });

  it('a case deleted meanwhile answers conflict, and saving at its version brings it back', () => {
    const { s, admin } = team();
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าเอ') });
    call(s, admin, 'mp_del', { id: 'c1', v: 1 });
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 1, data: plan('แก้') })).toMatchObject({ error: 'conflict', current: { v: 2, del: 1 } });
    expect(call(s, admin, 'mp_save', { id: 'c1', v: 2, data: plan('กู้คืน') })).toMatchObject({ ok: true, v: 3 });
    expect(JSON.parse(caseIn(call(s, admin, 'mp_list'))[0].data).project.client).toBe('กู้คืน');
  });
});

describe('the sales system is left as it is', () => {
  it('plans never appear in a pull, and saving one writes nothing to the sync tab', () => {
    const { s, admin } = team();
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    expect(call(s, sales, 'push', { ops: [{ k: 'stage/1', v: 'A' }] })).toMatchObject({ ok: true });
    const before = JSON.stringify(s.sheet()!.rows);
    const seqBefore = call(s, admin, 'ping').seq;
    call(s, admin, 'mp_save', { id: 'c1', v: 0, data: plan('ลูกค้าความลับ') });
    call(s, admin, 'mp_save', { id: 'c1', v: 1, data: plan('ลูกค้าความลับ') });
    call(s, admin, 'mp_del', { id: 'c1', v: 2 });
    expect(JSON.stringify(s.sheet()!.rows)).toBe(before);
    expect(call(s, admin, 'ping').seq).toBe(seqBefore);
    for (const tok of [admin, sales]) expect(JSON.stringify(call(s, tok, 'pull', { since: 0 }))).not.toContain('ลูกค้าความลับ');
    expect(JSON.stringify(s.sheetOf('audit')?.rows || [])).not.toContain('ลูกค้าความลับ');
  });

  it('sales accounts keep exactly their capabilities; the new ones are admin-only', () => {
    const { s, admin } = team();
    const sales = member(s, admin, 'somchai', 'สมชาย', 'sales');
    const viewer = member(s, admin, 'pla', 'ปลา', 'viewer');
    for (const tok of [sales, viewer]) {
      const c = (call(s, tok, 'me').me as { caps: Record<string, unknown> }).caps;
      expect(c).not.toHaveProperty('mp.view');
      expect(c).not.toHaveProperty('mp.edit');
    }
    const a = (call(s, admin, 'me').me as { caps: Record<string, unknown> }).caps;
    expect(a).toMatchObject({ 'mp.view': 1, 'mp.edit': 1 });
  });

  it('holding only mp.edit does not let an account push sales records', () => {
    const { s, admin } = team();
    const tok = member(s, admin, 'nong', 'น้องแอดมิน', 'viewer');
    call(s, admin, 'grant_save', { u: 'nong', c: [{ k: 'mp.edit' }] });
    expect(call(s, tok, 'push', { ops: [{ k: 'stage/1', v: 'A' }] }).error).toBe('forbidden');
  });
});
