import { describe, expect, it } from 'vitest';
import { emptySales, newDeal, toPay, type Deal, type DealDoc, type SalesState } from './sales';
import {
  bellItems, checkedLine, dayTh, docById, fpOf, needsCheck, parseGo, parseMyNotify, parseNotifyCfg, parseNotifyFlag, parseNotifyStatus, qtCheckOf, sameFp,
  toQtCheck, unmatchedNames, waitingChecks, wantsLine, whenTh, NOTIFY_CFG0, type BellIn, type QtCheck,
} from './notify';
import { applyRow, localRecords, noEffects, parseMe, type SharedState } from './teamSync';
import { BUILTIN, type CapSet } from './caps';
import { dmTh } from './format';
import type { Task } from './types';

const TODAY = '2026-10-12';
const SINCE = '2026-10-01';
const ADMIN: CapSet = BUILTIN.admin.c, SALES: CapSet = BUILTIN.sales.c, VIEWER: CapSet = BUILTIN.viewer.c;

function deal(s: SalesState, id: string, client: string, resp: string, more: Partial<Deal> = {}) {
  const d = newDeal({ id, client, section: 'TGO', year: '2569', resp, ...more }, 'หมิว', '2026-09-01T00:00:00.000Z');
  s.deals[id] = d;
  return d;
}
function qt(s: SalesState, dealId: string, id: string, x: Partial<DealDoc> = {}): DealDoc {
  const doc: DealDoc = {
    id, deal: dealId, kind: 'quotation', name: id + '.pdf', mime: 'application/pdf', size: 37000, fileId: 'f-' + id, docNo: 'QT-' + id, docDate: '2026-10-12',
    amount: 101650, target: 'forecast', detected: 101650, basis: 'total', stage: 'QUOTATION', at: '2026-10-12T02:40:00.000Z', cAt: '2026-10-12T02:40:00.000Z', by: 'เอก', ...x,
  };
  s.docs[`${dealId}/${id}`] = doc;
  return doc;
}
const rec = (doc: DealDoc, st: QtCheck['st'], by = 'หมิว', at = '2026-10-12T03:02:00.000Z', note?: string): QtCheck => ({ st, by, at, fp: fpOf(doc), ...(note ? { note } : {}) });

