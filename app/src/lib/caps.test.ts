/** The capability catalogue, the built-in roles and the rules built on them (lib/caps.ts). */
import { describe, expect, it } from 'vitest';
import {
  ALL_CAPS, BUILTIN, CAP, CAPS, CAP_IDS, GROUPS, KNOWN_PREFIXES, LATE_CAPS, LOCKED_CAP, SERVER_ONLY, WRITE_CAPS, can, canWriteKey, capsOf, capsWire, closeNeeds, gained,
  hasWrite, keyRule, legacyRole, listWords, lost, needsChain, parseAudit, parseCaps, parseGrants, parseMyReq, parseReqs, parseRoles, resolveCaps, roleLine, roleWire,
  sameCaps, sameName, summarize, type CapId, type CapSet,
} from './caps';
import { canWriteKey as legacyWrite } from './auth';
import { keyOf, parseMe } from './teamSync';

const ids = (c: CapSet) => Object.keys(c).sort();
const HEAD: CapSet = { ...BUILTIN.sales.c, 'view.comm': 'all', 'edit.share': 'all', 'del.rec': 'all', 'del.log': 'all', 'qt.check': 'all' };
const ACCT: CapSet = Object.fromEntries((['view.sales', 'view.plan', 'view.money', 'view.cash', 'view.comm', 'docs.open', 'edit.pay', 'docs.up', 'qt.check', 'pay.check', 'notify.mail', 'set.units'] as CapId[]).map((k) => [k, 'all']));

describe('the catalogue', () => {
  it('has the 26 ids of the shared contract, unique, in their groups', () => {
    expect(CAP_IDS).toEqual([
      'view.sales', 'view.plan', 'view.money', 'view.cash', 'view.comm', 'view.exp', 'docs.open',
      'edit.cust', 'edit.deal', 'edit.task', 'edit.pay', 'edit.exp', 'docs.up', 'edit.ctag', 'edit.jqt', 'edit.share', 'del.rec', 'del.log',
      'qt.check', 'pay.check', 'notify.mail', 'set.lists', 'set.units', 'set.dedup', 'set.data', 'set.users',
    ]);
    expect(new Set(CAP_IDS).size).toBe(CAP_IDS.length);
    expect(CAPS.every((c) => GROUPS.some((g) => g.id === c.g))).toBe(true);
    expect(GROUPS.map((g) => g.title)).toEqual(['ดูได้', 'แก้ไขได้', 'เข้าถึงและจัดการ']);
  });
  it('every `needs` is a capability; the "ดู" labels start with ดู; three are real redaction', () => {
    CAPS.forEach((c) => c.needs && expect(CAP_IDS).toContain(c.needs));
    CAPS.filter((c) => c.id.startsWith('view.')).forEach((c) => expect(c.label.startsWith('ดู')).toBe(true));
    expect(CAPS.filter((c) => c.real).map((c) => c.id)).toEqual(['view.money', 'view.comm', 'view.exp']);
    expect(CAPS.filter((c) => c.scope).map((c) => c.id)).toEqual(['edit.deal', 'edit.pay', 'edit.exp', 'del.log']);
    // job expenses: who sees them and who records them are set apart in the role editor
    expect([CAP['view.exp'].g, CAP['view.exp'].label, CAP['view.exp'].needs]).toEqual(['v', 'ดูค่าใช้จ่ายและกำไรของงาน', 'view.money']);
    expect([CAP['edit.exp'].g, CAP['edit.exp'].label, CAP['edit.exp'].needs]).toEqual(['e', 'บันทึกค่าใช้จ่ายของงาน', 'view.exp']);
    expect(CAP['view.exp'].desc && CAP['edit.exp'].desc).toBeTruthy();
    expect(needsChain('edit.exp', {})).toEqual(['view.exp', 'view.money']);
    expect(CAP['pay.check'].needs).toBe('view.cash');
    expect(CAP['view.cash'].needs).toBe('view.money');
    expect(CAP['edit.share'].needs).toBe('view.comm');
  });
});

