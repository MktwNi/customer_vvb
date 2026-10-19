/**
 * Notifications and the quotation check (package notify, item 5). Pure (no DOM), so it is unit-tested;
 * the engine, the bell, the check sheet, the settings dialogs and the deep links share it.
 *
 * - The check of a quotation is one record per document, `qchk/<docId>`, written only by the team script
 *   (action `qt_check`): {st:'ok'|'back', by, at, fp:{a,n,d,f}, note?, via?, u?}. Its status is derived:
 *   a record whose fingerprint (amount, number, date, file name + size) no longer matches the document is
 *   stale, so an edit, a file swap or a revision (a new document id) is "รอตรวจ" again without anything
 *   being written. Only quotations attached on or after the day notifications started (`since`, from the
 *   script's hello) need a check, so the first day does not show every old quotation as waiting.
 * - The team's rules, `scfg/notify.cfg` (an admin writes it, every browser has it): how many days before a
 *   due date an instalment is mentioned, how late ones repeat, which appointments the digest lists, whether
 *   the uploader may check their own quotation, the sender name and the site's address for links.
 * - The bell (computed here from what this browser holds, so it works offline and before the script
 *   update): quotations waiting for this checker, this person's own quotations sent back (or checked in the
 *   last 7 days), instalments late or due soon, and appointments due today or late.
 */
import { DUE_SOON, QUOTE_STAGE, fmtMoney, payDue, type Deal, type DealDoc, type SalesState } from './sales';
import { TT } from './constants';
import { addDays, daysBetween, dmTh, localDay, pad } from './format';
import { can, sameName, type CapId, type CapSet } from './caps';
import type { Task } from './types';

// ------------------------------------------------------------------ the check record

export type QtSt = 'ok' | 'back';
/** What a check was about: amount, document number, document date, file (`name|size`). The Drive file
 *  id is left out, so the upload that follows an attach does not make the check stale. */
export interface QtFp { a: number | null; n: string; d: string; f: string }
export interface QtCheck { st: QtSt; by: string; at: string; fp: QtFp; note?: string; via?: 'mail' | 'app'; u?: string }

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);

/** A pulled `qchk/` value, checked (a malformed one is skipped). */
/** A check's note (sending back says what to fix): the script keeps at most this many characters. */
export const QT_NOTE_MAX = 300;
export function toQtCheck(v: unknown): QtCheck | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  if (x.st !== 'ok' && x.st !== 'back') return null;
  const f = (x.fp && typeof x.fp === 'object' ? x.fp : {}) as Record<string, unknown>;
  const out: QtCheck = { st: x.st, by: str(x.by, 60), at: str(x.at, 40), fp: { a: num(f.a), n: str(f.n, 60), d: str(f.d, 10), f: str(f.f, 200) } };
  if (typeof x.note === 'string' && x.note.trim()) out.note = x.note.slice(0, QT_NOTE_MAX);
  if (x.via === 'mail' || x.via === 'app') out.via = x.via;
  if (typeof x.u === 'string' && x.u) out.u = x.u.slice(0, 40);
  return out;
}

/** The fingerprint of a document as it is now (shared with Code.gs: `a`, `n`, `d`, `name|size`, each
 *  exactly as stored, so the script computes the same from the row). */
export const fpOf = (doc: Pick<DealDoc, 'amount' | 'docNo' | 'docDate' | 'name' | 'size'>): QtFp => ({
  a: doc.amount ?? null,
  n: doc.docNo || '',
  d: doc.docDate || '',
  f: `${doc.name}|${doc.size}`,
});
/** Same document as checked? An amount left out of what was pulled (an account the script hides money
 *  from) matches a document whose amount is hidden too. */
export function sameFp(a: QtFp, b: QtFp) {
  const am = a.a == null || b.a == null ? a.a == null && b.a == null : Math.abs(a.a - b.a) < 0.005;
  return am && a.n === b.n && a.d === b.d && a.f === b.f;
}

