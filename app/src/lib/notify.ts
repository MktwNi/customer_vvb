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
import { BUILTIN, can, resolveCaps, sameName, type CapId, type CapSet, type Grants } from './caps';
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
 *  notifications (deployed before them). Accepts `notify: 0|1|true|false` or `{on, since, now?}`; `now` = a
 *  push mails a new quotation's checkers itself (scripts before that one say nothing: the timer, within 10
 *  minutes). */
export interface NotifyLive { on: boolean; since: string; now?: boolean }
export function parseNotifyFlag(x: unknown): NotifyLive | null {
  if (x === 0 || x === 1 || typeof x === 'boolean') return { on: !!x, since: '' };
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  // (a person's own settings look different: `on` is an object of switches there)
  if (!(o.on === 0 || o.on === 1 || typeof o.on === 'boolean')) return null;
  const since = typeof o.since === 'string' && /^\d{4}-\d\d-\d\d/.test(o.since) ? o.since.slice(0, 10) : '';
  const out: NotifyLive = { on: !!o.on, since };
  if (o.now === 0 || o.now === 1 || typeof o.now === 'boolean') out.now = !!o.now;
  return out;
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
  /** a push mails new quotations itself (null: a script that does not say) */
  now: boolean | null;
  /** the latest quotation mails and decisions, newest first (the notify tab of the team's sheet) */
  recent: { at: string; doc: string; u: string; result: string }[];
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
    now: r.now === 0 || r.now === 1 || typeof r.now === 'boolean' ? !!r.now : null,
    recent: Array.isArray(r.recent)
      ? (r.recent as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').map((x) => ({ at: str(x.at, 40), doc: str(x.doc, 80), u: str(x.u, 40), result: str(x.result, 60) })).filter((x) => x.doc)
      : [],
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

// ------------------------------------------------------------------ who heard of a quotation this account attached or edited

/**
 * Why a quotation reached no checker by e-mail yet, or why it waits. From the script's push reply (`qt[].why`):
 * 'nochk' no other account checks quotations; 'self' none either, but the team lets whoever attached or changed it
 * check their own; 'nomail' the checkers can't get mail (see `skip`); 'file' the file is not in the team's Drive
 * yet; 'quota' the day's mail is used up (`later` waits for it); 'timer' the script mails `later` with its timer
 * only; 'old' not news (attached days ago); 'bulk' an import; 'err' the mail failed (tried again). This browser's
 * own word when the script says nothing (`local`): 'script' a script without notifications, 'off' notifications
 * not set up, 'tick' the release before immediate mail (its timer mails the other checkers it can, unnamed here);
 * for an admin, who that timer mails or why nobody, from the team's accounts (qtLocalOutcome).
 */
export type QtWhy = '' | 'nochk' | 'self' | 'nomail' | 'file' | 'quota' | 'timer' | 'old' | 'bulk' | 'err' | 'script' | 'off' | 'tick';
/** Why one checker gets no mail: a role without e-mail, no address, not confirmed, quotation mails off. */
export type QtSkip = 'role' | 'noem' | 'unverified' | 'off';
export interface QtSent {
  /** the document */
  id: string;
  /** the version it is about (qtFpKey of the document as pushed): a later edit not reported yet makes it stale */
  fp: string;
  /** when this browser heard it */
  at: string;
  what: 'new' | 'rev' | 'edit';
  /** mailed, now or by an earlier push of this version */
  to: string[];
  /** the script's timer mails them (within 10 minutes) */
  later: string[];
  /** checkers who see it in their bell, mailed or not */
  bell: string[];
  skip: { n: string; r: QtSkip }[];
  why: QtWhy;
  /** this browser's word: the script's reply said nothing */
  local?: boolean;
}
/** The version key of a document for QtSent.fp (what a check compares, as text). */
export const qtFpKey = (doc: Pick<DealDoc, 'amount' | 'docNo' | 'docDate' | 'name' | 'size'>) => JSON.stringify(fpOf(doc));
const WHYS: QtWhy[] = ['', 'nochk', 'self', 'nomail', 'file', 'quota', 'timer', 'old', 'bulk', 'err', 'script', 'off', 'tick'];
const SKIPS: QtSkip[] = ['role', 'noem', 'unverified', 'off'];
const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.slice(0, 60)).slice(0, 25) : []);
/** One item of a push reply's `qt` (see Code.gs "E-mail"): { k: the document's key, and the outcome }; null
 *  when it is not one. */
