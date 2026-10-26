/**
 * "ดึงใบรับรอง CFO ใหม่จาก อบก." reading the Google Sheet feed of the CFO web app (Apps Script `?format=json`):
 * new certificates come with their details, known ones (same TGO id, or same certificate no. + organisation)
 * are skipped, certificates pulled earlier from the list page get their details filled in, and errors read in Thai.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GccEngine } from './engine';
import { memoryStore, PREF } from './storage';
import { feedUrl, fetchFeed, fromFeed, provName, type FeedRow } from './tgoSync';
import type { Dataset, RoundRaw } from './types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-26';
const FEED = 'https://script.google.com/macros/s/TEST/exec';

const row = (o: Partial<FeedRow>): FeedRow => ({
  id: '', cert: '', act: '', org: '', branch: 'สำนักงานใหญ่', prov: 'กรุงเทพฯ', addr: '', tambon: '', amphoe: '', changwat: '', zip: '', ind: '', size: '',
  apBE: '21/10/2569', exBE: '20/10/2570', ap: '2026-10-21', ex: '2027-10-20', s1: null, s2: null, s3: null, fy: 'FY27', note: '', flags: '', ...o,
});

// already in gcc-certs.json (TGO id 32040)
const KNOWN = row({ id: '32040', cert: 'TGO CFO FY26-1004', act: 'ผลิตชิ้นส่วนยานยนต์', org: 'บริษัท ทีบีเคเค (ประเทศไทย) จำกัด (สำนักงานใหญ่)', prov: 'ชลบุรี', ap: '2026-08-31', ex: '2027-08-30', apBE: '31/08/2569', exBE: '30/08/2570', fy: 'FY26' });
// a new certificate for a company the registry has
const SAME_CO = row({
  id: '99001', cert: 'TGO CFO FY27-901', act: 'ผลิตชิ้นส่วนยานยนต์', org: 'บริษัท ทีบีเคเค (ประเทศไทย) จำกัด (สำนักงานใหญ่)', prov: 'ชลบุรี',
  addr: '700/1017 มาบโป่ง พานทอง ชลบุรี 20160', changwat: 'ชลบุรี', zip: '20160', ind: 'ยานยนต์', size: 'ใหญ่', s1: 0.1, s2: 0.3, s3: 0.6,
});
// a new organisation
const NEW_CO = row({
  id: '99002', cert: 'TGO CFO FY27-902', act: 'ผลิตท่อ HDPE', org: 'บริษัท ทดสอบซิงก์ชีต จำกัด (สำนักงานใหญ่)',
  addr: '42 เพชรเกษม หนองค้างพลู หนองแขม กรุงเทพฯ 10160', changwat: 'กรุงเทพฯ', zip: '10160', ind: 'อาหาร', size: 'SME', s1: 0.0029, s2: 0.1448, s3: 0.8523,
});

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

let urls: string[] = [];
function serve(body: unknown, status = 200) {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    urls.push(String(u));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }));
}

beforeEach(() => {
  const ls = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
    setItem: (k: string, v: string) => void ls.set(k, String(v)),
    removeItem: (k: string) => void ls.delete(k),
  });
  localStorage.setItem(PREF.sync, JSON.stringify({ feed: FEED, freq: 'off', autoApply: false }));
});
afterEach(() => vi.unstubAllGlobals());

describe('feed helpers', () => {
  it('spells out Bangkok and builds the feed link', () => {
    expect(provName('กรุงเทพฯ')).toBe('กรุงเทพมหานคร');
    expect(provName('จ.ชลบุรี')).toBe('ชลบุรี');
    expect(feedUrl(FEED, '2026-04-24')).toBe(FEED + '?format=json&since=2026-04-24');
    expect(feedUrl(FEED + '?x=1', '')).toBe(FEED + '?x=1&format=json');
  });

  it('maps a feed row, keeping the details the list page lacks', () => {
    const it0 = fromFeed({ ...NEW_CO, id: '99002.0', fy: '' });
    expect(it0).toMatchObject({ id: '99002', cert: 'TGO CFO FY27-902', fy: 'FY27', ap: '2026-10-21', ex: '2027-10-20', zip: '10160', ind: 'อาหาร', size: 'SME', s1: 0.0029 });
  });

  it('says in Thai when the link is not the web app (a sign-in page comes back) or the sheet failed', async () => {
    serve('<html>Sign in</html>');
    await expect(fetchFeed({ url: FEED })).rejects.toThrow('ลงท้ายด้วย /exec');
    serve({ ok: false, error: 'ไม่พบชีต "ข้อมูล CFO"' });
    await expect(fetchFeed({ url: FEED })).rejects.toThrow('ไม่พบชีต');
    serve('x', 500);
    await expect(fetchFeed({ url: FEED })).rejects.toThrow('HTTP 500');
  });
});

describe('sync from the Google Sheet feed', () => {
  it('asks for recent approvals only and offers just the certificates not held, with their details', async () => {
    const e = engine();
    const before = e.B.certs.length;
    serve({ ok: true, rows: [KNOWN, SAME_CO, NEW_CO], webTotal: 4491, sheetRows: 4491, lastCheck: '2026-10-26 10:40', since: e.feedSince() });
    await e.runSync(false);
    expect(urls[0]).toBe(FEED + '?format=json&since=' + e.feedSince());
    expect(e.feedSince() < '2026-08-31').toBe(true);
    expect(e.sy.status).toBe('ready');
    const st = e.pendingSync!;
    expect(st.nw.map((x) => x.cert)).toEqual(['TGO CFO FY27-901', 'TGO CFO FY27-902']);
    const tbkk = e.B.certs.find((c) => c.webId === '32040')!;
    expect(st.nw[0].gid).toBe(tbkk.gid);
    expect(st.nw[1].gid).toBeNull();

    e.applySync(false);
    expect(e.sy.status).toBe('done');
    expect(e.B.certs.length).toBe(before + 2);
    const a = e.B.certs.find((c) => c.cert === 'TGO CFO FY27-901')!;
    expect(a.indName).toBe('ยานยนต์');
    expect(a.provName).toBe('ชลบุรี');
    expect(a.addr).toBe(SAME_CO.addr);
    expect([a.s1, a.s2, a.s3]).toEqual([0.1, 0.3, 0.6]);
    expect(a.hasScope).toBe(true);
    expect(e.company(a.gid)!.cfoEx).toBe('2027-10-20');
    const b = e.B.certs.find((c) => c.cert === 'TGO CFO FY27-902')!;
    const co = e.company(b.gid)!;
    expect(b.provName).toBe('กรุงเทพมหานคร');
    expect(e.B.D.prov[co.prov]).toBe('กรุงเทพมหานคร');
    expect(co.addr).toBe(NEW_CO.addr);
    expect(b.note).toContain('Google Sheet');

    // a second pull finds nothing new
    serve({ ok: true, rows: [KNOWN, SAME_CO, NEW_CO], webTotal: 4491 });
    await e.runSync(false);
    expect(e.pendingSync).toBeNull();
    expect(e.sy.msg).toContain('ข้อมูลตรงกับ Google Sheet แล้ว');
  });

  it('fills in certificates pulled earlier from the list page (no details) instead of adding them again', async () => {
    const e = engine();
    const gid = e.B.certs.find((c) => c.webId === '32040')!.gid;
    e.tgoCerts.push({ gid, cert: SAME_CO.cert, org: SAME_CO.org, branch: 'สำนักงานใหญ่', act: SAME_CO.act, ind: -1, size: -1, addr: '', prov: -1, provTxt: 'ชลบุรี', zip: '', ap: SAME_CO.ap, ex: SAME_CO.ex, fy: -1, s1: null, s2: null, s3: null, phone: '', email: '', webId: '', note: 'ดึงจากเว็บไซต์ TGO อัตโนมัติ' });
    e.rebuild();
    const n = e.B.certs.length;
    serve({ ok: true, rows: [KNOWN, SAME_CO], webTotal: 4491 });
    await e.runSync(false);
    expect(e.pendingSync).toBeNull();
    expect(e.sy.msg).toContain('เติมรายละเอียดใบที่ดึงไว้ 1 ใบ');
    expect(e.B.certs.length).toBe(n);
    const a = e.B.certs.find((c) => c.cert === SAME_CO.cert)!;
    expect(a.indName).toBe('ยานยนต์');
    expect(a.webId).toBe('99001');
    expect(a.zip).toBe('20160');
  });

  it('keeps the old way (TGO page through a proxy) when the feed link is empty', async () => {
    localStorage.setItem(PREF.sync, JSON.stringify({ feed: '', freq: 'off' }));
    const e = engine();
    serve('<html>blocked</html>');
    await e.runSync(false);
    expect(urls[0]).toContain('thaicarbonlabel.tgo.or.th');
    expect(e.sy.status).toBe('error');
  });
});