/** รอตรวจ · ตรวจแล้ว · ส่งกลับแก้ไข (shared words, plan.md §1). */
export type QtStatus = 'wait' | 'ok' | 'back';
export const QT_WORD: Record<QtStatus, string> = { wait: 'รอตรวจ', ok: 'ตรวจแล้ว', back: 'ส่งกลับแก้ไข' };
/** Neutral or info chips only, never red, amber or green. */
export const QT_CHIP: Record<QtStatus, string> = { wait: 'chip', ok: 'chip info', back: 'chip' };
export interface QtCheckView {
  status: QtStatus;
  /** the record that holds (null while waiting) */
  rec: QtCheck | null;
  /** a record exists but the document changed since: waiting again */
  stale: QtCheck | null;
}
/** The check status of a document: its record while the fingerprint matches, else waiting. */
export function qtCheckOf(rec: QtCheck | null | undefined, doc: Pick<DealDoc, 'amount' | 'docNo' | 'docDate' | 'name' | 'size'>): QtCheckView {
  if (!rec) return { status: 'wait', rec: null, stale: null };
  if (!sameFp(rec.fp, fpOf(doc))) return { status: 'wait', rec: null, stale: rec };
  return { status: rec.st, rec, stale: null };
}

/** The day a document entered the checks: when it was confirmed (or attached). */
export const qtDayOf = (doc: Pick<DealDoc, 'cAt' | 'at'>) => localDay(doc.cAt || doc.at || '');
/**
 * Does this document take part in the check? A quotation for the Forecast with an amount, at QUOTATION,
 * on a deal still open, attached on or after `since` (the day notifications started). A version that a
 * revision replaced (`target:'none'`) never waits.
 */
export function needsCheck(s: SalesState, doc: DealDoc, since: string): boolean {
  if (doc.kind !== 'quotation' || doc.target !== 'forecast' || doc.amount == null || doc.stage !== QUOTE_STAGE) return false;
  const d = s.deals[doc.deal];
  if (!d || d.jobStatus === 'closed') return false;
  return !since || qtDayOf(doc) >= since;
}
/** Find a document by its id (a check record and a link name the document only). */
export const docById = (s: SalesState, id: string): DealDoc | undefined => Object.values(s.docs).find((x) => x.id === id);

/** "หมิว 12 ต.ค." */
export const checkedLine = (r: Pick<QtCheck, 'by' | 'at'>) => [r.by, r.at ? dmTh(localDay(r.at)) : ''].filter(Boolean).join(' ');

// ------------------------------------------------------------------ the script's state and the rules

/** From the script (hello / ping / any reply: `notify`): notifications are set up (`on`: the trigger and
 *  the mail permission are there) and since when quotations need a check. null = a script without
 *  notifications (deployed before them). Accepts `notify: 0|1|true|false` or `{on, since}`. */
export interface NotifyLive { on: boolean; since: string }
export function parseNotifyFlag(x: unknown): NotifyLive | null {
  if (x === 0 || x === 1 || typeof x === 'boolean') return { on: !!x, since: '' };
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  // (a person's own settings look different: `on` is an object of switches there)
  if (!(o.on === 0 || o.on === 1 || typeof o.on === 'boolean')) return null;
  const since = typeof o.since === 'string' && /^\d{4}-\d\d-\d\d/.test(o.since) ? o.since.slice(0, 10) : '';
  return { on: !!o.on, since };
}

export type LateRule = 'daily' | 'mon' | 'once';
export type ApptRule = 'today' | 'today+1';
/** `scfg/notify.cfg`. */
export interface NotifyCfg { pre: number; late: LateRule; appt: ApptRule; self: boolean; sender: string; site: string }
export const PRE_DAYS = [1, 3, 5, 7, 14];
export const NOTIFY_CFG0: NotifyCfg = { pre: DUE_SOON, late: 'daily', appt: 'today+1', self: false, sender: 'GCC Sales Tracker', site: '' };
export function parseNotifyCfg(v: unknown): NotifyCfg {
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pre = num(x.pre);
  return {
    pre: pre != null && pre >= 0 && pre <= 31 ? Math.round(pre) : NOTIFY_CFG0.pre,
    late: x.late === 'mon' || x.late === 'once' ? x.late : 'daily',
    appt: x.appt === 'today' ? 'today' : 'today+1',
    self: x.self === true || x.self === 1,
    sender: str(x.sender, 60).trim() || NOTIFY_CFG0.sender,
    site: typeof x.site === 'string' && /^https?:\/\//.test(x.site) ? x.site.slice(0, 300) : '',
  };
}