export function parseQtOut(x: unknown): { k: string; o: Omit<QtSent, 'fp' | 'at'> } | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const k = str(r.k, 300), id = str(r.id, 80);
  if (!/^ddoc\/[^/]+\/[^/]+$/.test(k) || !id || !k.endsWith('/' + id)) return null;
  const skip = (Array.isArray(r.skip) ? r.skip : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ n: str(s.n, 60), r: s.r as QtSkip }))
    .filter((s) => s.n && SKIPS.includes(s.r));
  return {
    k,
    o: {
      id,
      what: r.what === 'rev' || r.what === 'edit' ? r.what : 'new',
      to: names(r.to),
      later: names(r.later),
      bell: names(r.bell),
      skip,
      why: WHYS.includes(r.why as QtWhy) ? (r.why as QtWhy) : '',
    },
  };
}
/** "มกร" · "มกร, สมชาย" · "มกร, สมชาย, หมิว และอีก 2 คน". */
export function nameList(l: string[]) {
  return l.length <= 3 ? l.join(', ') : `${l.slice(0, 3).join(', ')} และอีก ${l.length - 3} คน`;
}
const SKIP_TH: Record<QtSkip, string> = { role: 'บทบาทไม่รับอีเมล', noem: 'ยังไม่ใส่อีเมล', unverified: 'ยังไม่ยืนยันอีเมล', off: 'ปิดอีเมลรอตรวจไว้' };
/** "สมชาย ยังไม่ใส่อีเมล · หมิว ยังไม่ยืนยันอีเมล". */
export const skipLine = (skip: QtSent['skip']) => skip.map((s) => `${s.n} ${SKIP_TH[s.r]}`).join(' · ');

export interface QtSentView {
  /** sent: someone was mailed · later: the timer mails it · none: nobody gets a mail (`text` says why) · wait:
   *  nothing known here (attached on another device, or before this) */
  state: 'sent' | 'later' | 'none' | 'wait';
  /** the sentence for the bell and the message after attaching */
  text: string;
  /** a few words for the quotation's card, after "รอตรวจ" */
  short: string;
  /** what can be done about it, by whoever manages the team: set a checker, addresses, the script */
  fix: '' | 'checker' | 'email' | 'setup';
  /** something this account can fix (counted in the bell) */
  count: boolean;
}
/** Who heard of a quotation, as the viewer sees it: `admin` = manages users (can fix what is missing); `checker` =
 *  holds ตรวจ/อนุมัติใบเสนอราคา itself; `self` = the team lets whoever attached or changed a quotation check it
 *  (scfg/notify.cfg self; left out: as the script said). */
export interface QtSentCtx { admin: boolean; checker?: boolean; self?: boolean }
/**
 * In words, what happened to a quotation this account attached or edited (the bell's ใบเสนอราคาของฉัน, the card,
 * the message after attaching).
 */
