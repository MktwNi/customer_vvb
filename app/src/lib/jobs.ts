/**
 * Jobs (งาน) of one company: a company may have several rows in one year of the Sales Tracker, normally one per
 * service (CFO one job, CFP another; a job may carry several services when they are quoted together). A row's
 * services are its `service` list (already on every deal and synced item by item): nothing new is stored.
 *
 * One rule, read from the services, says when two jobs may be one piece of work entered twice (maySame): they
 * share a service, or neither names one. A company's jobs of different services are normal.
 * - the table's soft "อาจซ้ำ" (dupRows): two rows of one company in one year that maySame. The tag goes once each
 *   row has its own quotation and the two share no quotation number ("a different quotation is a different job":
 *   CFP for two products, two T-VER projects).
 * - a send (sendState) and เพิ่มลูกค้า: the services picked against the company's jobs that year. A job that
 *   shares a picked service may be the same work (not ticked: "อาจซ้ำ"); a job without a service, beside picked
 *   services, is not (as in the table: its "ยังไม่ระบุบริการ" asks for one) and the row says so. A send with no
 *   service picked only puts a company that has no job yet in the year into the tracker: one that has a job
 *   is not ticked ("มีงานแล้ว"), as nothing tells a second job apart.
 * - an import (surelyOther): a row tracked by hand without a service may be any row of the file, as before.
 * A joint quotation's member is sold under its header's services (lib/sales.ts jobServices); a header is the
 * payer's row for that quotation, not a job of the company's own, and is never compared.
 * Pure functions only (no engine, no DOM).
 */
import { norm } from './core';
import { docNoKey, docsOf, jobServices, jointRole, placeholderName, svcKey, type Deal, type SalesState } from './sales';

export const SVC_LABEL = 'บริการ';
/** หมวด as the forms name it: the group of rows in the table, by the channel the customer came from (SOURCE
 *  follows it: lib/sales.ts matchSource). */
export const SECTION_LABEL = 'หมวด (ช่องทางที่ได้ลูกค้า)';
export const NO_SVC = 'ยังไม่ระบุบริการ';

/** A service as it is compared: case, outer and doubled spaces do not count ("t-ver", " CFO "). */
export { svcKey };
/** Does a list name any service? */
export const named = (list: readonly string[]) => list.some((x) => !!svcKey(x));
/** A picked list cleaned: trimmed, each once (by svcKey), in the order given. */
export function svcClean(list: readonly string[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const x of list) {
    const k = svcKey(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(x).trim().replace(/\s+/g, ' '));
  }
  return out;
}
/** Do two lists share a service? */
export function svcShare(a: readonly string[], b: readonly string[]): boolean {
  const k = new Set(a.map(svcKey).filter(Boolean));
  return b.some((x) => k.has(svcKey(x)));
}
/** The services of `a` that `b` has too, as `a` writes them. */
export const svcCommon = (a: readonly string[], b: readonly string[]) => svcClean(a.filter((x) => svcShare([x], b)));
/** Could two jobs be one piece of work entered twice: they share a service, or neither names one. */
export const maySame = (a: readonly string[], b: readonly string[]) => (!named(a) && !named(b)) || svcShare(a, b);
/** Surely two pieces of work: both name services and share none. */
export const surelyOther = (a: readonly string[], b: readonly string[]) => named(a) && named(b) && !svcShare(a, b);

/** The services in words: "CFO, CFP" ('' for none). */
export const svcText = (list: readonly string[]) => svcClean(list).join(', ');

/** The names the service picker offers: the team's list, then the given ones (a job's own, the names a job
 *  holds), each once by svcKey, the first spelling kept ("T-VER" before "t-ver"). */
export function svcOptions(team: readonly string[], used: readonly string[]): string[] {
  return svcClean([...team, ...used]);
}
/** Every service a job of the tracker holds, each once: any year, a joint quotation's header too (a blank one
 *  is not a service). Nothing is stored for it: a name is listed for everyone while a job holds it. */
export function usedServices(s: SalesState): string[] {
  return svcClean(Object.values(s.deals).flatMap((d) => d.service ?? []));
}
/** What the service picker offers for the tracker `s`: the team's list with every service its jobs hold. */
export const svcChoices = (s: SalesState) => svcOptions(s.cfg.services, usedServices(s));

