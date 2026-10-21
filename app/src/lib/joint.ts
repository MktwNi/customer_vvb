/**
 * The joint quotation (ใบเสนอราคาร่วม, package quotes item 7) as the screens show it: the table's bands, the
 * member rows' shares, the company picker's "ใช้แถวเดิม / เพิ่มแถวใหม่", the closing summary and the words.
 * The model (records, roles, money counted once) is lib/sales.ts (jointRole, jointOf, moneyOwners); these
 * are pure helpers over it, so they are unit-tested. No DOM.
 */
import { dmTh, isoTh } from './format';
import {
  DEAL_STAGE, QUOTE_STAGE, apportion, countsActual, dealMoney, dealResult, docsOf, filterDeals, fmtMoney, hasPlan, holdPart, jointAttr, jointBase, jointCashLines, jointHeadOf, jointOf, jointParts, jointRole, jointSplit, jointWeights,
  moneyHolds, payState, sectionsFor, stepOf, workTally,
  type CashLine, type Deal, type DealDoc, type JointGroup, type JointMember, type SalesFilterIn, type SalesState, type WorkTally,
} from './sales';
import { isQtVersion, qtVersions, qtView } from './quotes';
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

/** The number in a note a joint quotation wrote ("ใบเสนอราคาร่วม QT-2569-052" → "QT-2569-052"); '' for any other. */
export const noteNo = (n: string) => /^ใบเสนอราคาร่วม (\S+)$/.exec(n.trim())?.[1] || '';
/** The joint quotation's number: the quotation in use (else the newest version); before its file is attached,
 *  the number typed when it was made (its header's QUOTATION note, engine.createJoint); '' without either. */
export const jointNo = (s: SalesState, g: JointGroup) => qtView(s, g.head).head?.doc.docNo || noteNo(stepOf(s, g.head.id, QUOTE_STAGE).n);
/** A short name for the job: "CFP มหาวิทยาลัย…พระนครเหนือ (มจพ)" → "CFP มจพ" (the payer's long name gives way
 *  to the abbreviation in brackets; every other word of the title stays: "CFP 4 บริษัท (มจพ)" → "CFP 4 บริษัท
 *  มจพ"); a title without brackets as it is; none: the payer's short name. */
export function jointShort(g: Pick<JointGroup, 'head' | 'qt'>) {
  const t = g.qt.title.trim();
  if (!t) return shortName(g.head.client);
  const m = /^(.*)\(([^()]{1,24})\)\s*$/.exec(t);
  if (!m) return t;
  const payer = g.head.client.replace(/\s+/g, '');
  const kept = m[1].split(/\s+/).filter((w) => w && (/^[A-Za-z0-9][\w.+-]*$/.test(w) || !payer.includes(w)));
  return [...kept, m[2].trim()].join(' ');
}
/** The payer in a sentence ("ผลจาก มจพ", "รับจาก มจพ 1 จาก 2 งวด"): the title's abbreviation, else its short name. */
export function payerShort(g: Pick<JointGroup, 'head' | 'qt'>) {
  const m = /\(([^()]{1,24})\)\s*$/.exec(g.qt.title.trim());
  return m ? m[1].trim() : shortName(g.head.client);
}
/** "ใบเสนอราคาร่วม QT-2569-052" (before it has a number: "ใบเสนอราคาร่วม"). */
export const jointQtWord = (s: SalesState, g: JointGroup) => {
  const no = jointNo(s, g);
  return 'ใบเสนอราคาร่วม' + (no ? ' ' + no : '');
};
/** The quotation's own name as it goes under the payer: its title shortened (jointShort, "CFP มจพ"); '' without
 *  a title, or when the title only repeats the payer's name (the payer is the line above). */
