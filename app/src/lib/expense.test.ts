/** Job expenses in the browser (lib/expense.ts and the sync records in lib/teamSync.ts), without the script. */
import { describe, expect, it } from 'vitest';
import { EXP_CAT_MAX, EXP_NOTE_MAX, expDocId, expensesOf, purgeExpenses, toExpense } from './expense';
import { applyRow, keyOf, localRecords, noEffects, rebaseOp, type SharedState, type SyncRow } from './teamSync';
import { emptySales, type SalesState } from './sales';
import type { Crm } from './types';

const row = (k: string, v: unknown, seq = 1): SyncRow => ({ seq, k, v, del: v == null, by: 'ฝน', at: '2026-10-19T03:00:00.000Z' });
const emptyCrm = (): Crm => ({ stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} });
const shared = (): SharedState => ({ crm: emptyCrm(), contacts: {}, dec: {}, sales: emptySales(), custom: {}, people: {} });
const E1 = { c: 'ค่าเดินทาง', n: 'ไปตรวจโรงงาน', amt: 3500, d: '2026-10-05', by: 'เอก', at: '2026-10-19T03:00:00.000Z' };

describe('an expense record (dexp/<dealId>/<expId>)', () => {
  it('reads what the contract says, and skips what cannot be one', () => {
    const file = { id: '1AbC_d-9', name: 'บิล.pdf', mime: 'application/pdf', size: 1234 };
    expect(toExpense({ ...E1, paid: '2026-10-06', file })).toEqual({ ...E1, paid: '2026-10-06', file });
    // the amount is what an expense is: none, or not a number, is not one
    for (const v of [null, 'x', [], { ...E1, amt: undefined }, { ...E1, amt: 'abc' }, { ...E1, amt: null }]) expect(toExpense(v)).toBeNull();
    expect(toExpense({ ...E1, amt: '3500.50' })!.amt).toBe(3500.5);
    // fields that are not what they should be are left out (a hand-edited sheet must not break the screen)
    const odd = toExpense({ amt: 10, c: 'ก'.repeat(60), n: 'ข'.repeat(300), d: '2026-02-30', paid: 'yesterday', file: { id: 'bad id!', name: 'x' }, by: 7, at: null });
    expect(odd).toEqual({ c: 'ก'.repeat(EXP_CAT_MAX), n: 'ข'.repeat(EXP_NOTE_MAX), amt: 10, d: '', by: '', at: '' });
    // the category is free text: spaces tidied, nothing else (no fixed list)
    expect(toExpense({ ...E1, c: '  ผู้รับเหมา   ภายนอก ' })!.c).toBe('ผู้รับเหมา ภายนอก');
    expect(toExpense({ ...E1, n: '   ' })).not.toHaveProperty('n');
    expect(expDocId('e1')).toBe('exp_e1');
  });

  it('expensesOf: a deal\'s expenses by the bill\'s date (undated last), then when written; no other deal\'s', () => {
    const S: Pick<SalesState, 'exp'> = {
      exp: {
        'd1/a': { ...E1, d: '2026-10-05', at: '2026-10-19T03:00:00.000Z' },
        'd1/b': { ...E1, d: '2026-10-01' },
        'd1/c': { ...E1, d: '' },
        'd1/d': { ...E1, d: '2026-10-05', at: '2026-10-18T03:00:00.000Z' },
        'd10/x': { ...E1 }, // another deal whose id starts the same
        'd2/y': { ...E1 },
      },
    };
    expect(expensesOf(S, 'd1').map((x) => [x.id, x.deal])).toEqual([['b', 'd1'], ['d', 'd1'], ['a', 'd1'], ['c', 'd1']]);
    expect(expensesOf(S, 'd1')[0]).toMatchObject({ c: 'ค่าเดินทาง', amt: 3500 });
    expect(expensesOf({}, 'd1')).toEqual([]);
    expect(expensesOf(S, 'zz')).toEqual([]);
  });
});