export type Scope = 'mine' | 'team';
/** A person's own settings (Script Property NOTIFY, read and written by `notify_me`, sent as me.notify):
 *  the address and whether it was confirmed, the e-mails wanted (new quotations to check, results of
 *  mine, the morning digest, a reminder 1 hour before a timed appointment), the digest time, the scope. */
export interface MyNotify { em: string; ok: boolean; on: { qt: boolean; res: boolean; dg: boolean; pre: boolean }; t: string; sc: Scope }
/** Digest times: 06:30 to 09:00, every 30 minutes. */
export const DIGEST_TIMES = ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00'];
export const myNotify0 = (team: boolean): MyNotify => ({ em: '', ok: false, on: { qt: true, res: true, dg: true, pre: false }, t: '07:30', sc: team ? 'team' : 'mine' });
export function parseMyNotify(x: unknown, team = false): MyNotify | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const d = myNotify0(team);
  const on = (o.on && typeof o.on === 'object' ? o.on : {}) as Record<string, unknown>;
  const b = (v: unknown, dv: boolean) => (v === undefined ? dv : v === true || v === 1);
  return {
    em: str(o.em, 120).trim(),
    ok: o.ok === 1 || o.ok === true,
    on: { qt: b(on.qt, d.on.qt), res: b(on.res, d.on.res), dg: b(on.dg, d.on.dg), pre: b(on.pre, d.on.pre) },
    t: typeof o.t === 'string' && DIGEST_TIMES.includes(o.t) ? o.t : d.t,
    sc: o.sc === 'mine' || o.sc === 'team' ? o.sc : d.sc,
  };
}
/** What `notify_status` says (admins): the trigger's last run, today's sending against the quota, the
 *  sending account, and each account's choices. Every part is optional (an older or partial reply). */
export interface NotifyStatus {
  on: boolean;
  since: string;
  last: { at: string; ok: boolean; sent: number; err: string } | null;
  sent: number | null;
  left: number | null;
  from: string;
  users: Record<string, MyNotify>;
}
export function parseNotifyStatus(r: Record<string, unknown>): NotifyStatus {
  const f = parseNotifyFlag(r.notify ?? (typeof r.on !== 'object' ? { on: r.on ?? 0, since: r.since } : null)) || { on: false, since: '' };
  // the script sends last: {} until the trigger's first run (up to 10 minutes after setupNotify): no run yet,
  // not a failed one
  const l = (r.last && typeof r.last === 'object' && (r.last as Record<string, unknown>).at ? r.last : null) as Record<string, unknown> | null;
  const q = (r.quota && typeof r.quota === 'object' ? r.quota : {}) as Record<string, unknown>;
  const users: Record<string, MyNotify> = {};
  if (r.users && typeof r.users === 'object')
    Object.entries(r.users as Record<string, unknown>).forEach(([u, v]) => {
      const p = parseMyNotify(v);
      if (p) users[u] = p;
    });
  return {
    on: f.on,
    since: f.since,
    last: l ? { at: str(l.at, 40), ok: l.ok === true || l.ok === 1, sent: num(l.sent) ?? 0, err: str(l.err, 200) } : null,
    sent: num(r.sentToday ?? r.sent ?? q.sent),
    left: num(r.quotaLeft ?? r.left ?? q.left),
    from: str(r.from ?? r.sender, 120),
    users,
  };
}
/** "รอตรวจ · สรุปทั้งทีม" — what a person gets, for the admin's recipients table. */
export function wantsLine(p: MyNotify, checker: boolean) {
  const out: string[] = [];
  if (checker && p.on.qt) out.push('รอตรวจ');
  if (p.on.res) out.push('ผลตรวจ');
  if (p.on.dg) out.push(p.sc === 'team' ? 'สรุปทั้งทีม' : 'สรุป');
  if (p.on.pre) out.push('ก่อนนัด');
  return out.join(' · ') || 'ปิดอีเมลทั้งหมด';
}

