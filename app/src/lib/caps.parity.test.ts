/**
 * The web app and the team script decide the same (plan.md §1: one catalogue, mirrored as CAPS_ in Code.gs
 * "with a parity test"). The script's own tables and helpers are read and called through the simulator:
 * - CAPS_ / BUILTIN_ROLES ⇄ lib/caps.ts CAPS / BUILTIN (ids, order, groups, labels, real, scope, needs, defaults);
 * - KEY_CAP ⇄ keyRule, and keyAccess_ ⇄ canWriteKey over random capability sets, every prefix, write and delete,
 *   own work or not;
 * - capsOf_ ⇄ resolveCaps over random roles, temporary roles and extras (dates around today);
 * - legacyRole_ ⇄ legacyRole (me.role for builds before capabilities);
 * - the quotation check: toDoc_ + fpOf_ ⇄ toDoc + fpOf, fpSame_ ⇄ sameFp, qtNeeds_ ⇄ needsCheck.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import {
  BUILTIN, BUILTIN_IDS, CAPS, CAP_IDS, KNOWN_PREFIXES, canWriteKey, capsWire, keyRule, legacyRole, parseCaps, resolveCaps, type CapId, type CapSet, type Grants,
} from './caps';
import { fpOf, needsCheck, sameFp, type QtFp } from './notify';
import { toDeal, toDoc, type SalesState } from './sales';

let sim: GasSim;
beforeAll(() => {
  sim = createGasSim({ teamKey: '', kdfIter: 1000 });
});

/** A small seeded generator, so a failure repeats. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  const next = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>> 0) / 4294967296);
  return { next, pick: <T,>(a: readonly T[]) => a[Math.floor(next() * a.length)], chance: (p: number) => next() < p };
}
type Wire = Record<string, 1 | 'own'>;
const SCOPED = CAPS.filter((c) => c.scope).map((c) => c.id);
/** A random capability set as the script stores it (needs not applied: the key table is checked raw). */
function randomCaps(R: ReturnType<typeof rng>, p = 0.35): Wire {
  const w: Wire = {};
  CAP_IDS.forEach((k) => {
    if (R.chance(p)) w[k] = SCOPED.includes(k) && R.chance(0.5) ? 'own' : 1;
  });
  return w;
}
const fromWire = (w: Wire): CapSet => parseCaps(w) || {};

describe('the catalogue: CAPS_ in Code.gs = CAPS in lib/caps.ts', () => {
  it('same ids in the same order, groups, labels, real redaction, scopes and needs', () => {
    const S = sim.consts.CAPS_!;
    expect(S.map((c) => c.id)).toEqual(CAP_IDS);
    S.forEach((c, i) => {
      const w = CAPS[i];
      expect({ id: c.id, g: c.g, th: c.th, real: !!c.real, scope: !!c.scope, needs: c.needs || '' }).toEqual({ id: w.id, g: w.g, th: w.label, real: !!w.real, scope: !!w.scope, needs: w.needs || '' });
    });
  });
  it('the built-in roles: same ids, names, descriptions and default capabilities', () => {
    const B = sim.consts.BUILTIN_ROLES!;
    expect(B.map((b) => b.id)).toEqual(BUILTIN_IDS);
    B.forEach((b, i) => {
      expect({ n: b.n, d: b.d }).toEqual({ n: BUILTIN[b.id as keyof typeof BUILTIN].n, d: BUILTIN[b.id as keyof typeof BUILTIN].d });
      const d: Wire = {};
      sim.consts.CAPS_!.forEach((c) => c.d[i] && (d[c.id] = c.d[i] as 1 | 'own'));
      expect(d).toEqual(capsWire(BUILTIN[b.id as keyof typeof BUILTIN].c));
      // and as the script resolves them for an account of that role
      expect(sim.run('roleCaps_', {}, b.id)).toEqual(capsWire(BUILTIN[b.id as keyof typeof BUILTIN].c));
    });
  });
});

