/**
 * The Sales Tracker's steps: what they are and which stored records each one reads. Pure, and it imports
 * nothing from sales.ts at run time (sales.ts builds every deal's steps on top of it: dealSteps).
 *
 * Five steps for everyone, in this order:
 *   CONTACT ติดต่อประสานงาน · QUOTATION ส่งใบเสนอราคา · FOLLOW ติดตามผล · CLOSE ผลการขาย (YES / NO) · PAY ชำระเงิน
 * CLOSE is stored as 'CLOSED DEAL' (the won date, the result and the team script's digests read that key). PAY
 * is one step per installment of the deal's payment plan (PAY1 … PAYn, "ชำระงวดที่ n"; a plan of one, or no plan:
 * a single "PAY"). Every call, e-mail or meeting beyond a step is a contact record (dact/) shown inside it.
 *
 * Nothing stored changes. The tracker had eight stages (CALL1, CALL2, QUOTATION, FOLLOW1, FOLLOW2, CLOSED DEAL,
 * PAY1, PAY2); their records are read into the new steps (CONTACT ← CONTACT / CALL2 / CALL1, FOLLOW ← FOLLOW /
 * FOLLOW2 / FOLLOW1: the newest date wins, every older note stays visible), new writes go to the new ids, and the
 * team's stored list (scfg/stages) is never rewritten: it is read through the same map, so a browser still on an
 * older build keeps its eight stages, and what it writes there (CALL2, FOLLOW1 …) shows in the new steps. A stage
 * an admin added to that list (an old tracker's import) stays a step of its own, after the step it followed.
 */

export const DEAL_STAGE = 'CLOSED DEAL';
/** The stage whose quotation is the Forecast. */
export const QUOTE_STAGE = 'QUOTATION';
export const CONTACT_STEP = 'CONTACT';
export const FOLLOW_STEP = 'FOLLOW';

export type StepKind = 'contact' | 'quote' | 'follow' | 'close' | 'pay' | 'custom';
/** A step: `id` is the record new writes go to (dstep/<deal>/<id>), `code` and `th` what the screens show,
 *  `aliases` the stored stages read into it (its own id first). */
export interface StepDef { id: string; code: string; th: string; kind: StepKind; aliases: string[] }

/** The steps before the payments, in order (PAY follows, expanded per deal). */
export const BASE_STEPS: readonly StepDef[] = [
  { id: CONTACT_STEP, code: 'CONTACT', th: 'ติดต่อประสานงาน', kind: 'contact', aliases: [CONTACT_STEP, 'CALL2', 'CALL1'] },
  { id: QUOTE_STAGE, code: 'QUOTATION', th: 'ส่งใบเสนอราคา', kind: 'quote', aliases: [QUOTE_STAGE] },
  { id: FOLLOW_STEP, code: 'FOLLOW', th: 'ติดตามผล', kind: 'follow', aliases: [FOLLOW_STEP, 'FOLLOW2', 'FOLLOW1'] },
  { id: DEAL_STAGE, code: 'CLOSE', th: 'ผลการขาย (YES / NO)', kind: 'close', aliases: [DEAL_STAGE] },
];
/** The payments' place among the steps (the team's steps, the Dashboard, the CSV): one slot, PAY. A deal has one
 *  PAY step per installment of its plan, keyed PAY1 … PAYn (dealSteps). */
export const PAY_SLOT: StepDef = { id: 'PAY', code: 'PAY', th: 'ชำระเงิน', kind: 'pay', aliases: [] };

/** The stages of the eight-stage tracker that a newer step reads now, and what they were called. */
export const OLD_STAGES = ['CALL1', 'CALL2', 'FOLLOW1', 'FOLLOW2'] as const;
export const OLD_TH: Record<string, string> = { CALL1: 'โทรครั้งที่ 1', CALL2: 'โทรครั้งที่ 2', FOLLOW1: 'ติดตามครั้งที่ 1', FOLLOW2: 'ติดตามครั้งที่ 2' };

const ALIAS: Record<string, string> = Object.fromEntries(BASE_STEPS.flatMap((b) => b.aliases.map((a) => [a, b.id])));
const BASE_IDS = new Set(BASE_STEPS.map((b) => b.id));

/** The step a stored stage reads into: CALL1 → CONTACT, FOLLOW2 → FOLLOW; any other stage is itself. */
export const stepIdOf = (stage: string) => ALIAS[stage] || stage;
/** One of the five steps' own ids (CONTACT, QUOTATION, FOLLOW, CLOSED DEAL; not a PAY key). */
export const isBaseStep = (stage: string) => BASE_IDS.has(stage);
/** A stage of the eight-stage tracker read into a newer step (CALL1, CALL2, FOLLOW1, FOLLOW2). */
export const isOldStage = (stage: string) => !!ALIAS[stage] && ALIAS[stage] !== stage;
/** An installment's key: PAY1, PAY2, … */
export const isPayKey = (stage: string) => /^PAY\d+$/i.test(stage);
/** The number in an installment's key (PAY3 → 3), 0 for any other name. */
export const payNo = (stage: string) => (isPayKey(stage) ? +stage.slice(3) : 0);
/** A stage the steps read whatever the team's list says (a step's alias, an installment's key): an import or a
 *  backup never adds it to the team's list (an older build would show it as one more stage). */
export const coveredStage = (stage: string) => !!ALIAS[stage] || isPayKey(stage);

/** The PAY-style names of the team's stored list (after CLOSED DEAL and named PAY…, as the eight-stage tracker
 *  read its payment stages): PAY1, PAY2 for the default list. */
export function listPays(cfg: { stages: string[] }): string[] {
  const i = cfg.stages.indexOf(DEAL_STAGE);
  return i < 0 ? [] : cfg.stages.slice(i + 1).filter((p) => /^PAY/i.test(p));
}
/** A stage that is an installment: an installment's key, or a PAY name of the team's list. */
export const isPayName = (cfg: { stages: string[] }, stage: string) => isPayKey(stage) || listPays(cfg).includes(stage);

/**
 * The team's steps (no deal): the five in their order, PAY as one slot, and each stage of the team's stored list
 * that no step covers (an admin's, from an old tracker's import) after the step it followed there; one after the
 * payments stays after them. The Dashboard's pipeline, the CSV's columns and every deal's steps read this.
 */
export function teamSteps(cfg: { stages: string[] }): StepDef[] {
  const pays = new Set(listPays(cfg)), after = new Map<string, StepDef[]>(), seen = new Set<string>();
  let anchor = '';
  for (const p of cfg.stages) {
    const id = stepIdOf(p);
    if (BASE_IDS.has(id)) anchor = id;
    else if (pays.has(p) || isPayKey(p)) anchor = PAY_SLOT.id;
    else if (p && !seen.has(p)) {
      seen.add(p);
      (after.get(anchor) || after.set(anchor, []).get(anchor)!).push({ id: p, code: p, th: '', kind: 'custom', aliases: [p] });
    }
  }
  const at = (id: string) => after.get(id) || [];
  return [...at(''), ...BASE_STEPS.flatMap((b) => [b, ...at(b.id)]), PAY_SLOT, ...at(PAY_SLOT.id)];
}
/** A stored stage the steps read, by the team's list: a step's alias, an installment, or a stage of the list. */
export const isStepKey = (cfg: { stages: string[] }, stage: string) => !!stage && (coveredStage(stage) || cfg.stages.includes(stage));
