import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build, fixName, norm, phones, status } from './core';
import { GccEngine } from './engine';
import { EMPTY_FILTERS, filterAll } from './search';
import type { Company, Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

function realDataset(): Dataset {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  return { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' };
}

function engineWith(ref: string) {
  const e = new GccEngine();
  e.base = realDataset();
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = ref;
  e.rebuild();
  return e;
}

const co = (p: Partial<Company>): Company => ({ cfoN: 0, src: 0, cfoEx: '', giNow: null, giUntil: '', newYm: '', invest: null, phone: '', ...p }) as Company;
const T = Date.parse('2026-10-06');

describe('name helpers', () => {
  it('removes the doubled "บริษัท" prefix from TGO names', () => {
    expect(fixName('บริษัท บริษัท เอ บี ซี จำกัด')).toBe('บริษัท เอ บี ซี จำกัด');
  });
  it('normalises legal forms and branch notes for duplicate matching', () => {
    expect(norm('บริษัท เอบีซี จำกัด (มหาชน) (สำนักงานใหญ่)')).toBe(norm('บมจ. เอบีซี'));
  });
  it('keys phones on the first 9 digits and drops short numbers', () => {
    expect(phones('02-123-4567 | 1234')).toEqual(['021234567']);
  });
});

describe('status / target group', () => {
  it('marks a certificate expiring within the window as soon (group 1)', () => {
    const c = status(co({ cfoN: 1, src: 1, cfoEx: '2026-11-01' }), T, 90);
    expect(c.cfoSt).toBe('soon');
    expect(c.tgt).toBe(0);
  });
  it('splits expired certificates at 365 days (groups 2 and 3)', () => {
    expect(status(co({ cfoN: 1, cfoEx: '2026-01-01' }), T, 90).tgt).toBe(1);
    expect(status(co({ cfoN: 1, cfoEx: '2024-01-01' }), T, 90).tgt).toBe(2);
  });
  it('ranks companies without CFO: SET → GI 3–5 → new factory ≥ 5M → GI 2 → other', () => {
    expect(status(co({ src: 8 }), T, 90).tgt).toBe(4);
    expect(status(co({ giNow: 4 }), T, 90).tgt).toBe(5);
    expect(status(co({ newYm: '2567-03', invest: 6e6 }), T, 90).tgt).toBe(6);
    expect(status(co({ giNow: 2 }), T, 90).tgt).toBe(7);
    expect(status(co({}), T, 90).tgt).toBe(8);
  });
  it('treats an expired GI (level ≥ 2) as not live', () => {
    const c = status(co({ giNow: 3, giUntil: '2026-01-01' }), T, 90);
    expect(c.giLive).toBeNull();
  });
});

describe('dedup build on the real dataset', () => {
  const base = realDataset();
  const B = build(base, {});
  it('auto-merges same-name groups with a single juristic id', () => {
    expect(B.companies.length).toBeLessThan(base.rows.length);
    expect(B.groups.filter((g) => g.why === 'auto').every((g) => g.state === 'merged')).toBe(true);
    expect(B.groups.some((g) => g.state === 'pending')).toBe(true);
  });
  it('splitting an auto group restores the separate rows', () => {
    const g = B.groups.find((x) => x.why === 'auto')!;
    const B2 = build(base, { [g.key]: 'split' });
    expect(B2.companies.length).toBe(B.companies.length + g.ids.length - 1);
  });
  it('single-row companies share the raw row, so later edits show in the dedup view (as in the prototype)', () => {
    const c = B.companies.find((x) => x.ids.length === 1)!;
    expect(B.rawById.get(c.id)).toBe(c);
  });
  it('merging a pending group reduces the company count', () => {
    const g = B.groups.find((x) => x.why === 'nojur')!;
    const B2 = build(base, { [g.key]: 'merge' });
    expect(B2.companies.length).toBe(B.companies.length - (g.ids.length - 1));
    expect(new Set(g.ids.map((i) => B2.alias.get(i))).size).toBe(1);
  });
});

describe('engine', () => {
  const e = engineWith('2026-10-06');

  it('assigns the renewal round announced on/before expiry while it is still open', () => {
    const r = e.roundOf('2027-01-10', e.T)!;
    expect(r.key).toBe('6/2569'); // announced 23 Dec 2026, docs due 20 Nov 2026
    expect(r.lapse).toBe(0);
  });
  it('moves to the next open round with a lapse when the ideal one has closed', () => {
    const r = e.roundOf('2026-10-25', e.T)!; // ideal 5/2569 (docs closed 28 Sep)
    expect(r.ideal).toBe('5/2569');
    expect(r.key).toBe('6/2569');
    expect(r.lapse).toBeGreaterThan(0);
  });
  it('flags certificates whose expiry is < 300 days after approval', () => {
    expect(e.B.certs.some((c) => c.bad)).toBe(true);
    expect(e.B.certs.filter((c) => c.bad).every((c) => (Date.parse(c.ex) - Date.parse(c.ap)) / 864e5 < 300)).toBe(true);
  });
  it('filters companies by target group and counts per group ignoring that filter', () => {
    const all = filterAll(e, EMPTY_FILTERS);
    const g0 = filterAll(e, { ...EMPTY_FILTERS, tgt: '0' });
    expect(all.out.length).toBe(e.B.companies.length);
    expect(g0.tc).toEqual(all.tc);
    expect(g0.out.length).toBe(all.tc[0]);
    expect((g0.out as Company[]).every((c) => c.cfoSt === 'soon')).toBe(true);
  });
  it('certificate view applies company filters to the owner', () => {
    const r = filterAll(e, { ...EMPTY_FILTERS, view: 'cert', cfo: 'expired', sort: 'ap' });
    expect(r.out.length).toBeGreaterThan(0);
  });
  it('search matches every word against the haystack', () => {
    const c = e.B.companies.find((x) => x.set)!;
    const r = filterAll(e, { ...EMPTY_FILTERS, q: c.set.toLowerCase() });
    expect((r.out as Company[]).some((x) => x.id === c.id)).toBe(true);
  });
  it('changing the soon window recalculates statuses', () => {
    const n90 = e.B.companies.filter((c) => c.cfoSt === 'soon').length;
    e.setRef(null, 180);
    const n180 = e.B.companies.filter((c) => c.cfoSt === 'soon').length;
    expect(n180).toBeGreaterThan(n90);
    e.setRef(null, 90);
  });
  it('spreads bulk tasks over working days only', () => {
    const ids = e.B.companies.slice(0, 7).map((c) => c.id);
    e.addTasks(ids, { type: 'call', date: '2026-10-09', time: '', note: '' }, 3); // Fri
    const dates = e.crm.tasks.slice(-7).map((t) => t.date);
    expect(dates).toEqual(['2026-10-09', '2026-10-09', '2026-10-09', '2026-10-12', '2026-10-12', '2026-10-12', '2026-10-13']);
  });
});
