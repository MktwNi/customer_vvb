/**
 * The quotation of a deal and its versions (item 3: attach a revised quotation, correct one, swap its
 * file). No new fields and no new records: a version is a quotation document at QUOTATION, numbered by
 * when it was attached; the one in use is the Forecast's document (dealMoney, newest confirmation wins);
 * every other one is "ฉบับเดิม", kept with `target: 'none'` once a revision replaced it. Pure (no DOM),
 * so it is unit-tested; the engine (attachDoc / replaceDocFile / deleteDoc) and the screens share it.
 */
import { dmTh, isoTh, localDay } from './format';
import { QUOTE_STAGE, dealMoney, fmtMoney, type Deal, type DealDoc, type SalesState } from './sales';
import type { DocFacts } from './docExtract';

/** A version of the deal's quotation: a quotation document attached at QUOTATION. */
export const isQtVersion = (x: Pick<DealDoc, 'kind' | 'stage'>) => x.kind === 'quotation' && x.stage === QUOTE_STAGE;

/**
 * A deal's quotation versions, oldest first. Ordered by when each was attached (`at`, then the id), never
 * by the confirmation time `cAt`: a revision sets the old version to "not counted", and that change
 * re-stamps its `cAt` after the new one's (engine.updateDoc), so `cAt` would number the old version last.
 */
export function qtVersions(s: SalesState, d: Pick<Deal, 'id'>): DealDoc[] {
  return Object.values(s.docs)
    .filter((x) => x.deal === d.id && isQtVersion(x))
    .sort((a, b) => (a.at || '').localeCompare(b.at || '') || a.id.localeCompare(b.id));
}

/** `cur` = the version the Forecast comes from ("ใช้อยู่"); `last` = the newest one when none is in use
 *  (a Forecast typed after it); `old` = every other ("ฉบับเดิม", not counted). `n` = 1, 2, 3 by attach order. */
export interface QtVersion { doc: DealDoc; n: number; state: 'cur' | 'last' | 'old' }
/**
 * The quotation card's view: every version (oldest first), the one the card is about (`head`: the one in
 * use, else the newest), and `typed` when a Forecast typed after the quotations overrides them.
 */
export interface QtView { versions: QtVersion[]; head: QtVersion | null; cur: QtVersion | null; typed: boolean }
export function qtView(s: SalesState, d: Deal): QtView {
  const docs = qtVersions(s, d), m = dealMoney(s, d);
  const ci = m.fcDoc ? docs.findIndex((x) => x.id === m.fcDoc!.id) : -1;
  const versions: QtVersion[] = docs.map((doc, i) => ({ doc, n: i + 1, state: i === ci ? 'cur' : ci < 0 && i === docs.length - 1 ? 'last' : 'old' }));
  const cur = ci < 0 ? null : versions[ci];
  return { versions, head: cur || versions[versions.length - 1] || null, cur, typed: m.fcOverride };
}

/** The version that is the Forecast again when `docId` (the one in use) is deleted: the nearest earlier
 *  one with an amount; null when there is none (the typed Forecast, if any, is used then). */
export function qtPrev(versions: DealDoc[], docId: string): DealDoc | null {
  const i = versions.findIndex((x) => x.id === docId);
  if (i < 0) return null;
  return versions.slice(0, i).filter((x) => x.amount != null).pop() || null;
}

/** The day a version stands for: its date on the document, else the day it was attached. */
export const qtDay = (doc: Pick<DealDoc, 'docDate' | 'at'>) => doc.docDate || (doc.at ? localDay(doc.at) : '');

/** "ฉบับที่ 2 · ใช้อยู่" / "ฉบับที่ 2 · ล่าสุด" / "ฉบับที่ 1 · ฉบับเดิม". */
export const qtVerLabel = (v: QtVersion) => `ฉบับที่ ${v.n} · ${v.state === 'cur' ? 'ใช้อยู่' : v.state === 'last' ? 'ล่าสุด' : 'ฉบับเดิม'}`;
/** A version's line in the card's list: "9 ต.ค. 2569 · 182,970 บาท · นับเป็น Forecast". */
export function qtVerText(v: QtVersion, typed: boolean) {
  const day = qtDay(v.doc);
  const what = v.state === 'cur' ? 'นับเป็น Forecast' : v.state === 'last' && typed && v.doc.target === 'forecast' ? 'Forecast พิมพ์เองทีหลัง' : 'ไม่นับยอด';
  return [day ? isoTh(day) : '', v.doc.amount != null ? fmtMoney(v.doc.amount) + ' บาท' : 'ไม่ระบุยอด', what].filter(Boolean).join(' · ');
}
/** The same, short, for the phone card: "192,600 · 4 ต.ค. · ไม่นับยอด". */
export function qtVerShort(v: QtVersion) {
  const day = qtDay(v.doc);
  return [v.doc.amount != null ? fmtMoney(v.doc.amount) : 'ไม่ระบุยอด', day ? dmTh(day) : '', v.state === 'cur' ? 'นับเป็น Forecast' : 'ไม่นับยอด'].filter(Boolean).join(' · ');
}

