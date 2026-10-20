/**
 * Attaching a document in one screen (owner, Oct 2569: "ยัง งง เรื่องการแนบใบเสนอราคา"): pick a file, check one
 * number, press one button. The button that was pressed says what the document is (`AttachEntry`): the
 * QUOTATION card a quotation for the Forecast, a PAY card or plan row a receipt / invoice of that installment,
 * "เอกสารอื่น" evidence. The file's figures give ONE amount (what the customer pays: after withholding tax
 * when the document shows it, lib/docAmount), and a document that may be money already counted (the same
 * receipt again, a receipt after its invoice, money recorded by hand) is settled by ONE sentence with a word
 * tag and a safe default — never counted on top silently (lib/sales countGuard / countAs keep every rule).
 *
 * Pure: components/DocAttach.tsx renders the plan and nothing else; every link only changes `AttachChoice`
 * and the plan is worked out again (also right before saving: a teammate's sync may have changed the deal).
 * No data-model change: what is saved is engine.attachDoc's own info, then setPayFull when `full`.
 */
import { norm } from './core';
import { isoTh, localDay } from './format';
import { netOf, proposedAmount } from './docAmount';
import type { DocFacts } from './docExtract';
import { jointNo } from './joint';
import { attachRevision, qtDay, qtView } from './quotes';
import {
  QUOTE_STAGE, attachPreview, attachStage, closeReady, countAs, countGuard, countedAt, dealMoney, dealResult, fmtMoney, jointHeadOf, jointOf, jointRole, planOf, stageTh, stepOf, whtRate, withDoc,
  type AttachInfo, type CountGuard, type CountMode, type Deal, type DealDoc, type DocKind, type DocTarget, type LineView, type PayHow, type SalesState,
} from './sales';
import { shortName } from './salesUi';

/** Where an attach starts (the button pressed decides what the document is; nothing is asked). */
export type AttachEntry =
  /** the QUOTATION card, the Forecast figure, the quotation card's "แนบฉบับแก้ไข" (`revise`), the plan editor's
   *  typed total (`plan`: the confirmed figure goes into the total, `onSaved`), a joint quotation's head */
  | { at: 'quote'; revise?: string; plan?: boolean; onSaved?: (r: DocSaved) => void }
  /** a PAY card, a plan row, "รับเงินแล้ว"'s receipt (`stage`: the installment chosen); the Actual figure
   *  (no stage: the next installment not received) */
  | { at: 'pay'; stage?: string; onSaved?: (r: DocSaved) => void }
  /** "เอกสารอื่น"; a joint quotation's member always */
  | { at: 'other' };
/** What the attach ended with: the document, its figure saved, and whether it is the user's own ("พิมพ์ยอดเอง"). */
export interface DocSaved { doc: DealDoc; docFig: number | null; kept: boolean }
/** What the person changed on the screen (every link sets one of these and the plan is worked out again). */
export interface AttachChoice {
  /** "ใช้ยอดอื่น": a figure of the document, a candidate amount, or the one typed (`manual`) */
  figure?: 'netPay' | 'total' | 'subtotal' | 'manual' | number;
  manual?: number | null;
  /** "เปลี่ยนประเภท" (or a notice's link): what the document is; `stage` an installment's tile */
  kind?: 'quote' | 'pay' | 'other';
  stage?: string;
  /** a notice's other way ("นับเพิ่ม", "ใช้ไฟล์นี้แทนใบเดิม", "ใบนี้แทนใบเดิม" …) */
  count?: CountMode | 'nosave';
  /** the short installment is still owed: the shortfall is not withholding tax */
  notWht?: boolean;
  /** "แก้" on the document line */
  docNo?: string;
  docDate?: string;
  /** "แนบไว้ก่อน ยังไม่นับยอด": no amount read, attached as evidence at the installment for now */
  later?: boolean;
}
export type AttachMode = 'quote' | 'pay' | 'other';
export interface AttachNotice {
  tone: 'info' | 'warn';
  /** the word that carries the meaning (colour is never the only cue) */
  tag: string;
  /** a bold first part ("Forecast จาก 60,000 เป็น 55,000 บาท"), then the sentence */
  lead?: string;
  text: string;
  /** the one (at most two) other way: a choice, a deal to open, a document to look at */
  alts: { pre?: string; label: string; choice?: AttachChoice; open?: string; view?: string }[];
}
export interface FigRow { key: 'netPay' | 'total' | 'subtotal' | number; label: string; value: number; proposed: boolean }
export interface TypeTile { key: string; label: string; sub: string; choice: AttachChoice; on: boolean }
/** engine.attachDoc's info, as the dialog sends it */
export interface AttachSave {
  kind: DocKind; amount: number | null; target: DocTarget; basis: DealDoc['basis']; detected: number | null; docNo: string; docDate: string;
  stage?: string; replace?: string; drop?: string[]; addHand?: boolean; kept?: boolean; revise?: string;
}
export interface AttachPlan {
  mode: AttachMode;
  kind: DocKind; target: DocTarget; stage: string;
  /** the version a revision follows */
  revise?: string;
  /** the one amount (null: nothing read yet: the scan question) */
  amount: number | null;
  basis: DealDoc['basis']; detected: number | null; kept: boolean;
  /** what the reader proposed (lib/docAmount proposedAmount) */
  proposed: number | null;
  /** "ใช้ยอดอื่น": the document's figures, the proposed one first */
  figures: FigRow[];
  /** the title (what · where) and the line under it */
  title: string; sub: string; subShort: string;
  /** the document line: "ใบเสร็จ · เลขที่ … · 28 ก.ย. 2569"; `copies`: an original and a copy in one file */
  docWord: string; docNo: string; docDate: string; copies: boolean;
  amountLabel: string; reason: string; figs: string[];
  /** the reader is not sure (S3): the reason says so and "ใช้ยอดอื่น" opens by itself */
  low: boolean;
  /** nothing read (S2): one question, "ยอดเงินในเอกสารเท่าไร?", with the plan's figure as a chip */
  scan: boolean;
  chip: { label: string; value: number } | null;
  notice: AttachNotice | null;
  /** the "หลังบันทึก" line; `overTag` = "มากกว่าแผน" when Actual goes past the plan */
  after: string; overTag: string;
  /** how it counts next to money already counted ('nosave': the same file already counted: nothing stored) */
  count: CountMode | 'nosave' | null;
  save: AttachSave | null;
  noSave: boolean;
  /** count the installment complete after saving (setPayFull): the short part is withholding tax (R6) */
  full: boolean; fullStage: string;
  /** "ยังค้าง {short} บาท (ไม่ใช่หัก ณ ที่จ่าย)" in "ใช้ยอดอื่น" */
  whtShort: { short: number; rate: number } | null;
  primary: string; primaryOff: boolean; quiet: string;
  left: { label: string; act: 'save' | 'editNo'; choice?: AttachChoice } | null;
  links: { other: boolean; type: boolean; note: boolean };
  tiles: TypeTile[];
  /** the message after saving */
  toast: string;
  /** what the person agreed to: a change here at save time shows the new plan instead of saving */
  key: string;
}

const WORD: Record<DocKind, string> = { quotation: 'ใบเสนอราคา', invoice: 'ใบแจ้งหนี้', receipt: 'ใบเสร็จ', other: 'เอกสารอื่น' };
const near = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(a - b) < 0.005;
const r2 = (x: number) => Math.round(x * 100) / 100;
const N = (x: number | null | undefined) => fmtMoney(x == null ? x : r2(x));