describe('built-in roles', () => {
  it('admin is everything; sales and viewer see money and Cashflow but not commission', () => {
    expect(sameCaps(BUILTIN.admin.c, ALL_CAPS)).toBe(true);
    expect(ids(BUILTIN.sales.c)).toEqual(['del.log', 'docs.open', 'docs.up', 'edit.ctag', 'edit.cust', 'edit.deal', 'edit.exp', 'edit.jqt', 'edit.pay', 'edit.task', 'notify.mail', 'view.cash', 'view.exp', 'view.money', 'view.plan', 'view.sales']);
    expect(BUILTIN.sales.c['del.log']).toBe('own');
    // job expenses: sales sees every deal's and records its own deals'; the viewer sees none
    expect([BUILTIN.sales.c['view.exp'], BUILTIN.sales.c['edit.exp']]).toEqual(['all', 'own']);
    expect([BUILTIN.viewer.c['view.exp'], BUILTIN.viewer.c['edit.exp']]).toEqual([undefined, undefined]);
    expect(ids(BUILTIN.viewer.c)).toEqual(['docs.open', 'view.cash', 'view.money', 'view.plan', 'view.sales']);
    for (const r of [BUILTIN.sales, BUILTIN.viewer]) {
      expect(r.c['view.comm']).toBeUndefined();
      expect(r.c[LOCKED_CAP]).toBeUndefined();
      expect(sameCaps(closeNeeds(r.c), r.c)).toBe(true); // nothing in them lacks what it needs
    }
  });
  it('reproduce what each role could write before (Code.gs v3), apart from the stricter deletes', () => {
    // today's script let sales delete any contact log and history row and write unknown record types;
    // the allow-list keeps contact logs for their writer (own), history rows for admins, and denies unknowns
    const keys = ['stage/1', 'owner/1', 'watch/1', 'task/t1', 'log/1/a', 'contact/1', 'dedup/x', 'deal/d1', 'dstep/d1/s1', 'ddoc/d1/x', 'dpay/d1/PAY1', 'dact/d1/a', 'dlog/a', 'scfg/sources', 'cust/1', 'person/p1', 'dundo/x', 'team/มด'];
    const stricter = new Set(['log/1/a|del', 'dlog/a|del', 'dact/d1/a|del']);
    for (const role of ['admin', 'sales', 'viewer'] as const)
      for (const k of keys)
        for (const del of [false, true]) {
          if (role === 'sales' && stricter.has(`${k}|${del ? 'del' : 'w'}`)) continue;
          // a deal-owned record of sales: the own scope isn't involved (sales has edit.deal / edit.pay for all)
          expect([role, k, del, canWriteKey(capsOf({ role }), k, del)]).toEqual([role, k, del, legacyWrite(role, k, del)]);
        }
    const sales = capsOf({ role: 'sales' });
    expect(canWriteKey(sales, 'log/1/a', true, true)).toBe(true); // its own contact log
    expect(canWriteKey(sales, 'log/1/a', true, false)).toBe(false);
    expect(canWriteKey(sales, 'dlog/a', true)).toBe(false);
  });
  it('summaries read as the screens say them', () => {
    expect(summarize(BUILTIN.viewer.c)).toBe('ดูได้ทุกหน้า รวมยอดเงินและ Cashflow แก้ไขไม่ได้');
    expect(summarize(BUILTIN.sales.c)).toBe('เพิ่มและแก้ลูกค้า ดีล นัดหมาย แผนชำระ และแนบเอกสาร บันทึกค่าใช้จ่ายของงานตัวเอง ลบได้เฉพาะบันทึกของตัวเอง');
    expect(summarize(BUILTIN.sales.c)).toBe(BUILTIN.sales.d);
    expect(summarize(ALL_CAPS)).toBe('ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้และสิทธิ์');
    expect(summarize(HEAD)).toBe('เพิ่มและแก้ลูกค้า ดีล นัดหมาย แผนชำระ และแนบเอกสาร บันทึกค่าใช้จ่ายของงานตัวเอง ลบดีล ลูกค้า และผู้ติดต่อได้ เห็นค่าคอมมิชชั่นและแบ่งสัดส่วนงาน ตรวจใบเสนอราคา');
    // a role that only records expenses, and one that only looks at them, still read as something
    expect(summarize({ 'view.money': 'all', 'view.exp': 'all', 'edit.exp': 'all' })).toBe('บันทึกค่าใช้จ่ายของงาน');
    expect(summarize({ ...BUILTIN.viewer.c, 'view.exp': 'all' })).toBe('ดูได้ทุกหน้า รวมยอดเงินและ Cashflow และค่าใช้จ่ายของงาน แก้ไขไม่ได้');
    expect(summarize(ACCT)).toBe('เพิ่มและแก้แผนชำระ และแนบเอกสาร เห็นค่าคอมมิชชั่น ตรวจใบเสนอราคา ตรวจยืนยันรับเงิน ตั้งค่าหน่วยงาน');
    expect(summarize({})).toBe('ยังไม่มีสิทธิ์ใดเลย นอกจากหน้าทะเบียนบริษัท');
    expect(summarize({ 'view.sales': 'all' })).toBe('ดู Sales Tracker และผู้ติดต่อ ไม่เห็นยอดเงิน แก้ไขไม่ได้');
    expect(roleLine({ d: '  ', c: BUILTIN.viewer.c })).toBe(summarize(BUILTIN.viewer.c));
    expect(roleLine({ d: 'ของเรา', c: {} })).toBe('ของเรา');
  });
});

