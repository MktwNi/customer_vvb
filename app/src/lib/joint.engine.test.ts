/**
 * Joint quotations (package quotes, item 7) in the engine, against the real team script (team-sync/Code.gs in
 * the simulator): making one (reused and new member rows, the file on the header, the members' QUOTATION),
 * "รวมเป็นใบเสนอราคาร่วม" (the quotation moves: one live record per file, the same ids, the copy kept),
 * changing the companies, closing and reopening the group, cancelling it and deleting a member, the
 * one-row-per-company rules, the CSV, a teammate's browser and the sheet, and who may do it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { cashLines, cashYear, dealMoney, jointOf, jointRole, salesStats, toJqm, type Deal } from './sales';
import { jointNote, strayDocs } from './joint';
// the second review's fixes
import { customersOf, filterDeals, normSalesFilter, stepOf } from './sales';
import { jointNo, memberLine } from './joint';
import { statusView } from './salesUi';
import { qtVersions } from './quotes';
import { BUILTIN } from './caps';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/j/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-12';
const PAYER = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ';

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 200);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => vi.useRealTimers());

/** The file actions each browser sent (to count the Drive files it trashed). */
const calls = new Map<GccEngine, { action: string; fileId?: string }[]>();
function mk(name: string) {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = TODAY;
  e.store = memoryStore();
  (e as unknown as { me: () => string }).me = () => name;
  e.rebuild();
  e.loading = false;
  const log: { action: string; fileId?: string }[] = [];
  calls.set(e, log);
  e.transport = async (_u, body) => sim.post(body);
  e.fileTransport = async (_u, body) => {
    log.push({ action: String(body.action), fileId: body.fileId as string | undefined });
    return sim.post(body);
  };
  return e;
}
async function team() {
  sim = createGasSim({ teamKey: KEY });
  const A = mk('หมิว'), B = mk('มินท์');
  for (const e of [A, B]) expect(await e.teamConnect(URL, KEY)).toBe(true);
  return [A, B] as const;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(...es: GccEngine[]) {
  for (let i = 0; i < 3; i++)
    for (const e of es) {
      await e.teamSyncNow();
      await tick();
    }
}
function sheet(k: string): unknown {
  const r = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k === k);
  const l = r[r.length - 1];
  return !l ? undefined : l.del ? null : l.v;
}
const sheetKeys = (pre: string) => {
  const last = new Map<string, boolean>();
  sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.forEach((r) => r.k.startsWith(pre) && last.set(r.k, !r.del));
  return [...last].filter(([, live]) => live).map(([k]) => k).sort();
};
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const qt = (amount: number, o: { docNo?: string; docDate?: string; revise?: string } = {}) => ({
  kind: 'quotation' as const, amount, target: 'forecast' as const, basis: 'total' as const, detected: amount, docNo: o.docNo ?? 'QT-2569-052', docDate: o.docDate ?? '2026-10-06', stage: 'QUOTATION', ...(o.revise ? { revise: o.revise } : {}),
});
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);
const deal = (e: GccEngine, client: string, p: Partial<Deal> = {}) => e.addDeal({ client, section: 'Event Exhibition', year: '2569', ...p });
const spec = (over: Partial<Parameters<GccEngine['createJoint']>[0]> = {}) => ({
  title: 'CFP ' + PAYER + ' (มจพ)', payer: PAYER, payerGid: null, year: '2569', section: 'Event Exhibition', resp: 'หมิว', service: ['CFP'],
  total: 1284000, docNo: 'QT-2569-052', docDate: '2026-10-06', basis: 'total' as const, detected: 1284000, members: [], ...over,
});

