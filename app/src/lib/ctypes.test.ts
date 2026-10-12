/**
 * Customer types (ประเภทลูกค้า), the pure parts: the list and its defaults, customer keys, answers read
 * over every key of a customer, suggestions from deal Services, counting, re-keying, the filters — and
 * the records on the team sheet, also as an older build still open in a teammate's browser sees them.
 */
import { describe, expect, it } from 'vitest';
import {
  CT_KEY_MAX, DEFAULT_CTYPES, activeDefs, ckeyOfCompany, ckeyOfDeal, cmpTag, countByType, ctClass, ctIndex, ctMatcher, dealTsMatch, freeSlot, localId, mergeDefs, moveTagOps,
  nameKey, orderTypes, parseCTagKey, pickTag, svcToType, toCTag, toCTypeDef, trackerOnly, typeNameError, typeNames, unionTags,
  type CtIndexInput, type CTypeRec, type CustTags,
} from './ctypes';
import { DEFAULT_SERVICES, emptySales, newDeal, type Deal } from './sales';
import { applyRow, isLocalId, isLocalOnly, keyOf, localRecords, newestTagRows, noEffects, rebaseOp, type SharedState, type SyncOp, type SyncRow } from './teamSync';
import * as Old from './fixtures/teamSync.before-ctypes';
import type { CTag } from './types';

const T0 = '2026-10-01T00:00:00.000Z', T1 = '2026-10-02T00:00:00.000Z', T2 = '2026-10-03T00:00:00.000Z';
const tag = (s: 'y' | 'n', at = T0, src: CTag['src'] = 'hand', by = 'เอ'): CTag => ({ s, at, by, src });
const deal = (p: Partial<Deal> & { id: string }): Deal => newDeal({ client: 'ลูกค้า', ...p }, 'เอ', T0);
const defs = mergeDefs();
/** An index over companies `cos` (id → name; `alias`: merged id → primary). */
function index(o: Partial<CtIndexInput> & { cos?: Record<number, string>; alias?: Record<number, number>; results?: Record<string, string> } = {}) {
  const cos = o.cos || {}, alias = o.alias || {};
  const company = (id: number) => {
    const p = alias[id] ?? id;
    return p in cos ? { id: p, name: cos[p] } : undefined;
  };
  return ctIndex({ tags: {}, defs, deals: [], result: (d) => o.results?.[d.id] || '', company, locals: [], custom: [], ...o });
}
const row = (seq: number, k: string, v: unknown, del = false): SyncRow => ({ seq, k, v, del, by: 'เอ', at: T0 });
const shared = (): SharedState => ({ crm: { stages: {}, notes: {}, tasks: [], watch: [], owners: {}, team: [], log: {} }, contacts: {}, dec: {}, sales: emptySales(), custom: {}, people: {} });