describe('the check record and its fingerprint', () => {
  it('fpOf takes amount, number, date and the file (name|size), never the Drive id', () => {
    const s = emptySales();
    deal(s, 'd1', 'ดูราฟลอร์', 'คุณเอ');
    const doc = qt(s, 'd1', 'q1', { docNo: 'QT-2569-021' });
    expect(fpOf(doc)).toEqual({ a: 101650, n: 'QT-2569-021', d: '2026-10-12', f: 'q1.pdf|37000' });
    expect(fpOf({ ...doc, fileId: 'other' } as DealDoc)).toEqual(fpOf(doc));
    expect(sameFp(fpOf(doc), { ...fpOf(doc), a: 101650.001 })).toBe(true);
    expect(sameFp(fpOf(doc), { ...fpOf(doc), a: 101651 })).toBe(false);
    // a hidden amount (an account without ดูยอดเงิน) matches a hidden amount only
    expect(sameFp({ ...fpOf(doc), a: null }, { ...fpOf(doc), a: null })).toBe(true);
    expect(sameFp({ ...fpOf(doc), a: null }, fpOf(doc))).toBe(false);
  });

  it('qtCheckOf: no record waits; a matching one holds; an edit, a file swap or a new date makes it stale (waiting again)', () => {
    const s = emptySales();
    deal(s, 'd1', 'ดูราฟลอร์', 'คุณเอ');
    const doc = qt(s, 'd1', 'q1');
    expect(qtCheckOf(undefined, doc)).toEqual({ status: 'wait', rec: null, stale: null });
    const ok = rec(doc, 'ok');
    expect(qtCheckOf(ok, doc)).toMatchObject({ status: 'ok', rec: ok, stale: null });
    const back = rec(doc, 'back', 'มินท์', undefined, 'เลขที่ซ้ำ');
    expect(qtCheckOf(back, doc)).toMatchObject({ status: 'back', rec: { note: 'เลขที่ซ้ำ' } });
    for (const edit of [{ amount: 95000 }, { docNo: 'QT-2' }, { docDate: '2026-10-13' }, { name: 'signed.pdf' }, { size: 38000 }])
      expect(qtCheckOf(ok, { ...doc, ...edit })).toEqual({ status: 'wait', rec: null, stale: ok });
    // nothing is written on a reset: the same record holds again once the values are back
    expect(qtCheckOf(ok, { ...doc }).status).toBe('ok');
    expect(checkedLine(ok)).toBe('หมิว ' + dmTh('2026-10-12'));
  });

  it('toQtCheck reads what the script wrote and skips anything else', () => {
    expect(toQtCheck(null)).toBeNull();
    expect(toQtCheck({ st: 'maybe' })).toBeNull();
    expect(toQtCheck({ st: 'ok', by: 'หมิว', at: 'x', fp: { a: '101650', n: 'QT', d: '2026-10-12', f: 'a|1' }, via: 'mail', u: 'mew' })).toEqual({
      st: 'ok', by: 'หมิว', at: 'x', fp: { a: 101650, n: 'QT', d: '2026-10-12', f: 'a|1' }, via: 'mail', u: 'mew',
    });
    expect(toQtCheck({ st: 'back', note: '  ', fp: null })).toEqual({ st: 'back', by: '', at: '', fp: { a: null, n: '', d: '', f: '' } });
  });

  it('needsCheck: quotations for the Forecast at QUOTATION, on open deals, attached on or after the start day', () => {
    const s = emptySales();
    deal(s, 'd1', 'ดูราฟลอร์', 'คุณเอ');
    deal(s, 'd2', 'ไทยออยล์', 'คุณเอ', { jobStatus: 'closed' });
    const cur = qt(s, 'd1', 'q2');
    const old = qt(s, 'd1', 'q1', { target: 'none', at: '2026-10-05T00:00:00.000Z', cAt: '2026-10-13T00:00:00.000Z' });
    const before = qt(s, 'd1', 'q0', { at: '2026-09-20T00:00:00.000Z', cAt: '2026-09-20T00:00:00.000Z' });
    const closed = qt(s, 'd2', 'q3');
    const inv = qt(s, 'd1', 'i1', { kind: 'invoice', stage: 'PAY1', target: 'actual' });
    const noAmt = qt(s, 'd1', 'q4', { amount: null, target: 'none' });
    expect([cur, old, before, closed, inv, noAmt].map((d) => needsCheck(s, d, SINCE))).toEqual([true, false, false, false, false, false]);
    // without a start day (the script did not say) every open quotation is in the check
    expect(needsCheck(s, before, '')).toBe(true);
    expect(docById(s, 'q3')).toBe(closed);
  });
});