/** The picker's add field (components/SvcChips.tsx SvcPick), in words. */
export const SVC_ADD = Object.freeze({
  label: 'เพิ่มบริการใหม่',
  hint: 'ทุกคนในทีมจะเห็นบริการนี้ในรายการ',
  placeholder: 'ชื่อบริการ',
  button: 'เพิ่ม',
  empty: 'กรอกชื่อบริการก่อนกดเพิ่ม',
  long: 'ชื่อบริการต้องไม่เกิน 40 ตัวอักษร',
});
/** The longest name a service may have, counted in code points (a Thai letter is one). */
export const SVC_MAX = 40;
/** The picker's count line: "เลือกแล้ว 2 บริการ", "ยังไม่ได้เลือกบริการ". */
export const svcCount = (n: number) => (n ? `เลือกแล้ว ${n} บริการ` : 'ยังไม่ได้เลือกบริการ');

/** What the add field did: `name` is the service as it is kept ('' when refused), `value` the picked services
 *  after it, `options` the list after it, `on` whether the name is picked after it (false when refused). */
export interface SvcAdd {
  kind: 'empty' | 'long' | 'existing' | 'added';
  name: string;
  msg: string;
  value: string[];
  options: string[];
  on: boolean;
}

/** The add field's rule: a blank or a name over SVC_MAX is refused and said; a name that matches one in the list
 *  (any case, any spacing) selects that one, never a duplicate; any other name is kept as typed (spaces
 *  collapsed) and picked. Pure: the caller stores the result. */
export function addSvcName(input: string, options: readonly string[], value: readonly string[]): SvcAdd {
  const name = String(input ?? '').trim().replace(/\s+/g, ' ');
  const picked = svcClean(value);
  const refuse = (kind: 'empty' | 'long', msg: string): SvcAdd => ({ kind, name: '', msg, value: picked, options: svcOptions(options, picked), on: false });
  if (!name) return refuse('empty', SVC_ADD.empty);
  if ([...name].length > SVC_MAX) return refuse('long', SVC_ADD.long);
  const k = svcKey(name);
  const hit = svcOptions(options, picked).find((x) => svcKey(x) === k);
  if (hit) {
    const on = picked.some((x) => svcKey(x) === k);
    return {
      kind: 'existing',
      name: hit,
      msg: `มีบริการ “${hit}” อยู่แล้ว ` + (on ? 'และเลือกไว้แล้ว' : 'เลือกให้แล้ว'),
      value: on ? picked : svcClean([...picked, hit]),
      options: svcOptions(options, [...picked, hit]),
      on: true,
    };
  }
  return {
    kind: 'added',
    name,
    msg: `เพิ่ม “${name}” แล้ว และเลือกไว้แล้ว`,
    value: svcClean([...picked, name]),
    options: svcOptions(options, [...picked, name]),
    on: true,
  };
}
/** A job's name where two jobs of one company must be told apart (toasts, the bell, aria labels, pickers):
 *  "ทองมงคล · CFP"; the name alone when it lists no service. */
export const withSvc = (name: string, svc: readonly string[]) => (named(svc) ? `${name} · ${svcText(svc)}` : name);

// ------------------------------------------------------------------ sending a company to the tracker

/** A row of the send dialog, for a company with these jobs in the year (`jobs`: each job's services) when
 *  `picked` are sent: '' it has no job (sent as today); 'new' no job shares a picked service (ticked: "เพิ่ม
 *  เป็นงานใหม่"); 'dup' one shares a picked service, or nothing is picked (not ticked: "อาจซ้ำ" / "มีงานแล้ว"). */
export type SendState = '' | 'new' | 'dup';
export function sendState(picked: readonly string[], jobs: readonly (readonly string[])[]): SendState {
  if (!jobs.length) return '';
  return named(picked) && !jobs.some((j) => svcShare(picked, j)) ? 'new' : 'dup';
}
/** The jobs a send of `picked` may repeat: those that share a picked service (every job when nothing is picked),
 *  in the order given. */
export const clashing = (s: SalesState, picked: readonly string[], jobs: readonly Deal[]) =>
  named(picked) ? jobs.filter((d) => svcShare(picked, jobServices(s, d))) : jobs.slice();
