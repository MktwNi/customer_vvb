import { Fragment } from 'react';
import { DEAL_STAGE, type StageState, type StepView } from '../lib/sales';

/** A step's state in words: every circle says it in its track's label (colour is never the only sign). */
export const STATE_WORD: Record<StageState, string> = { done: 'ทำแล้ว', yes: 'ได้งาน', no: 'ไม่ได้งาน', wait: 'รอผล', planned: 'นัดไว้', skipped: 'ข้าม', off: 'ไม่ต้องทำ', future: 'ยังไม่ถึง', next: 'ถัดไป' };
const CLS: Record<StageState, string> = { done: 'd', yes: 'y', no: 'x', wait: 'w', planned: 'pl', skipped: 's', off: 'o', future: 'f', next: 'f' };

/**
 * One step circle (design §5.4): done = brand fill, YES / NO / waiting = their mark, planned = a solid
 * ring, future = a grey ring; `now` = the next step (a dashed ring, red when it is late). CLOSE (stored as
 * CLOSED DEAL) is a diamond. No glyph inside: the words are in the track's label and the status column.
 */
export function Bead({ state, now, late, stage }: { state: StageState; now?: boolean; late?: boolean; stage?: string }) {
  const dm = stage === DEAL_STAGE && state !== 'off';
  return <span className={'sl-bd ' + CLS[state] + (dm ? ' dm' : '') + (now ? ' now' : '') + (now && late ? ' late' : '')} aria-hidden="true" />;
}

const REACHED: StageState[] = ['done', 'planned', 'yes', 'no', 'wait'];
/** The furthest step reached (done, planned or decided) in `steps` as drawn: the line is brand up to it. */
export function reachedOf(steps: Pick<StepView, 'state'>[]) {
  let r = -1;
  steps.forEach((v, i) => REACHED.includes(v.state) && (r = i));
  return r;
}

/** The circle a step is drawn with: an installment outside the plan (kept for what it holds, not counted) is the
 *  quiet "not needed" one, whatever it holds ("นอกแผนชำระ" says why). */
export const beadOf = (v: Pick<StepView, 'state' | 'outside'>): StageState => (v.outside === 'plan' ? 'off' : v.state);

/** "CONTACT ทำแล้ว · QUOTATION ทำแล้ว · … · PAY ยังไม่ถึง": every circle's state in words (a step done with a call
 *  booked ahead, which is next: "ทำแล้ว มีนัด"). The rest of a payment without a plan is named in full, "PAY
 *  ส่วนที่เหลือ", as the row and the panel name it: the two PAY circles are told apart. */
export const trackWords = (steps: Pick<StepView, 'id' | 'code' | 'th' | 'state' | 'rest'>[], next: string) =>
  steps.map((v) => `${v.rest ? `${v.code} ${v.th}` : v.code} ${v.id === next ? (v.state === 'done' ? 'ทำแล้ว มีนัด' : 'ถัดไป') : STATE_WORD[v.state]}`).join(' · ');

/**
 * The counted steps' circles on a line in a row or a card, then "3/5" (dealSteps: an installment outside the
 * plan is not a circle). An image with its words as the label: never focusable (the steps are reached through
 * the next-step button and the child rows).
 */
export function MiniTrack({ steps: all, next, done, late }: { steps: StepView[]; next: string; done: number; late?: boolean }) {
  const steps = all.filter((v) => v.counted);
  const reached = reachedOf(steps);
  const words = trackWords(steps, next);
  return (
    <span className="sl-trk">
      <span className="sl-mt" style={{ '--n': steps.length }} role="img" aria-label={`ทำแล้ว ${done} จาก ${steps.length} ขั้น: ${words}`} title={words}>
        {steps.map((v, i) => (
          <Fragment key={v.id}>
            <Bead state={v.state} now={v.id === next} late={late} stage={v.id} />
            {i < steps.length - 1 && <i className={'sl-sg' + (i < reached ? (steps[i + 1].state === 'planned' ? ' dash' : ' on') : '')} />}
          </Fragment>
        ))}
      </span>
      <span className="sl-trk-n" aria-hidden="true">{done}/{steps.length}</span>
    </span>
  );
}

/** The row-expand chevron and the หมวด caret (design §6.1 #6): the only content icons besides ⋯ and search. */
export function Chevron({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
