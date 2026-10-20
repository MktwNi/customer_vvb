/**
 * Batch 6 across its features, on the real dataset: what the search page's bar does to many companies at once
 * (lib/bulk.ts, engine.setWatchMany / addDealsFromCompanies / addTasks) shows at once, with one emit, in
 * บริษัทที่ติดตาม on the ติดตาม page (lib/follow.ts followRows) and in แผนติดต่อ's "รายชื่อที่ต้องติดต่อ"
 * (lib/planList.ts planRows, built as tabs/Plan.tsx builds it) with each row's service types (lib/svcType.ts:
 * ยังไม่ระบุประเภท for a company only followed). A follow made on a row since merged into a company is that
 * company's for the bar too. Each feature's own rules are in its own tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GccEngine } from './engine';
import { followIdsOf, followRows } from './follow';
import { openJob, planRows, rowsOf, srcCounts, type PlanSrc } from './planList';
import { custTypes, typesOf } from './svcType';
import { custKey, dealKey } from './custColor';
import { TRACKER_MAX, followSplit, followedBatch, followedLeftWord, unfollowNote, confirmWords } from './bulk';
import { HELP_TOPICS, searchHelp } from './helpContent';
import { memoryStore } from './storage';
import type { Company, Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-12';
const YEAR = '2569';

function engine() {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = TODAY;
  e.store = memoryStore();
  e.rebuild();
  e.loading = false;
  return e;
}

/** แผนติดต่อ's list and each row's service types, as tabs/Plan.tsx reads them from the engine. */
function planOf(e: GccEngine, src: PlanSrc = 'all') {
  const C = e.crm;
  const rows = planRows<Company>({ company: (id) => e.company(id), watch: C.watch, tasks: C.tasks, owners: C.owners, stages: C.stages, sales: e.sales, year: YEAR, today: TODAY });
  const types = custTypes(e.sales, (d) => dealKey(e, d), YEAR, (d) => openJob(e.sales, d, YEAR, TODAY));
  const typesOfRow = (r: (typeof rows)[number]) => typesOf(types, r.c ? custKey(e, r.c.id, r.c.name) : r.jobs[0] ? dealKey(e, r.jobs[0].deal) : '').types;
  return { rows: rowsOf(rows, src), counts: srcCounts(rows), typesOfRow };
}