// ------------------------------------------------------------------ the bell

export type BellKind = 'chk' | 'mine' | 'pchk' | 'xchk' | 'pay' | 'appt';
export const BELL_TITLE: Record<BellKind, string> = { chk: 'รอตรวจ', mine: 'ใบเสนอราคาของฉัน', pchk: 'รับเงินที่บัญชีส่งกลับ', xchk: 'ค่าใช้จ่ายที่บัญชีส่งกลับ', pay: 'งวดเงิน', appt: 'นัดหมาย' };
/** The right-hand cell: a time ("วันนี้ 09:40", "10 ต.ค.") or a status chip. */
export interface BellRight { text: string; chip?: '' | 'info' | 'bad' | 'warn' }
export interface BellRow {
  key: string;
  kind: BellKind;
  title: string;
  sub: string;
  right: BellRight;
  /** counted in the bell's number (a quotation checked lately is shown, not counted) */
  count: boolean;
  /** where a click goes: a quotation to check (its deal and document), a deal, a day of the plan */
  go: { deal?: string; doc?: string; day?: string };
}
export interface BellGroup { kind: BellKind; title: string; rows: BellRow[]; n: number }
export interface BellIn {
  S: SalesState;
  tasks: Task[];
  /** the company's ผู้รับผิดชอบ (owner/<gid>) */
  owners: Record<string, string>;
  coName: (gid: number) => string;
  /** who this is (the account's name; '' = nobody: the whole team) */
  me: string;
  /** what the account may do; null = no accounts (everything, but no checks) */
  caps: CapSet | null;
  live: NotifyLive | null;
  checks: Record<string, QtCheck>;
  /** money accounting sent back to this person to fix (lib/payCheck.ts returnedTo / payBackBell) */
  back?: BellRow[];
  /** job expenses accounting sent back to this person to fix (lib/expenseMoney.ts expBackBell) */
  xback?: BellRow[];
  cfg: NotifyCfg;
  scope: Scope;
  today: string;
  /** now, for "วันนี้ 09:40" (tests pass it) */
  now?: Date;
}
const hm = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** "วันนี้ 09:40" for today, else "10 ต.ค.". */
export function whenTh(iso: string, today: string) {
  const day = localDay(iso);
  if (!day) return '';
  return day === today ? `วันนี้ ${hm(iso)}`.trim() : dmTh(day);
}
const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Quotations waiting for this checker: in the check, not checked (or changed since), not their own
 *  unless the team allows it; newest first. */
export function waitingChecks(s: SalesState, checks: Record<string, QtCheck>, me: string, cfg: Pick<NotifyCfg, 'self'>, since: string): DealDoc[] {
  return Object.values(s.docs)
    .filter((doc) => needsCheck(s, doc, since) && qtCheckOf(checks[doc.id], doc).status === 'wait' && (cfg.self || !sameName(doc.by, me)))
    .sort((a, b) => (b.cAt || b.at).localeCompare(a.cAt || a.at));
}

/** The bell's groups (only those with something in them) and its number. */
/** The empty bell's line, by what the account may see: "งวดเงินที่ใกล้ถึงกำหนด และนัดของวันนี้จะขึ้นที่นี่"
 *  (no งวดเงิน without ดูยอดเงิน: the bell lists none then). */
export function bellEmpty(may: (c: CapId) => boolean, qtLive: boolean) {
  const w = [
    may('view.money') && 'งวดเงินที่ใกล้ถึงกำหนด',
    may('view.plan') && 'นัดของวันนี้',
    qtLive && may('qt.check') && 'ใบเสนอราคาที่รอตรวจ',
    qtLive && may('docs.up') && 'ผลตรวจใบเสนอราคาของคุณ',
  ].filter((x): x is string => !!x);
  if (!w.length) return 'เรื่องที่ต้องทำจะขึ้นที่นี่';
  return (w.length === 1 ? w[0] : w.slice(0, -1).join(' ') + ' และ' + w[w.length - 1]) + 'จะขึ้นที่นี่';
}

