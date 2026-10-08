import { describe, expect, it } from 'vitest';
import { emptySales, filterDeals, newDeal, planOf, salesStats, type Deal, type PayLine, type SalesState } from './sales';
import {
  actualSource, beYearInput, closeConfirm, closePrompt, closingView, diffText, facetOptions, lineMeta, lineStatusView, nextStepView, relText, shortName, statusView, winRateBySource, yearOptions,
} from './salesUi';

const deal = (p: Partial<Deal> = {}): Deal => newDeal({ id: p.id || 'd' + Math.random().toString(36).slice(2), client: 'บริษัท ก', year: '2569', ...p }, 'me', '2026-10-01T00:00:00.000Z');
const state = (deals: Deal[], steps: SalesState['steps'] = {}): SalesState => ({ ...emptySales(), deals: Object.fromEntries(deals.map((d) => [d.id, d])), steps });

describe('import year prompt', () => {
  it('takes a Buddhist-era year only', () => {
    expect(beYearInput('2569')).toEqual({ year: '2569' });
    expect(beYearInput(' ๒๕๖๘ ')).toEqual({ year: '2568' });
    expect(beYearInput('พ.ศ. 2567')).toEqual({ year: '2567' });
    for (const bad of ['', '69', '1999', '2600', 'ปีนี้', '2569/70']) expect(beYearInput(bad)).toBeNull();
  });
  it('turns a Christian-era year into its BE year, flagged for a confirm', () => {
    expect(beYearInput('2025')).toEqual({ year: '2568', ce: '2025' });
    expect(beYearInput('ค.ศ. 2026')).toEqual({ year: '2569', ce: '2026' });
  });
});

describe('year picker', () => {
  it('lists this year ±1, the year shown and every year with deals — also one added after the first call', () => {
    const S = state([deal({ id: 'a', year: '2569' })]);
    expect(yearOptions(Object.values(S.deals), '2569', '2569')).toEqual(['2568', '2569', '2570']);
    S.deals.b = deal({ id: 'b', year: '2566' }); // the engine adds deals to the same object (import, team sync)
    expect(yearOptions(Object.values(S.deals), '2569', '2569')).toEqual(['2566', '2568', '2569', '2570']);
    expect(yearOptions([], '2560', '2569')).toEqual(['2560', '2568', '2569', '2570']);
  });
});

describe('table filters', () => {
  it('offers every owner of the year, and keeps the chosen one when other filters leave none of its rows', () => {
    const a = deal({ id: 'a', resp: 'สมชาย' });
    const b = deal({ id: 'b', resp: 'สมหญิง' });
    const c = deal({ id: 'c', resp: '' });
    const S = state([a, b, c], { 'a/CLOSED DEAL': { d: '2026-09-01', n: 'YES' }, 'b/CLOSED DEAL': { d: '2026-09-01', n: 'NO' } });
    const shown = filterDeals(S, { year: '2569', resp: 'สมหญิง', result: 'YES' });
    expect(shown).toEqual([]);
    // built from the rows shown, the list would lose สมหญิง and the select would read "ทั้งหมด"
    expect(facetOptions(filterDeals(S, { year: '2569' }), 'resp', 'สมหญิง')).toEqual(['(ไม่ระบุ)', 'สมชาย', 'สมหญิง']);
    expect(facetOptions(shown, 'resp', 'สมหญิง')).toContain('สมหญิง');
    expect(facetOptions([], 'referral', '')).toEqual([]);
  });
});

describe('dashboard', () => {
  it('win rate per channel keeps a channel that lost every decided deal (0%)', () => {
    const a = deal({ id: 'a', source: ['TGO'] });
    const b = deal({ id: 'b', source: ['TGO'] });
    const c = deal({ id: 'c', source: ['SET/mai'] });
    const d = deal({ id: 'd', source: ['Partner'] }); // no result yet: no win rate
    const S = state([a, b, c, d], { 'a/CLOSED DEAL': { d: '', n: 'YES' }, 'b/CLOSED DEAL': { d: '', n: 'NO' }, 'c/CLOSED DEAL': { d: '', n: 'NO' } });
    const st = salesStats(S, [a, b, c, d], '2026-10-07');
    expect(st.winRate).toBe(33);
    expect(winRateBySource(st.bySource)).toEqual([['SET/mai', 0], ['TGO', 50]]); // in SOURCE list order
  });
});