describe('what the script and the team say', () => {
  it('parseNotifyFlag: 0|1|boolean or {on, since}; a person\'s settings or nothing is not a flag', () => {
    expect(parseNotifyFlag(1)).toEqual({ on: true, since: '' });
    expect(parseNotifyFlag(0)).toEqual({ on: false, since: '' });
    expect(parseNotifyFlag({ on: 1, since: '2026-10-01T00:00:00Z' })).toEqual({ on: true, since: '2026-10-01' });
    expect(parseNotifyFlag({ on: false })).toEqual({ on: false, since: '' });
    expect(parseNotifyFlag(undefined)).toBeNull();
    expect(parseNotifyFlag({ em: 'a@example.com', on: { qt: 1 } })).toBeNull();
  });

  it('parseNotifyCfg fills the defaults and keeps values in range', () => {
    expect(parseNotifyCfg(null)).toEqual(NOTIFY_CFG0);
    expect(parseNotifyCfg({ pre: 3, late: 'mon', appt: 'today', self: true, sender: ' ทีมขาย ', site: 'https://example.com/app/' })).toEqual({
      pre: 3, late: 'mon', appt: 'today', self: true, sender: 'ทีมขาย', site: 'https://example.com/app/',
    });
    expect(parseNotifyCfg({ pre: 99, late: 'x', appt: 'x', self: 'yes', sender: '', site: 'javascript:alert(1)' })).toEqual(NOTIFY_CFG0);
  });

  it('parseMyNotify: the account\'s own settings, defaults per switch; scope team for admins by default', () => {
    expect(parseMyNotify(null)).toBeNull();
    expect(parseMyNotify({ em: 'mew@example.com', ok: 1, on: { qt: 0, dg: 1 }, t: '08:00', sc: 'mine' })).toEqual({
      em: 'mew@example.com', ok: true, on: { qt: false, res: true, dg: true, pre: false }, t: '08:00', sc: 'mine',
    });
    expect(parseMyNotify({ t: '07:45' }, true)).toMatchObject({ t: '07:30', sc: 'team', ok: false });
    expect(wantsLine(parseMyNotify({ on: { qt: 1, res: 0, dg: 1 }, sc: 'team' })!, true)).toBe('รอตรวจ · สรุปทั้งทีม');
    expect(wantsLine(parseMyNotify({ on: { qt: 1, res: 1, dg: 1 }, sc: 'mine' })!, false)).toBe('ผลตรวจ · สรุป');
    expect(wantsLine(parseMyNotify({ on: { qt: 0, res: 0, dg: 0, pre: 0 } })!, true)).toBe('ปิดอีเมลทั้งหมด');
  });

  it('parseNotifyStatus reads every part it can, and nothing more', () => {
    const st = parseNotifyStatus({ on: 1, since: '2026-10-01', last: { at: '2026-10-12T03:00:00Z', ok: true, sent: 3 }, quota: { sent: 14, left: 86 }, from: 'owner@example.com', users: { mew: { em: 'mew@example.com', ok: 1, t: '07:30' }, bad: 3 } });
    expect(st).toMatchObject({ on: true, since: '2026-10-01', last: { ok: true, sent: 3 }, sent: 14, left: 86, from: 'owner@example.com' });
    expect(Object.keys(st.users)).toEqual(['mew']);
    expect(parseNotifyStatus({})).toMatchObject({ on: false, last: null, sent: null, left: null, users: {} });
    expect(parseNotifyStatus({ notify: { on: 1, since: '2026-10-02' }, quotaLeft: 5 })).toMatchObject({ on: true, since: '2026-10-02', left: 5 });
  });

  it('a pulled qchk/ row and scfg/notify.cfg land in the sales state (and are never uploaded from here); me.notify in the session', () => {
    const s: SharedState = { crm: { stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} }, contacts: {}, dec: {}, sales: emptySales(), custom: {} };
    const fx = noEffects();
    applyRow(s, { seq: 1, k: 'qchk/q1', v: { st: 'ok', by: 'หมิว', at: 'x', fp: { a: 1, n: '', d: '', f: 'a|1' } }, del: false, by: 'หมิว', at: '' }, fx);
    applyRow(s, { seq: 2, k: 'qchk/q2', v: { st: 'bad' }, del: false, by: 'x', at: '' }, fx);
    applyRow(s, { seq: 3, k: 'scfg/notify.cfg', v: { pre: 3 }, del: false, by: 'หมิว', at: '' }, fx);
    expect(fx.sales).toBe(true);
    expect(Object.keys(s.sales.qchk!)).toEqual(['q1']);
    expect(s.sales.ncfg).toMatchObject({ pre: 3, late: 'daily' });
    expect(s.sales.cfg.stages.length).toBeGreaterThan(0); // the lists are untouched
    applyRow(s, { seq: 4, k: 'qchk/q1', v: null, del: true, by: 'หมิว', at: '' }, fx);
    expect(s.sales.qchk).toEqual({});
    s.sales.qchk = { q9: toQtCheck({ st: 'ok', fp: {} })! };
    expect([...localRecords(s).keys()].some((k) => k.startsWith('qchk/') || k === 'scfg/notify.cfg')).toBe(false);
    expect(parseMe({ u: 'mew', notify: { em: 'mew@example.com', ok: 1 } }).nf).toMatchObject({ em: 'mew@example.com', ok: true });
    expect('nf' in parseMe({ u: 'mew' })).toBe(false);
  });
});

