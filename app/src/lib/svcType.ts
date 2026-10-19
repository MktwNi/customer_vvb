/**
 * Service types (ประเภทบริการ) on แผนติดต่อ: which of our services a company being contacted is about, read
 * from the Services of its Sales Tracker jobs. Six types (CFO · CFP · ที่ปรึกษา · ทวนสอบ · แพลตฟอร์ม · T-VER,
 * the customer types designed earlier, with their validated colours and service lists), "อื่นๆ" for a service
 * none of them lists (Course Training, CF-EVENT, a name an admin added) and "ยังไม่ระบุประเภท" for a company
 * with no job (followed only) or whose jobs list no service.
 *
 * Always derived, never stored or synced: no record, no field, nothing to set. A company's types come from
 * its jobs of the tracker's year (the open ones first: what it is being contacted about), else from its jobs
 * of another year (the newest first). A joint quotation's header is not a customer (its members are); a member
 * is sold through the header's quotation, so it takes the header's Services (its own while the header lists
 * none). A customer is its key (lib/custColor.ts custKey / dealKey), so a company's appointments, its jobs and
 * its row in the contact list always read the same types.
 *
 * Colours: ink on tint for the chip (the word is always written, so colour is never the only cue), the mark
 * for a bar, a stripe or a dot. None is amber, orange or red, so a type never reads as a status.
 * Pure functions only (no engine, no DOM).
 */
import type { CSSProperties } from 'react';
import { jointRole, payerDeal, type Deal, type SalesState } from './sales';

export const SVC_TYPE_LABEL = 'ประเภทบริการ';
export type SvcTypeId = 'cfo' | 'cfp' | 'con' | 'vvb' | 'plt' | 'tvr' | 'oth' | 'none';
/** A type: its name, a line about it (tooltips, help), the chip's ink on its tint, the mark (bar, stripe,
 *  dot) and the tracker services it stands for. */
export interface SvcType {
  readonly id: SvcTypeId;
  readonly n: string;
  readonly d: string;
  readonly ink: string;
  readonly tint: string;
  readonly mark: string;
  readonly svc: readonly string[];
}

/** In list order (chips, the legend and the filter always follow it). The six hues are the customer types'
 *  validated slots (ink ≥ 4.5:1 on its tint, mark ≥ 3:1 on white); อื่นๆ and ยังไม่ระบุประเภท are greys,
 *  the lighter one for nothing known. */
export const SVC_TYPES: readonly SvcType[] = Object.freeze(
  [
    { id: 'cfo', n: 'CFO', d: 'คาร์บอนฟุตพริ้นท์องค์กร', ink: '#1E4BAF', tint: '#EAF0FC', mark: '#2F6BD6', svc: ['CFO', 'CF'] },
    { id: 'cfp', n: 'CFP', d: 'คาร์บอนฟุตพริ้นท์ผลิตภัณฑ์', ink: '#056E64', tint: '#E1F3F0', mark: '#14A08C', svc: ['CFP'] },
    { id: 'con', n: 'ที่ปรึกษา', d: 'งานที่ปรึกษา', ink: '#6236A8', tint: '#F1EBFA', mark: '#7E57C9', svc: ['LESS', 'Program Development'] },
    { id: 'vvb', n: 'ทวนสอบ', d: 'งานทวนสอบ (VVB)', ink: '#952866', tint: '#FAE9F2', mark: '#B83686', svc: ['VVB'] },
    { id: 'plt', n: 'แพลตฟอร์ม', d: 'ใช้แพลตฟอร์มของเรา', ink: '#00627A', tint: '#DDF3F8', mark: '#119CBC', svc: ['GCT'] },
    { id: 'tvr', n: 'T-VER', d: 'โครงการคาร์บอนเครดิต T-VER', ink: '#2F6E2C', tint: '#E7F3E5', mark: '#3E8E2E', svc: ['T-VER', 'CC'] },
    { id: 'oth', n: 'อื่นๆ', d: 'บริการที่ไม่อยู่ในหกประเภท เช่น Course Training หรือ CF-EVENT', ink: '#475069', tint: '#EEF1F7', mark: '#5F6984', svc: [] },
    { id: 'none', n: 'ยังไม่ระบุประเภท', d: 'ยังไม่มีงานใน Sales Tracker หรืองานยังไม่ได้เลือก Services', ink: '#5E6680', tint: '#F6F7FA', mark: '#8A92A6', svc: [] },
  ].map((x) => Object.freeze({ ...x, svc: Object.freeze(x.svc) }) as SvcType),
);
const BY_ID = new Map(SVC_TYPES.map((t) => [t.id, t]));
const ORDER = new Map(SVC_TYPES.map((t, i) => [t.id, i]));
/** A type by id (an unknown one reads as อื่นๆ). */
export const svcType = (id: string): SvcType => BY_ID.get(id as SvcTypeId) || BY_ID.get('oth')!;
export const isSvcType = (id: unknown): id is SvcTypeId => typeof id === 'string' && BY_ID.has(id as SvcTypeId);
export const byTypeOrder = (a: SvcTypeId, b: SvcTypeId) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99);

