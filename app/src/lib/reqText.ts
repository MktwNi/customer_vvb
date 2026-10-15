/**
 * The words of permission requests (package roles): the account menu's status line, the result notice,
 * the admin's request cards and the history of permission changes. Pure, so tests read the same text the
 * screens show.
 */
import { CAP, isCap, listWords, capPhrase, type AuditRow, type CapAsk, type MyReq, type ReqPending, type ReqResult } from './caps';
import { dtTh, isoTh } from './format';

/** A role id → its name (the roles the script sent, the built-in names, else the id). */
export type NameOf = (id: string) => string;

const until = (u?: string) => (u ? ` ถึง ${isoTh(u)}` : '');
/** "ดูค่าคอมมิชชั่น / สัดส่วนรายได้ · แนบเอกสาร" */
export const asksWords = (c: CapAsk[] | undefined, max = 3) => listWords((c || []).map((x) => capPhrase(x.k)), max);

/** The account menu's line for a pending request: "ขอเป็น หัวหน้าฝ่ายขาย ถึง 31 ม.ค. 2570". */
export function reqWords(r: Pick<ReqPending, 'k' | 'role' | 'caps' | 'until'>, nameOf: NameOf) {
  if (r.k === 'role') return `ขอเป็น ${nameOf(r.role || '')}${until(r.until)}`;
  return `ขอสิทธิ์เพิ่ม ${(r.caps || []).length} รายการ${until(r.until)}`;
}

/** The notice after an admin decided: `lead`, then the role's name in bold (approved role), `tail`. */
export function resultNotice(r: Extract<MyReq, { st: 'r' }> | ReqResult, nameOf: NameOf, roleNow: string): { lead: string; role: string; tail: string } {
  const who = r.by || 'ผู้ดูแลระบบ';
  const n = (r.caps || []).length;
  if (r.ok) {
    if (r.role) return { lead: `${who}อนุมัติคำขอของคุณแล้ว ตอนนี้คุณเป็น `, role: roleNow || nameOf(r.role), tail: until(r.until) };
    return { lead: `${who}อนุมัติคำขอของคุณแล้ว ได้สิทธิ์เพิ่ม ${n ? n + ' รายการ: ' + asksWords(r.caps, 2) : ''}${until(r.until)}`, role: '', tail: '' };
  }
  if (r.role) return { lead: `${who}ไม่อนุมัติคำขอเป็น ${nameOf(r.role)}`, role: '', tail: '' };
  return { lead: `${who}ไม่อนุมัติคำขอสิทธิ์เพิ่ม${n ? ` ${n} รายการ` : ''}`, role: '', tail: '' };
}

/** "ชั่วคราว ถึง 31 ม.ค. 2570 แล้วกลับเป็น พนักงานขาย" / "ถาวร" */
export function spanWords(r: Pick<ReqPending, 'k' | 'until'>, baseName: string) {
  if (!r.until) return 'ถาวร';
  return `ชั่วคราว ถึง ${isoTh(r.until)}` + (r.k === 'role' ? ` แล้วกลับเป็น ${baseName}` : '');
}

/** One line of "ประวัติการเปลี่ยนสิทธิ์". `kind` colours the result word (info = approved). */
export interface HistLine { at: string; who: string; what: string; sub: string; result: string; kind: '' | 'info'; by: string }

const asksOf = (x: unknown): CapAsk[] =>
  Array.isArray(x)
    ? x.flatMap((i) => {
        const k = typeof i === 'string' ? i : i && typeof i === 'object' ? (i as { k?: unknown }).k : null;
        return isCap(k) ? [{ k, s: (i as { s?: string })?.s === 'own' ? ('own' as const) : ('all' as const) }] : [];
      })
    : [];
const str = (x: unknown) => (x == null ? '' : String(x));

/**
 * An audit row in words, or null for rows the history does not show (a role edited, a request sent or
 * withdrawn). Actions: req_decide {ok, k, role, caps, until, from}, user_role / role_change / user_save
 * {from, to} (an admin set someone's role), grant_save {c, until} / grant_del {k} (extras given or taken),
 * grant_expire {k | role, until}.
 */
export function histLine(a: AuditRow, nameOf: NameOf, nameOfUser: (u: string) => string): HistLine | null {
  const d = a.detail;
  const who = nameOfUser(a.u);
  const by = a.actor ? nameOfUser(a.actor) : '';
  const at = a.at ? dtTh(a.at) : '';
  const caps = asksOf(d.caps ?? d.c);
  const u = d.until ? str(d.until).slice(0, 10) : '';
  const base = { at, who, by, sub: a.note ? `“${a.note}”` : '' };
  switch (a.action) {
    case 'req_decide': {
      const what = d.role
        ? `ขอเปลี่ยนบทบาท${d.from ? ` จาก ${nameOf(str(d.from))}` : ''} เป็น ${nameOf(str(d.role))}${until(u)}`
        : `ขอสิทธิ์เพิ่ม: ${caps.map((x) => CAP[x.k].label).join(', ') || '—'}${until(u)}`;
      const ok = d.ok === true || d.ok === 1 || d.ok === '1';
      return { ...base, what, result: ok ? 'อนุมัติ' : 'ไม่อนุมัติ', kind: ok ? 'info' : '' };
    }
    case 'user_role':
    case 'role_change':
    case 'user_save': {
      if (!d.to && !d.role) return null;
      return { ...base, what: `เปลี่ยนบทบาทเป็น ${nameOf(str(d.to ?? d.role))}`, sub: a.note ? `“${a.note}”` : 'ไม่ได้มาจากคำขอ', result: 'เปลี่ยนโดยผู้ดูแลระบบ', kind: '' };
    }
    case 'grant_save':
      return { ...base, what: `ให้สิทธิ์เพิ่ม: ${caps.map((x) => CAP[x.k].label).join(', ') || '—'}${until(u)}`, sub: a.note ? `“${a.note}”` : 'ไม่ได้มาจากคำขอ', result: 'ให้โดยผู้ดูแลระบบ', kind: '' };
    case 'grant_del': {
      const k = str(d.k);
      return { ...base, what: `เอาสิทธิ์เพิ่มออก: ${isCap(k) ? CAP[k].label : k === 'role' ? 'บทบาทชั่วคราว' : k}`, result: 'เอาออกโดยผู้ดูแลระบบ', kind: '' };
    }
    case 'grant_expire': {
      const k = str(d.k);
      const what = d.role ? `บทบาทชั่วคราว ${nameOf(str(d.role))}` : `สิทธิ์เพิ่ม: ${isCap(k) ? CAP[k].label : k}`;
      return { ...base, what: what + until(u), result: 'หมดอายุแล้ว', kind: '', sub: u ? `สิ้นสุด ${isoTh(u)}` : base.sub };
    }
  }
  return null;
}
