/**
 * A follow made on a row that has since been merged into another company (two duplicate rows decided as
 * one): the engine's flag (the ค้นหา filter "ติดตาม", the counts, แผนติดต่อ), the drawer's button and
 * บริษัทที่ติดตาม all count it as that company's, and unfollowing removes every id of it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GccEngine } from './engine';
import { followIdsOf, followRows } from './follow';
import { memoryStore } from './storage';
import type { Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-12';

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

describe('following a row since merged into another company', () => {
  const e = engine();
  // a pending duplicate pair, then merged: the follow was made on the row that is no longer the company's id
  const grp = e.B.groups.find((x) => x.why === 'nojur' && x.ids.length === 2)!;
  e.dec[grp.key] = 'merge';
  e.rebuild();
  const c = e.company(grp.ids[0])!;
  const other = grp.ids.find((i) => i !== c.id)!;
  const canon = (id: number) => e.canonical(id);

  it('counts as following the company everywhere', () => {
    expect(c.ids).toContain(other);
    e.crm.watch.push(other);
    e.rebuild();
    expect(e.company(c.id)!.fl.watch).toBe(true);
    expect(e.feedItems('watch').map((x) => x.id)).toEqual([c.id]);
    expect(followIdsOf(e.crm.watch, c.id, canon)).toEqual([other]);
    // the list and the engine agree on how many
    expect(followRows(e, '2569', TODAY).map((r) => r.c.id)).toEqual([c.id]);
  });

  it('following it again from the drawer and then unfollowing leaves nothing behind', () => {
    // (the drawer shows it followed already; following its own id too is what an older build could do)
    e.toggleWatch(c.id);
    expect(followIdsOf(e.crm.watch, c.id, canon).sort()).toEqual([c.id, other].sort());
    // unfollow: every id of it
    followIdsOf(e.crm.watch, c.id, canon).forEach((id) => e.toggleWatch(id));
    expect(e.crm.watch).toEqual([]);
    expect(e.company(c.id)!.fl.watch).toBe(false);
    expect(e.feedItems('watch')).toEqual([]);
    expect(followRows(e, '2569', TODAY)).toEqual([]);
  });

  it('the flag follows each id taken off, not only the company id', () => {
    e.toggleWatch(other);
    expect(e.company(c.id)!.fl.watch).toBe(true);
    e.toggleWatch(c.id);
    // one of two ids taken off: still followed
    e.toggleWatch(other);
    expect(e.company(c.id)!.fl.watch).toBe(true);
    e.toggleWatch(c.id);
    expect(e.company(c.id)!.fl.watch).toBe(false);
  });
});