export function bellItems(x: BellIn): { groups: BellGroup[]; count: number } {
  const { S, me, caps, live, cfg, today } = x;
  const all = caps == null;
  const may = (c: Parameters<typeof can>[1]) => all || can(caps, c);
  const team = x.scope === 'team' || !me;
  const groups: BellGroup[] = [];
  const add = (kind: BellKind, rows: BellRow[]) => rows.length && groups.push({ kind, title: BELL_TITLE[kind], rows, n: rows.filter((r) => r.count).length });
  const checksOn = !!live?.on && !all && !!me;
  const since = live?.since || '';

  // quotations to check (a checker), and mine sent back or checked lately (everyone who attached one)
  if (checksOn && may('qt.check') && may('view.sales'))
    add('chk', waitingChecks(S, x.checks, me, cfg, since).map((doc) => ({
      key: 'q:' + doc.id,
      kind: 'chk',
      title: S.deals[doc.deal]?.client || '',
      sub: [doc.docNo || 'ใบเสนอราคา', doc.amount != null ? fmtMoney(doc.amount) + ' บาท' : '', doc.by ? doc.by + ' แนบ' : ''].filter(Boolean).join(' · '),
      right: { text: whenTh(doc.cAt || doc.at, today) },
      count: true,
      go: { deal: doc.deal, doc: doc.id },
    })));
  if (checksOn && may('view.sales')) {
    const week = addDays(today, -7);
    const mine = Object.values(S.docs)
      .filter((doc) => sameName(doc.by, me) && doc.kind === 'quotation' && doc.target === 'forecast' && doc.stage === QUOTE_STAGE && S.deals[doc.deal]?.jobStatus !== 'closed')
      .map((doc) => ({ doc, v: qtCheckOf(x.checks[doc.id], doc) }))
      .filter(({ v }) => v.rec && (v.status === 'back' || localDay(v.rec.at) >= week))
      .sort((a, b) => (a.v.status === 'back' ? 0 : 1) - (b.v.status === 'back' ? 0 : 1) || b.v.rec!.at.localeCompare(a.v.rec!.at));
    add('mine', mine.map(({ doc, v }) => {
      const r = v.rec!, no = doc.docNo || 'ใบเสนอราคา';
      return {
        key: 'm:' + doc.id,
        kind: 'mine',
        title: S.deals[doc.deal]?.client || '',
        sub: v.status === 'back' ? `${no} · ${r.by} ส่งกลับให้แก้${r.note ? ': ' + short(r.note) : ''}` : `${no} · ${r.by} ตรวจแล้ว ${dmTh(localDay(r.at))}`,
        right: { text: QT_WORD[v.status], chip: v.status === 'ok' ? 'info' : '' },
        count: v.status === 'back',
        go: { deal: doc.deal, doc: doc.id },
      } as BellRow;
    }));
  }

  // money this person recorded (or whose deal is theirs) that accounting sent back
  if (x.back?.length && may('view.sales') && may('view.money')) add('pchk', x.back);
  if (x.xback?.length && may('view.sales') && may('view.money') && may('view.exp')) add('xchk', x.xback);

  // instalments late or due within the team's window (the deal's ผู้รับผิดชอบ, or everyone's)
  if (may('view.sales') && may('view.money')) {
    const deals = Object.values(S.deals).filter((d: Deal) => team || sameName(d.resp, me));
    add('pay', payDue(S, deals, '', addDays(today, cfg.pre), today).map(({ deal: d, line: l }) => {
      const late = l.lateDays > 0;
      const amt = l.left > 0 ? l.left : l.amt;
      return {
        key: `p:${d.id}/${l.stage}`,
        kind: 'pay',
        title: d.client,
        sub: [l.stage, amt ? fmtMoney(amt) + ' บาท' : '', 'ครบกำหนด ' + dmTh(l.due), team && d.resp ? d.resp : ''].filter(Boolean).join(' · '),
        right: late ? { text: `เลยกำหนด ${l.lateDays} วัน`, chip: 'bad' } : { text: l.due === today ? 'ถึงกำหนดวันนี้' : `ถึงกำหนด ${daysBetween(today, l.due)} วัน`, chip: 'warn' },
        count: true,
        go: { deal: d.id },
      } as BellRow;
    }));
  }

  // appointments of the plan due today or late (the company's ผู้รับผิดชอบ, or everyone's), late first
  if (may('view.plan')) {
    const ty = (t: Task) => (TT.find((y) => y[0] === t.type) || TT[0])[1];
    const tasks = x.tasks
      .filter((t) => !t.done && t.date && t.date <= today && (team || sameName(x.owners[String(t.gid)], me)))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
    add('appt', tasks.map((t) => {
      const late = t.date < today, name = x.coName(t.gid) || t.title;
      const what = t.note.trim() || (t.title && t.title !== name ? t.title : '');
      return {
        key: 't:' + t.id,
        kind: 'appt',
        title: name,
        sub: [ty(t), short(what), late ? `${dmTh(t.date)}${t.time ? ' ' + t.time : ''}` : ''].filter(Boolean).join(' · '),
        right: late ? { text: `เกินกำหนด ${daysBetween(t.date, today)} วัน`, chip: 'bad' } : { text: t.time ? `วันนี้ ${t.time}` : 'วันนี้' },
        count: true,
        go: { day: t.date },
      } as BellRow;
    }));
  }
  return { groups, count: groups.reduce((a, g) => a + g.n, 0) };
}