describe('the list (mergeDefs)', () => {
  it('six defaults in order; the Services → type map the owner confirmed (Course Training and CF-EVENT suggest none)', () => {
    expect(defs.map((d) => [d.id, d.n, d.c])).toEqual([['cfo', 'CFO', 0], ['cfp', 'CFP', 1], ['con', 'ที่ปรึกษา', 2], ['vvb', 'ทวนสอบ', 3], ['plt', 'แพลตฟอร์ม', 4], ['tvr', 'T-VER', 5]]);
    expect(defs.find((d) => d.id === 'cfo')!.d).toBe('ลูกค้างาน CFO (คาร์บอนฟุตพริ้นท์องค์กร)'); // not the TGO certificate
    const m = svcToType(defs);
    expect(Object.fromEntries(DEFAULT_SERVICES.map((s) => [s, m.get(s) || '']))).toEqual({
      CF: 'cfo', CFO: 'cfo', CFP: 'cfp', LESS: 'con', 'T-VER': 'tvr', CC: 'tvr', 'Course Training': '', 'CF-EVENT': '', VVB: 'vvb', 'Program Development': 'con', GCT: 'plt',
    });
    // the defaults in code are never changed by merging
    mergeDefs({ cfo: { svc: [] } });
    expect(DEFAULT_CTYPES[0].svc).toEqual(['CFO', 'CF']);
  });

  it('a record overrides its default field by field; a rename keeps every tag (tags hold the id)', () => {
    const d2 = mergeDefs({ vvb: toCTypeDef({ n: '  Verification ', at: T1, by: 'หัวหน้า' })! });
    expect(d2.find((d) => d.id === 'vvb')).toEqual({ id: 'vvb', n: 'Verification', d: 'งานทวนสอบ (VVB)', c: 3, o: 3, svc: ['VVB'], at: T1, by: 'หัวหน้า' });
    const ix = index({ defs: d2, cos: { 7: 'บริษัท ก' }, tags: { 7: { vvb: tag('y'), cfo: tag('y') } } });
    expect(ix.yes.get(7)).toEqual(['cfo', 'vvb']);
    expect(typeNames(ix.yes.get(7)!, d2)).toBe('CFO · Verification');
  });

  it('a retired type is still resolved: grey, out of the pickers and the suggestions, still named and counted', () => {
    const d2 = mergeDefs({ plt: { off: '2026-10-01' } });
    const plt = d2.find((d) => d.id === 'plt')!;
    expect(plt.off).toBe('2026-10-01');
    expect(ctClass(plt)).toBe('off');
    expect(ctClass(d2[0])).toBe('cfo');
    expect(activeDefs(d2).map((d) => d.id)).not.toContain('plt');
    expect(svcToType(d2).has('GCT')).toBe(false);
    const ix = index({ defs: d2, cos: { 7: 'ก' }, tags: { 7: { plt: tag('y') } }, deals: [deal({ id: 'a', gid: 7, service: ['GCT'] })] });
    expect(ix.yes.get(7)).toEqual(['plt']);
    expect(ix.sug.has(7)).toBe(false);
    expect(typeNames(['plt'], d2)).toBe('แพลตฟอร์ม');
    expect(countByType(ix, d2, '2569', () => 0).by.plt.cos).toBe(1);
    // restored: an empty date
    expect(mergeDefs({ plt: toCTypeDef({ off: '' })! }).find((d) => d.id === 'plt')!.off).toBeUndefined();
  });

  it('types an admin added follow, with a free colour; a record this build cannot use is ignored', () => {
    const st: Record<string, CTypeRec> = {
      tab12: toCTypeDef({ n: 'อบรม', svc: ['Course Training', 7, ' '], c: 9, at: T1 })!,
      'Bad Id': { n: 'x' },
      tnone: toCTypeDef({ d: 'cut short' })!, // no name
      plt: { off: '2026-10-01' },
    };
    const d2 = mergeDefs(st);
    expect(d2.map((d) => d.id)).toEqual(['cfo', 'cfp', 'con', 'vvb', 'plt', 'tvr', 'tab12']);
    expect(d2[6]).toMatchObject({ n: 'อบรม', svc: ['Course Training'], c: 4 }); // plt retired: its slot is free
    expect(freeSlot(defs)).toBe(0); // all six in use: they repeat
    expect(svcToType(d2).get('Course Training')).toBe('tab12');
    // a tag for a type this list does not have (a newer build's, or one cut short) shows nowhere
    const ix = index({ defs: d2, cos: { 7: 'ก' }, tags: { 7: { zzz: tag('y'), tnone: tag('y'), tab12: tag('y') } } });
    expect(ix.yes.get(7)).toEqual(['tab12']);
    expect(orderTypes(['tab12', 'zzz', 'cfo'], d2)).toEqual(['cfo', 'tab12']);
  });

  it('the list order decides the tag order, whatever order the tags were added in', () => {
    const d2 = mergeDefs({ tvr: { o: -1 } });
    const ix = index({ defs: d2, cos: { 7: 'ก' }, tags: { 7: { vvb: tag('y'), cfo: tag('y'), tvr: tag('y') } } });
    expect(ix.yes.get(7)).toEqual(['tvr', 'cfo', 'vvb']);
    expect(typeNames(['vvb', 'tvr', 'cfo'], d2)).toBe('T-VER · CFO · ทวนสอบ');
  });

  it('names: required, at most 40 characters, not another type\'s (retired too, any case)', () => {
    expect(typeNameError(' ', defs)).toBe('ใส่ชื่อประเภทลูกค้า');
    expect(typeNameError('x'.repeat(41), defs)).toMatch(/40/);
    expect(typeNameError(' cfo ', defs)).toBe('มีประเภทลูกค้าชื่อนี้แล้ว');
    expect(typeNameError('CFO', defs, 'cfo')).toBe(''); // its own name
    expect(typeNameError('แพลตฟอร์ม', mergeDefs({ plt: { off: '2026-10-01' } }))).not.toBe('');
  });

  it('records are checked: junk is null, a bad field is dropped', () => {
    for (const v of [null, 'y', [], 1]) {
      expect(toCTag(v)).toBeNull();
      expect(toCTypeDef(v)).toBeNull();
    }
    expect(toCTag({ s: 'maybe' })).toBeNull();
    expect(toCTag({ s: 'y', at: 'yesterday', by: 7, src: 'robot' })).toEqual({ s: 'y', at: '', by: '', src: 'hand' });
    // the deal it was given on, how often it moved, a moved answer's mark: kept when well formed
    expect(toCTag({ ...tag('y'), d: 'deal-1', m: 2, mv: '42' })).toEqual({ ...tag('y'), d: 'deal-1', m: 2, mv: '42' });
    expect(toCTag({ ...tag('y'), d: 'a/b', m: 1.5, mv: '' })).toEqual(tag('y'));
    expect(toCTag({ ...tag('y'), d: 7, m: -1, mv: 3 })).toEqual(tag('y'));
    expect(toCTypeDef({ n: 'x'.repeat(60), c: 2.5, o: 'first', svc: 'VVB', off: 'soon' })).toEqual({ n: 'x'.repeat(40), off: '', at: '', by: '' });
  });
});