describe('the search page bar feeds บริษัทที่ติดตาม and แผนติดต่อ at once', () => {
  const e = engine();
  // companies of the register that nobody follows, with no job: a "CFO ใกล้หมดอายุ" list from ติดตาม's registry card
  const picked = e.feedItems('cfoSoon').filter((c) => !e.crm.watch.includes(c.id)).slice(0, 6).map((c) => c.id);

  it('เลือกทั้งหมด → ติดตาม: one emit, and both lists have them, typed ยังไม่ระบุประเภท', () => {
    expect(picked.length).toBe(6);
    expect(planOf(e).rows).toEqual([]);
    const v0 = e.getVersion();
    const r = e.setWatchMany(picked, true);
    expect(r).toEqual({ changed: 6, same: 0, local: 0 });
    expect(e.getVersion()).toBe(v0 + 1);
    // ติดตาม: บริษัทที่ติดตาม, first on the page
    expect(followRows(e, YEAR, TODAY).map((x) => x.c.id).sort()).toEqual([...picked].sort());
    // แผนติดต่อ: ทั้งหมดที่ต้องติดต่อ and ที่ติดตาม, each a followed row with no job
    const p = planOf(e);
    expect(p.rows.map((x) => x.c!.id).sort()).toEqual([...picked].sort());
    expect(p.counts).toEqual({ all: 6, watch: 6, sales: 0 });
    expect(p.rows.every((x) => x.watch && !x.jobs.length)).toBe(true);
    expect(p.rows.every((x) => p.typesOfRow(x).join() === 'none')).toBe(true);
    // the ค้นหา filter "ติดตาม" reads the same flag
    expect(picked.every((id) => e.company(id)!.fl.watch)).toBe(true);
    // pressed again: nothing changes, nothing is emitted
    const v1 = e.getVersion();
    expect(e.setWatchMany(picked, true)).toEqual({ changed: 0, same: 6, local: 0 });
    expect(e.getVersion()).toBe(v1);
  });

  it('ส่งเข้า Sales Tracker: the rows are open jobs in the list at once, typed by their Services', () => {
    const [a, b] = picked;
    const v0 = e.getVersion();
    const r = e.addDealsFromCompanies([a, b], { year: YEAR });
    expect(r.added).toBe(2);
    expect(e.getVersion()).toBe(v0 + 1);
    let p = planOf(e, 'sales');
    expect(p.rows.map((x) => x.c!.id).sort()).toEqual([a, b].sort());
    // followed and in the tracker: one row with both tags
    expect(p.rows.every((x) => x.watch && x.jobs.length === 1)).toBe(true);
    expect(planOf(e).counts).toEqual({ all: 6, watch: 6, sales: 2 });
    // no Services yet: still ยังไม่ระบุประเภท; a job's Services name its type
    expect(p.rows.every((x) => p.typesOfRow(x).join() === 'none')).toBe(true);
    e.updateDeal(r.ids[0], { service: ['CFO'] });
    p = planOf(e, 'sales');
    const ra = p.rows.find((x) => x.jobs[0].deal.id === r.ids[0])!;
    expect(p.typesOfRow(ra)).toEqual(['cfo']);
    // บริษัทที่ติดตาม says they are in this year's tracker
    expect(followRows(e, YEAR, TODAY).filter((x) => x.deal).map((x) => x.c.id).sort()).toEqual([a, b].sort());
  });

  it('a company sent but not followed is in แผนติดต่อ, not in บริษัทที่ติดตาม', () => {
    const other = e.feedItems('cfoExp').find((c) => !e.crm.watch.includes(c.id) && !e.dealsOf(c.id).length)!;
    e.addDealsFromCompanies([other.id], { year: YEAR });
    const p = planOf(e);
    const row = p.rows.find((x) => x.c?.id === other.id)!;
    expect(row.watch).toBe(false);
    expect(row.jobs.length).toBe(1);
    expect(followRows(e, YEAR, TODAY).some((x) => x.c.id === other.id)).toBe(false);
  });

  it('วางแผนติดต่อ: the appointments are each row\'s next one at once, and leave "ยังไม่มีนัด"', () => {
    const v0 = e.getVersion();
    const r = e.addTasks(picked, { type: 'call', date: '2026-10-13', time: '', note: '' }, 5);
    expect(r.n).toBe(6);
    expect(e.getVersion()).toBe(v0 + 1);
    const p = planOf(e, 'watch');
    expect(p.rows.every((x) => !!x.task && x.task.date >= '2026-10-13')).toBe(true);
    expect(followRows(e, YEAR, TODAY).every((x) => !!x.task)).toBe(true);
  });

  it('เลิกติดตาม many: off both lists at once (a tracker job keeps its row in แผนติดต่อ)', () => {
    const v0 = e.getVersion();
    expect(e.setWatchMany(picked, false).changed).toBe(6);
    expect(e.getVersion()).toBe(v0 + 1);
    expect(followRows(e, YEAR, TODAY)).toEqual([]);
    const p = planOf(e);
    expect(p.counts.watch).toBe(0);
    // the two sent keep their (open job) row, without the ติดตาม tag
    expect(p.rows.filter((x) => picked.includes(x.c!.id)).length).toBe(2);
  });
});

