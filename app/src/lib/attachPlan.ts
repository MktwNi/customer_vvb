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
import { isoTh, localDay, todayISO } from './format';
import { netOf, proposedAmount } from './docAmount';
import type { DocFacts } from './docExtract';
import { jointNo } from './joint';
import { attachRevision, qtDay, qtView } from './quotes';
import {
  QUOTE_STAGE, attachStage, closeReady, countAs, countGuard, countedAt, countedCopy, countsActual, dealMoney, dealResult, dealSteps, docEdited, docNoKey, docsOf, fmtMoney, isPayAt, jointHeadOf, jointOf, jointRole, owedNoPlan, payState, planOf, stageOk, stepCode, stepLabel, stepOf, targetWrong, whtRate, withDoc,
  type AttachInfo, type CountGuard, type CountMode, type Deal, type DealDoc, type DealStep, type DocKind, type DocTarget, type LineView, type PayHow, type PayLine, type PlanInput, type PlanView, type SalesState,
} from './sales';
import { shortName } from './salesUi';

/** Where an attach starts (the button pressed decides what the document is; nothing is asked). */
export type AttachEntry =
  /** the QUOTATION card, the Forecast figure, the quotation card's "แนบฉบับแก้ไข" (`revise`), the plan editor's
   *  typed total (`plan`: the confirmed figure goes into the total, `onSaved`), a joint quotation's head */
  | { at: 'quote'; revise?: string; plan?: boolean; onSaved?: (r: DocSaved) => void }
  /** a PAY card, a plan row, "รับเงินแล้ว"'s receipt (`stage`: the installment chosen); the Actual figure
   *  (no stage: the next installment not received). `loose`: the app picked the stage (a file dropped on the
   *  panel goes to the current step), not the user. `ofHand`: the receipt of the money just recorded by hand
   *  there (the form's "บันทึกแล้วแนบใบเสร็จ"): it counts in that money's place by default. */
  | { at: 'pay'; stage?: string; loose?: boolean; ofHand?: boolean; onSaved?: (r: DocSaved) => void }
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
  /** a receipt larger than its installment that also pays the next one(s): they become one installment */
  merge?: boolean;
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
  /** the customer named in the document is another company ("ชื่อไม่ตรง"): its own box after `notice`, so a
   *  notice's link stays right after the sentence it completes */
  party: AttachNotice | null;
  /** the "หลังบันทึก" line; `overTag` = "มากกว่าแผน" when Actual goes past the plan */
  after: string; overTag: string;
  /** how it counts next to money already counted ('nosave': the same file already counted: nothing stored) */
  count: CountMode | 'nosave' | null;
  save: AttachSave | null;
  noSave: boolean;
  /** count the installment complete after saving (setPayFull): the short part is withholding tax (R6) */
  full: boolean; fullStage: string;
  /** "รวม PAY2 เข้ากับ PAY1": the plan to save after the document (engine.setPlan), when the receipt pays the
   *  next installment(s) too and the person said so (the notice offers it) */
  merge: { into: string; stages: string[]; amt: number; lines: PlanInput[] } | null;
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

/** A step in words, as the deal's steps name it (lib/sales stepLabel, lib/steps): its code and Thai name — a
 *  single installment (a plan of one, or no plan) "PAY" · "ชำระเงิน", a plan's "PAY2" · "ชำระงวดที่ 2", the rest
 *  of a payment without a plan "PAY" · "ส่วนที่เหลือ", an older stage as the step it reads into (CALL2 → CONTACT).
 *  The one place a step is named here. */
