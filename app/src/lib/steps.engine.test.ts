/**
 * The five steps in the engine, against the real team script (team-sync/Code.gs in the simulator): new writes
 * go to the new ids (CONTACT, FOLLOW, PAY1 … PAYn), a browser still on an older build keeps writing CALL1 …
 * FOLLOW2 and what it writes shows in the new steps, the team's stored list is never rewritten, an import of the
 * old tracker's file and a backup put nothing back into it, and the CSV has a column pair per step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { GccEngine } from './engine';
import { memoryStore } from './storage';
import { DEFAULT_STAGES, closeReady, dealSteps, lastContactInfo, overdueDays, parseCsv, planOf, quickMatch, type Deal, type DealDoc } from './sales';
import type { SyncOp } from './teamSync';
import type { Dataset, RoundRaw } from './types';

vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/st/exec';
const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(DATA + '/' + f, 'utf8'));
const TODAY = '2026-10-06';

let base: Dataset, R: RoundRaw[], sim: GasSim;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const rows = g.rows.slice(0, 200);
  const ids = new Set(rows.map((r: unknown[]) => r[0]));
  base = { asOf: g.asOf, dicts: g.dicts, rows, cdicts: c.dicts, certs: c.rows.filter((r: unknown[]) => ids.has(r[0])), source: 'file' };
  R = json('rounds.json');
});
afterAll(() => vi.useRealTimers());

function mk(name: string) {
  const e = new GccEngine();
  e.base = structuredClone(base);
  e.R = R.map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) }));
  e.ref = TODAY;
  e.store = memoryStore();
  (e as unknown as { me: () => string }).me = () => name;
  e.rebuild();
  e.loading = false;
  e.transport = async (_u, body) => sim.post(body);
  e.fileTransport = async (_u, body) => sim.post(body);
  return e;
}
/** Two people on one team-code team: A on this build, B standing in for a browser on an older build (it writes
 *  the eight stages' records, as such a browser does). */
