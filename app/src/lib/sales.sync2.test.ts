/**
 * Second-review scenarios: two tabs of one browser, failed pushes, notes filled in for documents,
 * undoing and re-importing, deals deleted while a teammate adds to them, clock skew, and the
 * registry merge rules for customers added by hand. Real Code.gs (simulator), real dataset.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore, type KVStore } from './storage';
import { dealMoney, lastContact, toDoc } from './sales';
import type { SyncOp } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const WAIT = { timeout: 15000 };
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/s/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
type Priv = { pq: Promise<unknown>; pending: Map<string, SyncOp> };
const priv = (e: GccEngine) => e as unknown as Priv;

describe('Sales Tracker: second review', () => {
  let base: Dataset;
  let R: RoundRaw[];
  let sim: GasSim;
  let offline = false;
  let busy = false;
  const mk = (store: KVStore = memoryStore()) => {
    const e = new GccEngine();
    e.base = structuredClone(base);
    e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
    e.ref = '2026-10-06';
    e.rebuild();
    e.loading = false;
    e.transport = async (_u, body) => {
      if (offline) throw new TypeError('Failed to fetch');
      if (busy && body.action === 'push') return { ok: false, error: 'busy' };
      return sim.post(body);
    };
    e.fileTransport = async (_u, body) => sim.post(body);
    e.store = store;
    return e;
  };
  let A: GccEngine, B: GccEngine, T2: GccEngine;
  const shared = memoryStore();
  const all = () => [A, B, T2];
  const syncAll = async () => {
    for (const e of [A, T2, B, A, T2, B]) await e.teamSync();
  };
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
    const g = json('gcc.json'), c = json('gcc-certs.json');
    base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' };
    R = json('rounds.json');
    sim = createGasSim({ teamKey: KEY });
    A = mk(shared); // A and T2: two tabs of one browser
    T2 = mk(shared);
    B = mk();
    for (const e of all()) expect(await e.teamConnect(URL, KEY)).toBe(true);
  });
  afterAll(() => {
    for (const e of all()) e.dispose();
    vi.useRealTimers();
  });
  const fresh = async (client: string) => {
    const d = A.addDeal({ client, section: 'Partner', year: '2569' });
    await syncAll();
    return d;
  };

  it('two tabs: an edit in one tab never undoes the other tab\'s queued edit, list addition or deletion', async () => {
    const d = await fresh('ลูกค้าสองแท็บ');
    offline = true;
    A.updateDeal(d.id, { forecast: 750000 });
    vi.setSystemTime(Date.now() + 1000);
    T2.updateDeal(d.id, { email: 'tab2@x.co' }); // T2's copy still has no forecast
    A.setSalesList('services', [...A.sales.cfg.services, 'บริการแท็บหนึ่ง']);
    T2.setSalesList('services', [...T2.sales.cfg.services, 'บริการแท็บสอง']);
    await priv(A).pq;
    await priv(T2).pq;
    offline = false;
    await syncAll();
    for (const e of all()) {
      expect(e.sales.deals[d.id]).toMatchObject({ forecast: 750000, email: 'tab2@x.co' });
      expect(e.sales.cfg.services).toEqual(expect.arrayContaining(['บริการแท็บหนึ่ง', 'บริการแท็บสอง']));
    }
    // one tab deletes, the other (stale) edits: the deletion wins
    offline = true;
    A.deleteDeal(d.id);
    vi.setSystemTime(Date.now() + 1000);
    T2.updateDeal(d.id, { phone: '020000000' });
    await priv(A).pq;
    await priv(T2).pq;
    offline = false;
    await syncAll();
    for (const e of all()) expect(e.sales.deals[d.id]).toBeUndefined();
  });

  it('an edit whose push the sheet refused (busy) is kept and merged, not dropped when a teammate edits the deal', async () => {
    const d = await fresh('ลูกค้าชีตไม่ว่าง');
    B.updateDeal(d.id, { phone: '021234567' });
    busy = true;
    try {
      await B.teamSync();
      expect(B.team.status).toBe('error');
    } finally {
      busy = false;
    }
    A.updateDeal(d.id, { forecast: 300000 });
    await A.teamSync();
    await syncAll();
    for (const e of all()) expect(e.sales.deals[d.id]).toMatchObject({ phone: '021234567', forecast: 300000 });
  });

  it('a note a document fills in never replaces a note a teammate just wrote there', async () => {
    const d = await fresh('ลูกค้าโน้ตชนกัน');
    B.setStep(d.id, 'QUOTATION', { d: '2026-10-05', n: 'ส่งใบเสนอราคาทางอีเมลแล้ว' });
    await B.teamSync();
    // A hasn't pulled: QUOTATION looks empty here, so the quotation fills it in
    await A.attachDoc(d.id, pdf('q.pdf'), { kind: 'quotation', amount: 1000, target: 'forecast', basis: 'total', detected: 1000, docNo: 'Q-7', docDate: '' });
    await syncAll();
    for (const e of all()) expect(e.sales.steps[`${d.id}/QUOTATION`].n).toBe('ส่งใบเสนอราคาทางอีเมลแล้ว');
  });

  it('an undone import can be imported again — after syncs, and from a teammate\'s browser', async () => {
    const f = Object.assign(new Blob([JSON.stringify({ rows: [{ type: 'section', name: 'Webinar 2562' }, { type: 'client', client: 'ลูกค้านำเข้าอีกครั้ง' }] })]), { name: 'x.json' }) as File;
    const r = await A.importTracker(f, '2562');
    expect(A.sales.cfg.sections).toContain('Webinar 2562');
    await syncAll();
    expect(A.undoImport(r.batch)).toBe(1);
    expect(A.sales.cfg.sections).not.toContain('Webinar 2562'); // the section it added went with it
    await syncAll();
    vi.setSystemTime(Date.now() + 60000);
    await syncAll();
    expect((await B.importTracker(f, '2562')).deals).toBe(1);
    await syncAll();
    for (const e of all()) expect(Object.values(e.sales.deals).filter((x) => x.client === 'ลูกค้านำเข้าอีกครั้ง')).toHaveLength(1);
  });

  it('an import from a browser that hasn\'t pulled yet never overwrites the team\'s edits or brings back deleted rows', async () => {
    const f = Object.assign(new Blob([JSON.stringify({ rows: [{ type: 'section', name: 'TGO' }, { type: 'client', client: 'ลูกค้าไฟล์เดียวกัน 1', forecast: 100000 }, { type: 'client', client: 'ลูกค้าไฟล์เดียวกัน 2' }] })]), { name: 'same.json' }) as File;
    await A.importTracker(f, '2561');
    await A.teamSync();
    const [d1, d2] = Object.values(A.sales.deals).filter((x) => x.year === '2561').sort((a, b) => a.client.localeCompare(b.client));
    A.updateDeal(d1.id, { forecast: 750000, resp: 'เอ' });
    A.deleteDeal(d2.id);
    await A.teamSync();
    await B.importTracker(f, '2561'); // B hasn't seen any of it
    await syncAll();
    for (const e of all()) {
      expect(e.sales.deals[d1.id]).toMatchObject({ forecast: 750000, resp: 'เอ' });
      expect(e.sales.deals[d2.id]).toBeUndefined();
    }
  });

  it('a note or document a stale browser adds to a deal a teammate deleted is removed everywhere, with its Drive file', async () => {
    const d = await fresh('ลูกค้าลบแล้วแต่เพิ่มของ');
    A.deleteDeal(d.id);
    await A.teamSync();
    B.setStep(d.id, 'FOLLOW1', { d: '', n: 'ลูกค้าโทรกลับ' });
    const doc = await B.attachDoc(d.id, pdf('late.pdf'), { kind: 'quotation', amount: 5, target: 'forecast', basis: 'total', detected: 5, docNo: '', docDate: '' });
    await vi.waitFor(() => expect(B.sales.docs[`${d.id}/${doc.id}`]?.fileId || 'none').not.toBe(''), WAIT);
    const fileId = B.sales.docs[`${d.id}/${doc.id}`]?.fileId;
    await syncAll();
    for (const e of all()) {
      expect(Object.keys(e.sales.steps).some((k) => k.startsWith(d.id + '/'))).toBe(false);
      expect(Object.values(e.sales.docs).some((x) => x.deal === d.id)).toBe(false);
    }
    if (fileId) await vi.waitFor(() => expect(sim.post({ action: 'file', key: KEY, fileId }).error).toBe('not_found'), WAIT);
  });

  it('a forecast typed after seeing a quotation wins even if the attacher\'s clock is ahead; retyping a hidden figure counts', async () => {
    const d = await fresh('ลูกค้านาฬิกาเพี้ยน');
    vi.setSystemTime(Date.now() + 10 * 60000); // A's clock 10 minutes fast
    await A.attachDoc(d.id, pdf('qt.pdf'), { kind: 'quotation', amount: 250000, target: 'forecast', basis: 'total', detected: 250000, docNo: 'QT-1', docDate: '' });
    await A.teamSync();
    vi.setSystemTime(Date.now() - 10 * 60000 + 3 * 60000); // B, correct clock, three minutes later
    await B.teamSync();
    B.updateDeal(d.id, { forecast: 300000 });
    await syncAll();
    for (const e of all()) expect(dealMoney(e.sales, e.sales.deals[d.id]).forecast).toBe(300000);
    // a newer quotation, then the same figure typed again: it is used again
    vi.setSystemTime(Date.now() + 20 * 60000);
    await A.attachDoc(d.id, pdf('qt2.pdf'), { kind: 'quotation', amount: 280000, target: 'forecast', basis: 'total', detected: 280000, docNo: 'QT-2', docDate: '' });
    expect(dealMoney(A.sales, A.sales.deals[d.id]).forecast).toBe(280000);
    A.updateDeal(d.id, { forecast: 300000 }); // equal to the hidden typed figure
    expect(dealMoney(A.sales, A.sales.deals[d.id]).forecast).toBe(300000);
  });

  it('deleting one of two quotations hands its stage note to the other; a date the user corrected stays', async () => {
    const d = await fresh('ลูกค้าสองใบเสนอราคา');
    const q1 = await A.attachDoc(d.id, pdf('q1.pdf'), { kind: 'quotation', amount: 100000, target: 'forecast', basis: 'total', detected: 100000, docNo: 'QT-1', docDate: '2026-09-25' });
    vi.setSystemTime(Date.now() + 1000);
    await A.attachDoc(d.id, pdf('q1r.pdf'), { kind: 'quotation', amount: 120000, target: 'forecast', basis: 'total', detected: 120000, docNo: 'QT-1 rev.1', docDate: '2026-10-01' });
    A.deleteDoc(d.id, q1.id);
    expect(A.sales.steps[`${d.id}/QUOTATION`]).toEqual({ d: '2026-09-25', n: 'ใบเสนอราคา QT-1 rev.1 · 120,000 บาท' });
    const inv = await A.attachDoc(d.id, pdf('i.pdf'), { kind: 'invoice', amount: 5000, target: 'actual', basis: 'total', detected: 5000, docNo: 'INV-1', docDate: '2026-10-02' });
    A.setStep(d.id, 'PAY1', { d: '2026-10-04', n: A.sales.steps[`${d.id}/PAY1`].n }); // the real payment day
    A.deleteDoc(d.id, inv.id);
    expect(A.sales.steps[`${d.id}/PAY1`]).toEqual({ d: '2026-10-04', n: '' });
  });

  it('a deal sent to the tracker doesn\'t make the company look contacted; stage dates do', () => {
    const c = A.B.companies.find((x) => x.ids.length === 1 && x.id < 900000 && !A.dealsOf(x.id).length)!;
    const d = A.addDealsFromCompanies([c.id], { year: '2569' }) && A.dealsOf(c.id)[0];
    expect(lastContact(A.sales, d, '2026-10-06')).toBe('');
    A.setStep(d.id, 'CALL1', { d: '2026-10-03', n: 'โทรแล้ว' });
    expect(lastContact(A.sales, A.sales.deals[d.id], '2026-10-06')).toBe('2026-10-03');
  });

  it('reconnecting doesn\'t bring back list items the team removed meanwhile', async () => {
    A.setSalesList('sections', [...A.sales.cfg.sections, 'Webinar']);
    await syncAll();
    expect(B.sales.cfg.sections).toContain('Webinar');
    B.teamDisconnect();
    A.setSalesList('sections', A.sales.cfg.sections.filter((x) => x !== 'Webinar'));
    await A.teamSync();
    expect(await B.teamConnect(URL, KEY)).toBe(true);
    await syncAll();
    for (const e of all()) expect(e.sales.cfg.sections).not.toContain('Webinar');
  });

  it('a malformed document record from the team is cleaned or skipped, never breaking totals', async () => {
    expect(toDoc({ amount: '500', target: 'actual' }, 'x', 'y')).toMatchObject({ amount: 500, at: '', kind: 'other' });
    expect(toDoc('junk', 'x', 'y')).toBeNull();
    const d = await fresh('ลูกค้าข้อมูลเสีย');
    sim.post({ action: 'push', key: KEY, ops: [{ k: `ddoc/${d.id}/bad1`, v: { amount: '500', target: 'actual' }, by: 'x' }, { k: `ddoc/${d.id}/bad2`, v: { amount: 1000, target: 'actual', at: 7 }, by: 'x' }, { k: `ddoc/${d.id}/bad3`, v: 'junk', by: 'x' }] });
    await B.teamSync();
    expect(dealMoney(B.sales, B.sales.deals[d.id]).actual).toBe(1500);
  });

  it('registry merge: a TGO-sync row never becomes the company of a shared hand-added customer; ids are the same on every browser', () => {
    const name = 'บริษัท ทดสอบทีจีโอและเพิ่มเอง จำกัด';
    const id = A.addCustomer({ name, jur: '0105512345678', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' });
    A.added.push({ id: 900555, name, jur: '', src: 1 } as never);
    A.rebuild();
    expect(A.company(900555)!.id).toBe(id);
    expect(A.company(id)!.jur).toBe('0105512345678');
  });

  it('registry merge: a hand-added customer\'s juristic id never merges two separate registry companies', () => {
    const k = (s: string) => s.replace(/\s+/g, '');
    const byName = new Map<string, number[]>();
    A.base!.rows.forEach((r) => {
      const row = r as unknown as [number, string, string];
      if (!row[2] && row[1] && row[1].length > 10) {
        const n = k(row[1]);
        byName.set(n, [...(byName.get(n) || []), row[0]]);
      }
    });
    const pair = [...byName.values()].find((ids) => ids.length === 2 && ids.every((i) => A.company(i)?.ids.length === 1));
    if (!pair) return; // dataset without such a pair
    const before = new Set(pair.map((i) => A.company(i)!.id));
    expect(before.size).toBe(2);
    A.addCustomer({ name: A.company(pair[0])!.name, jur: '0105598765432', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' });
    expect(new Set(pair.map((i) => A.company(i)!.id)).size).toBe(2);
  });

  it('registry CSV: names can\'t run as formulas; juristic ids and phones keep their 0', () => {
    const id = A.addCustomer({ name: '=HYPERLINK("http://x","y")', jur: '0105500000777', prov: '', ind: '', biz: '', addr: '', phone: '0812345678', email: '', web: '', contact: '', note: '' });
    const csv = A.registryCsv('co', [A.company(id)!]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain(`"=""0105500000777"""`);
    expect(csv).toContain(`"=""0812345678"""`);
  });
});