/** The services a send of `picked` has in common with the jobs it may repeat ("CFO"; none when nothing was
 *  picked): what the note after a send names. */
export const clashSvc = (s: SalesState, picked: readonly string[], jobs: readonly Deal[]) =>
  named(picked) ? svcClean(clashing(s, picked, jobs).flatMap((d) => svcCommon(picked, jobServices(s, d)))) : [];
/** The word beside a send-dialog row's tick: "เพิ่มเป็นงานใหม่"; "อาจซ้ำ" (a job of the company has a service
 *  picked); "มีงานแล้ว" (nothing picked, the company has a job that year); null for a company without one. */
export function sendTag(st: SendState, picked: readonly string[]): { text: string; tone: 'info' | 'warn' | '' } | null {
  if (st === 'new') return { text: 'เพิ่มเป็นงานใหม่', tone: 'info' };
  if (st === 'dup') return named(picked) ? { text: 'อาจซ้ำ', tone: 'warn' } : { text: 'มีงานแล้ว', tone: '' };
  return null;
}
/** The jobs a row lists, the ones a send of `picked` may repeat first (when a service is picked), then the rest
 *  in the order given. */
export const jobsShown = (s: SalesState, picked: readonly string[], jobs: readonly Deal[]) => {
  const cl = named(picked) ? clashing(s, picked, jobs) : [];
  return [...cl, ...jobs.filter((d) => !cl.includes(d))];
};
/**
 * The line under one company's row in the send dialog (or the เพิ่มลูกค้า suggestion), after its jobs: what the
 * tick does. '' when the tag says it all.
 * - may repeat a job ('dup', a service picked): "CFO มีอยู่ในงานเดิม ถ้าเป็นคนละงาน ติ๊กเพื่อเพิ่มอีกงาน";
 * - nothing picked, it has a job: pick a service to add a new job;
 * - a new job beside one without a service: that job may be this one, untick and open it to pick its service.
 */
export function sendLine(s: SalesState, st: SendState, picked: readonly string[], jobs: readonly Deal[], on: boolean): string {
  if (st === 'dup' && named(picked))
    return `${svcText(clashSvc(s, picked, jobs))} มีอยู่ในงานเดิม ` + (on ? 'จะเพิ่มเป็นอีกงาน แถวที่บริการซ้ำกันจะขึ้นว่า “อาจซ้ำ” จนกว่าแต่ละแถวจะแนบใบเสนอราคาของตัวเอง' : 'ถ้าเป็นคนละงาน ติ๊กเพื่อเพิ่มอีกงาน');
  if (st === 'dup') return on ? 'จะเพิ่มอีกงานที่ยังไม่ระบุบริการ' : 'เลือกบริการด้านบนเพื่อเพิ่มเป็นงานใหม่ หรือติ๊กเพื่อเพิ่มอีกงาน';
  if (st === 'new' && on && jobs.some((d) => !named(jobServices(s, d))))
    return 'งานเดิมยังไม่ระบุบริการ ถ้าเป็นงานเดียวกัน เอาติ๊กออก แล้วเปิดงานเดิมเพื่อเลือกบริการ';
  return '';
}
/**
 * Whether a row of the send dialog is ticked, and sent through "อาจซ้ำ" (`force`, the engine adds it anyway): the
 * row's state from the services picked, or the person's own tick (`mine`) while the row still reads as it did
 * when they made it. A tick made while the row read otherwise (the services picked changed, or a teammate's send
 * arrived) gives way to the row's new state, so what is shown ticked is what is sent; a row ticked while it reads
 * "อาจซ้ำ" is sent through it.
 */
export function rowPick(st: SendState, mine?: { on: boolean; st: SendState }): { on: boolean; force: boolean } {
  const on = mine && mine.st === st ? mine.on : st !== 'dup';
  return { on, force: on && st === 'dup' };
}

// ------------------------------------------------------------------ the table's "อาจซ้ำ"

/** A row's company as the table compares it: the registry company (`canon`: its canonical id), else the
 *  name (a company from the TGO website sync, a customer typed in); '' for a placeholder name ("ลูกค้าใหม่",
 *  "(ไม่มีชื่อ)": never one company, lib/sales.ts placeholderName). */