describe('making a joint quotation', () => {
  it('the header (the payer\'s row), its mark, a membership per company (a row reused, or a new one), the file on the header, every QUOTATION noted', async () => {
    const [A, B] = await team();
    const reuse = deal(A, 'บางกอกสตีล เวิร์คส์', { forecast: 50000, resp: 'หมิว' });
    const own = deal(A, 'ไทยเบฟ รีไซเคิล', { resp: 'คุณบี' });
    await A.attachDoc(own.id, pdf('own.pdf'), qt(80000, { docNo: 'QT-2569-030' }));
    const co = A.B.companies.find((c) => !A.dealsOf(c.id).length)!;
    const plain = deal(A, 'ไทยพลาสติกรีไซเคิล', { forecast: 100000 });
    later();
    const { hid, attachErr } = await A.createJoint({
      ...spec(), file: pdf('QT-2569-052 CFP มจพ.pdf'),
      members: [{ deal: reuse.id, share: null, pct: null }, { deal: own.id, like: own.id, share: null, pct: null }, { gid: co.id, share: 300000, pct: null }, { name: 'โคราช ซีเมนต์', share: null, pct: 25 }],
    });
    expect(attachErr).toBe('');
    const S = A.sales, h = S.deals[hid];
    expect(h).toMatchObject({ client: PAYER, year: '2569', section: 'Event Exhibition', resp: 'หมิว', service: ['CFP'], forecast: null });
    expect(jointRole(S, h)).toBe('header');
    const g = jointOf(S, h)!;
    expect(g.qt.title).toBe('CFP ' + PAYER + ' (มจพ)');
    expect(g.members).toHaveLength(4);
    // a row without a quotation of its own is reused; one with its own gets a new row (it keeps its money)
    expect(g.members[0].deal.id).toBe(reuse.id);
    expect(g.members[1].deal.id).not.toBe(own.id);
    expect(g.members[1].deal).toMatchObject({ client: 'ไทยเบฟ รีไซเคิล', resp: 'คุณบี', section: 'Event Exhibition', year: '2569' });
    expect(dealMoney(S, S.deals[own.id]).forecast).toBe(80000);
    expect(g.members[2].deal.gid).toBe(co.id);
    expect(g.members[3].deal.client).toBe('โคราช ซีเมนต์');
    expect(g.members.map((x) => [x.m.share, x.m.pct])).toEqual([[null, null], [null, null], [300000, null], [null, 25]]);
    // the quotation is the header's: its Forecast, once; the members' QUOTATION is done by it
    expect(dealMoney(S, h)).toMatchObject({ forecast: 1284000, fcConfirmed: true });
    expect(qtVersions(S, h)).toHaveLength(1);
    g.members.forEach((x) => expect(S.steps[`${x.deal.id}/QUOTATION`]).toEqual({ d: '2026-10-06', n: jointNote('QT-2569-052') }));
    expect(S.steps[`${own.id}/QUOTATION`].n).toBe('ใบเสนอราคา QT-2569-030 · 80,000 บาท');
    const st = salesStats(S, Object.values(S.deals), TODAY);
    expect(st.forecast).toBe(1284000 + 80000 + 100000 + 0);
    expect(st.total).toBe(Object.keys(S.deals).length - 1);
    expect(Object.values(S.log).filter((l) => l.deal === hid).map((l) => l.action)).toEqual(expect.arrayContaining(['สร้างใบเสนอราคาร่วม']));
    // the sheet and a teammate's browser
    await settle(A, B);
    expect(sheet('jqt/' + hid)).toMatchObject({ title: g.qt.title, by: 'หมิว' });
    expect(sheetKeys('jqm/' + hid + '/')).toEqual(g.members.map((x) => `jqm/${hid}/${x.deal.id}`).sort());
    expect(jointOf(B.sales, { id: hid })!.members.map((x) => x.deal.id)).toEqual(g.members.map((x) => x.deal.id));
    expect(salesStats(B.sales, Object.values(B.sales.deals), TODAY).forecast).toBe(st.forecast);
    expect(plain.id in B.sales.deals).toBe(true);
    A.dispose();
    B.dispose();
  });

  it('"รวมเป็นใบเสนอราคาร่วม": the quotation moves with every version (same ids, one live record per file, this browser\'s copy kept), the deal becomes its first company', async () => {
    const [A, B] = await team();
    const x = deal(A, 'บางกอกสตีล เวิร์คส์', { resp: 'หมิว' });
    const v1 = await A.attachDoc(x.id, pdf('v1.pdf'), qt(1350000, { docDate: '2026-10-04' }));
    later();
    const v2 = await A.attachDoc(x.id, pdf('v2.pdf'), qt(1284000, { docDate: '2026-10-06', revise: v1.id }));
    await settle(A, B);
    const files = [v1, v2].map((v) => A.sales.docs[`${x.id}/${v.id}`].fileId);
    expect(files.every(Boolean)).toBe(true);
    const y = deal(A, 'อุดร ไบโอแมส', { resp: 'คุณบี' });
    later();
    const { hid } = await A.createJoint({ ...spec({ total: 1284000 }), from: x.id, members: [{ deal: x.id, share: null, pct: null }, { deal: y.id, share: null, pct: null }] });
    const S = A.sales;
    expect(qtVersions(S, { id: x.id })).toEqual([]);
    expect(qtVersions(S, { id: hid }).map((d) => d.id)).toEqual([v1.id, v2.id]);
    expect(dealMoney(S, S.deals[hid])).toMatchObject({ forecast: 1284000 });
    expect(dealMoney(S, S.deals[hid]).fcDoc!.id).toBe(v2.id);
    expect(jointOf(S, { id: hid })!.members.map((m) => m.deal.id)).toEqual([x.id, y.id]);
    // the header's QUOTATION names the quotation (and follows it); the deal's own now names the joint one
    expect(S.steps[`${hid}/QUOTATION`]).toEqual({ d: '2026-10-04', n: 'ใบเสนอราคา QT-2569-052 · 1,284,000 บาท' });
    expect(S.steps[`${x.id}/QUOTATION`]).toEqual({ d: '2026-10-04', n: jointNote('QT-2569-052') });
    // a move, not a copy: no file trashed, the copy in this browser kept (same document id)
    expect(calls.get(A)!.filter((c) => c.action === 'delfile')).toEqual([]);
    expect(await A.store.get('docblob:' + v2.id)).toBeTruthy();
    await settle(A, B);
    const live = Object.values(B.sales.docs).filter((d) => files.includes(d.fileId));
    expect(live.map((d) => [d.deal, d.id])).toEqual([[hid, v1.id], [hid, v2.id]]);
    expect(sheet(`ddoc/${x.id}/${v2.id}`)).toBeNull();
    expect(sheet(`ddoc/${hid}/${v2.id}`)).toMatchObject({ fileId: files[1], target: 'forecast' });
    // counted once: the deal's quotation no longer counts on its row
    expect(salesStats(B.sales, Object.values(B.sales.deals), TODAY).forecast).toBe(1284000);
    A.dispose();
    B.dispose();
  });
});

