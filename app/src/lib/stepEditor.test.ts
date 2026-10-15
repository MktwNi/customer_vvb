import { describe, expect, it } from 'vitest';
import { followStep, stepFollow, stepMoved, stepTyped, type StepEd, type StepFields } from './stepEditor';

const TODAY = '2026-10-12';
// the phone card's and the table row's rule: the stage's note, its date (today when it has none, or a later one)
const fields: StepFields = (s) => ({ note: s.n, date: s.d && s.d <= TODAY ? s.d : TODAY });
const open = (d: string, n: string): StepEd => ({ init: { d, n }, ...fields({ d, n }) });
const V2 = { d: '2026-10-05', n: 'ใบเสนอราคา QT-A · 90,000 บาท' };
const EDITED = { d: '2026-10-05', n: 'ใบเสนอราคา QT-A · 88,000 บาท' };

describe('an open stage editor when the stage changes', () => {
  it('nothing typed: follows the stage, so saving neither asks nor writes the old note back', () => {
    const ed = open(V2.d, V2.n);
    expect(stepTyped(ed, fields)).toBe(false);
    // the quotation's amount corrected in the same editor: the QUOTATION note now names 88,000
    const next = followStep(ed, EDITED, fields);
    expect(next).toEqual({ init: EDITED, note: EDITED.n, date: EDITED.d });
    expect(stepMoved(next.init, EDITED)).toBe(false);
    // by a teammate too: nothing of the user's to keep
    expect(followStep(ed, EDITED, fields, false).note).toBe(EDITED.n);
  });

  it('a version deleted and no other left: the note and the date the document wrote go, the date field is today again', () => {
    const next = followStep(open(V2.d, V2.n), { d: '', n: '' }, fields, true);
    expect(next).toEqual({ init: { d: '', n: '' }, note: '', date: TODAY });
  });

  it('typed in, the editor\'s own action: what was typed stays and saving does not ask', () => {
    const ed = { ...open(V2.d, V2.n), note: 'ส่งอีเมลให้คุณสมชายแล้ว' };
    expect(stepFollow(ed.init, EDITED, true, true)).toBe('rebase');
    const next = followStep(ed, EDITED, fields, true);
    expect(next).toEqual({ init: EDITED, note: 'ส่งอีเมลให้คุณสมชายแล้ว', date: V2.d });
    expect(stepMoved(next.init, EDITED)).toBe(false);
    // a changed date is typed in as well
    const dated = { ...open(V2.d, V2.n), date: '2026-10-07' };
    expect(followStep(dated, EDITED, fields, true)).toEqual({ init: EDITED, note: V2.n, date: '2026-10-07' });
  });

  it('typed in, someone else changed it: what was typed stays and saving asks', () => {
    const ed = { ...open(V2.d, V2.n), note: 'ส่งอีเมลแล้ว' };
    expect(stepFollow(ed.init, EDITED, true)).toBe('keep');
    const next = followStep(ed, EDITED, fields);
    expect(next).toBe(ed);
    expect(stepMoved(next.init, EDITED)).toBe(true);
  });

  it('nothing changed: the same object (a React state update with it does nothing)', () => {
    const ed = open(V2.d, V2.n);
    expect(stepFollow(ed.init, { ...V2 }, false)).toBe('same');
    expect(followStep(ed, { ...V2 }, fields, true)).toBe(ed);
    // only the date moved (a planned date became the document's): followed as well
    expect(followStep(ed, { d: '2026-10-08', n: V2.n }, fields)).toEqual({ init: { d: '2026-10-08', n: V2.n }, note: V2.n, date: '2026-10-08' });
  });

  it('a draft brought back with the editor counts as typed', () => {
    const ed = { ...open(V2.d, V2.n), note: 'ร่างที่ค้างไว้' };
    expect(stepTyped(ed, fields)).toBe(true);
    expect(followStep(ed, EDITED, fields)).toBe(ed);
  });

  it('each editor keeps its own field rule: the panel\'s planned stage shows today, not the planned date', () => {
    const planned: StepFields = (s) => ({ note: s.n, date: TODAY });
    // an appointment that has passed: the panel's card opens on today, the row's editor on that day
    const ed: StepEd = { init: { d: '2026-10-08', n: 'นัดส่งใบเสนอราคา' }, note: 'นัดส่งใบเสนอราคา', date: TODAY };
    expect(stepTyped(ed, planned)).toBe(false);
    expect(stepTyped(ed, fields)).toBe(true);
    expect(followStep(ed, { d: '2026-10-09', n: 'ใบเสนอราคา QT-A · 90,000 บาท' }, planned)).toEqual({ init: { d: '2026-10-09', n: 'ใบเสนอราคา QT-A · 90,000 บาท' }, note: 'ใบเสนอราคา QT-A · 90,000 บาท', date: TODAY });
  });
});