export function jobCoKey(d: Pick<Deal, 'gid' | 'client'>, canon: (gid: number) => number = (g) => g): string {
  if (d.gid != null) return 'g' + canon(d.gid);
  return placeholderName(d.client) ? '' : 'n' + norm(d.client);
}
/** Each row's quotation numbers (empty numbers left out) and whether it has a quotation at all. */
function quotesOf(s: SalesState, id: string): { any: boolean; nos: Set<string> } {
  const qs = docsOf(s, id).filter((x) => x.kind === 'quotation');
  return { any: qs.length > 0, nos: new Set(qs.map((x) => docNoKey(x.docNo)).filter(Boolean)) };
}
/** Two rows told apart by their papers: each has its own quotation and no quotation number is on both. */
function ownQuotes(a: { any: boolean; nos: Set<string> }, b: { any: boolean; nos: Set<string> }) {
  if (!a.any || !b.any) return false;
  for (const n of a.nos) if (b.nos.has(n)) return false;
  return true;
}
/**
 * The rows of `deals` that may be one job entered twice (the table's soft "อาจซ้ำ"): plain rows (not a joint
 * quotation's header or member: those are rows of their own on purpose) of one company (jobCoKey) in one year
 * whose services maySame, unless each has its own quotation and they share no quotation number. Each such row
 * maps to the other rows it may repeat. A row next to a row without a service is not tagged (its "ยังไม่ระบุ
 * บริการ" asks for one), unless neither has one.
 */
export function dupRows(s: SalesState, deals: readonly Deal[], canon?: (gid: number) => number): Map<string, Deal[]> {
  const groups = new Map<string, Deal[]>();
  for (const d of deals) {
    if (jointRole(s, d) !== 'plain') continue;
    const k = jobCoKey(d, canon);
    if (!k) continue;
    const g = groups.get(d.year + '|' + k);
    if (g) g.push(d);
    else groups.set(d.year + '|' + k, [d]);
  }
  const out = new Map<string, Deal[]>();
  const q = new Map<string, ReturnType<typeof quotesOf>>();
  const qOf = (id: string) => q.get(id) || (q.set(id, quotesOf(s, id)), q.get(id)!);
  const put = (a: Deal, b: Deal) => {
    const l = out.get(a.id);
    if (l) l.push(b);
    else out.set(a.id, [b]);
  };
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        if (!maySame(a.service, b.service) || ownQuotes(qOf(a.id), qOf(b.id))) continue;
        put(a, b);
        put(b, a);
      }
  }
  return out;
}
/** The tag's tooltip: "มีงาน CFO ของบริษัทนี้ปี 2569 อีกแถว ถ้าเป็นงานเดียวกันให้ลบแถวที่เกิน ถ้าเป็นคนละงาน
 *  ป้ายจะหายเมื่อแต่ละแถวแนบใบเสนอราคาของตัวเอง". */
export function dupTitle(d: Pick<Deal, 'service' | 'year'>, others: readonly Pick<Deal, 'service'>[]): string {
  const common = svcClean(others.flatMap((o) => svcCommon(d.service, o.service)));
  const what = common.length ? `มีงาน ${common.join(', ')} ของบริษัทนี้ปี ${d.year}` : `มีงานของบริษัทนี้ปี ${d.year} ที่ยังไม่ระบุบริการ`;
  return `${what} อีก${others.length > 1 ? ` ${others.length} ` : ''}แถว ถ้าเป็นงานเดียวกันให้ลบแถวที่เกิน ถ้าเป็นคนละงาน ป้ายจะหายเมื่อแต่ละแถวแนบใบเสนอราคาของตัวเอง`;
}

// ------------------------------------------------------------------ the company's other jobs

/** The other jobs of `d`'s company in its year (`all`: the company's jobs, from engine.dealsOf), a joint
 *  quotation's header left out, open ones first. */
export function otherJobs(s: SalesState, d: Deal, all: readonly Deal[]): Deal[] {
  return all
    .filter((x) => x.id !== d.id && x.year === d.year && jointRole(s, x) !== 'header')
    .sort((a, b) => (a.jobStatus === 'open' ? 0 : 1) - (b.jobStatus === 'open' ? 0 : 1) || (a.at || '').localeCompare(b.at || ''));
}
/** The panel's บริการ popover when the services picked are also on `n` other rows of the company that year
 *  (`common`: those services). */
