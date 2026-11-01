/**
 * The one-page summary (tabs/Summary.tsx) as markup, on a synthetic team: Company A to D and a person with no company,
 * no real names or data. The figures come from lib/execSummary.ts on a real GccEngine with a small registry set on it;
 * the expected numbers are worked out by hand from the fixture below. The page is rendered with react-dom/server, its
 * buttons are reached through the element tree (no DOM here), and nothing is written or sent.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../state';
import { Summary, SummaryPage, DEFAULT_PERIOD, changeWords, type SummaryPageProps } from './Summary';
import { GccEngine } from '../lib/engine';
import { execSummary, type ExecPeriodKind, type ExecSummary } from '../lib/execSummary';
import { memoryStore } from '../lib/storage';
import { Segmented } from '../components/ui';
import { emptySales, newDeal, type ActType, type Deal, type DealAct, type SalesState } from '../lib/sales';
import type { Built, Company, LogEntry, Task } from '../lib/types';
/** A rendered element; its props are read by the tests (any shape). */
type El<P = any> = ReactElement<P>;

const TODAY = '2026-10-14'; // a Wednesday: the week is Mon 12 Oct to today
const YEAR = '2569';
/** A timestamp at noon on a day, local: its local day is that day in any time zone. */
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString();
const co = (id: number, name: string) => ({ id, name, cfoSt: 'none', days: null, giDays: null, fl: {}, code: '', hay: name }) as unknown as Company;
const REG = [co(101, 'Company A'), co(102, 'Company B'), co(103, 'Company C')];

/** Jobs: A is open (contacted twice), D is a free-text row, B won (250,000), C lost (90,000), both closed on 13 Oct. */
function tracker(): SalesState {
  const s = emptySales();
  const deal = (id: string, p: Partial<Deal> & { client: string }, steps: Record<string, [string, string?]> = {}) => {
    s.deals[id] = newDeal({ id, year: YEAR, section: 'Retention', order: Object.keys(s.deals).length, ...p }, 'ทดสอบ', at('2026-09-01'));
    for (const [k, [d, n = '']] of Object.entries(steps)) s.steps[`${id}/${k}`] = { d, n };
  };
  deal('dA', { client: 'Company A', gid: 101 }, { CONTACT: ['2026-10-01'] });
  deal('dD', { client: 'Company D' });
  deal('dB', { client: 'Company B', gid: 102, jobStatus: 'closed', closedDate: '2026-10-13', forecast: 250000, actual: 240000 }, { 'CLOSED DEAL': ['2026-10-13', 'YES'] });
  deal('dC', { client: 'Company C', gid: 103, jobStatus: 'closed', closedDate: '2026-10-13', forecast: 90000 }, { 'CLOSED DEAL': ['2026-10-13', 'NO'] });
  const acts: Record<string, DealAct> = {};
  const act = (id: string, dealId: string, d: string, type: ActType) => (acts[`${dealId}/${id}`] = { id, deal: dealId, d, type, note: '', stage: '', pid: '', by: 'ทดสอบ', at: at(d) });
  act('a1', 'dA', '2026-10-13', 'line'); // LINE on Company A's job
  act('a2', 'dD', '2026-10-14', 'call'); // a call to Company D, today
  s.acts = acts;
  return s;
}

/** The company log: a note is not a contact, a registry-less id is left out, `p-` is a person with no company. */
function logs(): Record<string, LogEntry[]> {
  const L = (day: string, type: string, result = '') => ({ at: at(day), by: 'ทดสอบ', type, result }) as LogEntry;
  return {
    '101': [L('2026-09-10', 'call'), L('2026-10-06', 'call'), L('2026-10-12', 'call', 'ติดต่อได้'), L('2026-10-13', 'email', 'ขอข้อมูลเพิ่ม'),
      L('2026-10-13', 'note'), L('2026-10-15', 'call')],
    '102': [L('2026-10-13', 'meet', 'นัดคุยต่อ')],
    '999': [L('2026-10-13', 'call')],
    'p-p1': [L('2026-10-13', 'call')],
  };
}

