import { describe, expect, it } from 'vitest';
import { emptySales, newDeal, toPay, type Deal, type DealDoc, type SalesState } from './sales';
import {
  bellEmpty, bellItems, checkedLine, dayTh, dirPeople, docById, fpOf, mailIssues, myMailIssues, myNotify0, nameList, needsCheck, parseGo, parseMyNotify, parseNotifyCfg, parseNotifyFlag,
  parseNotifyStatus, parseQtOut, qtCheckOf, qtFpKey, qtLocalOutcome, qtSentNews, qtSentView, recentLine, recentName, recentQts, sameFp, toQtCheck, unmatchedNames, waitShort, waitingChecks, wantsLine, whenTh,
  NOTIFY_CFG0, type BellIn, type MailPerson, type NotifyStatus, type QtCheck, type QtSent,
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

  it('parseNotifyStatus: before the trigger first runs (last: {}) there is no last run, not a failed one', () => {
    expect(parseNotifyStatus({ on: 1, since: '2026-10-15', last: {}, quotaLeft: 99 }).last).toBeNull();
    expect(parseNotifyStatus({ on: 1, last: { at: '2026-10-15T11:53:14Z', ok: 0, err: 'x' } }).last).toMatchObject({ ok: false, err: 'x' });
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
    expect(r.groups.map((g) => [g.kind, g.title, g.n])).toEqual([['chk', 'รอตรวจ', 2], ['mine', 'ใบเสนอราคาของฉัน', 0], ['pay', 'งวดเงิน', 2], ['appt', 'นัดหมาย', 3]]);
    expect(r.count).toBe(7);
    const [chk, own, pay, appt] = r.groups;
    // their own (q4) waits for another checker: shown, not counted (nothing heard about it in this browser)
    expect(own.rows).toMatchObject([{ key: 'w:q4', sub: 'QT-q4 · รอผู้ตรวจ', right: { text: 'รอตรวจ', chip: '' }, count: false, go: { deal: 'dE', doc: 'q4' } }]);
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
    expect(r.groups.map((g) => g.kind)).toEqual(['mine', 'pay', 'appt']);
    // q2, sent back and corrected since: waiting again
    expect(r.groups[0].rows.map((x) => [x.key, x.sub, x.count])).toEqual([['w:q2', 'QT-2569-020 · แก้แล้ว รอตรวจอีกครั้ง', false]]);
    expect(r.groups[2].rows.map((x) => x.title)).toEqual(['ฝาจีบ']);
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
    expect(bellItems({ ...base, caps: { ...ADMIN, 'view.plan': undefined } }).groups.map((g) => g.kind)).toEqual(['chk', 'mine', 'pay']);
    expect(bellItems({ ...base, caps: VIEWER }).groups.map((g) => g.kind)).toEqual(['mine', 'pay', 'appt']);
    expect(bellItems({ ...base, me: 'ปลา', caps: VIEWER }).groups.map((g) => g.kind)).toEqual(['pay', 'appt']);
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

describe('who heard of a quotation I attached or edited', () => {
  const AT = '2026-10-12T03:00:00.000Z';
  const out = (o: Partial<QtSent> = {}): QtSent => ({ id: 'q1', fp: '', at: AT, what: 'new', to: [], later: [], bell: [], skip: [], why: '', ...o });

  it('parseQtOut reads one item of a push reply and nothing else', () => {
    expect(parseQtOut({ id: 'q1', k: 'ddoc/d1/q1', fp: 'abc', what: 'edit', to: ['มกร', 3, ''], later: ['หมิว'], bell: ['มกร', 'หมิว'], skip: [{ n: 'หมิว', r: 'noem' }, { n: 'x', r: 'weird' }, 5], why: 'nomail' })).toEqual({
      k: 'ddoc/d1/q1', o: { id: 'q1', what: 'edit', to: ['มกร'], later: ['หมิว'], bell: ['มกร', 'หมิว'], skip: [{ n: 'หมิว', r: 'noem' }], why: 'nomail' },
    });
    expect(parseQtOut({ id: 'q1', k: 'ddoc/d1/q1', why: 'boom', what: 'x' })!.o).toMatchObject({ what: 'new', why: '', to: [] });
    expect(parseQtOut({ id: 'q2', k: 'ddoc/d1/q1' })).toBeNull();
    expect(parseQtOut({ id: 'q1', k: 'deal/q1' })).toBeNull();
    expect(parseQtOut(null)).toBeNull();
  });

  it('qtSentView: who got it; what waits; why nobody did, and whether this account can fix it', () => {
    const sales = { admin: false }, admin = { admin: true, checker: true };
    expect(qtSentView(out({ to: ['มกร'] }), sales)).toEqual({ state: 'sent', text: 'ส่งให้ผู้ตรวจแล้ว: มกร', short: 'ส่งให้ มกร แล้ว', fix: '', count: false });
    expect(qtSentView(out({ to: ['มกร', 'หมิว', 'ฝน'], later: ['นก', 'น้ำ'] }), sales).text).toBe('ส่งให้ผู้ตรวจแล้ว: มกร, หมิว, ฝน · นก, น้ำ จะได้ภายใน 10 นาที');
    expect(qtSentView(out({ later: ['มกร'], why: 'file' }), sales)).toMatchObject({ state: 'later', short: 'รออัปโหลดไฟล์' });
    expect(qtSentView(out({ later: ['มกร'], why: 'quota' }), sales).text).toBe('วันนี้ส่งอีเมลครบโควตาแล้ว จะส่งให้ มกร เมื่อโควตากลับมา · ผู้ตรวจเห็นในกระดิ่งแล้ว');
    expect(qtSentView(out({ later: ['มกร'], why: 'timer', local: true }), sales)).toMatchObject({ state: 'later', text: 'จะส่งอีเมลให้ผู้ตรวจภายใน 10 นาที: มกร', short: 'ส่งภายใน 10 นาที' });
    expect(qtSentView(out({ later: ['มกร'], why: 'err' }), sales).text).toBe('จะส่งอีเมลให้ผู้ตรวจภายใน 10 นาที: มกร');
    // the day's quota ran out within the push: the rest wait for it, not for the next 10 minutes
    expect(qtSentView(out({ to: ['หัวหน้า'], later: ['มินท์', 'ฝน'], why: 'quota' }), sales).text).toBe('ส่งให้ผู้ตรวจแล้ว: หัวหน้า · มินท์, ฝน รอโควตาอีเมลของวันนี้ ส่งเองเมื่อโควตากลับมา');
    // the release before immediate mail (its push says nothing): no promise of who, or of a mail at all
    for (const o of [out({ why: 'tick', local: true }), out({ why: 'timer', local: true })]) {
      expect(qtSentView(o, sales)).toEqual({ state: 'later', text: 'สคริปต์ของทีมรุ่นนี้ส่งอีเมลตามรอบทุก 10 นาที ถึงผู้ตรวจคนอื่นที่ยืนยันอีเมลแล้ว (ถ้ามี)', short: 'ส่งตามรอบ 10 นาที', fix: '', count: false });
      expect(qtSentView(o, admin)).toMatchObject({ text: expect.stringMatching(/· อัปเดตสคริปต์เพื่อส่งทันทีและดูว่าส่งถึงใคร$/), fix: 'setup', count: false });
    }
    // the owner's case: an admin who is the only checker attached it
    expect(qtSentView(out({ why: 'nochk' }), admin)).toEqual({
      state: 'none', text: 'รอผู้ตรวจคนอื่น: ยังไม่มีบัญชีอื่นที่ตรวจใบเสนอราคาได้ ใบที่คุณแนบเองจึงไม่ได้ส่งให้ใคร', short: 'รอผู้ตรวจคนอื่น', fix: 'checker', count: true,
    });
    expect(qtSentView(out({ why: 'nochk' }), sales)).toMatchObject({ short: 'ยังไม่มีผู้ตรวจ', fix: '', count: false, text: expect.stringContaining('แจ้งผู้ดูแลระบบ') });
    // an admin who only edited it (someone else attached it) is not told he attached it
    expect(qtSentView(out({ why: 'nochk', what: 'edit' }), admin).text).toBe('รอผู้ตรวจคนอื่น: ยังไม่มีบัญชีอื่นที่ตรวจใบเสนอราคาได้ ใบที่คุณแก้จึงไม่ได้ส่งให้ใคร');
    // the team lets whoever attached or changed it check their own: nobody to set up, nothing counted
    const selfOk = { state: 'none', text: 'ไม่มีผู้ตรวจคนอื่นได้อีเมล · คุณตรวจใบนี้เองได้', short: 'ตรวจเองได้', fix: '', count: false };
    expect(qtSentView(out({ why: 'self' }), admin)).toEqual(selfOk);
    expect(qtSentView(out({ why: 'self' }), { ...admin, self: true })).toEqual(selfOk);
    expect(qtSentView(out({ why: 'nochk' }), { ...admin, self: true })).toEqual(selfOk); // told before the switch was turned on
    expect(qtSentView(out({ why: 'self' }), { ...admin, self: false })).toMatchObject({ short: 'รอผู้ตรวจคนอื่น', fix: 'checker', count: true }); // turned off since
    expect(qtSentView(out({ why: 'self' }), { admin: false, checker: false, self: true }).text).toBe('ไม่มีผู้ตรวจคนอื่นได้อีเมล · ผู้แนบตรวจใบนี้เองได้');
    expect(qtSentView(out({ why: 'nochk' }), { admin: false, checker: false, self: true }).short).toBe('ยังไม่มีผู้ตรวจ');
    const nomail = out({ why: 'nomail', bell: ['มกร', 'หมิว'], skip: [{ n: 'มกร', r: 'unverified' }, { n: 'หมิว', r: 'noem' }] });
    expect(qtSentView(nomail, sales)).toMatchObject({ state: 'none', text: 'มกร, หมิว เห็นในกระดิ่งแล้ว แต่ยังไม่ได้อีเมล: มกร ยังไม่ยืนยันอีเมล · หมิว ยังไม่ใส่อีเมล', fix: '', count: false });
    expect(qtSentView(nomail, admin)).toMatchObject({ fix: 'email', count: true });
    expect(qtSentView(out({ why: 'off', local: true }), admin)).toMatchObject({ short: 'ยังไม่เปิดการแจ้งเตือน', fix: 'setup', count: true, text: expect.stringContaining('setupNotify') });
    expect(qtSentView(out({ why: 'script', local: true }), sales)).toMatchObject({ short: 'สคริปต์ยังไม่อัปเดต', fix: '', count: false });
    expect(qtSentView(out({ why: 'old' }), sales).short).toBe('ผู้ตรวจเห็นในกระดิ่ง');
    expect(qtSentView(out({ why: 'bulk' }), sales).text).toMatch(/^แนบพร้อมกันหลายใบ/);
    expect(qtSentView(null, sales)).toMatchObject({ state: 'wait', text: 'รอผู้ตรวจ' });
    expect(nameList(['ก', 'ข', 'ค', 'ง', 'จ'])).toBe('ก, ข, ค และอีก 2 คน');
  });

  it('qtSentNews: a message only when someone new got it, or a new reason nobody did (not while the file uploads)', () => {
    const a = out({ fp: 'v1', later: ['มกร'], why: 'file' });
    expect(qtSentNews(undefined, a)).toBe(false);
    const b = out({ fp: 'v1', to: ['มกร'] });
    expect(qtSentNews(a, b)).toBe(true);
    expect(qtSentNews(b, out({ fp: 'v1', to: ['มกร'] }))).toBe(false); // the same version pushed again (its Drive id)
    expect(qtSentNews(b, out({ fp: 'v2', to: ['มกร'] }))).toBe(true); // an edit, told again
    expect(qtSentNews(undefined, out({ why: 'nochk' }))).toBe(true);
    expect(qtSentNews(out({ why: 'nochk' }), out({ why: 'nochk' }))).toBe(false);
    expect(qtSentNews(undefined, out({ why: 'old' }))).toBe(false);
    expect(qtSentNews(undefined, out({ why: 'bulk' }))).toBe(false);
  });

  it('waitShort: the card says who was told, else since when; changed after a check says so', () => {
    const doc = { cAt: '2026-10-12T03:00:00.000Z', at: '2026-10-12T03:00:00.000Z' };
    const sales = { admin: false }, admin = { admin: true, checker: true };
    expect(waitShort(out({ to: ['มกร'] }), doc, sales)).toBe('ส่งให้ มกร แล้ว');
    expect(waitShort(out({ why: 'nochk' }), doc, admin)).toBe('รอผู้ตรวจคนอื่น');
    expect(waitShort(out({ why: 'nochk' }), doc, { ...admin, self: true })).toBe('ตรวจเองได้');
    expect(waitShort(null, doc, sales)).toBe('รอผู้ตรวจ ตั้งแต่ ' + dmTh('2026-10-12'));
    expect(waitShort(null, doc, sales, true)).toBe('แก้หลังตรวจ รอตรวจอีกครั้ง');
    expect(waitShort(out({ to: ['มกร'] }), doc, sales, true)).toBe('แก้หลังตรวจ · ส่งให้ มกร แล้ว');
  });

  it('qtLocalOutcome: for the release before immediate mail, an admin reads who its timer mails from the team\'s accounts', () => {
    const nf0 = myNotify0(false);
    const p = (u: string, name: string, caps: CapSet, o: Partial<MailPerson> = {}): MailPerson => ({ u, name, caps, em: u + '@example.com', ok: true, nf: nf0, ...o });
    const boss = p('mkorn', 'มกร', ADMIN), ek = p('eak', 'เอก', SALES);
    // the owner's case: the admin is the only checker and attached it
    expect(qtLocalOutcome({ people: [boss, ek], me: 'มกร', by: 'มกร', self: false })).toEqual({ to: [], later: [], bell: [], skip: [], why: 'nochk' });
    expect(qtLocalOutcome({ people: [boss, ek], me: 'มกร', by: 'มกร', self: true }).why).toBe('self');
    // the admin edits เอก's quotation: still no other checker (เอก does not check)
    expect(qtLocalOutcome({ people: [boss, ek], me: 'มกร', by: 'เอก', self: false }).why).toBe('nochk');
    // another checker, not able to get mail yet; then confirmed
    const mint = p('mint', 'มินท์', ADMIN, { ok: false });
    expect(qtLocalOutcome({ people: [boss, ek, mint], me: 'มกร', by: 'มกร', self: false })).toEqual({ to: [], later: [], bell: ['มินท์'], skip: [{ n: 'มินท์', r: 'unverified' }], why: 'nomail' });
    expect(qtLocalOutcome({ people: [boss, ek, { ...mint, ok: true }], me: 'มกร', by: 'มกร', self: false })).toEqual({ to: [], later: ['มินท์'], bell: ['มินท์'], skip: [], why: 'timer' });
    // a checker who turned quotation mails off is named, the others still get it
    const fon = p('fon', 'ฝน', ADMIN, { nf: { ...nf0, on: { ...nf0.on, qt: false } } });
    expect(qtLocalOutcome({ people: [boss, ek, { ...mint, ok: true }, fon], me: 'มกร', by: 'เอก', self: false })).toMatchObject({ later: ['มินท์'], skip: [{ n: 'ฝน', r: 'off' }], why: 'timer' });
  });

  it('dirPeople: the active accounts of the admin\'s directory, with their capabilities and e-mail settings', () => {
    const dir = {
      users: [
        { u: 'mkorn', name: 'มกร', role: 'admin', on: 1, em: 'owner@example.com', ok: 1 },
        { u: 'eak', name: 'เอก', role: 'sales', on: true, notify: { on: { qt: 1, res: 1, dg: 0, pre: 0 }, t: '08:00', sc: 'mine', em: 'ek@example.com', ok: 0 } },
        { u: 'old', name: 'เก่า', role: 'admin', on: 0 },
      ],
      roles: [], grants: {}, v4: false,
    };
    const people = dirPeople(dir, TODAY);
    expect(people.map((x) => [x.u, x.ok, x.em, !!x.caps['qt.check']])).toEqual([['mkorn', true, 'owner@example.com', true], ['eak', false, '', false]]);
    expect(people[1].nf).toMatchObject({ t: '08:00', sc: 'mine' });
  });

  /** มกร (admin, the only checker) and เอก (sales), each with a quotation waiting. */
  function bell() {
    const s = emptySales();
    deal(s, 'd1', 'บริษัท ดูราฟลอร์ จำกัด', 'มกร');
    deal(s, 'd2', 'บริษัท เบทาโกร จำกัด', 'เอก');
    const own = qt(s, 'd1', 'q1', { by: 'มกร', docNo: 'QT-2569-021' });
    const ek = qt(s, 'd2', 'q2', { by: 'เอก', docNo: 'QT-2569-022' });
    const base: BellIn = { S: s, tasks: [], owners: {}, coName: () => '', me: 'มกร', caps: ADMIN, live: { on: true, since: SINCE, now: true }, checks: {}, cfg: NOTIFY_CFG0, scope: 'team', today: TODAY };
    return { s, base, own, ek };
  }

  it('the bell: an admin who is the only checker and attached it sees "รอผู้ตรวจคนอื่น" with a link to set checkers (counted)', () => {
    const { base, own } = bell();
    const sent = { q1: out({ fp: qtFpKey(own), why: 'nochk' }) };
    const r = bellItems({ ...base, sent });
    const mine = r.groups.find((g) => g.kind === 'mine')!;
    expect(mine).toMatchObject({ title: 'ใบเสนอราคาของฉัน', n: 1 });
    expect(mine.rows).toEqual([{
      key: 'w:q1', kind: 'mine', title: 'บริษัท ดูราฟลอร์ จำกัด', sub: 'QT-2569-021 · รอผู้ตรวจคนอื่น: ยังไม่มีบัญชีอื่นที่ตรวจใบเสนอราคาได้ ใบที่คุณแนบเองจึงไม่ได้ส่งให้ใคร',
      right: { text: 'รอตรวจ', chip: '' }, count: true, go: { deal: 'd1', doc: 'q1' }, wrap: true, act: { label: 'ตั้งผู้ตรวจ', to: 'notify' },
    }]);
    // เอก's quotation waits in มกร's รอตรวจ as before
    expect(r.groups[0]).toMatchObject({ kind: 'chk', rows: [{ key: 'q:q2' }] });
    expect(r.count).toBe(2);
    // the team lets the attacher check their own: it is in มกร's รอตรวจ instead
    const self = bellItems({ ...base, sent, cfg: { ...NOTIFY_CFG0, self: true } });
    expect(self.groups.map((g) => g.kind)).toEqual(['chk']);
    expect(self.groups[0].rows.map((x) => x.key).sort()).toEqual(['q:q1', 'q:q2']);
  });

  it('the bell: sales who attached it see who the script mailed; an outcome about an earlier version is not used', () => {
    const { base, ek } = bell();
    const sales = { ...base, me: 'เอก', caps: SALES, scope: 'mine' as const };
    const r = bellItems({ ...sales, sent: { q2: out({ id: 'q2', fp: qtFpKey(ek), to: ['มกร'] }) } });
    expect(r.groups[0].rows).toMatchObject([{ key: 'w:q2', sub: 'QT-2569-022 · ส่งให้ผู้ตรวจแล้ว: มกร', count: false, wrap: true }]);
    expect(r.groups[0].rows[0].act).toBeUndefined();
    expect(r.count).toBe(0);
    const old = bellItems({ ...sales, sent: { q2: out({ id: 'q2', fp: qtFpKey({ ...ek, amount: 1 }), to: ['มกร'] }) } });
    expect(old.groups[0].rows).toMatchObject([{ sub: 'QT-2569-022 · รอผู้ตรวจ', wrap: false }]);
    // checked: no longer waiting
    const done = bellItems({ ...sales, checks: { q2: rec(ek, 'ok', 'มกร') }, sent: { q2: out({ id: 'q2', fp: qtFpKey(ek), to: ['มกร'] }) } });
    expect(done.groups[0].rows.map((x) => [x.key, x.right.text])).toEqual([['m:q2', 'ตรวจแล้ว']]);
  });

  it('the bell with the release before immediate mail: sales reads that the timer mails it, not a promise of who', () => {
    const { base, ek } = bell();
    const sales = { ...base, me: 'เอก', caps: SALES, scope: 'mine' as const, live: { on: true, since: SINCE } };
    const r = bellItems({ ...sales, sent: { q2: out({ id: 'q2', fp: qtFpKey(ek), why: 'tick', local: true }) } });
    expect(r.groups[0].rows).toMatchObject([{ key: 'w:q2', count: false, right: { text: 'รอตรวจ' }, sub: 'QT-2569-022 · สคริปต์ของทีมรุ่นนี้ส่งอีเมลตามรอบทุก 10 นาที ถึงผู้ตรวจคนอื่นที่ยืนยันอีเมลแล้ว (ถ้ามี)' }]);
    expect(r.count).toBe(0);
    // an admin whose browser could not read the accounts: the link says how to update the script
    const { own } = bell();
    const a = bellItems({ ...base, live: { on: true, since: SINCE }, sent: { q1: out({ fp: qtFpKey(own), why: 'tick', local: true }) } });
    expect(a.groups.find((g) => g.kind === 'mine')!.rows).toMatchObject([{ key: 'w:q1', count: false, act: { label: 'ดูวิธีอัปเดตสคริปต์', to: 'notify' } }]);
  });

  it('the bell before notifications are set up: what attaching said (no checks), for 7 days', () => {
    const { base, ek } = bell();
    const sales = { ...base, me: 'เอก', caps: SALES, scope: 'mine' as const };
    const sent = { q2: out({ id: 'q2', fp: qtFpKey(ek), why: 'script', local: true }) };
    for (const live of [null, { on: false, since: '' }]) {
      const r = bellItems({ ...sales, live, sent });
      expect(r.groups.map((g) => g.kind)).toEqual(['mine']);
      expect(r.groups[0].rows[0]).toMatchObject({ key: 'w:q2', count: false, right: { text: 'ยังไม่ได้แจ้ง', chip: '' }, sub: expect.stringContaining('สคริปต์ของทีมยังเป็นรุ่นที่ไม่มีการแจ้งเตือน') });
    }
    expect(bellItems({ ...sales, live: null, sent, today: '2026-10-20' }).groups).toEqual([]);
    expect(bellItems({ ...sales, live: null }).groups).toEqual([]);
  });
});

describe('why mail does not arrive', () => {
  const nf = (o: Partial<ReturnType<typeof myNotify0>> = {}) => ({ ...myNotify0(false), ...o });
  const person = (u: string, name: string, caps: CapSet, o: Partial<MailPerson> = {}): MailPerson => ({ u, name, caps, em: u + '@example.com', ok: true, nf: nf(), ...o });
  const st = (o: Partial<NotifyStatus> = {}): NotifyStatus => ({ on: true, since: SINCE, last: null, sent: 3, left: 90, from: '', users: {}, now: true, recent: [], ...o });
  const live = { on: true, since: SINCE, now: true };

  it('the admin page: script, set-up, timer, checkers, addresses, quota and the last run, each with its fix', () => {
    const boss = person('mkorn', 'มกร', ADMIN), ek = person('eak', 'เอก', SALES);
    expect(mailIssues({ live: null, st: null, people: [boss, ek], self: false }).map((i) => [i.k, i.tone])).toEqual([['script', 'bad']]);
    expect(mailIssues({ live: { on: false, since: '' }, st: null, people: [boss], self: false })[0]).toMatchObject({ k: 'setup', fix: expect.stringContaining('setupNotify') });
    // the owner's team: one checker (the admin), no confirmed address yet
    const owner = mailIssues({ live, st: st(), people: [{ ...boss, em: '', ok: false }, ek], self: false });
    expect(owner.map((i) => [i.k, i.tone])).toEqual([['solo', 'warn'], ['noem', 'bad']]);
    expect(owner[0].text).toBe('มีผู้ตรวจคนเดียวคือ มกร ใบที่ มกร แนบหรือแก้เองจึงไม่มีใครได้อีเมล');
    expect(owner[1].text).toBe('ผู้ตรวจยังไม่มีใครรับอีเมลได้ (เห็นในกระดิ่งเท่านั้น): มกร ยังไม่ใส่อีเมล');
    // the attacher may check their own: one checker is enough (said, not a problem)
    expect(mailIssues({ live, st: st(), people: [boss, ek], self: true })).toMatchObject([{ k: 'solo', tone: 'info', text: expect.stringContaining('มกร ตรวจเองในเว็บได้') }]);
    expect(mailIssues({ live, st: st(), people: [ek], self: false }).map((i) => i.k)).toEqual(['nochk']);
    // some checkers can't get mail
    const two = mailIssues({ live, st: st(), people: [boss, person('mint', 'มินท์', ADMIN, { ok: false }), person('fon', 'ฝน', ADMIN, { nf: nf({ on: { qt: false, res: true, dg: true, pre: false } }) }), person('kai', 'ไก่', { ...ADMIN, 'notify.mail': undefined })], self: false });
    expect(two).toMatchObject([{ k: 'noem', tone: 'warn', text: 'ผู้ตรวจบางคนไม่ได้อีเมล: มินท์ ยังไม่ยืนยันอีเมล · ฝน ปิดอีเมลรอตรวจไว้ · ไก่ บทบาทไม่รับอีเมล' }]);
    // the timer gone: quotations still go at once with this script, nothing else does
    expect(mailIssues({ live, st: st({ on: false }), people: [boss, person('mint', 'มินท์', ADMIN)], self: false })).toMatchObject([{ k: 'trigger', tone: 'bad', fix: expect.stringMatching(/^อีเมลใบเสนอราคาใหม่ยังส่งทันที/) }]);
    expect(mailIssues({ live: { on: true, since: SINCE }, st: st({ on: false, now: null }), people: [boss, person('mint', 'มินท์', ADMIN)], self: false })[0].fix).toMatch(/^ตอนนี้ไม่มีอีเมลออกเลย/);
    // a script that mails by its timer only
    expect(mailIssues({ live: { ...live, now: false }, st: st({ now: false }), people: [boss, person('mint', 'มินท์', ADMIN)], self: false }).map((i) => [i.k, i.tone])).toEqual([['now', 'info']]);
    // the release before immediate mail (hello and the status say nothing of `now`): update the script
    const tick = mailIssues({ live: { on: true, since: SINCE }, st: st({ now: null }), people: [boss, person('mint', 'มินท์', ADMIN)], self: false });
    expect(tick).toMatchObject([{ k: 'tick', tone: 'warn', text: expect.stringContaining('ส่งตามรอบทุก 10 นาที'), fix: expect.stringContaining('New version') }]);
    expect(mailIssues({ live: { on: true, since: SINCE }, st: null, people: [boss, person('mint', 'มินท์', ADMIN)], self: false }).map((i) => i.k)).toEqual(['tick']);
    expect(mailIssues({ live, st: st({ left: 0 }), people: [boss, person('mint', 'มินท์', ADMIN)], self: false }).map((i) => [i.k, i.tone])).toEqual([['quota', 'bad']]);
    expect(mailIssues({ live, st: st({ left: 3, last: { at: 'x', ok: false, sent: 0, err: 'mail_failed' } }), people: [boss, person('mint', 'มินท์', ADMIN)], self: false }).map((i) => [i.k, i.tone])).toEqual([['quota', 'warn'], ['last', 'warn']]);
  });

  it('การแจ้งเตือนของฉัน: what keeps my own mail away', () => {
    expect(myMailIssues({ live: null, mail: true, nf: nf(), checker: true }).map((i) => i.k)).toEqual(['script']);
    expect(myMailIssues({ live: { on: false, since: '' }, mail: true, nf: nf({ em: 'a@example.com', ok: true }), checker: false }).map((i) => i.k)).toEqual(['setup']);
    expect(myMailIssues({ live, mail: false, nf: nf(), checker: true }).map((i) => i.k)).toEqual(['role']);
    expect(myMailIssues({ live, mail: true, nf: nf(), checker: true }).map((i) => i.k)).toEqual(['noem']);
    expect(myMailIssues({ live, mail: true, nf: nf({ em: 'a@example.com' }), checker: true }).map((i) => i.k)).toEqual(['unverified']);
    expect(myMailIssues({ live, mail: true, nf: nf({ em: 'a@example.com', ok: true, on: { qt: false, res: true, dg: true, pre: false } }), checker: true }).map((i) => i.k)).toEqual(['off']);
    expect(myMailIssues({ live, mail: true, nf: nf({ em: 'a@example.com', ok: true }), checker: true })).toEqual([]);
    // the release before immediate mail: a checker's mail comes with the timer
    expect(myMailIssues({ live: { on: true, since: SINCE }, mail: true, nf: nf({ em: 'a@example.com', ok: true }), checker: true }).map((i) => [i.k, i.tone])).toEqual([['tick', 'info']]);
    expect(myMailIssues({ live: { on: true, since: SINCE }, mail: true, nf: nf({ em: 'a@example.com', ok: true }), checker: false })).toEqual([]);
  });

  it('the latest quotations from notify_status: one line each, newest first', () => {
    const recent = parseNotifyStatus({ now: 1, recent: [
      { at: '2026-10-12T03:05:00Z', doc: 'q3', u: 'mint', result: 'sent' },
      { at: '2026-10-12T03:05:00Z', doc: 'q3', u: 'fon', result: 'retry' },
      { at: '2026-10-12T03:04:00Z', doc: 'q2', u: '', result: 'none:nochk' },
      { at: '2026-10-12T03:03:00Z', doc: 'q1', u: 'mint', result: 'sent' },
      { at: '2026-10-12T03:02:00Z', doc: 'q1', u: 'mint', result: 'retry' },
      { at: '2026-10-12T03:01:00Z', doc: 'q0', u: '', result: 'none:nomail' },
      { at: '2026-10-12T03:00:00Z', doc: 'qs', u: '', result: 'none:self' },
      { bad: 1 },
    ] });
    expect(recent.now).toBe(true);
    const q = recentQts(recent.recent, (u) => ({ mint: 'มินท์', fon: 'ฝน' })[u] || '');
    expect(q.map((x) => [x.doc, recentLine(x)])).toEqual([
      ['q3', 'ส่งให้ มินท์ · รอส่ง ฝน'],
      ['q2', 'ไม่ได้ส่ง: ไม่มีผู้ตรวจคนอื่น (คนแนบตรวจเองไม่ได้)'],
      ['q1', 'ส่งให้ มินท์'],
      ['q0', 'ไม่ได้ส่ง: ผู้ตรวจยังรับอีเมลไม่ได้ (เห็นในกระดิ่ง)'],
      ['qs', 'ไม่ได้ส่ง: ไม่มีผู้ตรวจคนอื่น (คนแนบตรวจเองได้)'],
    ]);
    expect(recentQts(recent.recent, () => '', 2).map((x) => x.doc)).toEqual(['q3', 'q2']);
    // which quotation: one this device has not pulled yet is on its way, not deleted
    const at = { at: '2026-10-12T03:05:00Z' };
    expect(recentName(at, { docNo: 'QT-1' }, 'บริษัท เอ จำกัด', '2026-10-12T03:00:00Z')).toBe('QT-1 · บริษัท เอ จำกัด');
    expect(recentName(at, { docNo: '' }, undefined, '')).toBe('ใบเสนอราคา');
    expect(recentName(at, null, undefined, '2026-10-12T03:00:00Z')).toBe('ใบเสนอราคาใหม่ กำลังซิงก์');
    expect(recentName(at, null, undefined, '')).toBe('ใบเสนอราคาใหม่ กำลังซิงก์');
    expect(recentName(at, null, undefined, '2026-10-12T03:06:00Z')).toBe('ใบเสนอราคาที่ลบแล้ว');
    expect(parseNotifyStatus({}).now).toBeNull();
    expect(parseNotifyFlag({ on: 1, since: '2026-10-01', now: 1 })).toEqual({ on: true, since: '2026-10-01', now: true });
  });
});

describe('the empty bell', () => {
  it('says what would show, by what the account may see', () => {
    const of = (caps: CapSet) => (c: keyof CapSet) => !!caps[c];
    expect(bellEmpty(of(BUILTIN.sales.c), true)).toBe('งวดเงินที่ใกล้ถึงกำหนด นัดของวันนี้ และผลตรวจใบเสนอราคาของคุณจะขึ้นที่นี่');
    expect(bellEmpty(of(BUILTIN.sales.c), false)).toBe('งวดเงินที่ใกล้ถึงกำหนด และนัดของวันนี้จะขึ้นที่นี่');
    expect(bellEmpty(of(BUILTIN.admin.c), true)).toBe('งวดเงินที่ใกล้ถึงกำหนด นัดของวันนี้ ใบเสนอราคาที่รอตรวจ และผลตรวจใบเสนอราคาของคุณจะขึ้นที่นี่');
    // without ดูยอดเงิน there are no instalments in the bell: it does not promise them
    expect(bellEmpty(of({ 'view.sales': 'all', 'view.plan': 'all' }), true)).toBe('นัดของวันนี้จะขึ้นที่นี่');
    expect(bellEmpty(of({}), true)).toBe('เรื่องที่ต้องทำจะขึ้นที่นี่');
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
    expect(parseGo('#go=reqs')).toEqual({ go: 'reqs' });
    // the signed part as the team script writes it: <exp base36>.<signature>.<username>
    expect(parseGo('#go=qt&doc=mg1x2a3&s=mh8k2q0.AbCdEfGhIjKlMnOpQrSt-_.ek.1')).toEqual({ go: 'qt', doc: 'mg1x2a3', s: 'mh8k2q0.AbCdEfGhIjKlMnOpQrSt-_.ek.1' });
    expect(parseGo('#go=cash&m=2026-10&f=wait')).toEqual({ go: 'cash', m: '2026-10', f: 'wait' });
    expect(parseGo('#go=elsewhere')).toBeNull();
    expect(parseGo('#team=https://script.google.com/macros/s/x/exec')).toBeNull();
    expect(parseGo('')).toBeNull();
  });
});