/** A step in words: its code and Thai name ("PAY1" · "ชำระงวดที่ 1"). The one place a step is named here: the
 *  simple-steps work names steps through its stepLabel (a single installment "PAY ชำระเงิน"). */
export function stepName(_s: SalesState, _d: Deal, stage: string): { code: string; th: string } {
  return { code: stage, th: stageTh(stage).replace(/\s*\(YES \/ NO\)$/, '') };
}
const code = (s: SalesState, d: Deal, stage: string) => stepName(s, d, stage).code;

/** Two names refer to the same company? (ignores company-type words and punctuation) */
export function sameParty(a: string, b: string) {
  const strip = (x: string) => norm(x).replace(/บริษัท|จำกัด|มหาชน|ห้างหุ้นส่วน|co|ltd|plc|company|limited/gi, '');
  const x = strip(a), y = strip(b);
  return !x || !y || x.includes(y) || y.includes(x);
}

/** The withholding rate a document shows, in whole percent, when it is 1, 2, 3 or 5 % of the amount before VAT. */
export function whtPct(f: Pick<DocFacts, 'wht' | 'subtotal' | 'netPay' | 'vat'>): number | null {
  if (f.wht == null || !(f.wht > 0)) return null;
  const sub = f.subtotal ?? (f.netPay != null && f.vat != null ? f.netPay + f.wht - f.vat : null);
  if (sub == null || !(sub > 0)) return null;
  const p = (f.wht / sub) * 100, r = Math.round(p);
  return [1, 2, 3, 5].includes(r) && Math.abs(p - r) < 0.05 ? r : null;
}
/** The figures line: "ในเอกสาร: รวม VAT 61,730.77 · หัก ณ ที่จ่าย 3% 1,730.77 · ยอดชำระ 60,000" (each part
 *  kept whole); [] when the document shows one figure only. */
export function figParts(f: DocFacts): string[] {
  const net = netOf(f), r = whtPct(f), out: string[] = [];
  const tot = f.vat != null || f.subtotal != null ? 'รวม VAT' : 'ยอดรวม';
  if (net) {
    out.push(`${tot} ${N(f.total)}`);
    if (net.deduct) out.push(`หักเงินมัดจำ ${N(net.deduct)}`);
    if (net.wht) out.push(`หัก ณ ที่จ่าย ${r ? r + '% ' : ''}${N(net.wht)}`);
    out.push(`ยอดชำระ ${N(net.net)}`);
  } else {
    if (f.subtotal != null) out.push(`ก่อน VAT ${N(f.subtotal)}`);
    if (f.vat != null) out.push(`VAT ${N(f.vat)}`);
    if (f.total != null) out.push(`รวม ${N(f.total)}`);
    if (f.wht != null && f.wht > 0) out.push(`หัก ณ ที่จ่าย ${N(f.wht)}`);
    if (f.netPay != null && !near(f.netPay, f.total)) out.push(`ยอดชำระ ${N(f.netPay)}`);
  }
  return out.length > 1 ? out : [];
}
/** "ใช้ยอดอื่น": the document's figures (the proposed one first), then up to three other amounts found. */
export function figureRows(f: DocFacts, proposed: DealDoc['basis'] | null): FigRow[] {
  const net = netOf(f);
  const rows: FigRow[] = [];
  if (f.netPay != null && (net || (f.wht != null && f.wht > 0)))
    rows.push({ key: 'netPay', label: net && !net.wht ? 'ยอดชำระหลังหักเงินมัดจำ' : 'ยอดชำระหลังหัก ณ ที่จ่าย', value: f.netPay, proposed: proposed === 'netPay' });
  if (f.total != null) rows.push({ key: 'total', label: f.vat != null || f.subtotal != null ? 'ยอดรวมทั้งสิ้น (รวม VAT)' : 'ยอดรวมทั้งสิ้น', value: f.total, proposed: proposed === 'total' });
  if (f.subtotal != null) rows.push({ key: 'subtotal', label: 'ก่อน VAT', value: f.subtotal, proposed: proposed === 'subtotal' });
  if (proposed !== 'netPay') rows.sort((a, b) => +b.proposed - +a.proposed);
  // (the VAT and the withholding amounts are parts of the figures above, never the money itself)
  const others = f.candidates.filter((c) => !rows.some((x) => near(x.value, c.value)) && !near(c.value, f.vat) && !near(c.value, f.wht)).slice(0, 3);
  others.forEach((c, i) => rows.push({ key: c.value, label: 'ตัวเลขอื่นในเอกสาร', value: c.value, proposed: proposed === 'manual' && i === 0 }));
  if (proposed === 'manual') rows.sort((a, b) => +b.proposed - +a.proposed);
  return rows;
}
/** Why this figure, in one line (R-NET / R-TOTAL / R-TOTAL0 / R-LOW). */
function reasonOf(f: DocFacts, basis: DealDoc['basis'], forQt: boolean): string {
  if (basis === 'netPay') {
    const net = netOf(f), r = whtPct(f);
    const what = net && net.deduct && !net.wht ? 'ยอดชำระหลังหักเงินมัดจำ' : net && net.deduct ? `ยอดชำระหลังหักเงินมัดจำและหัก ณ ที่จ่าย${r ? ' ' + r + '%' : ''}` : `ยอดชำระหลังหัก ณ ที่จ่าย${r ? ' ' + r + '%' : ''}`;
    return `${what} · ${forQt ? 'เงินที่จะเข้าบัญชีจริง' : 'เงินที่เข้าบัญชีจริง'}`;
  }
  if (basis === 'total') {
    const vatPct = f.vat != null && f.total != null && f.total - f.vat > 0 ? Math.round((f.vat / (f.total - f.vat)) * 100) : null;
    const head = f.vat != null || f.subtotal != null ? `ยอดรวมทั้งสิ้น รวม VAT${vatPct ? ' ' + vatPct + '%' : ''}` : 'ยอดรวมทั้งสิ้น';
    return f.wht != null && f.wht > 0 ? head : f.vat != null || f.subtotal != null ? `${head} · เอกสารนี้ไม่มีหัก ณ ที่จ่าย` : head;
  }
  if (basis === 'subtotal') return 'ยอดก่อน VAT';
  return 'ยอดที่พบในเอกสาร · ระบบไม่แน่ใจ ตรวจกับไฟล์';
}

/** The entry a file dropped anywhere on the deal panel goes to: the current step when it is QUOTATION or an
 *  installment, else a won deal's next installment, else the quotation. */
export function panelEntry(s: SalesState, d: Deal, step: string, today: string): AttachEntry {
  if (jointRole(s, d) === 'member') return { at: 'other' };
  if (step === QUOTE_STAGE) return { at: 'quote' };
  const plan = planOf(s, d, today);
  if (step && (plan?.lines.some((l) => l.stage === step) || /^PAY/i.test(step) && s.cfg.stages.includes(step))) return { at: 'pay', stage: step };
  return dealResult(s, d) === 'YES' ? { at: 'pay' } : { at: 'quote' };
}