// ------------------------------------------------------------------ the tracker's words

const TODAY = '2026-10-08';
const pay = (p: Partial<PayLine>): PayLine => ({ amt: null, pct: null, due: '', rel: null, how: 'transfer', howT: '', note: '', rcv: '', got: null, full: false, at: '', by: '', ...p });
const YES = { 'x/CALL1': { d: '2026-08-01', n: 'โทร' }, 'x/CLOSED DEAL': { d: '2026-08-20', n: 'YES' } };
/** Deal "x" with these steps and plan lines (and documents: stage → amount). */
function one(steps: SalesState['steps'], pays: Record<string, Partial<PayLine>> = {}, docs: Record<string, number> = {}, stages?: string[]) {
  const d = deal({ id: 'x', at: '2026-10-06T03:00:00.000Z' });
  const S = state([d], steps);
  if (stages) S.cfg.stages = stages;
  Object.entries(pays).forEach(([k, v]) => (S.pays['x/' + k] = pay(v)));
  Object.entries(docs).forEach(([stage, amount], i) => {
    S.docs['x/r' + i] = { id: 'r' + i, deal: 'x', kind: 'receipt', name: 'r.pdf', mime: 'application/pdf', size: 1, fileId: '', docNo: 'RC-' + i, docDate: '', amount, target: 'actual', detected: null, basis: 'total', stage, at: '2026-10-01T00:00:00.000Z', by: '' };
  });
  return { S, d };
}

describe('names and sources', () => {
  it('the name people say; the legal name never turns empty', () => {
    expect(shortName('บริษัท ไทยรุ่งเรืองอุตสาหกรรม จำกัด (มหาชน)')).toBe('ไทยรุ่งเรืองอุตสาหกรรม');
    expect(shortName('บริษัท กรีนวัลเลย์ ฟู้ดส์ จำกัด')).toBe('กรีนวัลเลย์ ฟู้ดส์');
    expect(shortName('ห้างหุ้นส่วนจำกัด ก')).toBe('ก');
    expect(shortName('บมจ. X')).toBe('X');
    expect(shortName('Siam Steel Co., Ltd.')).toBe('Siam Steel Co., Ltd.');
    expect(shortName('บริษัท จำกัด')).toBe('บริษัท จำกัด');
  });
  it('the Actual header says where the figure comes from', () => {
    const cfg = emptySales().cfg;
    expect(actualSource(cfg)).toBe('จาก PAY1 + PAY2');
    expect(actualSource({ ...cfg, stages: [...cfg.stages, 'PAY3'] })).toBe('จาก PAY ทุกงวด');
    expect(actualSource({ ...cfg, stages: ['CALL1', 'CLOSED DEAL'] })).toBe('จาก ใบเสร็จ');
  });
});