export function stepName(s: SalesState, d: Deal, stage: string, today = todayISO()): { code: string; th: string } {
  const w = stepLabel(s, d, stage, today);
  return { code: w.code, th: w.th.replace(/\s*\(YES \/ NO\)$/, '') };
}
/** A step in a sentence: "PAY", "PAY2", "PAY ส่วนที่เหลือ", "QUOTATION" (lib/sales stepCode); '' for none. */
const code = (s: SalesState, d: Deal, stage: string, today = todayISO()) => (stage ? stepCode(s, d, stage, today) : '');

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
  // (the app picked that installment, not the user: a receipt of money recorded at another one is asked about)
  // (a PAY step: an installment of the plan; without one the single PAY, or the rest of the payment)
  if (step && (plan ? plan.lines.some((l) => l.stage === step) : isPayAt(s, d.id, step))) return { at: 'pay', stage: step, loose: true };
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
  // "นับเป็นเงินรับขั้น …": the step the pay screen then counts it at (the next one to receive; a document this
  // deal counts twice already is counted once where its payment starts, countGuard's home)
  const payLink = () => {
    const g = readAmt != null && money ? countGuard(s, d, { kind: fk === 'invoice' ? 'invoice' : 'receipt', amount: readAmt, target: 'actual', docDate, docNo, name: read.name.slice(0, 120), size: read.size }, today) : null;
    return `นับเป็นเงินรับขั้น ${code(s, d, g?.home || nextPay, today) || 'PAY'}`;
  };
  if (!jm && !choice.kind) {
    if (want === 'pay' && fk === 'quotation') {
      mode = 'other';
      notice = { tone: 'warn', tag: 'ไม่ใช่ใบเสร็จ', text: 'ไฟล์นี้อ่านได้ว่าเป็นใบเสนอราคา ไม่ใช่ใบเสร็จหรือใบแจ้งหนี้ · แนบไว้เป็นหลักฐานก่อน', alts: [{ label: 'ใช้เป็นใบเสนอราคา (Forecast)', choice: { kind: 'quote' } }] };
    } else if (want === 'quote' && money) {
      mode = 'other';
      notice = {
        tone: 'warn', tag: 'ไม่ใช่ใบเสนอราคา',
        text: `ไฟล์นี้อ่านได้ว่าเป็น${WORD[fk!]}${readAmt != null ? ' ' + N(readAmt) + ' บาท' : ''} · แนบไว้เป็นหลักฐาน${won ? 'ก่อน' : ''}`,
        alts: won ? [{ label: payLink(), choice: { kind: 'pay' } }] : [],
      };
    } else if (want === 'other' && (money || fk === 'quotation') && readAmt != null) {
      notice = fk === 'quotation'
        ? { tone: 'info', tag: 'เป็นใบเสนอราคา', text: `ไฟล์นี้เป็นใบเสนอราคา ${N(readAmt)} บาท · ถ้าเป็นใบเสนอราคาของงานนี้`, alts: [{ label: 'ใช้เป็นใบเสนอราคา (Forecast)', choice: { kind: 'quote' } }] }
        : {
            tone: 'info', tag: `เป็น${WORD[fk!]}`, text: `ไฟล์นี้เป็น${WORD[fk!]} ${N(readAmt)} บาท (${reasonOf(f!, prop0!.basis, false).split(' · ')[0]})${won ? ' · ถ้าเป็นเงินที่ได้รับของงานนี้' : ''}`,
            alts: won ? [{ label: payLink(), choice: { kind: 'pay' } }] : [],
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
  // the user chose the installment (its card, its row, a tile) — not the Actual figure or a panel drop
  const pinned = choice.stage !== undefined || (pickedStage !== undefined && !(entry.at === 'pay' && entry.loose));
  const ofHand = mode === 'pay' && entry.at === 'pay' && !!entry.ofHand && choice.kind === undefined && choice.stage === undefined;
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
  const pc = stage ? code(s, d, stage, today) : '';
  const sn = stage ? stepName(s, d, stage, today) : null;
  const where = sn ? `ขั้น ${sn.code}${sn.th ? ' ' + sn.th : ''}` : '';
  const line0: LineView | null = mode === 'pay' && stage ? plan0?.lines.find((l) => l.stage === stage) || null : null;
  let title = '', sub = company, subShort = shortName(company), amountLabel = '', after = '', overTag = '', primary = '', quiet = 'ยกเลิก', toast = '';
  let left: AttachPlan['left'] = null;
  let count: AttachPlan['count'] = null, save: AttachSave | null = null, noSave = false, full = false, fullStage = '', whtShort: AttachPlan['whtShort'] = null, merge: AttachPlan['merge'] = null;
  let links = { other: mode !== 'other', type: !jm && !rev, note: !!stage && stageOk(s, d, stage) };
  const noLabel = docNo ? ' ' + docNo : '';
  const base = (x: Partial<AttachSave>): AttachSave => ({ kind, amount, target: amount == null ? 'none' : 'actual', basis: amount == null ? 'manual' : basis, detected: amount == null ? null : detected, docNo, docDate, stage, kept: kept && amount != null, ...x });

  if (mode === 'quote') {
    title = rev ? `ใบเสนอราคาฉบับแก้ไข · ฉบับที่ ${k}` : `ใบเสนอราคา${stage ? ' · ขั้น ' + pc : ''}`;
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
      const done = stage && qd ? ` · ขั้น ${pc} ทำแล้ว ${isoTh(qd)}` : '';
      const typed = m0.forecast != null && (!m0.fcDoc || m0.fcOverride) ? m0.forecast : null;
      after = rev
        ? `ฉบับที่ ${rev.n}${qtDay(rev.doc) ? ' (' + isoTh(qtDay(rev.doc)) + ')' : ''} เก็บเป็น “ฉบับเดิม” เปิดดูได้ ไม่นับยอด${stepOf(s, d.id, stage).d ? ` · วันที่ขั้น ${pc} ยังเป็น ${isoTh(stepOf(s, d.id, stage).d)}` : ''}`
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
    const figs3 = f ? [f.total, f.netPay, f.subtotal] : [];
    const g: CountGuard | null = amount != null
      ? countGuard(s, d, { ...info0, pinned, docNo, name: read.name.slice(0, 120), size: read.size, figures: figs3, refs: f?.refs }, today)
      : null;
    const decided = g ? payCount(s, d, g, { kind, amount: amount!, stage, line0, docNo, name: read.name.slice(0, 120), size: read.size, figures: figs3, pinned, ofHand }, today) : null;
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
      // (a receipt at an installment its invoice counts at takes the invoice's place: payCount names it)
      const how = countAs(decided!.old ? { ...g, old: decided!.old } : g, cm, info0);
      // money recorded by hand at this installment kept with the document ("ส่วนที่เหลือ", or "นับเพิ่ม")
      if (cm === 'add' && decided!.handHere) how.addHand = true;
      save = base({ amount: how.amount, target: how.target, stage: cm === 'none' && decided!.at ? decided!.at : how.stage, replace: how.replace, drop: how.drop, addHand: how.addHand || undefined, ...(cm === 'rest' && how.amount !== amount ? { basis: 'manual', kept: true, detected: amount } : {}) });
      // 'rest': only what is left of the job counts — the label and the reason say that figure, not the document's
      if (cm === 'rest' && how.amount != null && !near(how.amount, amount)) {
        const o = g.over ?? g.overAdd;
        amountLabel = 'นับเข้า Actual เฉพาะส่วนที่เหลือ';
        reason = `ส่วนที่ยังไม่ได้รับ${o ? ` (${o.what} ${N(o.cap)} · รับแล้ว ${N(o.before)})` : ''} · ใบนี้${FIG_WORD[basis]} ${N(amount)} บาท`;
      }
    } else save = base({ target: 'none' }); // no amount: attached as evidence at the installment for now
    const counting = !!save && save.target === 'actual';
    const tStage = save?.stage ?? stage;
    // counted twice on a deal without a plan: it is counted once at the single PAY step, and the title says so
    if (g?.home && tStage === g.home && g.home !== stage) {
      const h = stepName(s, d, g.home, today);
      title = `${WORD[kind]} · ขั้น ${h.code}${h.th ? ' ' + h.th : ''}`;
    }
    // a receipt larger than its installment: when it pays the next one(s) too, one click makes them one
    // installment (the plan, saved after the document: engine.setPlan)
    const S1a = counting ? withDoc(s, d, { ...toInfo(save!), docNo, name: read.name.slice(0, 120), size: read.size }, today) : s;
    const P1a = counting && tStage ? planOf(S1a, d, today) : null;
    const big = P1a?.lines.find((l) => l.stage === tStage) || null;
    const cover = big && big.amt > 0 && big.got > big.amt + 0.005 ? coverOf(P1a!, big) : null;
    if (cover && choice.merge) merge = { into: tStage, stages: cover.stages, amt: cover.amt, lines: mergedLines(planOf(s, d, today)!, tStage, cover) };
    const S1 = merge ? withMerge(S1a, d.id, merge) : S1a;
    // R6: an installment short by exactly withholding tax is received in full
    let lineA = tStage ? planOf(S1, d, today)?.lines.find((l) => l.stage === tStage) || null : null;
    if (dup && (cm === 'none' || cm === 'nosave') && g!.same?.stage) {
      fullStage = g!.same.stage;
      lineA = planOf(s, d, today)?.lines.find((l) => l.stage === fullStage) || null;
    } else fullStage = tStage;
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
    const lc = lineA ? code(s, d, lineA.stage, today) : pc;
    const fullWords = full && whtShort ? `ขั้น ${lc} ถือว่ารับครบ เพราะส่วนที่ขาด ${N(whtShort.short)} คือหัก ณ ที่จ่าย ${whtShort.rate}%` : '';
    if (amount == null) after = '';
    else if (!counting) {
      after = [m0.actual != null ? `Actual ยังเป็น ${N(m0.actual)} บาท` : 'ไม่เปลี่ยน Actual', fullWords, ready1 && !ready0 ? 'งานนี้พร้อมปิดงาน' : ''].filter(Boolean).join(' · ');
      if (cm === 'none' && !dup && stage) after = `เก็บไว้ที่ขั้น ${code(s, d, save?.stage || stage, today)} เป็นหลักฐาน · ` + after;
    } else {
      const before = m0.acDocs || m0.hand ? m0.actual : null;
      const replaced = !!(save!.replace || save!.drop?.length || cm === 'move' || (decided?.handHere && !save!.addHand));
      const parts: string[] = [];
      if (replaced && before != null) parts.push(near(before, A) ? `Actual ยังเป็น ${N(A)} บาท` : `Actual จาก ${N(before)} เป็น ${N(A)} บาท`);
      const P1 = planOf(S2, d, today), cap = P1 && P1.total > 0 ? P1.total : mA.forecast;
      if (merge) parts.push(`รวม ${merge.stages.map((x) => code(s, d, x, today)).join(', ')} เข้ากับ ${code(s, d, merge.into, today)} เป็นงวดเดียว ${N(merge.amt)} บาท`);
      if (cap != null && cap > 0 && A != null && A > cap + 0.005 && (before == null || A > before + 0.005)) {
        overTag = `มากกว่า${P1 && P1.total > 0 ? 'แผน' : ' Forecast'}`;
        parts.length = 0;
        parts.push(`${overWords(A, cap, P1 && P1.total > 0 ? 'แผน' : ' Forecast')} · ตรวจว่าใช่เงินที่เข้าบัญชีจริง`);
      } else if (lineA) {
        const leftN = P1 ? P1.lines.filter((l) => l.status !== 'paid' && l.status !== 'off').length : 0;
        if (fullWords) parts.push(fullWords);
        else if (lineA.got >= lineA.amt - 0.005) {
          if (lineA.amt > 0 && lineA.got > lineA.amt + 0.005) {
            // more than this installment: the next one still shows as owed (it says so, in words and a tag)
            const nx = P1?.lines.find((l) => l.stage !== lineA!.stage && l.left > 0.005);
            if (!cover) overTag = 'มากกว่างวดนี้';
            parts.push(`ขั้น ${lc} รับ ${N(lineA.got)} บาท แผนงวดนี้ ${N(lineA.amt)} บาท`);
            if (nx) parts.push(`${code(s, d, nx.stage, today)} ยังค้าง ${N(nx.left)} บาท`);
          } else if (ready1 && !leftN) parts.push(replaced ? 'รับครบตามแผน' : `รับครบตามแผน ${N(P1!.total)} บาท · Actual ${N(A)}${mA.forecast != null ? ' จาก Forecast ' + N(mA.forecast) : ''}`);
          else if (leftN) parts.push(`ขั้น ${lc} ครบตามแผน ${N(lineA.amt)} บาท · เหลืออีก ${leftN} งวด ${N(P1!.left)} บาท`);
          else parts.push(`ขั้น ${lc} ครบตามแผน ${N(lineA.amt)} บาท`);
        } else parts.push(`ขั้น ${lc} ยังค้าง ${N(lineA.amt - lineA.got)} บาท`);
        if (ready1) parts.push('งานนี้พร้อมปิดงาน');
      } else {
        if (!replaced) parts.push(`Actual เป็น ${N(A)} บาท${mA.forecast != null && A != null && A >= mA.forecast - 0.005 ? ' · ครบตาม Forecast' : ''}`);
        // no plan: what the Forecast still lacks once saved, as the panel, the row and ค้างรับ say it (owedNoPlan)
        const o = !P1 ? owedNoPlan(S2, d, today) : null;
        if (o?.wht) parts.push(`ขั้น ${code(s, d, tStage, today) || 'PAY'} ถือว่ารับครบ เพราะส่วนที่ขาด ${N(o.wht.short)} คือหัก ณ ที่จ่าย ${o.wht.rate}%`);
        else if (o?.under) parts.push(`ต่ำกว่า Forecast ${N(o.under)} บาท`);
        else if (o && o.owed > 0.005) parts.push(`ยังค้างรับ ${N(o.owed)} บาท`);
        if (ready1) parts.push('งานนี้พร้อมปิดงาน');
      }
      // installments received now and not after saving (a copy at another one stops counting) — against the
      // state saving leaves, the installment counted complete by withholding tax included
      // (only one still owed then: a step saving takes away — the rest of a payment without a plan, once the money
      // counted makes up the Forecast — is not one to receive)
      const ps1 = payState(S2, d, today), unpaid = payState(s, d, today).paid.filter((p) => !ps1.paid.includes(p) && ps1.left.includes(p));
      if (unpaid.length) parts.push(`${unpaid.map((p) => code(s, d, p, today)).join(', ')} จะกลับเป็นยังไม่ได้รับ`);
      after = parts.join(' · ');
    }
    // the offer to make the next installment(s) part of this one (or to keep them apart, once chosen)
    if (cover && big) {
      const sts = cover.stages.map((x) => code(s, d, x, today)).join(', '), at0 = code(s, d, big.stage, today);
      const alt: AttachNotice['alts'][number] = merge
        ? { label: 'ไม่รวมงวด', choice: { merge: false } }
        : { pre: `ถ้าใบนี้รวมเงิน ${sts} ด้วย`, label: 'รวมเป็นงวดเดียว', choice: { merge: true } };
      const text = merge ? `รวม ${sts} เข้ากับ ${at0} เป็นงวดเดียว ${N(cover.amt)} บาท` : `ขั้น ${at0} จะรับ ${N(big.got)} บาท เกินแผนงวดนี้อยู่ ${N(big.got - big.amt)} บาท (แผน ${N(big.amt)} บาท)`;
      if (notice) {
        notice = { ...notice, text: `${notice.text} · ${text}`, alts: [...notice.alts, alt] };
        if (!merge) overTag = 'มากกว่างวดนี้';
      } else notice = merge ? { tone: 'info', tag: 'รวมงวด', text, alts: [alt] } : { tone: 'warn', tag: 'มากกว่างวดนี้', text, alts: [alt] };
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
    else if (cm === 'move') primary = `บันทึกรับเงินที่ ${code(s, d, save!.stage || '', today)} ${N(shown)} บาท`;
    else primary = kind === 'invoice' ? `บันทึกใบแจ้งหนี้ ${N(shown)} บาท` : `บันทึกรับเงิน ${N(shown)} บาท`;
    const at = save?.stage ? code(s, d, save.stage, today) : pc;
    toast = dup && (cm === 'none' || cm === 'nosave')
      ? `ไม่นับซ้ำ · Actual ยังเป็น ${N(m0.actual)} บาท${full ? ` · ${lc} ถือว่ารับครบ` : ''}`
      : cm === 'none' || amount == null
        ? `แนบ${WORD[kind]}${noLabel} ไว้เป็นหลักฐานแล้ว · ไม่นับยอด`
        : `${kind === 'invoice' ? 'บันทึกใบแจ้งหนี้' : 'บันทึกรับเงิน'} ${N(shown)} บาท${at ? ' ที่ขั้น ' + at : ''} แล้ว${merge ? ` · รวม ${merge.stages.map((x) => code(s, d, x, today)).join(', ')} เข้ากับ ${code(s, d, merge.into, today)}` : ''}`;
  } else {
    title = 'เอกสารอื่น · ไม่นับยอด';
    save = base({ target: 'none', stage: '', amount: readAmt != null && fk && fk !== 'other' ? readAmt : null, basis: prop0?.basis ?? 'manual', detected: readAmt, kept: false });
    after = 'เก็บในการ์ด “เอกสารอื่น” · ไม่เปลี่ยน Forecast หรือ Actual';
    primary = 'แนบเป็นหลักฐาน';
    toast = `แนบ${WORD[kind]}${noLabel} ไว้ในเอกสารอื่นแล้ว · ไม่นับยอด`;
    links = { other: false, type: !jm, note: false };
  }

  // ---- R9: the customer named in the document (a joint quotation's member may name its payer): a box of its
  // own after the notice (never spliced into another notice's sentence, between it and its link)
  const payer = jm ? s.deals[jointHeadOf(s, d.id)]?.client : undefined;
  const party: AttachNotice | null = f?.party && !sameParty(f.party, company) && !(payer && sameParty(f.party, payer))
    ? { tone: 'warn', tag: 'ชื่อไม่ตรง', text: `ชื่อลูกค้าในเอกสาร "${f.party}" ไม่ตรงกับ "${company}" · ตรวจว่าแนบถูกงาน`, alts: [] }
    : null;

  // ---- "เปลี่ยนประเภท": a tile per installment still to be received (one when there is one or no plan)
  const tiles: TypeTile[] = [];
  if (links.type) {
    tiles.push({ key: 'quote', label: 'ใบเสนอราคา', sub: 'เป็น Forecast', choice: { kind: 'quote' }, on: mode === 'quote' });
    const open = (plan0?.lines || []).filter((l) => l.status !== 'paid' && l.status !== 'off');
    if (open.length > 1) open.forEach((l) => tiles.push({ key: 'pay:' + l.stage, label: 'ใบเสร็จ / ใบแจ้งหนี้', sub: `เงินรับขั้น ${code(s, d, l.stage, today)}`, choice: { kind: 'pay', stage: l.stage }, on: mode === 'pay' && stage === l.stage }));
    else tiles.push({ key: 'pay', label: 'ใบเสร็จ / ใบแจ้งหนี้', sub: `เงินรับขั้น ${code(s, d, mode === 'pay' && stage ? stage : nextPay, today) || 'PAY'}`, choice: { kind: 'pay' }, on: mode === 'pay' });
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
    notice, party, after, overTag, count, save: noSave ? null : save, noSave, full, fullStage, whtShort, merge,
    primary, primaryOff: mode !== 'other' && amount == null && !choice.later, quiet, left, links, tiles, toast,
    key: JSON.stringify([notice?.tag, notice?.text, amount, primary, count, save?.stage, save?.target, save?.replace, full, merge?.stages, after]),
  };
}

const toInfo = (x: AttachSave): AttachInfo => ({ kind: x.kind, amount: x.amount, target: x.target, docDate: x.docDate, stage: x.stage, replace: x.replace, drop: x.drop, addHand: x.addHand });
/** The document's figure in a word ("ใบนี้ยอดชำระ 60,000 บาท"). */
const FIG_WORD: Record<DealDoc['basis'], string> = { netPay: 'ยอดชำระ', total: 'ยอดรวม', subtotal: 'ยอดก่อน VAT', manual: 'ยอด' };
/** Actual past what is expected, said one way everywhere: "Actual จะเป็น 90,000 บาท เกินแผนอยู่ 30,000 บาท
 *  (แผน 60,000 บาท)" — the excess and the plan (or Forecast) each named, never one number for both. */
export function overWords(after: number, cap: number, what: string) {
  const w = what.trim(), sp = /^[A-Za-z]/.test(w) ? ` ${w} ` : w;
  return `Actual จะเป็น ${N(after)} บาท เกิน${sp}อยู่ ${N(after - cap)} บาท (${w} ${N(cap)} บาท)`;
}
const WILL: Record<DocTarget, string> = { forecast: 'นับเป็น Forecast', actual: 'รวมใน Actual', none: 'ไม่นับยอด' };
/**
 * What saving a document card's form ("แก้ยอด / ประเภท") does to the job's money, said under the form before
 * saving: when what it counts toward or its type changes, or it counts toward what its type never is (an
 * older build's choice). What it counts as, then the Forecast (another figure, from another document, or
 * none left) and the Actual after it (past the Forecast said as overWords); null when nothing changes.
 * `warn`: the Forecast moves, Actual goes past it, or the document was counted wrongly.
 */
export function docFormNote(s: SalesState, d: Deal, doc: DealDoc, f: { kind: DocKind; target: DocTarget; amount: number | null }): { text: string; warn: boolean } | null {
  const wrong = !!targetWrong(doc), t: DocTarget = f.amount == null ? 'none' : f.target;
  if (!wrong && f.kind === doc.kind && t === doc.target) return null;
  const sa = docEdited(s, d, doc, { kind: f.kind, target: t, amount: f.amount });
  const b = dealMoney(s, d), a = dealMoney(sa, d);
  const same = (x: number | null | undefined, y: number | null | undefined) => (x == null ? y == null : near(x, y));
  const parts: string[] = [];
  if (t !== doc.target) {
    const copy = t === 'none' ? countedCopy(s, d, doc) : null;
    parts.push(`เดิม${WILL[doc.target]}`, `บันทึกแล้วจะ${WILL[t]}${copy ? ` (ใบนี้รวมใน Actual แล้ว${copy.stage ? ' ที่ขั้น ' + code(s, d, copy.stage) : ''})` : ''}`);
  } else if (wrong) parts.push(`ยัง${WILL[t]}${/[A-Za-z]$/.test(WILL[t]) ? ' ' : ''}ตามเดิม`);
  const fcMoved = !same(a.forecast, b.forecast) || a.fcDoc?.id !== b.fcDoc?.id;
  if (fcMoved)
    parts.push(
      a.forecast == null ? `จะไม่มี Forecast${b.forecast != null ? ` (เดิม ${N(b.forecast)} บาท)` : ''}`
      : `Forecast จะเป็น ${N(a.forecast)} บาท${a.fcDoc ? ` จาก${WORD[a.fcDoc.kind]} ${a.fcDoc.docNo || a.fcDoc.name}` : ' ที่พิมพ์ไว้'}${b.forecast != null && !near(a.forecast, b.forecast) ? ` แทน ${N(b.forecast)} บาท` : ''}`,
    );
  const fc = a.forecast, over = a.actual != null && fc != null && fc > 0 && a.actual > fc * 1.05 && a.actual > (b.actual ?? 0) + 0.005;
  if (over) parts.push(overWords(a.actual!, fc!, 'Forecast'));
  else if (!same(a.actual, b.actual))
    parts.push(a.actual == null ? `จะไม่มี Actual (เดิม ${N(b.actual)} บาท)` : b.actual == null ? `Actual จะเป็น ${N(a.actual)} บาท` : `Actual จาก ${N(b.actual)} เป็น ${N(a.actual)} บาท`);
  else if (a.actual != null && (t === 'actual' || doc.target === 'actual' || wrong)) parts.push(`Actual ยังเป็น ${N(a.actual)} บาท`);
  // an installment received that saving leaves part-paid (its plan line set while a receipt counted twice):
  // said, with where to set the plan right, so "ค้างรับ" after saving is no surprise
  const today = todayISO(), lb = doc.stage ? planOf(s, d, today)?.lines.find((l) => l.stage === doc.stage) : undefined;
  const la = lb && planOf(sa, d, today)?.lines.find((l) => l.stage === doc.stage);
  const owes = !!lb && !!la && lb.status === 'paid' && la.status !== 'paid' && la.left > 0.005;
  if (owes) parts.push(`${code(s, d, doc.stage!)} จะค้างรับ ${N(la!.left)} บาท (แผน ${N(la!.amt)} บาท) · ถ้ายอดแผนผิด แก้ที่ “แก้ไขแผน”`);
  return parts.length ? { text: parts.join(' · '), warn: wrong || fcMoved || over || owes } : null;
}
/** The installments right after `at`, nothing received there yet, that its money pays too: what came in at
 *  `at` makes up its plan and theirs (within 1%, or short of it by withholding tax). */
function coverOf(P: PlanView, at: LineView): { stages: string[]; amt: number } | null {
  const i = P.lines.findIndex((l) => l.stage === at.stage), stages: string[] = [];
  let sum = at.amt;
  for (const l of P.lines.slice(i + 1)) {
    if (sum >= at.got - 0.005) break;
    if (l.status === 'paid' || l.status === 'off' || l.got > 0 || !(l.amt > 0)) break;
    sum = r2(sum + l.amt);
    stages.push(l.stage);
  }
  if (!stages.length) return null;
  return Math.abs(sum - at.got) <= Math.max(1, sum * 0.01) || whtRate(sum, at.got) != null ? { stages, amt: sum } : null;
}
/** The plan with `cover` made part of `into` (its amount the sum, the share typed as % dropped). */
function mergedLines(P: PlanView, into: string, cover: { stages: string[]; amt: number }): PlanInput[] {
  return P.lines
    .filter((l) => !cover.stages.includes(l.stage))
    .map(({ stage, line: x }) => ({ stage, amt: stage === into ? cover.amt : x.amt, pct: stage === into ? null : x.pct, due: x.due, rel: x.rel, how: x.how, howT: x.howT, note: x.note }));
}
/** The tracker as the merge leaves it (the "หลังบันทึก" line reads from it). */
function withMerge(S: SalesState, id: string, m: NonNullable<AttachPlan['merge']>): SalesState {
  const pays = { ...S.pays }, k = `${id}/${m.into}`;
  pays[k] = { ...pays[k], amt: m.amt, pct: null };
  m.stages.forEach((st) => delete pays[`${id}/${st}`]);
  return { ...S, pays };
}

/**
 * How a receipt / invoice counts next to the money already counted (R3–R5), as one default, the other
 * ways a notice's link may take (`allowed`), and the notice for each. Builds on countGuard: the same
 * document (number or file) counted anywhere, another document or a hand receipt at this installment,
 * the receipt of money counted at another installment, a job already paid.
 */
function payCount(
  s: SalesState, d: Deal, g: CountGuard,
  x: { kind: DocKind; amount: number; stage: string; line0: LineView | null; docNo: string; name: string; size: number; figures: (number | null)[]; pinned: boolean; ofHand: boolean },
  today: string,
): {
  def: CountMode | 'nosave'; allowed: (CountMode | 'nosave')[]; notice: ((cm: CountMode | 'nosave') => AttachNotice | null) | null; handHere: boolean;
  /** the document it replaces, when not countGuard's own pick (the invoice a receipt pays) */
  old?: DealDoc;
  /** where it is kept when it does not count ('none'), when not where it was attached (with its receipt) */
  at?: string;
} {
  const pc = code(s, d, g.stage, today), W = WORD[x.kind], l = x.line0;
  const docName = (z: DealDoc) => `${WORD[z.kind]} ${z.docNo || z.name}`;
  const handHere = !!l && l.hand && !l.docs.length && l.handGot > 0;
  // R5b: what came in at this installment plus this one is the plan (or short of it by withholding tax)
  const fits = (got: number) => !!l && l.status === 'part' && l.amt > 0 && (got + x.amount <= l.amt * 1.01 + 0.005 || whtRate(l.amt, got + x.amount) != null);
  const addOther = (pre = 'เป็นเงินอีกก้อน?'): AttachNotice['alts'][number] => ({ pre, label: 'นับเพิ่ม', choice: { count: 'add' } });

  // R4: the same document (its number, or the same file) is counted already
  if (g.sames.length) {
    const same = g.same!, here = same.stage === g.stage, twice = g.sames.length > 1;
    const identical = g.sames.some((z) => z.size === x.size && z.name === x.name);
    const at = (z: DealDoc) => `ขั้น ${code(s, d, z.stage, today) || 'ไม่ระบุ'}`;
    // attached again at "PAY ส่วนที่เหลือ" (no plan: what the money counted leaves of the Forecast): the receipt is
    // counted at PAY already, and that step is done by a note when the rest is not coming (lib/sales dealSteps)
    const restHere = !here && !planOf(s, d, today) && dealSteps(s, d, today).steps.some((v) => v.rest && v.id === g.stage);
    // money recorded by hand kept on top of the documents here ("นับเพิ่ม", PayLine.add): counted once is
    // the document, that money still adds to it — said, as "ไม่นับซ้ำ" alone reads as if Actual were this one
    const onTop = l && l.hand && l.docs.length > 0 && l.handGot > 0 ? ` · เงินที่บันทึกเองไว้ ${N(l.handGot)} บาท${l.line.rcv ? ` (${isoTh(l.line.rcv)})` : ''} ยังนับเพิ่มอยู่` : '';
    if (twice)
      return {
        def: 'replace', allowed: ['replace', 'none'], handHere,
        notice: () => ({ tone: 'warn', tag: 'ใบซ้ำ', text: `${docName(same)} นับซ้ำอยู่ ${g.sames.length} ครั้ง (${g.sames.map((z) => `${at(z)} ${N(z.amount)}`).join(' · ')} บาท) · บันทึกครั้งนี้นับครั้งเดียวที่ขั้น ${g.home ? code(s, d, g.home, today) : pc} ไม่นับซ้ำ${onTop}`, alts: [] }),
      };
    if (here && !near(same.amount, x.amount))
      return {
        def: 'replace', allowed: ['replace', 'none'], handHere,
        notice: (cm) => ({
          tone: 'warn', tag: 'ใบซ้ำ',
          text: cm === 'none' ? `${docName(same)} นับไว้แล้วที่${at(same)} ${N(same.amount)} บาท · ระบบจะไม่นับซ้ำ` : `${docName(same)} นับไว้แล้วที่${at(same)} ${N(same.amount)} บาท · บันทึกครั้งนี้นับแทนเป็น ${N(x.amount)} บาท ไม่นับซ้ำ${onTop}`,
          alts: cm === 'none' ? [{ label: `นับแทนเป็น ${N(x.amount)} บาท`, choice: { count: 'replace' } }] : [{ label: 'คงยอดเดิม', choice: { count: 'none' } }],
        }),
      };
    const def = identical ? 'nosave' : 'none';
    return {
      def, allowed: here && !identical ? ['none', 'replace'] : [def], handHere,
      notice: (cm) => ({
        tone: 'warn', tag: 'ใบซ้ำ',
        text: cm === 'replace'
          ? `${docName(same)} นับไว้แล้วที่${at(same)} ${N(same.amount)} บาท · ใช้ไฟล์นี้แทนใบเดิม ยอดเท่าเดิม ไม่นับซ้ำ${onTop}`
          : `${docName(same)} นับไปแล้วที่${at(same)} ${N(same.amount)} บาท (แนบ ${isoTh(localDay(same.at))}) · ระบบจะไม่นับซ้ำ${restHere ? ` · ถ้าตกลงลดยอดแล้ว พิมพ์โน้ตที่ขั้น ${pc} แล้วปิดงานได้` : ''}`,
        alts: [
          { label: 'ดูใบเดิม', view: same.id },
          ...(here && !identical ? [cm === 'replace' ? { label: 'เก็บไฟล์นี้เป็นหลักฐาน', choice: { count: 'none' as const } } : { label: 'ใช้ไฟล์นี้แทนใบเดิม', choice: { count: 'replace' as const } }] : []),
        ],
      }),
    };
  }
  // R3: an invoice after a receipt counted at the installment is evidence — so is an invoice carrying the
  // number of a receipt counted anywhere in the deal (one vendor number for both: that receipt's money)
  if (x.kind === 'invoice') {
    const no = docNoKey(x.docNo);
    const rcpt = (g.stage ? countedAt(s, d, g.stage).find((z) => z.kind === 'receipt') : undefined)
      ?? (no.length >= 3 ? docsOf(s, d.id).find((z) => countsActual(z) && z.kind === 'receipt' && docNoKey(z.docNo) === no) : undefined);
    if (rcpt) {
      const rc = code(s, d, rcpt.stage, today) || pc;
      return {
        def: 'none', allowed: ['none'], handHere, at: rcpt.stage || undefined,
        notice: () => ({ tone: 'info', tag: 'เก็บเป็นหลักฐาน', text: `ขั้น ${rc} มีใบเสร็จ ${rcpt.docNo || rcpt.name} นับแล้ว · ใบแจ้งหนี้นี้เก็บไว้เป็นหลักฐาน ไม่นับยอด`, alts: [] }),
      };
    }
  }
  // R5e: a job already paid: counting it on top would go well past the plan / Forecast (countGuard decides)
  if (g.over) {
    const o = g.overAdd ?? g.over, what = o.what === 'แผน' ? 'แผน' : ' Forecast';
    const how = (cm: CountMode | 'nosave') =>
      cm === 'replace' && g.old ? `นับแทน${docName(g.old)} ที่นับไว้ ${N(g.old.amount)} บาท`
      : cm === 'replace' ? 'นับแทนใบเดิม'
      : cm === 'move' ? `แนบที่ขั้น ${code(s, d, (g.inv || g.hand)!.stage, today)} แทน ไม่นับซ้ำ`
      : cm === 'rest' ? `นับเฉพาะส่วนที่ยังไม่ได้รับ ${N(g.rest)} บาท`
      : 'เก็บไว้เป็นหลักฐาน ไม่นับยอด';
    return {
      def: g.pick, allowed: g.modes, handHere,
      notice: (cm) => cm === 'add'
        ? { tone: 'warn', tag: 'นับเพิ่ม', text: `นับเพิ่มแล้ว ${overWords(o.after, o.cap, what)}`, alts: [{ label: how(g.pick), choice: { count: g.pick } }] }
        : { tone: 'warn', tag: 'ไม่นับเพิ่ม', text: `นับเพิ่มแล้ว ${overWords(o.after, o.cap, what)} · จึง${how(cm)}`, alts: [addOther('')] },
    };
  }
  // the receipt of an invoice counted at another installment (offered, not chosen, at an installment the
  // user picked that already counts money: the rules below come first then)
  if (g.inv && (g.pick === 'move' || (!g.old && !handHere))) {
    const inv = g.inv, xc = code(s, d, inv.stage, today);
    return {
      def: g.pick, allowed: ['move', 'add'], handHere,
      notice: (cm) => cm === 'move'
        ? { tone: 'info', tag: `ย้ายไป ${xc}`, text: `ใบเสร็จนี้คือเงินของใบแจ้งหนี้ ${inv.docNo || inv.name} ที่นับไว้ที่ขั้น ${xc} ${N(inv.amount)} บาท · แนบที่ ${xc} แทนใบแจ้งหนี้ ไม่นับซ้ำ`, alts: [{ label: `นับเพิ่มที่ ${pc} แทน`, choice: { count: 'add' } }] }
        : { tone: 'info', tag: `นับที่ ${pc}`, text: `ขั้น ${xc} นับใบแจ้งหนี้ ${inv.docNo || inv.name} ไว้ ${N(inv.amount)} บาท · ใบนี้นับเป็นเงินของขั้น ${pc}`, alts: [{ pre: 'ถ้าเป็นใบเสร็จของใบแจ้งหนี้นั้น', label: `ย้ายไป ${xc}`, choice: { count: 'move' } }] },
    };
  }
  // money recorded by hand at another installment, of an amount this document shows (R5d)
  if (g.hand) {
    const h = g.hand, xc = code(s, d, h.stage, today), when = h.line.rcv ? ` (${isoTh(h.line.rcv)})` : '';
    return {
      def: g.pick, allowed: ['move', 'add'], handHere,
      notice: (cm) => cm === 'move'
        ? { tone: 'info', tag: `ย้ายไป ${xc}`, text: `เงินก้อนนี้บันทึกไว้ที่ขั้น ${xc} แล้ว${when} · แนบใบเสร็จนี้ที่ ${xc} แทน ไม่นับซ้ำ`, alts: [{ label: `นับเพิ่มที่ ${pc} แทน`, choice: { count: 'add' } }] }
        : { tone: 'info', tag: `นับที่ ${pc}`, text: `ขั้น ${xc} บันทึกรับเงินเองไว้ ${N(h.handGot)} บาท${when} · ใบนี้นับเป็นเงินของขั้น ${pc}`, alts: [{ pre: 'ถ้าเป็นใบเสร็จของเงินก้อนนั้น', label: `ย้ายไป ${xc}`, choice: { count: 'move' } }] },
    };
  }
  // R5a/b: another document counted at this installment
  if (g.old) {
    // R3: a receipt where an invoice counts is that invoice's money: it counts in the invoice's place (the
    // newest invoice there), whatever the amounts — "นับเพิ่ม" when it is really more money
    const inv = x.kind === 'receipt' ? countedAt(s, d, g.stage).filter((z) => z.kind === 'invoice' && !g.sames.includes(z)).pop() : undefined;
    const old = inv ?? g.old, ow = WORD[old.kind] + (old.kind === x.kind ? 'เดิม' : '');
    const add = !inv && fits(l?.got ?? 0);
    const sum = r2((l?.got ?? 0) + x.amount);
    return {
      def: add ? 'add' : 'replace', allowed: ['replace', 'add'], handHere, ...(inv ? { old: inv } : {}),
      notice: (cm) => cm === 'add'
        ? { tone: 'info', tag: 'ส่วนที่เหลือ', text: `ใบนี้คือเงินส่วนที่เหลือของขั้น ${pc} · รวมกับใบเดิม ${old.docNo || old.name} ${N(l?.got ?? old.amount)} เป็น ${N(sum)} บาท${l && sum >= l.amt - 0.005 ? ' ครบตามแผน' : ''}`, alts: [{ label: 'ใบนี้แทนใบเดิม', choice: { count: 'replace' } }] }
        : { tone: 'info', tag: 'นับแทน', text: `${W}นี้นับแทน${WORD[old.kind]} ${old.docNo || old.name} ที่นับไว้ ${N(old.amount)} บาท · ${ow}เก็บไว้เป็นหลักฐาน ไม่นับซ้ำ`, alts: [addOther()] },
    };
  }
  // R5c: money recorded by hand at this installment, no document yet. Its own amount (or one of the
  // document's figures equal to it), or the receipt asked for right after recording it (`ofHand`), is that
  // money's receipt: in its place. Only another amount that makes up the plan with it is "the rest".
  if (handHere) {
    const hg = l!.handGot, when = l!.line.rcv ? ` (${isoTh(l!.line.rcv)})` : '';
    const same = near(x.amount, hg) || x.figures.some((v) => near(v, hg));
    const add = !same && !x.ofHand && fits(hg);
    return {
      def: add ? 'add' : 'replace', allowed: ['replace', 'add'], handHere,
      notice: (cm) => cm === 'add'
        ? same || x.ofHand
          ? { tone: 'warn', tag: 'นับเพิ่ม', text: `ขั้น ${pc} บันทึกรับเงินเองไว้ ${N(hg)} บาท${when} · นับใบนี้เพิ่มเป็น ${N(hg + x.amount)} บาท`, alts: [{ pre: 'ถ้าเป็นใบเสร็จของเงินก้อนนั้น', label: 'ไม่นับซ้ำ', choice: { count: 'replace' } }] }
          : { tone: 'info', tag: 'ส่วนที่เหลือ', text: `ใบนี้คือเงินส่วนที่เหลือของขั้น ${pc} · รวมกับยอดที่บันทึกไว้ ${N(hg)} เป็น ${N(hg + x.amount)} บาท${hg + x.amount >= l!.amt - 0.005 ? ' ครบตามแผน' : ''}`, alts: [{ label: 'ใบนี้แทนยอดที่บันทึกไว้', choice: { count: 'replace' } }] }
        : same
          ? { tone: 'info', tag: 'ใบเสร็จของเงินก้อนนี้', text: `ขั้น ${pc} บันทึกรับเงินเองไว้ ${N(hg)} บาท${when} · ใบนี้คือใบเสร็จของเงินก้อนนั้น ไม่นับซ้ำ`, alts: [addOther()] }
          : { tone: 'info', tag: 'นับแทน', text: `${W}นี้นับแทนยอดที่บันทึกเองไว้ ${N(hg)} บาท${when} ไม่นับซ้ำ`, alts: [addOther()] },
    };
  }
  return { def: g.pick === 'add' ? 'add' : g.pick, allowed: g.modes.length ? g.modes : ['add'], handHere, notice: null };
}

// ------------------------------------------------------------------ "รับเงินแล้ว (ไม่มีไฟล์)": one tap

/** What one tap records at an installment (null: not one tap — received already, or part paid, by a
 *  document or by hand: the form "แก้ยอด / วันที่" is used instead, as one installment holds one hand
 *  receipt with its own date). `amount` is what markPaid gets (null = as planned); `shown` the money that
 *  comes in now; `plan`: no plan yet (a one-installment plan of the Forecast is set first, in the same tap);
 *  `ask`: no amount to record (no plan and no Forecast, or a line with no planned amount), so it is typed
 *  first; `over`: the job's money already makes up its plan and this would take it well past it (a receipt
 *  counted whole at an earlier installment, say) — not recorded, the form is offered instead. */
export interface RecvPlan {
  stage: string; amount: number | null; shown: number | null; how: PayHow; plan: boolean; ask: boolean;
  /** `what` it is measured against: the plan's total, or (no plan) the Forecast */
  over: { actual: number; cap: number; extra: { stage: string; by: number } | null; what: 'แผน' | 'Forecast' } | null;
}
export function recvPlan(s: SalesState, d: Deal, stage: string, today: string): RecvPlan | null {
  const P = planOf(s, d, today);
  if (P) {
    const l = P.lines.find((x) => x.stage === stage);
    if (!l || l.status === 'paid' || l.status === 'off' || (l.docs.length && l.got > 0) || l.handGot > 0) return null;
    const how: PayHow = l.line.how || 'transfer';
    if (!(l.amt > 0)) return { stage, amount: null, shown: null, how, plan: false, ask: true, over: null };
    // (as countGuard.over for documents: a job paid to 90% of its plan, taken past 105% by this)
    const m = dealMoney(s, d), A = m.acDocs || m.hand ? m.actual ?? 0 : 0, cap = P.total, fc = m.forecast;
    const x = P.lines.find((z) => z.amt > 0 && z.got > z.amt + 0.005);
    const over: RecvPlan['over'] =
      cap > 0 && A >= cap * 0.9 && A + l.amt > cap * 1.05 ? { actual: A, cap, extra: x ? { stage: x.stage, by: r2(x.got - x.amt) } : null, what: 'แผน' }
      // one installment more than the whole job's Forecast, even with VAT added to it (a line set while a
      // receipt was counted twice: 121,730.77 of a 60,000 job): one tap would record that as money in — the
      // form is offered, the message says why. A plan past the Forecast by its VAT or extra work, a line at a
      // time, still takes one tap.
      : fc != null && fc > 0 && l.amt > fc * 1.07 * 1.05 ? { actual: A, cap: fc, extra: null, what: 'Forecast' }
      : null;
    return { stage, amount: null, shown: l.amt, how, plan: false, ask: false, over };
  }
  const m = dealMoney(s, d), left = m.forecast != null ? r2(m.forecast - (m.actual || 0)) : null;
  // the money counted already makes up the Forecast (a receipt filed at another PAY step, say): one tap would
  // count it again — as with a plan, nothing is recorded and the message says why (a typed Actual is replaced
  // by the tap, never added to: it does not count here)
  const A = m.acDocs || m.hand ? m.actual ?? 0 : 0;
  const over = m.forecast != null && m.forecast > 0 && A >= m.forecast - 0.005 ? { actual: A, cap: m.forecast, extra: null, what: 'Forecast' as const } : null;
  return { stage, amount: null, shown: left != null && left > 0 ? left : null, how: 'transfer', plan: true, ask: !(left != null && left > 0), over };
}
/** The engine calls one tap makes (lib/engine: markPaid, quickPlan, updatePayLine; undoPays for "เลิกทำ"). */
export interface RecvEngine {
  sales: SalesState;
  markPaid(dealId: string, stage: string, r: { date: string; amount: number | null; how?: PayHow; full?: boolean; add?: boolean }): boolean;
  quickPlan(dealId: string, n: number): { stages: string[]; amounts: (number | null)[] } | null;
  setPlan(dealId: string, lines: PlanInput[]): unknown;
  updatePayLine(dealId: string, stage: string, patch: { amt?: number | null }): void;
  undoPays(dealId: string, u: Pick<RecvUndo, 'before' | 'after' | 'step'>): { stale: string[] };
}
/** What "เลิกทำ" puts back: the deal's installments just before the tap and as it left them (the plan it set
 *  up, the amount it asked for, the line it marked), and the stage note it may have filled in. */
export interface RecvUndo {
  deal: string; stage: string; madePlan: boolean;
  /** the step as it was named at the tap ("PAY ส่วนที่เหลือ"; '' = as `stage` is named now) */
  code?: string;
  before: Record<string, PayLine>; after: Record<string, PayLine>;
  step: { stage: string; before: DealStep; after: DealStep };
}
const paysOf = (s: SalesState, id: string): Record<string, PayLine> =>
  Object.fromEntries(Object.entries(s.pays || {}).filter(([k]) => k.startsWith(id + '/')).map(([k, v]) => [k.slice(id.length + 1), { ...v }]));
/** Record the money at once (today, the planned amount; `typed` when it had to be asked). Returns where it
 *  went and how much, the step as the person saw it (`code`: "PAY ส่วนที่เหลือ"), whether the job is now ready
 *  to close, whether a plan was set for it, and what "เลิกทำ" puts back. Nothing when it is not one tap
 *  (recvPlan null, `over`, or an amount still to type).
 *  Without a plan, the money needs one (a hand receipt is an installment's): the single PAY step becomes a plan
 *  of one installment — still "PAY". At "PAY ส่วนที่เหลือ" that one installment is the whole Forecast at the
 *  single PAY step: the documents counted there stay, the money now is kept on top of them (PayLine.add), and
 *  the steps keep the names the person saw (never "งวดที่ 1 / 2" of a plan of two). */
export function receiveNow(e: RecvEngine, dealId: string, stage: string, today: string, typed?: number | null): { stage: string; code: string; amount: number; ready: boolean; madePlan: boolean; undo: RecvUndo } | null {
  const d = e.sales.deals[dealId];
  if (!d) return null;
  const r = recvPlan(e.sales, d, stage, today);
  if (!r || r.over || (r.ask && !(typed != null && typed > 0))) return null;
  const said = code(e.sales, d, stage, today), ready0 = closeReady(e.sales, d, today);
  const before = paysOf(e.sales, dealId);
  let at = stage, madePlan = false, hand: number | null = r.plan || r.ask ? null : r.amount, add = false;
  const rest = r.plan ? restOf(e.sales, d, stage, today) : null;
  if (rest) {
    e.setPlan(dealId, [{ stage: rest.at, amt: rest.total, pct: null, due: '', rel: 30, how: 'transfer', howT: '', note: '' }]);
    if (!planOf(e.sales, e.sales.deals[dealId], today)) return null;
    ((at = rest.at), (madePlan = true), (hand = rest.hand), (add = rest.add));
  } else if (r.plan) {
    const q = e.quickPlan(dealId, 1);
    if (!q || !q.stages.length) return null;
    at = q.stages[0];
    madePlan = true;
    if (r.ask) e.updatePayLine(dealId, at, { amt: typed! });
  } else if (r.ask) e.updatePayLine(dealId, at, { amt: typed! });
  const step0 = stepOf(e.sales, dealId, at);
  e.markPaid(dealId, at, { date: today, amount: hand, how: r.how, full: false, ...(add ? { add: true } : {}) });
  // (ready by the tap as a whole: a plan it set may already count money in — a PAY paid the old way)
  const ready = !ready0 && closeReady(e.sales, e.sales.deals[dealId], today);
  const l = planOf(e.sales, e.sales.deals[dealId], today)?.lines.find((x) => x.stage === at);
  const undo: RecvUndo = { deal: dealId, stage: at, code: said, madePlan, before, after: paysOf(e.sales, dealId), step: { stage: at, before: { ...step0 }, after: { ...stepOf(e.sales, dealId, at) } } };
  return { stage: at, code: said, amount: r.ask ? typed! : r.shown ?? l?.got ?? 0, ready, madePlan, undo };
}
/** "PAY ส่วนที่เหลือ" of a won deal without a plan (lib/sales dealSteps `rest`), as one tap records it: the single
 *  PAY step (`at`) gets the whole Forecast (`total`); `hand` = what the documents counted do not cover (the
 *  rest, or the whole Forecast when the money was only typed); `add` = documents count at `at` (kept with them). */
function restOf(s: SalesState, d: Deal, stage: string, today: string): { at: string; total: number; hand: number; add: boolean } | null {
  if (planOf(s, d, today)) return null;
  const ps = dealSteps(s, d, today).steps.filter((v) => v.kind === 'pay' && v.counted);
  const first = ps[0], m = dealMoney(s, d);
  if (!first || ps.length !== 2 || !ps[1].rest || ps[1].id !== stage || m.forecast == null || !(m.forecast > 0)) return null;
  const docs = m.acDocs ? m.actual ?? 0 : 0, hand = r2(m.forecast - docs);
  if (!(hand > 0)) return null;
  return { at: first.id, total: m.forecast, hand, add: countedAt(s, d, first.id).length > 0 };
}
/** "เลิกทำ": the deal's installments as they were before the tap (the plan it set up goes, a received line
 *  that plan carried in too; the planned amount it asked for goes back). Refused, changing nothing, when a
 *  line was changed since (a teammate's correction synced in): `stale` names it. */
export function undoReceive(e: RecvEngine, u: RecvUndo): { stale: string[] } {
  return e.undoPays(u.deal, u);
}
/** The message after one tap (T-RECV); `said`: the step as it was named at the tap (receiveNow `code`). */
export const recvToast = (s: SalesState, d: Deal, stage: string, amount: number, said = '') => `บันทึกรับเงิน ${said || code(s, d, stage)} แล้ว ${N(amount)} บาท · วันนี้ · ยังไม่มีใบเสร็จ`;
/** The message when one tap records nothing (RecvPlan.over): the job's money is in already. */
export function recvOverText(s: SalesState, d: Deal, r: RecvPlan): string {
  const o = r.over;
  if (!o) return '';
  // an installment of a plan more than the whole job's Forecast: its planned amount is what is doubtful
  if (!r.plan && o.what === 'Forecast')
    return `ยังไม่ได้บันทึก ${code(s, d, r.stage)} · แผนงวดนี้ ${N(r.shown)} บาท มากกว่า Forecast ทั้งงาน ${N(o.cap)} บาท · ถ้ายอดแผนผิด กด “แก้ไขแผน” ถ้ารับเงินเท่านี้จริง กด “แก้ยอด / วันที่”`;
  const what = o.what === 'Forecast' ? ' Forecast ' : 'แผน ';
  const head = o.actual >= o.cap - 0.005
    ? `Actual ${N(o.actual)} บาท ครบตาม${what}${N(o.cap)} บาทแล้ว`
    : `Actual ${N(o.actual)} บาท บันทึกอีก ${N(r.shown)} บาทจะเกิน${what}${N(o.cap)} บาท`;
  const x = o.extra ? ` (${code(s, d, o.extra.stage)} รับเกินงวด ${N(o.extra.by)} บาท)` : '';
  // (no plan: no installment form to correct — a receipt is what tells more money came in)
  return `ยังไม่ได้บันทึก ${code(s, d, r.stage)} · ${head}${x} · ถ้าได้รับเงินเพิ่มจริง ${o.what === 'Forecast' ? 'แนบใบเสร็จที่ขั้นนี้' : 'กด “แก้ยอด / วันที่”'}`;
}
/** The message after "เลิกทำ" of one tap: done, or refused because a line was changed since. */
export function recvUndoText(s: SalesState, d: Deal, u: RecvUndo, r: { stale: string[] }): string {
  if (r.stale.length) return `เลิกทำไม่ได้ · ${r.stale.map((x) => code(s, d, x)).join(', ')} มีการแก้ไขหลังบันทึก · แก้ที่ “แผนการชำระเงิน” ของงานนี้`;
  return `เลิกทำแล้ว · ${u.code || code(s, d, u.stage)} กลับเป็นยังไม่ได้รับ${u.madePlan ? ' · แผนชำระที่ตั้งให้ถูกลบด้วย' : ''}`;
}

/** A step's own attach (its row, its card): QUOTATION takes the quotation, an installment its receipt. */
export const stageEntry = (stage: string): AttachEntry => (stage === QUOTE_STAGE ? { at: 'quote' } : { at: 'pay', stage });

/** The parts of a line kept whole on a narrow screen: amounts with "บาท", Thai dates, document words and
 *  "งานนี้พร้อมปิดงาน" (a line breaks between them, never inside one). */
export const KEEP_WHOLE = /(งานนี้พร้อมปิดงาน|ใบแจ้งหนี้|ใบเสนอราคา|ใบเสร็จ|\d{1,2} (?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.) \d{4}|\d[\d,]*(?:\.\d+)? บาท|หัก ณ ที่จ่าย(?: \d+%)?)/;
