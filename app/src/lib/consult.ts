/**
 * งานที่ปรึกษา, the consulting module (owner, Nov 2569: "ทำออกมาเป็น Module เพื่อแยกกันเข้าใช้งาน", designs 3A 3B 3C on
 * the design canvas; "เริ่มได้เลย" for the UAT copy). Phase 1: sample projects only, made here and kept nowhere, so the
 * team can try the screens before the team script stores real ones. Each project's plan (แผนโครงการ) follows its
 * template, the steps of the consulting plan workbook of 2026; no client, person or amount comes from that workbook.
 *
 * Every sample date is written as it was on ANCHOR and moved by the days since, so the sample keeps its shape on any
 * day: one task a day late, the next ones coming, one project finished.
 */
import { addDays, daysBetween } from './format';
import { weekStart } from './dateRange';

/** Who does a task: GCC's team, the client, the verifier, or TGO (อบก.). The plan can be shown for one side only. */
export type OwnerGroup = 'gcc' | 'client' | 'ext' | 'tgo';
export interface Owner { name: string; group: OwnerGroup }
export const OWNERS: Record<string, Owner> = {
  exec: { name: 'ผู้บริหาร', group: 'gcc' },
  ca: { name: 'ที่ปรึกษา A', group: 'gcc' },
  cb: { name: 'ที่ปรึกษา B', group: 'gcc' },
  cc: { name: 'ที่ปรึกษา C', group: 'gcc' },
  cd: { name: 'ที่ปรึกษา D', group: 'gcc' },
  it: { name: 'ทีม IT', group: 'gcc' },
  org: { name: 'ลูกค้า', group: 'client' },
  ver: { name: 'ผู้ทวนสอบ', group: 'ext' },
  tgo: { name: 'อบก.', group: 'tgo' },
};
export const ownerOf = (k: string): Owner => OWNERS[k] || { name: k, group: 'gcc' };

export type TemplateId = 'cfo' | 'event';
export interface Template { id: TemplateId; code: string; title: string; phases: number; tasks: number; flow: string }

export interface Task { wbs: string; name: string; owner: string; start: string; end: string; /** 0 to 1 */ pr: number; /** a deliverable to the client or to TGO */ deliver: boolean }
export interface Phase { no: number; name: string; short: string; tasks: Task[] }
export type ProjStatus = 'going' | 'open' | 'hold' | 'done';
export interface Money { budget: number; billed: number; paid: number; exp: number }
export interface Project {
  id: string; name: string; client: string; owner: string; status: ProjStatus; tpl: TemplateId;
  priority: string; level: string; holdNote?: string; phases: Phase[]; money: Money;
}
export interface Invoice { no: string; project: string; date: string; amount: number; paid: number; terms: string }
export interface Expense { item: string; project: string; date: string; amount: number }

export const STATUS_TH: Record<ProjStatus, string> = { going: 'กำลังทำ', open: 'ยังไม่เริ่ม', hold: 'พักไว้', done: 'เสร็จ' };

// ---- the templates' steps (consulting plan workbook 2026), as planned for the sample project E on ANCHOR

const ANCHOR = '2026-11-20';
type Row = [wbs: string, name: string, owner: string, start: string, end: string];
const DELIVER = /\((Verification Sheet|GHG Report|GHG Presentation|Verification Statement)\)|E-certificate|ใบประกาศเกียรติคุณ/;