export function qtSentView(o: QtSent | null | undefined, ctx: QtSentCtx): QtSentView {
  const admin = ctx.admin;
  const v = (state: QtSentView['state'], text: string, short: string, fix: QtSentView['fix'] = '', count = false): QtSentView => ({ state, text, short, fix, count });
  if (!o) return v('wait', 'รอผู้ตรวจ', 'รอผู้ตรวจ');
  if (o.to.length) {
    const more = !o.later.length ? '' : o.why === 'quota' ? ` · ${nameList(o.later)} รอโควตาอีเมลของวันนี้ ส่งเองเมื่อโควตากลับมา` : ` · ${nameList(o.later)} จะได้ภายใน 10 นาที`;
    return v('sent', `ส่งให้ผู้ตรวจแล้ว: ${nameList(o.to)}${more}`, `ส่งให้ ${nameList(o.to)} แล้ว`);
  }
  // the release before immediate mail: its timer mails the other checkers it can, and says nothing of whom
  if (o.why === 'tick' || (o.why === 'timer' && !o.later.length))
    return v(
      'later',
      'สคริปต์ของทีมรุ่นนี้ส่งอีเมลตามรอบทุก 10 นาที ถึงผู้ตรวจคนอื่นที่ยืนยันอีเมลแล้ว (ถ้ามี)' + (admin ? ' · อัปเดตสคริปต์เพื่อส่งทันทีและดูว่าส่งถึงใคร' : ''),
      'ส่งตามรอบ 10 นาที',
      admin ? 'setup' : '',
    );
  if (o.later.length) {
    if (o.why === 'file') return v('later', 'รออัปโหลดไฟล์ขึ้น Drive ของทีม แล้วจะส่งให้ผู้ตรวจทันที', 'รออัปโหลดไฟล์');
    if (o.why === 'quota') return v('later', `วันนี้ส่งอีเมลครบโควตาแล้ว จะส่งให้${o.later.length ? ' ' + nameList(o.later) + ' ' : 'ผู้ตรวจ'}เมื่อโควตากลับมา · ผู้ตรวจเห็นในกระดิ่งแล้ว`, 'รอโควตาอีเมล');
    const who = o.later.length ? `: ${nameList(o.later)}` : '';
    return v('later', `จะส่งอีเมลให้ผู้ตรวจภายใน 10 นาที${who}`, 'ส่งภายใน 10 นาที');
  }
  // no other checker: with self-check on (as the team has it now) whoever attached or changed it checks it
  const why = (o.why === 'nochk' || o.why === 'self') && ctx.self !== undefined ? (ctx.self && (o.why === 'self' || ctx.checker) ? 'self' : 'nochk') : o.why;
  switch (why) {
    case 'self':
      return v('none', ctx.checker ? 'ไม่มีผู้ตรวจคนอื่นได้อีเมล · คุณตรวจใบนี้เองได้' : 'ไม่มีผู้ตรวจคนอื่นได้อีเมล · ผู้แนบตรวจใบนี้เองได้', 'ตรวจเองได้');
    case 'nochk':
      return admin
        ? v('none', ctx.checker ? `รอผู้ตรวจคนอื่น: ยังไม่มีบัญชีอื่นที่ตรวจใบเสนอราคาได้ ${o.what === 'edit' ? 'ใบที่คุณแก้' : 'ใบที่คุณแนบเอง'}จึงไม่ได้ส่งให้ใคร` : 'ยังไม่มีบัญชีที่ตรวจใบเสนอราคาได้ ใบนี้จึงไม่ได้ส่งให้ใคร', 'รอผู้ตรวจคนอื่น', 'checker', true)
        : v('none', 'ยังไม่มีผู้ตรวจคนอื่น ใบนี้จึงไม่ได้ส่งให้ใคร แจ้งผู้ดูแลระบบให้ตั้งผู้ตรวจ', 'ยังไม่มีผู้ตรวจ');
    case 'nomail': {
      const why = skipLine(o.skip);
      return v('none', `${nameList(o.bell)} เห็นในกระดิ่งแล้ว แต่ยังไม่ได้อีเมล${why ? ': ' + why : ''}`, 'ผู้ตรวจเห็นในกระดิ่ง', admin ? 'email' : '', admin);
    }
    case 'off':
      return v('none', 'ยังไม่ได้แจ้งผู้ตรวจ: ผู้ดูแลระบบยังไม่ได้เปิดการส่งอีเมล (Run setupNotify ในสคริปต์ของทีม)', 'ยังไม่เปิดการแจ้งเตือน', admin ? 'setup' : '', admin);
    case 'script':
      return v('none', 'ยังไม่ได้แจ้งผู้ตรวจ: สคริปต์ของทีมยังเป็นรุ่นที่ไม่มีการแจ้งเตือน ผู้ดูแลระบบต้องอัปเดตสคริปต์', 'สคริปต์ยังไม่อัปเดต', admin ? 'setup' : '', admin);
    case 'old':
      return v('none', 'ไม่ได้ส่งอีเมล เพราะแนบไว้เกิน 2 วันแล้ว ผู้ตรวจเห็นในกระดิ่งและในสรุปวันนี้', 'ผู้ตรวจเห็นในกระดิ่ง');
    case 'bulk':
      return v('none', 'แนบพร้อมกันหลายใบ (นำเข้า) จึงไม่ส่งอีเมล ผู้ตรวจเห็นในกระดิ่งและในสรุปวันนี้', 'ผู้ตรวจเห็นในกระดิ่ง');
    case 'err':
      return v('later', 'ส่งอีเมลไม่สำเร็จ ระบบจะลองใหม่ภายใน 10 นาที', 'ส่งภายใน 10 นาที');
    default:
      return v('wait', 'รอผู้ตรวจ', 'รอผู้ตรวจ');
  }
}
/** The card's few words while a quotation waits: who was told (as this browser heard it), else since when;
 *  `stale` = it changed after a check. */