describe('the bell', () => {
  /** หมิว (admin, checker), เอก and มกร (sales), deals of คุณเอ / เอก / มกร, plan tasks. */
  function team() {
    const s = emptySales();
    const a = deal(s, 'dA', 'บริษัท ดูราฟลอร์ จำกัด', 'คุณเอ');
    deal(s, 'dB', 'บริษัท ดีไวน์สตาร์ช จำกัด', 'มกร');
    const c = deal(s, 'dC', 'บริษัท ไทยออยล์ เอนเนอร์ยี่ จำกัด', 'เอก');
    const e = deal(s, 'dE', 'บริษัท เบทาโกร ฟู้ด จำกัด', 'มกร');
    const q1 = qt(s, 'dA', 'q1', { by: 'เอก', at: '2026-10-12T02:40:00.000Z', cAt: '2026-10-12T02:40:00.000Z' });
    const q2 = qt(s, 'dB', 'q2', { by: 'มกร', amount: 64200, at: '2026-10-10T02:40:00.000Z', cAt: '2026-10-10T02:40:00.000Z' });
    const q3 = qt(s, 'dC', 'q3', { by: 'เอก', at: '2026-10-08T02:40:00.000Z', cAt: '2026-10-08T02:40:00.000Z' });
    const mine = qt(s, 'dE', 'q4', { by: 'หมิว', at: '2026-10-11T02:40:00.000Z', cAt: '2026-10-11T02:40:00.000Z' });
    // won deals with instalments: one late, one due soon, one far off, one paid
    for (const [d, due, extra] of [[c, '2026-10-08', {}], [e, '2026-10-15', {}], [a, '2026-12-01', {}]] as const) {
      s.steps[`${d.id}/CLOSED DEAL`] = { d: '2026-09-15', n: 'YES' };
      s.pays[`${d.id}/PAY1`] = toPay({ amt: d.id === 'dC' ? 80250 : 49000, due, ...extra })!;
    }
    s.pays['dE/PAY2'] = toPay({ amt: 1000, due: '2026-10-01', rcv: '2026-10-02' })!;
    const checks: Record<string, QtCheck> = { q3: rec(q3, 'ok', 'มินท์', '2026-10-08T05:00:00.000Z'), q2: rec(q2, 'back', 'หมิว', '2026-10-11T05:00:00.000Z', 'เลขที่ซ้ำ') };
    // q2 was edited after it was sent back: waiting again
    s.docs['dB/q2'] = { ...q2, docNo: 'QT-2569-020' };
    const tasks: Task[] = [
      { id: 't1', gid: 11, title: '', type: 'email', date: TODAY, time: '', note: 'ส่งเอกสารจัดซื้อ', done: false },
      { id: 't2', gid: 11, title: '', type: 'call', date: '2026-10-09', time: '14:00', note: 'โทรตามใบเสนอราคา', done: false },
      { id: 't3', gid: 12, title: 'ฝาจีบ', type: 'call', date: '2026-10-08', time: '10:30', note: '', done: false },
      { id: 't4', gid: 12, title: '', type: 'call', date: '2026-10-08', time: '', note: 'ทำแล้ว', done: true },
      { id: 't5', gid: 12, title: '', type: 'meet', date: '2026-10-13', time: '', note: 'พรุ่งนี้', done: false },
    ];
    const owners: Record<string, string> = { 11: 'คุณบี', 12: 'มกร' };
    const base: BellIn = {
      S: s, tasks, owners, coName: (gid) => ({ 11: 'บริษัท ซากิโนมิยะ ประเทศไทย จำกัด', 12: '' })[gid] || '', me: 'หมิว', caps: ADMIN, live: { on: true, since: SINCE }, checks, cfg: NOTIFY_CFG0, scope: 'team', today: TODAY,
    };
    return { s, base, q1, q2, q3, mine, checks };
  }

  it('a checker (team scope): รอตรวจ newest first without their own, งวดเงิน late and due soon, นัดหมาย late first; the count', () => {
    const { base } = team();
    const r = bellItems(base);
    expect(r.groups.map((g) => [g.kind, g.title, g.n])).toEqual([['chk', 'รอตรวจ', 2], ['pay', 'งวดเงิน', 2], ['appt', 'นัดหมาย', 3]]);
    expect(r.count).toBe(7);
    const [chk, pay, appt] = r.groups;
    expect(chk.rows.map((x) => x.go)).toEqual([{ deal: 'dA', doc: 'q1' }, { deal: 'dB', doc: 'q2' }]);
    expect(chk.rows[0]).toMatchObject({ title: 'บริษัท ดูราฟลอร์ จำกัด', sub: 'QT-q1 · 101,650 บาท · เอก แนบ' });
    expect(chk.rows[0].right.text).toMatch(/^วันนี้ \d\d:\d\d$/);
    expect(chk.rows[1].right).toEqual({ text: dmTh('2026-10-10') });
    expect(pay.rows.map((x) => [x.title, x.right])).toEqual([
      ['บริษัท ไทยออยล์ เอนเนอร์ยี่ จำกัด', { text: 'เลยกำหนด 4 วัน', chip: 'bad' }],
      ['บริษัท เบทาโกร ฟู้ด จำกัด', { text: 'ถึงกำหนด 3 วัน', chip: 'warn' }],
    ]);
    expect(pay.rows[0].sub).toBe(`PAY1 · 80,250 บาท · ครบกำหนด ${dmTh('2026-10-08')} · เอก`);
    expect(appt.rows.map((x) => [x.title, x.right, x.go.day])).toEqual([
      ['ฝาจีบ', { text: 'เกินกำหนด 4 วัน', chip: 'bad' }, '2026-10-08'],
      ['บริษัท ซากิโนมิยะ ประเทศไทย จำกัด', { text: 'เกินกำหนด 3 วัน', chip: 'bad' }, '2026-10-09'],
      ['บริษัท ซากิโนมิยะ ประเทศไทย จำกัด', { text: 'วันนี้' }, TODAY],
    ]);
    expect(appt.rows[1].sub).toBe(`โทร · โทรตามใบเสนอราคา · ${dmTh('2026-10-09')} 14:00`);
    expect(appt.rows[2].sub).toBe('อีเมล · ส่งเอกสารจัดซื้อ');
  });

  it('the uploader may check their own when the team allows it; a wider window shows more instalments', () => {
    const { base } = team();
    const r = bellItems({ ...base, cfg: { ...NOTIFY_CFG0, self: true, pre: 60 } });
    expect(r.groups[0].rows.map((x) => x.go.doc)).toEqual(['q1', 'q4', 'q2']);
    expect(r.groups.find((g) => g.kind === 'pay')!.rows.length).toBe(3);
  });

  it('someone who attached quotations (sales, mine scope): ใบเสนอราคาของฉัน (sent back counts, checked lately shows), own instalments and appointments only', () => {
    const { base, checks, q1 } = team();
    checks.q1 = rec(q1, 'back', 'หมิว', '2026-10-12T03:30:00.000Z', 'เลขที่ QT-2569-021 ซ้ำกับใบของ ดีไวน์สตาร์ช ขอออกเลขใหม่ แล้วแนบฉบับแก้ไข ยอดเงินถูกต้องแล้ว');
    const r = bellItems({ ...base, me: 'เอก', caps: SALES, scope: 'mine' });
    expect(r.groups.map((g) => [g.kind, g.title, g.n])).toEqual([['mine', 'ใบเสนอราคาของฉัน', 1], ['pay', 'งวดเงิน', 1]]);
    const mine = r.groups[0].rows;
    expect(mine.map((x) => [x.go.doc, x.right, x.count])).toEqual([['q1', { text: 'ส่งกลับแก้ไข', chip: '' }, true], ['q3', { text: 'ตรวจแล้ว', chip: 'info' }, false]]);
    expect(mine[0].sub.startsWith('QT-q1 · หมิว ส่งกลับให้แก้: เลขที่ QT-2569-021')).toBe(true);
    expect(mine[0].sub.endsWith('…')).toBe(true);
    expect(mine[1].sub).toBe(`QT-q3 · มินท์ ตรวจแล้ว ${dmTh('2026-10-08')}`);
    // the instalment of their own deal, without the name (it is theirs)
    expect(r.groups[1].rows[0].sub).toBe(`PAY1 · 80,250 บาท · ครบกำหนด ${dmTh('2026-10-08')}`);
    expect(r.count).toBe(2);
    // a check older than 7 days is no longer shown
    expect(bellItems({ ...base, me: 'เอก', caps: SALES, scope: 'mine', today: '2026-10-20' }).groups[0].rows.map((x) => x.go.doc)).toEqual(['q1']);
  });

  it('มกร: own appointments; nothing at all says so with no groups', () => {
    const { base } = team();
    const r = bellItems({ ...base, me: 'มกร', caps: SALES, scope: 'mine' });
    expect(r.groups.map((g) => g.kind)).toEqual(['pay', 'appt']);
    expect(r.groups[1].rows.map((x) => x.title)).toEqual(['ฝาจีบ']);
    const empty = bellItems({ ...base, me: 'ใครสักคน', caps: SALES, scope: 'mine' });
    expect(empty).toEqual({ groups: [], count: 0 });
  });

  it('before the script has notifications: payments and appointments only; no accounts: no checks, everything else', () => {
    const { base } = team();
    expect(bellItems({ ...base, live: null }).groups.map((g) => g.kind)).toEqual(['pay', 'appt']);
    expect(bellItems({ ...base, live: { on: false, since: '' } }).groups.map((g) => g.kind)).toEqual(['pay', 'appt']);
    expect(bellItems({ ...base, caps: null, me: '' }).groups.map((g) => g.kind)).toEqual(['pay', 'appt']);
  });

  it('what a role may see: no ดูยอดเงิน, no instalments; no แผนติดต่อ, no appointments; not a checker, nothing to check', () => {
    const { base } = team();
    expect(bellItems({ ...base, caps: { ...VIEWER, 'view.money': undefined } }).groups.map((g) => g.kind)).toEqual(['appt']);
    expect(bellItems({ ...base, caps: { ...ADMIN, 'view.plan': undefined } }).groups.map((g) => g.kind)).toEqual(['chk', 'pay']);
    expect(bellItems({ ...base, caps: VIEWER }).groups.map((g) => g.kind)).toEqual(['pay', 'appt']);
  });

  it('waitingChecks follows the same rules', () => {
    const { s, checks } = team();
    expect(waitingChecks(s, checks, 'หมิว', NOTIFY_CFG0, SINCE).map((d) => d.id)).toEqual(['q1', 'q2']);
    expect(waitingChecks(s, checks, 'หมิว', NOTIFY_CFG0, '2026-10-11').map((d) => d.id)).toEqual(['q1']);
  });

  it('whenTh and dayTh', () => {
    const now = new Date(2026, 9, 12, 9, 40).toISOString();
    expect(whenTh(now, TODAY)).toBe('วันนี้ 09:40');
    expect(whenTh(new Date(2026, 9, 10, 9, 40).toISOString(), TODAY)).toBe(dmTh('2026-10-10'));
    expect(dayTh('2026-10-12')).toBe('จันทร์ ' + dmTh('2026-10-12'));
  });
});