describe('deal status words (dot + word + one grey line)', () => {
  it('every row of the status table', () => {
    const w = (steps: SalesState['steps'], pays: Record<string, Partial<PayLine>> = {}, docs: Record<string, number> = {}, stages?: string[]) => {
      const { S, d } = one(steps, pays, docs, stages);
      const v = statusView(S, d, TODAY);
      return [v.kind, v.word, v.sub, v.ready];
    };
    expect(w({})).toEqual(['neutral', 'ยังไม่เริ่ม', 'เพิ่มเมื่อ 6 ต.ค.', false]);
    expect(w({ 'x/CALL1': { d: '2026-10-01', n: '' }, 'x/CALL2': { d: '2026-10-05', n: 'คุยแล้ว' } })).toEqual(['info', 'กำลังติดตาม', 'ล่าสุด CALL2', false]);
    expect(w({ 'x/CLOSED DEAL': { d: '2026-10-01', n: 'รอผู้บริหารอนุมัติ' } })).toEqual(['warn', 'รอผล', 'รอผู้บริหารอนุมัติ', false]);
    expect(w(YES, { PAY1: { amt: 1 }, PAY2: { amt: 1 } }, { PAY1: 1 })).toEqual(['ok', 'ได้งาน', 'รับแล้ว 1/2 งวด', false]);
    expect(w({ ...YES, 'x/PAY1': { d: '2026-09-01', n: 'โอน' } })).toEqual(['ok', 'ได้งาน', 'รอชำระงวด 2', false]);
    expect(w(YES)).toEqual(['ok', 'ได้งาน', 'รอชำระ 2 งวด', false]);
    expect(w(YES, {}, { PAY1: 1, PAY2: 1 })).toEqual(['ok', 'ได้งาน · รับครบ', 'พร้อมปิดงาน', true]);
    expect(w(YES, {}, {}, ['CALL1', 'CLOSED DEAL'])).toEqual(['ok', 'ได้งาน', 'พร้อมปิดงาน', true]);
    expect(w({ 'x/CLOSED DEAL': { d: '2026-10-01', n: 'NO' } })).toEqual(['bad', 'ไม่ได้งาน', 'พร้อมปิดงาน', true]);
    const { S, d } = one({ 'x/CLOSED DEAL': { d: '2026-10-01', n: 'NO' } });
    d.jobStatus = 'closed';
    d.closedDate = '2026-10-02';
    expect(statusView(S, d, TODAY)).toMatchObject({ tone: 'closed', word: 'ไม่ได้งาน', sub: 'ปิดงานแล้ว 2 ต.ค.', ready: false });
  });
});

describe('the next-step pill', () => {
  it('no / done / planned / overdue / next', () => {
    const n = (steps: SalesState['steps'], pays: Record<string, Partial<PayLine>> = {}, docs: Record<string, number> = {}) => {
      const { S, d } = one(steps, pays, docs);
      const v = nextStepView(S, d, TODAY);
      return [v.kind, v.stage, v.hint];
    };
    expect(n({ 'x/CLOSED DEAL': { d: '2026-10-01', n: 'NO' } })).toEqual(['no', '', 'ไม่ต้องติดตามต่อ']);
    expect(n(YES, {}, { PAY1: 1, PAY2: 1 })).toEqual(['done', '', 'ครบทุกขั้น']);
    expect(n({ 'x/CALL1': { d: '2026-10-07', n: 'x' }, 'x/CALL2': { d: '2026-10-12', n: '' } })).toEqual(['planned', 'CALL2', 'นัด 12 ต.ค.']);
    expect(n({ 'x/CALL1': { d: '2026-09-01', n: 'x' } })).toEqual(['overdue', 'CALL2', 'โทรครั้งที่ 2']);
    expect(n({ 'x/CALL1': { d: '2026-10-07', n: 'x' } })).toEqual(['next', 'CALL2', 'โทรครั้งที่ 2']);
    const { S, d } = one({ 'x/CALL1': { d: '2026-10-07', n: 'x' } });
    expect(nextStepView(S, d, TODAY).label).toBe('ถัดไป CALL2 โทรครั้งที่ 2 — บันทึกวันที่และโน้ต');
  });
  it('a won deal with a plan: the next installment, coloured when due soon, part paid or late', () => {
    const p = (pays: Record<string, Partial<PayLine>>, docs: Record<string, number> = {}) => {
      const { S, d } = one(YES, pays, docs);
      const v = nextStepView(S, d, TODAY);
      return [v.kind, v.stage, v.hint, v.tone];
    };
    expect(p({ PAY1: { amt: 1000, due: '2026-10-20' } })).toEqual(['pay', 'PAY1', 'ครบกำหนด 20 ต.ค.', '']);
    expect(p({ PAY1: { amt: 1000, due: '2026-10-11' } })).toEqual(['pay', 'PAY1', 'ครบกำหนด 11 ต.ค.', 'due']);
    expect(p({ PAY1: { amt: 1000, due: TODAY } })).toEqual(['pay', 'PAY1', 'ครบกำหนดวันนี้', 'due']);
    expect(p({ PAY1: { amt: 1000, due: '2026-10-04' } })).toEqual(['pay', 'PAY1', 'เลยกำหนด 4 วัน', 'late']);
    expect(p({ PAY1: { amt: 1000 } }, { PAY1: 750 })).toEqual(['pay', 'PAY1', 'ค้าง 250', 'due']);
    expect(p({ PAY1: { amt: 1000 } })).toEqual(['pay', 'PAY1', 'รอรับชำระ', '']);
    // the extra installment after the list's last PAY stage came in
    expect(p({ PAY1: { amt: 1 }, PAY2: { amt: 1 }, PAY3: { amt: 1, due: '2026-12-01' } }, { PAY1: 1, PAY2: 1 })).toEqual(['pay', 'PAY3', 'ครบกำหนด 1 ธ.ค.', '']);
    const { S, d } = one(YES, { PAY1: { amt: 53500, due: '2026-10-20' } });
    expect(nextStepView(S, d, TODAY).label).toBe('ถัดไป PAY1 53,500 บาท ครบกำหนด 20 ต.ค. — บันทึกรับเงิน');
  });
});