/** A service name as it is matched: case, outer and doubled spaces do not count ("t-ver", " Program  development"). */
const svcKey = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const SVC_MAP = new Map(SVC_TYPES.flatMap((t) => t.svc.map((s) => [svcKey(s), t.id] as const)));

/** The type a tracker service stands for: one of the six, else อื่นๆ; null for an empty name. */
export function typeOfService(s: string): SvcTypeId | null {
  const k = svcKey(s);
  if (!k) return null;
  return SVC_MAP.get(k) || 'oth';
}
/** The types of a list of services, each once, in list order ([] when it lists none). */
export function typesOfServices(svc: readonly string[]): SvcTypeId[] {
  const out = new Set<SvcTypeId>();
  for (const s of svc) {
    const t = typeOfService(s);
    if (t) out.add(t);
  }
  return [...out].sort(byTypeOrder);
}

/** The Services a job's type is read from: a joint quotation's member is sold through its header's
 *  quotation, so the header's (its own while the header lists none); any other job its own. */
export function jobServices(s: SalesState, d: Deal): string[] {
  const h = payerDeal(s, d);
  return h !== d && h.service.length ? h.service : d.service;
}
/** A customer's types and where they were read: the open jobs of the tracker's year (`open`), any job of
 *  that year (`year`), the jobs of another year (`other`, `year` says which), one deal's own Services
 *  (`deal`: an installment), or nothing (`''`: ยังไม่ระบุประเภท). `why`: each type's services, as written in
 *  the tracker (the chip's tooltip). `types` is never empty. */
export interface CustTypes {
  readonly types: readonly SvcTypeId[];
  readonly from: 'open' | 'year' | 'other' | 'deal' | '';
  readonly year: string;
  readonly why: Readonly<Partial<Record<SvcTypeId, readonly string[]>>>;
}
export const NO_TYPES: CustTypes = Object.freeze({ types: Object.freeze(['none'] as SvcTypeId[]), from: '' as const, year: '', why: Object.freeze({}) });

/** The types the Services of `deals` name, with each type's services ([] types when they name none). */
function readTypes(s: SalesState, deals: readonly Deal[]): { types: SvcTypeId[]; why: Partial<Record<SvcTypeId, string[]>> } {
  const why: Partial<Record<SvcTypeId, string[]>> = {};
  for (const d of deals)
    for (const sv of jobServices(s, d)) {
      const t = typeOfService(sv);
      if (!t) continue;
      const w = (why[t] ||= []);
      const name = sv.trim().replace(/\s+/g, ' ');
      if (!w.includes(name)) w.push(name);
    }
  return { types: (Object.keys(why) as SvcTypeId[]).sort(byTypeOrder), why };
}
/** An installment's types: its deal's own Services (a joint quotation's header is the quotation: its own);
 *  ยังไม่ระบุประเภท when it lists none. */
export function dealTypes(s: SalesState, d: Deal): CustTypes {
  const r = readTypes(s, [d]);
  return r.types.length ? { types: r.types, from: 'deal', year: d.year, why: r.why } : NO_TYPES;
}

/** The types of one customer's jobs (`jobs`: every year; a joint quotation's header is skipped): its open jobs
 *  of `year` (`open` says which are), else any job of `year`, else each other year, the newest first; the
 *  first of these whose Services name a type. */
export function typesOfJobs(s: SalesState, jobs: readonly Deal[], year: string, open: (d: Deal) => boolean): CustTypes {
  const ds = jobs.filter((d) => jointRole(s, d) !== 'header');
  const tiers: [CustTypes['from'], string, Deal[]][] = [
    ['open', year, ds.filter((d) => d.year === year && open(d))],
    ['year', year, ds.filter((d) => d.year === year)],
  ];
  const years = [...new Set(ds.map((d) => d.year).filter((y) => y !== year))].sort((a, b) => b.localeCompare(a));
  for (const y of years) tiers.push(['other', y, ds.filter((d) => d.year === y)]);
  for (const [from, y, list] of tiers) {
    const r = readTypes(s, list);
    if (r.types.length) return { types: r.types, from, year: y, why: r.why };
  }
  return NO_TYPES;
}

/** Every customer's types, by its key (`keyOf`: lib/custColor.ts dealKey, the key its appointments and its
 *  row are read by). A customer with no job is not in it: typesOf gives ยังไม่ระบุประเภท. `s` null (an account
 *  that does not see the tracker): empty. */