describe('changing, closing, cancelling', () => {
  async function made() {
    const [A, B] = await team();
    const ms = ['บางกอกสตีล', 'อุดร ไบโอแมส', 'สยามฟู้ดส์', 'โคราช ซีเมนต์'].map((n, i) => deal(A, n, { resp: ['หมิว', 'คุณบี', 'มกร', 'คุณเอ'][i] }));
    later();
    const { hid } = await A.createJoint({ ...spec(), file: pdf('qt.pdf'), members: ms.map((d) => ({ deal: d.id, share: null, pct: null })) });
    await settle(A, B);
    return { A, B, hid, ms };
  }

  it('the companies: one leaves (its row stays, without the note), one joins, parts typed here and by a teammate both kept', async () => {
    const { A, B, hid, ms } = await made();
    const extra = deal(A, 'ไทยพลาสติกรีไซเคิล');
    await settle(A, B);
    later();
    A.setJointMembers(hid, [{ deal: ms[0].id, share: 500000, pct: null }, { deal: ms[1].id, share: null, pct: null }, { deal: ms[2].id, share: null, pct: null }, { deal: extra.id, share: null, pct: null }]);
    // the teammate types another company's part meanwhile
    B.setJointMembers(hid, [{ deal: ms[0].id, share: null, pct: null }, { deal: ms[1].id, share: null, pct: 30 }, { deal: ms[2].id, share: null, pct: null }, { deal: ms[3].id, share: null, pct: null }]);
    const S = A.sales;
    expect(ms[3].id in S.deals).toBe(true);
    expect(S.steps[`${ms[3].id}/QUOTATION`]).toBeUndefined();
    expect(S.steps[`${extra.id}/QUOTATION`].n).toBe(jointNote('QT-2569-052'));
    await settle(A, B);
    await settle(A, B);
    // the last write of each membership wins, field by field: A's share of the first, B's % of the second
    expect(toJqm(sheet(`jqm/${hid}/${ms[0].id}`))).toMatchObject({ share: 500000 });
    expect(toJqm(sheet(`jqm/${hid}/${ms[1].id}`))).toMatchObject({ pct: 30 });
    expect(jointOf(A.sales, { id: hid })!.members.map((x) => [x.m.share, x.m.pct])).toEqual(jointOf(B.sales, { id: hid })!.members.map((x) => [x.m.share, x.m.pct]));
    A.dispose();
    B.dispose();
  });

  it('closing closes the header and every company in one push; reopening brings back the whole group (one closed alone earlier, by an older build, too)', async () => {
    const { A, B, hid, ms } = await made();
    A.setStep(ms[3].id, 'CLOSED DEAL', { d: '2026-08-02', n: 'NO' });
    vi.setSystemTime(new Date('2026-10-05T03:00:00Z'));
    A.updateDeal(ms[3].id, { jobStatus: 'closed' });
    vi.setSystemTime(new Date('2026-10-12T05:00:00Z'));
    expect(A.closeJoint(hid)).toBe(4);
    const all = [hid, ...ms.map((d) => d.id)];
    expect(all.map((id) => A.sales.deals[id].jobStatus)).toEqual(['closed', 'closed', 'closed', 'closed', 'closed']);
    await settle(A, B);
    expect(all.map((id) => B.sales.deals[id].jobStatus)).toEqual(['closed', 'closed', 'closed', 'closed', 'closed']);
    expect(B.reopenJoint(hid)).toBe(5);
    expect(all.map((id) => B.sales.deals[id].jobStatus)).toEqual(['open', 'open', 'open', 'open', 'open']);
    A.dispose();
    B.dispose();
  });

  it('cancelling deletes the header with its quotation (the file to the trash), plan and memberships; the companies stay, without its note', async () => {
    const { A, B, hid, ms } = await made();
    const file = Object.values(A.sales.docs).find((d) => d.deal === hid)!.fileId;
    expect(file).toBeTruthy();
    A.updatePayLine(hid, 'PAY1', { amt: 642000, rel: 30 });
    A.cancelJoint(hid);
    expect(hid in A.sales.deals).toBe(false);
    expect(A.sales.jqt?.[hid]).toBeUndefined();
    expect(Object.keys(A.sales.jqm || {})).toEqual([]);
    ms.forEach((d) => {
      expect(A.sales.deals[d.id]).toBeTruthy();
      expect(jointRole(A.sales, d)).toBe('plain');
      expect(A.sales.steps[`${d.id}/QUOTATION`]).toBeUndefined();
    });
    await settle(A, B);
    expect(calls.get(A)!.filter((c) => c.action === 'delfile').map((c) => c.fileId)).toEqual([file]);
    expect(sheet('jqt/' + hid)).toBeNull();
    expect(sheetKeys('jqm/')).toEqual([]);
    expect(sheetKeys('dpay/' + hid)).toEqual([]);
    expect(hid in B.sales.deals).toBe(false);
    expect(ms.every((d) => jointRole(B.sales, d) === 'plain')).toBe(true);
    A.dispose();
    B.dispose();
  });

  it('deleting a member deal takes its membership along', async () => {
    const { A, B, hid, ms } = await made();
    A.deleteDeal(ms[1].id);
    expect(A.sales.jqm?.[`${hid}/${ms[1].id}`]).toBeUndefined();
    await settle(A, B);
    expect(sheet(`jqm/${hid}/${ms[1].id}`)).toBeNull();
    expect(jointOf(B.sales, { id: hid })!.members).toHaveLength(3);
    A.dispose();
    B.dispose();
  });
});