/** A key under each prefix the script knows, plus the ones it must refuse. */
function sampleKeys() {
  const ks = sim.consts.KEY_CAP!.map((r) => (r.p.endsWith('/') ? r.p + 'd1/x' : r.p + 'k1'));
  return [...ks, 'scfg/stages', 'scfg/sources', 'scfg/other.kind', 'scfg/units', 'catalog/x', 'deals/x', 'nokey', 'jdoc/h/d', 'jpay/h/d', 'log/1/a', 'dact/d1/a1'];
}
const OWN: Record<string, string> = { deal: 'resp', resp: 'resp', by: 'by' };

describe('which record needs which capability: KEY_CAP in Code.gs = keyRule in lib/caps.ts', () => {
  it('each prefix: the same capabilities to write and to delete, and the same notion of own work', () => {
    for (const k of sampleKeys())
      for (const del of [false, true]) {
        const r = sim.run<{ p: string; w: string | string[]; d: string | string[]; ow?: string; od?: string } | null>('keyRule_', k);
        const need = r ? (del ? r.d : r.w) : 'set.users';
        const own = r ? (del ? r.od : r.ow) : undefined;
        const c = keyRule(k, del);
        if (need === '') expect(c, k).toBe('never');
        else if (r == null) expect(c, k).toBeNull();
        else {
          expect(c, `${k} ${del ? 'delete' : 'write'}`).toEqual({ caps: Array.isArray(need) ? need : [need], ...(own ? { own: OWN[own] } : {}) });
        }
      }
  });
  it('every prefix the web app lists is in the script\'s table (or is scfg/, decided by the name)', () => {
    const P = sim.consts.KEY_CAP!.map((r) => r.p);
    KNOWN_PREFIXES.filter((p) => p !== 'scfg/').forEach((p) => expect(P, p).toContain(p));
  });
  it('random capability sets × every prefix × write / delete × own or not: the script allows what the web app allows', () => {
    const R = rng(20261015);
    const keys = sampleKeys();
    let checked = 0;
    for (let i = 0; i < 250; i++) {
      const w = randomCaps(R, R.pick([0.1, 0.3, 0.6]));
      const caps = fromWire(w);
      for (const k of keys)
        for (const del of [false, true]) {
          const a = sim.run<0 | 1 | string>('keyAccess_', w, k, del);
          // 1: any record; a rule name: only the account's own; 0: none
          expect(canWriteKey(caps, k, del, true), `${JSON.stringify(w)} ${k} ${del}`).toBe(a !== 0);
          expect(canWriteKey(caps, k, del, false), `${JSON.stringify(w)} ${k} ${del} not own`).toBe(a === 1);
          checked++;
        }
    }
    expect(checked).toBeGreaterThan(10000);
  });
  it('me.role for older builds: legacyRole_ = legacyRole', () => {
    const R = rng(7);
    for (let i = 0; i < 300; i++) {
      const w = randomCaps(R, R.pick([0.02, 0.1, 0.4]));
      expect(sim.run('legacyRole_', w), JSON.stringify(w)).toBe(legacyRole(fromWire(w)));
    }
  });
});

describe('what an account may do: capsOf_ in Code.gs = resolveCaps in lib/caps.ts', () => {
  it('random roles (built-ins edited or not), temporary roles and extras around today', () => {
    const R = rng(4242);
    const today = sim.run<string>('today_');
    const day = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    for (let i = 0; i < 300; i++) {
      // stored roles: some custom ones, maybe an edited sales / viewer (admin is never stored)
      const roles: Record<string, { n: string; c: Wire }> = {};
      const ids = ['r000001', 'r000002', 'r000003'];
      ids.forEach((id) => R.chance(0.7) && (roles[id] = { n: id, c: randomCaps(R) }));
      if (R.chance(0.3)) roles.sales = { n: 'พนักงานขาย', c: randomCaps(R, 0.5) };
      if (R.chance(0.2)) roles.viewer = { n: 'ดูอย่างเดียว', c: randomCaps(R, 0.2) };
      const base = R.pick(['admin', 'sales', 'viewer', ...ids, 'gone']);
      const g: Grants = {};
      if (R.chance(0.4)) g.r = { id: R.pick(['sales', 'viewer', 'admin', ...ids, 'gone']), until: R.chance(0.3) ? '' : day(R.pick([-2, -1, 0, 1, 30])), by: 'หมิว', at: '' };
      if (R.chance(0.6))
        g.c = Array.from({ length: 1 + Math.floor(R.next() * 4) }, () => ({ k: R.pick([...CAP_IDS, 'view.everything']), s: R.pick(['all', 'own'] as const), until: R.chance(0.4) ? undefined : day(R.pick([-1, 0, 1])), by: 'หมิว', at: '' }));
      const A = { u: { x: { n: 'เอก', r: base, on: 1 } }, roles, grants: { x: g } };
      const srv = sim.run<{ rid: string; caps: Wire }>('capsOf_', A, 'x');
      // the web app reads the roles as the admin page gets them (rolesView_ = each role's capabilities)
      const view = sim.run<Record<string, { c: Wire }>>('rolesView_', roles);
      const map = Object.fromEntries(Object.entries(view).map(([id, r]) => [id, fromWire(r.c)]));
      const gc: Grants = { ...(g.r ? { r: { ...g.r, until: g.r.until || undefined } } : {}), ...(g.c ? { c: g.c } : {}) };
      expect(resolveCaps(base, map, gc, today), JSON.stringify({ base, g, roles })).toEqual(fromWire(srv.caps));
    }
  });
});

