import { describe, expect, it } from 'vitest';
import { TEMPLATES, dueWords, moneyTotals, projectView, sampleBills, sampleProjects, taskState, weekLoad, type Project } from './consult';
import { addDays } from './format';

const TODAY = '2026-11-20'; // a Friday; the sample is written as on this day
const P = sampleProjects(TODAY);
const byId = (id: string) => P.find((p) => p.id === id)!;

describe('the templates follow the consulting plan workbook', () => {
  it('CFO has 5 phases and 25 tasks, CF-Event 3 phases and 10 tasks', () => {
    expect(TEMPLATES.map((t) => [t.code, t.phases, t.tasks])).toEqual([['CFO', 5, 25], ['CF-Event', 3, 10]]);
  });
  it('every CFO project has the 25 tasks numbered 1.1 to 5.4, in order', () => {
    const wbs = byId('e').phases.flatMap((ph) => ph.tasks.map((t) => t.wbs));
    expect(wbs).toHaveLength(25);
    expect(wbs[0]).toBe('1.1');
    expect(wbs[24]).toBe('5.4');
    expect(byId('g').phases.flatMap((ph) => ph.tasks.map((t) => t.wbs))).toEqual(wbs);
  });
  it('the deliverables are the sheet, the report, the presentation, the statement and the certificate', () => {
    expect(byId('e').phases.flatMap((ph) => ph.tasks).filter((t) => t.deliver).map((t) => t.wbs)).toEqual(['2.4', '2.5', '2.6', '3.6', '5.4']);
  });
});

describe('a project on a day', () => {
  it('E: three tasks done, 1.4 under way and a day late; it is in phase 1', () => {
    const v = projectView(byId('e'), TODAY);
    expect(v.done).toBe(3);
    expect(v.total).toBe(25);
    expect(v.late.map((t) => t.wbs)).toEqual(['1.4']);
    expect(dueWords(v.late[0].end, TODAY)).toBe('เลยกำหนด 1 วัน');
    expect(v.next.map((t) => t.wbs)).toEqual(['1.4', '2.1', '2.2']);
    expect(v.phaseNow).toBe(1);
    expect(v.phases[0].state).toBe('now');
    expect(v.progress).toBeCloseTo(3.6 / 25);
  });
  it('G: phase 3, 3.2 two days late and 3.3 (the day after it) one; H: every task done, past its last phase', () => {
    const g = projectView(byId('g'), TODAY);
    expect(g.phaseNow).toBe(3);
    expect(g.late.map((t) => [t.wbs, dueWords(t.end, TODAY)])).toEqual([['3.2', 'เลยกำหนด 2 วัน'], ['3.3', 'เลยกำหนด 1 วัน']]);
    const h = projectView(byId('h'), TODAY);
    expect(h.done).toBe(25);
    expect(h.progress).toBe(1);
    expect(h.late).toEqual([]);
    expect(h.phaseNow).toBe(6);
  });
  it('a project on hold has no late task, though its dates have passed', () => {
    const j = byId('j');
    expect(j.phases[0].tasks[2].end < TODAY).toBe(true);
    expect(projectView(j, TODAY).late).toEqual([]);
    expect(taskState(j.phases[0].tasks[2], TODAY, true)).toBe('todo');
    expect(taskState(j.phases[0].tasks[2], TODAY)).toBe('late');
  });
  it('the event has not started: nothing done, it starts in December', () => {
    const v = projectView(byId('k'), TODAY);
    expect([v.done, v.total, v.progress, v.from]).toEqual([0, 10, 0, '2026-12-01']);
  });
});

describe('the sample keeps its shape on any day', () => {
  it('a month later, E is still one day late on 1.4 and G two days on 3.2', () => {
    const later = addDays(TODAY, 31);
    const Q = sampleProjects(later);
    const late = (p: Project) => projectView(p, later).late.map((t) => [t.wbs, dueWords(t.end, later)]);
    expect(late(Q.find((p) => p.id === 'e')!)).toEqual([['1.4', 'เลยกำหนด 1 วัน']]);
    expect(late(Q.find((p) => p.id === 'g')!)).toEqual([['3.2', 'เลยกำหนด 2 วัน'], ['3.3', 'เลยกำหนด 1 วัน']]);
  });
});

describe('the team this week and the money', () => {
  it("this week's open tasks of GCC's people in the projects under way (not the client's, the verifier's or TGO's)", () => {
    const load = weekLoad(P, TODAY);
    expect(load.length).toBeGreaterThan(0);
    expect(load.every((x) => !['ลูกค้า', 'ผู้ทวนสอบ', 'อบก.'].includes(x.name))).toBe(true);
    expect(load.find((x) => x.name === 'ทีม IT')?.n).toBe(1); // E's 1.4, 17 to 19 Nov
  });
  it('the totals: value, billed, received, still owed, not billed, expenses', () => {
    expect(moneyTotals(P)).toEqual({ budget: 450000, billed: 182500, paid: 118500, due: 64000, left: 267500, exp: 3100, billedShare: 182500 / 450000 });
  });
  it("G's expenses add up to its expense figure; the invoices are owed what the projects say", () => {
    const { invoices, expenses } = sampleBills(TODAY);
    expect(expenses.filter((x) => x.project === 'g').reduce((n, x) => n + x.amount, 0)).toBe(byId('g').money.exp);
    expect(invoices.reduce((n, v) => n + v.amount - v.paid, 0)).toBe(moneyTotals(P).due);
  });
});
