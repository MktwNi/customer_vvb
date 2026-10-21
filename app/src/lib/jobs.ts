/**
 * Jobs (งาน) of one company: a company may have several rows in one year of the Sales Tracker, normally one per
 * service (CFO one job, CFP another; a job may carry several services when they are quoted together). A row's
 * services are its `service` list (already on every deal and synced item by item): nothing new is stored.
 *
 * Two rules, both read from the services:
 * - maySame (the table's soft "อาจซ้ำ"): two rows of one company in one year that share a service, or that both
 *   list none, may be one job entered twice. The tag goes once each row has its own quotation and the two share
 *   no quotation number ("a different quotation is a different job": CFP for two products, two T-VER projects).
 * - surelyOther (a send, เพิ่มลูกค้า, an import): a second row is added on its own only when both name services
 *   and share none. A send with no service picked, or a job without one, cannot tell: the row is not ticked
 *   (sendState 'dup'), as the lock it replaces, but it is shown and can be ticked.
 *
 * A joint quotation's member is sold under its header's services (lib/sales.ts jobServices); a header is the
 * payer's row for that quotation, not a job of the company's own, and is never compared.
 * Pure functions only (no engine, no DOM).
 */
import { norm } from './core';
import { docNoKey, docsOf, jobServices, jointRole, type Deal, type SalesState } from './sales';

export const SVC_LABEL = 'บริการ';
/** หมวด as the forms name it: the group of rows in the table, by the channel the customer came from (SOURCE
 *  follows it: lib/sales.ts matchSource). */
export const SECTION_LABEL = 'หมวด (ช่องทางที่ได้ลูกค้า)';
export const NO_SVC = 'ยังไม่ระบุบริการ';

/** A service as it is compared: case, outer and doubled spaces do not count ("t-ver", " CFO "). */
export const svcKey = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
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
/** A job's name where two jobs of one company must be told apart (toasts, the bell, aria labels, pickers):
 *  "ทองมงคล · CFP"; the name alone when it lists no service. */
export const withSvc = (name: string, svc: readonly string[]) => (named(svc) ? `${name} · ${svcText(svc)}` : name);

// ------------------------------------------------------------------ sending a company to the tracker

/** A row of the send dialog, for a company with these jobs in the year (`jobs`: each job's services) when
 *  `picked` are sent: '' it has no job (sent as today); 'new' every job is surely other work (ticked: "เพิ่ม
 *  เป็นงานใหม่"); 'dup' one may be the same work, or nothing tells (not ticked: "อาจซ้ำ"). */
export type SendState = '' | 'new' | 'dup';
export function sendState(picked: readonly string[], jobs: readonly (readonly string[])[]): SendState {
  if (!jobs.length) return '';
  return jobs.every((j) => surelyOther(picked, j)) ? 'new' : 'dup';
}
/** The jobs a send of `picked` may repeat (not surely other work), in the order given. */
export const clashing = (s: SalesState, picked: readonly string[], jobs: readonly Deal[]) => jobs.filter((d) => !surelyOther(picked, jobServices(s, d)));
/**
 * What a row of the send dialog shows and whether it is ticked: the state from the services picked, and the
 * person's own choice when they made one (`mine`: kept when the services change). `force`: ticked through
 * while it reads "อาจซ้ำ" (the engine adds it anyway); a row ticked while it read "เพิ่มเป็นงานใหม่" that has
 * since become a possible repeat (a teammate's send arrived) is not forced: the engine re-checks it and says so.
 */
export function rowPick(st: SendState, mine?: { on: boolean; st: SendState }): { on: boolean; force: boolean } {
  const on = mine ? mine.on : st !== 'dup';
  return { on, force: on && st === 'dup' && !!mine && mine.st === 'dup' };
}

// ------------------------------------------------------------------ the table's "อาจซ้ำ"

/** Names a row gets before anyone types one (เพิ่มในหมวดนี้, an import without a name): never one company. */
const PLACEHOLDER = new Set(['ลูกค้าใหม่', 'ลูกค้า', '(ไม่มีชื่อ)'].map(norm));
/** A row's company as the table compares it: the registry company (`canon`: its canonical id), else the
 *  name (a company from the TGO website sync, a customer typed in); '' for a placeholder name. */
export function jobCoKey(d: Pick<Deal, 'gid' | 'client'>, canon: (gid: number) => number = (g) => g): string {
  if (d.gid != null) return 'g' + canon(d.gid);
  const k = norm(d.client);
  return k && !PLACEHOLDER.has(k) ? 'n' + k : '';
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
/** Would `svc` on `d` repeat another job of its company in the year (the panel's บริการ editor warns)? The
 *  jobs whose services `svc` shares. */
export const repeats = (s: SalesState, svc: readonly string[], others: readonly Deal[]) => others.filter((o) => svcShare(svc, jobServices(s, o)));

// ------------------------------------------------------------------ counting companies

/**
 * How many companies a list of rows holds (the Dashboard's ลูกค้า card says it when it differs from the rows,
 * "· 25 บริษัท"): a joint quotation's header is not a customer; a company with two jobs counts once (`key`:
 * its registry company, else its name; a row without a link merges with a linked row of the same name, and
 * `alias` gives a linked row's other names, as lib/sales.ts workTally counts the companies we worked for).
 */
export function companyCount(s: SalesState, deals: readonly Deal[], o: { key?: (d: Deal) => string; alias?: (d: Deal) => string[] } = {}): number {
  const key = o.key || ((d: Deal) => (d.gid != null ? 'g' + d.gid : 'n' + norm(d.client)));
  const rows = deals.filter((d) => jointRole(s, d) !== 'header');
  const alias = new Map<string, string>();
  for (const d of rows) {
    if (d.gid == null) continue;
    const k = key(d);
    ['n' + norm(d.client), ...(o.alias ? o.alias(d) : [])].forEach((a) => a.length > 1 && !alias.has(a) && alias.set(a, k));
  }
  return new Set(rows.map((d) => alias.get(key(d)) || key(d))).size;
}