/**
 * The screen for one file: what it is, its one amount and why, the notice when it may be money already
 * counted, what saving changes, and the button that says it. `read`: what the reader found (null: nothing
 * read), the file's name and size (the same file attached again is found by them).
 */
export function attachPlan(s: SalesState, d: Deal, entry: AttachEntry, read: { facts: DocFacts | null; name: string; size: number }, choice: AttachChoice, today: string): AttachPlan {
  const f = read.facts, fk = f?.kind ?? null;
  const jm = jointRole(s, d) === 'member';
  const m0 = dealMoney(s, d), won = dealResult(s, d) === 'YES';
  const company = d.client;
  const docNo = (choice.docNo ?? f?.docNo ?? '').trim(), docDate = choice.docDate ?? f?.docDate ?? '';
  const plan0 = planOf(s, d, today);
  const nextPay = attachStage(s, d, { kind: 'receipt', target: 'actual' }, today);
  // the figure the reader proposes (a revision: at the basis of the version it follows, R7)
  const prop0 = f ? proposedAmount(f) : null;
  const readAmt = prop0?.value ?? null;

  // ---- R1: the button decides; a file that reads as another type is kept as evidence, with one link
  const want: AttachMode = jm ? 'other' : entry.at === 'quote' ? 'quote' : entry.at === 'pay' ? 'pay' : 'other';
  let mode: AttachMode = jm ? 'other' : choice.kind ?? want;
  let notice: AttachNotice | null = null;
  const money = fk === 'receipt' || fk === 'invoice';
  if (!jm && !choice.kind) {
    if (want === 'pay' && fk === 'quotation') {
      mode = 'other';
      notice = { tone: 'warn', tag: 'ไม่ใช่ใบเสร็จ', text: 'ไฟล์นี้อ่านได้ว่าเป็นใบเสนอราคา ไม่ใช่ใบเสร็จหรือใบแจ้งหนี้ · แนบไว้เป็นหลักฐานก่อน', alts: [{ label: 'ใช้เป็นใบเสนอราคา (Forecast)', choice: { kind: 'quote' } }] };
    } else if (want === 'quote' && money) {
      mode = 'other';
      notice = {
        tone: 'warn', tag: 'ไม่ใช่ใบเสนอราคา',
        text: `ไฟล์นี้อ่านได้ว่าเป็น${WORD[fk!]}${readAmt != null ? ' ' + N(readAmt) + ' บาท' : ''} · แนบไว้เป็นหลักฐาน${won ? 'ก่อน' : ''}`,
        alts: won ? [{ label: `นับเป็นเงินรับขั้น ${code(s, d, nextPay) || 'PAY'}`, choice: { kind: 'pay' } }] : [],
      };
    } else if (want === 'other' && (money || fk === 'quotation') && readAmt != null) {
      notice = fk === 'quotation'
        ? { tone: 'info', tag: 'เป็นใบเสนอราคา', text: `ไฟล์นี้เป็นใบเสนอราคา ${N(readAmt)} บาท · ถ้าเป็นใบเสนอราคาของงานนี้`, alts: [{ label: 'ใช้เป็นใบเสนอราคา (Forecast)', choice: { kind: 'quote' } }] }
        : {
            tone: 'info', tag: `เป็น${WORD[fk!]}`, text: `ไฟล์นี้เป็น${WORD[fk!]} ${N(readAmt)} บาท (${reasonOf(f!, prop0!.basis, false).split(' · ')[0]})${won ? ' · ถ้าเป็นเงินที่ได้รับของงานนี้' : ''}`,
            alts: won ? [{ label: `นับเป็นเงินรับขั้น ${code(s, d, nextPay) || 'PAY'}`, choice: { kind: 'pay' } }] : [],
          };
    }
  }
  if (jm) {
    const g = jointOf(s, d), hid = jointHeadOf(s, d.id), no = g ? jointNo(s, g) : '';
    notice = { tone: 'info', tag: 'ใบเสนอราคาร่วม', text: `บริษัทนี้อยู่ในใบเสนอราคาร่วม${no ? ' ' + no : ''} · ใบเสนอราคาและใบเสร็จนับที่ใบเสนอราคาร่วม`, alts: hid && hid !== d.id ? [{ label: 'เปิดใบเสนอราคาร่วม', open: hid }] : [] };
  }

  // ---- what it is, where it goes
  const kind: DocKind = mode === 'quote' ? 'quotation' : mode === 'pay' ? (fk === 'invoice' ? 'invoice' : 'receipt') : fk ?? 'other';
  const pickedStage = mode === 'pay' ? choice.stage ?? (entry.at === 'pay' ? entry.stage : undefined) : undefined;
  const stage = mode === 'quote'
    ? attachStage(s, d, { kind: 'quotation', target: 'forecast' }, today)
    : mode === 'pay' ? attachStage(s, d, { kind, target: 'actual', ...(pickedStage !== undefined ? { stage: pickedStage } : {}) }, today) : '';
  const pinned = pickedStage !== undefined;
  const rev = mode === 'quote' ? attachRevision(s, d, { kind: 'quotation', target: 'forecast', stage, revise: entry.at === 'quote' && !choice.kind ? entry.revise : undefined }, today) : null;
  const k = rev ? qtView(s, d).versions.length + 1 : 0;

  // ---- R2 / R7: the one amount
  let prop = prop0, sameBasis = true;
  if (rev && f) {
    const ob = rev.doc.basis;
    if (ob !== 'manual' && f[ob] != null) prop = { basis: ob, value: f[ob] };
    else sameBasis = ob === 'manual';
  }
  let amount: number | null = prop?.value ?? null, basis: DealDoc['basis'] = prop?.basis ?? 'manual', detected: number | null = amount, kept = false, picked = '';
  const fig = choice.figure;
  if (fig === 'netPay' || fig === 'total' || fig === 'subtotal') {
    if (f && f[fig] != null) ((amount = f[fig]), (basis = fig), (detected = amount), (picked = fig));
  } else if (typeof fig === 'number') {
    ((amount = fig), (basis = 'manual'), (detected = fig), (picked = 'cand'));
  } else if (fig === 'manual' && choice.manual != null) {
    detected = prop?.value ?? null;
    amount = r2(choice.manual);
    basis = 'manual';
    kept = detected != null && !near(amount, detected);
    picked = 'manual';
  }
  if (choice.later) amount = null;
  const scan = mode !== 'other' && prop?.value == null && picked !== 'manual' && !choice.later;
  const low = !!f && !scan && picked === '' && (prop?.basis === 'manual' || f.confidence === 'low');
  let reason = !f || amount == null ? '' : picked === 'manual' ? 'ยอดที่พิมพ์เอง' : picked === 'cand' ? 'ยอดที่เลือกจากเอกสาร' : reasonOf(f, basis, mode === 'quote');
  if (reason && rev && sameBasis && picked === '' && rev.doc.basis !== 'manual' && basis === rev.doc.basis) reason += ` · คิดแบบเดียวกับฉบับที่ ${rev.n}`;
  if (low && reason && !/ไม่แน่ใจ/.test(reason)) reason += ' · ระบบไม่แน่ใจ ตรวจกับไฟล์';

  // ---- words common to every mode
  const pc = stage ? code(s, d, stage) : '';
  const sn = stage ? stepName(s, d, stage) : null;
  const where = sn ? `ขั้น ${sn.code}${sn.th ? ' ' + sn.th : ''}` : '';
  const line0: LineView | null = mode === 'pay' && stage ? plan0?.lines.find((l) => l.stage === stage) || null : null;
  let title = '', sub = company, subShort = shortName(company), amountLabel = '', after = '', overTag = '', primary = '', quiet = 'ยกเลิก', toast = '';
  let left: AttachPlan['left'] = null;
  let count: AttachPlan['count'] = null, save: AttachSave | null = null, noSave = false, full = false, fullStage = '', whtShort: AttachPlan['whtShort'] = null;
  let links = { other: mode !== 'other', type: !jm && !rev, note: !!stage && s.cfg.stages.includes(stage) };
  const noLabel = docNo ? ' ' + docNo : '';
  const base = (x: Partial<AttachSave>): AttachSave => ({ kind, amount, target: amount == null ? 'none' : 'actual', basis: amount == null ? 'manual' : basis, detected: amount == null ? null : detected, docNo, docDate, stage, kept: kept && amount != null, ...x });

  if (mode === 'quote') {
    title = rev ? `ใบเสนอราคาฉบับแก้ไข · ฉบับที่ ${k}` : `ใบเสนอราคา${stage ? ' · ขั้น ' + stage : ''}`;
    if (rev) {
      sub = `${company} · แก้จาก${rev.doc.docNo ? ' ' + rev.doc.docNo : ''} ฉบับที่ ${rev.n}`;
      subShort = `${shortName(company)} · แก้จากฉบับที่ ${rev.n}`;
    }
    amountLabel = rev ? 'Forecast ใหม่' : 'ยอดที่ลูกค้าจะจ่าย · เป็น Forecast';
    save = base({ target: amount == null ? 'none' : 'forecast', revise: rev && amount != null ? rev.doc.id : undefined });
    // R7: the revision against the version it follows, on the same basis
    if (rev && amount != null) {
      const was = rev.doc.amount;
      const diff = was != null ? r2(amount - was) : null;
      const pct = was && diff ? Math.round((Math.abs(diff) / was) * 100) : 0;
      const bw = rev.doc.basis === 'netPay' ? 'ยอดชำระหลังหัก ณ ที่จ่าย' : rev.doc.basis === 'total' ? 'ยอดรวม' : rev.doc.basis === 'subtotal' ? 'ยอดก่อน VAT' : '';
      const tail = !sameBasis ? 'คนละฐานกับฉบับเดิม' : rev.doc.basis === 'manual' || picked ? `เทียบกับยอดที่นับไว้ในฉบับที่ ${rev.n}` : `เทียบ${bw}ทั้งสองฉบับ`;
      notice = was == null
        ? { tone: 'info', tag: 'ฉบับแก้ไข', lead: `Forecast เป็น ${N(amount)} บาท`, text: `ฉบับที่ ${rev.n} ไม่ได้ระบุยอด`, alts: [] }
        : !diff
          ? { tone: 'info', tag: 'ฉบับแก้ไข', lead: `Forecast เท่าเดิม ${N(amount)} บาท`, text: tail, alts: [] }
          : { tone: 'info', tag: 'ฉบับแก้ไข', lead: `Forecast จาก ${N(was)} เป็น ${N(amount)} บาท`, text: `${diff < 0 ? 'ลดลง' : 'เพิ่มขึ้น'} ${N(Math.abs(diff))} บาท (${pct ? pct + '%' : 'ไม่ถึง 1%'}) · ${tail}`, alts: [] };
    }
    if (amount != null) {
      const sAfter = withDoc(s, d, { kind, amount, target: 'forecast', docDate, stage }, today);
      const qd = stage ? stepOf(sAfter, d.id, stage).d : '';
      const done = stage && qd ? ` · ขั้น ${stage} ทำแล้ว ${isoTh(qd)}` : '';
      const typed = m0.forecast != null && (!m0.fcDoc || m0.fcOverride) ? m0.forecast : null;
      after = rev
        ? `ฉบับที่ ${rev.n}${qtDay(rev.doc) ? ' (' + isoTh(qtDay(rev.doc)) + ')' : ''} เก็บเป็น “ฉบับเดิม” เปิดดูได้ ไม่นับยอด${stepOf(s, d.id, stage).d ? ` · วันที่ขั้น ${stage} ยังเป็น ${isoTh(stepOf(s, d.id, stage).d)}` : ''}`
        : entry.at === 'quote' && entry.plan
          ? `ยอดรวมแผนเป็น ${N(amount)} บาท ตามใบเสนอราคา`
          : typed != null && !near(typed, amount)
            ? `Forecast จาก ${N(typed)} (พิมพ์ไว้) เป็น ${N(amount)} บาท${done}`
            : `Forecast เป็น ${N(amount)} บาท${done}`;
    }
    if (amount == null) left = { label: 'แนบไว้ก่อน ยังไม่นับยอด', act: 'save', choice: { ...choice, later: true } };
    primary = amount == null ? 'บันทึก Forecast' : rev ? `บันทึกฉบับที่ ${k} · Forecast ${N(amount)} บาท` : `บันทึก Forecast ${N(amount)} บาท`;
    toast = rev ? `บันทึกใบเสนอราคา${noLabel || (rev.doc.docNo ? ' ' + rev.doc.docNo : '')} ฉบับที่ ${k} แล้ว · Forecast ${N(amount)} บาท` : `บันทึกใบเสนอราคา${noLabel} แล้ว · Forecast ${N(amount)} บาท`;
  } else if (mode === 'pay') {
    title = `${WORD[kind]} · ${where || 'นับเข้า Actual'}`;
    if (line0) {
      const extra = line0.got > 0 ? ` · รับแล้ว ${N(line0.got)}` : line0.due ? ` ครบกำหนด ${isoTh(line0.due)}` : '';
      sub = `${company} · แผน ${N(line0.amt)} บาท${extra}`;
      subShort = `${shortName(company)} · แผน ${N(line0.amt)} บาท`;
    } else if (m0.forecast != null) {
      sub = `${company} · Forecast ${N(m0.forecast)} บาท`;
      subShort = `${shortName(company)} · Forecast ${N(m0.forecast)} บาท`;
    }
    amountLabel = kind === 'invoice' ? 'ยอดเรียกเก็บ · นับเข้า Actual' : 'เงินที่ได้รับ · นับเข้า Actual';
    const info0: AttachInfo = { kind, amount, target: 'actual', docDate, stage };
    const g: CountGuard | null = amount != null
      ? countGuard(s, d, { ...info0, pinned, docNo, name: read.name.slice(0, 120), size: read.size, figures: f ? [f.total, f.netPay, f.subtotal] : [], refs: f?.refs }, today)
      : null;
    const decided = g ? payCount(s, d, g, { kind, amount: amount!, stage, line0, name: read.name.slice(0, 120), size: read.size, figures: f ? [f.total, f.netPay, f.subtotal] : [], pinned }, today) : null;
    let cm: AttachPlan['count'] = decided ? decided.def : null;
    if (decided && choice.count && decided.allowed.includes(choice.count)) cm = choice.count;
    count = cm;
    if (decided?.notice) notice = decided.notice(cm!);
    const dup = !!g?.sames.length;
    if (dup) amountLabel = 'เงินที่ได้รับ · นับครั้งเดียว';
    if (cm === 'none' && !dup) amountLabel = 'ยอดในเอกสาร · ไม่นับยอด';
    if (dup && (cm === 'none' || cm === 'nosave')) {
      links = { other: false, type: false, note: false };
      if (near(g!.same?.amount, amount)) reason = 'เท่ากับใบเดิม · ' + reason.split(' · ')[0];
    }
    if (cm === 'nosave') noSave = true;
    else if (g && cm) {
      const how = countAs(g, cm, info0);
      // money recorded by hand at this installment kept with the document ("ส่วนที่เหลือ", or "นับเพิ่ม")
      if (cm === 'add' && decided!.handHere) how.addHand = true;
      save = base({ amount: how.amount, target: how.target, stage: how.stage, replace: how.replace, drop: how.drop, addHand: how.addHand || undefined, ...(cm === 'rest' && how.amount !== amount ? { basis: 'manual', kept: true, detected: amount } : {}) });
    } else save = base({ target: 'none' }); // no amount: attached as evidence at the installment for now
    // R6: an installment short by exactly withholding tax is received in full
    const S1 = save && save.target === 'actual' ? withDoc(s, d, toInfo(save), today) : s;
    const tStage = save?.stage ?? stage;
    let lineA = tStage ? planOf(S1, d, today)?.lines.find((l) => l.stage === tStage) || null : null;
    if (dup && (cm === 'none' || cm === 'nosave') && g!.same?.stage) {
      fullStage = g!.same.stage;
      lineA = planOf(s, d, today)?.lines.find((l) => l.stage === fullStage) || null;
    } else fullStage = tStage;
    const counting = !!save && save.target === 'actual';
    if (lineA && lineA.got > 0 && lineA.got < lineA.amt - 0.005 && !lineA.full && (counting || dup)) {
      const r = whtRate(lineA.amt, lineA.got);
      if (r != null) {
        whtShort = { short: r2(lineA.amt - lineA.got), rate: r };
        full = !choice.notWht;
      }
    }
    const S2 = full && lineA ? { ...S1, pays: { ...S1.pays, [`${d.id}/${lineA.stage}`]: { ...S1.pays[`${d.id}/${lineA.stage}`], full: true, fullAt: lineA.got } } } : S1;
    const ready0 = closeReady(s, d, today), ready1 = closeReady(S2, d, today);
    const mA = dealMoney(S2, d), A = mA.actual;
    const lc = lineA ? code(s, d, lineA.stage) : pc;
    const fullWords = full && whtShort ? `ขั้น ${lc} ถือว่ารับครบ เพราะส่วนที่ขาด ${N(whtShort.short)} คือหัก ณ ที่จ่าย ${whtShort.rate}%` : '';
    if (amount == null) after = '';
    else if (!counting) {
      after = [m0.actual != null ? `Actual ยังเป็น ${N(m0.actual)} บาท` : 'ไม่เปลี่ยน Actual', fullWords, ready1 && !ready0 ? 'งานนี้พร้อมปิดงาน' : ''].filter(Boolean).join(' · ');
      if (cm === 'none' && !dup && stage) after = `เก็บไว้ที่ขั้น ${pc} เป็นหลักฐาน · ` + after;
    } else {
      const before = m0.acDocs || m0.hand ? m0.actual : null;
      const replaced = !!(save!.replace || save!.drop?.length || cm === 'move' || (decided?.handHere && !save!.addHand));
      const parts: string[] = [];
      if (replaced && before != null) parts.push(near(before, A) ? `Actual ยังเป็น ${N(A)} บาท` : `Actual จาก ${N(before)} เป็น ${N(A)} บาท`);
      const P1 = planOf(S2, d, today), cap = P1 && P1.total > 0 ? P1.total : mA.forecast;
      if (cap != null && cap > 0 && A != null && A > cap + 0.005 && (before == null || A > before + 0.005)) {
        overTag = `มากกว่า${P1 && P1.total > 0 ? 'แผน' : ' Forecast'}`;
        parts.length = 0;
        parts.push(`Actual จะเป็น ${N(A)} มากกว่า${P1 && P1.total > 0 ? 'แผน' : ' Forecast'} ${N(A - cap)} บาท · ตรวจว่าใช่เงินที่เข้าบัญชีจริง`);
      } else if (lineA) {
        const leftN = P1 ? P1.lines.filter((l) => l.status !== 'paid' && l.status !== 'off').length : 0;
        if (fullWords) parts.push(fullWords);
        else if (lineA.got >= lineA.amt - 0.005) {
          if (lineA.amt > 0 && lineA.got > lineA.amt + 0.005) parts.push(`ขั้น ${lc} รับเกินแผน ${N(lineA.got - lineA.amt)} บาท`);
          else if (ready1 && !leftN) parts.push(replaced ? 'รับครบตามแผน' : `รับครบตามแผน ${N(P1!.total)} บาท · Actual ${N(A)}${mA.forecast != null ? ' จาก Forecast ' + N(mA.forecast) : ''}`);
          else if (leftN) parts.push(`ขั้น ${lc} ครบตามแผน ${N(lineA.amt)} บาท · เหลืออีก ${leftN} งวด ${N(P1!.left)} บาท`);
          else parts.push(`ขั้น ${lc} ครบตามแผน ${N(lineA.amt)} บาท`);
        } else parts.push(`ขั้น ${lc} ยังค้าง ${N(lineA.amt - lineA.got)} บาท`);
        if (ready1) parts.push('งานนี้พร้อมปิดงาน');
      } else {
        if (!replaced) parts.push(`Actual เป็น ${N(A)} บาท${mA.forecast != null && A != null && A >= mA.forecast - 0.005 ? ' · ครบตาม Forecast' : ''}`);
        if (ready1) parts.push('งานนี้พร้อมปิดงาน');
      }
      const pv = attachPreview(s, d, toInfo(save!), today);
      if (pv.unpaid.length) parts.push(`${pv.unpaid.join(', ')} จะกลับเป็นยังไม่ได้รับ`);
      after = parts.join(' · ');
    }
    // the button names what is saved, and the amount
    const shown = save?.amount ?? amount;
    if (amount == null) {
      primary = 'บันทึกรับเงิน';
      left = { label: 'แนบไว้ก่อน ยังไม่นับยอด', act: 'save', choice: { ...choice, later: true } };
    } else if (dup && (cm === 'none' || cm === 'nosave')) {
      primary = 'ตกลง ไม่นับซ้ำ';
      quiet = 'ไม่แนบ';
      if (g!.sameBy === 'no' && !g!.sames.some((x) => x.size === read.size && x.name === read.name.slice(0, 120))) left = { label: 'ไม่ใช่ใบเดียวกัน? แก้เลขที่', act: 'editNo' };
    } else if (cm === 'none') primary = 'แนบเป็นหลักฐาน';
    else if (cm === 'move') primary = `บันทึกรับเงินที่ ${code(s, d, save!.stage || '')} ${N(shown)} บาท`;
    else primary = kind === 'invoice' ? `บันทึกใบแจ้งหนี้ ${N(shown)} บาท` : `บันทึกรับเงิน ${N(shown)} บาท`;
    const at = save?.stage ? code(s, d, save.stage) : pc;
    toast = dup && (cm === 'none' || cm === 'nosave')
      ? `ไม่นับซ้ำ · Actual ยังเป็น ${N(m0.actual)} บาท${full ? ` · ${lc} ถือว่ารับครบ` : ''}`
      : cm === 'none' || amount == null
        ? `แนบ${WORD[kind]}${noLabel} ไว้เป็นหลักฐานแล้ว · ไม่นับยอด`
        : `${kind === 'invoice' ? 'บันทึกใบแจ้งหนี้' : 'บันทึกรับเงิน'} ${N(shown)} บาท${at ? ' ที่ขั้น ' + at : ''} แล้ว`;
  } else {
    title = 'เอกสารอื่น · ไม่นับยอด';
    save = base({ target: 'none', stage: '', amount: readAmt != null && fk && fk !== 'other' ? readAmt : null, basis: prop0?.basis ?? 'manual', detected: readAmt, kept: false });
    after = 'เก็บในการ์ด “เอกสารอื่น” · ไม่เปลี่ยน Forecast หรือ Actual';
    primary = 'แนบเป็นหลักฐาน';
    toast = `แนบ${WORD[kind]}${noLabel} ไว้ในเอกสารอื่นแล้ว · ไม่นับยอด`;
    links = { other: false, type: !jm, note: false };
  }

  // ---- R9: the customer named in the document (a joint quotation's member may name its payer)
  const payer = jm ? s.deals[jointHeadOf(s, d.id)]?.client : undefined;
  if (f?.party && !sameParty(f.party, company) && !(payer && sameParty(f.party, payer))) {
    const t = `ชื่อลูกค้าในเอกสาร "${f.party}" ไม่ตรงกับ "${company}" · ตรวจว่าแนบถูกงาน`;
    notice = notice ? { ...notice, text: notice.text + ' · ' + t } : { tone: 'warn', tag: 'ชื่อไม่ตรง', text: t, alts: [] };
  }

  // ---- "เปลี่ยนประเภท": a tile per installment still to be received (one when there is one or no plan)
  const tiles: TypeTile[] = [];
  if (links.type) {
    tiles.push({ key: 'quote', label: 'ใบเสนอราคา', sub: 'เป็น Forecast', choice: { kind: 'quote' }, on: mode === 'quote' });
    const open = (plan0?.lines || []).filter((l) => l.status !== 'paid' && l.status !== 'off');
    if (open.length > 1) open.forEach((l) => tiles.push({ key: 'pay:' + l.stage, label: 'ใบเสร็จ / ใบแจ้งหนี้', sub: `เงินรับขั้น ${code(s, d, l.stage)}`, choice: { kind: 'pay', stage: l.stage }, on: mode === 'pay' && stage === l.stage }));
    else tiles.push({ key: 'pay', label: 'ใบเสร็จ / ใบแจ้งหนี้', sub: `เงินรับขั้น ${code(s, d, mode === 'pay' && stage ? stage : nextPay) || 'PAY'}`, choice: { kind: 'pay' }, on: mode === 'pay' });
    tiles.push({ key: 'other', label: 'เอกสารอื่น', sub: 'เก็บไว้ ไม่นับยอด', choice: { kind: 'other' }, on: mode === 'other' });
  }

  // the scan question's chip: what the plan expects here (a quotation: the typed Forecast)
  let chip: AttachPlan['chip'] = null;
  const unread = mode !== 'other' && prop?.value == null && !choice.later;
  if (unread && mode === 'pay' && line0 && line0.amt > 0) {
    const v = line0.got > 0 ? r2(line0.amt - line0.got) : line0.amt;
    if (v > 0) chip = { label: `ตามแผนขั้นนี้ ${N(v)}`, value: v };
  } else if (unread && mode === 'quote' && m0.forecast != null && !m0.fcDoc) chip = { label: `ตาม Forecast ที่พิมพ์ไว้ ${N(m0.forecast)}`, value: m0.forecast };

  const figures = f && mode !== 'other' ? figureRows(f, prop?.basis ?? null) : [];
  return {
    mode, kind, target: save?.target ?? 'none', stage: save?.stage ?? stage, revise: save?.revise,
    amount, basis, detected, kept: save?.kept ?? false, proposed: prop?.value ?? null, figures,
    title, sub, subShort, docWord: WORD[kind], docNo, docDate, copies: !!f?.copies,
    amountLabel, reason, figs: f && mode !== 'other' && amount != null && !(links.other === false && mode === 'pay') ? figParts(f) : [], low, scan, chip,
    notice, after, overTag, count, save: noSave ? null : save, noSave, full, fullStage, whtShort,
    primary, primaryOff: mode !== 'other' && amount == null && !choice.later, quiet, left, links, tiles, toast,
    key: JSON.stringify([notice?.tag, notice?.text, amount, primary, count, save?.stage, save?.target, save?.replace, full]),
  };
}