const CFO: { no: number; name: string; short: string; rows: Row[] }[] = [
  { no: 1, name: 'กำหนดขอบข่าย ขอบเขต เตรียมการ ชี้แจง และสำรวจข้อมูล', short: 'เตรียมการและสำรวจข้อมูล', rows: [
    ['1.1', 'อบรมความรู้เกี่ยวกับการจัดการก๊าซเรือนกระจก', 'exec', '2026-11-11', '2026-11-11'],
    ['1.2', 'สำรวจแหล่งก่อเกิด (GHG Source)', 'exec', '2026-10-30', '2026-10-30'],
    ['1.3', 'สรุปข้อมูลกิจกรรมก่อเกิดก๊าซเรือนกระจก (Activity Data)', 'ca', '2026-11-16', '2026-11-16'],
    ['1.4', 'กำหนดขอบข่ายองค์กร ขอบเขตรายงานผ่านแพลทฟอร์ม GCT', 'it', '2026-11-17', '2026-11-19'],
  ] },
  { no: 2, name: 'การบันทึกผล คำนวณหาค่าก๊าซเรือนกระจก และทำรายงาน', short: 'บันทึกผล คำนวณ ทำรายงาน', rows: [
    ['2.1', 'อบรมการบันทึกข้อมูล ผ่านโปรแกรม Global Carbon Tech', 'exec', '2026-11-26', '2026-11-26'],
    ['2.2', 'บันทึกข้อมูลกิจกรรมก่อเกิดก๊าซเรือนกระจก (ม.ค. ถึง ธ.ค. 69)', 'org', '2026-11-27', '2027-04-05'],
    ['2.3', 'ตรวจสอบการบันทึกข้อมูลครั้งสุดท้าย', 'cb', '2027-04-07', '2027-04-09'],
    ['2.4', 'จัดทำบัญชีก๊าซเรือนกระจก (Verification Sheet)', 'cb', '2027-04-19', '2027-04-20'],
    ['2.5', 'จัดทำรายงานการปล่อยก๊าซเรือนกระจก (GHG Report)', 'cb', '2027-04-21', '2027-04-22'],
    ['2.6', 'ไฟล์นำเสนอข้อมูลการปล่อย (GHG Presentation)', 'cb', '2027-04-23', '2027-04-23'],
    ['2.7', 'ส่งชุดเอกสารและข้อมูลให้ผู้ทวนสอบ (Document Review)', 'cb', '2027-04-23', '2027-04-23'],
    ['2.8', 'ให้คำแนะนำ และซ้อมเพื่อรับการทวนสอบ (Verification Prepare)', 'cc', '2027-04-29', '2027-04-29'],
  ] },
  { no: 3, name: 'กระบวนการทวนสอบ', short: 'รับการทวนสอบ', rows: [
    ['3.1', 'รับการทวนสอบจาก VVB', 'ver', '2027-04-30', '2027-04-30'],
    ['3.2', 'แก้ไขประเด็นความไม่สอดคล้อง MM MS NC', 'cb', '2027-05-03', '2027-05-04'],
    ['3.3', 'ปิดประเด็นความไม่สอดคล้อง MM MS NC', 'ver', '2027-05-05', '2027-05-05'],
    ['3.4', 'จัดทำร่างรายงานการทวนสอบ (Verification Statement Draft)', 'ver', '2027-05-06', '2027-05-07'],
    ['3.5', 'ส่งรายงานไปยังผู้ทวนสอบอิสระ (Independent Review)', 'ver', '2027-05-10', '2027-05-18'],
    ['3.6', 'ออกรายงานและถ้อยแถลงการทวนสอบ (Verification Statement)', 'ver', '2027-05-19', '2027-05-19'],
  ] },
  { no: 4, name: 'กระบวนการด้านเอกสาร และการลงทะเบียน', short: 'เอกสารและลงทะเบียน', rows: [
    ['4.1', 'ยื่นเอกสารไปยัง อบก. เพื่อขอการพิจารณารับรอง', 'ver', '2027-05-24', '2027-05-24'],
    ['4.2', 'ติดตามยืนยันความเรียบร้อยของเอกสาร', 'cb', '2027-05-25', '2027-05-25'],
    ['4.3', 'ชำระค่าธรรมเนียม ลงทะเบียนรับรอง CFO', 'cb', '2027-05-26', '2027-05-26'],
  ] },
  { no: 5, name: 'กระบวนการพิจารณาของ อบก.', short: 'อบก. พิจารณารับรอง', rows: [
    ['5.1', 'ประชุมคณะอนุกรรมการพิจารณารับรอง', 'tgo', '2027-06-09', '2027-06-09'],
    ['5.2', 'ประชุมคณะกรรมการพิจารณารับรอง', 'tgo', '2027-06-23', '2027-06-23'],
    ['5.3', 'ประกาศผลอย่างเป็นทางการ', 'tgo', '2027-06-23', '2027-06-23'],
    ['5.4', 'ดาวน์โหลด E-certificate', 'cb', '2027-07-14', '2027-07-14'],
  ] },
];