describe('customer keys', () => {
  it('a name key: norm() of the name, at least 3 and at most 200 characters, never half a character', () => {
    expect(nameKey('บริษัท เอบีซี จำกัด')).toBe('n:เอบีซี');
    expect(nameKey('บริษัท SET/mai จำกัด (มหาชน)')).toBe('n:set/mai');
    expect(nameKey('AB')).toBe('');
    expect(nameKey('')).toBe('');
    expect(nameKey('ก'.repeat(500))).toHaveLength(2 + CT_KEY_MAX);
    const k = nameKey('a'.repeat(199) + '😀z');
    expect(k).toBe('n:' + 'a'.repeat(199));
  });

  it('a record key splits at its last "/" and checks both parts; it stays far under the 500 the sheet keeps', () => {
    expect(parseCTagKey('n:set/mai/cfo')).toEqual({ ckey: 'n:set/mai', t: 'cfo' });
    expect(parseCTagKey('n:abc/def/cfo')).toEqual({ ckey: 'n:abc/def', t: 'cfo' });
    expect(parseCTagKey('1234/vvb')).toEqual({ ckey: '1234', t: 'vvb' });
    expect(parseCTagKey('1000000000123/t-x_9')).toEqual({ ckey: '1000000000123', t: 't-x_9' });
    for (const bad of ['n:ab/cfo', '1234/CFO', '1234/', '/cfo', 'cfo', '1234/a b', '900123/cfo', '0/cfo', 'x:abc/cfo', 'n:a b c/cfo', '1234/' + 'x'.repeat(25)]) expect([bad, parseCTagKey(bad)]).toEqual([bad, null]);
    expect(keyOf.ctag(nameKey('ก'.repeat(5000)), 'x'.repeat(24)).length).toBeLessThanOrEqual(232);
  });

  it('a TGO-sync company (ids of one device) is keyed by name; its numeric key is never shared', () => {
    for (const id of [899999, 900000, 900123, 999999999999, 1e12, 1e12 + 5]) expect(localId(id)).toBe(isLocalId(id));
    expect(isLocalOnly('ctag/900123/cfo')).toBe(true);
    expect(isLocalOnly('ctag/123/cfo')).toBe(false);
    expect(isLocalOnly('ctag/n:abc/cfo')).toBe(false);
    expect(isLocalOnly('ctag/1000000000001/cfo')).toBe(false);
    expect(ckeyOfCompany({ id: 900123, name: 'บริษัท ทีจีโอ จำกัด' })).toBe('n:ทีจีโอ');
    expect(ckeyOfCompany({ id: 77, name: 'x' })).toBe('77');
    expect(ckeyOfDeal({ gid: null, client: 'บริษัท ลูกค้าใหม่ จำกัด' })).toBe('n:ลูกค้าใหม่');
    expect(ckeyOfDeal({ gid: 5, client: 'x' }, { id: 3, name: 'y' })).toBe('3'); // merged: the primary
    expect(ckeyOfDeal({ gid: 900123, client: 'บริษัท ทีจีโอ' })).toBe('n:ทีจีโอ');
  });
});