const toInfo = (x: AttachSave): AttachInfo => ({ kind: x.kind, amount: x.amount, target: x.target, docDate: x.docDate, stage: x.stage, replace: x.replace, drop: x.drop, addHand: x.addHand });

/**
 * How a receipt / invoice counts next to the money already counted (R3–R5), as one default, the other
 * ways a notice's link may take (`allowed`), and the notice for each. Builds on countGuard: the same
 * document (number or file) counted anywhere, another document or a hand receipt at this installment,
 * the receipt of money counted at another installment, a job already paid.
 */
function payCount(
  s: SalesState, d: Deal, g: CountGuard,
  x: { kind: DocKind; amount: number; stage: string; line0: LineView | null; name: string; size: number; figures: (number | null)[]; pinned: boolean },
  _today: string,
): { def: CountMode | 'nosave'; allowed: (CountMode | 'nosave')[]; notice: ((cm: CountMode | 'nosave') => AttachNotice | null) | null; handHere: boolean } {
  const pc = code(s, d, g.stage), W = WORD[x.kind], l = x.line0;
  const docName = (z: DealDoc) => `${WORD[z.kind]} ${z.docNo || z.name}`;
  const handHere = !!l && l.hand && !l.docs.length && l.handGot > 0;
  // R5b: what came in at this installment plus this one is the plan (or short of it by withholding tax)
  const fits = (got: number) => !!l && l.status === 'part' && l.amt > 0 && (got + x.amount <= l.amt * 1.01 + 0.005 || whtRate(l.amt, got + x.amount) != null);
  const addOther = (pre = 'เป็นเงินอีกก้อน?'): AttachNotice['alts'][number] => ({ pre, label: 'นับเพิ่ม', choice: { count: 'add' } });

  // R4: the same document (its number, or the same file) is counted already
  if (g.sames.length) {
    const same = g.same!, here = same.stage === g.stage, twice = g.sames.length > 1;
    const identical = g.sames.some((z) => z.size === x.size && z.name === x.name);
    const at = (z: DealDoc) => `ขั้น ${code(s, d, z.stage) || 'ไม่ระบุ'}`;
    if (twice)
      return {
        def: 'replace', allowed: ['replace', 'none'], handHere,
        notice: () => ({ tone: 'warn', tag: 'ใบซ้ำ', text: `${docName(same)} นับซ้ำอยู่ ${g.sames.length} ครั้ง (${g.sames.map((z) => `${at(z)} ${N(z.amount)}`).join(' · ')} บาท) · บันทึกครั้งนี้นับครั้งเดียวที่ขั้น ${pc} ไม่นับซ้ำ`, alts: [] }),
      };
    if (here && !near(same.amount, x.amount))
      return {
        def: 'replace', allowed: ['replace', 'none'], handHere,
        notice: (cm) => ({
          tone: 'warn', tag: 'ใบซ้ำ',
          text: cm === 'none' ? `${docName(same)} นับไว้แล้วที่${at(same)} ${N(same.amount)} บาท · ระบบจะไม่นับซ้ำ` : `${docName(same)} นับไว้แล้วที่${at(same)} ${N(same.amount)} บาท · บันทึกครั้งนี้นับแทนเป็น ${N(x.amount)} บาท ไม่นับซ้ำ`,
          alts: cm === 'none' ? [{ label: `นับแทนเป็น ${N(x.amount)} บาท`, choice: { count: 'replace' } }] : [{ label: 'คงยอดเดิม', choice: { count: 'none' } }],
        }),
      };
    const def = identical ? 'nosave' : 'none';
    return {
      def, allowed: here && !identical ? ['none', 'replace'] : [def], handHere,
      notice: (cm) => ({
        tone: 'warn', tag: 'ใบซ้ำ',
        text: cm === 'replace'
          ? `${docName(same)} นับไว้แล้วที่${at(same)} ${N(same.amount)} บาท · ใช้ไฟล์นี้แทนใบเดิม ยอดเท่าเดิม ไม่นับซ้ำ`
          : `${docName(same)} นับไปแล้วที่${at(same)} ${N(same.amount)} บาท (แนบ ${isoTh(localDay(same.at))}) · ระบบจะไม่นับซ้ำ${!here && !planOf(s, d, _today) ? ' · งานที่รับเงินครั้งเดียว ตั้งแผนชำระ 1 งวด แล้วปิดงานได้' : ''}`,
        alts: [
          { label: 'ดูใบเดิม', view: same.id },
          ...(here && !identical ? [cm === 'replace' ? { label: 'เก็บไฟล์นี้เป็นหลักฐาน', choice: { count: 'none' as const } } : { label: 'ใช้ไฟล์นี้แทนใบเดิม', choice: { count: 'replace' as const } }] : []),
        ],
      }),
    };
  }
  // R3: an invoice after a receipt counted at the installment is evidence
  const rcpt = x.kind === 'invoice' && g.stage ? countedAt(s, d, g.stage).find((z) => z.kind === 'receipt') : undefined;
  if (rcpt)
    return { def: 'none', allowed: ['none'], handHere, notice: () => ({ tone: 'info', tag: 'เก็บเป็นหลักฐาน', text: `ขั้น ${pc} มีใบเสร็จ ${rcpt.docNo || rcpt.name} นับแล้ว · ใบแจ้งหนี้นี้เก็บไว้เป็นหลักฐาน ไม่นับยอด`, alts: [] }) };
  // R5e: a job already paid: counting it on top would go well past the plan / Forecast (countGuard decides)
  if (g.over) {
    const o = g.overAdd ?? g.over, what = o.what === 'แผน' ? 'แผน' : ' Forecast';
    const how = (cm: CountMode | 'nosave') =>
      cm === 'replace' && g.old ? `นับแทน${docName(g.old)} ที่นับไว้ ${N(g.old.amount)} บาท`
      : cm === 'replace' ? 'นับแทนใบเดิม'
      : cm === 'move' ? `แนบที่ขั้น ${code(s, d, (g.inv || g.hand)!.stage)} แทน ไม่นับซ้ำ`
      : cm === 'rest' ? `นับเฉพาะส่วนที่ยังไม่ได้รับ ${N(g.rest)} บาท`
      : 'เก็บไว้เป็นหลักฐาน ไม่นับยอด';
    return {
      def: g.pick, allowed: g.modes, handHere,
      notice: (cm) => cm === 'add'
        ? { tone: 'warn', tag: 'นับเพิ่ม', text: `นับเพิ่มแล้ว Actual จะเป็น ${N(o.after)} มากกว่า${what} ${N(o.cap)} บาท`, alts: [{ label: how(g.pick), choice: { count: g.pick } }] }
        : { tone: 'warn', tag: 'ไม่นับเพิ่ม', text: `นับเพิ่มแล้ว Actual จะเป็น ${N(o.after)} มากกว่า${what} ${N(o.cap)} บาท · จึง${how(cm)}`, alts: [addOther('')] },
    };
  }
  // the receipt of an invoice counted at another installment (offered, not chosen, at an installment the
  // user picked that already counts money: the rules below come first then)
  if (g.inv && (g.pick === 'move' || (!g.old && !handHere))) {
    const inv = g.inv, xc = code(s, d, inv.stage);
    return {
      def: g.pick, allowed: ['move', 'add'], handHere,
      notice: (cm) => cm === 'move'
        ? { tone: 'info', tag: `ย้ายไป ${xc}`, text: `ใบเสร็จนี้คือเงินของใบแจ้งหนี้ ${inv.docNo || inv.name} ที่นับไว้ที่ขั้น ${xc} ${N(inv.amount)} บาท · แนบที่ ${xc} แทนใบแจ้งหนี้ ไม่นับซ้ำ`, alts: [{ label: `นับเพิ่มที่ ${pc} แทน`, choice: { count: 'add' } }] }
        : { tone: 'info', tag: `นับที่ ${pc}`, text: `ขั้น ${xc} นับใบแจ้งหนี้ ${inv.docNo || inv.name} ไว้ ${N(inv.amount)} บาท · ใบนี้นับเป็นเงินของขั้น ${pc}`, alts: [{ pre: 'ถ้าเป็นใบเสร็จของใบแจ้งหนี้นั้น', label: `ย้ายไป ${xc}`, choice: { count: 'move' } }] },
    };
  }
  // money recorded by hand at another installment, of an amount this document shows (R5d)
  if (g.hand) {
    const h = g.hand, xc = code(s, d, h.stage), when = h.line.rcv ? ` (${isoTh(h.line.rcv)})` : '';
    return {
      def: g.pick, allowed: ['move', 'add'], handHere,
      notice: (cm) => cm === 'move'
        ? { tone: 'info', tag: `ย้ายไป ${xc}`, text: `เงินก้อนนี้บันทึกไว้ที่ขั้น ${xc} แล้ว${when} · แนบใบเสร็จนี้ที่ ${xc} แทน ไม่นับซ้ำ`, alts: [{ label: `นับเพิ่มที่ ${pc} แทน`, choice: { count: 'add' } }] }
        : { tone: 'info', tag: `นับที่ ${pc}`, text: `ขั้น ${xc} บันทึกรับเงินเองไว้ ${N(h.handGot)} บาท${when} · ใบนี้นับเป็นเงินของขั้น ${pc}`, alts: [{ pre: 'ถ้าเป็นใบเสร็จของเงินก้อนนั้น', label: `ย้ายไป ${xc}`, choice: { count: 'move' } }] },
    };
  }
  // R5a/b: another document counted at this installment
  if (g.old) {
    const old = g.old, ow = WORD[old.kind] + (old.kind === x.kind ? 'เดิม' : '');
    const add = fits(l?.got ?? 0);
    const sum = r2((l?.got ?? 0) + x.amount);
    return {
      def: add ? 'add' : 'replace', allowed: ['replace', 'add'], handHere,
      notice: (cm) => cm === 'add'
        ? { tone: 'info', tag: 'ส่วนที่เหลือ', text: `ใบนี้คือเงินส่วนที่เหลือของขั้น ${pc} · รวมกับใบเดิม ${old.docNo || old.name} ${N(l?.got ?? old.amount)} เป็น ${N(sum)} บาท${l && sum >= l.amt - 0.005 ? ' ครบตามแผน' : ''}`, alts: [{ label: 'ใบนี้แทนใบเดิม', choice: { count: 'replace' } }] }
        : { tone: 'info', tag: 'นับแทน', text: `${W}นี้นับแทน${WORD[old.kind]} ${old.docNo || old.name} ที่นับไว้ ${N(old.amount)} บาท · ${ow}เก็บไว้เป็นหลักฐาน ไม่นับซ้ำ`, alts: [addOther()] },
    };
  }
  // R5c: money recorded by hand at this installment, no document yet
  if (handHere) {
    const hg = l!.handGot, when = l!.line.rcv ? ` (${isoTh(l!.line.rcv)})` : '';
    const add = fits(hg);
    const same = near(x.amount, hg) || x.figures.some((v) => near(v, hg));
    return {
      def: add ? 'add' : 'replace', allowed: ['replace', 'add'], handHere,
      notice: (cm) => cm === 'add'
        ? { tone: 'info', tag: 'ส่วนที่เหลือ', text: `ใบนี้คือเงินส่วนที่เหลือของขั้น ${pc} · รวมกับยอดที่บันทึกไว้ ${N(hg)} เป็น ${N(hg + x.amount)} บาท${hg + x.amount >= l!.amt - 0.005 ? ' ครบตามแผน' : ''}`, alts: [{ label: 'ใบนี้แทนยอดที่บันทึกไว้', choice: { count: 'replace' } }] }
        : same
          ? { tone: 'info', tag: 'ใบเสร็จของเงินก้อนนี้', text: `ขั้น ${pc} บันทึกรับเงินเองไว้ ${N(hg)} บาท${when} · ใบนี้คือใบเสร็จของเงินก้อนนั้น ไม่นับซ้ำ`, alts: [] }
          : { tone: 'info', tag: 'นับแทน', text: `${W}นี้นับแทนยอดที่บันทึกเองไว้ ${N(hg)} บาท${when} ไม่นับซ้ำ`, alts: [addOther()] },
    };
  }
  return { def: g.pick === 'add' ? 'add' : g.pick, allowed: g.modes.length ? g.modes : ['add'], handHere, notice: null };
}

