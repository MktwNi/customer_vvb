/**
 * The TGO review queue as markup (tabs/Update.tsx TgoQueue), from the real engine: every row's buttons name their
 * certificate (no two alike), the queue announces what an action did (role=status), a row's dates do not break
 * between the day and the month, and rejecting a whole company asks first (the confirmation is not shown until asked).
 * A viewer reads the queue and gets no buttons.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppProvider } from '../state';
import { TgoQueue } from './Update';
import { GccEngine } from '../lib/engine';
import { memoryStore } from '../lib/storage';
import type { TgoRec } from '../lib/tgoSync';
import type { Dataset, RoundRaw } from '../lib/types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

function engine() {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = '2026-10-26';
  e.store = memoryStore();
  e.rebuild();
  e.loading = false;
  const rec = (rid: string, cert: string, org: string): TgoRec => ({
    st: 'p', gid: null, by: 'หมิว', at: '2026-10-26T03:00:00Z', note: '', cert, act: 'ผลิตอาหาร', org, branch: '', prov: 'กรุงเทพฯ', apBE: '', exBE: '',
    ap: '2026-10-20', ex: '2027-10-19', fy: 'FY27', id: rid,
  });
  e.tgo = {
    '77001': rec('77001', 'TGO CFO FY27-771', 'บริษัท ทดสอบ หนึ่ง จำกัด'),
    '77002': rec('77002', 'TGO CFO FY27-772', 'บริษัท ทดสอบ หนึ่ง จำกัด'),
    '77003': rec('77003', 'TGO CFO FY27-773', 'บริษัท ทดสอบ สอง จำกัด'),
  };
  return e;
}
const html = (canEdit: boolean) => {
  const e = engine();
  return renderToStaticMarkup(<AppProvider engine={e}><TgoQueue canEdit={canEdit} /></AppProvider>);
};

describe('the TGO review queue on the Update page', () => {
  it('each row names its certificate on both buttons, so no two buttons of the queue are alike', () => {
    const h = html(true);
    const labels = [...h.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    const rowLabels = labels.filter((l) => /^(รับใบ|ไม่รับใบ) /.test(l));
    const want = ['รับใบ TGO CFO FY27-771', 'ไม่รับใบ TGO CFO FY27-771', 'รับใบ TGO CFO FY27-772', 'ไม่รับใบ TGO CFO FY27-772', 'รับใบ TGO CFO FY27-773', 'ไม่รับใบ TGO CFO FY27-773'];
    expect([...rowLabels].sort()).toEqual([...want].sort()); // the order of the companies is not the point here
    expect(new Set(rowLabels).size).toBe(rowLabels.length);
    expect(labels.filter((l) => l.startsWith('รับทั้งบริษัท ')).length).toBe(2); // one per company
  });
  it('the queue announces what an action did, and the row buttons keep a 24 px target', () => {
    const h = html(true);
    expect(h).toMatch(/<div role="status" aria-live="polite"/);
    expect((h.match(/class="quiet tgo-act"/g) || []).length).toBeGreaterThanOrEqual(6);
  });
  it('a row date stays on one line: no break between the day, the month and the year', () => {
    const h = html(true);
    expect(h).toContain('อนุมัติ 20 ต.ค. 2569');
    expect(h).toContain('ถึง 19 ต.ค. 2570');
    expect(h).not.toMatch(/อนุมัติ 20 /);
  });
  it('rejecting a whole company is not done until the second, confirming step: nothing is asked for before the click', () => {
    const h = html(true);
    expect(h).not.toContain('ยืนยันไม่รับ');
    expect(h).not.toContain('ใบที่ไม่รับแล้วจะไม่กลับมาในรายการรอตรวจ');
    expect(h).toContain('ไม่รับทั้งบริษัท');
  });
  it('a viewer reads the queue and gets no buttons', () => {
    const h = html(false);
    expect(h).toContain('บริษัท ทดสอบ หนึ่ง จำกัด');
    expect(h).not.toMatch(/<button/);
  });
});
