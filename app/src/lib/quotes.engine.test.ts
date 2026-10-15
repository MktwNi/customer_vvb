/**
 * A quotation revised, corrected, its file swapped and its versions deleted (item 3), in the engine, run
 * against the real team script (team-sync/Code.gs in the simulator): which version counts, how they are
 * numbered, what the QUOTATION stage says, what the sheet and a teammate's browser get, and which Drive
 * files go.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { dealMoney, salesStats, toDoc, type DealDoc } from './sales';
import { qtVersions, qtView } from './quotes';
import type { SyncOp } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const WAIT = { timeout: 15000 };
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/q/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-12';

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 300);
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
const queued = async (e: GccEngine) => {
  await (e as unknown as { pq: Promise<unknown> }).pq;
  return (await e.store.get<SyncOp[]>('teamPending:' + URL)) || [];
};
function sheet(k: string): unknown {
  const r = sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k === k);
  const l = r[r.length - 1];
  return !l ? undefined : l.del ? null : l.v;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const qt = (amount: number | null, o: { docNo?: string; docDate?: string; revise?: string } = {}) => ({
  kind: 'quotation' as const, amount, target: 'forecast' as const, basis: 'total' as const, detected: amount, docNo: o.docNo ?? 'QT-2569-014', docDate: o.docDate ?? '', stage: 'QUOTATION', ...(o.revise ? { revise: o.revise } : {}),
});
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms);
let n = 0;
const deal = (e: GccEngine) => e.addDeal({ client: 'บริษัท ซากิโนมิยะ ทดสอบ ' + ++n + ' จำกัด', section: 'TGO', year: '2569' });
const docOf = (e: GccEngine, dealId: string, id: string) => e.sales.docs[`${dealId}/${id}`];
const step = (e: GccEngine, dealId: string) => e.sales.steps[`${dealId}/QUOTATION`];
const lastLog = (e: GccEngine, id: string) => Object.values(e.sales.log).filter((l) => l.deal === id).at(-1)!;

describe('a revised quotation (แนบฉบับแก้ไข)', () => {
  it('is version 2 and the Forecast; the QUOTATION note names it, its date stays the first send; version 1 stays, not counted', async () => {
    const [A, B] = await team();
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('QT-2569-014.pdf'), qt(192600, { docDate: '2026-10-04' }));
    expect(step(A, d.id)).toEqual({ d: '2026-10-04', n: 'ใบเสนอราคา QT-2569-014 · 192,600 บาท' });
    await settle(A, B);
    later();
    const v2 = await A.attachDoc(d.id, pdf('QT-2569-014-แก้ไข.pdf'), qt(182970, { docDate: '2026-10-09', revise: v1.id }));
    expect(step(A, d.id)).toEqual({ d: '2026-10-04', n: 'ใบเสนอราคา QT-2569-014 · 182,970 บาท' });
    expect(docOf(A, d.id, v2.id).auto).toEqual({ stage: 'QUOTATION', n: 'ใบเสนอราคา QT-2569-014 · 182,970 บาท', d: '2026-10-04' });
    expect(docOf(A, d.id, v1.id)).toMatchObject({ target: 'none', amount: 192600 });
    expect(docOf(A, d.id, v1.id).auto).toBeUndefined();
    // stopping counting re-stamped version 1's confirmation after version 2's: the numbering still follows attaching
    expect(docOf(A, d.id, v1.id).cAt! > docOf(A, d.id, v2.id).cAt!).toBe(true);
    const dl = A.sales.deals[d.id];
    expect(qtVersions(A.sales, dl).map((x) => x.id)).toEqual([v1.id, v2.id]);
    expect(qtView(A.sales, dl).versions.map((x) => [x.n, x.state])).toEqual([[1, 'old'], [2, 'cur']]);
    // the newest version wins, counted once
    expect(dealMoney(A.sales, dl)).toMatchObject({ forecast: 182970, fcConfirmed: true });
    expect(dealMoney(A.sales, dl).fcDoc!.id).toBe(v2.id);
    expect(salesStats(A.sales, [dl], TODAY).forecast).toBe(182970);
    expect(lastLog(A, d.id)).toMatchObject({ action: 'แนบใบเสนอราคาฉบับแก้ไข', detail: 'QT-2569-014-แก้ไข.pdf · 182,970 บาท · ฉบับที่ 2' });
    // version 1 changed by its fields only (a teammate's edit of it meanwhile is kept)
    expect((await queued(A)).find((o) => o.k === `ddoc/${d.id}/${v1.id}`)!.f).toEqual(expect.arrayContaining(['target', 'cAt', 'auto']));
    // the teammate's browser and the sheet agree
    await settle(A, B);
    const bd = B.sales.deals[d.id];
    expect(qtView(B.sales, bd).versions.map((x) => [x.doc.id, x.state])).toEqual([[v1.id, 'old'], [v2.id, 'cur']]);
    expect(dealMoney(B.sales, bd).forecast).toBe(182970);
    expect(step(B, d.id)).toEqual(step(A, d.id));
    expect(sheet(`ddoc/${d.id}/${v1.id}`)).toMatchObject({ target: 'none' });
    A.dispose();
    B.dispose();
  });

  it('is numbered last even from a computer whose clock is behind', async () => {
    const [A, B] = await team();
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(100000));
    await settle(A, B);
    vi.setSystemTime(Date.now() - 10 * 60000); // B's clock: ten minutes slow
    const v2 = await B.attachDoc(d.id, pdf('q2.pdf'), qt(90000, { revise: v1.id }));
    expect(v2.at > v1.at).toBe(true);
    expect(qtVersions(B.sales, B.sales.deals[d.id]).map((x) => x.id)).toEqual([v1.id, v2.id]);
    expect(dealMoney(B.sales, B.sales.deals[d.id]).forecast).toBe(90000);
    later(20 * 60000);
    await settle(A, B);
    expect(qtView(A.sales, A.sales.deals[d.id]).cur!.doc.id).toBe(v2.id);
    A.dispose();
    B.dispose();
  });

  it('stops every earlier version counting; a stale note naming the first passes on; a note the user wrote stays', async () => {
    const [A] = await team();
    // attached the old way (a second quotation, no revision): both count toward the Forecast, the note names the first
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(100000, { docNo: 'QT-1', docDate: '2026-10-01' }));
    later();
    const v2 = await A.attachDoc(d.id, pdf('q2.pdf'), qt(120000, { docNo: 'QT-1 rev.1' }));
    expect(step(A, d.id).n).toBe('ใบเสนอราคา QT-1 · 100,000 บาท');
    later();
    const v3 = await A.attachDoc(d.id, pdf('q3.pdf'), qt(115000, { docNo: 'QT-1 rev.2', revise: v2.id }));
    expect([v1, v2].map((x) => docOf(A, d.id, x.id).target)).toEqual(['none', 'none']);
    expect(step(A, d.id)).toEqual({ d: '2026-10-01', n: 'ใบเสนอราคา QT-1 rev.2 · 115,000 บาท' });
    expect(qtView(A.sales, A.sales.deals[d.id]).versions.map((x) => [x.doc.id, x.n, x.state])).toEqual([[v1.id, 1, 'old'], [v2.id, 2, 'old'], [v3.id, 3, 'cur']]);
    // the user's own note and date stay; the revision takes no note
    const e = deal(A);
    const w1 = await A.attachDoc(e.id, pdf('w1.pdf'), qt(50000));
    A.setStep(e.id, 'QUOTATION', { d: '2026-10-05', n: 'ส่งทางอีเมลแล้ว ลูกค้าขอส่วนลด' });
    later();
    const w2 = await A.attachDoc(e.id, pdf('w2.pdf'), qt(45000, { revise: w1.id }));
    expect(step(A, e.id)).toEqual({ d: '2026-10-05', n: 'ส่งทางอีเมลแล้ว ลูกค้าขอส่วนลด' });
    expect(docOf(A, e.id, w2.id).auto).toBeUndefined();
    expect(dealMoney(A.sales, A.sales.deals[e.id]).forecast).toBe(45000);
    A.dispose();
  });

  it('overrides a Forecast typed after the first version; one without an amount revises nothing', async () => {
    const [A] = await team();
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(100000));
    later();
    A.updateDeal(d.id, { forecast: 95000 });
    expect(qtView(A.sales, A.sales.deals[d.id])).toMatchObject({ cur: null, typed: true });
    later();
    const v2 = await A.attachDoc(d.id, pdf('q2.pdf'), qt(97000, { revise: v1.id }));
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 97000, fcOverride: false });
    expect(qtView(A.sales, A.sales.deals[d.id]).cur!.doc.id).toBe(v2.id);
    later();
    const v3 = await A.attachDoc(d.id, pdf('q3.pdf'), { ...qt(null, { revise: v2.id }), target: 'forecast' });
    expect(docOf(A, d.id, v3.id).target).toBe('none');
    expect(docOf(A, d.id, v2.id).target).toBe('forecast');
    expect(dealMoney(A.sales, A.sales.deals[d.id]).forecast).toBe(97000);
    A.dispose();
  });
});

describe('deleting a version', () => {
  it('the one in use: the version before it is the Forecast again and takes the note back; the last one: the typed Forecast', async () => {
    const [A, B] = await team();
    const d = deal(A);
    A.updateDeal(d.id, { forecast: 200000 });
    later();
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(192600, { docDate: '2026-10-04' }));
    later();
    const v2 = await A.attachDoc(d.id, pdf('q2.pdf'), qt(182970, { docDate: '2026-10-09', revise: v1.id }));
    later();
    A.deleteDoc(d.id, v2.id);
    const dl = A.sales.deals[d.id];
    expect(dealMoney(A.sales, dl)).toMatchObject({ forecast: 192600, fcConfirmed: true, fcOverride: false });
    expect(docOf(A, d.id, v1.id).target).toBe('forecast');
    expect(step(A, d.id)).toEqual({ d: '2026-10-04', n: 'ใบเสนอราคา QT-2569-014 · 192,600 บาท' });
    expect(qtView(A.sales, dl).versions.map((x) => [x.doc.id, x.n, x.state])).toEqual([[v1.id, 1, 'cur']]);
    expect(lastLog(A, d.id)).toMatchObject({ action: 'ลบเอกสาร', detail: 'q2.pdf' });
    await settle(A, B);
    expect(dealMoney(B.sales, B.sales.deals[d.id]).forecast).toBe(192600);
    later();
    A.deleteDoc(d.id, v1.id);
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 200000, fcConfirmed: false });
    A.dispose();
    B.dispose();
  });

  it('one not in use (a Forecast typed after it, or an old version): nothing else moves', async () => {
    const [A] = await team();
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(100000));
    later();
    const v2 = await A.attachDoc(d.id, pdf('q2.pdf'), qt(90000, { revise: v1.id }));
    later();
    A.updateDeal(d.id, { forecast: 88000 });
    later();
    A.deleteDoc(d.id, v2.id);
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 88000, fcConfirmed: false });
    expect(docOf(A, d.id, v1.id).target).toBe('none');
    // an old version deleted: the one in use stays
    const e = deal(A);
    const w1 = await A.attachDoc(e.id, pdf('w1.pdf'), qt(100000));
    later();
    const w2 = await A.attachDoc(e.id, pdf('w2.pdf'), qt(90000, { revise: w1.id }));
    A.deleteDoc(e.id, w1.id);
    expect(qtView(A.sales, A.sales.deals[e.id]).versions.map((x) => [x.doc.id, x.n, x.state])).toEqual([[w2.id, 1, 'cur']]);
    expect(dealMoney(A.sales, A.sales.deals[e.id]).forecast).toBe(90000);
    A.dispose();
  });
});

describe('swapping a quotation\'s file (เปลี่ยนไฟล์)', () => {
  it('a new record with every value of the old one, in the same place; the old Drive file is trashed once', async () => {
    const [A, B] = await team();
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(192600, { docDate: '2026-10-04' }));
    later();
    const v2 = await A.attachDoc(d.id, pdf('wrong-customer.pdf'), qt(182970, { docDate: '2026-10-09', revise: v1.id }));
    await settle(A, B);
    await vi.waitFor(() => expect(docOf(A, d.id, v2.id).fileId).not.toBe(''), WAIT);
    await settle(A, B);
    const before = { ...docOf(A, d.id, v2.id) }, note = step(A, d.id);
    // B has opened it: its copy of the file is kept by document id
    await B.docBlob(B.sales.docs[`${d.id}/${v2.id}`]);
    later();
    const swapped = await A.replaceDocFile(d.id, v2.id, pdf('QT-2569-014-signed.pdf'));
    expect(swapped.id).not.toBe(v2.id);
    expect(docOf(A, d.id, v2.id)).toBeUndefined();
    const { id: _i, name: _n, size: _s, fileId: _f, ...same } = before;
    expect(swapped).toMatchObject({ ...same, name: 'QT-2569-014-signed.pdf', fileId: '', by: 'หมิว' });
    expect(swapped.auto).toEqual(before.auto);
    // the same version, the same Forecast, the same note
    const dl = A.sales.deals[d.id];
    expect(qtVersions(A.sales, dl).map((x) => x.id)).toEqual([v1.id, swapped.id]);
    expect(dealMoney(A.sales, dl).fcDoc!.id).toBe(swapped.id);
    expect(dealMoney(A.sales, dl).forecast).toBe(182970);
    expect(step(A, d.id)).toEqual(note);
    expect(lastLog(A, d.id)).toMatchObject({ action: 'เปลี่ยนไฟล์เอกสาร', detail: 'ใบเสนอราคา QT-2569-014 · wrong-customer.pdf เป็น QT-2569-014-signed.pdf' });
    // this browser's copies: the old file's goes, the new one's is kept to upload
    expect(await A.store.get('docblob:' + v2.id)).toBeNull();
    expect(await A.store.get('docblob:' + swapped.id)).toBeTruthy();
    await settle(A, B);
    await vi.waitFor(() => expect(docOf(A, d.id, swapped.id).fileId).not.toBe(''), WAIT);
    await settle(A, B);
    await vi.waitFor(() => expect(sim.post({ action: 'file', key: KEY, fileId: before.fileId }).error).toBe('not_found'), WAIT);
    // only the old file is ever trashed (the teammate's browser trashes it too when the deletion arrives:
    // whoever deleted a record may not have known its file yet); the new one stays
    expect(calls.get(A)!.filter((x) => x.action === 'delfile').map((x) => x.fileId)).toEqual([before.fileId]);
    expect(new Set([...calls.get(A)!, ...calls.get(B)!].filter((x) => x.action === 'delfile').map((x) => x.fileId))).toEqual(new Set([before.fileId]));
    expect(sim.post({ action: 'file', key: KEY, fileId: docOf(A, d.id, swapped.id).fileId }).error).toBeUndefined();
    // the teammate: the old record and its copy of the old file gone, the new one in its place
    const bd = B.sales.deals[d.id];
    expect(B.sales.docs[`${d.id}/${v2.id}`]).toBeUndefined();
    expect(qtView(B.sales, bd).versions.map((x) => [x.doc.id, x.doc.name, x.state])).toEqual([[v1.id, 'q1.pdf', 'old'], [swapped.id, 'QT-2569-014-signed.pdf', 'cur']]);
    expect(B.sales.docs[`${d.id}/${swapped.id}`].fileId).toBe(docOf(A, d.id, swapped.id).fileId);
    await vi.waitFor(async () => expect(await B.store.get('docblob:' + v2.id)).toBeNull(), WAIT);
    A.dispose();
    B.dispose();
  });

  it('a file never uploaded only leaves this browser; an account that can only read cannot swap', async () => {
    const [A] = await team();
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(50000));
    const swapped = await A.replaceDocFile(d.id, v1.id, pdf('q1-right.pdf')); // before any upload
    expect(await A.store.get('docblob:' + v1.id)).toBeNull();
    await settle(A);
    expect(calls.get(A)!.filter((x) => x.action === 'delfile')).toEqual([]);
    expect(sheet(`ddoc/${d.id}/${v1.id}`)).toBeNull();
    expect(dealMoney(A.sales, A.sales.deals[d.id]).fcDoc!.id).toBe(swapped.id);
    (A as unknown as { can: () => boolean }).can = () => false;
    await expect(A.replaceDocFile(d.id, swapped.id, pdf('x.pdf'))).rejects.toThrow('บัญชีดูอย่างเดียว');
    A.dispose();
  });
});

describe('no new fields', () => {
  it('every record written is a document as older builds read it; an older build\'s whole write of the old version changes nothing', async () => {
    const [A, B] = await team();
    const d = deal(A);
    const v1 = await A.attachDoc(d.id, pdf('q1.pdf'), qt(192600));
    later();
    const v2 = await A.attachDoc(d.id, pdf('q2.pdf'), qt(182970, { revise: v1.id }));
    later();
    A.updateDoc(d.id, v2.id, { docDate: '2026-10-09', docNo: 'QT-2569-014/1' });
    const sw = await A.replaceDocFile(d.id, v2.id, pdf('q2-signed.pdf'));
    const keys = (v: unknown) => Object.keys(v as object).sort();
    for (const o of await queued(A)) if (o.k.startsWith('ddoc/') && o.v) expect(keys(o.v)).toEqual(keys(toDoc(o.v, d.id, o.k.split('/')[2])));
    await settle(A, B);
    // an older build edits version 1 (it sees "ไม่นับยอด") and writes its whole record
    const old = B.sales.docs[`${d.id}/${v1.id}`] as DealDoc;
    sim.post({ action: 'push', key: KEY, ops: [{ k: `ddoc/${d.id}/${v1.id}`, v: { ...old, docNo: 'QT-2569-014 เดิม' }, by: 'บี' }] });
    await settle(A, B);
    for (const e of [A, B]) {
      const v = qtView(e.sales, e.sales.deals[d.id]);
      expect(v.versions.map((x) => [x.doc.id, x.state])).toEqual([[v1.id, 'old'], [sw.id, 'cur']]);
      expect(dealMoney(e.sales, e.sales.deals[d.id]).forecast).toBe(182970);
      expect(e.sales.docs[`${d.id}/${sw.id}`]).toMatchObject({ docDate: '2026-10-09', docNo: 'QT-2569-014/1' });
    }
    A.dispose();
    B.dispose();
  });
});