// ------------------------------------------------------------------ "รับเงินแล้ว (ไม่มีไฟล์)": one tap

/** What one tap records at an installment (null: not one tap — received already, or part paid by a
 *  document: the form "แก้ยอด / วันที่" is used instead). `amount` is what markPaid gets (null = as planned;
 *  a part received by hand before is topped up to the plan); `shown` the money that comes in now; `plan`:
 *  no plan yet (a one-installment plan of the Forecast is set first, in the same tap); `ask`: no plan and no
 *  Forecast, so the amount is typed first. */
export interface RecvPlan { stage: string; amount: number | null; shown: number | null; how: PayHow; plan: boolean; ask: boolean }
export function recvPlan(s: SalesState, d: Deal, stage: string, today: string): RecvPlan | null {
  const P = planOf(s, d, today);
  if (P) {
    const l = P.lines.find((x) => x.stage === stage);
    if (!l || l.status === 'paid' || l.status === 'off' || (l.docs.length && l.got > 0)) return null;
    const how: PayHow = l.line.how || 'transfer';
    if (!(l.amt > 0)) return { stage, amount: null, shown: null, how, plan: false, ask: true };
    return { stage, amount: l.handGot > 0 ? l.amt : null, shown: r2(l.amt - l.handGot), how, plan: false, ask: false };
  }
  const m = dealMoney(s, d), left = m.forecast != null ? r2(m.forecast - (m.actual || 0)) : null;
  return { stage, amount: null, shown: left != null && left > 0 ? left : null, how: 'transfer', plan: true, ask: !(left != null && left > 0) };
}
/** The engine calls one tap makes (lib/engine: markPaid, quickPlan, updatePayLine, unmarkPaid, clearPlan). */
export interface RecvEngine {
  sales: SalesState;
  markPaid(dealId: string, stage: string, r: { date: string; amount: number | null; how?: PayHow; full?: boolean }): boolean;
  quickPlan(dealId: string, n: number): { stages: string[]; amounts: (number | null)[] } | null;
  updatePayLine(dealId: string, stage: string, patch: { amt?: number | null }): void;
  unmarkPaid(dealId: string, stage: string): void;
  clearPlan(dealId: string): { kept: string[] };
}
/** Record the money at once (today, the planned amount; `typed` when it had to be asked). Returns where it
 *  went and how much, whether the job is now ready to close, and whether a plan was set for it (undone too). */