describe('needs, scopes and resolving', () => {
  it('closeNeeds drops what lacks its prerequisite, down the chain', () => {
    expect(closeNeeds({ 'pay.check': 'all', 'view.money': 'all' })).toEqual({ 'view.money': 'all' });
    expect(closeNeeds({ 'pay.check': 'all', 'view.cash': 'all' })).toEqual({});
    expect(closeNeeds({ 'edit.share': 'all', 'view.comm': 'all' })).toEqual({});
    expect(closeNeeds({ 'set.units': 'all', 'view.comm': 'all', 'view.money': 'all' })).toEqual({ 'set.units': 'all', 'view.comm': 'all', 'view.money': 'all' });
    expect(needsChain('pay.check', {})).toEqual(['view.cash', 'view.money']);
    expect(needsChain('pay.check', { 'view.money': 'all' })).toEqual(['view.cash']);
    expect(needsChain('edit.cust', {})).toEqual([]);
  });
  it('parseCaps takes the map, a list of ids or of {k, s}; unknown ids and scopes are dropped', () => {
    expect(parseCaps({ 'view.sales': 1, 'del.log': 'own', 'edit.cust': 'all', 'zz.top': 1, 'view.plan': 0 })).toEqual({ 'view.sales': 'all', 'del.log': 'own', 'edit.cust': 'all' });
    expect(parseCaps(['view.sales', 'nope'])).toEqual({ 'view.sales': 'all' });
    expect(parseCaps([{ k: 'edit.deal', s: 'own' }, { k: 'view.money', s: 'own' }])).toEqual({ 'edit.deal': 'own', 'view.money': 'all' });
    expect(parseCaps(null)).toBeNull();
    expect(parseCaps('x')).toBeNull();
    expect(capsWire({ 'del.log': 'own', 'view.sales': 'all', 'edit.cust': undefined })).toEqual({ 'del.log': 'own', 'view.sales': 1 });
    // role_save names the job-expense capabilities, 0 when off (the script keeps them for a save that does not)
    expect(roleWire({ 'view.sales': 'all' })).toEqual({ 'view.sales': 1, 'view.exp': 0, 'edit.exp': 0 });
    expect(roleWire(BUILTIN.sales.c)).toMatchObject({ 'view.exp': 1, 'edit.exp': 'own' });
  });
  it('resolveCaps: the role, unexpired extras (until is inclusive), a temporary role; admin everything, unknown nothing', () => {
    const roles = { sales: BUILTIN.sales.c, viewer: BUILTIN.viewer.c, head: HEAD };
    expect(resolveCaps('admin', roles, undefined, '2026-10-15')).toEqual(ALL_CAPS);
    expect(resolveCaps('gone', roles, undefined, '2026-10-15')).toEqual({});
    const g = { c: [{ k: 'view.comm', s: 'all' as const, until: '2026-10-31' }, { k: 'set.users' }, { k: 'del.rec', until: '2026-10-01' }] };
    const before = resolveCaps('sales', roles, g, '2026-10-31');
    expect(before['view.comm']).toBe('all');
    expect(before['del.rec']).toBeUndefined();
    expect(before[LOCKED_CAP]).toBeUndefined(); // never as an extra
    expect(resolveCaps('sales', roles, g, '2026-11-01')['view.comm']).toBeUndefined();
    // a temporary role while it lasts, then back to the account's own
    const t = { r: { id: 'head', until: '2027-01-31' } };
    expect(sameCaps(resolveCaps('sales', roles, t, '2027-01-31'), HEAD)).toBe(true);
    expect(sameCaps(resolveCaps('sales', roles, t, '2027-02-01'), BUILTIN.sales.c)).toBe(true);
    // never narrows an admin (a request left over from before the account was made one)
    expect(resolveCaps('admin', roles, { r: { id: 'viewer', until: '2027-01-31' } }, '2026-10-15')).toEqual(ALL_CAPS);
    // an extra whose prerequisite is missing does nothing
    expect(resolveCaps('viewer', roles, { c: [{ k: 'edit.share' }] }, '2026-10-15')['edit.share']).toBeUndefined();
    // an own extra on a role holding it for all stays all
    expect(resolveCaps('head', roles, { c: [{ k: 'del.log', s: 'own' }] }, '2026-10-15')['del.log']).toBe('all');
  });
  it('capsOf: the script\'s me.caps; without them the built-in caps of me.role (the deployed script) less job expenses; unknown role nothing', () => {
    expect(capsOf(null)).toBeNull();
    const less = (c: CapSet) => Object.fromEntries(Object.entries(c).filter(([k]) => !LATE_CAPS.includes(k as CapId)));
    expect(LATE_CAPS).toEqual(['view.exp', 'edit.exp']);
    // a script before capabilities neither hides nor guards job expenses: no account gets them from it
    expect(capsOf({ role: 'sales' })).toEqual(less(BUILTIN.sales.c));
    expect(capsOf({ role: 'viewer' })).toEqual(BUILTIN.viewer.c);
    expect(capsOf({ role: 'admin' })).toEqual(less(ALL_CAPS));
    expect(capsOf({ role: 'admin' })!['view.exp']).toBeUndefined();
    // a script with capabilities but none for expenses (the one before them): no access either
    expect(capsOf({ role: 'admin', caps: capsOf({ role: 'admin' }) })!['edit.exp']).toBeUndefined();
    // this one: what it says
    expect(capsOf({ role: 'sales', caps: { 'view.money': 'all', 'view.exp': 'all', 'edit.exp': 'own' } })).toEqual({ 'view.money': 'all', 'view.exp': 'all', 'edit.exp': 'own' });
    expect(capsOf({ role: 'sales', caps: { 'view.money': 'all', 'edit.exp': 'all' } })).toEqual({ 'view.money': 'all' });
    expect(capsOf({ role: 'acct' })).toEqual({});
    expect(capsOf({ role: 'sales', caps: { 'view.sales': 'all', 'pay.check': 'all' } })).toEqual({ 'view.sales': 'all' });
  });
  it('can: any scope without an owner; own only for one\'s own; null caps = no accounts', () => {
    const c: CapSet = { 'edit.deal': 'own', 'view.sales': 'all' };
    expect(can(c, 'edit.deal')).toBe(true);
    expect(can(c, 'edit.deal', true)).toBe(true);
    expect(can(c, 'edit.deal', false)).toBe(false);
    expect(can(c, 'view.sales', false)).toBe(true);
    expect(can(c, 'del.rec')).toBe(false);
    expect(can(null, 'set.users')).toBe(true);
    expect(sameName(' คุณ  เอ ', 'คุณ เอ')).toBe(true);
    expect(sameName('Mew', 'mew')).toBe(true);
    expect(sameName('', '')).toBe(false);
  });
  it('hasWrite and the legacy role word', () => {
    expect(hasWrite(BUILTIN.viewer.c)).toBe(false);
    expect(hasWrite({ 'pay.check': 'all' })).toBe(true);
    expect(hasWrite({ 'qt.check': 'all', 'notify.mail': 'all' })).toBe(false);
    expect(hasWrite(null)).toBe(true);
    expect(legacyRole(ALL_CAPS)).toBe('admin');
    expect(legacyRole(ACCT)).toBe('sales');
    expect(legacyRole(BUILTIN.viewer.c)).toBe('viewer');
    expect(WRITE_CAPS).not.toContain('qt.check');
  });
});