export function waitShort(o: QtSent | null | undefined, doc: Pick<DealDoc, 'cAt' | 'at'>, ctx: QtSentCtx, stale = false) {
  const w = o ? qtSentView(o, ctx).short : '';
  if (stale) return w ? `แก้หลังตรวจ · ${w}` : 'แก้หลังตรวจ รอตรวจอีกครั้ง';
  return w || `รอผู้ตรวจ ตั้งแต่ ${dmTh(qtDayOf(doc))}`;
}
/** Whether a new outcome is worth a message after attaching: a mail went to someone new, or nobody can be
 *  reached for a reason not said before (an upload in progress, an import or an old quotation say nothing). */
export function qtSentNews(was: QtSent | null | undefined, now: QtSent) {
  if (now.why === 'file' || now.why === 'bulk' || now.why === 'old') return false;
  if (!was || was.fp !== now.fp) return true;
  if (now.to.some((n) => !was.to.includes(n))) return true;
  return !now.to.length && !was.to.length && (now.why !== was.why || now.later.length !== was.later.length);
}

/** The team's accounts as an admin reads them (engine TeamDir): enough to know who checks and who gets mail. */
export interface DirLike {
  users: { u: string; name: string; role: string; on: number | boolean; em?: string; ok?: number | boolean; notify?: unknown }[];
  roles: { id: string; c: CapSet }[];
  grants: Record<string, Grants>;
  /** the script has configurable roles (else the built-in ones stand in) */
  v4: boolean;
}
/** The active accounts of a directory, with what each may do today and gets by e-mail (the admin page's people). */
export function dirPeople(dir: DirLike, today: string): MailPerson[] {
  const roles = Object.fromEntries((dir.v4 ? dir.roles : Object.values(BUILTIN)).map((r) => [r.id, r.c]));
  return dir.users
    .filter((u) => u.on === 1 || u.on === true)
    .map((u) => {
      const caps = resolveCaps(u.role, roles, dir.grants[u.u], today);
      return { u: u.u, name: u.name, caps, em: u.em || '', ok: u.ok === 1 || u.ok === true, nf: parseMyNotify(u.notify, can(caps, 'set.users')) };
    });
}
/**
 * What a script of the release before immediate mail (its timer mails the quotation, its push says nothing) will
 * do about a quotation `me` attached or changed (`by` = who attached it), from the team's active accounts: the
 * other checkers its timer mails ('timer', `later`), or why nobody ('nomail' with `skip`, 'self', 'nochk'), as the
 * script of this release words it. Never `me` or `by` (they know).
 */
export function qtLocalOutcome(x: { people: MailPerson[]; me: string; by: string; self: boolean }): Pick<QtSent, 'to' | 'later' | 'bell' | 'skip' | 'why'> {
  const chk = (p: MailPerson) => can(p.caps, 'qt.check') && can(p.caps, 'view.sales');
  const others = x.people.filter((p) => chk(p) && !sameName(p.name, x.by) && !sameName(p.name, x.me));
  const skip = others.map((p) => ({ n: p.name, r: personSkip(p) })).filter((y): y is { n: string; r: QtSkip } => !!y.r);
  const later = others.filter((p) => !personSkip(p)).map((p) => p.name);
  const bell = others.map((p) => p.name);
  if (later.length) return { to: [], later, bell, skip, why: 'timer' };
  if (others.length) return { to: [], later: [], bell, skip, why: 'nomail' };
  const own = x.self && x.people.some((p) => chk(p) && (sameName(p.name, x.by) || sameName(p.name, x.me)));
  return { to: [], later: [], bell: [], skip: [], why: own ? 'self' : 'nochk' };
}

// ------------------------------------------------------------------ why mail does not arrive (diagnosis)

export type IssueTone = 'bad' | 'warn' | 'info' | 'ok';
export interface MailIssue { k: string; tone: IssueTone; text: string; fix: string }
/** A team member as the admin page knows them: name, what they may do, their address and settings. */
export interface MailPerson { u: string; name: string; caps: CapSet; em: string; ok: boolean; nf: MyNotify | null }
/** Why one checker gets no quotation mail ('' = they do). */
export function personSkip(p: MailPerson): QtSkip | '' {
  if (!can(p.caps, 'notify.mail')) return 'role';
  if (!p.em) return 'noem';
  if (!p.ok) return 'unverified';
  return p.nf && !p.nf.on.qt ? 'off' : '';
}
/**
 * ผู้ใช้และสิทธิ์ › การแจ้งเตือน: why quotation mail is not arriving, in order, each with its fix. `live` = what the
 * script's hello said (null: no notifications in it); `st` = notify_status (null while it loads or failed);
 * `people` = the active accounts; `self` = the attacher may check their own.
 */