describe('records on the team sheet (teamSync.ts)', () => {
  it('applyRow: answers and type changes, deletions; a malformed row is skipped', () => {
    const s = shared(), fx = noEffects();
    applyRow(s, row(1, 'ctag/n:set/mai/cfo', tag('y')), fx);
    applyRow(s, row(2, 'ctag/12/vvb', tag('n', T1, 'deal')), fx);
    applyRow(s, row(3, 'scfg/ct.vvb', { n: 'Verification', at: T1, by: 'หัวหน้า' }), fx);
    expect(fx).toMatchObject({ ctags: true, ctypes: true, sales: false, crm: false });
    expect(s.ctags).toEqual({ 'n:set/mai': { cfo: tag('y') }, 12: { vvb: tag('n', T1, 'deal') } });
    expect(s.ctypes).toEqual({ vvb: { n: 'Verification', at: T1, by: 'หัวหน้า' } });
    expect(s.sales.cfg).toEqual(emptySales().cfg); // not a list
    const fx2 = noEffects();
    for (const r of [row(4, 'ctag/12/VVB', tag('y')), row(5, 'ctag/ab/cfo', tag('y')), row(6, 'ctag/12/cfo', { s: 'x' }), row(7, 'ctag/900123/cfo', tag('y')), row(8, 'scfg/ct.Bad', { n: 'x' }), row(9, 'scfg/ct.cfo', 'junk')])
      applyRow(s, r, fx2);
    expect(fx2).toEqual(noEffects());
    applyRow(s, row(10, 'ctag/12/vvb', null, true), fx2);
    applyRow(s, row(11, 'scfg/ct.vvb', null, true), fx2);
    expect(s.ctags).toEqual({ 'n:set/mai': { cfo: tag('y') } });
    expect(s.ctypes).toEqual({});
    expect(fx2).toMatchObject({ ctags: true, ctypes: true });
  });

  it('localRecords round-trips them; a numeric TGO-sync key is never uploaded', () => {
    const s: SharedState = { ...shared(), ctags: { 'n:set/mai': { cfo: tag('y') }, 12: { vvb: tag('n'), cfp: tag('y', T1) }, 900123: { cfo: tag('y') } }, ctypes: { vvb: { n: 'V', at: T1, by: 'x' }, tab12: { n: 'อบรม', c: 2, o: 6, svc: ['Course Training'], at: T1, by: 'x' } } };
    const m = localRecords(s);
    const mine = [...m.keys()].filter((k) => k.startsWith('ctag/') || k.startsWith('scfg/ct.')).sort();
    expect(mine).toEqual(['ctag/12/cfp', 'ctag/12/vvb', 'ctag/n:set/mai/cfo', 'scfg/ct.tab12', 'scfg/ct.vvb']);
    const t = shared();
    [...m].forEach(([k, v], i) => applyRow(t, row(i + 1, k, v), noEffects()));
    expect(t.ctags).toEqual({ 'n:set/mai': s.ctags!['n:set/mai'], 12: s.ctags![12] });
    expect(t.ctypes).toEqual(s.ctypes);
  });

  it('rebaseOp: the newer answer wins whoever pushed first; a moved answer\'s mark yields to a newer answer', () => {
    const op = (k: string, v: CTag): SyncOp => ({ k, v, t: 1 });
    expect(rebaseOp(row(1, 'ctag/1/cfo', tag('n', T2)), op('ctag/1/cfo', tag('y', T1)))).toEqual({ drop: true });
    expect(rebaseOp(row(1, 'ctag/1/cfo', tag('n', T0)), op('ctag/1/cfo', tag('y', T1)))).toBeNull();
    expect(rebaseOp(row(1, 'ctag/1/cfo', null, true), op('ctag/1/cfo', tag('y', T1)))).toBeNull();
    // a mark left by moving an answer of T1 elsewhere: a teammate's newer answer stays, the same one goes
    const mark = { ...tag('y', T1), m: 1, mv: '42' };
    expect(rebaseOp(row(1, 'ctag/n:abc/cfo', tag('n', T2)), op('ctag/n:abc/cfo', mark))).toEqual({ drop: true });
    expect(rebaseOp(row(1, 'ctag/n:abc/cfo', tag('y', T1)), op('ctag/n:abc/cfo', mark))).toBeNull();
    expect(rebaseOp(row(1, 'ctag/n:abc/cfo', tag('n', T0)), op('ctag/n:abc/cfo', mark))).toBeNull();
    // a type is edited field by field: a teammate's rename and this browser's services both stay
    const mine: SyncOp = { k: 'scfg/ct.vvb', v: { svc: ['VVB', 'GCT'], at: T2, by: 'บี' }, f: ['svc', 'at', 'by'], fl: { svc: { add: ['GCT'], rm: [] } } };
    expect(rebaseOp(row(1, 'scfg/ct.vvb', { n: 'Verification', svc: ['VVB', 'CC'], at: T1, by: 'เอ' }), mine)).toEqual({ v: { n: 'Verification', svc: ['VVB', 'CC', 'GCT'], at: T2, by: 'บี' } });
  });

  it('pulled answers are kept by time, not by the order they reach the sheet (an older build\'s tab may push one late)', () => {
    const k = 'ctag/12/cfo', other = row(9, 'deal/x', { id: 'x' });
    const newer = row(5, k, tag('n', T2)), late = row(6, k, tag('y', T1)), later = row(7, k, tag('y', T2, 'hand', 'บี'));
    // a full reload: the newest of the rows
    expect(newestTagRows([newer, other, late])).toEqual([newer, other]);
    // a round on top of what this browser has: nothing when its own answer is newer
    expect(newestTagRows([late, other], () => tag('n', T2))).toEqual([other]);
    expect(newestTagRows([late], () => tag('n', T0))).toEqual([late]);
    // same moment: a "no" over a "yes", a later move over an earlier one, a mark over the answer it moved
    expect(newestTagRows([newer, later])).toEqual([newer]);
    expect(cmpTag({ ...tag('y', T1), m: 2 }, { ...tag('n', T1), m: 1 })).toBeGreaterThan(0);
    expect(cmpTag({ ...tag('y', T1), m: 1, mv: '7' }, { ...tag('y', T1), m: 1 })).toBeGreaterThan(0);
    // a deletion applies where it is; a malformed row never does
    const del = row(8, k, null, true), bad = row(9, k, { s: 'x' });
    expect(newestTagRows([newer, del, late, bad])).toEqual([late]);
    expect(newestTagRows([newer, late, del])).toEqual([del]);
  });

  it('an older build (the live site before this) skips both record types: nothing changes, nothing breaks, nothing is sent back', () => {
    const s = shared(), fx = Old.noEffects();
    const before = structuredClone(s);
    const rows = [
      row(1, 'scfg/ct.vvb', { n: 'Verification', svc: ['VVB'], at: T1, by: 'หัวหน้า' }),
      row(2, 'scfg/ct.tab12', { n: 'อบรม', c: 2, o: 6, svc: [], at: T1, by: 'หัวหน้า' }),
      row(3, 'ctag/12/cfo', tag('y')),
      row(4, 'ctag/n:set/mai/vvb', tag('n')),
      row(5, 'ctag/12/cfo', null, true),
      row(6, 'scfg/ct.vvb', null, true),
    ];
    rows.forEach((r) => Old.applyRow(s, r, fx));
    expect(s).toEqual(before);
    expect(fx).toEqual(Old.noEffects());
    // a list it knows, in the same pull, still applies
    Old.applyRow(s, row(7, 'scfg/services', ['CFO', 'VVB']), fx);
    expect(s.sales.cfg.services).toEqual(['CFO', 'VVB']);
    // what it would upload (first connect, a backup) never includes them, even from a store this build wrote
    const st = { ...shared(), ctags: { 12: { cfo: tag('y') } }, ctypes: { vvb: { n: 'V' } } } as SharedState;
    expect([...Old.localRecords(st).keys()].some((k) => k.startsWith('ctag/') || k.startsWith('scfg/ct.'))).toBe(false);
    // a change this build queued, pushed by an older tab of the same browser: sent as it is (not merged)
    expect(Old.rebaseOp(row(8, 'ctag/12/cfo', tag('n', T2)), { k: 'ctag/12/cfo', v: tag('y', T1) })).toBeNull();
    expect(Old.rebaseOp(row(8, 'scfg/ct.vvb', { n: 'x' }), { k: 'scfg/ct.vvb', v: { d: 'y' }, f: ['d'] })).toBeNull();
  });
});

