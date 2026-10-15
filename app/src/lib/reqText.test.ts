/** The words of permission requests and the Users page's helpers. */
import { describe, expect, it } from 'vitest';
import { histLine, reqWords, resultNotice, spanWords } from './reqText';
import { BUILTIN, parseRoles } from './caps';
import { effRole, extrasOf, membersOf, peopleLine, roleOf, userName } from '../tabs/users/shared';
import type { TeamDir, TeamUser } from './engine';

const names: Record<string, string> = { head: 'หัวหน้าฝ่ายขาย', sales: 'พนักงานขาย', viewer: 'ดูอย่างเดียว' };
const nameOf = (id: string) => names[id] || id;

describe('request words', () => {
  it('the account menu line', () => {
    expect(reqWords({ k: 'role', role: 'head', until: '2027-01-31' }, nameOf)).toBe('ขอเป็น หัวหน้าฝ่ายขาย ถึง 31 ม.ค. 2570');
    expect(reqWords({ k: 'caps', caps: [{ k: 'edit.pay', s: 'all' }, { k: 'docs.up', s: 'all' }] }, nameOf)).toBe('ขอสิทธิ์เพิ่ม 2 รายการ');
  });
  it('the result notice: approved (the role in bold), not approved', () => {
    expect(resultNotice({ ok: true, by: 'หมิว', note: '', at: '', role: 'head', until: '2027-01-31' }, nameOf, 'หัวหน้าฝ่ายขาย')).toEqual({ lead: 'หมิวอนุมัติคำขอของคุณแล้ว ตอนนี้คุณเป็น ', role: 'หัวหน้าฝ่ายขาย', tail: ' ถึง 31 ม.ค. 2570' });
    expect(resultNotice({ ok: false, by: 'หมิว', note: 'คุยก่อน', at: '', role: 'head' }, nameOf, 'พนักงานขาย')).toEqual({ lead: 'หมิวไม่อนุมัติคำขอเป็น หัวหน้าฝ่ายขาย', role: '', tail: '' });
    expect(resultNotice({ ok: true, by: 'ต้น', note: '', at: '', caps: [{ k: 'view.comm', s: 'all' }] }, nameOf, 'พนักงานขาย').lead).toBe('ต้นอนุมัติคำขอของคุณแล้ว ได้สิทธิ์เพิ่ม 1 รายการ: ดูค่าคอมมิชชั่น / สัดส่วนรายได้');
    expect(resultNotice({ ok: false, by: '', note: '', at: '', caps: [{ k: 'set.lists', s: 'all' }] }, nameOf, '').lead).toBe('ผู้ดูแลระบบไม่อนุมัติคำขอสิทธิ์เพิ่ม 1 รายการ');
  });
  it('the span of a request', () => {
    expect(spanWords({ k: 'role', until: '2027-01-31' }, 'พนักงานขาย')).toBe('ชั่วคราว ถึง 31 ม.ค. 2570 แล้วกลับเป็น พนักงานขาย');
    expect(spanWords({ k: 'caps', until: '2026-10-31' }, 'ดูอย่างเดียว')).toBe('ชั่วคราว ถึง 31 ต.ค. 2569');
    expect(spanWords({ k: 'caps' }, 'x')).toBe('ถาวร');
  });
  it('history lines from the audit tab', () => {
    const who = (u: string) => ({ mk: 'มกร', mew: 'หมิว', ek: 'เอก', pla: 'ปลา' })[u] || u;
    expect(histLine({ at: '2026-10-05T04:20:00Z', actor: 'mew', u: 'mk', action: 'req_decide', detail: { ok: true, caps: [{ k: 'view.comm' }], until: '2026-10-31' }, note: '' }, nameOf, who)).toMatchObject({
      who: 'มกร', what: 'ขอสิทธิ์เพิ่ม: ดูค่าคอมมิชชั่น / สัดส่วนรายได้ ถึง 31 ต.ค. 2569', result: 'อนุมัติ', kind: 'info', by: 'หมิว',
    });
    expect(histLine({ at: 'x', actor: 'mew', u: 'mk', action: 'req_decide', detail: { ok: false, caps: ['set.lists'] }, note: 'แจ้งหมิวเพิ่มหมวดให้แทน' }, nameOf, who)).toMatchObject({ result: 'ไม่อนุมัติ', kind: '', sub: '“แจ้งหมิวเพิ่มหมวดให้แทน”' });
    expect(histLine({ at: 'x', actor: 'ton', u: 'ek', action: 'req_decide', detail: { ok: 1, role: 'sales', from: 'viewer' }, note: '' }, nameOf, who)!.what).toBe('ขอเปลี่ยนบทบาท จาก ดูอย่างเดียว เป็น พนักงานขาย');
    expect(histLine({ at: 'x', actor: 'mew', u: 'mint', action: 'user_role', detail: { from: 'sales', to: 'head' }, note: '' }, nameOf, who)).toMatchObject({ what: 'เปลี่ยนบทบาทเป็น หัวหน้าฝ่ายขาย', result: 'เปลี่ยนโดยผู้ดูแลระบบ', sub: 'ไม่ได้มาจากคำขอ' });
    expect(histLine({ at: 'x', actor: 'ton', u: 'pla', action: 'grant_expire', detail: { k: 'edit.task', until: '2026-09-30' }, note: '' }, nameOf, who)).toMatchObject({ what: 'สิทธิ์เพิ่ม: นัดหมาย ถึง 30 ก.ย. 2569', result: 'หมดอายุแล้ว', sub: 'สิ้นสุด 30 ก.ย. 2569' });
    expect(histLine({ at: 'x', actor: 'mew', u: 'ek', action: 'req_send', detail: {}, note: '' }, nameOf, who)).toBeNull();
    expect(histLine({ at: 'x', actor: 'mew', u: 'ek', action: 'user_save', detail: { name: 'x' }, note: '' }, nameOf, who)).toBeNull();
  });
  it('history lines as the team script writes them (actor = a display name; req_ok / req_no; dates per capability)', () => {
    const who = (u: string) => ({ mk: 'มกร', ek: 'เอก', pla: 'ปลา' })[u] || u;
    expect(histLine({ at: 'x', actor: 'หมิว', u: 'ek', action: 'req_ok', detail: { k: 'role', role: 'sales', until: '2026-10-31', from: 'viewer' }, note: 'ช่วงงานเยอะ' }, nameOf, who)).toMatchObject({
      who: 'เอก', by: 'หมิว', what: 'ขอเปลี่ยนบทบาท จาก ดูอย่างเดียว เป็น พนักงานขาย ถึง 31 ต.ค. 2569', result: 'อนุมัติ', kind: 'info', sub: '“ช่วงงานเยอะ”',
    });
    expect(histLine({ at: 'x', actor: 'หมิว', u: 'mk', action: 'req_no', detail: { k: 'caps', caps: [{ k: 'view.money', s: 'all' }, { k: 'view.comm', s: 'all' }] }, note: '' }, nameOf, who)).toMatchObject({ what: 'ขอสิทธิ์เพิ่ม: ดูยอดเงิน, ดูค่าคอมมิชชั่น / สัดส่วนรายได้', result: 'ไม่อนุมัติ', kind: '' });
    expect(histLine({ at: 'x', actor: 'หมิว', u: 'pla', action: 'grant_save', detail: { caps: [{ k: 'del.rec', s: 'all', until: '2026-10-20' }] }, note: '' }, nameOf, who)).toMatchObject({ what: 'ให้สิทธิ์เพิ่ม: ลบดีล ลูกค้า และผู้ติดต่อ ถึง 20 ต.ค. 2569', result: 'ให้โดยผู้ดูแลระบบ' });
    expect(histLine({ at: 'x', actor: 'หมิว', u: 'pla', action: 'grant_save', detail: { caps: [{ k: 'del.rec', s: 'all', until: '' }] }, note: '' }, nameOf, who)!.what).toBe('ให้สิทธิ์เพิ่ม: ลบดีล ลูกค้า และผู้ติดต่อ');
    expect(histLine({ at: 'x', actor: 'หมิว', u: 'pla', action: 'grant_del', detail: { role: 'head' }, note: '' }, nameOf, who)!.what).toBe('เอาบทบาทชั่วคราวออก: หัวหน้าฝ่ายขาย');
    expect(histLine({ at: 'x', actor: '', u: 'pla', action: 'grant_expired', detail: { role: 'head', until: '2026-10-09' }, note: '' }, nameOf, who)).toMatchObject({ what: 'บทบาทชั่วคราว หัวหน้าฝ่ายขาย ถึง 9 ต.ค. 2569', result: 'หมดอายุแล้ว', by: '' });
    for (const action of ['user_add', 'role_save', 'role_del', 'req_cancel']) expect(histLine({ at: 'x', actor: 'หมิว', u: 'pla', action, detail: { role: 'sales' }, note: '' }, nameOf, who)).toBeNull();
  });
});