export function mailIssues(x: { live: NotifyLive | null; st: NotifyStatus | null; people: MailPerson[]; self: boolean }): MailIssue[] {
  const out: MailIssue[] = [];
  const { live, st } = x;
  if (!live)
    return [{ k: 'script', tone: 'bad', text: 'สคริปต์ของทีมยังเป็นรุ่นที่ส่งอีเมลไม่ได้ ใบเสนอราคาที่แนบจึงไม่มีการแจ้งผู้ตรวจเลย', fix: 'เจ้าของสคริปต์วางโค้ดรุ่นใหม่ Run “setupNotify” แล้ว Deploy เป็น New version (3 ขั้นด้านบน)' }];
  if (!live.on)
    return [{ k: 'setup', tone: 'bad', text: 'สคริปต์รุ่นใหม่แล้ว แต่ยังไม่ได้เปิดการส่งอีเมล', fix: 'เจ้าของสคริปต์เลือกฟังก์ชัน “setupNotify” กด Run แล้วกดอนุญาต (ข้อ 2 และ 3 ด้านบน)' }];
  if (st && !st.on)
    out.push({
      k: 'trigger', tone: 'bad', text: 'ไม่พบตัวตั้งเวลาของสคริปต์',
      fix: (live.now ? 'อีเมลใบเสนอราคาใหม่ยังส่งทันทีตอนแนบ แต่สรุปวันนี้ ผลตรวจ และอีเมลที่ส่งไม่ทันจะไม่ออก · ' : 'ตอนนี้ไม่มีอีเมลออกเลย · ') + 'เจ้าของสคริปต์เลือก “setupNotify” แล้วกด Run อีกครั้ง',
    });
  if (live.now === false || st?.now === false)
    out.push({ k: 'now', tone: 'info', text: 'อีเมลใบเสนอราคาใหม่ส่งตามรอบทุก 10 นาที ไม่ได้ส่งทันทีที่แนบ', fix: 'เจ้าของสคริปต์ลบ NOTIFY_NOW ใน Script properties (ตั้งเป็น 0 ไว้) แล้วจะส่งทันทีที่แนบ' });
  else if (live.now === undefined && (st?.now ?? null) === null)
    out.push({
      k: 'tick', tone: 'warn', text: 'สคริปต์ของทีมยังเป็นรุ่นก่อน อีเมลใบเสนอราคาใหม่จึงส่งตามรอบทุก 10 นาที ไม่ได้ส่งทันทีที่แนบ และคนแนบไม่เห็นว่าส่งถึงใคร',
      fix: 'เจ้าของสคริปต์วางโค้ด Code.gs รุ่นล่าสุดทับ (เก็บบรรทัด TEAM_KEY เดิมไว้) แล้วกด Deploy › Manage deployments › Edit › New version',
    });
  const checkers = x.people.filter((p) => can(p.caps, 'qt.check'));
  if (!checkers.length) out.push({ k: 'nochk', tone: 'bad', text: 'ยังไม่มีใครตรวจใบเสนอราคาได้ ใบที่แนบจึงไม่ส่งให้ใคร', fix: 'ให้สิทธิ์ “ตรวจ/อนุมัติใบเสนอราคา” กับบทบาทหรือผู้ใช้ที่ตรวจ ที่ บทบาทและสิทธิ์' });
  else if (checkers.length === 1 && !x.self)
    out.push({
      k: 'solo', tone: 'warn', text: `มีผู้ตรวจคนเดียวคือ ${checkers[0].name} ใบที่ ${checkers[0].name} แนบหรือแก้เองจึงไม่มีใครได้อีเมล`,
      fix: 'ให้สิทธิ์ “ตรวจ/อนุมัติใบเสนอราคา” กับอีกคน หรือเปิด “ผู้แนบตรวจใบของตัวเองได้” ด้านล่าง',
    });
  else if (checkers.length === 1)
    out.push({
      k: 'solo', tone: 'info', text: `มีผู้ตรวจคนเดียวคือ ${checkers[0].name} ใบที่ ${checkers[0].name} แนบหรือแก้เองไม่มีอีเมลถึงใคร ${checkers[0].name} ตรวจเองในเว็บได้ (เปิด “ผู้แนบตรวจใบของตัวเองได้” ไว้)`,
      fix: 'ถ้าต้องการคนตรวจคนที่สอง ให้สิทธิ์ “ตรวจ/อนุมัติใบเสนอราคา” กับอีกคน',
    });
  const blocked = checkers.map((p) => ({ p, r: personSkip(p) })).filter((y) => y.r);
  if (checkers.length && blocked.length) {
    const all = blocked.length === checkers.length;
    out.push({
      k: 'noem', tone: all ? 'bad' : 'warn',
      text: (all ? 'ผู้ตรวจยังไม่มีใครรับอีเมลได้ (เห็นในกระดิ่งเท่านั้น): ' : 'ผู้ตรวจบางคนไม่ได้อีเมล: ') + blocked.map((y) => `${y.p.name} ${SKIP_TH[y.r as QtSkip]}`).join(' · '),
      fix: 'ใส่อีเมลที่แท็บ บัญชีผู้ใช้ แล้วให้เจ้าของบัญชีใส่รหัส 6 หลักที่ “การแจ้งเตือนของฉัน” · คนที่ปิดอีเมลไว้ เปิดได้ที่เดียวกัน',
    });
  }
  if (st?.left === 0) out.push({ k: 'quota', tone: 'bad', text: 'วันนี้ส่งอีเมลครบโควตาของบัญชี Google แล้ว', fix: 'อีเมลที่ค้างจะส่งเองเมื่อโควตากลับมา (ภายใน 24 ชั่วโมง) · ผู้ตรวจยังเห็นในกระดิ่ง' });
  else if (st?.left != null && st.left <= 5) out.push({ k: 'quota', tone: 'warn', text: `วันนี้ส่งอีเมลได้อีก ${st.left} ฉบับ`, fix: 'ที่เหลือเก็บไว้ให้ใบเสนอราคาใหม่ก่อน สรุปวันนี้จะรอวันถัดไป' });
  if (st?.last && !st.last.ok && st.last.err) out.push({ k: 'last', tone: 'warn', text: 'รอบล่าสุดของสคริปต์มีปัญหา: ' + st.last.err, fix: 'ดู Executions ใน Apps Script หรือ Run “setupNotify” อีกครั้ง' });
  return out;
}
/** The latest quotations the script decided about (notify_status `recent`, newest first), one line each:
 *  who got the mail, who waits for it, or why nobody did. `nameOf` = an account's display name. */