export function jointLabel(g: Pick<JointGroup, 'head' | 'qt'>) {
  const k = (x: string) => x.replace(/\s+/g, ''), payer = [k(g.head.client), k(shortName(g.head.client))];
  if (!g.qt.title.trim() || payer.includes(k(g.qt.title))) return '';
  const t = jointShort(g);
  return payer.includes(k(t)) ? '' : t;
}
/**
 * A joint quotation named as an item (owner, Oct 2569: "ควรเขียนชื่อองค์กรที่จ้างไว้ด้านบน แล้วเอาชื่อใบเสนอราคา
 * หรือเลขไว้ข้างล่าง"): `name` the organisation that hires and pays, on top, as a company's name is (its full
 * name: a row shortens it as it does any company's, salesUi shortName); `sub` the quotation under it:
 * "ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ · 4 บริษัท · หมิว" (its number, its own name, its companies, its owner).
 * The table's band, the phone card, the ปิดงาน band, the panel's head and the closing dialog.
 */
export function jointHead(s: SalesState, g: JointGroup) {
  const qt = jointQtWord(s, g), label = jointLabel(g);
  return { name: g.head.client, qt, label, sub: [qt, label, `${g.members.length} บริษัท`, g.head.resp].filter(Boolean).join(' · ') };
}
/** The same on one line (a message, a control's label, the CSV): "มหาวิทยาลัย… · ใบเสนอราคาร่วม QT-2569-052";
 *  `short`: the payer as a row names it (salesUi shortName). */
export const jointLine = (s: SalesState, g: JointGroup, short = false) => `${short ? shortName(g.head.client) : g.head.client} · ${jointQtWord(s, g)}`;

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
const fmtN2 = (n: number) => String(Math.round(n * 100) / 100);
/**
 * The parts as typed against the quotation total (the dialog's sum line, the panel's footer): "รวม 1,284,000 ·
 * เท่ากับยอดใบเสนอราคา" when they fit (empty parts split what is left), else how far off; parts that do not
 * fit are scaled to it (jointWeights, apportion), so this warns, never blocks. Without a total yet: what an
 * empty part means, or how far typed % go over 100.
 */
export function sharesCheck(ms: Pick<JointMember, 'share' | 'pct'>[], total: number | null): { text: string; warn: boolean } {
  const base = total != null && total > 0 ? total : 0;
  const empty = ms.filter((m) => m.share == null && m.pct == null).length;
  if (!base) {
    const pcts = ms.reduce((a, m) => a + (m.share == null && m.pct != null ? m.pct : 0), 0);
    if (!ms.some((m) => m.share != null) && pcts > 100) return { text: `รวม ${fmtN2(pcts)}% · เกิน 100% ระบบปรับตามสัดส่วน`, warn: true };
    return { text: 'ยังไม่มียอดรวม · แบ่งตามสัดส่วน', warn: false };
  }
  const sum = ms.reduce((a, m) => a + (m.share != null ? m.share : m.pct != null ? (base * m.pct) / 100 : 0), 0);
  const diff = Math.round((sum - base) * 100) / 100;
  if (Math.abs(diff) < 0.5 || (empty && diff < 0)) return { text: `รวม ${fmtMoney(base)} · เท่ากับยอดใบเสนอราคา`, warn: false };
  return { text: `ส่วนแบ่งที่ใส่รวม ${fmtMoney(Math.round(sum)) || '0'} · ${diff < 0 ? 'น้อยกว่า' : 'มากกว่า'}ยอดใบเสนอราคา ${fmtMoney(Math.round(Math.abs(diff)))} · ระบบปรับตามสัดส่วน`, warn: true };
}
/** A share typed in the picker: "321,000" baht, "25%" a %, '' none (an equal split); undefined = unreadable. */
export function parseShare(v: string): { share: number | null; pct: number | null } | undefined {
  const t = v.replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50)).replace(/[,\s]|บาท/g, '');
  if (!t) return { share: null, pct: null };
  const p = /^(\d+(?:\.\d+)?)%$/.exec(t);
  if (p) return +p[1] <= 100 ? { share: null, pct: +p[1] } : undefined;
  return /^\d+(?:\.\d+)?$/.test(t) ? { share: +t, pct: null } : undefined;
}
/**
 * The parts of the picker's rows as the panel and the closing dialog will show them: baht of `total`
 * apportioned exactly as jointSplit does (whole baht adding up to the total, the remainder on the last),
 * null while there is no total; and each row's %. `out`: rows that withdrew (their result is NO) get
 * none, as in the panel (unless all did).
 */