/** The names in ผู้รับผิดชอบ (deals still open) and owner/<gid> (companies with an appointment still to
 *  do) that match no account, with how many of those each has: nobody gets their e-mail. */
export function unmatchedNames(s: SalesState, tasks: Task[], owners: Record<string, string>, accounts: string[]): { name: string; n: number }[] {
  const m = new Map<string, { name: string; n: number }>();
  const bump = (name: string) => {
    const k = name.trim();
    if (!k || accounts.some((a) => sameName(a, k))) return;
    const key = k.toLowerCase();
    const cur = m.get(key) || { name: k, n: 0 };
    cur.n++;
    m.set(key, cur);
  };
  Object.values(s.deals).forEach((d) => d.jobStatus !== 'closed' && bump(d.resp || ''));
  tasks.forEach((t) => !t.done && bump(owners[String(t.gid)] || ''));
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'th'));
}

// ------------------------------------------------------------------ links from the e-mails

/** Where a link in an e-mail goes (`#go=…` on the site; the hash never reaches a server, and the link
 *  carries no authority: the check still needs a signed-in checker). */
export type GoLink =
  | { go: 'qt'; doc: string; s: string }
  | { go: 'deal'; id: string }
  | { go: 'plan'; d: string }
  | { go: 'notify' }
  | { go: 'reqs' }
  | { go: 'cash'; m: string; f: string };
const ID = /^[A-Za-z0-9_.-]{1,80}$/;
export function parseGo(hash: string): GoLink | null {
  if (!/^#go=/.test(hash || '')) return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(hash.slice(1));
  } catch {
    return null;
  }
  const g = (k: string) => (p.get(k) || '').trim();
  switch (g('go')) {
    case 'qt':
      // s = '<exp>.<signature>.<username>' as the script signs it (usernames may hold . _ -)
      return ID.test(g('doc')) ? { go: 'qt', doc: g('doc'), s: /^[A-Za-z0-9_.-]{1,200}$/.test(g('s')) ? g('s') : '' } : null;
    case 'deal':
      return ID.test(g('id')) ? { go: 'deal', id: g('id') } : null;
    case 'plan':
      return /^\d{4}-\d\d-\d\d$/.test(g('d')) ? { go: 'plan', d: g('d') } : { go: 'plan', d: '' };
    case 'notify':
      return { go: 'notify' };
    case 'reqs':
      return { go: 'reqs' };
    case 'cash':
      return { go: 'cash', m: /^\d{4}-\d\d$/.test(g('m')) ? g('m') : '', f: /^[a-z]{1,10}$/.test(g('f')) ? g('f') : '' };
    default:
      return null;
  }
}

/** "จันทร์ 12 ต.ค." for the bell's head. */
const DOW_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const dayTh = (iso: string) => `${DOW_TH[new Date(iso + 'T00:00:00Z').getUTCDay()]} ${dmTh(iso)}`;
