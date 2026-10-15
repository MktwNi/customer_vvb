/**
 * The joint quotation (ใบเสนอราคาร่วม, package quotes item 7) as the screens show it: the table's bands, the
 * member rows' shares, the company picker's "ใช้แถวเดิม / เพิ่มแถวใหม่", the closing summary and the words.
 * The model (records, roles, money counted once) is lib/sales.ts (jointRole, jointOf, moneyOwners); these
 * are pure helpers over it, so they are unit-tested. No DOM.
 */
import { dmTh, isoTh } from './format';
import {
  DEAL_STAGE, QUOTE_STAGE, countsActual, dealMoney, dealResult, docsOf, fmtMoney, jointBase, jointHeadOf, jointOf, jointParts, jointRole, jointSplit, jointWeights, payState, sectionsFor, stepOf,
  type Deal, type DealDoc, type JointGroup, type JointMember, type SalesState,
} from './sales';
import { isQtVersion, qtView } from './quotes';
import { shortName } from './salesUi';

/** A company to put in a joint quotation: an existing row (`deal`, reused), or a new row for a registry
 *  company (`gid`) or a name typed (`name`); `like` = the row of the same company whose contact details a
 *  new row copies. Its part: `share` baht, or `pct` %; neither = an equal split. */
export interface JointPick { deal?: string; gid?: number | null; name?: string; like?: string; share: number | null; pct: number | null }
/** What "สร้างใบเสนอราคาร่วม" makes (engine.createJoint). `from`: "รวมเป็นใบเสนอราคาร่วม" from that deal: its
 *  quotation (every version) moves to the new header, and it is the first member. Without a file (and not
 *  `from`), `total` is the header's typed Forecast until the quotation is attached. */
export interface JointNew {
  title: string; payer: string; payerGid: number | null;
  year: string; section: string; resp: string; service: string[];
  total: number | null; docNo: string; docDate: string;
  file?: Blob & { name: string }; basis?: DealDoc['basis']; detected?: number | null;
  from?: string;
  members: JointPick[];
}

/** The note a joint quotation writes at a member's empty QUOTATION stage; recognised by its exact text
 *  (taken back when the member leaves, or the joint quotation is cancelled). */
export const jointNote = (docNo: string) => `ใบเสนอราคาร่วม${docNo ? ' ' + docNo : ''}`;
/** A QUOTATION note a joint quotation wrote (with any quotation number: the quotation may have been revised
 *  since); a note anyone typed is never one. */
export const isJointNote = (n: string) => /^ใบเสนอราคาร่วม(?: \S+)?$/.test(n.trim());

/** The joint quotation's number: the quotation in use (else the newest version), '' before one is attached. */
export const jointNo = (s: SalesState, g: JointGroup) => qtView(s, g.head).head?.doc.docNo || '';
/** A short name for the job: "CFP มหาวิทยาลัย…พระนครเหนือ (มจพ)" → "CFP มจพ" (its Latin words and the
 *  abbreviation in brackets); a title without brackets as it is; none: the payer's short name. */
export function jointShort(g: Pick<JointGroup, 'head' | 'qt'>) {
  const t = g.qt.title.trim();
  if (!t) return shortName(g.head.client);
  const m = /^(.*)\(([^()]{1,24})\)\s*$/.exec(t);
  if (!m) return t;
  const latin = m[1].split(/\s+/).filter((w) => /^[A-Za-z0-9][\w.+-]*$/.test(w));
  return [...latin, m[2].trim()].join(' ');
}
/** The payer as the band and the panel name it: the title's abbreviation ("มจพ"), else its short name. */
export function payerShort(g: Pick<JointGroup, 'head' | 'qt'>) {
  const m = /\(([^()]{1,24})\)\s*$/.exec(g.qt.title.trim());
  return m ? m[1].trim() : shortName(g.head.client);
}
/** "ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ" (the band, the closed list, the phone card). */
export const jointTitle = (s: SalesState, g: JointGroup) => ['ใบเสนอราคาร่วม' + (jointNo(s, g) ? ' ' + jointNo(s, g) : ''), jointShort(g)].join(' · ');
/** "4 บริษัท · ผู้จ่าย มหาวิทยาลัย… · หมิว". */
export const jointSub = (g: JointGroup) => [`${g.members.length} บริษัท`, 'ผู้จ่าย ' + g.head.client, g.head.resp].filter(Boolean).join(' · ');