describe('installment words', () => {
  it('status word, chip and the line under it', () => {
    const { S, d } = one(
      YES,
      {
        PAY1: { amt: 53500 }, PAY2: { amt: 80250 }, PAY3: { amt: 1, due: '2026-10-04' }, PAY4: { amt: 1, due: '2026-10-11' }, PAY5: { amt: 1, due: '2026-10-20' }, PAY6: { amt: 1 },
        PAY7: { amt: 20000, rcv: '2026-10-05', got: 19400, full: true },
      },
      { PAY1: 53500, PAY2: 78000 },
    );
    S.steps['x/PAY1'] = { d: '2026-09-19', n: 'ใบเสร็จ RC-0' };
    const v = (stage: string) => {
      const l = planOf(S, d, TODAY)!.lines.find((x) => x.stage === stage)!;
      const r = lineStatusView(l, TODAY);
      return [r.kind, r.word, r.chip, r.sub];
    };
    expect(v('PAY1')).toEqual(['ok', 'รับแล้ว', false, 'รับ 19 ก.ย. · RC-0']);
    expect(v('PAY2')).toEqual(['warn', 'รับบางส่วน', false, '78,000 จาก 80,250']);
    expect(v('PAY3')).toEqual(['bad', 'เลยกำหนด 4 วัน', true, 'ครบกำหนด 4 ต.ค.']);
    expect(v('PAY4')).toEqual(['warn', 'ถึงกำหนด 3 วัน', true, 'ครบกำหนด 11 ต.ค.']);
    expect(v('PAY5')).toEqual(['neutral', 'รอชำระ', false, 'อีก 12 วัน']);
    expect(v('PAY6')).toEqual(['neutral', 'รอชำระ', false, 'ยังไม่กำหนดวัน']);
    expect(v('PAY7')).toEqual(['ok', 'รับแล้ว', false, 'รับ 5 ต.ค. · บันทึกเอง · 19,400 (ถือว่าครบ)']);
    const draft = one({}, { PAY1: { amt: 1, rel: 45 } });
    expect(lineStatusView(planOf(draft.S, draft.d, TODAY)!.lines[0], TODAY)).toMatchObject({ kind: 'neutral', word: 'แผน', sub: '45 วันหลังได้งาน' });
    const no = one({ 'x/CLOSED DEAL': { d: '2026-10-01', n: 'NO' } }, { PAY1: { amt: 1 } });
    expect(lineStatusView(planOf(no.S, no.d, TODAY)!.lines[0], TODAY)).toMatchObject({ kind: 'muted', word: 'ยกเลิก' });
  });
  it('terms, relative due dates and the plan against the Forecast', () => {
    expect([relText({ rel: null }), relText({ rel: 0 }), relText({ rel: 30 }), relText({ rel: -7 })]).toEqual(['', 'เมื่อได้งาน', '30 วันหลังได้งาน', '7 วันก่อนได้งาน']);
    expect(lineMeta(pay({ pct: 50, note: 'เมื่อส่งรายงาน CFO ฉบับสมบูรณ์' }))).toBe('50% · โอน · เมื่อส่งรายงาน CFO ฉบับสมบูรณ์');
    expect(lineMeta(pay({ how: 'other', howT: 'หักกลบหนี้' }))).toBe('อื่นๆ หักกลบหนี้');
    expect(lineMeta(pay({ how: '' }))).toBe('');
    expect([diffText({ base: null, diff: null }), diffText({ base: 1, diff: 0 }), diffText({ base: 1, diff: -7000 }), diffText({ base: 1, diff: 7000 })]).toEqual([
      'ยังไม่มี Forecast', 'เท่ากับ Forecast', 'น้อยกว่า Forecast 7,000', 'มากกว่า Forecast 7,000',
    ]);
  });
});