const EVENT: typeof CFO = [
  { no: 1, name: 'กระบวนการก่อนเริ่มงานอีเวนท์', short: 'ก่อนจัดงาน', rows: [
    ['1.1', 'ประมาณการก่อเกิดก๊าซเรือนกระจก ก่อนเริ่มงาน', 'cd', '2026-12-01', '2026-12-01'],
    ['1.2', 'ยื่นขออนุมัติใช้ฉลากคาร์บอนนิวทรัล (Self Declaration) ก่อนเริ่มงาน', 'cd', '2026-12-02', '2026-12-03'],
    ['1.3', 'จัดทำระบบเอกสารฐานข้อมูลเพื่อเก็บข้อมูลกิจกรรมปล่อยก๊าซเรือนกระจก', 'cd', '2026-12-04', '2026-12-07'],
  ] },
  { no: 2, name: 'กระบวนการขณะจัดงานอีเวนท์', short: 'ขณะจัดงาน', rows: [
    ['2.1', 'เก็บบันทึกข้อมูลกิจกรรมการปล่อยก๊าซเรือนกระจกจากงาน', 'org', '2026-12-14', '2026-12-14'],
  ] },
  { no: 3, name: 'กระบวนการหลังจัดงานอีเวนท์', short: 'หลังจัดงาน', rows: [
    ['3.1', 'คำนวณการก่อเกิดก๊าซเรือนกระจกที่เกิดขึ้นจริงจากงาน', 'cd', '2026-12-15', '2026-12-15'],
    ['3.2', 'ส่งข้อมูลไปยัง อบก. เพื่อตรวจรับรอง', 'cd', '2026-12-16', '2026-12-17'],
    ['3.3', 'จัดซื้อจัดหาคาร์บอนเครดิตตามงบประมาณเพื่อชดเชยการปล่อยก๊าซเรือนกระจก', 'cd', '2026-12-18', '2026-12-18'],
    ['3.4', 'ยื่นชดเชยในระบบของ อบก.', 'cd', '2026-12-21', '2026-12-21'],
    ['3.5', 'ยื่นขอการรับรองและขึ้นทะเบียนผู้ร่วมโครงการ', 'cd', '2026-12-22', '2026-12-22'],
    ['3.6', 'ดาวน์โหลดโลโก้คาร์บอนนิวทรัล และใบประกาศเกียรติคุณของงานอีเวนท์', 'cd', '2026-12-23', '2026-12-23'],
  ] },
];

export const TEMPLATES: Template[] = [
  { id: 'cfo', code: 'CFO', title: 'CFO รับรองคาร์บอนฟุตพริ้นท์องค์กร', phases: CFO.length, tasks: CFO.reduce((n, p) => n + p.rows.length, 0), flow: CFO.map((p) => p.short).join(' · ') },
  { id: 'event', code: 'CF-Event', title: 'CF-Event งานอีเวนท์คาร์บอนนิวทรัล', phases: EVENT.length, tasks: EVENT.reduce((n, p) => n + p.rows.length, 0), flow: EVENT.map((p) => p.short).join(' · ') },
];
export const templateOf = (id: TemplateId) => TEMPLATES.find((t) => t.id === id)!;

/**
 * A plan from a template: its dates moved by `shift` days, the first `done` tasks finished, the next one `part` done
 * (0 to 1). The workbook's owners stay, except the project's own consultant (`cons`) in place of ที่ปรึกษา B.
 */
function plan(src: typeof CFO, shift: number, done: number, part = 0, cons = 'cb'): Phase[] {
  let i = 0;
  return src.map((ph) => ({
    no: ph.no, name: ph.name, short: ph.short,
    tasks: ph.rows.map(([wbs, name, owner, start, end]) => {
      const k = i++;
      return { wbs, name, owner: owner === 'cb' ? cons : owner, start: addDays(start, shift), end: addDays(end, shift), pr: k < done ? 1 : k === done ? part : 0, deliver: DELIVER.test(name) };
    }),
  }));
}