describe('names that match no account', () => {
  it('ผู้รับผิดชอบ of open deals and owners of companies with appointments to do, not the accounts (any spacing or case)', () => {
    const s = emptySales();
    deal(s, 'a', 'A', 'คุณบี');
    deal(s, 'b', 'B', 'คุณบี');
    deal(s, 'c', 'C', 'คุณเอ');
    deal(s, 'd', 'D', 'เอก');
    deal(s, 'e', 'E', ' Mew ');
    deal(s, 'f', 'F', 'คุณเอ', { jobStatus: 'closed' });
    deal(s, 'g', 'G', '');
    const tasks: Task[] = [
      { id: 't1', gid: 1, title: '', type: 'call', date: TODAY, time: '', note: '', done: false },
      { id: 't2', gid: 2, title: '', type: 'call', date: TODAY, time: '', note: '', done: true },
    ];
    expect(unmatchedNames(s, tasks, { 1: 'คุณเอ', 2: 'คุณซี' }, ['เอก', 'mew', 'หมิว'])).toEqual([
      { name: 'คุณบี', n: 2 },
      { name: 'คุณเอ', n: 2 },
    ]);
  });
});

describe('links from the e-mails', () => {
  it('parseGo reads #go= links and refuses anything else', () => {
    expect(parseGo('#go=qt&doc=mg1x2a3&s=AbC-_9')).toEqual({ go: 'qt', doc: 'mg1x2a3', s: 'AbC-_9' });
    expect(parseGo('#go=qt&doc=mg1x2a3&s=bad sig!')).toEqual({ go: 'qt', doc: 'mg1x2a3', s: '' });
    expect(parseGo('#go=qt&doc=../../etc')).toBeNull();
    expect(parseGo('#go=qt')).toBeNull();
    expect(parseGo('#go=deal&id=d1')).toEqual({ go: 'deal', id: 'd1' });
    expect(parseGo('#go=plan&d=2026-10-12')).toEqual({ go: 'plan', d: '2026-10-12' });
    expect(parseGo('#go=plan&d=tomorrow')).toEqual({ go: 'plan', d: '' });
    expect(parseGo('#go=notify')).toEqual({ go: 'notify' });
    expect(parseGo('#go=cash&m=2026-10&f=wait')).toEqual({ go: 'cash', m: '2026-10', f: 'wait' });
    expect(parseGo('#go=elsewhere')).toBeNull();
    expect(parseGo('#team=https://script.google.com/macros/s/x/exec')).toBeNull();
    expect(parseGo('')).toBeNull();
  });
});