async function team() {
  sim = createGasSim({ teamKey: KEY });
  const A = mk('เอ'), B = mk('บี');
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
const rowsOf = (prefix: string) => sim.post({ action: 'pull', key: KEY, since: 0 }).rows!.filter((x) => x.k.startsWith(prefix));
function sheet(k: string): unknown {
  const r = rowsOf(k).filter((x) => x.k === k);
  const l = r[r.length - 1];
  return !l ? undefined : l.del ? null : l.v;
}
const pdf = (name: string) => Object.assign(new Blob(['%PDF-1.4 ' + name], { type: 'application/pdf' }), { name });
const doc = (kind: DealDoc['kind'], amount: number | null, o: { stage?: string; docNo?: string; docDate?: string } = {}) => ({
  kind, amount, target: (kind === 'quotation' ? 'forecast' : amount == null || kind === 'other' ? 'none' : 'actual') as DealDoc['target'], basis: 'total' as const, detected: amount, docNo: o.docNo || '', docDate: o.docDate || '', ...o,
});
let n = 0;
const mkDeal = (e: GccEngine) => e.addDeal({ client: 'บริษัท ห้าขั้นตอน ' + ++n + ' จำกัด', section: 'Partner', year: '2569' });
const steps = (e: GccEngine, d: Pick<Deal, 'id'>) => dealSteps(e.sales, e.sales.deals[d.id], TODAY).steps;
const step = (e: GccEngine, d: Pick<Deal, 'id'>, id: string) => steps(e, d).find((v) => v.id === id)!;

describe('the five steps between browsers (real Code.gs)', () => {
  it('this build writes CONTACT / FOLLOW; an older build\'s CALL2 / FOLLOW1 show in them on both; the list is never written', async () => {
    const [A, B] = await team();
    const listRows = rowsOf('scfg/stages').length;
    const d = mkDeal(A);
    await settle(A, B);
    // this build: the step's own record, and a contact filed at the step the deal is at
    A.setStep(d.id, 'CONTACT', { d: '2026-09-20', n: 'โทรแนะนำบริการ CFO' });
    const a1 = A.addAct(d.id, { type: 'email', note: 'ส่งโบรชัวร์', d: '2026-09-21' })!;
    expect(a1.stage).toBe('CONTACT');
    expect((await queued(A)).map((o) => o.k)).toEqual(expect.arrayContaining([`dstep/${d.id}/CONTACT`, `dact/${d.id}/${a1.id}`]));
    // the browser on an older build: its eight stages, at the same time
    B.setStep(d.id, 'CALL2', { d: '2026-09-25', n: 'โทรครั้งที่ 2 ขอใบเสนอราคา' });
    B.setStep(d.id, 'FOLLOW1', { d: '2026-10-02', n: 'ตามผลทางอีเมล' });
    B.addAct(d.id, { type: 'call', note: 'โทรตามอีกครั้ง', d: '2026-10-04', stage: 'FOLLOW2' });
    await settle(A, B);
    for (const e of [A, B]) {
      const c = step(e, d, 'CONTACT'), f = step(e, d, 'FOLLOW');
      expect(c).toMatchObject({ state: 'done', date: '2026-09-25', own: { d: '2026-09-20', n: 'โทรแนะนำบริการ CFO' }, top: { stage: 'CALL2' } });
      expect(c.entries.map((x) => [x.kind, x.stage])).toEqual([['old', 'CALL2'], ['act', 'CONTACT']]);
      expect(f).toMatchObject({ state: 'done', date: '2026-10-04', top: { stage: 'FOLLOW1', n: 'ตามผลทางอีเมล' } });
      expect(f.entries.map((x) => [x.kind, x.stage])).toEqual([['act', 'FOLLOW2'], ['old', 'FOLLOW1']]);
      // (contacts: CONTACT's own record, CALL2, the two contact records and FOLLOW1)
      expect(dealSteps(e.sales, e.sales.deals[d.id], TODAY)).toMatchObject({ done: 2, total: 5, contacts: 5, next: { id: 'CLOSED DEAL' } });
      expect(lastContactInfo(e.sales, e.sales.deals[d.id], TODAY)).toMatchObject({ date: '2026-10-04', from: 'act' });
      expect(overdueDays(e.sales, e.sales.deals[d.id], TODAY)).toBeNull();
      expect(e.sales.cfg.stages).toEqual(DEFAULT_STAGES);
    }
    // every record is on the sheet under its own key
    expect([sheet(`dstep/${d.id}/CONTACT`), sheet(`dstep/${d.id}/CALL2`), sheet(`dstep/${d.id}/FOLLOW1`)]).toEqual([
      { d: '2026-09-20', n: 'โทรแนะนำบริการ CFO' }, { d: '2026-09-25', n: 'โทรครั้งที่ 2 ขอใบเสนอราคา' }, { d: '2026-10-02', n: 'ตามผลทางอีเมล' },
    ]);
    // an older record edited in place (the panel's "แก้ไข" on "บันทึกเดิม CALL2") stays where it is
    A.setStep(d.id, 'CALL2', { d: '2026-09-25', n: 'โทรครั้งที่ 2 ขอใบเสนอราคา CFO + CFP' });
    await settle(A, B);
    expect(step(B, d, 'CONTACT').top).toMatchObject({ stage: 'CALL2', n: 'โทรครั้งที่ 2 ขอใบเสนอราคา CFO + CFP' });
    expect(Object.values(A.sales.log).filter((l) => l.deal === d.id).map((l) => l.action)).toContain('อัปเดต CONTACT');
    // the team's stored list: never written by this build
    expect(rowsOf('scfg/stages').length).toBe(listRows);
    A.dispose();
    B.dispose();
  });

  it('documents and payments at the new steps: CONTACT, PAY of a plan of one, PAY3 of a plan of three', async () => {
    const [A, B] = await team();
    const d = mkDeal(A);
    const at = await A.attachDoc(d.id, pdf('nda.pdf'), doc('other', null, { stage: 'CONTACT' }));
    expect(at.stage).toBe('CONTACT');
    expect(A.sales.steps[`${d.id}/CONTACT`]).toEqual({ d: TODAY, n: 'เอกสารอื่น' });
    expect(step(A, d, 'CONTACT').docs.map((x) => x.id)).toEqual([at.id]);
    // won, a plan of one: a single PAY step, keyed PAY1
    A.updateDeal(d.id, { forecast: 90000 });
    A.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    expect(A.quickPlan(d.id, 1)).toMatchObject({ stages: ['PAY1'], amounts: [90000] });
    expect(steps(A, d).filter((v) => v.kind === 'pay').map((v) => [v.id, v.code])).toEqual([['PAY1', 'PAY']]);
    // and of three: PAY1 … PAY3, each a step; a hand receipt at PAY3 fills in its step as at PAY1
    const e = mkDeal(A);
    A.updateDeal(e.id, { forecast: 90000 });
    A.setStep(e.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    expect(A.quickPlan(e.id, 3)).toMatchObject({ stages: ['PAY1', 'PAY2', 'PAY3'] });
    for (const p of ['PAY1', 'PAY2', 'PAY3']) A.markPaid(e.id, p, { date: '2026-10-05', amount: 30000, how: 'transfer' });
    expect(A.sales.steps[`${e.id}/PAY3`]).toEqual({ d: '2026-10-05', n: 'รับชำระแล้ว 30,000 บาท · โอน' });
    expect((await queued(A)).some((o) => o.k === `dstep/${e.id}/PAY3`)).toBe(true);
    expect(Object.values(A.sales.log).filter((l) => l.deal === e.id).map((l) => l.action)).toContain('รับชำระ PAY3');
    await settle(A, B);
    expect(steps(B, e).filter((v) => v.kind === 'pay').map((v) => [v.code, v.state])).toEqual([['PAY1', 'done'], ['PAY2', 'done'], ['PAY3', 'done']]);
    expect(closeReady(B.sales, B.sales.deals[e.id], TODAY)).toBe(true);
    // a plan cut to one: what PAY2 and PAY3 hold stays, outside the plan
    A.setPlan(e.id, [{ stage: 'PAY1', amt: 90000, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '' }]);
    expect(planOf(A.sales, A.sales.deals[e.id], TODAY)!.lines.map((l) => l.stage)).toEqual(['PAY1', 'PAY2', 'PAY3']); // received: kept as lines
    A.dispose();
    B.dispose();
  });

  it('an import of the old tracker (CALL1 … PAY2, and PAY3) adds nothing to the list; a stage of its own is added; every column shows', async () => {
    const [A, B] = await team();
    const file = {
      sources: ['TGO'], services: ['CFO'], progress: ['CALL1', 'CALL2', 'QUOTATION', 'FOLLOW1', 'FOLLOW2', 'CLOSED DEAL', 'PAY1', 'PAY2', 'PAY3', 'SITE VISIT'],
      rows: [
        { type: 'section', name: 'TGO' },
        {
          type: 'client', client: 'บริษัท นำเข้าแปดขั้น จำกัด', forecast: '300,000', actual: '300,000',
          progress: JSON.stringify({
            CALL1: { d: '2026-05-01', n: 'โทร 1' }, CALL2: { d: '2026-05-05', n: 'โทร 2' }, QUOTATION: { d: '2026-05-10', n: 'QT' }, FOLLOW1: { d: '2026-05-15', n: 'ตาม 1' },
            FOLLOW2: { d: '2026-05-20', n: 'ตาม 2' }, 'CLOSED DEAL': { d: '2026-05-25', n: 'YES' }, PAY1: { d: '2026-06-01', n: 'รับ 1' }, PAY2: { d: '2026-07-01', n: 'รับ 2' },
            PAY3: { d: '2026-08-01', n: 'รับ 3' }, 'SITE VISIT': { d: '2026-05-12', n: 'ดูโรงงาน' },
          }),
        },
      ],
    };
    const r = await A.importTracker(Object.assign(new Blob([JSON.stringify(file)]), { name: 'tracker.json' }) as File, '2569');
    expect(r.deals).toBe(1);
    expect(A.sales.cfg.stages).toEqual([...DEFAULT_STAGES, 'SITE VISIT']);
    await settle(A, B);
    const d = Object.values(B.sales.deals).find((x) => x.client === 'บริษัท นำเข้าแปดขั้น จำกัด')!;
    const t = dealSteps(B.sales, d, TODAY);
    expect(t.steps.map((v) => [v.code, v.state])).toEqual([
      ['CONTACT', 'done'], ['QUOTATION', 'done'], ['FOLLOW', 'done'], ['CLOSE', 'yes'], ['PAY1', 'done'], ['PAY2', 'done'], ['PAY3', 'done'], ['SITE VISIT', 'done'],
    ]);
    expect([t.done, t.total, t.contacts]).toEqual([8, 8, 4]); // CALL1, CALL2, FOLLOW1, FOLLOW2: entries of their steps
    expect(quickMatch(B.sales, d, 'ready', TODAY)).toBe(true);
    // undoing it takes its own stage back out (nothing else was added)
    A.undoImport(r.batch);
    expect(A.sales.cfg.stages).toEqual(DEFAULT_STAGES);
    A.dispose();
    B.dispose();
  });

  it('a backup from a browser whose list has CALL3 and PAY3 adds only the stage the steps do not read', async () => {
    const D = mk('ดี');
    const backup = { kind: 'gcc-crm-backup', v: 1, crm: {}, contacts: {}, dedup: {}, custom: {}, sales: { cfg: { sections: [], sources: [], services: [], stages: [...DEFAULT_STAGES, 'PAY3', 'CALL3'] }, deals: {}, steps: {}, docs: {}, log: {} } };
    await D.importCrm(Object.assign(new Blob([JSON.stringify(backup)]), { name: 'b.json' }) as File);
    expect(D.sales.cfg.stages).toEqual([...DEFAULT_STAGES, 'CALL3']);
    D.dispose();
  });

  it('CSV: a date and a note per step (CLOSE: its result), the older stages\' notes after the step\'s own with their dates, the contacts, what no step reads', () => {
    const E = mk('อี');
    const d = mkDeal(E);
    E.setStep(d.id, 'CALL1', { d: '2026-09-01', n: 'โทร 1' });
    E.setStep(d.id, 'CONTACT', { d: '2026-09-10', n: 'คุยรายละเอียด' });
    E.setStep(d.id, 'FOLLOW2', { d: '2026-09-20', n: 'ตาม' });
    E.setStep(d.id, 'CLOSED DEAL', { d: '2026-09-25', n: 'YES' });
    E.setStep(d.id, 'PAY1', { d: '2026-10-01', n: 'รับงวด 1' });
    E.setStep(d.id, 'PAY2', { d: '2026-10-03', n: 'รับงวด 2' });
    E.setStep(d.id, 'OLDSTAGE', { d: '2026-08-01', n: 'ขั้นที่ถูกลบออกจากรายการ' });
    E.addAct(d.id, { type: 'call', note: 'โทรเพิ่ม', d: '2026-09-12', stage: 'CONTACT' });
    const rows = parseCsv(E.salesCsv([E.sales.deals[d.id]]));
    const head = Object.keys(rows[0]);
    expect(head.filter((h) => / (วันที่|โน้ต|ผล)$/.test(h) && !/^(วันที่ติดต่อ)$/.test(h))).toEqual([
      'CONTACT วันที่', 'CONTACT โน้ต', 'QUOTATION วันที่', 'QUOTATION โน้ต', 'FOLLOW วันที่', 'FOLLOW โน้ต', 'CLOSE วันที่', 'CLOSE ผล', 'PAY วันที่', 'PAY โน้ต',
    ]);
    expect(head).not.toContain('CALL1 วันที่');
    const r = rows[0];
    // the date is the one of the note shown first (the contact on the 12th is in ติดต่อล่าสุด and the count); an
    // older record keeps its own date
    expect([r['CONTACT วันที่'], r['CONTACT โน้ต'], r['FOLLOW วันที่'], r['FOLLOW โน้ต'], r['CLOSE วันที่'], r['CLOSE ผล']]).toEqual([
      '2026-09-10', 'คุยรายละเอียด; CALL1 2026-09-01: โทร 1', '2026-09-20', 'FOLLOW2: ตาม', '2026-09-25', 'YES',
    ]);
    expect(r['ติดต่อล่าสุด']).toBe('2026-10-03');
    // (no plan: the payment and the rest of it, as the steps name them)
    expect([r['PAY วันที่'], r['PAY โน้ต'], r['การติดต่อ (ครั้ง)'], r['ขั้นตอนอื่น']]).toEqual([
      'PAY 2026-10-01; PAY ส่วนที่เหลือ 2026-10-03', 'PAY: รับงวด 1; PAY ส่วนที่เหลือ: รับงวด 2', '4', 'OLDSTAGE: 2026-08-01 ขั้นที่ถูกลบออกจากรายการ',
    ]);
    E.dispose();
  });

  it('CSV of the eight-stage tracker\'s records: no date lost (review: big3 lost 5 Oct and 11 Oct, big9 showed a contact\'s date by its note)', () => {
    const E = mk('อี');
    const big3 = mkDeal(E);
    // (the review's team drive on 12 Oct, a week earlier here: today is 6 Oct)
    E.setStep(big3.id, 'CALL1', { d: '2026-09-29', n: 'โทรแนะนำ (เก่า)' });
    E.setStep(big3.id, 'CALL2', { d: '2026-10-02', n: 'โทรครั้งที่สอง (เก่า)' });
    E.setStep(big3.id, 'FOLLOW1', { d: '2026-10-05', n: 'ตามผล (เก่า)' });
    E.setStep(big3.id, 'FOLLOW2', { d: '2026-10-08', n: '' }); // booked ahead
    const big9 = mkDeal(E);
    E.setStep(big9.id, 'CONTACT', { d: '2026-09-30', n: 'ติดต่อครั้งแรก (ใหม่)' });
    E.addAct(big9.id, { type: 'meet', note: 'นัดพบ', d: '2026-10-02', stage: 'CONTACT' });
    const [a, b] = parseCsv(E.salesCsv([E.sales.deals[big3.id], E.sales.deals[big9.id]]));
    expect([a['CONTACT วันที่'], a['CONTACT โน้ต'], a['FOLLOW วันที่'], a['FOLLOW โน้ต']]).toEqual([
      '2026-10-02', 'CALL2: โทรครั้งที่สอง (เก่า); CALL1 2026-09-29: โทรแนะนำ (เก่า)', '2026-10-08', 'FOLLOW2; FOLLOW1 2026-10-05: ตามผล (เก่า)',
    ]);
    // every stored date is in the file
    for (const x of ['2026-09-29', '2026-10-02', '2026-10-05', '2026-10-08']) expect(Object.values(a).join('|')).toContain(x);
    expect([b['CONTACT วันที่'], b['CONTACT โน้ต'], b['ติดต่อล่าสุด'], b['การติดต่อ (ครั้ง)']]).toEqual(['2026-09-30', 'ติดต่อครั้งแรก (ใหม่)', '2026-10-02', '2']);
    E.dispose();
  });

  it('the history names an installment as the screens do: a plan of one is PAY (review: "รับชำระ PAY1" by "บันทึกรับเงิน PAY")', () => {
    const E = mk('อี');
    const d = mkDeal(E);
    E.updateDeal(d.id, { forecast: 65000 });
    E.setStep(d.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    E.quickPlan(d.id, 1);
    const log = () => Object.values(E.sales.log).filter((l) => l.deal === d.id).sort((x, y) => x.at.localeCompare(y.at)).map((l) => [l.action, l.detail]);
    E.markPaid(d.id, 'PAY1', { date: '2026-10-05', amount: 60000, how: 'transfer' });
    E.setPayFull(d.id, 'PAY1', true);
    E.setPayFull(d.id, 'PAY1', false);
    E.unmarkPaid(d.id, 'PAY1');
    const acts = log().map((x) => x[0]);
    expect(acts).toEqual(expect.arrayContaining(['รับชำระ PAY', 'ถือว่ารับครบ PAY', 'ยกเลิกการรับ PAY']));
    expect(acts.join('|')).not.toMatch(/PAY1/);
    expect(log().find((x) => x[0] === 'แก้แผนชำระ' && /ยังค้างรับ/.test(x[1]))?.[1]).toBe('PAY ยังค้างรับ');
    // a plan of two keeps the numbers
    const e = mkDeal(E);
    E.updateDeal(e.id, { forecast: 2000 });
    E.setStep(e.id, 'CLOSED DEAL', { d: '2026-10-01', n: 'YES' });
    E.quickPlan(e.id, 2);
    E.markPaid(e.id, 'PAY2', { date: '2026-10-05', amount: 1000, how: 'transfer' });
    expect(Object.values(E.sales.log).filter((l) => l.deal === e.id).map((l) => l.action)).toContain('รับชำระ PAY2');
    E.dispose();
  });
});