describe('บริษัทที่ติดตาม over TRACKER_MAX: ส่งเข้า Sales Tracker ทั้งหมด sends them in parts (review: 907 followed, nothing to send)', () => {
  const e = engine();
  it('each press sends the first TRACKER_MAX not in the table, in the list\'s order, until none is left', () => {
    // a registry card's ดูทั้งหมด → เลือกทั้งหมด → ติดตาม (CFO หมดอายุแล้วยังไม่ต่อ)
    const many = e.feedItems('cfoExp').filter((c) => !e.crm.watch.includes(c.id) && !e.dealsOf(c.id).length).slice(0, 650).map((c) => c.id);
    expect(many.length).toBe(650);
    e.setWatchMany(many, true);
    // as tabs/TrackFollow.tsx and the Sales Tracker's เพิ่มลูกค้า menu read them
    const notIn = () => followRows(e, YEAR, TODAY).filter((r) => !r.deal).map((r) => r.c.id);
    expect(notIn().length).toBe(650);
    const added: number[] = [];
    for (let i = 0; i < 5 && notIn().length; i++) {
      const before = notIn();
      const b = followedBatch(before);
      expect(b.ids).toEqual(before.slice(0, b.ids.length));
      // what the send dialog counts before it offers its button (components/AddCustomer.tsx SendToTracker)
      const has = e.trackedIn(YEAR);
      expect(b.ids.filter((id) => !has(e.company(id)!)).length).toBeLessThanOrEqual(TRACKER_MAX);
      added.push(e.addDealsFromCompanies(b.ids, { year: YEAR }).added);
      // the dialog said how many were left: that many still to send, and the table's note says so after
      // the send (components/AddCustomer.tsx counts them the same way), nothing after the last batch
      expect(notIn().length).toBe(b.more);
      expect(followedLeftWord(notIn().length, YEAR)).toBe(b.more ? ` · อีก ${b.more} บริษัทที่ติดตามยังไม่อยู่ในตารางปี ${YEAR} กด “เพิ่มลูกค้า” เพื่อส่งชุดถัดไป` : '');
    }
    expect(added).toEqual([300, 300, 50]);
    expect(notIn()).toEqual([]);
  });
});

describe('help says which rows carry ยังไม่ระบุประเภท (review: a job sent from the bar has no Services yet)', () => {
  it('the bar\'s topic names jobs without Services, those just sent included', () => {
    const tip = HELP_TOPICS.find((t) => t.id === 'search-bulk')!.tips.find((x) => x.includes('ยังไม่ระบุประเภท'))!;
    expect(tip).toContain('งานที่ยังไม่ได้เลือก Services');
    expect(tip).toContain('รวมงานที่เพิ่งส่งจากแถบนี้');
    expect(tip).not.toContain('ติดตามอย่างเดียวและยังไม่มีงาน');
  });
});

describe('the bar and a follow made on a row since merged into another company', () => {
  const e = engine();
  const grp = e.B.groups.find((x) => x.why === 'nojur' && x.ids.length === 2)!;
  e.dec[grp.key] = 'merge';
  e.rebuild();
  const c = e.company(grp.ids[0])!;
  const other = grp.ids.find((i) => i !== c.id)!;
  const canon = (id: number) => e.canonical(id);

  it('counts it as followed (ติดตาม skips it) and เลิกติดตาม removes every id of it', () => {
    e.crm.watch.push(other);
    e.rebuild();
    // the bar's split, as BulkBar reads it
    const watch = new Set(e.crm.watch.map(canon));
    expect(followSplit([c.id], watch)).toEqual({ on: 1, off: 0 });
    expect(e.setWatchMany([c.id], true)).toEqual({ changed: 0, same: 1, local: 0 });
    expect(followIdsOf(e.crm.watch, c.id, canon)).toEqual([other]);
    expect(e.setWatchMany([c.id], false)).toEqual({ changed: 1, same: 0, local: 0 });
    expect(e.crm.watch).toEqual([]);
    expect(e.company(c.id)!.fl.watch).toBe(false);
    expect(followRows(e, YEAR, TODAY)).toEqual([]);
    expect(planOf(e).rows).toEqual([]);
  });
});

describe('the words name the followed list as the ติดตาม page does', () => {
  it('บริษัทที่ติดตาม, in the bar and in help', () => {
    expect(unfollowNote(0, 2)).toContain('บริษัทที่ติดตาม');
    expect(confirmWords('follow', 300, 0, true).body).toContain('บริษัทที่ติดตาม');
    expect(confirmWords('unfollow', 300, 0, false).body).toContain('บริษัทที่ติดตาม');
    const ids = searchHelp('บริษัทที่ติดตาม').topics.map((t) => t.id);
    for (const id of ['track', 'follow-company', 'search-bulk']) expect(ids).toContain(id);
    // the old card name still finds the page's topic
    expect(searchHelp('รายการติดตามของฉัน').topics.map((t) => t.id)).toContain('track');
  });
});