describe('the quotation check: the same fingerprint and the same rule on both sides', () => {
  it('a record read the way each side reads it gives the same fingerprint; the same comparison; the same "needs a check"', () => {
    const R = rng(99);
    const since = '2026-10-05';
    const STAGES = ['QUOTATION', 'QUOTATION', 'PAY1', 'CALL1'];
    for (let i = 0; i < 400; i++) {
      // the times are in the same day in UTC and in Bangkok (02:00–16:00 UTC), as both read the day
      const at = `2026-10-${String(1 + Math.floor(R.next() * 14)).padStart(2, '0')}T${String(2 + Math.floor(R.next() * 14)).padStart(2, '0')}:15:00.000Z`;
      const v: Record<string, unknown> = {
        kind: R.pick(['quotation', 'quotation', 'invoice', 'receipt', 'bogus']), name: R.pick(['QT-1.pdf', 'ใบเสนอราคา.pdf', '', 12]), size: R.pick([1234, '1234', 0, null]),
        docNo: R.pick(['QT-2569-021', '', ' QT-9 ', 7]), docDate: R.pick(['2026-10-12', '', '2026-10-12T00:00:00Z', 'bad']),
        amount: R.pick([101650, '95000', null, 0, 'x', 101650.004]), target: R.pick(['forecast', 'forecast', 'none', 'actual']), stage: R.pick(STAGES),
        at, ...(R.chance(0.5) ? { cAt: at } : {}), by: 'เอก', fileId: R.pick(['F1', '', 'bad id!']),
      };
      const dv = { client: 'บริษัท ก จำกัด', resp: 'เอก', jobStatus: R.pick(['open', 'open', 'closed']) };
      const cdoc = toDoc(v, 'd1', 'q' + i)!;
      const sdoc = sim.run<Record<string, unknown>>('toDoc_', v, 'd1', 'q' + i);
      const sfp = sim.run<QtFp>('fpOf_', sdoc);
      expect(sfp, JSON.stringify(v)).toEqual(fpOf(cdoc));
      // a fingerprint from another random record: compared the same way
      const other = fpOf(toDoc({ ...v, amount: R.pick([v.amount, 101650, null, '101650.001']), docNo: R.pick([v.docNo, 'QT-X']) }, 'd1', 'z')!);
      expect(sim.run('fpSame_', sfp, other), JSON.stringify([sfp, other])).toBe(sameFp(fpOf(cdoc), other));
      // the rule: a quotation for the Forecast with an amount, at QUOTATION, on an open deal, from `since`
      const S = { deals: { d1: toDeal(dv, 'd1') } } as unknown as SalesState;
      expect(sim.run('qtNeeds_', sdoc, sim.run('toDeal_', dv, 'd1'), since), JSON.stringify(v)).toBe(needsCheck(S, cdoc, since));
    }
  });
});

it('the parity covers every capability and every prefix (nothing in one table only)', () => {
  const ids: CapId[] = CAP_IDS;
  expect(new Set(sim.consts.CAPS_!.map((c) => c.id))).toEqual(new Set(ids));
  expect(KNOWN_PREFIXES.length).toBeGreaterThan(20);
});