describe('the sync records', () => {
  it('dexp/ rows are held, replaced whole and removed (a deletion, or the script leaving one out)', () => {
    const s = shared();
    const fx = noEffects();
    applyRow(s, row('dexp/d1/e1', E1), fx);
    applyRow(s, row('dexp/d1/e2', { ...E1, amt: 1200 }), fx);
    expect(fx.sales).toBe(true);
    expect(s.sales.exp).toEqual({ 'd1/e1': E1, 'd1/e2': { ...E1, amt: 1200 } });
    applyRow(s, row('dexp/d1/e1', { ...E1, paid: '2026-10-06' }), noEffects());
    expect(s.sales.exp!['d1/e1'].paid).toBe('2026-10-06');
    // what the script sends an account without ดูค่าใช้จ่าย: a deletion in its place
    applyRow(s, { ...row('dexp/d1/e2', null), del: true }, noEffects());
    expect(Object.keys(s.sales.exp!)).toEqual(['d1/e1']);
    // malformed keys and values are skipped
    for (const k of ['dexp/d1', 'dexp//e', 'dexp/d1/', 'dexp/d1/e/x']) applyRow(s, row(k, E1), noEffects());
    applyRow(s, row('dexp/d1/e9', { c: 'x' }), noEffects());
    expect(Object.keys(s.sales.exp!)).toEqual(['d1/e1']);
    const nothing = noEffects();
    applyRow(s, row('dexp/d1/gone', null), nothing);
    expect(nothing.sales).toBe(false);
  });

  it('an expense\'s check and a month\'s expenses closed are kept apart from the income ones (never an income orphan)', () => {
    const s = shared();
    const chk = { s: 'ok', by: 'ฝน', at: 'a', amt: 3500, d: '2026-10-06', f: 'F1' };
    applyRow(s, row('dchk/d1/PAY1', { ...chk, amt: 100000 }), noEffects());
    applyRow(s, row('dchk/d1/exp.e1', chk), noEffects());
    applyRow(s, row('mclose/2026-10', { by: 'ฝน', at: 'a', n: 1, amt: 100000 }), noEffects());
    applyRow(s, row('mclose/2026-10/out', { by: 'ฝน', at: 'a', n: 1, amt: 3500 }), noEffects());
    expect(Object.keys(s.sales.pchk!)).toEqual(['d1/PAY1']);
    expect(s.sales.xchk).toEqual({ 'd1/e1': { ...chk, s: 'ok' } });
    expect(s.sales.mclose).toEqual({ '2026-10': { by: 'ฝน', at: 'a', n: 1, amt: 100000 } });
    expect(s.sales.mcloseOut).toEqual({ '2026-10': { by: 'ฝน', at: 'a', n: 1, amt: 3500 } });
    for (const k of ['dchk/d1/exp.', 'dchk/d1/exp.a/b', 'mclose/2026-10/in', 'mclose/2026-1/out']) applyRow(s, row(k, chk), noEffects());
    expect([Object.keys(s.sales.xchk!), Object.keys(s.sales.mcloseOut!), Object.keys(s.sales.pchk!)]).toEqual([['d1/e1'], ['2026-10'], ['d1/PAY1']]);
    applyRow(s, row('dchk/d1/exp.e1', null), noEffects());
    applyRow(s, row('mclose/2026-10/out', null), noEffects());
    expect([s.sales.xchk, s.sales.mcloseOut, Object.keys(s.sales.mclose!)]).toEqual([{}, {}, ['2026-10']]);
    // the history of an expense is a deal-history row with a key of its own
    applyRow(s, row('dlog/exp.h1', { action: 'บันทึกค่าใช้จ่าย', detail: 'ค่าเดินทาง', deal: 'd1', by: 'เอก', at: 'a' }), noEffects());
    expect(s.sales.log['exp.h1']).toMatchObject({ action: 'บันทึกค่าใช้จ่าย', deal: 'd1' });
  });

  it('what this browser holds goes back under the same keys (the first upload of a team), and keyOf names them', () => {
    const s = shared();
    const chk = { s: 'back' as const, by: 'ฝน', at: 'a', amt: 3500, d: '2026-10-06', f: 'F1', note: 'บิลไม่ชัด' };
    s.sales.exp = { 'd1/e1': E1 };
    s.sales.xchk = { 'd1/e1': chk };
    s.sales.mcloseOut = { '2026-10': { by: 'ฝน', at: 'a', n: 1, amt: 3500 } };
    const m = localRecords(s);
    expect(m.get(keyOf.dexp('d1', 'e1'))).toEqual(E1);
    expect(m.get(keyOf.dchkExp('d1', 'e1'))).toEqual(chk);
    expect(m.get(keyOf.mcloseOut('2026-10'))).toEqual({ by: 'ฝน', at: 'a', n: 1, amt: 3500 });
    expect([keyOf.dexp('d1', 'e1'), keyOf.dlogExp('h1'), keyOf.dchkExp('d1', 'e1'), keyOf.mcloseOut('2026-10')]).toEqual(['dexp/d1/e1', 'dlog/exp.h1', 'dchk/d1/exp.e1', 'mclose/2026-10/out']);
    // and they read back as they were
    const t = shared();
    [...m].forEach(([k, v], i) => applyRow(t, row(k, v, i + 1), noEffects()));
    expect([t.sales.exp, t.sales.xchk, t.sales.mcloseOut]).toEqual([s.sales.exp, s.sales.xchk, s.sales.mcloseOut]);
  });

  it('a queued change of some fields of an expense keeps a teammate\'s other fields (it merges like a payment line)', () => {
    const theirs = row('dexp/d1/e1', { ...E1, amt: 3600, by: 'มินท์' });
    const mine = { k: 'dexp/d1/e1', v: { ...E1, paid: '2026-10-07' }, f: ['paid'], t: 1, by: 'ฝน' };
    expect(rebaseOp(theirs, mine)).toEqual({ v: { ...E1, amt: 3600, by: 'มินท์', paid: '2026-10-07' } });
    // a teammate deleted it: the deletion wins over an edit
    expect(rebaseOp({ ...theirs, v: null, del: true }, mine)).toEqual({ drop: true });
  });

  it('purgeExpenses: everything about expenses goes (a role that may no longer see them), nothing else', () => {
    const s = emptySales();
    expect(purgeExpenses(s)).toBe(false);
    s.exp = { 'd1/e1': E1 };
    s.xchk = { 'd1/e1': { s: 'ok', by: 'ฝน', at: 'a', amt: 1, d: '2026-10-06', f: '' } };
    s.mcloseOut = { '2026-10': { by: 'ฝน', at: 'a', n: 1, amt: 1 } };
    s.pchk = { 'd1/PAY1': { s: 'ok', by: 'ฝน', at: 'a', amt: 1, d: '2026-10-06', f: '' } };
    s.log = { 'exp.h1': { id: 'exp.h1', at: 'a', by: 'เอก', action: 'บันทึกค่าใช้จ่าย', client: 'ก', detail: '', deal: 'd1' }, l1: { id: 'l1', at: 'a', by: 'เอก', action: 'รับชำระ PAY1', client: 'ก', detail: '', deal: 'd1' } };
    expect(purgeExpenses(s)).toBe(true);
    expect([s.exp, s.xchk, s.mcloseOut, Object.keys(s.log), Object.keys(s.pchk)]).toEqual([undefined, undefined, undefined, ['l1'], ['d1/PAY1']]);
  });
});