describe('the allow-list (KEY_CAP)', () => {
  it('covers every record the app writes and the other packages\' prefixes', () => {
    const app = [keyOf.stage(1), keyOf.owner(1), keyOf.watch(1), keyOf.team('x'), keyOf.task('t'), keyOf.log(1, 'a'), keyOf.contact(1), keyOf.dedup('k'), keyOf.deal('d'), keyOf.dstep('d', 's'), keyOf.ddoc('d', 'x'), keyOf.dpay('d', 'P'), keyOf.dact('d', 'a'), keyOf.dlog('l'), keyOf.scfg('stages'), keyOf.cust(1), keyOf.person('p'), keyOf.dundo('d')];
    const other = ['jqt/h', 'jqm/h/d', 'dshare/d', 'ccol/k', 'qchk/doc', 'dchk/d/PAY1', 'mclose/2026-10', 'ctag/k', 'scfg/unit.a', 'scfg/unitm.ฝน', 'scfg/notify.cfg', 'scfg/paychk.cfg', 'scfg/ct.cfo', 'scfg/cc.k',
      keyOf.dexp('d', 'e1'), keyOf.dlogExp('l1'), keyOf.dchkExp('d', 'e1'), keyOf.mcloseOut('2026-10')];
    for (const k of [...app, ...other]) {
      expect([k, keyRule(k, false)]).not.toEqual([k, null]);
      expect(KNOWN_PREFIXES).toContain(k.slice(0, k.indexOf('/') + 1));
    }
    expect(keyRule('zzz/1', false)).toBeNull();
  });
  it('maps each prefix to its capability, for writes and deletes', () => {
    const only = (k: CapId): CapSet => ({ [k]: 'all' });
    const W: [string, CapId, CapId][] = [
      ['stage/1', 'edit.cust', 'edit.cust'], ['cust/1', 'edit.cust', 'del.rec'], ['person/p', 'edit.cust', 'del.rec'], ['task/t', 'edit.task', 'edit.task'],
      ['deal/d', 'edit.deal', 'del.rec'], ['dstep/d/s', 'edit.deal', 'edit.deal'], ['ddoc/d/x', 'docs.up', 'docs.up'], ['dpay/d/P', 'edit.pay', 'edit.pay'],
      ['ctag/k', 'edit.ctag', 'edit.ctag'], ['jqt/h', 'edit.jqt', 'del.rec'], ['jqm/h/d', 'edit.jqt', 'edit.jqt'], ['dshare/d', 'edit.share', 'edit.share'],
      ['ccol/k', 'edit.cust', 'edit.cust'], ['dchk/d/PAY1', 'pay.check', 'pay.check'], ['mclose/2026-10', 'pay.check', 'pay.check'],
      ['dexp/d/e1', 'edit.exp', 'edit.exp'], ['dchk/d/exp.e1', 'pay.check', 'pay.check'], ['mclose/2026-10/out', 'pay.check', 'pay.check'],
      ['scfg/paychk.cfg', 'set.users', 'set.users'], ['scfg/stages', 'set.lists', 'set.lists'], ['scfg/ct.cfo', 'set.lists', 'set.lists'], ['scfg/cc.k', 'set.lists', 'set.lists'],
      ['scfg/unit.a', 'set.units', 'set.units'], ['scfg/unitm.ฝน', 'set.units', 'set.units'], ['scfg/notify.cfg', 'set.users', 'set.users'],
      ['dedup/k', 'set.dedup', 'set.dedup'], ['team/x', 'set.users', 'set.users'], ['dundo/d', 'set.data', 'set.data'],
    ];
    for (const [k, w, d] of W) {
      expect([k, 'w', canWriteKey(only(w), k, false, true)]).toEqual([k, 'w', true]);
      expect([k, 'd', canWriteKey(only(d), k, true, true)]).toEqual([k, 'd', true]);
      const notW = CAP_IDS.filter((x) => x !== w && x !== LOCKED_CAP);
      expect([k, 'w-other', notW.some((x) => canWriteKey(only(x), k, false, true))]).toEqual([k, 'w-other', false]);
    }
  });
  it('history rows: any money or deal writer may add them; deleting them is the admins\'', () => {
    for (const c of ['edit.deal', 'edit.pay', 'docs.up', 'edit.jqt', 'edit.share', 'pay.check'] as CapId[]) expect(canWriteKey({ [c]: 'all' }, 'dlog/x', false)).toBe(true);
    expect(canWriteKey({ 'edit.cust': 'all' }, 'dlog/x', false)).toBe(false);
    expect(canWriteKey({ ...BUILTIN.sales.c }, 'dlog/x', true)).toBe(false);
    expect(canWriteKey(ALL_CAPS, 'dlog/x', true)).toBe(true);
    // the history of the expenses: whoever records them, and accounting (checks); nobody else
    for (const c of ['edit.exp', 'pay.check'] as CapId[]) expect(canWriteKey({ [c]: 'all' }, 'dlog/exp.x', false)).toBe(true);
    for (const c of ['edit.deal', 'edit.pay', 'docs.up', 'edit.jqt', 'edit.share'] as CapId[]) expect(canWriteKey({ [c]: 'all' }, 'dlog/exp.x', false)).toBe(false);
    expect(canWriteKey({ 'edit.exp': 'own' }, 'dlog/exp.x', false)).toBe(true);
    expect(canWriteKey({ ...BUILTIN.sales.c }, 'dlog/exp.x', true)).toBe(false);
  });
  it('qchk/ never by a push, not even an admin; unknown prefixes only for whoever manages users', () => {
    expect(SERVER_ONLY).toEqual(['qchk/']);
    for (const del of [false, true]) {
      expect(canWriteKey(ALL_CAPS, 'qchk/doc', del)).toBe(false);
      expect(canWriteKey(ALL_CAPS, 'zzz/1', del)).toBe(true);
      expect(canWriteKey({ ...ALL_CAPS, [LOCKED_CAP]: undefined }, 'zzz/1', del)).toBe(false);
    }
    expect(canWriteKey(null, 'qchk/doc', false)).toBe(true); // no accounts: the script has no rule to apply
  });
  it('own scope: deals by ผู้รับผิดชอบ, contact records by who wrote them', () => {
    const own: CapSet = { 'edit.deal': 'own', 'edit.pay': 'own', 'del.log': 'own', 'view.money': 'all' };
    expect(canWriteKey(own, 'deal/d', false, true)).toBe(true);
    expect(canWriteKey(own, 'deal/d', false, false)).toBe(false);
    expect(canWriteKey(own, 'dpay/d/P', true, false)).toBe(false);
    expect(canWriteKey(own, 'dact/d/a', false, true)).toBe(true);
    expect(canWriteKey(own, 'dact/d/a', true, false)).toBe(false);
    expect(canWriteKey(own, 'log/1/a', true)).toBe(false); // not known: counted as not its own
    // an expense is the deal's: its ผู้รับผิดชอบ, to write and to delete (as a payment line)
    expect(keyRule('dexp/d/e1', false)).toEqual({ caps: ['edit.exp'], own: 'resp' });
    expect(keyRule('dexp/d/e1', true)).toEqual({ caps: ['edit.exp'], own: 'resp' });
    const sales = { ...BUILTIN.sales.c };
    expect([canWriteKey(sales, 'dexp/d/e1', false, true), canWriteKey(sales, 'dexp/d/e1', false, false), canWriteKey(sales, 'dexp/d/e1', true, false)]).toEqual([true, false, false]);
    expect(canWriteKey(BUILTIN.viewer.c, 'dexp/d/e1', false, true)).toBe(false);
  });
});