describe('a customer\'s types (ctIndex)', () => {
  it('the union over merged ids and the answers given on its deals; per type the latest answer wins', () => {
    const tags: CustTags = {
      10: { cfo: tag('y', T0), vvb: tag('y', T2) },
      11: { cfo: tag('n', T1), tvr: tag('y', T0) }, // merged into 10
      // answered on deal d1 while it was not linked yet (a teammate who had not seen the link)
      'n:ลูกค้าเก่า': { vvb: { ...tag('n', T1), d: 'd1' }, cfp: { ...tag('y', T1), d: 'd1' }, plt: tag('y', T1) },
    };
    const deals = [deal({ id: 'd1', gid: 10, client: 'ลูกค้าเก่า', year: '2568' })];
    const ix = index({ cos: { 10: 'บริษัท สิบ จำกัด' }, alias: { 11: 10 }, tags, deals });
    expect(ix.yes.get(10)).toEqual(['cfp', 'vvb', 'tvr']); // cfo: a newer "no"; vvb: the newer "yes"
    expect(ix.tags.get(10)!.get('cfo')).toEqual(tag('n', T1));
    expect(ix.custOf('11')).toBe(10);
    // the client text itself is no company: plt, given on no deal, stays with the name nobody uses now
    expect(ix.custOf('n:ลูกค้าเก่า')).toBe('n:ลูกค้าเก่า');
    expect(ix.pop.has('n:ลูกค้าเก่า')).toBe(false);
    expect(unionTags([tags[10], tags[11]]).get('cfo')!.s).toBe('n');
    // at the same moment a "no" wins (it is never suggested again)
    expect(pickTag(tag('y', T1), tag('n', T1))!.s).toBe('n');
    expect(pickTag(tag('n', T1), tag('y', T1))!.s).toBe('n');
  });

  it('a free-text client is its own customer, one per name across years; a name two companies were linked under stays its own', () => {
    const deals = [
      deal({ id: 'a', client: 'บริษัท ฟรี จำกัด', year: '2568' }),
      deal({ id: 'b', client: 'ฟรี', year: '2569' }),
      deal({ id: 'c', gid: 1, client: 'ชื่อซ้ำ' }),
      deal({ id: 'd', gid: 2, client: 'ชื่อซ้ำ' }),
      deal({ id: 'e', client: 'ชื่อซ้ำ' }),
      deal({ id: 'f', client: 'AB' }),
    ];
    const ix = index({ cos: { 1: 'หนึ่ง', 2: 'สอง' }, deals, tags: { 'n:ฟรี': { cfo: tag('y') } } });
    expect(ix.custOfDeal(deals[0])).toBe('n:ฟรี');
    expect(ix.custOfDeal(deals[1])).toBe('n:ฟรี');
    expect(ix.deals.get('n:ฟรี')!.map((d) => d.id)).toEqual(['a', 'b']);
    expect(ix.yes.get('n:ฟรี')).toEqual(['cfo']);
    expect(ix.custOfDeal(deals[4])).toBe('n:ชื่อซ้ำ');
    expect(ix.custOfDeal(deals[5])).toBe('d:f'); // a name too short to key: counted, never tagged
    expect([...ix.pop].sort()).toEqual([1, 2, 'd:f', 'n:ชื่อซ้ำ', 'n:ฟรี'].sort());
  });

  it('a client text never stands for a company: the placeholder "ลูกค้าใหม่" on many rows, one of them linked', () => {
    const deals = [
      deal({ id: 'a', gid: 1, client: 'ลูกค้าใหม่', year: '2569' }), // linked: only the gid changed
      deal({ id: 'b', client: 'ลูกค้าใหม่', year: '2569', service: ['VVB'], forecast: 999 }), // another customer
    ];
    const ix = index({ cos: { 1: 'บริษัท หนึ่ง จำกัด' }, deals, tags: { 1: { cfo: tag('y') } } });
    expect(ix.custOfDeal(deals[1])).toBe('n:ลูกค้าใหม่');
    expect(ix.yes.get('n:ลูกค้าใหม่')).toBeUndefined();
    expect(ix.sug.has(1)).toBe(false); // b's service suggests nothing for company 1
    expect(countByType(ix, defs, '2569', (d) => d.forecast).by.cfo).toEqual({ cos: 1, deals: 1, forecast: 0 });
  });

  it('an answer follows the deal it was given on: linked, re-linked, unlinked, renamed; one left on a name another deal still uses counts there too', () => {
    const on = (d: string) => ({ ...tag('y', T1), d });
    const at = (tags: CustTags, ...ds: Partial<Deal>[]) => index({ cos: { 1: 'หนึ่ง', 2: 'สอง' }, tags, deals: ds.map((x, i) => deal({ id: 'xy'[i], ...x })) });
    const named: CustTags = { 'n:เดิม': { cfo: on('x'), vvb: on('y') }, 2: { cfp: tag('y') } };
    // x renamed: its answer goes with it; y still stands on the old name, which keeps both
    let ix = at(named, { client: 'ใหม่' }, { client: 'เดิม' });
    expect(ix.yes.get('n:ใหม่')).toEqual(['cfo']);
    expect(ix.yes.get('n:เดิม')).toEqual(['cfo', 'vvb']);
    // y renamed too and x linked to 2: the old name counts for nobody; x's answer is with company 2's own
    ix = at(named, { gid: 2, client: 'เดิม' }, { client: 'อื่น' });
    expect(ix.yes.get(2)).toEqual(['cfo', 'cfp']);
    expect(ix.yes.get('n:อื่น')).toEqual(['vvb']);
    expect(ix.yes.has('n:เดิม')).toBe(false);
    // an answer given on x while it was linked to company 1 leaves 1 when x is re-linked, or unlinked
    const linked: CustTags = { 1: { tvr: on('x') }, 2: { cfp: tag('y') } };
    expect(at(linked, { gid: 1 }).yes.get(1)).toEqual(['tvr']);
    ix = at(linked, { gid: 2 });
    expect([ix.yes.get(1), ix.yes.get(2)]).toEqual([undefined, ['cfp', 'tvr']]);
    expect(at(linked, { client: 'เดิม' }).yes.get('n:เดิม')).toEqual(['tvr']);
    // its deal deleted: the answer stays where it is
    expect(at(linked).yes.get(1)).toEqual(['tvr']);
    // a moved answer's mark counts for nobody
    expect(at({ 1: { tvr: { ...tag('y'), m: 1, mv: 'n:เดิม' } } }).tags.has(1)).toBe(false);
  });

  it('a TGO-sync company reads the tags under its name; tags nobody stands for any more count for nobody', () => {
    const ix = index({
      cos: { 900123: 'บริษัท ทีจีโอ จำกัด', 5: 'ห้า' },
      locals: [{ id: 900123, name: 'บริษัท ทีจีโอ จำกัด' }],
      tags: { 'n:ทีจีโอ': { cfp: tag('y') }, 'n:ไม่มีใครใช้': { cfo: tag('y') }, 999: { cfo: tag('y') }, 5: { vvb: tag('y') } },
    });
    expect(ix.yes.get(900123)).toEqual(['cfp']);
    expect(ix.pop.has(900123)).toBe(true);
    expect(ix.pop.has('n:ไม่มีใครใช้')).toBe(false); // no deal uses the name
    expect(ix.pop.has(999)).toBe(false); // no such company here
    expect(ix.pop.has(5)).toBe(true);
  });

  it('a TGO-sync company merged into a registry row (by build() or a decision) keeps the tags under its name; a deal text never takes them', () => {
    const local = { id: 900011, name: 'บริษัท ท้องถิ่นรวม จำกัด' };
    const ix = index({ cos: { 77: 'บริษัท ท้องถิ่นรวม จำกัด' }, alias: { 900011: 77 }, locals: [local], tags: { 'n:ท้องถิ่นรวม': { cfo: tag('y') } } });
    expect(ix.yes.get(77)).toEqual(['cfo']);
    expect(ix.pop.has(77)).toBe(true);
    // its own name first: a deal linked to another company with that client text changes nothing
    const own = { id: 900010, name: 'บริษัท ท้องถิ่นทดสอบ จำกัด' };
    const ix2 = index({
      cos: { 900010: own.name, 55: 'บริษัท อื่น จำกัด' }, locals: [own],
      deals: [deal({ id: 'a', gid: 55, client: own.name })], tags: { [ckeyOfCompany(own)]: { cfo: tag('y') } },
    });
    expect(ix2.yes.get(900010)).toEqual(['cfo']);
    expect(ix2.yes.get(55)).toBeUndefined();
  });

  it('what the index hands out is read-only: a screen sorting a list cannot change it for the others', () => {
    const ix = index({ cos: { 1: 'หนึ่ง' }, tags: { 1: { vvb: tag('y'), cfo: tag('y') } }, deals: [deal({ id: 'a', gid: 1, service: ['CFP', 'GCT'] })] });
    expect(Object.isFrozen(ix.yes.get(1))).toBe(true);
    expect(() => (ix.yes.get(1) as string[]).sort().reverse()).toThrow(TypeError);
    expect(ix.yes.get(1)).toEqual(['cfo', 'vvb']);
    const sug = ix.sug.get(1)!;
    expect(Object.isFrozen(sug) && Object.isFrozen(sug[0]) && Object.isFrozen(sug[0].why)).toBe(true);
  });
});