/** A member's part as its row shows it: the amount of the quotation (null without a total), its % of the
 *  whole, and `auto` when nobody typed it (an equal split). A member that withdrew (NO) has none. */
export interface ShareView { amt: number | null; pct: number; auto: boolean; out: boolean }
export function memberShares(s: SalesState, g: JointGroup): ShareView[] {
  const base = jointBase(s, g);
  const w = jointParts(s, g);
  const sum = w.reduce((a, x) => a + x, 0) || 1;
  const amts = base != null ? jointSplit(s, g, base) : null;
  return g.members.map((x, i) => {
    const out = !w[i] && dealResult(s, x.deal) === 'NO';
    return { amt: out ? null : amts ? amts[i] : null, pct: Math.round((w[i] / sum) * 100), auto: x.m.share == null && x.m.pct == null, out };
  });
}
/** The share of one member deal (its joint quotation found from it), or null when it is not a member. */
export function shareOf(s: SalesState, d: Deal): (ShareView & { g: JointGroup }) | null {
  const g = jointRole(s, d) === 'member' ? jointOf(s, d) : null;
  const i = g ? g.members.findIndex((x) => x.deal.id === d.id) : -1;
  return g && i >= 0 ? { ...memberShares(s, g)[i], g } : null;
}
/** How the parts are set, for the panel's heading: "แบ่งเท่ากัน" (nobody typed one) or "กำหนดส่วนแบ่งเอง". */
export const sharesWord = (g: JointGroup) => (g.members.every((x) => x.m.share == null && x.m.pct == null) ? 'แบ่งเท่ากัน' : 'กำหนดส่วนแบ่งเอง');
/** The parts against the quotation: "รวม 1,284,000 · เท่ากับยอดใบเสนอราคา" or how far off (warn, never blocking). */
export function sharesCheck(parts: (number | null)[], total: number | null): { text: string; warn: boolean } {
  const sum = parts.reduce<number>((a, x) => a + (x || 0), 0);
  if (total == null) return { text: `รวม ${fmtMoney(sum) || '0'}`, warn: false };
  const diff = Math.round((sum - total) * 100) / 100;
  if (!diff) return { text: `รวม ${fmtMoney(sum)} · เท่ากับยอดใบเสนอราคา`, warn: false };
  return { text: `รวม ${fmtMoney(sum) || '0'} · ${diff < 0 ? 'น้อยกว่า' : 'มากกว่า'}ยอดใบเสนอราคา ${fmtMoney(Math.abs(diff))}`, warn: true };
}
/** A share typed in the picker: "321,000" baht, "25%" a %, '' none (an equal split); undefined = unreadable. */
export function parseShare(v: string): { share: number | null; pct: number | null } | undefined {
  const t = v.replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50)).replace(/[,\s]|บาท/g, '');
  if (!t) return { share: null, pct: null };
  const p = /^(\d+(?:\.\d+)?)%$/.exec(t);
  if (p) return +p[1] <= 100 ? { share: null, pct: +p[1] } : undefined;
  return /^\d+(?:\.\d+)?$/.test(t) ? { share: +t, pct: null } : undefined;
}
/** The parts of the picker's rows of `total` (their shares, % and equal splits), as the panel will show them. */
export function pickParts(picks: Pick<JointMember, 'share' | 'pct'>[], total: number | null): number[] {
  if (!picks.length) return [];
  const w = jointWeights(picks, total);
  const base = total != null && total > 0 ? total : w.reduce((a, x) => a + x, 0);
  const sum = w.reduce((a, x) => a + x, 0) || 1;
  return w.map((x) => Math.round((base * x) / sum));
}