describe('words', () => {
  it('what a role adds over another (request cards, role mode of the request dialog)', () => {
    expect(gained(BUILTIN.sales.c, HEAD)).toEqual(['ดูค่าคอมมิชชั่น / สัดส่วนรายได้', 'แก้สัดส่วน % ของงาน', 'ลบดีล ลูกค้า และผู้ติดต่อ', 'ลบบันทึกการติดต่อของทุกคน', 'ตรวจ/อนุมัติใบเสนอราคา']);
    expect(lost(BUILTIN.sales.c, ACCT)).toEqual(['ดูค่าใช้จ่ายและกำไรของงาน', 'แก้ไขลูกค้าและผู้ติดต่อ', 'แก้ไขดีลและขั้นตอน', 'แก้ไขนัดหมาย', 'บันทึกค่าใช้จ่ายของงาน', 'ติดประเภทลูกค้า', 'สร้างใบเสนอราคาร่วม', 'ลบบันทึกการติดต่อ']);
    expect(gained(BUILTIN.viewer.c, { ...BUILTIN.viewer.c, 'view.exp': 'all', 'edit.exp': 'own' })).toEqual(['ดูค่าใช้จ่ายและกำไรของงาน', 'บันทึกค่าใช้จ่ายของงาน (เฉพาะงานของตัวเอง)']);
    // a scope narrowed to own work is lost too: other people's deals and payment plans
    const ownOnly: CapSet = { ...BUILTIN.sales.c, 'edit.deal': 'own', 'edit.pay': 'own' };
    expect(lost(BUILTIN.sales.c, ownOnly)).toEqual(['แก้ไขดีลและขั้นตอนของคนอื่น', 'แก้ไขแผนชำระเงินและการรับเงินของคนอื่น']);
    expect(gained(ownOnly, BUILTIN.sales.c)).toEqual(['แก้ไขดีลและขั้นตอนของทุกคน', 'แก้ไขแผนชำระเงินและการรับเงินของทุกคน']);
    expect(gained(BUILTIN.viewer.c, { ...BUILTIN.viewer.c, 'edit.deal': 'own' })).toEqual(['แก้ไขดีลและขั้นตอน (เฉพาะงานของตัวเอง)']);
    expect(listWords(['a', 'b', 'c', 'd', 'e'])).toBe('a · b · c และอีก 2 รายการ');
    expect(listWords(['a', 'b'])).toBe('a · b');
  });
});

