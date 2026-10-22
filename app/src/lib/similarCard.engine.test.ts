/**
 * The registry-match card of the add-customer dialog, on the registry itself: a company whose jobs are all in another year
 * is left off the card for the year being added (similarFor), and the exact name submitted with the card left off still
 * reuses that company: the hand-added row merges into it (core.ts build: one juristic id, the name normalised), so a job
 * of the year goes to the registry company and no second company of that name shows. A company without a juristic id is
 * not merged that way, so its card stays.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { norm } from './core';
import type { Company, Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-22';
vi.setConfig({ testTimeout: 60000 });
const blank = { jur: '', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' };
const jurOf = (c: Company) => c.jur.replace(/\D/g, '');

let e: GccEngine;
beforeAll(() => {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = TODAY;
  e.store = memoryStore();
  e.rebuild();
  e.loading = false;
});

/** Registry companies one row each, with a name no other company has, and no job or contact yet. */
function unique(jur: boolean): Company[] {
  const n = new Map<string, number>();
  e.B.companies.forEach((c) => n.set(norm(c.name), (n.get(norm(c.name)) || 0) + 1));
  return e.B.companies.filter(
    (c) => c.id < 900000 && c.ids.length === 1 && n.get(norm(c.name)) === 1 && norm(c.name).length >= 6 && (jur ? jurOf(c).length >= 10 : !jurOf(c)) && !e.dealsOf(c.id).length && !e.peopleOf(c.id).length,
  );
}

describe('the registry-match card: a company whose jobs are all in another year', () => {
  it('is left off the card for the year being added, shown for its own year, and shown when no year is given', () => {
    const [r] = unique(true);
    const d = e.addDeal({ gid: r.id, year: '2568' });
    expect(e.dealsOf(r.id).map((x) => x.id)).toContain(d.id);
    expect(e.similarFor(r.name, '', '2569').map((c) => c.id)).not.toContain(r.id);
    expect(e.similarFor(r.name, '', '2568').map((c) => c.id)).toContain(r.id);
    expect(e.similarFor(r.name, '').map((c) => c.id)).toContain(r.id);
    // the card of another company of the year: still offered
    const [o] = unique(true).filter((c) => c.id !== r.id);
    expect(e.similarFor(o.name, '', '2569').map((c) => c.id)).toContain(o.id);
  });

  it('with no job at all, or a juristic id missing, the card stays', () => {
    const [noJob] = unique(true).slice(5);
    expect(e.similarFor(noJob.name, '', '2569').map((c) => c.id)).toContain(noJob.id);
    const [noJur] = unique(false);
    e.addDeal({ gid: noJur.id, year: '2568' });
    expect(e.similarFor(noJur.name, '', '2569').map((c) => c.id)).toContain(noJur.id);
  });

  it('two companies of one name, both with jobs only in another year: both cards stay, the one picked decides', () => {
    const name = 'บริษัท สองชื่อเดียวกัน ทดสอบ จำกัด';
    const x = e.addCustomer({ ...blank, name, jur: '0105500000011' }, {});
    const y = e.addCustomer({ ...blank, name, jur: '0105500000022' }, {});
    e.addDeal({ gid: x, year: '2568' });
    e.addDeal({ gid: y, year: '2568' });
    const shown = e.similarFor(name, '', '2569').map((c) => c.id);
    expect(shown).toContain(e.canonical(x));
    expect(shown).toContain(e.canonical(y));
  });
});

describe('the exact name submitted with the card left off still reuses the company', () => {
  it('a new customer typed with the registry company\'s name is that company: one company of the name, the job of the year on it', () => {
    const [r] = unique(true);
    e.addDeal({ gid: r.id, year: '2568' });
    expect(e.similarFor(r.name, '', '2569').map((c) => c.id)).not.toContain(r.id);
    const before = e.B.companies.filter((c) => norm(c.name) === norm(r.name)).length;
    const id = e.addCustomer({ ...blank, name: r.name });
    expect(e.canonical(id)).toBe(r.id);
    expect(e.company(id)?.id).toBe(r.id);
    expect(e.B.companies.filter((c) => norm(c.name) === norm(r.name)).length).toBe(before);
    const job = e.addDeal({ gid: id, year: '2569' });
    expect(e.dealsOf(r.id).map((x) => x.year).sort()).toEqual(['2568', '2569']);
    expect(e.canonical(e.sales.deals[job.id].gid!)).toBe(r.id);
  });

  it('a company without a juristic id is not merged that way: its card stays (the one way to reuse it)', () => {
    const [r] = unique(false);
    e.addDeal({ gid: r.id, year: '2568' });
    const id = e.addCustomer({ ...blank, name: r.name });
    expect(e.canonical(id)).not.toBe(r.id);
    expect(e.similarFor(r.name, '', '2569').map((c) => c.id)).toContain(r.id);
  });
});