interface Fx { sales?: SalesState; log?: Record<string, LogEntry[]>; tasks?: Task[]; watch?: number[]; people?: Record<string, { name: string }> }
/** A GccEngine with the synthetic registry, tracker, log and follow list set on it; nothing is read from disk. */
function engine(f: Fx = {}) {
  const e = new GccEngine();
  e.B = { byId: new Map(REG.map((c) => [c.id, c])), alias: new Map() } as unknown as Built;
  e.sales = f.sales ?? emptySales();
  e.crm = { stages: {}, notes: {}, tasks: f.tasks ?? [], watch: f.watch ?? [], owners: {}, team: [], log: f.log ?? {} };
  e.people = (f.people ?? {}) as unknown as GccEngine['people'];
  e.store = memoryStore();
  return e;
}
const PEOPLE = { p1: { name: 'Synthetic Person' } };
const tasks: Task[] = [
  { id: 't1', gid: 101, title: '', type: 'call', date: '2026-10-10', time: '', note: '', done: false }, // Company A: 4 days late
  { id: 't2', gid: 102, title: '', type: 'meet', date: '2026-10-14', time: '', note: '', done: false }, // Company B: today
];
const populated = () => engine({ sales: tracker(), log: logs(), people: PEOPLE, tasks, watch: [101, 102] });

/** The page's props for a summary, with the handlers as spies. */
function props(s: ExecSummary, o: Partial<SummaryPageProps> = {}): SummaryPageProps & { spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = { onKind: vi.fn(), onOpen: vi.fn(), onOpenDeal: vi.fn(), onGo: vi.fn() };
  return { s, kind: s.period.kind, year: YEAR, today: TODAY, canMoney: true, ...spies, ...o, spies };
}
/** The page as text markup: React's separators between adjacent text pieces removed. */
const html = (el: El) => renderToStaticMarkup(el).replace(/<!-- -->/g, '');

/** Every element of a rendered tree (the props too: the header's segmented control sits in one). */
function walk(node: unknown, visit: (el: El) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isValidElement(node)) return;
  visit(node);
  for (const v of Object.values(node.props as Record<string, unknown>)) walk(v, visit);
}
function all(root: unknown, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  walk(root, (el) => pred(el) && out.push(el));
  return out;
}
/** The text a rendered element holds directly (a name is one string child). */
const textOf = (el: El) => (el.props as { children?: ReactNode }).children;
/** The table row (or list item) that holds a given text, and its one name button. */
const rowWith = (root: unknown, tag: 'tr' | 'li', text: string) => all(root, (el) => el.type === tag && all(el, (x) => textOf(x) === text).length > 0)[0];
const nameButton = (row: El) => all(row, (el) => el.type === 'button' && String(el.props.className).includes('ex-name'))[0];

describe('the page with no data: zeros, empty lists and the as-of line', () => {
  const s = execSummary(engine(), 'month', TODAY);
  const page = html(<SummaryPage {...props(s)} />);

  it('the title, the three periods and the month pressed', () => {
    expect(page).toContain('สรุปผู้บริหาร');
    expect(page).toContain('aria-pressed="true">เดือนนี้</button>');
    expect(page).toContain('aria-pressed="false">สัปดาห์นี้</button>');
    expect(page).toContain('aria-pressed="false">ไตรมาส</button>');
    expect(page).toContain('เทียบกับช่วงเดียวกันของเดือนก่อน');
  });

  it('the four figures are zero, and each empty list says so in one line', () => {
    expect(page).toContain('>0<small>ครั้ง</small>');
    expect(page).toContain('>0<small>บริษัท</small>');
    expect(page).toContain('>0<small>งาน</small>');
    expect(page).toContain('>0<small>รายการ</small>');
    expect(page.split('ยังไม่มีการติดต่อในช่วงนี้').length - 1).toBe(2); // the channels and the recent contacts
    expect(page).toContain('ไม่มีรายการที่ต้องติดตามต่อ');
  });

  it('the footer gives the as-of day in Thai, and no sample-data tag', () => {
    expect(page).toContain('ข้อมูล ณ สิ้นสุดวันนี้ (14 ต.ค. 2569)');
    expect(page).not.toContain('ตัวอย่าง');
  });
});

