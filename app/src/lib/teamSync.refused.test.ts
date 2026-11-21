/**
 * Changes the team sheet will not hold (team-sync/Code.gs push: a key over 500 characters, a value over MAX_CELL): the
 * browser drops them from its queue (sent again they would be refused again) and says which ones by name, and that
 * they are on this device only until a teammate's change to the record comes. The sources that could make one (a
 * certificate sheet's long cells, a tracker list) are cut short before they are queued.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { REVIEW_CELL_MAX, makeReview } from './sheetReview';
import { refusedWords, tooLongForSheet } from './teamSync';
import type { Dataset, RoundRaw } from './types';
import type { CertLine } from './registryXlsx';

const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/s/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

describe('the words for refused changes', () => {
  it('names the long ones (three, then how many more) and counts the others', () => {
    expect(refusedWords(['งาน ก'], 0)).toBe('ไม่ได้แชร์ งาน ก เพราะยาวเกินกว่าที่ชีตของทีมเก็บได้ · ตอนนี้มีอยู่ในเครื่องนี้เท่านั้น ถ้ามีคนในทีมแก้รายการนี้ ข้อมูลของทีมจะมาแทน ให้ย่อให้สั้นลงแล้วบันทึกใหม่');
    expect(refusedWords(['ก', 'ข', 'ค', 'ง', 'จ'], 0)).toContain('ไม่ได้แชร์ ก, ข, ค และอีก 2 รายการ เพราะ');
    expect(refusedWords([], 2)).toBe('ชีตของทีมไม่รับอีก 2 รายการ จึงไม่ได้แชร์');
    expect(refusedWords(['ก'], 1)).toMatch(/^ไม่ได้แชร์ ก .* · ชีตของทีมไม่รับอีก 1 รายการ จึงไม่ได้แชร์$/);
    expect(refusedWords([], 0)).toBe('');
  });
  it('too long: a key over 500 characters or a value over the sheet cell; a deletion carries no value', () => {
    expect(tooLongForSheet({ k: 'x/' + 'a'.repeat(499), v: 1 })).toBe(true);
    expect(tooLongForSheet({ k: 'x/1', v: 'a'.repeat(44001) })).toBe(true);
    expect(tooLongForSheet({ k: 'x/1', v: 'a'.repeat(1000) })).toBe(false);
    expect(tooLongForSheet({ k: 'x/1', v: undefined, del: true })).toBe(false);
  });
});

describe('a certificate sheet row kept for review is cut to fit the team record', () => {
  it('a long note, address or cell keeps its first REVIEW_CELL_MAX characters', () => {
    const long = 'ก'.repeat(30000);
    const f = { cert: 'TGO CFO 1', org: 'บริษัท ก', branch: '', act: '', addr: long, zip: '', prov: '', ind: '', size: '', ap: '', ex: '', fy: '', s1: null, s2: null, s3: null, note: long, webId: '' };
    const line: CertLine = { rowNo: 2, f, errors: [], vals: { หมายเหตุ: long, เลขที่: 'TGO CFO 1' } };
    const r = makeReview(line, 'ไม่พบบริษัท', 'a.xlsx', '2026-11-21T00:00:00Z', 'คุณ ก');
    expect(r.f.note).toHaveLength(REVIEW_CELL_MAX);
    expect(r.f.addr).toHaveLength(REVIEW_CELL_MAX);
    expect(r.vals['หมายเหตุ']).toHaveLength(REVIEW_CELL_MAX);
    expect(r.vals['เลขที่']).toBe('TGO CFO 1');
    expect(JSON.stringify(r).length).toBeLessThan(44000);
  });
});

describe('a change the sheet refuses, from the browser to the team', () => {
  let sim: GasSim;
  let A: GccEngine, B: GccEngine;
  beforeAll(async () => {
    const g = json('gcc.json'), c = json('gcc-certs.json');
    const base: Dataset = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' };
    const R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
    sim = createGasSim({ teamKey: KEY });
    const mk = () => {
      const e = new GccEngine();
      e.base = structuredClone(base);
      e.R = R;
      e.ref = '2026-11-21';
      e.rebuild();
      e.loading = false;
      e.transport = async (_u, body) => sim.post(body);
      e.fileTransport = async (_u, body) => sim.post(body);
      e.store = memoryStore();
      return e;
    };
    A = mk();
    B = mk();
    expect(await A.teamConnect(URL, KEY)).toBe(true);
    expect(await B.teamConnect(URL, KEY)).toBe(true);
  });
  afterAll(() => {
    A.dispose();
    B.dispose();
  });

  it('is named in the sync error and the team note, leaves the queue, and stays on this device only', async () => {
    // a tracker list of 300 long items: each is cut to 200 characters, the list is still too long for one record
    const items = Array.from({ length: 300 }, (_, i) => `แหล่งที่มา ${i} ` + 'ก'.repeat(400));
    A.setSalesList('sources', items);
    expect(A.sales.cfg.sources.every((x) => x.length <= 200)).toBe(true);
    A.addDeal({ client: 'ลูกค้าที่ส่งได้', section: 'Partner', year: '2569' }); // shared in the same round
    await A.teamSync();
    expect(A.team.status).toBe('error');
    expect(A.team.msg).toContain('ไม่ได้แชร์ รายการตั้งค่า sources เพราะยาวเกินกว่าที่ชีตของทีมเก็บได้');
    expect(A.team.msg).toContain('มีอยู่ในเครื่องนี้เท่านั้น');
    expect(A.teamNote).toBe(A.team.msg);
    expect([...(A as unknown as { pending: Map<string, unknown> }).pending.keys()]).not.toContain('scfg/sources');
    expect(A.sales.cfg.sources).toHaveLength(300); // still here
    // the team has the job, not the list
    await B.teamSync();
    expect(Object.values(B.sales.deals).some((d) => d.client === 'ลูกค้าที่ส่งได้')).toBe(true);
    expect(B.sales.cfg.sources.some((x) => x.startsWith('แหล่งที่มา 0 '))).toBe(false);
    // the next round sends nothing again and goes through; the note stays until it is hidden
    await A.teamSync();
    expect(A.team.status).toBe('ok');
    expect(A.teamNote).toContain('รายการตั้งค่า sources');
  });
});