/** Under a revision's comparison: "ฉบับแก้ไขน้อยกว่าเดิม 9,630 บาท (ลด 5%)"; '' without both figures. */
export function qtDiffText(was: number | null, now: number | null) {
  if (was == null || now == null) return '';
  const diff = Math.round((now - was) * 100) / 100;
  if (!diff) return 'ยอดเท่ากับฉบับเดิม';
  const up = diff > 0, pct = was > 0 ? Math.round((Math.abs(diff) / was) * 100) : null;
  const tail = pct == null ? '' : ` (${up ? 'เพิ่ม' : 'ลด'}${pct ? ` ${pct}%` : 'ไม่ถึง 1%'})`;
  return `ฉบับแก้ไข${up ? 'มากกว่า' : 'น้อยกว่า'}เดิม ${fmtMoney(Math.abs(diff))} บาท${tail}`;
}

/** What deleting the version the card is about does to the Forecast (the menu's second line and the
 *  confirm): "ฉบับที่ 1 กลับมาเป็น Forecast" and the like. */
export function qtDelText(v: QtView, d: Pick<Deal, 'forecast'>) {
  const h = v.head;
  if (!h) return '';
  if (h.state !== 'cur') return v.typed ? 'Forecast ที่พิมพ์ไว้ยังเหมือนเดิม' : 'Forecast ไม่เปลี่ยน';
  const prev = qtPrev(v.versions.map((x) => x.doc), h.doc.id);
  if (prev) return `ฉบับที่ ${v.versions.find((x) => x.doc.id === prev.id)!.n} กลับมาเป็น Forecast`;
  return d.forecast != null ? `Forecast กลับเป็นยอดที่พิมพ์ไว้ ${fmtMoney(d.forecast)}` : 'ไม่มี Forecast จากใบเสนอราคาแล้ว';
}

/** The table's money cell under a figure from a version: "ฉบับที่ 2", and its title with what is no longer counted. */
export function qtFigWords(v: QtView, docId: string): { text: string; title: string } | null {
  const x = v.versions.find((y) => y.doc.id === docId);
  if (!x || v.versions.length < 2) return null;
  const olds = v.versions.filter((y) => y !== x).map((y) => `ฉบับที่ ${y.n}${y.doc.amount != null ? ' ' + fmtMoney(y.doc.amount) : ''}`);
  return { text: `ฉบับที่ ${x.n}`, title: `จากเอกสาร ${x.doc.docNo || 'ใบเสนอราคา'} ฉบับที่ ${x.n} (${olds.join(', ')} ไม่นับแล้ว)` };
}

/** Things named in a Thai sentence: "ยอด", "ยอดและวันที่", "ยอด เลขที่ และวันที่". */
export function thList(xs: string[]) {
  return xs.length < 2 ? xs.join('') : xs.length === 2 ? xs.join('และ') : `${xs.slice(0, -1).join(' ')} และ${xs[xs.length - 1]}`;
}

const noKey = (s: string) => s.replace(/[\s\-–_/.]/g, '').toUpperCase();
/**
 * "เปลี่ยนไฟล์": what the new file says against the record it goes under. `ok` when its amount (at any of
 * the figures read), number and date agree with the stored ones (what the file does not show is not held
 * against it); `warn` names what differs (then it is probably a revision); `none` when nothing was read.
 */
export function swapCheck(old: Pick<DealDoc, 'amount' | 'docNo' | 'docDate' | 'basis'>, fx: DocFacts | null): { tone: 'ok' | 'warn' | 'none'; amount: number | null; docNo: string; docDate: string; differs: string[] } {
  if (!fx) return { tone: 'none', amount: null, docNo: '', docDate: '', differs: [] };
  const byBasis = { total: fx.total, subtotal: fx.subtotal, netPay: fx.netPay, manual: null };
  const read = [fx.total, fx.subtotal, fx.netPay].filter((x): x is number => x != null);
  const same = (a: number) => old.amount != null && Math.abs(a - old.amount) < 0.005;
  const amount = read.find(same) ?? byBasis[old.basis] ?? fx.total ?? fx.candidates[0]?.value ?? null;
  const differs: string[] = [];
  if (amount != null && old.amount != null && !same(amount)) differs.push('ยอด');
  if (fx.docNo && old.docNo && noKey(fx.docNo) !== noKey(old.docNo)) differs.push('เลขที่');
  if (fx.docDate && old.docDate && fx.docDate !== old.docDate) differs.push('วันที่');
  const tone = amount == null && !fx.docNo && !fx.docDate ? 'none' : differs.length ? 'warn' : 'ok';
  return { tone, amount, docNo: fx.docNo, docDate: fx.docDate, differs };
}

/** What the reader found in files this session (document id → its facts): the edit form offers the
 *  figures with and before VAT without reading the file again. Device- and session-local, never synced. */
export const qtFacts = new Map<string, DocFacts>();