describe('the page with synthetic data for the week', () => {
  const s = execSummary(populated(), 'week', TODAY);
  const page = html(<SummaryPage {...props(s, { kind: 'week' })} />);

  it('the four figures, each with its line against the week before', () => {
    expect(page).toContain('>6<small>ครั้ง</small>');
    expect(page).toContain('สูงกว่าช่วงก่อน 500% (จาก 1 ครั้ง)');
    expect(page).toContain('>3<small>บริษัท</small>');
    expect(page).toContain('>2<small>รายการ</small>');
    expect(page).toContain('เกินกำหนด 1</span> · วันนี้ 1');
  });

  it('the channels in the app\'s order, with their counts and shares', () => {
    expect(page).toContain('>3 <span class="t-muted">50%</span>'); // โทร: two calls to companies and a call to Company D
    expect(page).toContain('>1 <span class="t-muted">17%</span>'); // อีเมล, นัดพบ, LINE/อื่นๆ
    const order = ['โทร', 'อีเมล', 'นัดพบ', 'ติดตามผล', 'LINE/อื่นๆ'].map((l) => page.indexOf(`>${l}</span>`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the won total: one job, its forecast in money, and the funnel by its own labels', () => {
    expect(page).toContain('มูลค่า Forecast 250,000 บาท');
    expect(page).toContain('ได้งานในช่วงที่เลือก 1 งาน · ทำงานให้ 1 บริษัท');
    expect(page).toContain('ปิดงานในช่วงที่เลือกทั้งหมด 2 งาน · ไม่ได้งาน 1 งาน');
    for (const label of ['ติดต่อประสานงาน', 'ส่งใบเสนอราคา', 'ติดตามผล', 'ได้งาน']) expect(page).toContain(label);
    expect(page).toContain('ทั้งปี 2569 · ไม่ตามช่วงเวลา');
  });

  it('the recent contacts name the company, its channel and its result (— when none)', () => {
    expect(page).toContain('ติดต่อได้</td>');
    expect(page).toContain('>—</td>');
    expect(page).toContain('LINE/อื่นๆ');
  });
});

describe('the period buttons choose the period', () => {
  const e = populated();

  it('pressing a period passes it up, in the order of the buttons', () => {
    const p = props(execSummary(e, 'month', TODAY));
    const seg = all(SummaryPage(p), (el) => el.type === Segmented)[0] as El<{ options: { label: string }[]; onChange: (k: ExecPeriodKind) => void }>;
    expect(seg.props.options.map((o) => o.label)).toEqual(['สัปดาห์นี้', 'เดือนนี้', 'ไตรมาส']);
    seg.props.onChange('week');
    seg.props.onChange('quarter');
    expect(p.spies.onKind.mock.calls).toEqual([['week'], ['quarter']]);
  });

  it('the page opens on the month', () => {
    expect(DEFAULT_PERIOD).toBe('month');
  });

  it('each period shows its own figures, and the page names the chosen one', () => {
    const byKind = (k: ExecPeriodKind) => html(<SummaryPage {...props(execSummary(e, k, TODAY), { kind: k })} />);
    const week = byKind('week'), month = byKind('month'), quarter = byKind('quarter');
    expect(week).toContain('aria-pressed="true">สัปดาห์นี้</button>');
    expect(month).toContain('aria-pressed="true">เดือนนี้</button>');
    expect(quarter).toContain('aria-pressed="true">ไตรมาส</button>');
    expect(week).toContain('>6<small>ครั้ง</small>');
    expect(month).toContain('>7<small>ครั้ง</small>');
    expect(month).toContain('สูงกว่าช่วงก่อน 600% (จาก 1 ครั้ง)');
    expect(quarter).toContain('ช่วงก่อนไม่มีรายการ');
    expect(quarter).toContain('เทียบกับช่วงเดียวกันของไตรมาสก่อน');
  });
});

describe('the figures in words', () => {
  it('a rise, a fall, no change, and a period with nothing to compare', () => {
    expect(changeWords({ value: 6, prev: 1, delta: 5, pct: 5 }, 'ครั้ง')).toBe('สูงกว่าช่วงก่อน 500% (จาก 1 ครั้ง)');
    expect(changeWords({ value: 1, prev: 2, delta: -1, pct: -0.5 }, 'ครั้ง')).toBe('ต่ำกว่าช่วงก่อน 50% (จาก 2 ครั้ง)');
    expect(changeWords({ value: 2, prev: 2, delta: 0, pct: 0 }, 'บริษัท')).toBe('เท่ากับช่วงก่อน (2 บริษัท)');
    expect(changeWords({ value: 3, prev: 0, delta: 3, pct: null }, 'บริษัท')).toBe('ช่วงก่อนไม่มีรายการ');
  });
});

describe('the rows open what they name', () => {
  const s = execSummary(populated(), 'month', TODAY);
  const tree = () => SummaryPage(props(s));

  it('a job row opens the job, a company row opens the company, a person with no company is plain text', () => {
    const p = props(s);
    const t = SummaryPage(p);
    nameButton(rowWith(t, 'tr', 'Company D')).props.onClick();
    expect(p.spies.onOpenDeal).toHaveBeenLastCalledWith('dD');

    const q = props(s);
    const u = SummaryPage(q);
    nameButton(rowWith(u, 'tr', 'LINE/อื่นๆ')).props.onClick();
    expect(q.spies.onOpenDeal).toHaveBeenLastCalledWith('dA');

    const r = props(s);
    const v = SummaryPage(r);
    nameButton(rowWith(v, 'tr', 'อีเมล')).props.onClick();
    expect(r.spies.onOpen).toHaveBeenLastCalledWith(101);

    expect(rowWith(tree(), 'tr', 'Synthetic Person')).toBeDefined();
    expect(nameButton(rowWith(tree(), 'tr', 'Synthetic Person'))).toBeUndefined();
  });

  it('a follow-up opens its company, and the list links to the follow-up page', () => {
    const p = props(s);
    const t = SummaryPage(p);
    nameButton(rowWith(t, 'li', 'Company B')).props.onClick();
    expect(p.spies.onOpen).toHaveBeenLastCalledWith(102);
    const link = all(t, (el) => el.type === 'button' && textOf(el) === 'ดูทั้งหมดในหน้าติดตาม')[0];
    link.props.onClick();
    expect(p.spies.onGo).toHaveBeenCalledWith('track');
  });

  it('the money stays out when the account may not see it', () => {
    const page = html(<SummaryPage {...props(s, { canMoney: false })} />);
    expect(page).not.toContain('Forecast');
    expect(page).not.toContain('Actual');
    expect(page).toContain('ทำงานให้ 1 บริษัท');
  });
});

describe('the routed page', () => {
  it('draws the month with the data of today, with the period on the month', () => {
    const e = populated();
    e.can = () => true;
    const page = html(<AppProvider engine={e}><Summary /></AppProvider>);
    expect(page).toContain('aria-pressed="true">เดือนนี้</button>');
    expect(page).toContain('สรุปผู้บริหาร');
    expect(page).not.toContain('ตัวอย่าง');
  });

  it('makes no network call and writes nothing: the stores and the engine are the same before and after', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const e = populated();
    e.can = () => true;
    const writes = vi.fn();
    const store = e.store as unknown as Record<'set' | 'del' | 'update', (...a: unknown[]) => unknown>;
    for (const k of ['set', 'del', 'update'] as const) {
      const orig = store[k];
      store[k] = (...a: unknown[]) => {
        writes(k);
        return orig(...a);
      };
    }
    const before = structuredClone({ crm: e.crm, sales: e.sales });
    html(<AppProvider engine={e}><Summary /></AppProvider>);
    html(<SummaryPage {...props(execSummary(e, 'quarter', TODAY))} />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(structuredClone({ crm: e.crm, sales: e.sales })).toEqual(before);
  });
});

afterEach(() => vi.unstubAllGlobals());
