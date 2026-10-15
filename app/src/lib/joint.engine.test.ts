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
import { cashLines, dealMoney, jointOf, jointRole, salesStats, toJqm, type Deal } from './sales';
import { jointNote } from './joint';
import { qtVersions } from './quotes';
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

  it('closing closes the header and every company in one push; reopening brings back those closed with it (one that withdrew earlier stays closed)', async () => {
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
    expect(B.reopenJoint(hid)).toBe(4);
    expect(all.map((id) => B.sales.deals[id].jobStatus)).toEqual(['open', 'open', 'open', 'open', 'closed']);
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
    expect(r).toEqual({ added: 1, skipped: 1 });
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
    expect(cell(csv[1], 'ใบเสนอราคาร่วม')).toBe('ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ · ผู้จ่าย · 2 บริษัท');
    expect(cell(csv[1], 'FORECAST (บาท)')).toBe('1284000');
    expect(cell(csv[2], 'ใบเสนอราคาร่วม')).toBe('ใบเสนอราคาร่วม QT-2569-052 · CFP มจพ · บริษัทร่วม · ส่วนแบ่ง 642,000');
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