describe('suggestions from deal Services', () => {
  const svcs = DEFAULT_SERVICES;
  it('every mapped service suggests its type, once per type, newest deal first; unmapped ones suggest nothing', () => {
    const deals = svcs.map((s, i) => deal({ id: 'd' + i, gid: 1, service: [s], year: i % 2 ? '2569' : '2568' }));
    const ix = index({ cos: { 1: 'หนึ่ง' }, deals });
    const sug = ix.sug.get(1)!;
    expect(sug.map((s) => s.t)).toEqual(['cfo', 'cfp', 'con', 'vvb', 'plt', 'tvr']);
    expect(sug[0].why.map((w) => w.svc).sort()).toEqual(['CF', 'CFO']);
    expect(sug[0].why[0].year >= sug[0].why[1].year).toBe(true);
    const only = index({ cos: { 1: 'หนึ่ง' }, deals: [deal({ id: 'x', gid: 1, service: ['Course Training', 'CF-EVENT'] })] });
    expect(only.sug.has(1)).toBe(false);
  });

  it('an answer either way blocks it; a lost deal (ผลการขาย NO) suggests nothing, waiting / won / not decided do', () => {
    const deals = [deal({ id: 'no', gid: 1, service: ['VVB'] }), deal({ id: 'w', gid: 2, service: ['VVB'] }), deal({ id: 'y', gid: 3, service: ['VVB'] }), deal({ id: 'e', gid: 4, service: ['VVB', 'CFO', 'CFP'] })];
    const ix = index({ cos: { 1: 'a', 2: 'b', 3: 'c', 4: 'd' }, deals, results: { no: 'NO', w: 'WAIT', y: 'YES' }, tags: { 4: { vvb: tag('y'), cfo: tag('n', T0, 'deal') } } });
    expect(ix.sug.has(1)).toBe(false);
    expect(ix.sug.get(2)!.map((s) => s.t)).toEqual(['vvb']);
    expect(ix.sug.get(3)!.map((s) => s.t)).toEqual(['vvb']);
    expect(ix.sug.get(4)!.map((s) => s.t)).toEqual(['cfp']);
  });

  it('a client whose name is too short to key gets none: nothing there could confirm or dismiss it', () => {
    const ix = index({ deals: [deal({ id: 'f', client: 'AB', service: ['CFO'] })] });
    expect(ix.pop.has('d:f')).toBe(true);
    expect(ix.sug.size).toBe(0);
    expect(countByType(ix, defs, '2569', () => 0)).toMatchObject({ pop: 1, none: 1, sug: 0 });
  });

  it('one service suggests at most one type: two types listing it (a concurrent edit), the first in the list has it', () => {
    const d2 = mergeDefs({ tvr: { svc: ['T-VER', 'CC', 'VVB'] }, cfo: { o: 9 } });
    expect(svcToType(d2).get('VVB')).toBe('vvb');
    const ix = index({ defs: d2, cos: { 1: 'a' }, deals: [deal({ id: 'x', gid: 1, service: ['VVB'] })] });
    expect(ix.sug.get(1)!.map((s) => s.t)).toEqual(['vvb']);
  });
});