export interface RecentQt { doc: string; at: string; sent: string[]; later: string[]; none: '' | 'nochk' | 'nomail' | 'self' | 'old' | 'bulk'; err: boolean }
export function recentQts(recent: NotifyStatus['recent'], nameOf: (u: string) => string, max = 5): RecentQt[] {
  const out: RecentQt[] = [];
  const by = new Map<string, RecentQt>();
  for (const r of recent) {
    let q = by.get(r.doc);
    if (!q) {
      if (out.length >= max) continue;
      q = { doc: r.doc, at: r.at, sent: [], later: [], none: '', err: false };
      by.set(r.doc, q);
      out.push(q);
    }
    const n = r.u ? nameOf(r.u) || r.u : '';
    // newest first: an account's first row is its latest word
    const said = q.sent.includes(n) || q.later.includes(n);
    if (r.result === 'sent' && n && !said) q.sent.push(n);
    else if (r.result === 'retry' && n && !said) q.later.push(n);
    else if (r.result === 'error') q.err = true;
    else if (/^none:(nochk|nomail|self)$/.test(r.result) && !q.none) q.none = r.result.slice(5) as 'nochk' | 'nomail' | 'self';
    else if (r.result === 'skipped-old' && !q.none) q.none = 'old';
    else if (r.result === 'skipped-bulk' && !q.none) q.none = 'bulk';
  }
  return out;
}
/** One recent quotation in words: "ส่งให้ มกร, สมชาย" · "ไม่ได้ส่ง: ไม่มีผู้ตรวจคนอื่น". */
export function recentLine(q: RecentQt) {
  if (q.sent.length) return `ส่งให้ ${nameList(q.sent)}${q.later.length ? ` · รอส่ง ${nameList(q.later)}` : ''}`;
  if (q.later.length) return `รอส่ง ${nameList(q.later)}`;
  if (q.none === 'nochk') return 'ไม่ได้ส่ง: ไม่มีผู้ตรวจคนอื่น (คนแนบตรวจเองไม่ได้)';
  if (q.none === 'nomail') return 'ไม่ได้ส่ง: ผู้ตรวจยังรับอีเมลไม่ได้ (เห็นในกระดิ่ง)';
  if (q.none === 'self') return 'ไม่ได้ส่ง: ไม่มีผู้ตรวจคนอื่น (คนแนบตรวจเองได้)';
  if (q.none === 'old') return 'ไม่ได้ส่ง: แนบไว้เกิน 2 วันแล้ว';
  if (q.none === 'bulk') return 'ไม่ได้ส่ง: นำเข้าหลายใบพร้อมกัน';
  return q.err ? 'ส่งไม่สำเร็จ' : 'กำลังส่ง';
}
/**
 * การแจ้งเตือนของฉัน: why this account's own mail may not arrive, each with its fix ([] = ready). `live` from the
 * script's hello; `mail` = the role may get mail; `nf` = the settings as saved; `checker` = holds ตรวจ/อนุมัติ.
 */