/** The sample projects (anonymous names; 3A's six), their plans as on `today`. */
export function sampleProjects(today: string): Project[] {
  const d = daysBetween(ANCHOR, today);
  const at = (iso: string) => daysBetween(ANCHOR, iso) + d; // a shift that puts that sample day on the same day before today
  return [
    { id: 'e', name: 'บริษัท ตัวอย่าง E · CFO', client: 'บริษัท ตัวอย่าง E จำกัด', owner: 'cb', status: 'going', tpl: 'cfo', priority: 'ปานกลาง', level: 'ระดับ 1', phases: plan(CFO, d, 3, 0.6), money: { budget: 95000, billed: 47500, paid: 0, exp: 0 } },
    { id: 'f', name: 'บริษัท ตัวอย่าง F · CFO', client: 'บริษัท ตัวอย่าง F จำกัด', owner: 'cc', status: 'going', tpl: 'cfo', priority: 'ปานกลาง', level: 'ระดับ 1', phases: plan(CFO, at('2026-09-25'), 5, 0.1, 'cc'), money: { budget: 60000, billed: 0, paid: 0, exp: 0 } },
    { id: 'g', name: 'บริษัท ตัวอย่าง G · CFO ปีที่ 2', client: 'บริษัท ตัวอย่าง G จำกัด', owner: 'cc', status: 'going', tpl: 'cfo', priority: 'สูง', level: 'ระดับ 2', phases: plan(CFO, at('2026-06-06'), 13, 0.5, 'cc'), money: { budget: 55000, billed: 55000, paid: 38500, exp: 3100 } },
    { id: 'h', name: 'บริษัท ตัวอย่าง H · CFO', client: 'บริษัท ตัวอย่าง H จำกัด', owner: 'cb', status: 'done', tpl: 'cfo', priority: 'ปานกลาง', level: 'ระดับ 1', phases: plan(CFO, at('2026-02-20'), 25), money: { budget: 80000, billed: 80000, paid: 80000, exp: 0 } },
    { id: 'j', name: 'บริษัท ตัวอย่าง J · CFO', client: 'บริษัท ตัวอย่าง J จำกัด', owner: 'cc', status: 'hold', tpl: 'cfo', priority: 'ต่ำ', level: 'ระดับ 1', holdNote: 'พักไว้ตามที่ลูกค้าขอ', phases: plan(CFO, at('2026-11-02'), 2, 0, 'cc'), money: { budget: 160000, billed: 0, paid: 0, exp: 0 } },
    { id: 'k', name: 'งานอีเวนท์ ตัวอย่าง · CF-Event', client: 'หน่วยงาน ตัวอย่าง K', owner: 'cd', status: 'open', tpl: 'event', priority: 'ปานกลาง', level: 'ระดับ 1', phases: plan(EVENT, d, 0), money: { budget: 0, billed: 0, paid: 0, exp: 0 } },
  ];
}

/** 3C's invoices and expenses (sample), their dates as on `today`. */
export function sampleBills(today: string): { invoices: Invoice[]; expenses: Expense[] } {
  const d = daysBetween(ANCHOR, today);
  const m = (iso: string) => addDays(iso, d);
  return {
    invoices: [
      { no: 'GCCIN-ตัวอย่าง-0011', project: 'h', date: m('2026-09-09'), amount: 80000, paid: 80000, terms: 'จ่ายครั้งเดียว ภายใน 30 วัน' },
      { no: 'GCCIN-ตัวอย่าง-0004', project: 'g', date: m('2026-10-02'), amount: 55000, paid: 38500, terms: 'จ่าย 2 งวด 70% และ 30%' },
      { no: 'GCCIN-ตัวอย่าง-0002', project: 'e', date: m('2026-11-12'), amount: 47500, paid: 0, terms: 'งวดแรก 50% เมื่อเริ่มงาน' },
    ],
    expenses: [
      { item: 'ค่าเดินทาง อาหาร เบี้ยเลี้ยง', project: 'g', date: m('2026-09-04'), amount: 450 },
      { item: 'ค่าเครื่องดื่ม', project: 'g', date: m('2026-09-17'), amount: 250 },
      { item: 'ค่าอุปกรณ์', project: 'g', date: m('2026-09-18'), amount: 850 },
      { item: 'ค่าเดินทาง', project: 'g', date: m('2026-09-21'), amount: 350 },
      { item: 'ค่าเลี้ยงรับรอง', project: 'g', date: m('2026-09-22'), amount: 1200 },
    ],
  };
}

// ---- what the screens read