describe('what the script sends', () => {
  it('me.req: a pending request or an unread result', () => {
    expect(parseMyReq({ id: 'r1', k: 'role', role: 'head', note: 'x', until: '2027-01-31T00:00:00Z', at: '2026-10-12T02:40:00Z' })).toEqual({ st: 'p', id: 'r1', k: 'role', role: 'head', note: 'x', until: '2027-01-31', at: '2026-10-12T02:40:00Z' });
    expect(parseMyReq({ ok: true, by: 'หมิว', note: 'ok', at: 'a', role: 'head' })).toMatchObject({ st: 'r', ok: true, by: 'หมิว', role: 'head' });
    expect(parseMyReq({ st: 'r', ok: 0, by: 'หมิว', note: '', at: 'a', caps: [{ k: 'edit.pay', s: 'all' }] })).toMatchObject({ st: 'r', ok: false, caps: [{ k: 'edit.pay', s: 'all' }] });
    expect(parseMyReq({ k: 'caps', caps: ['docs.up', 'bad'], note: 'n', at: 'a' })).toMatchObject({ st: 'p', k: 'caps', caps: [{ k: 'docs.up', s: 'all' }] });
    expect(parseMyReq(null)).toBeNull();
    expect(parseMyReq({ nothing: 1 })).toBeNull();
  });
  it('roles: the built-ins always (admin always everything), custom ones after them, set.users never on another role', () => {
    expect(parseRoles(null).map((r) => r.id)).toEqual(['admin', 'sales', 'viewer']);
    const r = parseRoles({ v: 1, roles: { acct: { n: 'บัญชี/การเงิน', d: '', c: { 'edit.pay': 1, 'view.money': 1, 'set.users': 1 }, o: 4 }, head: { n: 'หัวหน้าฝ่ายขาย', c: { 'view.sales': 1 }, o: 3 }, admin: { n: 'x', c: {} }, sales: { n: 'ฝ่ายขาย', c: { 'view.sales': 1 } } } });
    expect(r.map((x) => x.id)).toEqual(['admin', 'sales', 'viewer', 'head', 'acct']);
    expect(r[0].c).toEqual(ALL_CAPS);
    expect(r[0].n).toBe('ผู้ดูแลระบบ');
    expect(r[1].n).toBe('ฝ่ายขาย');
    expect(r[1].builtin).toBe(true);
    expect(r[4].c).toEqual({ 'edit.pay': 'all', 'view.money': 'all' });
    expect(parseRoles({ head: { n: 'h', c: {} } }).map((x) => x.id)).toEqual(['admin', 'sales', 'viewer', 'head']);
  });
  it('grants, requests and the audit trail', () => {
    expect(parseGrants({ mk: { c: [{ k: 'view.comm', until: '2026-10-31', by: 'mew', at: 'a' }, { k: 'zz' }], r: { id: 'head', until: '2027-01-31' } }, bad: 1 })).toEqual({
      mk: { r: { id: 'head', until: '2027-01-31', by: '', at: '' }, c: [{ k: 'view.comm', s: 'all', until: '2026-10-31', by: 'mew', at: 'a' }] },
    });
    expect(parseReqs({ ek: { id: '1', k: 'role', role: 'head', note: 'n', at: 'a' }, x: null })).toEqual({ ek: { id: '1', k: 'role', role: 'head', note: 'n', at: 'a' } });
    const a = parseAudit([{ at: '2026-10-01', actor: 'mew', u: 'ek', action: 'req_decide', detail: '{"ok":true}', note: '' }, { at: '2026-10-05', actor: 'ton', u: 'pla', action: 'grant_expire', detail: { k: 'edit.task' }, note: '' }, 7]);
    expect(a.map((x) => x.at)).toEqual(['2026-10-05', '2026-10-01']);
    expect(a[1].detail).toEqual({ ok: true });
  });
});

describe('me as the team script sends it', () => {
  it('a script with capabilities leaves out a request or extras the account does not have: none (not "as before")', () => {
    expect(parseMe({ u: 'ek', role: 'sales', caps: { 'view.sales': 1 } })).toMatchObject({ caps: { 'view.sales': 'all' }, req: null, g: {} });
    expect(parseMe({ u: 'ek', caps: {}, req: { st: 'p', id: 'q', k: 'caps', caps: [{ k: 'view.comm', s: 'all' }], note: 'x', at: 'a' }, grants: { r: { id: 'head', until: '2026-10-20', by: 'หมิว', at: 'a' } } })).toMatchObject({
      req: { st: 'p', k: 'caps' }, g: { r: { id: 'head', until: '2026-10-20' } },
    });
    // a script before capabilities: nothing is said about them (capsOf falls back to the role)
    const old = parseMe({ u: 'ek', name: 'เอก', role: 'sales' });
    expect('req' in old || 'g' in old || 'caps' in old).toBe(false);
  });
});
