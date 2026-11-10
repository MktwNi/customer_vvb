/**
 * เสนอบริการ in the engine: the picked companies are followed (so แผนติดต่อ lists them under the heading),
 * each gets one e-mail entry waiting for a reply, a company picked twice counts once, and its plan stage stays
 * as it was. The words and the offer's reading are lib/offer.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GccEngine } from './engine';
import { OFFER_RESULT, OFFER_TEXT, offerOf } from './offer';
import { memoryStore } from './storage';
import type { Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-11-10';

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

describe('เสนอบริการ on the companies picked', () => {
  it('writes one e-mail entry each, follows them, and leaves their plan stage as it was', () => {
    const e = engine();
    const [a, b] = e.B.companies.slice(0, 2).map((c) => c.id);
    expect(e.offerMany([a, b, a])).toBe(2);

    const logA = e.crm.log[e.canonical(a)] || [];
    expect(logA.filter((l) => l.result === OFFER_RESULT)).toHaveLength(1);
    expect(logA.at(-1)).toMatchObject({ type: 'email', result: OFFER_RESULT, text: OFFER_TEXT });
    expect(offerOf(logA)).not.toBeNull();

    expect(e.crm.watch).toEqual(expect.arrayContaining([e.canonical(a), e.canonical(b)]));
    expect(e.stage(e.canonical(a))).toBe('none');
  });

  it('a company whose next contact got through is no longer waiting', () => {
    const e = engine();
    const a = e.B.companies[0].id;
    e.offerMany([a]);
    e.addLog(e.canonical(a), 'call', 'ติดต่อได้', 'คุยแล้ว');
    expect(offerOf(e.crm.log[e.canonical(a)])).toBeNull();
  });
});
