/**
 * "ดึงใบรับรอง CFO ใหม่จาก อบก." reading the Google Sheet feed of the CFO web app (Apps Script `?format=json`).
 * A pull never adds to the registry: each new certificate waits in the shared review queue (tgo/ records, 'p').
 * An approver accepts (st 'a': the company and the certificate come into the registry) or rejects (st 'r': kept,
 * never pulled again as new). Known certificates are skipped; pulled ones without details get them from the feed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000 }); // each pull and approval rebuilds the whole registry
import { GccEngine } from './engine';
import { memoryStore, PREF } from './storage';
import { FEED_URL, feedUrl, fetchFeed, fromFeed, provName, type FeedRow } from './tgoSync';
import type { Cert, Dataset, RoundRaw } from './types';

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
// a second certificate of that same new organisation, in the same pull
const NEW_CO_2 = { ...NEW_CO, id: '99003', cert: 'TGO CFO FY27-903' } as FeedRow;
// an expired certificate (approved 2025, expired 30 Jun 2026): the feed includes it, the status comes from the date
const EXPIRED = row({
  id: '88001', cert: 'TGO CFO FY25-77', act: 'ค้าปลีก', org: 'บริษัท หมดอายุแล้ว จำกัด (สำนักงานใหญ่)', addr: '1 ถนนสุขุมวิท กรุงเทพฯ 10110', changwat: 'กรุงเทพฯ',
  ind: 'ค้าปลีก', size: 'SME', apBE: '01/07/2568', exBE: '30/06/2569', ap: '', ex: '', fy: 'FY25', s1: 0.5, s2: 0.2, s3: 0.3,
});
// the same certificate as the feed later sends it in full, while the first pull had no details
const NEW_NO_DETAIL = { ...NEW_CO, addr: '', ind: '', size: '', zip: '', changwat: '', s1: null, s2: null, s3: null } as FeedRow;

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
const rids = (rows: { rid: string }[]) => rows.map((r) => r.rid).sort();
const tick = () => new Promise<void>((r) => setImmediate(r));

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
    const it0 = fromFeed({ ...NEW_CO, id: '99,002.0', fy: '' });
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

describe('pull into the review queue', () => {
  it('asks for the whole feed (no window, no status) and queues only what the registry lacks', async () => {
    const e = engine();
    const before = e.B.certs.length;
    serve({ ok: true, rows: [KNOWN, SAME_CO, NEW_CO, EXPIRED], webTotal: 4491, sheetRows: 4491, lastCheck: '2026-10-26 10:40' });
    await e.runSync(false);
    expect(urls[0]).toBe(FEED + '?format=json');
    expect(e.sy.status).toBe('ready');
    expect(rids(e.tgoRows('p'))).toEqual(['88001', '99001', '99002'].sort());
    // nothing is in the registry yet: a pull only queues
    expect(e.B.certs.length).toBe(before);
    expect(e.B.companies.some((c) => c.name === NEW_CO.org)).toBe(false);
    // the row of a company the registry has says so
    const sameRow = e.tgoRows('p').find((r) => r.rec.cert === SAME_CO.cert)!;
    expect(sameRow.gid).toBe(e.B.certs.find((c) => c.webId === '32040')!.gid);
    expect(e.tgoRows('p').find((r) => r.rec.cert === NEW_CO.cert)!.gid).toBeNull();

    // a second pull of the same feed queues nothing more
    await e.runSync(false);
    expect(rids(e.tgoRows('p'))).toEqual(['88001', '99001', '99002'].sort());
    expect(e.sy.msg).toContain('ข้อมูลตรงกับ Google Sheet แล้ว');
  });

  it('approving brings the certificates and their details into the registry', async () => {
    const e = engine();
    const before = e.B.certs.length;
    serve({ ok: true, rows: [KNOWN, SAME_CO, NEW_CO], webTotal: 4491 });
    await e.runSync(false);
    expect(e.approveTgo(['99001', '99002'])).toBe(2);
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(e.B.certs.length).toBe(before + 2);
    const a = e.B.certs.find((c) => c.cert === 'TGO CFO FY27-901')!;
    expect(a.indName).toBe('ยานยนต์');
    expect(a.provName).toBe('ชลบุรี');
    expect(a.addr).toBe(SAME_CO.addr);
    expect([a.s1, a.s2, a.s3]).toEqual([0.1, 0.3, 0.6]);
    expect(a.hasScope).toBe(true);
    expect(a.gid).toBe(e.B.certs.find((c) => c.webId === '32040')!.gid);
    expect(e.company(a.gid)!.cfoEx).toBe('2027-10-20');
    const b = e.B.certs.find((c) => c.cert === 'TGO CFO FY27-902')!;
    const co = e.company(b.gid)!;
    expect(b.provName).toBe('กรุงเทพมหานคร');
    expect(e.B.D.prov[co.prov]).toBe('กรุงเทพมหานคร');
    expect(co.addr).toBe(NEW_CO.addr);
    expect(co.name).toBe(NEW_CO.org);
    expect(b.note).toContain('Google Sheet');

    // a second pull finds nothing new
    serve({ ok: true, rows: [KNOWN, SAME_CO, NEW_CO], webTotal: 4491 });
    await e.runSync(false);
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(e.sy.msg).toContain('ข้อมูลตรงกับ Google Sheet แล้ว');
  });

  it('two new certificates for one new organisation in one pull make ONE company', async () => {
    const e = engine();
    serve({ ok: true, rows: [NEW_CO, NEW_CO_2], webTotal: 4491 });
    await e.runSync(false);
    expect(e.tgoRows('p')).toHaveLength(2);
    expect(e.approveTgo(rids(e.tgoRows('p')))).toBe(2);
    const cos = e.B.companies.filter((c) => c.name === NEW_CO.org);
    expect(cos).toHaveLength(1);
    const certs = e.B.certs.filter((c) => c.cert === 'TGO CFO FY27-902' || c.cert === 'TGO CFO FY27-903');
    expect(certs.map((c) => c.gid)).toEqual([cos[0].id, cos[0].id]);
  });

  it('the same organisation approved in separate steps still makes one company', async () => {
    const e = engine();
    serve({ ok: true, rows: [NEW_CO, NEW_CO_2], webTotal: 4491 });
    await e.runSync(false);
    e.approveTgo(['99002']);
    e.approveTgo(['99003']);
    expect(e.B.companies.filter((c) => c.name === NEW_CO.org)).toHaveLength(1);
  });

  it('a rejected row stays out of the registry and is not pulled again as new', async () => {
    const e = engine();
    serve({ ok: true, rows: [NEW_CO], webTotal: 4491 });
    await e.runSync(false);
    expect(e.rejectTgo(['99002'])).toBe(1);
    expect(rids(e.tgoRows('r'))).toEqual(['99002']);
    expect(e.B.certs.some((c) => c.cert === NEW_CO.cert)).toBe(false);
    expect(e.B.companies.some((c) => c.name === NEW_CO.org)).toBe(false);
    await e.runSync(false);
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(rids(e.tgoRows('r'))).toEqual(['99002']);
  });

  it('an expired certificate is pulled and approved, and its status comes from the expiry date', async () => {
    const e = engine();
    serve({ ok: true, rows: [EXPIRED], webTotal: 4491 });
    await e.runSync(false);
    expect(rids(e.tgoRows('p'))).toEqual(['88001']);
    e.approveTgo(['88001']);
    const c = e.B.certs.find((x) => x.cert === EXPIRED.cert)!;
    expect(c.ex).toBe('2026-06-30');
    expect(c.st).toBe('expired');
  });

  it('a certificate pulled without details gets them from a later feed row, without a second copy', async () => {
    const e = engine();
    serve({ ok: true, rows: [NEW_NO_DETAIL], webTotal: 4491 });
    await e.runSync(false);
    e.approveTgo(['99002']);
    const n = e.B.certs.length;
    serve({ ok: true, rows: [NEW_CO], webTotal: 4491 });
    await e.runSync(false);
    expect(e.tgoRows('p')).toHaveLength(0);
    expect(e.sy.msg).toContain('เติมรายละเอียดใบที่ดึงไว้ 1 ใบ');
    expect(e.B.certs.length).toBe(n);
    const c = e.B.certs.find((x) => x.cert === NEW_CO.cert)!;
    expect(c.indName).toBe('อาหาร');
    expect(c.addr).toBe(NEW_CO.addr);
  });

  it('a queued certificate without details gets them from the feed row with its number, even when another row with its web id comes after it', async () => {
    const e = engine();
    const bare = { ...NEW_CO, addr: '', ind: '', size: '', zip: '', changwat: '', s1: null, s2: null, s3: null } as FeedRow;
    serve({ ok: true, rows: [bare], webTotal: 2 });
    await e.runSync(false);
    // the same web id again, in one pull: the full row of the certificate (under its organisation's other spelling, so the
    // organisation key does not find it), then another certificate with that web id, which comes last
    const full = { ...NEW_CO, org: 'บริษัท ทดสอบซิงก์ชีต (เปลี่ยนชื่อ) จำกัด' } as FeedRow;
    const other = row({ id: '99002', cert: 'TGO CFO FY27-950', org: 'บริษัท อื่นที่ใช้รหัสเดียวกัน จำกัด', addr: '9 ถนนอื่น กรุงเทพฯ 10110', ind: 'การผลิต', size: 'SME' });
    serve({ ok: true, rows: [full, other], webTotal: 3 });
    await e.runSync(false);
    const c = e.tgoRows('p').find((x) => x.rec.cert === NEW_CO.cert)!;
    expect(c.rec).toMatchObject({ addr: full.addr, ind: full.ind, size: full.size });
    expect(e.tgoRows('p').map((x) => x.rec.cert).sort()).toEqual([NEW_CO.cert, other.cert].sort());
  });

  it('two feed rows with one web id and organisation but different numbers are two certificates, in one pull or in two', async () => {
    const A = row({ id: '99010', cert: 'TGO CFO FY27-910', org: 'บริษัท คู่รหัสเดียวกัน จำกัด (สำนักงานใหญ่)', addr: '1 ถนนทดสอบ กรุงเทพฯ 10110', changwat: 'กรุงเทพฯ', ind: 'การผลิต', size: 'SME' });
    const B = { ...A, cert: 'TGO CFO FY27-911' } as FeedRow;
    const one = engine();
    serve({ ok: true, rows: [A, B], webTotal: 2 });
    await one.runSync(false);
    expect(one.tgoRows('p').map((x) => x.rec.cert).sort()).toEqual(['TGO CFO FY27-910', 'TGO CFO FY27-911']);
    const two = engine();
    serve({ ok: true, rows: [A], webTotal: 1 });
    await two.runSync(false);
    serve({ ok: true, rows: [B], webTotal: 1 });
    await two.runSync(false);
    expect(two.tgoRows('p').map((x) => x.rec.cert).sort()).toEqual(['TGO CFO FY27-910', 'TGO CFO FY27-911']);
  });

  it('a pulled row waits in the store, so it is still there after a reload', async () => {
    const e = engine();
    serve({ ok: true, rows: [NEW_CO, SAME_CO], webTotal: 4491 });
    await e.runSync(false);
    await tick();
    const saved = await e.store.get<Record<string, { st: string }>>('tgoRecs');
    expect(Object.values(saved!).map((r) => r.st)).toEqual(['p', 'p']);
  });

  it('certificates pulled before the queue existed become shared records, with their companies', () => {
    const e = engine();
    const legacy = [
      { gid: 900001, cert: 'TGO CFO FY25-5', org: 'บริษัท เก่าในเครื่อง จำกัด', branch: 'สำนักงานใหญ่', act: 'ค้าปลีก', webId: '55001', ap: '2025-07-01', ex: '2026-06-30', ind: -1, size: -1, addr: '', prov: -1, provTxt: 'ชลบุรี', zip: '', fy: -1, s1: null, s2: null, s3: null, phone: '', email: '', note: 'เก่า' },
    ] as unknown as Partial<Cert>[];
    e.added = [{ id: 900001, name: 'บริษัท เก่าในเครื่อง จำกัด', jur: '', type: 0, prov: 0, addr: '', ind: 0, biz: '', src: 1, tgt: 0, cfo: 0, cfoN: 0, cfoEx: '', giNow: null, giMax: null, giUntil: '', newYm: '', invest: null, fac: null, set: '', mkt: '', phone: '', email: '', web: '', ct: 0, match: 0 }] as never;
    e.adoptLegacyCerts(legacy);
    e.rebuild();
    expect(e.added).toHaveLength(0);
    const r = e.tgo['55001'];
    expect(r).toMatchObject({ st: 'a', cert: 'TGO CFO FY25-5' });
    expect(r.gid).toBeGreaterThanOrEqual(1e12);
    expect(e.company(r.gid!)!.name).toBe('บริษัท เก่าในเครื่อง จำกัด');
    expect(e.B.certs.find((c) => c.cert === 'TGO CFO FY25-5')!.gid).toBe(r.gid);
  });

  it('two legacy certificates with one web id are both adopted: the second under its number and organisation, not dropped', () => {
    const e = engine();
    const leg = (cert: string, org: string) => ({
      webId: '55002', cert, org, branch: 'สำนักงานใหญ่', act: 'ค้าปลีก', ap: '2025-07-01', ex: '2026-06-30', ind: -1, size: -1, addr: '', prov: -1,
      provTxt: 'ชลบุรี', zip: '', fy: -1, s1: null, s2: null, s3: null, phone: '', email: '', note: '',
    });
    e.adoptLegacyCerts([leg('TGO CFO FY25-6', 'บริษัท เก่า ก จำกัด'), leg('TGO CFO FY25-7', 'บริษัท เก่า ข จำกัด')] as unknown as Partial<Cert>[]);
    e.rebuild();
    expect(e.tgo['55002']).toMatchObject({ st: 'a', cert: 'TGO CFO FY25-6' });
    expect(Object.values(e.tgo).filter((r) => r.st === 'a').map((r) => r.cert).sort()).toEqual(['TGO CFO FY25-6', 'TGO CFO FY25-7']);
  });
});

describe('name keys', () => {
  it('byNorm skips names under 3 characters, like the duplicate check does', () => {
    const e = engine();
    const co = (name: string) => ({ name, jur: '', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' });
    e.addCustomer(co('AB'));
    e.addCustomer(co('ABC'));
    expect(e.byNorm.has('ab')).toBe(false);
    expect(e.byNorm.has('abc')).toBe(true);
  });
});

describe('the feed link', () => {
  it('an empty link, also one saved by the build without a built-in link, means the built-in link', async () => {
    localStorage.setItem(PREF.sync, JSON.stringify({ feed: '', freq: 'off', proxy: '' }));
    const e = engine();
    expect(e.syncCfg().feed).toBe(FEED_URL);
    serve({ ok: true, rows: [KNOWN], webTotal: 4491 });
    await e.runSync(false);
    expect(urls[0].startsWith(FEED_URL + '?format=json')).toBe(true);
    expect(e.sy.msg).toContain('ข้อมูลตรงกับ Google Sheet แล้ว');
    // a link typed in the field wins
    e.saveSync({ feed: FEED });
    expect(e.syncCfg().feed).toBe(FEED);
  });
});