export type TaskState = 'done' | 'late' | 'going' | 'todo';
/** A task on `today`: done; late (not done, its end passed); started; or not started. A project on hold has no late task. */
export function taskState(t: Task, today: string, hold = false): TaskState {
  if (t.pr >= 1) return 'done';
  if (!hold && t.end < today) return 'late';
  return t.pr > 0 ? 'going' : 'todo';
}
const allTasks = (p: Project) => p.phases.flatMap((ph) => ph.tasks);

export interface PhaseView { no: number; name: string; short: string; from: string; to: string; pct: number; state: 'done' | 'now' | 'todo' }
export interface ProjectView {
  /** 0 to 1, the tasks' average */
  progress: number;
  done: number; total: number;
  late: Task[];
  /** the late tasks, then the next two not started or under way (by their end) */
  next: Task[];
  /** the phase under way (1-based); phases + 1 when every task is done */
  phaseNow: number;
  from: string; to: string;
  phases: PhaseView[];
}
export function projectView(p: Project, today: string): ProjectView {
  const ts = allTasks(p), hold = p.status === 'hold';
  const progress = ts.length ? ts.reduce((n, t) => n + Math.min(1, t.pr), 0) / ts.length : 0;
  const late = ts.filter((t) => taskState(t, today, hold) === 'late').sort((a, b) => a.end.localeCompare(b.end));
  const coming = ts.filter((t) => t.pr < 1 && !late.includes(t)).sort((a, b) => a.end.localeCompare(b.end) || a.wbs.localeCompare(b.wbs, undefined, { numeric: true }));
  const phases: PhaseView[] = p.phases.map((ph) => {
    const pct = ph.tasks.reduce((n, t) => n + Math.min(1, t.pr), 0) / ph.tasks.length;
    return {
      no: ph.no, name: ph.name, short: ph.short,
      from: ph.tasks.reduce((m, t) => (t.start < m ? t.start : m), '9999'), to: ph.tasks.reduce((m, t) => (t.end > m ? t.end : m), '0000'),
      pct, state: pct >= 1 ? 'done' : pct > 0 ? 'now' : 'todo',
    };
  });
  const firstOpen = phases.findIndex((ph) => ph.state !== 'done');
  return {
    progress, done: ts.filter((t) => t.pr >= 1).length, total: ts.length, late, next: [...late, ...coming.slice(0, 2)],
    phaseNow: firstOpen < 0 ? phases.length + 1 : firstOpen + 1,
    from: phases.reduce((m, ph) => (ph.from < m ? ph.from : m), '9999'), to: phases.reduce((m, ph) => (ph.to > m ? ph.to : m), '0000'),
    phases,
  };
}

/** "เลยกำหนด 2 วัน", "ครบกำหนดวันนี้", "อีก 5 วัน": a task's end from `today`. */
export function dueWords(end: string, today: string): string {
  const n = daysBetween(today, end);
  return n < 0 ? `เลยกำหนด ${-n} วัน` : n === 0 ? 'ครบกำหนดวันนี้' : `อีก ${n} วัน`;
}

/** The tasks of GCC's people this week (Monday to Sunday), across the projects under way: who carries how many. */
export function weekLoad(ps: Project[], today: string): { owner: string; name: string; n: number }[] {
  const from = weekStart(today), to = addDays(from, 6);
  const by = new Map<string, number>();
  ps.filter((p) => p.status === 'going').forEach((p) =>
    allTasks(p).forEach((t) => {
      if (t.pr >= 1 || t.end < from || t.start > to || ownerOf(t.owner).group !== 'gcc') return;
      by.set(t.owner, (by.get(t.owner) || 0) + 1);
    }),
  );
  return [...by].map(([owner, n]) => ({ owner, name: ownerOf(owner).name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/** 3C's totals: value, billed, received, still to receive (billed and not paid), not billed yet, expenses. */
export function moneyTotals(ps: Project[]) {
  const sum = (k: keyof Money) => ps.reduce((n, p) => n + p.money[k], 0);
  const budget = sum('budget'), billed = sum('billed'), paid = sum('paid');
  return { budget, billed, paid, due: billed - paid, left: ps.reduce((n, p) => n + Math.max(0, p.money.budget - p.money.billed), 0), exp: sum('exp'), billedShare: budget ? billed / budget : 0 };
}