export function pickParts(picks: Pick<JointMember, 'share' | 'pct'>[], total: number | null, out: boolean[] = []): { amt: number[] | null; pct: number[] } {
  const base = total != null && total > 0 ? total : null;
  if (!picks.length) return { amt: base != null ? [] : null, pct: [] };
  const allOut = picks.every((_, i) => !!out[i]);
  const live = picks.map((_, i) => allOut || !out[i]);
  const w0 = jointWeights(picks.filter((_, i) => live[i]), base);
  let j = 0;
  const w = picks.map((_, i) => (live[i] ? w0[j++] : 0));
  const sum = w.reduce((a, x) => a + x, 0) || 1;
  return { amt: base != null ? apportion(base, w) : null, pct: w.map((x) => Math.round((x / sum) * 100)) };
}

/**
 * Why a row of the year keeps its own job when a joint quotation wants it (the picker then adds a new row
 * for the company and leaves this one, with its money, as it is): '' when it has none of its own.
 * `qt` a quotation (or a Forecast document) of its own; `money` money received (a typed Actual, a document,
 * an installment received by hand); `plan` a payment plan; `closed` a job already closed.
 */
export type OwnWhy = '' | 'qt' | 'money' | 'plan' | 'closed';
export function ownJob(s: SalesState, d: Deal): OwnWhy {
  if (d.jobStatus === 'closed') return 'closed';
  const docs = docsOf(s, d.id);
  if (docs.some((x) => isQtVersion(x) || (x.target === 'forecast' && x.amount != null))) return 'qt';
  if (docs.some(countsActual) || !!dealMoney(s, d).actual) return 'money';
  if (hasPlan(s, d.id)) return 'plan';
  return '';
}
/** The picker's words for ownJob. */
export const OWN_TH: Record<Exclude<OwnWhy, ''>, string> = { qt: 'มีใบเสนอราคาของตัวเองปีนี้แล้ว', money: 'มียอดรับเงินของตัวเองแล้ว', plan: 'มีแผนชำระของตัวเองแล้ว', closed: 'ปิดงานของปีนี้ไปแล้ว' };

/**
 * What putting a row of this year in a joint quotation does (the picker's word): `reuse` "ใช้แถวเดิม" (no
 * job of its own, ownJob: its typed Forecast is ignored while it is a member, the record is not changed);
 * `new` "เพิ่มแถวใหม่" (a job of its own, e.g. another one: that row keeps its quotation, money, plan and
 * status); `taken` (a joint quotation's header, or already a member of another one: the picker refuses
 * it); `locked` (a row this account may not edit, `may`: an account limited to its own deals cannot put
 * another person's row in a joint quotation, which would take that row's money out of the totals).
 */
export type RowFate = 'reuse' | 'new' | 'taken' | 'locked';
export function rowFate(s: SalesState, d: Deal, hid = '', may?: (d: Deal) => boolean): RowFate {
  if (jointRole(s, d) === 'header') return 'taken';
  const h = jointHeadOf(s, d.id);
  if (h && h !== hid) return 'taken';
  // (already a member of this one: it stays as it is)
  if (hid && h === hid) return 'reuse';
  if (ownJob(s, d)) return 'new';
  return may && !may(d) ? 'locked' : 'reuse';
}
/**
 * A company's line in the dialog's list (mockup 10: "ใช้แถวเดิม · Event Exhibition · หมิว"): what joining does,
 * then the หมวด and the person its part is attributed to. A row reused keeps its own; a new row goes in the
 * joint quotation's หมวด (`section`), followed up by the person of the row it is made like (`like`), else
 * `resp` (who a new row of the registry company, or a name typed, gets: engine.addDeal).
 */
export function pickLine(s: SalesState, p: Pick<JointPick, 'deal' | 'like'>, section: string, resp: string): string {
  const d = p.deal ? s.deals[p.deal] : undefined;
  if (d && !p.like) return ['ใช้แถวเดิม', d.section || 'ไม่ระบุหมวด', d.resp].filter(Boolean).join(' · ');
  const like = p.like ? s.deals[p.like] : undefined;
  return ['เพิ่มแถวใหม่', section || 'ไม่ระบุหมวด', like ? like.resp : resp].filter(Boolean).join(' · ');
}
/** "รวมเป็นใบเสนอราคาร่วม" from a deal's quotation: a plain deal with a quotation and no other job of its own
 *  (no money received, plan, or closing: those stay with the deal; its quotation alone moves). */
