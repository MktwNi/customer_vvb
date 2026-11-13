/**
 * Sending companies to the Sales Tracker moves them from ติดตาม to การบริการ: a followed company sent is no longer
 * followed (in the same batch as the rows), a company that was never followed stays unfollowed, and เลิกทำ after
 * the send puts back the follows the send took off, and only those.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import type { Dataset, RoundRaw } from './types';

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

describe('sending to the Sales Tracker takes the follow off', () => {
  it('a followed company sent is no longer followed; one never followed stays unfollowed; the rows are made', () => {
    const e = engine();
    const free = e.feedItems('cfoSoon').filter((c) => !e.crm.watch.includes(c.id) && !e.dealsOf(c.id).length).slice(0, 3).map((c) => c.id);
    const [f1, f2, n1] = free;
    e.setWatchMany([f1, f2], true);
    expect(e.crm.watch).toEqual(expect.arrayContaining([f1, f2]));

    const r = e.addDealsFromCompanies([f1, f2, n1], { year: YEAR });
    expect(r).toMatchObject({ added: 3, skipped: 0, unfollowed: 2 });
    expect(e.crm.watch).not.toContain(f1);
    expect(e.crm.watch).not.toContain(f2);
    expect(e.crm.watch).not.toContain(n1);
    expect(e.dealsOf(f1).length).toBe(1);
    expect(e.dealsOf(n1).length).toBe(1);
  });

  it('เลิกทำ after the send: the rows go, and the follows the send took off come back, only those', () => {
    const e = engine();
    const free = e.feedItems('cfoSoon').filter((c) => !e.crm.watch.includes(c.id) && !e.dealsOf(c.id).length).slice(0, 3).map((c) => c.id);
    const [f1, n1] = free;
    e.setWatchMany([f1], true);

    const r = e.addDealsFromCompanies([f1, n1], { year: YEAR });
    expect(r.unfollowed).toBe(1);
    expect(e.crm.watch).not.toContain(f1);

    expect(e.undoSent(r.k)).toMatchObject({ removed: 2, kept: 0 });
    expect(e.crm.watch).toContain(f1);
    expect(e.crm.watch).not.toContain(n1);
  });
});