describe('closing', () => {
  it('the closing card, the table hint and the progress bar', () => {
    const c = (steps: SalesState['steps'], pays: Record<string, Partial<PayLine>> = {}, docs: Record<string, number> = {}, stages?: string[]) => {
      const { S, d } = one(steps, pays, docs, stages);
      return closingView(S, d, TODAY);
    };
    expect(c({})).toMatchObject({ ready: false, state: 'none', hint: 'รอผลการขาย', progress: null });
    expect(c({ 'x/CLOSED DEAL': { d: '2026-10-01', n: 'NO' } })).toMatchObject({ ready: true, state: 'no', hint: '' });
    const plan = c(YES, { PAY1: { amt: 53500 }, PAY2: { amt: 53500 } }, { PAY1: 53500 });
    expect(plan).toMatchObject({ ready: false, state: 'plan', hint: 'ปิดได้เมื่อรับ PAY2', waitFor: ['PAY2'], progress: { pct: 50, got: 53500, base: 107000, left: 53500 } });
    expect(plan.text).toBe('ได้งานแล้ว · รับ 1 จาก 2 งวดตามแผน เมื่อรับครบทุกงวด ระบบจะชวนให้ปิดงาน');
    expect(c({ ...YES, 'x/PAY1': { d: '2026-09-01', n: 'โอน' } }).text).toBe('ได้งานแล้ว · รับชำระ 1 จาก 2 งวด เมื่อแนบเอกสาร PAY2 ระบบจะชวนให้ปิดงาน');
    expect(c(YES, {}, {}, ['CALL1', 'CLOSED DEAL'])).toMatchObject({ ready: true, state: 'nopay' });
    const done = c(YES, { PAY1: { amt: 1000 } }, { PAY1: 1000 });
    expect(done).toMatchObject({ ready: true, state: 'done', hint: '' });
    expect(done.text).toBe('ได้งานและรับชำระครบทุกงวดตามแผนแล้ว ปิดงานเพื่อย้ายไปแท็บ “ปิดงาน” ยอด Forecast / Actual ยังนับในสรุปปีเหมือนเดิม');
  });
  it('the prompt after this user\'s action, and the confirm for a deal not ready', () => {
    const won = one(YES, { PAY1: { amt: 1 } }, { PAY1: 1 });
    expect(closePrompt(won.S, won.d, 'กรีนวัลเลย์', 'payment')).toBe('รับชำระครบทุกงวดแล้ว ปิดงาน กรีนวัลเลย์ เลยไหม?');
    expect(closePrompt(won.S, won.d, 'กรีนวัลเลย์', 'result')).toBe('ได้งานและรับชำระครบแล้ว ปิดงาน กรีนวัลเลย์ เลยไหม?');
    const lost = one({ 'x/CLOSED DEAL': { d: '2026-10-01', n: 'NO' } });
    expect(closePrompt(lost.S, lost.d, 'ก', 'result')).toBe('ผลการขายเป็น NO ปิดงาน ก เลยไหม?');
    expect(closeConfirm(won.S, won.d, TODAY, 'ก')).toBe('');
    const left = one(YES, { PAY1: { amt: 1 }, PAY2: { amt: 1 } }, { PAY1: 1 });
    expect(closeConfirm(left.S, left.d, TODAY, 'ก')).toBe('ปิดงาน “ก” ตอนนี้? ยังรับชำระไม่ครบ (PAY2) งานจะย้ายไปแท็บปิดงาน เปิดกลับได้');
    expect(closeConfirm(one({}).S, one({}).d, TODAY, 'ก')).toBe('ปิดงาน “ก” ตอนนี้? ยังไม่มีผลการขาย งานจะย้ายไปแท็บปิดงาน เปิดกลับได้');
  });
});