/**
 * What putting a row of this year in a joint quotation does (the picker's word): `reuse` "ใช้แถวเดิม" (no
 * quotation or Actual of its own: its typed Forecast is ignored while it is a member, the record is not
 * changed); `new` "เพิ่มแถวใหม่" (it has its own quotation or money, e.g. another job: that row keeps it);
 * `taken` (a joint quotation's header, or already a member of another one: the picker refuses it).
 */
export function rowFate(s: SalesState, d: Deal, hid = ''): 'reuse' | 'new' | 'taken' {
  if (jointRole(s, d) === 'header') return 'taken';
  const h = jointHeadOf(s, d.id);
  if (h && h !== hid) return 'taken';
  const own = docsOf(s, d.id).some((x) => isQtVersion(x) || countsActual(x));
  // (already a member of this one: it stays as it is)
  return own && !(hid && h === hid) ? 'new' : 'reuse';
}

/** One row of a table or the closed list: a deal, or a joint quotation's band with its members in the list
 *  under it (`inList`: the header itself passed the filters; its money then counts in the section). */
export type JRow = { k: 'deal'; d: Deal } | { k: 'band'; g: JointGroup; shown: Deal[]; inList: boolean };
/**
 * The rows by section: each joint quotation with its header or a member in `deals` is a band at the top of
 * its header's section, with the members in `deals` under it in the order they joined (a member whose own
 * หมวด differs is drawn there too: its record is unchanged); the other rows after, in their order. A member
 * is never a row of its own; sections without rows are left out.
 */
export function jointRows(s: SalesState, deals: Deal[]): { secs: string[]; rows: Map<string, JRow[]> } {
  const bands = new Map<string, { k: 'band'; g: JointGroup; shown: Deal[]; inList: boolean }>();
  const band = (hid: string) => {
    let b = bands.get(hid);
    if (!b) {
      const g = jointOf(s, { id: hid });
      if (!g) return null;
      b = { k: 'band', g, shown: [], inList: false };
      bands.set(hid, b);
    }
    return b;
  };
  const plain: Deal[] = [];
  for (const d of deals) {
    const r = jointRole(s, d);
    const b = r === 'header' ? band(d.id) : r === 'member' ? band(jointHeadOf(s, d.id)) : null;
    if (!b) plain.push(d);
    else if (r === 'header') b.inList = true;
    else b.shown.push(d);
  }
  bands.forEach((b) => {
    const at = new Map(b.g.members.map((x, i) => [x.deal.id, i]));
    b.shown.sort((a, c) => (at.get(a.id) ?? 0) - (at.get(c.id) ?? 0));
  });
  const heads = [...bands.values()].map((b) => b.g.head).sort((a, c) => a.order - c.order || a.at.localeCompare(c.at));
  const rows = new Map<string, JRow[]>();
  const put = (sec: string, r: JRow) => (rows.get(sec) || rows.set(sec, []).get(sec)!).push(r);
  heads.forEach((h) => put(h.section, bands.get(h.id)!));
  plain.forEach((d) => put(d.section, { k: 'deal', d }));
  const secs = sectionsFor(s, [...plain, ...heads]).filter((x) => rows.has(x));
  return { secs, rows };
}
/** The customers a section's rows hold (plain rows and the members shown; a header is not one). */
export const rowDeals = (rows: JRow[]) => rows.flatMap((r) => (r.k === 'deal' ? [r.d] : r.shown));
/** The deals whose money a section sums: plain rows and the headers in the list (members carry none). */
export const rowMoneyDeals = (rows: JRow[]) => rows.flatMap((r) => (r.k === 'deal' ? [r.d] : r.inList ? [r.g.head] : []));