export function receiveNow(e: RecvEngine, dealId: string, stage: string, today: string, typed?: number | null): { stage: string; amount: number; ready: boolean; madePlan: boolean } | null {
  const d = e.sales.deals[dealId];
  if (!d) return null;
  const r = recvPlan(e.sales, d, stage, today);
  if (!r || (r.ask && !(typed != null && typed > 0))) return null;
  let at = stage, madePlan = false;
  if (r.plan) {
    const q = e.quickPlan(dealId, 1);
    if (!q || !q.stages.length) return null;
    at = q.stages[0];
    madePlan = true;
    if (r.ask) e.updatePayLine(dealId, at, { amt: typed! });
  } else if (r.ask) e.updatePayLine(dealId, at, { amt: typed! });
  const ready = e.markPaid(dealId, at, { date: today, amount: r.plan || r.ask ? null : r.amount, how: r.how, full: false });
  const l = planOf(e.sales, e.sales.deals[dealId], today)?.lines.find((x) => x.stage === at);
  return { stage: at, amount: r.ask ? typed! : r.shown ?? l?.got ?? 0, ready, madePlan };
}
/** "เลิกทำ": the money recorded by one tap goes, and the plan it set up with it. */
export function undoReceive(e: RecvEngine, dealId: string, r: { stage: string; madePlan: boolean }) {
  e.unmarkPaid(dealId, r.stage);
  if (r.madePlan) e.clearPlan(dealId);
}
/** The message after one tap (T-RECV). */
export const recvToast = (s: SalesState, d: Deal, stage: string, amount: number) => `บันทึกรับเงิน ${code(s, d, stage)} แล้ว ${N(amount)} บาท · วันนี้ · ยังไม่มีใบเสร็จ`;

/** A step's own attach (its row, its card): QUOTATION takes the quotation, an installment its receipt. */
export const stageEntry = (stage: string): AttachEntry => (stage === QUOTE_STAGE ? { at: 'quote' } : { at: 'pay', stage });

/** The parts of a line kept whole on a narrow screen: amounts with "บาท", Thai dates, document words and
 *  "งานนี้พร้อมปิดงาน" (a line breaks between them, never inside one). */
export const KEEP_WHOLE = /(งานนี้พร้อมปิดงาน|ใบแจ้งหนี้|ใบเสนอราคา|ใบเสร็จ|\d{1,2} (?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.) \d{4}|\d[\d,]*(?:\.\d+)? บาท|หัก ณ ที่จ่าย(?: \d+%)?)/;