describe('one row per company and year; the CSV; money once in Cashflow', () => {
  it('the payer\'s header is not the company\'s own row (it can be sent to the table); a member\'s row is', async () => {
    const [A] = await team();
    const payer = A.B.companies[3], member = A.B.companies[4];
    const m = A.addDeal({ gid: member.id, year: '2569' });
    later();
    const { hid } = await A.createJoint({ ...spec({ payer: payer.name, payerGid: payer.id }), members: [{ deal: m.id, share: null, pct: null }] });
    expect(A.sales.deals[hid].gid).toBe(payer.id);
    // no file: the total is the header's typed Forecast until the quotation is attached
    expect(dealMoney(A.sales, A.sales.deals[hid])).toMatchObject({ forecast: 1284000, fcConfirmed: false });
    const r = A.addDealsFromCompanies([payer.id, member.id], { year: '2569' });
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect(A.dealsOf(payer.id).filter((d) => d.year === '2569')).toHaveLength(2);
    A.dispose();
  });

  it('the CSV says which rows belong to a joint quotation; a member\'s money cells stay empty (its share said), the header carries it', async () => {
    const [A] = await team();
    const b = deal(A, 'บางกอกสตีล', { forecast: 50000 });
    const c = deal(A, 'อุดร ไบโอแมส');
    later();
    const { hid } = await A.createJoint({ ...spec(), file: pdf('qt.pdf'), members: [{ deal: b.id, share: null, pct: null }, { deal: c.id, share: null, pct: null }] });
    A.setStep(hid, 'CLOSED DEAL', { d: '2026-10-07', n: 'YES' });
    A.updatePayLine(hid, 'PAY1', { amt: 1284000, rel: 30 });
    const S = A.sales;
    const csv = A.salesCsv([S.deals[hid], S.deals[b.id]]).split('\r\n');
    const head = csv[0].split('","');
    const at = (k: string) => head.findIndex((x) => x.replace(/"/g, '') === k);
    const cell = (row: string, k: string) => row.split('","')[at(k)]?.replace(/"/g, '');
    expect(at('ใบเสนอราคาร่วม')).toBeGreaterThan(0);
    expect(csv[0].endsWith('"แผนชำระ"')).toBe(true);
    // (the payer first, then the quotation: the screens' order)
    expect(cell(csv[1], 'ใบเสนอราคาร่วม')).toBe(`${PAYER} · ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ · ผู้จ่าย · 2 บริษัท`);
    expect(cell(csv[1], 'FORECAST (บาท)')).toBe('1284000');
    expect(cell(csv[2], 'ใบเสนอราคาร่วม')).toBe(`${PAYER} · ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ · บริษัทร่วม · ส่วนแบ่ง 642,000`);
    expect(cell(csv[2], 'FORECAST (บาท)')).toBe('');
    // Cashflow: the payer's installment, once, with the member count
    const lines = cashLines(S, Object.values(S.deals), TODAY);
    expect(lines.map((l) => [l.deal.id, l.amt, l.joint?.members])).toEqual([[hid, 1284000, 2]]);
    A.dispose();
  });
});

describe('who may', () => {
  it('a viewer (accounts) makes no joint quotation; an account with สร้างใบเสนอราคาร่วม does; the script stores the records', async () => {
    sim = createGasSim({ teamKey: '', kdfIter: 1000 });
    sim.setup();
    const LS = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => LS.get(k) ?? null, setItem: (k: string, v: string) => void LS.set(k, String(v)), removeItem: (k: string) => void LS.delete(k) });
    try {
      const L = mk('');
      (L as unknown as { me: () => string }).me = GccEngine.prototype.me;
      L.homeTeam = '';
      expect(await L.teamOpen(URL)).toBe('setup');
      await L.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
      expect(L.canJoint()).toBe(true);
      const { temp } = await L.adminCreate({ u: 'pla', name: 'ปลา', role: 'viewer' });
      const V = mk('');
      (V as unknown as { me: () => string }).me = GccEngine.prototype.me;
      V.homeTeam = '';
      expect(await V.teamOpen(URL)).toBe('accounts');
      // (a second browser: the session lives in its own localStorage)
      LS.clear();
      await V.teamLogin('pla', temp, true);
      await V.teamChangePassword('', 'pla-pass-123');
      expect(V.canJoint()).toBe(false);
      await expect(V.createJoint({ ...spec(), members: [{ name: 'x', share: null, pct: null }] })).rejects.toThrow('บัญชีของคุณสร้างใบเสนอราคาร่วมไม่ได้');
      L.dispose();
      V.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ------------------------------------------------------------------ the review's findings, end to end

describe('review: a row with a job of its own keeps it', () => {
  it('a closed row with a typed Actual, and one received by hand on its plan, are never reused: new rows join, the money stays', async () => {
    const [A, B] = await team();
    // seed-c's พฤกษา: closed, a typed Actual of 180,000, no documents
    const closed = deal(A, 'บริษัท พฤกษา โฮลดิ้ง จำกัด', { resp: 'คุณเอ', forecast: 180000, actual: 180000 });
    A.updateDeal(closed.id, { jobStatus: 'closed' });
    const hand = deal(A, 'ไทยพลาสติกรีไซเคิล', { resp: 'หมิว' });
    A.setStep(hand.id, 'CLOSED DEAL', { d: '2026-09-01', n: 'YES' });
    A.updatePayLine(hand.id, 'PAY1', { amt: 60000, due: '2026-09-30' });
    A.markPaid(hand.id, 'PAY1', { date: '2026-09-28', amount: null });
    const typed = deal(A, 'สยามฟู้ดส์', { resp: 'มกร', actual: 80000 });
    const free = deal(A, 'อุดร ไบโอแมส', { resp: 'คุณบี', forecast: 50000 });
    expect([closed, hand, typed, free].map((d) => A.jointFate(A.sales.deals[d.id]))).toEqual(['new', 'new', 'new', 'reuse']);
    const S = A.sales, all = () => Object.values(S.deals);
    const before = salesStats(S, all(), TODAY), got0 = cashYear(cashLines(S, all(), TODAY), '2569').totals.got;
    expect(before.actual).toBe(180000 + 60000 + 80000);
    later();
    const { hid } = await A.createJoint({ ...spec(), members: [closed, hand, typed, free].map((d) => ({ deal: d.id, share: null, pct: null })) });
    const g = jointOf(S, { id: hid })!;
    // three new rows of those companies, the free row reused
    expect(g.members.map((x) => x.deal.id).filter((id) => [closed.id, hand.id, typed.id].includes(id))).toEqual([]);
    expect(g.members.map((x) => x.deal.client)).toEqual(['บริษัท พฤกษา โฮลดิ้ง จำกัด', 'ไทยพลาสติกรีไซเคิล', 'สยามฟู้ดส์', 'อุดร ไบโอแมส']);
    expect(g.members[3].deal.id).toBe(free.id);
    expect([closed, hand, typed].map((d) => jointRole(S, d))).toEqual(['plain', 'plain', 'plain']);
    // nothing received disappears: the KPI Actual and Cashflow's received money as before
    const after = salesStats(S, all(), TODAY);
    expect(after.actual).toBe(before.actual);
    expect(cashYear(cashLines(S, all(), TODAY), '2569').totals.got).toBe(got0);
    expect(after.forecast).toBe(before.forecast - 50000 + 1284000); // the reused row's typed Forecast gives way to the quotation
    await settle(A, B);
    expect(salesStats(B.sales, Object.values(B.sales.deals), TODAY).actual).toBe(before.actual);
    A.dispose();
    B.dispose();
  });

  it('"รวมเป็นใบเสนอราคาร่วม" is refused from a deal with money received, a plan or closed (its quotation stays)', async () => {
    const [A] = await team();
    const x = deal(A, 'บางกอกสตีล เวิร์คส์', { resp: 'หมิว' });
    const v1 = await A.attachDoc(x.id, pdf('v1.pdf'), qt(1284000));
    A.setStep(x.id, 'CLOSED DEAL', { d: '2026-10-07', n: 'YES' });
    A.updatePayLine(x.id, 'PAY1', { amt: 100000, due: '2026-10-09' });
    later();
    await expect(A.createJoint({ ...spec(), from: x.id, members: [{ deal: x.id, share: null, pct: null }] })).rejects.toThrow('รวมเป็นใบเสนอราคาร่วมไม่ได้');
    expect(Object.keys(A.sales.jqt || {})).toEqual([]);
    expect(qtVersions(A.sales, { id: x.id }).map((d) => d.id)).toEqual([v1.id]);
    A.dispose();
  });
});

describe('review: a member holds no money of its own', () => {
  async function made() {
    const [A, B] = await team();
    const ms = ['บางกอกสตีล', 'อุดร ไบโอแมส'].map((n, i) => deal(A, n, { resp: ['หมิว', 'คุณบี'][i] }));
    later();
    const { hid } = await A.createJoint({ ...spec(), file: pdf('qt.pdf'), members: ms.map((d) => ({ deal: d.id, share: null, pct: null })) });
    await settle(A, B);
    return { A, B, hid, ms };
  }
  it('a quotation attached at a member is kept as a document that is not counted, at no stage', async () => {
    const { A, B, hid, ms } = await made();
    const S = A.sales, k0 = salesStats(S, Object.values(S.deals), TODAY);
    const doc = await A.attachDoc(ms[1].id, pdf('member-qt.pdf'), qt(1284000));
    expect(S.docs[`${ms[1].id}/${doc.id}`]).toMatchObject({ target: 'none', stage: '' });
    expect(strayDocs(S, S.deals[ms[1].id])).toEqual([]);
    expect(qtVersions(S, { id: ms[1].id })).toEqual([]);
    const k1 = salesStats(S, Object.values(S.deals), TODAY);
    expect([k1.forecast, k1.actual]).toEqual([k0.forecast, k0.actual]);
    // a receipt too
    const r = await A.attachDoc(ms[0].id, pdf('rc.pdf'), { ...qt(50000), kind: 'receipt', target: 'actual', stage: 'PAY1' });
    expect(S.docs[`${ms[0].id}/${r.id}`]).toMatchObject({ target: 'none', stage: '' });
    expect(salesStats(S, Object.values(S.deals), TODAY).actual).toBe(0);
    expect(hid in S.deals).toBe(true);
    A.dispose();
    B.dispose();
  });
  it('"ย้ายไปใบเสนอราคาร่วม": a quotation a teammate attached before the company joined moves to the joint quotation', async () => {
    const [A, B] = await team();
    const x = deal(A, 'บางกอกสตีล', { resp: 'หมิว' }), y = deal(A, 'อุดร ไบโอแมส', { resp: 'คุณบี' });
    await settle(A, B);
    // B attaches a quotation to x while A, not seeing it yet, puts x in a joint quotation without a file
    const v = await B.attachDoc(x.id, pdf('x.pdf'), qt(900000, { docNo: 'QT-2569-077' }));
    later();
    const { hid } = await A.createJoint({ ...spec({ total: null, docNo: '' }), members: [{ deal: x.id, share: null, pct: null }, { deal: y.id, share: null, pct: null }] });
    await settle(A, B);
    await settle(A, B);
    const S = A.sales;
    expect(jointRole(S, S.deals[x.id])).toBe('member');
    expect(strayDocs(S, S.deals[x.id]).map((d) => d.id)).toEqual([v.id]);
    expect(salesStats(S, Object.values(S.deals), TODAY).forecast).toBe(0); // counted nowhere
    const file = S.docs[`${x.id}/${v.id}`].fileId;
    expect(A.moveToJoint(x.id, v.id)).toBe('qt');
    // the joint quotation had none: it is its quotation now (same id, the file kept), counted once
    expect(qtVersions(S, { id: hid }).map((d) => d.id)).toEqual([v.id]);
    expect(dealMoney(S, S.deals[hid])).toMatchObject({ forecast: 900000, fcConfirmed: true });
    expect(strayDocs(S, S.deals[x.id])).toEqual([]);
    expect(salesStats(S, Object.values(S.deals), TODAY).forecast).toBe(900000);
    await settle(A, B);
    expect(sheet(`ddoc/${x.id}/${v.id}`)).toBeNull();
    expect(sheet(`ddoc/${hid}/${v.id}`)).toMatchObject({ fileId: file });
    expect(calls.get(A)!.filter((c) => c.action === 'delfile')).toEqual([]);
    // another stray one, now that the joint quotation has its quotation: kept there, not counted
    const w = await B.attachDoc(y.id, pdf('y.pdf'), { ...qt(5000), kind: 'invoice', target: 'actual', stage: 'PAY1' });
    // (B's build holds it to "not counted" already; an older build would not: play its record)
    B.sales.docs[`${y.id}/${w.id}`] = { ...B.sales.docs[`${y.id}/${w.id}`], target: 'actual', stage: 'PAY1' };
    A.sales.docs[`${y.id}/${w.id}`] = { ...B.sales.docs[`${y.id}/${w.id}`] };
    expect(strayDocs(S, S.deals[y.id]).map((d) => d.id)).toEqual([w.id]);
    expect(A.moveToJoint(y.id, w.id)).toBe('doc');
    expect(S.docs[`${hid}/${w.id}`]).toMatchObject({ target: 'none', stage: '' });
    expect(salesStats(S, Object.values(S.deals), TODAY)).toMatchObject({ forecast: 900000, actual: 0 });
    A.dispose();
    B.dispose();
  });
});

describe('review: the year of a joint quotation\'s companies', () => {
  it('a member moved to another year leaves the joint quotation; the header takes every company along', async () => {
    const [A, B] = await team();
    const ms = ['บางกอกสตีล', 'อุดร ไบโอแมส', 'สยามฟู้ดส์'].map((n, i) => deal(A, n, { resp: ['หมิว', 'คุณบี', 'มกร'][i] }));
    later();
    const { hid } = await A.createJoint({ ...spec(), file: pdf('qt.pdf'), members: ms.map((d) => ({ deal: d.id, share: null, pct: null })) });
    const S = A.sales;
    A.updateDeal(ms[0].id, { year: '2570' });
    expect(S.deals[ms[0].id].year).toBe('2570');
    expect(jointRole(S, S.deals[ms[0].id])).toBe('plain');
    expect(S.steps[`${ms[0].id}/QUOTATION`]).toBeUndefined();
    expect(jointOf(S, { id: hid })!.members.map((x) => x.deal.id)).toEqual([ms[1].id, ms[2].id]);
    // the 2569 summary has no part for it any more
    const st = salesStats(S, Object.values(S.deals).filter((d) => d.year === '2569'), TODAY);
    expect(st.byResp['หมิว']?.forecast || 0).toBe(0);
    expect(st.forecast).toBe(1284000);
    // the header: every company with it
    A.updateDeal(hid, { year: '2570' });
    expect([hid, ms[1].id, ms[2].id].map((id) => S.deals[id].year)).toEqual(['2570', '2570', '2570']);
    expect(jointOf(S, { id: hid })!.members).toHaveLength(2);
    await settle(A, B);
    expect([hid, ms[1].id, ms[2].id].map((id) => B.sales.deals[id].year)).toEqual(['2570', '2570', '2570']);
    expect(sheet(`jqm/${hid}/${ms[0].id}`)).toBeNull();
    A.dispose();
    B.dispose();
  });
});

describe('review: an account limited to its own deals', () => {
  it('cannot put another person\'s row in a joint quotation (refused, nothing written); its own rows join; a role without ดีลและขั้นตอน makes none', async () => {
    sim = createGasSim({ teamKey: '', kdfIter: 1000 });
    sim.setup();
    const LS = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => LS.get(k) ?? null, setItem: (k: string, v: string) => void LS.set(k, String(v)), removeItem: (k: string) => void LS.delete(k) });
    try {
      const L = mk('');
      (L as unknown as { me: () => string }).me = GccEngine.prototype.me;
      L.homeTeam = '';
      expect(await L.teamOpen(URL)).toBe('setup');
      await L.teamClaim(sim.ownerCode()!, 'lead', 'หมิว', 'lead-pass-123');
      const { temp } = await L.adminCreate({ u: 'aek', name: 'เอก', role: 'sales' });
      const { id: own } = await L.roleSave({ n: 'ขายเฉพาะงานตัวเอง', d: '', c: { ...BUILTIN.sales.c, 'edit.deal': 'own', 'edit.pay': 'own' } });
      await L.adminUpdate('aek', { role: own });
      const { 'edit.deal': _no, ...noDealCaps } = BUILTIN.sales.c;
      const { id: noDeal } = await L.roleSave({ n: 'ใบเสนอราคาร่วมอย่างเดียว', d: '', c: noDealCaps });
      const { temp: temp2 } = await L.adminCreate({ u: 'pla', name: 'ปลา', role: 'sales' });
      await L.adminUpdate('pla', { role: noDeal });
      const other = L.addDeal({ client: 'บริษัท ของหมิว จำกัด', resp: 'หมิว', year: '2569', section: 'Event Exhibition', forecast: 400000 });
      await L.teamSyncNow();
      const E = mk('');
      (E as unknown as { me: () => string }).me = GccEngine.prototype.me;
      E.homeTeam = '';
      expect(await E.teamOpen(URL)).toBe('accounts');
      LS.clear();
      await E.teamLogin('aek', temp, true);
      await E.teamChangePassword('', 'aek-pass-123');
      await E.teamSyncNow();
      const o = E.sales.deals[other.id];
      expect(E.canDeal('edit.deal', o)).toBe(false);
      expect(E.canJoint()).toBe(true);
      expect(E.jointFate(o)).toBe('locked');
      const f0 = salesStats(E.sales, Object.values(E.sales.deals), TODAY).forecast;
      await expect(E.createJoint({ ...spec({ resp: 'เอก', total: 10 }), members: [{ deal: other.id, share: null, pct: null }] })).rejects.toThrow('บัญชีของคุณใส่แถวนี้ในใบเสนอราคาร่วมไม่ได้');
      expect(Object.keys(E.sales.jqt || {})).toEqual([]);
      // its own row joins
      const mine = E.addDeal({ client: 'บริษัท ของเอก จำกัด', year: '2569', section: 'Event Exhibition' });
      expect(mine.resp).toBe('เอก');
      later();
      const { hid } = await E.createJoint({ ...spec({ resp: 'เอก', total: 10 }), members: [{ deal: mine.id, share: null, pct: null }] });
      expect(E.sales.deals[hid].resp).toBe('เอก');
      // and adding the other's row later is refused too (said, nothing written)
      E.setJointMembers(hid, [{ deal: mine.id, share: null, pct: null }, { deal: other.id, share: null, pct: null }]);
      expect(E.teamNote).toContain('บัญชีของคุณใส่แถวนี้ในใบเสนอราคาร่วมไม่ได้');
      expect(jointRole(E.sales, E.sales.deals[other.id])).toBe('plain');
      await E.teamSyncNow();
      expect(jointRole(E.sales, E.sales.deals[other.id])).toBe('plain');
      expect(salesStats(E.sales, Object.values(E.sales.deals), TODAY).forecast).toBe(f0 + 10);
      // the sheet: the joint quotation and its own member only
      const rows = sim.post({ action: 'pull', since: 0, cv: 5, tok: E.session!.tok }).rows!.filter((r) => r.k.startsWith('jqm/')).map((r) => r.k);
      expect(rows).toEqual([`jqm/${hid}/${mine.id}`]);
      // a role with สร้างใบเสนอราคาร่วม but no ดีลและขั้นตอน makes none
      const P = mk('');
      (P as unknown as { me: () => string }).me = GccEngine.prototype.me;
      P.homeTeam = '';
      expect(await P.teamOpen(URL)).toBe('accounts');
      LS.clear();
      await P.teamLogin('pla', temp2, true);
      await P.teamChangePassword('', 'pla-pass-123');
      expect(P.can('edit.jqt')).toBe(true);
      expect(P.canJoint()).toBe(false);
      await expect(P.createJoint({ ...spec(), members: [{ name: 'x', share: null, pct: null }] })).rejects.toThrow('บัญชีของคุณสร้างใบเสนอราคาร่วมไม่ได้');
      L.dispose();
      E.dispose();
      P.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ------------------------------------------------------------------ the second review's findings

describe('review 2: a joint quotation made without its file', () => {
  it('records the number and the date typed at the header\'s QUOTATION, as its companies\' (the band, the search and the members\' line have them); the file attached later takes over', async () => {
    const [A, B] = await team();
    const ms = ['บางกอกสตีล เวิร์คส์', 'อุดร ไบโอแมส', 'สยามฟู้ดส์ แปรรูป'].map((n, i) => deal(A, n, { resp: ['หมิว', 'คุณบี', 'มกร'][i] }));
    later();
    const { hid, attachErr } = await A.createJoint({ ...spec({ total: 900000, docNo: 'QT-2569-099', docDate: '2026-10-08' }), members: ms.map((d) => ({ deal: d.id, share: null, pct: null })) });
    expect(attachErr).toBe('');
    const S = A.sales, h = S.deals[hid], g = jointOf(S, h)!;
    // the header says what its companies say: sent on the day typed, under the number typed
    expect(stepOf(S, hid, 'QUOTATION')).toEqual({ d: '2026-10-08', n: jointNote('QT-2569-099') });
    g.members.forEach((x) => expect(stepOf(S, x.deal.id, 'QUOTATION')).toEqual({ d: '2026-10-08', n: jointNote('QT-2569-099') }));
    expect(jointNo(S, g)).toBe('QT-2569-099');
    expect(memberLine(S, ms[1], true)).toBe('อยู่ในใบเสนอราคาร่วม QT-2569-099 (มจพ) · ร่วมกับอีก 2 บริษัท · ส่วนแบ่ง 300,000 (33%)');
    expect(dealMoney(S, h)).toMatchObject({ forecast: 900000, fcConfirmed: false });
    expect(statusView(S, h, TODAY).word).toBe('กำลังติดตาม');
    // its number finds the header and every company: the KPI counts the money once, not 0
    const found = filterDeals(S, normSalesFilter({ year: '2569', q: 'QT-2569-099' }), TODAY);
    expect(found.map((d) => d.id).sort()).toEqual([hid, ...ms.map((d) => d.id)].sort());
    expect(salesStats(S, found, TODAY)).toMatchObject({ forecast: 900000, total: 3 });
    // a teammate's browser and the sheet: existing records only (dstep/)
    await settle(A, B);
    expect(sheet(`dstep/${hid}/QUOTATION`)).toEqual({ d: '2026-10-08', n: jointNote('QT-2569-099') });
    expect(jointNo(B.sales, jointOf(B.sales, { id: hid })!)).toBe('QT-2569-099');
    // the file, attached later at the joint quotation's card: its note and its figure take over
    later();
    await A.attachDoc(hid, pdf('QT-2569-099.pdf'), qt(905000, { docNo: 'QT-2569-099', docDate: '2026-10-08' }));
    expect(stepOf(S, hid, 'QUOTATION')).toEqual({ d: '2026-10-08', n: 'ใบเสนอราคา QT-2569-099 · 905,000 บาท' });
    expect(dealMoney(S, S.deals[hid])).toMatchObject({ forecast: 905000, fcConfirmed: true });
    expect(jointNo(S, jointOf(S, { id: hid })!)).toBe('QT-2569-099');
    A.dispose();
    B.dispose();
  });

  it('a date ahead of today is recorded as today; a file that could not be attached leaves what was typed (the total, the number)', async () => {
    const A = mk('หมิว');
    const m1 = deal(A, 'บางกอกสตีล'), m2 = deal(A, 'อุดร ไบโอแมส');
    later();
    const a = await A.createJoint({ ...spec({ total: 500000, docNo: 'QT-2569-120', docDate: '2026-11-30' }), members: [{ deal: m1.id, share: null, pct: null }] });
    expect(stepOf(A.sales, a.hid, 'QUOTATION')).toEqual({ d: TODAY, n: jointNote('QT-2569-120') });
    // this browser cannot keep the file (and no team to send it to): the joint quotation stands on what was typed
    const set0 = A.store.set.bind(A.store);
    A.store.set = async (k, v) => (String(k).startsWith('docblob:') ? Promise.reject(new Error('quota')) : set0(k, v));
    later();
    const b = await A.createJoint({ ...spec({ total: 700000, docNo: 'QT-2569-121' }), file: pdf('qt.pdf'), members: [{ deal: m2.id, share: null, pct: null }] });
    expect(b.attachErr).toContain('บันทึกไฟล์ในเบราว์เซอร์ไม่สำเร็จ');
    expect(dealMoney(A.sales, A.sales.deals[b.hid])).toMatchObject({ forecast: 700000, fcConfirmed: false });
    expect(stepOf(A.sales, b.hid, 'QUOTATION')).toEqual({ d: '2026-10-06', n: jointNote('QT-2569-121') });
    expect(jointNo(A.sales, jointOf(A.sales, { id: b.hid })!)).toBe('QT-2569-121');
    expect(salesStats(A.sales, Object.values(A.sales.deals), TODAY).forecast).toBe(500000 + 700000);
    A.dispose();
  });
});

describe('review 2: a backup keeps its joint quotations', () => {
  /** what "ส่งออกไฟล์สำรอง" downloads (exportCrm), caught on its way to the browser */
  function exported(e: GccEngine): File {
    let blob: Blob | null = null;
    const spy = vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x'));
    vi.stubGlobal('document', { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } });
    try {
      e.exportCrm();
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(blob).not.toBeNull();
    return Object.assign(blob!, { name: 'backup.json' }) as unknown as File;
  }
  it('restored into another browser (and from there into a new team sheet): the same roles, the money once, the customers per company', async () => {
    const A = mk('หมิว');
    // the reviewer's case: two rows with typed Forecasts (80,000 and 200,000) that give way to the quotation
    const b1 = deal(A, 'บางกอกสตีล เวิร์คส์', { resp: 'หมิว', forecast: 80000 }), b2 = deal(A, 'อุดร ไบโอแมส', { resp: 'คุณบี', forecast: 200000 });
    const p1 = deal(A, 'ไทยพลาสติกรีไซเคิล', { forecast: 100000 });
    later();
    const { hid } = await A.createJoint({ ...spec(), members: [{ deal: b1.id, share: 500000, pct: null }, { deal: b2.id, share: null, pct: null }, { name: 'โคราช ซีเมนต์', share: null, pct: 25 }] });
    const all = (e: GccEngine) => Object.values(e.sales.deals);
    const roles = (e: GccEngine) => Object.fromEntries(all(e).map((d) => [d.id, jointRole(e.sales, d)]));
    const before = { roles: roles(A), st: salesStats(A.sales, all(A), TODAY), n: customersOf(A.sales, all(A)).length, g: jointOf(A.sales, { id: hid })! };
    expect(before.st.forecast).toBe(1284000 + 100000);
    const file = exported(A);
    // another browser, on its own
    const [B, C] = await team();
    const L = mk('มินท์');
    await L.importCrm(file);
    expect(roles(L)).toEqual(before.roles);
    expect(salesStats(L.sales, all(L), TODAY).forecast).toBe(before.st.forecast);
    expect(salesStats(L.sales, all(L), TODAY).byResp).toEqual(before.st.byResp);
    expect(customersOf(L.sales, all(L))).toHaveLength(before.n);
    const g = jointOf(L.sales, { id: hid })!;
    expect(g.qt).toEqual(before.g.qt);
    expect(g.members.map((x) => [x.deal.id, x.m.share, x.m.pct])).toEqual(before.g.members.map((x) => [x.deal.id, x.m.share, x.m.pct]));
    expect(p1.id in L.sales.deals).toBe(true);
    // connected to a new team sheet, the restore sends them too
    await B.importCrm(file);
    await settle(B, C);
    expect(sheet('jqt/' + hid)).toMatchObject({ title: before.g.qt.title });
    expect(sheetKeys('jqm/')).toEqual(before.g.members.map((x) => `jqm/${hid}/${x.deal.id}`).sort());
    expect(roles(C)).toEqual(before.roles);
    expect(salesStats(C.sales, all(C), TODAY).forecast).toBe(before.st.forecast);
    A.dispose();
    B.dispose();
    C.dispose();
    L.dispose();
  });
  it('a membership whose deal or joint quotation this browser does not have is left out; one it has is never overwritten', async () => {
    const A = mk('หมิว');
    const b1 = deal(A, 'บางกอกสตีล'), b2 = deal(A, 'อุดร ไบโอแมส');
    later();
    const { hid } = await A.createJoint({ ...spec(), members: [{ deal: b1.id, share: null, pct: null }, { deal: b2.id, share: null, pct: null }] });
    const file = exported(A);
    const data = JSON.parse(await file.text());
    // a hand-edited file: a membership of a deal not in the file, one of a header not marked, junk
    data.sales.jqm[`${hid}/nope`] = { share: 1, pct: null, at: '', by: '' };
    data.sales.jqm[`${b1.id}/${b2.id}`] = { share: 1, pct: null, at: '', by: '' };
    data.sales.jqm['bad'] = { share: 1 };
    data.sales.jqt['x/y'] = { title: 'x' };
    const json = JSON.stringify(data);
    const L = mk('มินท์');
    await L.importCrm({ text: async () => json } as unknown as File);
    expect(Object.keys(L.sales.jqt || {})).toEqual([hid]);
    expect(Object.keys(L.sales.jqm || {}).sort()).toEqual([`${hid}/${b1.id}`, `${hid}/${b2.id}`].sort());
    // a second restore: what this browser has stays as it is
    L.setJointMembers(hid, [{ deal: b1.id, share: 400000, pct: null }, { deal: b2.id, share: null, pct: null }]);
    await L.importCrm({ text: async () => json } as unknown as File);
    expect(L.sales.jqm![`${hid}/${b1.id}`].share).toBe(400000);
    A.dispose();
    L.dispose();
  });
});

describe('review 2: new member rows carry the joint quotation\'s Services', () => {
  it('a CFP joint quotation of new rows counts its companies in the Services chart and the Services filter; a reused row keeps its own', async () => {
    const [A] = await team();
    const co = A.B.companies.find((c) => !A.dealsOf(c.id).length)!;
    const reused = deal(A, 'บางกอกสตีล', { service: [] });
    const own = deal(A, 'ไทยเบฟ รีไซเคิล', { resp: 'คุณบี', service: ['CFO'] });
    await A.attachDoc(own.id, pdf('own.pdf'), qt(80000, { docNo: 'QT-2569-030' }));
    later();
    const { hid } = await A.createJoint({ ...spec({ service: ['CFP'] }), members: [{ gid: co.id, share: null, pct: null }, { name: 'โคราช ซีเมนต์', share: null, pct: null }, { deal: own.id, like: own.id, share: null, pct: null }, { deal: reused.id, share: null, pct: null }] });
    const S = A.sales, g = jointOf(S, { id: hid })!;
    expect(g.members.map((x) => x.deal.service)).toEqual([['CFP'], ['CFP'], ['CFP'], []]);
    expect(S.deals[own.id].service).toEqual(['CFO']);
    // the reused row keeps its own (none); it is sold under the quotation's CFP, so the chart and the filter
    // บริการ count it there too (lib/sales.ts jobServices), as the plan page's service types always did
    const st = salesStats(S, Object.values(S.deals), TODAY);
    expect(st.byService.CFP).toBe(4);
    const cfp = filterDeals(S, normSalesFilter({ year: '2569', service: { v: ['CFP'] } }), TODAY);
    expect(customersOf(S, cfp)).toHaveLength(4);
    expect(cfp.some((d) => d.id === hid)).toBe(true);
    expect(salesStats(S, cfp, TODAY).forecast).toBe(1284000);
    A.dispose();
  });
});
