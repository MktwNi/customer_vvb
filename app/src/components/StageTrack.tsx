import { Fragment } from 'react';
import { DEAL_STAGE, type StageState } from '../lib/sales';

/** A stage's state in words: every circle says it in its track's label (colour is never the only sign). */
export const STATE_WORD: Record<StageState, string> = { done: 'ทำแล้ว', yes: 'ได้งาน', no: 'ไม่ได้งาน', wait: 'รอผล', planned: 'นัดไว้', skipped: 'ข้าม', off: 'ไม่ต้องทำ', future: 'ยังไม่ถึง', next: 'ถัดไป' };
const CLS: Record<StageState, string> = { done: 'd', yes: 'y', no: 'x', wait: 'w', planned: 'pl', skipped: 's', off: 'o', future: 'f', next: 'f' };

/**
 * One stage circle (design §5.4): done = brand fill, YES / NO / waiting = their mark, planned = a solid
 * ring, future = a grey ring; `now` = the next step (a dashed ring, red when it is late). CLOSED DEAL
 * is a diamond. No glyph inside: the words are in the track's label and the status column.
 */
export function Bead({ state, now, late, stage }: { state: StageState; now?: boolean; late?: boolean; stage?: string }) {
  const dm = stage === DEAL_STAGE && state !== 'off';
  return <span className={'sl-bd ' + CLS[state] + (dm ? ' dm' : '') + (now ? ' now' : '') + (now && late ? ' late' : '')} aria-hidden="true" />;
}

/** The furthest stage reached (done, planned or decided): the line is brand up to it. */
export function reachedOf(stages: string[], states: Record<string, StageState>) {
  let r = -1;
  stages.forEach((p, i) => ['done', 'planned', 'yes', 'no', 'wait'].includes(states[p]) && (r = i));
  return r;
}

/** "CALL1 ทำแล้ว · … · PAY2 ถัดไป": every circle's state in words. */
export const trackWords = (stages: string[], states: Record<string, StageState>, next: string) => stages.map((p) => `${p} ${p === next ? 'ถัดไป' : STATE_WORD[states[p]]}`).join(' · ');

/**
 * The circles on a line in a row or a card, then "7/8". An image with its words as the label: never
 * focusable (the stages are reached through the next-step button and the child rows).
 */
export function MiniTrack({ stages, states, next, done, late }: { stages: string[]; states: Record<string, StageState>; next: string; done: number; late?: boolean }) {
  const reached = reachedOf(stages, states);
  const words = trackWords(stages, states, next);
  return (
    <span className="sl-trk">
      <span className="sl-mt" style={{ '--n': stages.length }} role="img" aria-label={`ทำแล้ว ${done} จาก ${stages.length} ขั้น: ${words}`} title={words}>
        {stages.map((p, i) => (
          <Fragment key={p}>
            <Bead state={states[p]} now={p === next} late={late} stage={p} />
            {i < stages.length - 1 && <i className={'sl-sg' + (i < reached ? (states[stages[i + 1]] === 'planned' ? ' dash' : ' on') : '')} />}
          </Fragment>
        ))}
      </span>
      <span className="sl-trk-n" aria-hidden="true">{done}/{stages.length}</span>
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