describe('the Users page helpers', () => {
  const u = (x: string, role: string): TeamUser => ({ u: x, name: x.toUpperCase(), role, on: 1, mc: false, ll: '', c: '' });
  const dir: TeamDir = {
    users: [u('mew', 'admin'), u('ek', 'sales'), u('mk', 'sales'), u('pla', 'viewer')],
    roles: parseRoles({ head: { n: 'หัวหน้าฝ่ายขาย', c: {} } }),
    grants: { mk: { c: [{ k: 'view.comm', until: '2026-10-31' }, { k: 'del.rec', until: '2026-10-01' }] }, ek: { r: { id: 'head', until: '2027-01-31' } } },
    reqs: {},
    audit: [],
    v4: true,
  };
  it('members, people line, the role and extras that hold today', () => {
    expect(membersOf(dir, 'sales').map((x) => x.u)).toEqual(['ek', 'mk']);
    expect(peopleLine(dir, 'sales')).toBe('ใช้กับ 2 คน: EK, MK');
    expect(peopleLine(dir, 'head')).toBe('ยังไม่มีผู้ใช้');
    expect(effRole(dir, dir.users[1], '2026-10-15')).toBe('head');
    expect(effRole(dir, dir.users[1], '2027-02-01')).toBe('sales');
    expect(extrasOf(dir, 'mk', '2026-10-15').map((x) => x.k)).toEqual(['view.comm']);
    expect(roleOf(dir.roles, 'head').n).toBe('หัวหน้าฝ่ายขาย');
    expect(roleOf(dir.roles, 'gone')).toMatchObject({ id: 'gone', n: 'gone', c: {} });
    expect(roleOf([], 'viewer').n).toBe(BUILTIN.viewer.n);
    expect(userName(dir, 'pla')).toBe('PLA');
    expect(userName(dir, 'zz')).toBe('zz');
  });
});