export function myMailIssues(x: { live: NotifyLive | null; mail: boolean; nf: MyNotify; checker: boolean }): MailIssue[] {
  if (!x.live) return [{ k: 'script', tone: 'warn', text: 'สคริปต์ของทีมยังส่งอีเมลไม่ได้', fix: 'ผู้ดูแลระบบอัปเดตสคริปต์ของทีม (ดูหน้า ผู้ใช้และสิทธิ์ แท็บ การแจ้งเตือน)' }];
  const out: MailIssue[] = [];
  if (!x.live.on) out.push({ k: 'setup', tone: 'warn', text: 'ผู้ดูแลระบบยังไม่ได้เปิดการส่งอีเมล', fix: 'ตั้งค่าไว้ก่อนได้ จะเริ่มส่งเมื่อเจ้าของสคริปต์ Run “setupNotify”' });
  if (!x.mail) return out.concat([{ k: 'role', tone: 'info', text: 'บทบาทนี้ไม่รับอีเมล', fix: 'กระดิ่งในเว็บยังแจ้งเตือนตามปกติ' }]);
  if (!x.nf.em) out.push({ k: 'noem', tone: 'warn', text: 'ยังไม่ได้ใส่อีเมล จึงยังไม่มีอีเมลถึงคุณ', fix: 'ใส่อีเมลด้านล่าง กดบันทึก แล้วใส่รหัส 6 หลักที่ส่งไป' });
  else if (!x.nf.ok) out.push({ k: 'unverified', tone: 'warn', text: 'อีเมลยังไม่ได้ยืนยัน จึงยังไม่ส่ง', fix: 'ใส่รหัส 6 หลักจากอีเมล หรือกด “ส่งรหัสใหม่”' });
  if (x.checker && !x.nf.on.qt) out.push({ k: 'off', tone: 'info', text: 'ปิด “ใบเสนอราคาใหม่รอตรวจ” ไว้ จะไม่ได้อีเมลเมื่อมีคนแนบ', fix: 'ติ๊กด้านล่างแล้วกดบันทึก · ใบที่รอตรวจยังขึ้นในกระดิ่ง' });
  else if (x.checker && x.live.on && x.live.now === undefined)
    out.push({ k: 'tick', tone: 'info', text: 'อีเมลใบเสนอราคาใหม่มาตามรอบทุก 10 นาที ยังไม่ได้มาทันทีที่แนบ', fix: 'ผู้ดูแลระบบอัปเดตสคริปต์ของทีมเป็นรุ่นล่าสุดเพื่อให้ส่งทันที · ใบที่รอตรวจขึ้นในกระดิ่งทันทีที่ซิงก์' });
  return out;
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
  /** a link under the row for what can be done about it (ผู้ใช้และสิทธิ์ › การแจ้งเตือน) */
  act?: { label: string; to: 'notify' };
  /** the line under the title may take two lines (a reason) */
  wrap?: boolean;
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
  /** what happened to quotations this account attached or edited (engine qtSent), by document id */
  sent?: Record<string, QtSent>;
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
  // my quotations: sent back (to fix), waiting (who was told, or why nobody was), checked lately
  const week = addDays(today, -7);
  const admin = !all && can(caps, 'set.users');
  const inChk = cfg.self && may('qt.check'); // my own waiting ones are in my รอตรวจ instead
  const waitRow = (doc: DealDoc, o: QtSent | null, stale = false): BellRow => {
    const w = qtSentView(o, { admin, checker: may('qt.check'), self: cfg.self });
    return {
      key: 'w:' + doc.id,
      kind: 'mine',
      title: S.deals[doc.deal]?.client || '',
      sub: `${doc.docNo || 'ใบเสนอราคา'} · ${w.state === 'wait' && stale ? 'แก้แล้ว รอตรวจอีกครั้ง' : w.text}`,
      // no check here yet (the script has no notifications, or they are not set up): nothing waits for a checker
      right: { text: o?.why === 'script' || o?.why === 'off' ? 'ยังไม่ได้แจ้ง' : QT_WORD.wait, chip: '' },
      count: w.count,
      go: { deal: doc.deal, doc: doc.id },
      wrap: w.state !== 'wait',
      ...(w.fix && admin ? { act: { label: w.fix === 'checker' ? 'ตั้งผู้ตรวจ' : w.fix === 'email' ? 'ดูผู้รับอีเมล' : o?.why === 'tick' ? 'ดูวิธีอัปเดตสคริปต์' : 'ดูวิธีเปิดการแจ้งเตือน', to: 'notify' as const } } : {}),
    };
  };
  const recent = (o: QtSent) => localDay(o.at) >= week;
  if (checksOn && may('view.sales')) {
    const mine = Object.values(S.docs)
      .filter((doc) => sameName(doc.by, me) && doc.kind === 'quotation' && doc.target === 'forecast' && doc.stage === QUOTE_STAGE && S.deals[doc.deal]?.jobStatus !== 'closed')
      .map((doc) => ({ doc, v: qtCheckOf(x.checks[doc.id], doc) }));
    const done = mine
      .filter(({ v }) => v.rec && (v.status === 'back' || localDay(v.rec.at) >= week))
      .map(({ doc, v }) => {
        const r = v.rec!, no = doc.docNo || 'ใบเสนอราคา';
        return {
          row: {
            key: 'm:' + doc.id,
            kind: 'mine',
            title: S.deals[doc.deal]?.client || '',
            sub: v.status === 'back' ? `${no} · ${r.by} ส่งกลับให้แก้${r.note ? ': ' + short(r.note) : ''}` : `${no} · ${r.by} ตรวจแล้ว ${dmTh(localDay(r.at))}`,
            right: { text: QT_WORD[v.status], chip: v.status === 'ok' ? 'info' : '' },
            count: v.status === 'back',
            go: { deal: doc.deal, doc: doc.id },
          } as BellRow,
          o: v.status === 'back' ? 0 : 2,
          at: r.at,
        };
      });
    // waiting (attached or confirmed in the last 7 days, or with something to fix): who was told, or why nobody was
    // (the check is of the amounts: none without ดูยอดเงิน)
    const waits = mine
      .filter(({ doc, v }) => v.status === 'wait' && !inChk && may('view.money') && needsCheck(S, doc, since))
      .map(({ doc, v }) => {
        const o = x.sent?.[doc.id];
        const cur = o && o.fp === qtFpKey(doc) ? o : null;
        return { row: waitRow(doc, cur, !!v.stale), o: 1, at: cur?.at || doc.cAt || doc.at || '' };
      })
      .filter((y) => y.row.count || localDay(y.at) >= week);
    add('mine', [...done, ...waits].sort((a, b) => a.o - b.o || b.at.localeCompare(a.at)).map((y) => y.row));
  } else if (!all && me && may('view.sales') && may('view.money') && x.sent) {
    // no checks here yet (a script without notifications, or not set up): what attaching said, lately
    const rows = Object.values(x.sent)
      .filter((o) => o.local && (o.why === 'script' || o.why === 'off') && recent(o))
      .map((o) => ({ o, doc: docById(S, o.id) }))
      .filter((y): y is { o: QtSent; doc: DealDoc } => !!y.doc && sameName(y.doc.by, me) && y.o.fp === qtFpKey(y.doc) && S.deals[y.doc.deal]?.jobStatus !== 'closed')
      .sort((a, b) => b.o.at.localeCompare(a.o.at));
    add('mine', rows.map(({ o, doc }) => waitRow(doc, o)));
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
