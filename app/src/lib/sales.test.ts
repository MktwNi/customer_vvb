import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { norm } from './core';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import {
  dealMoney, dealResult, dealStatus, emptySales, filterDeals, fixPhone, htmlToText, importId, isoDate, looseMoney, matchSource, money, newDeal, overdueDays,
  parseContact, parseCsv, parseTrackerJson, parseTrackerSheet, salesStats, DEFAULT_SECTIONS, DEFAULT_SOURCES, type Deal, type SalesState,
} from './sales';
import { CUSTOM_ID_MIN, isLocalOnly } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const WAIT = { timeout: 15000 };
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/s/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

const deal = (p: Partial<Deal> = {}): Deal => newDeal({ id: p.id || 'd' + Math.random().toString(36).slice(2), client: 'บริษัท ก', year: '2569', ...p }, 'me', '2026-10-01T00:00:00.000Z');
const state = (deals: Deal[], steps: SalesState['steps'] = {}): SalesState => ({ ...emptySales(), deals: Object.fromEntries(deals.map((d) => [d.id, d])), steps });

describe('sales tracker rules (same as the original tracker)', () => {
  it('result, status, overdue and money', () => {
    const a = deal({ id: 'a', contactDate: '2026-09-01' });
    const b = deal({ id: 'b', contactDate: '2026-10-05', jobStatus: 'closed' });
    const c = deal({ id: 'c' });
    const S = state([a, b, c], { 'a/CLOSED DEAL': { d: '2026-09-20', n: ' yes ' }, 'c/CALL1': { d: '2026-10-02', n: '' }, 'b/CLOSED DEAL': { d: '', n: 'รอผู้บริหาร' } });
    expect(dealResult(S, a)).toBe('YES');
    expect(dealResult(S, b)).toBe('WAIT');
    expect(dealStatus(S, a).overall).toBe('ปิดการขายแล้ว');
    expect(dealStatus(S, b).overall).toBe('ปิดงาน');
    expect(dealStatus(S, c).overall).toBe('กำลังดำเนินการ');
    expect(dealStatus(S, deal()).overall).toBe('ยังไม่เริ่ม');
    expect(overdueDays(a, '2026-10-06')).toBe(35);
    expect(overdueDays(a, '2026-09-10')).toBeNull(); // ≤ 14 days
    expect(overdueDays(b, '2026-12-01')).toBeNull(); // closed jobs are never overdue
    expect(money('1,234.50 บาท')).toBe(1234.5);
    expect(money('฿ 12 000')).toBe(12000);
    expect(money('abc')).toBeNull();
    expect(money('')).toBeNull();
  });

  it('a confirmed quotation backs the forecast; confirmed invoices add up to the actual', () => {
    const d = deal({ id: 'x', forecast: 50000, actual: 1000, fcDoc: 'q1' });
    const S = state([d]);
    S.docs['x/q1'] = { id: 'q1', deal: 'x', kind: 'quotation', name: 'q.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: 'QT-1', docDate: '', amount: 53500, target: 'forecast', detected: 53500, basis: 'total', stage: 'QUOTATION', at: '1', by: '' };
    S.docs['x/i1'] = { ...S.docs['x/q1'], id: 'i1', kind: 'invoice', amount: 20000, target: 'actual', at: '2' };
    S.docs['x/i2'] = { ...S.docs['x/q1'], id: 'i2', kind: 'invoice', amount: 33500, target: 'actual', at: '3' };
    expect(dealMoney(S, d)).toEqual({ forecast: 53500, fcConfirmed: true, actual: 53500, acConfirmed: true });
    delete S.docs['x/q1'];
    expect(dealMoney(S, d).forecast).toBe(50000); // its document was removed → the typed value counts again
    expect(dealMoney(S, d).fcConfirmed).toBe(false);
  });

  it('dashboard numbers: win rate = YES / decided, stage counts, per source / owner', () => {
    const ds = [deal({ id: '1', source: ['TGO'], resp: 'เอ', forecast: 100 }), deal({ id: '2', source: ['TGO'], resp: 'บี', forecast: 300 }), deal({ id: '3', source: ['Partner'], forecast: 50 }), deal({ id: '4' })];
    const S = state(ds, { '1/CLOSED DEAL': { d: '', n: 'YES' }, '2/CLOSED DEAL': { d: '', n: 'NO' }, '3/CLOSED DEAL': { d: '', n: 'YES' }, '1/CALL1': { d: '2026-10-01', n: '' } });
    const st = salesStats(S, ds, '2026-10-06');
    expect(st).toMatchObject({ total: 4, yes: 2, no: 1, none: 1, decided: 3, winRate: 67, forecast: 450 });
    expect(st.bySource.TGO).toEqual({ n: 2, forecast: 400, yes: 1, decided: 2 });
    expect(st.stages.find((x) => x.name === 'CALL1')!.n).toBe(1);
    expect(st.stages.find((x) => x.name === 'CLOSED DEAL')!.n).toBe(3);
    expect(st.byResp['(ไม่ระบุ)'].n).toBe(2);
  });

  it('filters: year, text in notes, source, result, contact day/month; section order', () => {
    const ds = [deal({ id: '1', section: 'TGO', contactDate: '2026-10-05' }), deal({ id: '2', section: 'Retention', client: 'อีกบริษัท' }), deal({ id: '3', year: '2568' })];
    const S = state(ds, { '2/CALL1': { d: '', n: 'ลูกค้าสนใจ CFO มาก' } });
    expect(filterDeals(S, { year: '2569' }).map((d) => d.id)).toEqual(['2', '1']); // Retention comes before TGO in the sections list
    expect(filterDeals(S, { year: '2569', q: 'สนใจ' }).map((d) => d.id)).toEqual(['2']);
    expect(filterDeals(S, { year: '2569', month: '10', day: '05' }).map((d) => d.id)).toEqual(['1']);
    expect(filterDeals(S, { year: '2569', result: 'EMPTY' })).toHaveLength(2);
    expect(filterDeals(S, { year: '2568' })).toHaveLength(1);
  });

  it('old tracker notes are rich HTML: only their text is kept (scripts can never run)', () => {
    expect(htmlToText('<b>โทรแล้ว</b><br>นัด <i>15</i> ต.ค.')).toBe('โทรแล้ว\nนัด 15 ต.ค.');
    expect(htmlToText('<img src=x onerror="alert(1)">ข้อความ')).toBe('ข้อความ');
    expect(htmlToText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>'); // shown as text, never as HTML
    expect(htmlToText('A &amp; B&nbsp;C')).toBe('A & B C');
  });

  it('reads the old tracker JSON backup and its Google Sheet (newest snapshot per year)', () => {
    const backup = {
      sources: ['TGO', 'Partner'], services: ['CFO'], progress: ['CALL1', 'QUOTATION', 'CLOSED DEAL'],
      rows: [
        { type: 'section', name: 'TGO' },
        { type: 'client', client: 'บริษัท ทดสอบ จำกัด', contactName: 'คุณเอ', phone: '02-000-0000', resp: 'บี', contactDate: '2026-09-30', jobStatus: 'open', forecast: '120,000', source: ['TGO'], service: ['CFO'], progress: { CALL1: { d: '2026-09-01', n: '<b>โทรแล้ว</b>' }, 'CLOSED DEAL': 'YES' } },
        { type: 'section', name: 'Partner' },
        { type: 'client', client: 'อีกราย', jobStatus: 'closed', closedDate: '2026-08-01' },
      ],
    };
    const t = parseTrackerJson(backup, '2569');
    expect(t.cfg).toMatchObject({ sections: ['TGO', 'Partner'], stages: ['CALL1', 'QUOTATION', 'CLOSED DEAL'] });
    expect(t.clients[0]).toMatchObject({ section: 'TGO', client: 'บริษัท ทดสอบ จำกัด', forecast: 120000, progress: { CALL1: { d: '2026-09-01', n: 'โทรแล้ว' }, 'CLOSED DEAL': { d: '', n: 'YES' } } });
    expect(t.clients[1]).toMatchObject({ section: 'Partner', jobStatus: 'closed' });
    expect(() => parseTrackerJson({ foo: 1 }, '2569')).toThrow();

    const csv = [
      'year,section,client,contactName,phone,email,resp,referral,contactDate,jobStatus,closedDate,statusJob,statusDeal,statusOverall,forecast,actual,source,service,progress,syncId,config',
      '2569,TGO,เก่า,,,,,,,open,,,,,,,,,{},S100,',
      '2569,TGO,"บริษัท ใหม่, จำกัด",คุณบี,,,ซี,,2026-10-01,open,,,,,"5,000",,"TGO, Partner",CFO,"{""CALL1"":{""d"":""2026-10-01"",""n"":""ok""}}",S200,',
      '2569,__CONFIG__,,,,,,,,,,,,,,,,,,S200,"{""sources"":[""TGO"",""Partner""],""services"":[""CFO""],""progressStages"":[""CALL1""],""sectionsOrder"":[""TGO""]}"',
      '2568,Partner,ปีก่อน,,,,,,,open,,,,,,,,,{},S50,',
    ].join('\n');
    const rows = parseCsv(csv);
    expect(rows[1].client).toBe('บริษัท ใหม่, จำกัด');
    const ys = parseTrackerSheet(rows);
    const y69 = ys.find((x) => x.year === '2569')!;
    expect(y69.clients.map((c) => c.client)).toEqual(['บริษัท ใหม่, จำกัด']); // only the newest snapshot S200
    expect(y69.clients[0]).toMatchObject({ forecast: 5000, source: ['TGO', 'Partner'], progress: { CALL1: { d: '2026-10-01', n: 'ok' } } });
    expect(y69.cfg.sections).toEqual(['TGO']);
    expect(ys.find((x) => x.year === '2568')!.clients).toHaveLength(1);
    // stable across edits in the old tracker: amount, section, contact person
    expect(importId('2569', t.clients[0], 1)).toBe(importId('2569', { ...t.clients[0], forecast: 1, section: 'Partner', contactName: 'คุณซี' }, 1));
    expect(importId('2569', t.clients[0], 1)).not.toBe(importId('2569', t.clients[0], 2));
  });

  it('what a sheet download does to dates, phones and amounts is undone; free-text amounts are kept', () => {
    expect(['2026-10-01', '1/10/2026', '01/10/2569', '15/1/2026', '1/15/2026', '2026/10/01', '46296', '31/2/2026', 'พรุ่งนี้', ''].map(isoDate))
      .toEqual(['2026-10-01', '2026-10-01', '2026-10-01', '2026-01-15', '2026-01-15', '2026-10-01', '2026-10-01', '', '', '']);
    expect(['812345678', '21234567', '0812345678', '02-123-4567', '', '+66812345678'].map(fixPhone)).toEqual(['0812345678', '021234567', '0812345678', '02-123-4567', '', '+66812345678']);
    expect(['120,000', '1.5 ล้าน', '3 แสน', '50,000-80,000', 'ประมาณ 200k', 'รอคุยราคา', '', 7000].map(looseMoney)).toEqual([
      { value: 120000, exact: true }, { value: 1500000, exact: true }, { value: 300000, exact: true }, { value: 50000, exact: false },
      { value: 200000, exact: true }, { value: null, exact: false }, { value: null, exact: true }, { value: 7000, exact: true },
    ]);
    const t = parseTrackerJson({ rows: [{ type: 'section', name: 'TGO' }, { type: 'client', client: 'ก', contact: 'คุณสมชาย 081-234-5678, som@example.co.th', forecast: '50,000-80,000', actual: '1.2 ล้าน' }] }, '2569');
    expect(t.clients[0]).toMatchObject({ contactName: 'คุณสมชาย', phone: '081-234-5678', email: 'som@example.co.th', forecast: 50000, forecastText: '50,000-80,000', actual: 1200000, actualText: '' });
    expect(parseContact('')).toEqual({ name: '', phone: '', email: '' });
  });

  it('starts with the old tracker\'s lists; a section ticks the SOURCE of the same channel', () => {
    expect(DEFAULT_SECTIONS).toEqual(expect.arrayContaining(['IEAT (กนอ).', 'อื่นๆ']));
    expect(['IEAT (กนอ).', 'TGO', 'set/MAI', 'อื่นๆ', ''].map((x) => matchSource(DEFAULT_SOURCES, x))).toEqual(['กนอ.', 'TGO', 'SET/mai', null, null]);
  });

  it('customers added by hand are shared; TGO-sync companies stay on their device', () => {
    expect(isLocalOnly('stage/900005')).toBe(true);
    expect(isLocalOnly(`stage/${CUSTOM_ID_MIN + 42}`)).toBe(false);
    expect(isLocalOnly('task/t', { gid: CUSTOM_ID_MIN + 7 })).toBe(false);
  });
});

describe('Sales Tracker between two browsers (real Code.gs, real dataset)', () => {
  let base: Dataset;
  let R: RoundRaw[];
  let sim: GasSim;
  let A: GccEngine, B: GccEngine;
  const mk = () => {
    const e = new GccEngine();
    e.base = structuredClone(base);
    e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
    e.ref = '2026-10-06';
    e.rebuild();
    e.loading = false;
    e.transport = async (_u, body) => sim.post(body);
    e.store = memoryStore();
    return e;
  };
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T05:00:00Z')); // "today" for stage dates and closing dates
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
  const cos = () => A.B.companies.filter((c) => c.ids.length === 1 && c.phone).slice(100, 110);

  it('a customer added by hand becomes a company everyone can find and track', async () => {
    const id = A.addCustomer({ name: 'บริษัท ทดลองเพิ่มเอง จำกัด', jur: '0105599999999', prov: 'เชียงใหม่', ind: 'อาหาร', biz: 'ผลิตอาหาร', addr: '', phone: '053-000-111', email: 'a@b.co', web: '', contact: 'คุณดี', note: '' });
    expect(id).toBeGreaterThanOrEqual(CUSTOM_ID_MIN);
    const c = A.company(id)!;
    expect(c.code).toMatch(/^NEW-/);
    expect(c.src & 16).toBe(16);
    expect(A.B.D.prov[c.prov]).toBe('เชียงใหม่');
    A.setStage(id, 'interested'); // CRM records on it are shared too
    await A.teamSync();
    await B.teamSync();
    expect(B.company(id)?.name).toBe('บริษัท ทดลองเพิ่มเอง จำกัด');
    expect(B.stage(id)).toBe('interested');
    expect(A.similarCompanies('บริษัท ทดลองเพิ่มเอง จำกัด', '').map((x) => x.id)).toContain(id);
  });

  it('starred companies go to the tracker in one step, with their contact details; no duplicates per year', async () => {
    const [c1, c2] = cos();
    A.toggleWatch(c1.id);
    A.toggleWatch(c2.id);
    const r1 = A.addDealsFromCompanies(A.crm.watch, { section: 'TGO', year: '2569' });
    expect(r1).toEqual({ added: 2, skipped: 0 });
    expect(A.addDealsFromCompanies([c1.id], { year: '2569' })).toEqual({ added: 0, skipped: 1 });
    const d1 = A.dealsOf(c1.id)[0];
    expect(d1).toMatchObject({ client: c1.name, phone: c1.phone, section: 'TGO', source: ['TGO'], year: '2569', jobStatus: 'open' });
    await A.teamSync();
    await B.teamSync();
    expect(B.dealsOf(c1.id).map((d) => d.id)).toEqual([d1.id]);
  });

  it('two people updating different stages of one deal both keep their change', async () => {
    const d = Object.values(A.sales.deals)[0];
    A.setStep(d.id, 'CALL1', { d: '2026-10-01', n: 'โทรแล้ว สนใจ' });
    B.setStep(d.id, 'QUOTATION', { d: '', n: 'ส่งใบเสนอราคา QT-001' }); // no date → today
    await A.teamSync();
    await B.teamSync();
    await A.teamSync();
    for (const e of [A, B]) {
      expect(e.sales.steps[`${d.id}/CALL1`].n).toBe('โทรแล้ว สนใจ');
      expect(e.sales.steps[`${d.id}/QUOTATION`]).toMatchObject({ n: 'ส่งใบเสนอราคา QT-001', d: '2026-10-06' });
    }
    expect(A.sales.deals[d.id].contactDate).toBe('2026-10-06'); // the latest stage date counts as the last contact
    A.setStep(d.id, 'FOLLOW1', { d: '2026-12-01', n: 'นัดติดตาม' }); // a planned (future) date is not a contact
    expect(A.sales.deals[d.id].contactDate).toBe('2026-10-06');
  });

  it('closing, deleting and list changes reach the other browser', async () => {
    const [d1, d2] = Object.values(A.sales.deals).filter((d) => d.year === '2569');
    A.updateDeal(d1.id, { jobStatus: 'closed' });
    A.setSalesList('services', [...A.sales.cfg.services, 'บริการใหม่']);
    B.deleteDeal(d2.id);
    await A.teamSync();
    await B.teamSync();
    await A.teamSync();
    expect(B.sales.deals[d1.id]).toMatchObject({ jobStatus: 'closed', closedDate: '2026-10-06' });
    expect(B.sales.cfg.services).toContain('บริการใหม่');
    expect(A.sales.deals[d2.id]).toBeUndefined();
    expect(Object.keys(A.sales.steps).some((k) => k.startsWith(d2.id + '/'))).toBe(false);
    expect(Object.values(B.sales.log).some((l) => l.action === 'ปิดงาน')).toBe(true);
  });

  it('a confirmed quotation becomes the forecast and fills the QUOTATION stage', async () => {
    const d = A.addDeal({ client: 'ลูกค้าไม่มีในทะเบียน', section: 'Partner', year: '2569' });
    expect(d.gid).toBeNull();
    const file = Object.assign(new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), { name: 'QT-2569-001.pdf' });
    const doc = await A.attachDoc(d.id, file, { kind: 'quotation', amount: 107000, target: 'forecast', basis: 'total', detected: 107000, docNo: 'QT-2569-001', docDate: '2026-10-03' });
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 107000, fcConfirmed: true });
    expect(A.sales.steps[`${d.id}/QUOTATION`]).toEqual({ d: '2026-10-03', n: 'ใบเสนอราคา QT-2569-001 · 107,000 บาท' });
    expect(await (await A.docBlob(doc)).text()).toBe('%PDF-1.4 test');
    A.updateDeal(d.id, { forecast: 90000 }); // typing a forecast replaces the document's (now unconfirmed)
    expect(dealMoney(A.sales, A.sales.deals[d.id])).toMatchObject({ forecast: 90000, fcConfirmed: false });
    await A.teamSync();
    await B.teamSync();
    expect(Object.values(B.sales.docs).find((x) => x.id === doc.id)).toMatchObject({ amount: 107000, docNo: 'QT-2569-001' });
  });

  it('attached files go to the team\'s Drive after a sync and open in another browser', async () => {
    A.fileTransport = B.fileTransport = async (_u, body) => sim.post(body);
    const d = A.addDeal({ client: 'ลูกค้าแนบไฟล์', section: 'Partner', year: '2569' });
    const bytes = new Uint8Array(3000).map((_, i) => (i * 7) % 256);
    const file = Object.assign(new Blob([bytes], { type: '' }), { name: 'INV-0099.pdf' }); // no type from the browser
    const doc = await A.attachDoc(d.id, file, { kind: 'invoice', amount: 53500, target: 'actual', basis: 'total', detected: 53500, docNo: 'INV-0099', docDate: '' });
    expect(doc.mime).toBe('application/pdf');
    expect(A.sales.steps[`${d.id}/PAY1`].n).toContain('53,500');
    await A.teamSync();
    await vi.waitFor(() => expect(A.sales.docs[`${d.id}/${doc.id}`].fileId).not.toBe(''), WAIT);
    await A.teamSync(); // sends the record that now carries the Drive file id
    await B.teamSync();
    const meta = B.sales.docs[`${d.id}/${doc.id}`];
    expect(meta.fileId).toBe(A.sales.docs[`${d.id}/${doc.id}`].fileId);
    expect(new Uint8Array(await (await B.docBlob(meta)).arrayBuffer())).toEqual(bytes);
    expect(dealMoney(B.sales, B.sales.deals[d.id])).toMatchObject({ actual: 53500, acConfirmed: true });
    B.deleteDoc(d.id, doc.id); // removes the Drive file too
    await vi.waitFor(() => expect(sim.post({ action: 'file', key: KEY, fileId: meta.fileId }).error).toBe('not_found'), WAIT);
  });

  it('imports the old tracker backup, links known companies, and re-importing never overwrites the team\'s edits', async () => {
    const [c] = cos().slice(5);
    // a name two different registry companies share is not linked to either
    const dup = [...A.byNorm.keys()].find((k) => A.B.companies.filter((x) => norm(x.name) === k && x.ids.length === 1).length > 1);
    const twin = dup && A.B.companies.find((x) => norm(x.name) === dup)!;
    expect(twin).toBeTruthy(); // the real registry has such names
    const rows = [
      { type: 'section', name: 'งานเก่า' },
      { type: 'client', client: c.name, resp: 'เอ', forecast: '50,000-80,000', progress: { CALL1: { d: '2026-09-01', n: '<b>นัดแล้ว</b>' } } },
      { type: 'client', client: 'ไม่มีในทะเบียนแน่นอน' },
      ...(twin ? [{ type: 'client', client: twin.name }] : []),
    ];
    const f = (r: unknown[]) => Object.assign(new Blob([JSON.stringify({ sources: ['TGO'], services: ['CFO'], progress: ['CALL1', 'CLOSED DEAL'], rows: r })]), { name: 'ตารางติดตามสถานะการขาย_2568.json' }) as File;
    const r = await A.importTracker(f(rows), '2568');
    expect(r).toEqual({ deals: rows.length - 1, skipped: 0, linked: 1, ambiguous: twin ? 1 : 0, inexact: 1, years: ['2568'] });
    expect(A.sales.cfg.sections).toContain('งานเก่า');
    const mine = Object.values(A.sales.deals).find((d) => d.year === '2568' && d.gid === c.id)!;
    expect(mine.forecast).toBe(50000);
    expect(Object.values(A.sales.log).some((l) => l.deal === mine.id && l.detail.includes('50,000-80,000'))).toBe(true);
    expect(A.sales.steps[`${mine.id}/CALL1`].n).toBe('นัดแล้ว');
    // the team works on the deal, then someone imports the same (older) file again
    A.updateDeal(mine.id, { forecast: 75000 });
    A.setStep(mine.id, 'CALL1', { d: '2026-09-01', n: 'นัดแล้ว ส่งใบเสนอราคาแล้ว' });
    const again = await A.importTracker(f(rows), '2568');
    expect(again).toMatchObject({ deals: 0, skipped: rows.length - 1 });
    expect(A.sales.deals[mine.id].forecast).toBe(75000);
    expect(A.sales.steps[`${mine.id}/CALL1`].n).toBe('นัดแล้ว ส่งใบเสนอราคาแล้ว');
    // a newer download where the section was renamed still finds the same rows
    expect((await A.importTracker(f([{ type: 'section', name: 'ชื่อใหม่' }, ...rows.slice(1)]), '2568')).deals).toBe(0);
    const ds = Object.values(A.sales.deals).filter((d) => d.year === '2568');
    expect(ds).toHaveLength(rows.length - 1);
    await A.teamSync();
    await B.teamSync();
    expect(Object.values(B.sales.deals).filter((d) => d.year === '2568')).toHaveLength(rows.length - 1);
  });

  it('editing one field after another is one history entry, not one per save', () => {
    const d = A.addDeal({ client: 'ประวัติสั้น', year: '2566' });
    const n = () => Object.values(A.sales.log).filter((l) => l.deal === d.id).length;
    const base = n();
    A.updateDeal(d.id, { phone: '021234567' });
    A.updateDeal(d.id, { email: 'a@b.co' });
    A.updateDeal(d.id, { phone: '029999999' });
    A.setStep(d.id, 'CALL1', { d: '', n: 'โทร' });
    A.setStep(d.id, 'CALL1', { d: '', n: 'โทรแล้ว นัดพรุ่งนี้' });
    expect(n()).toBe(base + 2);
    const logs = Object.values(A.sales.log).filter((l) => l.deal === d.id);
    expect(logs.find((l) => l.action === 'แก้ไข')!.detail).toBe('เบอร์, อีเมล');
    expect(logs.find((l) => l.action === 'อัปเดต CALL1')!.detail).toBe('โทรแล้ว นัดพรุ่งนี้');
    vi.setSystemTime(Date.now() + 11 * 60000); // the clock only: no sync timers fire
    A.updateDeal(d.id, { phone: '021111111' });
    expect(n()).toBe(base + 3);
  });

  it('a client already sent from the registry is not imported a second time that year', async () => {
    const [c] = cos().slice(6);
    A.addDealsFromCompanies([c.id], { year: '2567' });
    const f = Object.assign(new Blob([JSON.stringify({ rows: [{ type: 'section', name: 'TGO' }, { type: 'client', client: c.name }, { type: 'client', client: c.name }] })]), { name: 'x.json' }) as File;
    // the file has the client twice: one matches the deal already here, the second is new
    expect(await A.importTracker(f, '2567')).toMatchObject({ deals: 1, skipped: 1 });
    expect(Object.values(A.sales.deals).filter((d) => d.year === '2567' && d.client === c.name)).toHaveLength(2);
  });

  it('deals of companies that exist only on this device are not linked by id', () => {
    A.crm.stages[900001] = 'none';
    const d = A.addDeal({ gid: 900001, client: 'จาก TGO เครื่องนี้' });
    expect(d.gid).toBeNull();
  });

  it('a third browser connecting later receives the whole tracker', async () => {
    await A.teamSync();
    const C = mk();
    expect(await C.teamConnect(URL, KEY)).toBe(true);
    await vi.waitFor(() => expect(Object.keys(C.sales.deals).length).toBe(Object.keys(A.sales.deals).length), WAIT);
    expect(Object.keys(C.custom)).toEqual(Object.keys(A.custom));
    C.dispose();
  });
});