export function canMergeFrom(s: SalesState, d: Deal): boolean {
  if (jointRole(s, d) !== 'plain' || !qtVersions(s, d).length || d.jobStatus === 'closed') return false;
  return !docsOf(s, d.id).some(countsActual) && !dealMoney(s, d).actual && !hasPlan(s, d.id);
}
/** A member's documents that would count for a plain deal (a quotation, a Forecast or Actual document,
 *  attached by an older build or before it joined): they count nowhere, so its panel lists them under
 *  "เอกสารอื่น" with "ย้ายไปใบเสนอราคาร่วม". None for any other deal. */
export function strayDocs(s: SalesState, d: Deal): DealDoc[] {
  if (jointRole(s, d) !== 'member') return [];
  return docsOf(s, d.id).filter((x) => isQtVersion(x) || (x.target !== 'none' && x.amount != null));
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
/** The ปิดงาน list's rows in the order it shows them (mockup 14): each joint quotation's band (its companies
 *  under it) first, then the other rows, section by section. The export follows it (closedCsvRows). */
export function closedOrder(s: SalesState, deals: Deal[]): JRow[] {
  const jr = jointRows(s, deals), all = jr.secs.flatMap((x) => jr.rows.get(x) || []);
  return [...all.filter((r) => r.k === 'band'), ...all.filter((r) => r.k === 'deal')];
}
/** A row of the ปิดงาน export: `job` / `work` it carries a job / a company worked for (the columns "นับเป็นงาน"
 *  and "นับเป็นบริษัทที่ทำงานให้"); a payer's row the money this view counts of its quotation (`fc` / `ac`,
 *  null = none; `part`: of how many of its companies, under a filter that keeps some). */
export interface ClosedCsvRow { d: Deal; job: boolean; work: boolean; fc?: number | null; ac?: number | null; part?: number }
/**
 * The ปิดงาน tab's export (owner: a SUM in Excel equals the screen, under any filter): its rows in list order
 * (closedOrder), one per company, each joint quotation led by its payer's row, also when the filters left that
 * row out (คุณบี's company in มจพ's quotation): the payer's row carries the quotation's job and the money the
 * view counts of it (moneyHolds / holdPart: the whole, or the parts of the companies listed under a ผู้รับผิดชอบ
 * / SOURCE / REFERRAL filter, `attr`), so the Forecast and Actual columns sum to the line's; its companies' money
 * cells stay empty. `t`: the list's workTally (engine.workTally, with the same `attr`).
 */
export function closedCsvRows(s: SalesState, deals: Deal[], attr: boolean, t: Pick<WorkTally, 'jobRow' | 'workRow'>): ClosedCsvRow[] {
  const holds = new Map(moneyHolds(s, deals, attr).flatMap((h) => (h.g ? [[h.g.head.id, h] as const] : [])));
  const row = (d: Deal): ClosedCsvRow => ({ d, job: t.jobRow.has(d.id), work: t.workRow.has(d.id) });
  return closedOrder(s, deals).flatMap((r) => {
    if (r.k === 'deal') return [row(r.d)];
    const h = holds.get(r.g.head.id), m = dealMoney(s, r.g.head);
    const part = (x: number | null) => (x == null || !h ? null : holdPart(s, h, x));
    return [{ ...row(r.g.head), fc: part(m.forecast), ac: part(m.actual), ...(h?.keep ? { part: h.keep.length } : {}) }, ...r.shown.map(row)];
  });
}
/** The customers a section's rows hold (plain rows and the members shown; a header is not one). */
export const rowDeals = (rows: JRow[]) => rows.flatMap((r) => (r.k === 'deal' ? [r.d] : r.shown));
/** The deals whose money a section sums: plain rows and the headers in the list (members carry none). */
export const rowMoneyDeals = (rows: JRow[]) => rows.flatMap((r) => (r.k === 'deal' ? [r.d] : r.inList ? [r.g.head] : []));
/**
 * What of a joint quotation's money the view counts, as its band (table, phone card, ปิดงาน) shows it beside the
 * section's sum (lib/sales moneyHolds): `whole` with its header in the list and no ผู้รับผิดชอบ / SOURCE /
 * REFERRAL filter; under such a filter the parts of its companies shown (`part` maps an amount of the header
 * to the part counted); `none` when the view counts none of it (its header filtered out, e.g. a search for one
 * of its companies or a quick view; or none of the companies shown has a part): the band then says so.
 */
export function bandPart(s: SalesState, b: Pick<Extract<JRow, { k: 'band' }>, 'g' | 'shown' | 'inList'>, attr: boolean): { whole: boolean; none: boolean; part: (x: number) => number } {
  const all = { whole: true, none: false, part: (x: number) => x }, nothing = { whole: false, none: true, part: () => 0 };
  if (!attr) return b.inList ? all : nothing;
  const h = moneyHolds(s, [...(b.inList ? [b.g.head] : []), ...b.shown], true)[0];
  if (!h) return nothing;
  if (!h.keep) return all;
  const w = jointParts(s, b.g);
  return h.keep.some((i) => w[i] > 0) ? { whole: false, none: false, part: (x: number) => holdPart(s, h, x) } : nothing;
}
/**
 * The Cashflow tab's money for filter `F` (its cards, chart, list and CSV): the lines of the deals passing it,
 * a joint quotation's carrying the parts of its companies listed under a ผู้รับผิดชอบ / SOURCE / REFERRAL
 * filter (jointAttr), as the Dashboard, the KPIs and the money lens count it: the same money on every screen.
 * `deals`: those deals when the caller has them already.
 */
export const viewCashLines = (s: SalesState, F: SalesFilterIn, today: string, deals = filterDeals(s, F, today)): CashLine[] => jointCashLines(s, deals, today, jointAttr(F));

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
 * The joint quotation a deal closes and reopens with (its header's id: closing is always the whole quotation,
 * engine.closeJoint), '' for a deal that closes on its own.
 */
export function jointCloseOf(s: SalesState, d: Pick<Deal, 'id'>): string {
  const r = jointRole(s, d);
  return r === 'header' ? d.id : r === 'member' ? jointHeadOf(s, d.id) : '';
}
/**
 * What closing a joint quotation records for its companies: the payer's result `r` (YES or NO; '' while it has
 * neither, and nothing is recorded), dated as the payer's (`d`, its CLOSED DEAL day; '' = the day it closes),
 * for the companies `ids` whose own result is neither YES nor NO (one recorded NO, a company that withdrew,
 * stays NO; a YES stays). The same when the payer's result comes after the closing (engine.setStep).
 */
export function jointFill(s: SalesState, g: JointGroup): { r: 'YES' | 'NO' | ''; d: string; ids: string[] } {
  const hr = dealResult(s, g.head), r = hr === 'YES' || hr === 'NO' ? hr : '';
  const ids = r && s.cfg.stages.includes(DEAL_STAGE) ? g.members.filter((x) => !/^(YES|NO)$/.test(dealResult(s, x.deal))).map((x) => x.deal.id) : [];
  return { r, d: stepOf(s, g.head.id, DEAL_STAGE).d, ids };
}
/** The tracker as closing joint quotation `g` today would leave it (its header and companies closed, the
 *  payer's result recorded for those without one, jointFill), for the closing dialog's preview. */
export function closedJoint(s: SalesState, g: JointGroup, today: string): SalesState {
  const f = jointFill(s, g), deals = { ...s.deals }, steps = { ...s.steps };
  [g.head, ...g.members.map((x) => x.deal)].forEach((d) => d.jobStatus === 'open' && (deals[d.id] = { ...d, jobStatus: 'closed', closedDate: today }));
  f.ids.forEach((id) => (steps[`${id}/${DEAL_STAGE}`] = { d: f.d || today, n: f.r }));
  return { ...s, deals, steps };
}

/**
 * The closing dialog's summary (ปิดงานใบเสนอราคาร่วม): every member with its result and part (a withdrawn
 * one has none), the total counted once (the quotation's), and where the payer's payment stands. `after`: a
 * member's result once closed (`by`: recorded from the payer's, jointFill), `fill` the payer's result written
 * then, and `worked` how many companies the quotation then counts as worked for (workTally, by name or link).
 */
export function closeSummary(s: SalesState, g: JointGroup, today: string) {
  const sh = memberShares(s, g), f = jointFill(s, g), by = new Set(f.ids);
  const rows = g.members.map((x, i) => ({ deal: x.deal, result: dealResult(s, x.deal), after: by.has(x.deal.id) ? f.r : dealResult(s, x.deal), by: by.has(x.deal.id), share: sh[i].out ? null : sh[i].amt, closed: x.deal.jobStatus === 'closed' }));
  const A = closedJoint(s, g, today), worked = workTally(A, g.members.map((x) => A.deals[x.deal.id])).worked;
  const m = dealMoney(s, g.head), r = dealResult(s, g.head), ps = payState(s, g.head, today), P = ps.plan;
  const payer = payerShort(g);
  const pay =
    r === 'NO' ? `${payer} ตอบว่าไม่ได้งาน`
    : r !== 'YES' ? `ยังไม่มีผลจาก ${payer}`
    : P ? (ps.left.length ? `รับจาก ${payer} ${P.paidN} จาก ${P.n} งวด · ค้าง ${fmtMoney(P.left)} บาท` : `รับจาก ${payer} ครบ ${P.n} จาก ${P.n} งวด · ${fmtMoney(P.got)} บาท`)
    : m.actual != null ? `รับจาก ${payer} ${fmtMoney(m.actual)} บาท` : `ยังไม่มีแผนชำระของ ${payer}`;
  return { rows, total: m.forecast, pay, fill: f.r, worked, n: g.members.filter((x) => x.deal.jobStatus === 'open').length + (g.head.jobStatus === 'open' ? 1 : 0), open: g.members.filter((x) => x.deal.jobStatus === 'open').length };
}

/** The line a member's panel opens with: "อยู่ในใบเสนอราคาร่วม QT-… (มจพ) · ร่วมกับอีก 3 บริษัท · ส่วนแบ่ง 321,000 (25%)". */
export function memberLine(s: SalesState, d: Deal, money: boolean) {
  const v = shareOf(s, d);
  if (!v) return '';
  const no = jointNo(s, v.g);
  const share = !money ? '' : v.out ? 'ถอนตัวแล้ว ไม่มีส่วนแบ่ง' : v.amt != null ? `ส่วนแบ่ง ${fmtMoney(v.amt)} (${v.pct}%)` : `ส่วนแบ่ง ${v.pct}%`;
  return [`อยู่ในใบเสนอราคาร่วม${no ? ' ' + no : ''} (${payerShort(v.g)})`, `ร่วมกับอีก ${v.g.members.length - 1} บริษัท`, share].filter(Boolean).join(' · ');
}
/** A deal's money in words where it is listed among a person's or company's deals (People): a joint
 *  quotation's member its part ("ส่วนแบ่ง 321,000 ใน QT ร่วม"; its own typed figures count nowhere), any other
 *  deal its Forecast and Actual. None without ดูยอดเงิน (`money`). */
export function moneyWords(s: SalesState, d: Deal, money: boolean): string[] {
  if (!money) return [];
  if (jointRole(s, d) === 'member') {
    const v = shareOf(s, d);
    return !v ? [] : [v.out ? 'ถอนตัวจาก QT ร่วม' : `ส่วนแบ่ง ${v.amt != null ? fmtMoney(v.amt) : v.pct + '%'} ใน QT ร่วม`];
  }
  const m = dealMoney(s, d);
  return [m.forecast != null ? 'Forecast ' + fmtMoney(m.forecast) : '', m.actual != null ? 'Actual ' + fmtMoney(m.actual) : ''].filter(Boolean);
}
/** Under a withdrawn member's figure: "ถอนตัว 2 ส.ค." (its NO date). */
export const outWord = (s: SalesState, d: Deal) => {
  const x = stepOf(s, d.id, DEAL_STAGE).d;
  return 'ถอนตัว' + (x ? ' ' + dmTh(x) : '');
};
/** A day in full for titles: "6 ต.ค. 2569". */
export const dayFull = (iso: string) => (iso ? isoTh(iso) : '');
