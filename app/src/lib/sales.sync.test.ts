/**
 * Sales Tracker edits made by two or three people at the same time, run against the real team script
 * (team-sync/Code.gs in the simulator) with the real dataset. "Stale" = a browser that has not pulled
 * the teammate's latest change yet when it edits (up to 30 s normally, hours when offline).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { gccCode } from './format';
import { memoryStore } from './storage';
import { dealMoney, lastContact, overdueDays, parseAmount, type Deal } from './sales';
import { CUSTOM_ID_MIN, type SyncOp } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const WAIT = { timeout: 15000 };
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/s/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const pdf = (name: string, body = '%PDF-1.4 ' + name) => Object.assign(new Blob([body], { type: 'application/pdf' }), { name });
type Priv = Record<string, unknown> & { pq: Promise<unknown> };

describe('Sales Tracker: concurrent edits between browsers', () => {
  let base: Dataset;
  let R: RoundRaw[];
  let sim: GasSim;
  let A: GccEngine, B: GccEngine;
  const mk = (store = memoryStore()) => {
    const e = new GccEngine();
    e.base = structuredClone(base);
    e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
    e.ref = '2026-10-06';
    e.rebuild();
    e.loading = false;
    e.transport = async (_u, body) => sim.post(body);
    e.fileTransport = async (_u, body) => sim.post(body);
    e.store = store;
    return e;
  };
  /** A pushes; then B, which has not pulled since, pulls + pushes; then A pulls. */
  const settle = async () => {
    await A.teamSync();
    await B.teamSync();
    await A.teamSync();
  };
  const fresh = async (client: string) => {
    const d = A.addDeal({ client, section: 'Partner', year: '2569' });
    await A.teamSync();
    await B.teamSync();
    return d;
  };
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
    const g = json('gcc.json'), c = json('gcc-certs.json');
    base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' };
    R = json('rounds.json');
    sim = createGasSim({ teamKey: KEY });
    A = mk();
    B = mk();
    expect(await A.teamConnect(URL, KEY)).toBe(true);
    expect(await B.teamConnect(URL, KEY)).toBe(true);
  });
  afterAll(() => {
    A.dispose();
    B.dispose();
    vi.useRealTimers();
  });

  it('a stage note or a document from a stale browser never undoes a teammate\'s forecast, actual or closing', async () => {
    const d = await fresh('ลูกค้าแก้พร้อมกัน');
    A.updateDeal(d.id, { forecast: 500000 });
    A.updateDeal(d.id, { actual: 80000 });
    A.updateDeal(d.id, { jobStatus: 'closed' });
    await A.teamSync();
    vi.setSystemTime(Date.now() + 60000);
    // B has not pulled: a note, a quotation and a phone edit, all on its stale copy
    B.setStep(d.id, 'CALL1', { d: '', n: 'โทรแล้ว' });
    await B.attachDoc(d.id, pdf('QT-9.pdf'), { kind: 'quotation', amount: 450000, target: 'forecast', basis: 'total', detected: 450000, docNo: 'QT-9', docDate: '2026-10-05' });
    B.updateDeal(d.id, { phone: '029998888' });
    await settle();
    for (const e of [A, B]) {
      const x = e.sales.deals[d.id];
      expect(x).toMatchObject({ actual: 80000, jobStatus: 'closed', phone: '029998888' });
      expect(e.sales.steps[`${d.id}/CALL1`].n).toBe('โทรแล้ว');
      // the forecast A typed came before B confirmed the quotation: the quotation is the newer figure
      expect(dealMoney(e.sales, x)).toMatchObject({ forecast: 450000, fcConfirmed: true });
    }
  });

  it('two people editing different fields of one deal both keep their change; the same field: the later one', async () => {
    const d = await fresh('ลูกค้าสองฟิลด์');
    A.updateDeal(d.id, { contactName: 'คุณเอ' });
    B.updateDeal(d.id, { email: 'b@x.co', section: 'TGO' });
    await settle();
    await B.teamSync();
    for (const e of [A, B]) expect(e.sales.deals[d.id]).toMatchObject({ contactName: 'คุณเอ', email: 'b@x.co', section: 'TGO' });
    A.updateDeal(d.id, { resp: 'เอ' });
    await A.teamSync();
    B.updateDeal(d.id, { resp: 'บี' }); // B, later, without having seen A's
    await settle();
    for (const e of [A, B]) expect(e.sales.deals[d.id].resp).toBe('บี');
  });

  it('a deal deleted by one person stays deleted when a stale browser edits it; an import never brings it back', async () => {
    const d = await fresh('ลูกค้าที่ถูกลบ');
    A.updateDeal(d.id, { forecast: 1200000 });
    A.setStep(d.id, 'CALL1', { d: '2026-10-01', n: 'คุยแล้ว' });
    await A.teamSync();
    await B.teamSync();
    A.deleteDeal(d.id);
    await A.teamSync();
    B.updateDeal(d.id, { phone: '021112222' });
    B.setStep(d.id, 'FOLLOW1', { d: '', n: 'ลูกค้าโทรกลับมา' });
    await settle();
    for (const e of [A, B]) {
      expect(e.sales.deals[d.id]).toBeUndefined();
      expect(e.sales.gone[d.id]).toBeTruthy();
    }
    // an imported deal the team deleted is skipped by the next import of the same file
    const f = Object.assign(new Blob([JSON.stringify({ rows: [{ type: 'section', name: 'TGO' }, { type: 'client', client: 'ลูกค้านำเข้าแล้วลบ' }] })]), { name: 'x.json' }) as File;
    expect((await A.importTracker(f, '2565')).deals).toBe(1);
    const imp = Object.values(A.sales.deals).find((x) => x.client === 'ลูกค้านำเข้าแล้วลบ')!;
    A.deleteDeal(imp.id);
    expect(await A.importTracker(f, '2565')).toMatchObject({ deals: 0, skipped: 1 });
  });

  it('lists customised before connecting are shared, "SET/mai" keeps its name, a backup restores lists', async () => {
    const C = mk();
    C.setSalesList('services', [...C.sales.cfg.services, 'บริการก่อนต่อทีม']);
    C.setSalesList('sections', [...C.sales.cfg.sections, 'หมวดใหม่']);
    expect(C.sales.cfg.sections).toContain('SET/mai');
    expect(C.sales.cfg.sources).toContain('SET/mai');
    expect(await C.teamConnect(URL, KEY)).toBe(true);
    await C.teamSync();
    await A.teamSync();
    expect(A.sales.cfg.services).toContain('บริการก่อนต่อทีม');
    expect(A.sales.cfg.sections).toEqual(expect.arrayContaining(['SET/mai', 'หมวดใหม่']));
    C.dispose();
    // stage names are part of record keys: "/" is still replaced there
    A.setSalesList('stages', [...A.sales.cfg.stages, 'MEET/1']);
    expect(A.sales.cfg.stages).toContain('MEET-1');
    // a backup from a browser with more lists adds them
    const D = mk();
    const backup = { kind: 'gcc-crm-backup', v: 1, crm: {}, contacts: {}, dedup: {}, custom: {}, sales: { cfg: { sections: ['หมวดจากไฟล์'], sources: [], services: [], stages: ['DEMO'] }, deals: {}, steps: {}, docs: {}, log: {} } };
    await D.importCrm(Object.assign(new Blob([JSON.stringify(backup)]), { name: 'b.json' }) as File);
    expect(D.sales.cfg.sections).toContain('หมวดจากไฟล์');
    expect(D.sales.cfg.stages).toContain('DEMO');
    D.dispose();
  });

  it('two people changing the same list at once both keep their change (adds, removals, a rename)', async () => {
    await A.teamSync();
    await B.teamSync();
    A.setSalesList('services', [...A.sales.cfg.services, 'บริการของเอ']);
    await A.teamSync();
    B.setSalesList('services', [...B.sales.cfg.services.filter((x) => x !== 'GCT'), 'บริการของบี']); // stale: hasn't seen A's
    await settle();
    for (const e of [A, B]) {
      expect(e.sales.cfg.services).toEqual(expect.arrayContaining(['บริการของเอ', 'บริการของบี']));
      expect(e.sales.cfg.services).not.toContain('GCT');
    }
    const i = A.sales.cfg.sections.indexOf('Partner');
    A.renameSection('Partner', 'Partner (พันธมิตร)');
    await A.teamSync();
    B.setSalesList('sections', [...B.sales.cfg.sections, 'หมวดของบี']);
    await settle();
    for (const e of [A, B]) {
      expect(e.sales.cfg.sections[i]).toBe('Partner (พันธมิตร)');
      expect(e.sales.cfg.sections).toContain('หมวดของบี');
    }
  });

  it('a company from the TGO website sync (this device only) can be sent once per year; its deal is found by name', () => {
    const local = A.B.companies.find((c) => c.id >= 900000 && c.id < CUSTOM_ID_MIN);
    if (!local) {
      // the dataset has none: make one the way the TGO sync does
      A.added.push({ id: 900777, name: 'บริษัท จากเว็บ ทีจีโอ จำกัด', jur: '', src: 1 } as never);
      A.rebuild();
    }
    const c = local || A.company(900777)!;
    expect(A.addDealsFromCompanies([c.id], { year: '2564' })).toEqual({ added: 1, skipped: 0 });
    expect(A.addDealsFromCompanies([c.id], { year: '2564' })).toEqual({ added: 0, skipped: 1 });
    expect(A.dealsOf(c.id).map((d) => d.gid)).toEqual([null]);
  });

  it('a history entry keeps collecting one person\'s edits across background syncs', async () => {
    const d = await fresh('ลูกค้าประวัติ');
    const n = () => Object.values(A.sales.log).filter((l) => l.deal === d.id).length;
    const before = n();
    A.updateDeal(d.id, { phone: '020000001' });
    await A.teamSync(); // the pull brings back this entry as a new object
    A.updateDeal(d.id, { email: 'x@y.co' });
    expect(n()).toBe(before + 1);
  });

  it('the forecast follows the newest confirmed quotation; edits and deletions move it correctly', async () => {
    const d = await fresh('ลูกค้าหลายใบเสนอราคา');
    const q1 = await A.attachDoc(d.id, pdf('q1.pdf'), { kind: 'quotation', amount: 100000, target: 'forecast', basis: 'total', detected: 100000, docNo: 'Q1', docDate: '' });
    vi.setSystemTime(Date.now() + 1000);
    const q2 = await A.attachDoc(d.id, pdf('q2.pdf'), { kind: 'quotation', amount: 120000, target: 'forecast', basis: 'total', detected: 120000, docNo: 'Q2', docDate: '' });
    expect(dealMoney(A.sales, A.sales.deals[d.id]).fcDoc?.id).toBe(q2.id);
    vi.setSystemTime(Date.now() + 1000);
    A.updateDoc(d.id, q1.id, { amount: 110000 }); // correcting the old quotation's record doesn't make it current
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 120000 });
    A.updateDoc(d.id, q2.id, { amount: 125000 }); // correcting the current one does
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 125000 });
    A.deleteDoc(d.id, q1.id);
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 125000, fcConfirmed: true });
    // a teammate's stale write of the deal (B never saw the documents) doesn't unlink the quotation
    B.updateDeal(d.id, { referral: 'งานสัมมนา' });
    await settle();
    expect(dealMoney(B.sales, B.sales.deals[d.id])).toMatchObject({ forecast: 125000, fcConfirmed: true });
  });

  it('the stage note a document filled in follows the document, unless someone wrote in it', async () => {
    const d = await fresh('ลูกค้าโน้ตอัตโนมัติ');
    const inv = await A.attachDoc(d.id, pdf('inv.pdf'), { kind: 'invoice', amount: 53500, target: 'actual', basis: 'total', detected: 53500, docNo: 'INV-1', docDate: '2026-10-02' });
    expect(A.sales.steps[`${d.id}/PAY1`]).toEqual({ d: '2026-10-02', n: 'ใบแจ้งหนี้ INV-1 · 53,500 บาท' });
    A.updateDoc(d.id, inv.id, { amount: 50000 });
    expect(A.sales.steps[`${d.id}/PAY1`].n).toBe('ใบแจ้งหนี้ INV-1 · 50,000 บาท');
    A.deleteDoc(d.id, inv.id);
    expect(A.sales.steps[`${d.id}/PAY1`]).toBeUndefined();
    const q = await A.attachDoc(d.id, pdf('q.pdf'), { kind: 'quotation', amount: 9000, target: 'forecast', basis: 'total', detected: 9000, docNo: 'Q', docDate: '' });
    A.setStep(d.id, 'QUOTATION', { d: '2026-10-06', n: 'ส่งแล้ว ลูกค้าขอส่วนลด' });
    A.deleteDoc(d.id, q.id);
    expect(A.sales.steps[`${d.id}/QUOTATION`].n).toBe('ส่งแล้ว ลูกค้าขอส่วนลด'); // the user's note stays
  });

  it('a document deleted by a teammate while this browser uploads it stays deleted; its Drive file and local copy go', async () => {
    const d = await fresh('ลูกค้าลบระหว่างอัปโหลด');
    const doc = await A.attachDoc(d.id, pdf('late.pdf'), { kind: 'quotation', amount: 1, target: 'forecast', basis: 'total', detected: 1, docNo: '', docDate: '' });
    await A.teamSync(); // record shared, file uploaded in the background
    await vi.waitFor(() => expect(A.sales.docs[`${d.id}/${doc.id}`].fileId).not.toBe(''), WAIT);
    const fileId = A.sales.docs[`${d.id}/${doc.id}`].fileId;
    // the file-link update is still queued in A when B (which saw only the record) deletes the document
    await B.teamSync();
    B.deleteDoc(d.id, doc.id);
    await B.teamSync();
    await A.teamSync();
    await B.teamSync();
    for (const e of [A, B]) expect(e.sales.docs[`${d.id}/${doc.id}`]).toBeUndefined();
    await vi.waitFor(() => expect(sim.post({ action: 'file', key: KEY, fileId }).error).toBe('not_found'), WAIT);
    // B's copy of the file is gone as well when A deletes one B had opened
    const doc2 = await A.attachDoc(d.id, pdf('two.pdf'), { kind: 'other', amount: null, target: 'none', basis: 'manual', detected: null, docNo: '', docDate: '' });
    await A.teamSync();
    await vi.waitFor(() => expect(A.sales.docs[`${d.id}/${doc2.id}`].fileId).not.toBe(''), WAIT);
    await A.teamSync();
    await B.teamSync();
    await B.docBlob(B.sales.docs[`${d.id}/${doc2.id}`]); // downloaded and kept
    expect(await B.store.get('docblob:' + doc2.id)).toBeTruthy();
    A.deleteDoc(d.id, doc2.id);
    await A.teamSync();
    await B.teamSync();
    await vi.waitFor(async () => expect(await B.store.get('docblob:' + doc2.id)).toBeNull(), WAIT);
  });

  it('a failing upload is retried with growing waits, not on every sync', async () => {
    const C = mk();
    expect(await C.teamConnect(URL, KEY)).toBe(true);
    let calls = 0;
    C.fileTransport = async (_u, body) => {
      if (body.action === 'upload') {
        calls++;
        throw new TypeError('Failed to fetch');
      }
      return sim.post(body);
    };
    const d = C.addDeal({ client: 'ลูกค้าอัปโหลดไม่ผ่าน', year: '2569' });
    await C.attachDoc(d.id, pdf('x.pdf'), { kind: 'other', amount: null, target: 'none', basis: 'manual', detected: null, docNo: '', docDate: '' });
    await vi.waitFor(() => expect(calls).toBe(1), WAIT);
    await vi.waitFor(() => expect((C as unknown as Priv).docUploading).toBe(false), WAIT);
    for (let i = 0; i < 3; i++) await C.teamSync();
    expect(calls).toBe(1);
    expect(C.docMsg).toMatch(/จะลองใหม่ในอีก 1 นาที/);
    vi.setSystemTime(Date.now() + 61000);
    await C.teamSync();
    await vi.waitFor(() => expect(calls).toBe(2), WAIT);
    C.dispose();
  });

  it('an import while connected is queued in one write, so a reload right after loses nothing', async () => {
    const store = memoryStore();
    const C = mk(store);
    expect(await C.teamConnect(URL, KEY)).toBe(true);
    const rows = [{ type: 'section', name: 'TGO' }, ...Array.from({ length: 300 }, (_, i) => ({ type: 'client', client: 'ลูกค้านำเข้า ' + i, progress: { CALL1: { d: '2026-09-01', n: 'โทร ' + i } } }))];
    let writes = 0;
    const upd = store.update.bind(store);
    store.update = (k, fn) => (k.startsWith('teamPending:') && writes++, upd(k, fn));
    const t0 = performance.now();
    const r = await C.importTracker(Object.assign(new Blob([JSON.stringify({ rows })]), { name: 'big.json' }) as File, '2563');
    await (C as unknown as Priv).pq;
    expect(r.deals).toBe(300);
    expect(writes).toBe(1);
    expect(performance.now() - t0).toBeLessThan(5000);
    const queued = (await store.get<SyncOp[]>('teamPending:' + URL))!;
    expect(queued.filter((o) => o.k.startsWith('deal/')).length).toBe(300);
    expect(queued.filter((o) => o.k.startsWith('dstep/')).length).toBe(300);
    // "reload": a new engine on the same storage pushes the whole queue
    C.dispose();
    const C2 = mk(store);
    expect(await C2.teamConnect(URL, KEY)).toBe(true);
    await C2.teamSync();
    await A.teamSync();
    expect(Object.values(A.sales.deals).filter((d) => d.year === '2563').length).toBe(300);
    // and the import can be undone, after which the same file imports again
    expect(C2.undoImport(r.batch)).toBe(300);
    await C2.teamSync();
    await A.teamSync();
    expect(Object.values(A.sales.deals).filter((d) => d.year === '2563').length).toBe(0);
    C2.dispose();
  });

  it('a customer added by hand never takes over a registry company of the same name', () => {
    const reg = A.B.companies.find((c) => c.ids.length === 1 && !c.jur && c.id < 900000 && c.name.length > 12)!;
    A.toggleWatch(reg.id);
    A.setStage(reg.id, 'interested');
    const before = A.company(reg.id)!;
    expect(before.code).toBe(gccCode(reg.id));
    const id = A.addCustomer({ name: reg.name, jur: '0105500000001', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' });
    const after = A.company(reg.id)!;
    expect(after.id).toBe(reg.id);
    expect(after.code).toMatch(/^GCC-/);
    expect(A.crm.watch).toContain(reg.id);
    expect(A.stage(reg.id)).toBe('interested');
    expect(gccCode(id)).toMatch(/^NEW-/); // the hand-added row, wherever a row code is shown (Dedup, drawer, CSV)
  });

  it('a new deal isn\'t "contacted" yet, but is flagged if nobody follows up; it goes to "อื่นๆ" when nothing says otherwise', () => {
    const d = A.addDeal({ client: 'แถวว่าง', year: '2569' });
    expect(d).toMatchObject({ contactDate: '', section: 'อื่นๆ', source: [] });
    expect(lastContact(A.sales, d, '2026-10-06')).toBe('');
    const at = d.at.slice(0, 10);
    expect(overdueDays(A.sales, d, at)).toBeNull();
    expect(overdueDays(A.sales, d, new Date(Date.parse(at) + 15 * 864e5).toISOString().slice(0, 10))).toBe(15);
  });

  it('CSV: text can\'t run as a formula, phones keep their 0, ticks no longer in the lists are kept', () => {
    const d: Deal = { ...A.addDeal({ client: '=HYPERLINK("http://x","คลิก")', year: '2569' }), contactName: '+66 81', phone: '0812345678', referral: '@me', source: ['ช่องทางที่ลบไปแล้ว'] };
    A.sales.deals[d.id] = d;
    const csv = A.salesCsv([d]);
    const row = csv.split('\r\n')[1];
    expect(row).toContain('"\'=HYPERLINK(""http://x"",""คลิก"")"');
    expect(row).toContain('"\'+66 81"');
    expect(row).toContain('"\'@me"');
    expect(row).toContain('"=""0812345678"""');
    expect(row).toContain('"ช่องทางที่ลบไปแล้ว"');
  });

  it('amounts are typed the way people say them; anything unclear keeps the old figure', () => {
    expect(['120,000', '120,000.-', '1.5 ล้าน', '200k', '๑๒๐,๐๐๐', '', '50,000-80,000', 'รอคุย', '-5'].map(parseAmount)).toEqual([120000, 120000, 1500000, 200000, 120000, null, undefined, undefined, undefined]);
  });
});