export const repeatWords = (common: readonly string[], n: number, year: string) =>
  n > 1
    ? `งาน ${common.join(', ')} อีก ${n} แถวของบริษัทนี้ปี ${year} อาจเป็นงานเดียวกัน แถวเหล่านั้นและแถวนี้จะขึ้นว่า “อาจซ้ำ” จนกว่าแต่ละแถวจะแนบใบเสนอราคาของตัวเอง`
    : `งาน ${common.join(', ')} อีกแถวของบริษัทนี้ปี ${year} อาจเป็นงานเดียวกัน ทั้งสองแถวจะขึ้นว่า “อาจซ้ำ” จนกว่าแต่ละแถวจะแนบใบเสนอราคาของตัวเอง`;
/** The popover's line on the company's `n` other jobs that year (`svc`: their services). */
export const otherWords = (svc: readonly string[], n: number, year: string) =>
  n > 1
    ? `บริษัทนี้มีงานอื่นปี ${year} อีก ${n} งาน (${svc.join(', ')}) ถ้าเลือกบริการเดียวกับงานใด แถวนั้นและแถวนี้จะขึ้นว่า “อาจซ้ำ”`
    : `บริษัทนี้มีงาน ${svc.join(', ')} ปี ${year} อีกงาน ถ้าเลือกบริการเดียวกันที่นี่ ทั้งสองแถวจะขึ้นว่า “อาจซ้ำ”`;
/** Would `svc` on `d` repeat another job of its company in the year (the panel's บริการ editor warns)? The
 *  jobs whose services `svc` shares. */
export const repeats = (s: SalesState, svc: readonly string[], others: readonly Deal[]) => others.filter((o) => svcShare(svc, jobServices(s, o)));

// ------------------------------------------------------------------ counting companies

/**
 * How many companies a list of rows holds (the Dashboard's ลูกค้า card): a joint quotation's header is not a
 * customer; a company with two jobs counts once (`key`: its registry company, else its name; a row without a link
 * merges with a linked row of the same name, and `alias` gives a linked row's other names, as lib/sales.ts
 * workTally counts the companies we worked for). A row with a placeholder name ("ลูกค้าใหม่", "(ไม่มีชื่อ)") and
 * no link is a company of its own.
 */
export function companyCount(s: SalesState, deals: readonly Deal[], o: { key?: (d: Deal) => string; alias?: (d: Deal) => string[] } = {}): number {
  const key0 = o.key || ((d: Deal) => (d.gid != null ? 'g' + d.gid : 'n' + norm(d.client)));
  const key = (d: Deal) => (d.gid == null && !jobCoKey(d) ? 'd' + d.id : key0(d));
  const rows = deals.filter((d) => jointRole(s, d) !== 'header');
  const alias = new Map<string, string>();
  for (const d of rows) {
    if (d.gid == null) continue;
    const k = key(d);
    ['n' + norm(d.client), ...(o.alias ? o.alias(d) : [])].forEach((a) => a.length > 1 && !alias.has(a) && alias.set(a, k));
  }
  return new Set(rows.map((d) => alias.get(key(d)) || key(d))).size;
}
/**
 * How many rows of the year each row's company has in `deals` (plain rows: a joint quotation's header and members
 * are rows of their own), by the table's company key: the table names a row's services, or that it has none
 * ("ยังไม่ระบุบริการ"), where the company has another row to tell it from.
 */
export function rowsPerCo(s: SalesState, deals: readonly Deal[], canon?: (gid: number) => number): Map<string, number> {
  const n = new Map<string, number>(), of = new Map<string, string>();
  for (const d of deals) {
    if (jointRole(s, d) !== 'plain') continue;
    const k = jobCoKey(d, canon);
    if (!k) continue;
    const g = d.year + '|' + k;
    of.set(d.id, g);
    n.set(g, (n.get(g) || 0) + 1);
  }
  return new Map([...of].map(([id, g]) => [id, n.get(g) || 1]));
}