export function custTypes(s: SalesState | null, keyOf: (d: Deal) => string, year: string, open: (d: Deal) => boolean): Map<string, CustTypes> {
  const out = new Map<string, CustTypes>();
  if (!s) return out;
  const by = new Map<string, Deal[]>();
  for (const d of Object.values(s.deals)) {
    if (jointRole(s, d) === 'header') continue;
    const k = keyOf(d);
    if (!k) continue;
    const l = by.get(k);
    if (l) l.push(d);
    else by.set(k, [d]);
  }
  for (const [k, ds] of by) out.set(k, typesOfJobs(s, ds, year, open));
  return out;
}
export const typesOf = (m: ReadonlyMap<string, CustTypes>, ck: string): CustTypes => m.get(ck) || NO_TYPES;

/** The one colour of an entry with several types: the type shown alone (when the entry has it), else the
 *  first in list order. */
export function mainType(types: readonly SvcTypeId[], only: SvcTypeId | '' = ''): SvcTypeId {
  return only && types.includes(only) ? only : types[0] || 'none';
}
/** The CSS custom properties the plan's marks read (`--c` mark, `--cb` tint): as lib/custColor.ts ccVars. */
export const typeVars = (id: SvcTypeId): CSSProperties => {
  const t = svcType(id);
  return { '--c': t.mark, '--cb': t.tint } as CSSProperties;
};
/** A chip's colours (`--k` ink on `--kb` tint). */
export const chipVars = (id: SvcTypeId): CSSProperties => {
  const t = svcType(id);
  return { '--k': t.ink, '--kb': t.tint } as CSSProperties;
};
/** A chip's tooltip: "ประเภทบริการ ทวนสอบ · จาก Services VVB ของงานปี 2568". The year is said when the types
 *  come from another year than the tracker's. */
export function chipTitle(id: SvcTypeId, ct?: Pick<CustTypes, 'why' | 'from' | 'year'>): string {
  const t = svcType(id);
  if (id === 'none') return `${SVC_TYPE_LABEL} · ${t.n} · ${t.d}`;
  const sv = ct?.why[id];
  return `${SVC_TYPE_LABEL} ${t.n}${sv?.length ? ` · จาก Services ${sv.join(', ')}` : ` · ${t.d}`}${ct?.from === 'other' && ct.year ? ` ของงานปี ${ct.year}` : ''}`;
}

// ------------------------------------------------------------------ the calendar's legend and filter

/** One type of "ประเภทบริการในเดือนนี้": its appointments in the month (`n`) and its companies (`cos`). */
export interface TypeLegendItem { id: SvcTypeId; n: number; cos: number }
/** The types of the appointments in `month` ('YYYY-MM'), in list order, each with its count. An appointment
 *  of a company with several types counts once under each (a company is CFO and ทวนสอบ). */
export function monthTypes(entries: readonly { date: string; ck: string; types: readonly SvcTypeId[] }[], month: string): TypeLegendItem[] {
  const by = new Map<SvcTypeId, { n: number; cos: Set<string> }>();
  for (const x of entries) {
    if (x.date.slice(0, 7) !== month) continue;
    for (const t of new Set(x.types)) {
      let it = by.get(t);
      if (!it) by.set(t, (it = { n: 0, cos: new Set() }));
      it.n++;
      it.cos.add(x.ck);
    }
  }
  return [...by.entries()].sort((a, b) => byTypeOrder(a[0], b[0])).map(([id, v]) => ({ id, n: v.n, cos: v.cos.size }));
}
/** The type the calendar shows alone: the one pressed in the legend while an entry (an appointment or an
 *  installment, any month) still has it, else '' (all). */
export function activeType(only: string, entries: Iterable<{ types: readonly SvcTypeId[] }>): SvcTypeId | '' {
  if (!isSvcType(only)) return '';
  for (const x of entries) if (x.types.includes(only)) return only;
  return '';
}
/** The entries of the type shown alone, or all of them. */
export function onlyType<T extends { types: readonly SvcTypeId[] }>(xs: readonly T[], only: SvcTypeId | ''): T[] {
  return only ? xs.filter((x) => x.types.includes(only)) : xs.slice();
}

// ------------------------------------------------------------------ the contact list's filter

/** The ประเภทบริการ filter's values as the UI keeps them: known ids only, each once, in list order. */
export function typeSel(v: unknown): SvcTypeId[] {
  return Array.isArray(v) ? [...new Set(v.filter(isSvcType))].sort(byTypeOrder) : [];
}
/** The rows with any of the types picked (none picked: every row). */
export function filterTypes<R>(rows: readonly R[], sel: readonly string[], typesOfRow: (r: R) => readonly SvcTypeId[]): R[] {
  const want = typeSel(sel);
  if (!want.length) return rows.slice();
  return rows.filter((r) => typesOfRow(r).some((t) => want.includes(t)));
}
/** How many rows have each type (a row with two types counts under both): the filter's counts. */
export function typeCounts<R>(rows: readonly R[], typesOfRow: (r: R) => readonly SvcTypeId[]): Record<SvcTypeId, number> {
  const n = Object.fromEntries(SVC_TYPES.map((t) => [t.id, 0])) as Record<SvcTypeId, number>;
  for (const r of rows) for (const t of new Set(typesOfRow(r))) n[t]++;
  return n;
}