/** "ได้ 3 · ไม่ได้ 1" over the members' results; '' while none is known. */
export function resultsWord(s: SalesState, g: JointGroup) {
  const rs = g.members.map((x) => dealResult(s, x.deal));
  const y = rs.filter((r) => r === 'YES').length, n = rs.filter((r) => r === 'NO').length;
  return [y ? `ได้ ${y}` : '', n ? `ไม่ได้ ${n}` : ''].filter(Boolean).join(' · ');
}
/** "ปิดแล้ว 1 จาก 4" when the group is partly closed (some members closed, or the header and its members
 *  apart); '' when all are open or all closed. */
export function closedWord(g: JointGroup) {
  const k = g.members.filter((x) => x.deal.jobStatus === 'closed').length, n = g.members.length;
  const head = g.head.jobStatus === 'closed';
  if ((k === 0 && !head) || (k === n && head)) return '';
  return `ปิดแล้ว ${k} จาก ${n}`;
}
/** The day the quotation was sent (the header's QUOTATION date), '' before. */
export const sentDay = (s: SalesState, g: JointGroup) => stepOf(s, g.head.id, QUOTE_STAGE).d;

/**
 * The closing dialog's summary (ปิดงานใบเสนอราคาร่วม): every member with its result and part (a withdrawn
 * one has none), the total counted once (the quotation's), and where the payer's payment stands.
 */
export function closeSummary(s: SalesState, g: JointGroup, today: string) {
  const sh = memberShares(s, g);
  const rows = g.members.map((x, i) => ({ deal: x.deal, result: dealResult(s, x.deal), share: sh[i].out ? null : sh[i].amt, closed: x.deal.jobStatus === 'closed' }));
  const m = dealMoney(s, g.head), r = dealResult(s, g.head), ps = payState(s, g.head, today), P = ps.plan;
  const payer = payerShort(g);
  const pay =
    r === 'NO' ? `${payer} ตอบว่าไม่ได้งาน`
    : r !== 'YES' ? `ยังไม่มีผลจาก ${payer}`
    : P ? (ps.left.length ? `รับจาก ${payer} ${P.paidN} จาก ${P.n} งวด · ค้าง ${fmtMoney(P.left)} บาท` : `รับจาก ${payer} ครบ ${P.n} จาก ${P.n} งวด · ${fmtMoney(P.got)} บาท`)
    : m.actual != null ? `รับจาก ${payer} ${fmtMoney(m.actual)} บาท` : `ยังไม่มีแผนชำระของ ${payer}`;
  return { rows, total: m.forecast, pay, n: g.members.filter((x) => x.deal.jobStatus === 'open').length + (g.head.jobStatus === 'open' ? 1 : 0), open: g.members.filter((x) => x.deal.jobStatus === 'open').length };
}

/** The line a member's panel opens with: "อยู่ในใบเสนอราคาร่วม QT-… (มจพ) · ร่วมกับอีก 3 บริษัท · ส่วนแบ่ง 321,000 (25%)". */
export function memberLine(s: SalesState, d: Deal, money: boolean) {
  const v = shareOf(s, d);
  if (!v) return '';
  const no = jointNo(s, v.g);
  const share = !money ? '' : v.out ? 'ถอนตัวแล้ว ไม่มีส่วนแบ่ง' : v.amt != null ? `ส่วนแบ่ง ${fmtMoney(v.amt)} (${v.pct}%)` : `ส่วนแบ่ง ${v.pct}%`;
  return [`อยู่ในใบเสนอราคาร่วม${no ? ' ' + no : ''} (${payerShort(v.g)})`, `ร่วมกับอีก ${v.g.members.length - 1} บริษัท`, share].filter(Boolean).join(' · ');
}
/** Under a withdrawn member's figure: "ถอนตัว 2 ส.ค." (its NO date). */
export const outWord = (s: SalesState, d: Deal) => {
  const x = stepOf(s, d.id, DEAL_STAGE).d;
  return 'ถอนตัว' + (x ? ' ' + dmTh(x) : '');
};
/** A day in full for titles: "6 ต.ค. 2569". */
export const dayFull = (iso: string) => (iso ? isoTh(iso) : '');