describe('counting (one definition for every screen)', () => {
  const deals = [
    deal({ id: 'a', gid: 1, year: '2569', service: ['VVB'] }),
    deal({ id: 'b', gid: 1, year: '2568' }),
    deal({ id: 'c', gid: 2, year: '2569' }),
    deal({ id: 'd', client: 'ลูกค้านอกทะเบียน', year: '2569', service: ['CFO'] }),
    deal({ id: 'e', gid: 3, year: '2569' }),
    deal({ id: 'g', gid: 99, client: 'ลูกค้าที่ลบไปแล้ว', year: '2568' }), // its company is not known here
  ];
  const tags: CustTags = { 1: { cfo: tag('y'), vvb: tag('y') }, 2: { vvb: tag('y'), cfo: tag('n') }, 4: { tvr: tag('y') }, 5: { cfp: tag('n') }, 'n:ลูกค้านอกทะเบียน': { cfp: tag('y') } };
  const fc: Record<string, number> = { a: 100, b: 1000, c: 50, d: 7, e: 3 };
  const ix = index({ cos: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f' }, deals, tags, custom: [6] });

  it('customers: a deal (any year), added by hand, or a type; types overlap, the only total is the customers', () => {
    const c = countByType(ix, defs, '2569', (d) => fc[d.id]);
    expect(c.pop).toBe(7); // 1, 2, 3, 4, 6, 99 and the client not in the registry; 5 only has a "no"
    expect(c.by.vvb).toEqual({ cos: 2, deals: 2, forecast: 150 });
    expect(c.by.cfo).toEqual({ cos: 1, deals: 1, forecast: 100 });
    expect(c.by.cfp).toEqual({ cos: 1, deals: 1, forecast: 7 });
    expect(c.by.tvr).toEqual({ cos: 1, deals: 0, forecast: 0 });
    expect(c.none).toBe(3); // 3 (a deal, no type), 6 (added by hand) and 99
    expect(c.noneDeals).toEqual({ deals: 1, forecast: 3 });
    expect(c.sug).toBe(1); // 'd' suggests CFO for the client not in the registry; 1 already has VVB
    expect(countByType(ix, defs, '2568', (d) => fc[d.id]).by.vvb).toEqual({ cos: 2, deals: 1, forecast: 1000 });
  });

  it('the search counts (companies + Sales Tracker customers not in the registry) equal the overview counts', () => {
    const c = countByType(ix, defs, '2569', () => 0);
    const cos = [1, 2, 3, 4, 5, 6, 7, 8]; // the registry, prospects included
    const n = (sel: string) => cos.filter(ctMatcher(ix, sel)).length + trackerOnly(ix).filter((x) => ctMatcher(ix, sel)(x.key)).length;
    expect(trackerOnly(ix).map((x) => [x.key, x.name])).toEqual([[99, 'ลูกค้าที่ลบไปแล้ว'], ['n:ลูกค้านอกทะเบียน', 'ลูกค้านอกทะเบียน']]);
    for (const d of defs) expect([d.id, n(d.id)]).toEqual([d.id, c.by[d.id].cos]);
    expect(n('all')).toBe(c.pop);
    expect(n('none')).toBe(c.none);
    expect(n('sug')).toBe(c.sug);
  });
});

describe('moving a deal\'s answers to its new key (moveTagOps)', () => {
  const all = () => true;
  it('to the company it is linked to: as the deal\'s, one move later; the name gets a mark at each answer\'s own time', () => {
    const from: Record<string, CTag> = { cfo: tag('y', T1), vvb: { ...tag('n', T1), d: 'x' } };
    const r = moveTagOps(from, undefined, '42', 'x', false, all);
    expect(r.set).toEqual([{ t: 'cfo', v: { ...tag('y', T1), d: 'x', m: 1 } }, { t: 'vvb', v: { ...tag('n', T1), d: 'x', m: 1 } }]);
    expect(r.mark).toEqual([{ t: 'cfo', v: { ...tag('y', T1), m: 1, mv: '42' } }, { t: 'vvb', v: { ...tag('n', T1), d: 'x', m: 1, mv: '42' } }]);
    // the mark outranks the answer it moved, never a teammate's newer one
    expect(cmpTag(r.mark[0].v, from.cfo)).toBeGreaterThan(0);
    expect(cmpTag(tag('n', T2), r.mark[0].v)).toBeGreaterThan(0);
    // another deal (another year) still stands on the name: it keeps them
    expect(moveTagOps(from, undefined, '42', 'x', true, all).mark).toEqual([]);
    // only what `take` lets go: a company keeps its own answers when a deal\'s link is corrected
    expect(moveTagOps(from, undefined, '43', 'x', false, (v) => v.d === 'x').set.map((x) => x.t)).toEqual(['vvb']);
  });

  it('the new key\'s answers: the same answer or a newer one stays (its own); an older different one is replaced; a mark there is outranked', () => {
    const from: Record<string, CTag> = { cfo: tag('y', T1), vvb: tag('y', T1), tvr: tag('y', T1), cfp: { ...tag('y', T1), m: 2 } };
    const to: Record<string, CTag> = { cfo: tag('y', T0), vvb: tag('n', T2), tvr: tag('n', T0), cfp: { ...tag('y', T1), m: 2, mv: 'n:abc' } };
    const r = moveTagOps(from, to, '42', 'x', false, all);
    expect(r.set.map((x) => [x.t, x.v.s, x.v.m])).toEqual([['tvr', 'y', 1], ['cfp', 'y', 3]]);
    // linked, unlinked and linked again: every step wins over the marks it left
    const there = { ...tag('y', T1), m: 1, d: 'x' }, back = moveTagOps({ cfo: there }, { cfo: { ...tag('y', T1), m: 1, mv: '42' } }, 'n:abc', 'x', false, all);
    expect(back.set[0].v.m).toBe(2);
    expect(cmpTag(back.set[0].v, { ...tag('y', T1), m: 1, mv: '42' })).toBeGreaterThan(0);
    expect(cmpTag(back.mark[0].v, there)).toBeGreaterThan(0);
  });

  it('applied twice it changes nothing more; a mark never moves', () => {
    const tags: CustTags = { 'n:abc': { cfo: tag('y', T1), vvb: tag('n', T1) } };
    const r = moveTagOps(tags['n:abc'], tags[42], '42', 'x', false, all);
    tags[42] = Object.fromEntries(r.set.map((x) => [x.t, x.v]));
    r.mark.forEach((x) => (tags['n:abc'][x.t] = x.v));
    expect(moveTagOps(tags['n:abc'], tags[42], '42', 'x', false, all)).toEqual({ set: [], mark: [] });
    const keep: CustTags = { 'n:abc': { cfo: tag('y', T1) } };
    keep[42] = Object.fromEntries(moveTagOps(keep['n:abc'], undefined, '42', 'x', true, all).set.map((x) => [x.t, x.v]));
    expect(moveTagOps(keep['n:abc'], keep[42], '42', 'x', true, all)).toEqual({ set: [], mark: [] });
    expect(unionTags([tags['n:abc']]).size).toBe(0);
    expect(unionTags([tags['n:abc'], tags[42]]).get('cfo')).toMatchObject({ s: 'y', d: 'x' });
  });
});

describe('the filters', () => {
  const ix = index({
    cos: { 1: 'a', 2: 'b', 3: 'c', 9: 'prospect' },
    deals: [deal({ id: 'x', gid: 2, service: ['VVB'] }), deal({ id: 'y', gid: 3 }), deal({ id: 'z', client: 'ไม่อยู่ในทะเบียน', service: ['CFO'] })],
    tags: { 1: { cfo: tag('y') }, 2: { tvr: tag('y') }, 9: { cfp: tag('n') } },
  });
  it('search ct: any of the types (OR), none, all, sug; a prospect never matches a set filter', () => {
    const m = (sel: string) => [1, 2, 3, 9, 'n:ไม่อยู่ในทะเบียน'].filter(ctMatcher(ix, sel));
    expect(m('')).toEqual([1, 2, 3, 9, 'n:ไม่อยู่ในทะเบียน']);
    expect(m('cfo')).toEqual([1]);
    expect(m('cfo,tvr')).toEqual([1, 2]);
    expect(m('none')).toEqual([3, 'n:ไม่อยู่ในทะเบียน']);
    expect(m('sug')).toEqual([2, 'n:ไม่อยู่ในทะเบียน']);
    expect(m('all')).toEqual([1, 2, 3, 'n:ไม่อยู่ในทะเบียน']);
    expect(m('none,cfo')).toEqual([1, 3, 'n:ไม่อยู่ในทะเบียน']);
    expect(trackerOnly(ix)).toEqual([{ key: 'n:ไม่อยู่ในทะเบียน', name: 'ไม่อยู่ในทะเบียน', deals: [expect.objectContaining({ id: 'z' })] }]);
  });
  it('tracker "ประเภท · บริการ": t: by the customer\'s types, s: by the deal\'s services, an older saved service as s:', () => {
    const d = { service: ['VVB'] };
    expect(dealTsMatch('', [], d)).toBe(true);
    expect(dealTsMatch('t:vvb', ['cfo', 'vvb'], d)).toBe(true);
    expect(dealTsMatch('t:vvb', ['cfo'], d)).toBe(false);
    expect(dealTsMatch('t:none', [], d)).toBe(true);
    expect(dealTsMatch('t:none', ['cfo'], d)).toBe(false);
    expect(dealTsMatch('s:VVB', [], d)).toBe(true);
    expect(dealTsMatch('s:CFO', ['cfo'], d)).toBe(false);
    expect(dealTsMatch('VVB', [], d)).toBe(true); // saved before the filter existed
  });
});

describe('performance', () => {
  it('55k companies: the index is built from the tags and deals only, and a full filter pass is one Map lookup each', () => {
    const N = 55000, cos: Record<number, string> = {};
    for (let i = 1; i <= N; i++) cos[i] = 'บริษัท ' + i;
    const tags: CustTags = {}, deals: Deal[] = [];
    for (let i = 0; i < 3000; i++) tags[String(1 + ((i * 17) % N))] = { [defs[i % 6].id]: tag('y'), [defs[(i + 2) % 6].id]: tag(i % 3 ? 'y' : 'n') };
    for (let i = 0; i < 2000; i++) deals.push(deal({ id: 'd' + i, gid: i % 4 ? 1 + ((i * 31) % N) : null, client: 'ลูกค้า ' + i, service: [DEFAULT_SERVICES[i % DEFAULT_SERVICES.length]], year: i % 2 ? '2569' : '2568' }));
    let built = 0;
    const company = (id: number) => (id in cos ? { id, name: cos[id] } : undefined);
    const t0 = performance.now();
    const ix = ctIndex({ tags, defs, deals, result: () => '', company: (id) => (built++, company(id)), locals: [], custom: [] });
    const t1 = performance.now();
    const m = ctMatcher(ix, 'cfo,vvb');
    let hits = 0;
    for (let i = 1; i <= N; i++) if (m(i)) hits++;
    const c = countByType(ix, defs, '2569', () => 1);
    const t2 = performance.now();
    expect(hits).toBe([...ix.pop].filter((cu) => typeof cu === 'number' && (ix.yes.get(cu) || []).some((t) => t === 'cfo' || t === 'vvb')).length);
    expect(hits).toBeGreaterThan(1000);
    expect(c.pop).toBe(ix.pop.size);
    // lookups for the tags, the deals and the customers they make, never one per registry company
    expect(built).toBeLessThan(3 * (Object.keys(tags).length + deals.length));
    expect(built).toBeLessThan(N / 2);
    expect(t1 - t0).toBeLessThan(500);
    expect(t2 - t1).toBeLessThan(500);
  });
});
