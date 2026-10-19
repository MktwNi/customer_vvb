/**
 * An open stage editor (the table row's, the phone card's, the deal panel's step card) when the stage
 * changes while it is open. A quotation action in or next to it rewrites the QUOTATION note that names
 * the document: a revision (the note moves to the new version), its figures corrected (the note follows
 * the new amount), a version deleted (the note goes back to the previous one, or is cleared). So does a
 * teammate's sync. Pure (no DOM), so the editors' behaviour is unit-tested (stepEditor.test.ts and, with
 * the engine, quotes.engine.test.ts).
 */
import type { DealStep } from './sales';

/** What an open editor holds: the stage as it opened (or as it last followed it), and the fields. */
export interface StepEd { init: DealStep; note: string; date: string }
/** What the fields show for a stage when nothing was typed (each editor has its own date rule). */
export type StepFields = (s: DealStep) => { note: string; date: string };

/** Saving asks first ("มีคนแก้ขั้นนี้ระหว่างที่เปิดอยู่") when the stage is no longer the one the editor holds. */
export const stepMoved = (init: DealStep, live: DealStep) => init.d !== live.d || init.n !== live.n;

/** The user changed the fields (against what they showed for the stage the editor holds). */
export function stepTyped(ed: StepEd, fields: StepFields) {
  const f = fields(ed.init);
  return ed.note !== f.note || ed.date !== f.date;
}

/**
 * The stage moved to `live` while the editor was open:
 * - 'same': it did not move;
 * - 'follow': nothing typed: the editor shows the stage as it is now, so saving neither asks about the
 *   change nor writes the old note back (the note stays the document's and follows its next edit);
 * - 'rebase': typed in, moved by the editor's own action (`own`: a quotation saved, swapped or deleted
 *   from it, a file attached from it): what was typed stays, and saving does not ask (nobody else did it);
 * - 'keep': typed in, moved by someone else: what was typed stays, and saving asks first.
 */
export function stepFollow(init: DealStep, live: DealStep, typed: boolean, own = false): 'same' | 'follow' | 'rebase' | 'keep' {
  if (!stepMoved(init, live)) return 'same';
  return !typed ? 'follow' : own ? 'rebase' : 'keep';
}

/** The editor after the stage moved to `live` (see stepFollow); the same object when nothing changes,
 *  so a React state update with it is a no-op. */
export function followStep(ed: StepEd, live: DealStep, fields: StepFields, own = false): StepEd {
  const r = stepFollow(ed.init, live, stepTyped(ed, fields), own);
  return r === 'follow' ? { init: live, ...fields(live) } : r === 'rebase' ? { ...ed, init: live } : ed;
}
