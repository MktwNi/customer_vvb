/**
 * The review list of the certificate sheet on the Update page (tabs/Update.tsx SheetReview), from the real engine and
 * synthetic rows: a waiting record shows its reason, certificate, organisation, GCC code as written and the sheet's values;
 * "รับ" stays disabled until a company is chosen and the required fields are there (R16); a decided record leaves the list;
 * a viewer reads the list and gets no buttons. The decision rule itself is canAcceptReview (lib/sheetReview.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppProvider } from '../state';
import { SheetReview } from './Update';
import { GccEngine } from '../lib/engine';
import { canAcceptReview, makeReview, missingFields, type ReviewRec } from '../lib/sheetReview';
import type { CertFields, CertLine } from '../lib/registryXlsx';
import { memoryStore } from '../lib/storage';
import type { Dataset, RoundRaw } from '../lib/types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

/** A sheet line's overrides; its certificate values are partial. */
type SheetOver = Partial<Omit<CertLine, 'f'>> & { f?: Partial<CertFields> };

const f = (over: Partial<CertFields> = {}): CertFields => ({
  cert: 'SYN-REV-1', org: 'บริษัท ทดสอบรีวิว จำกัด', branch: '', act: '', addr: '', zip: '', prov: '', ind: '', size: '',
  ap: '2025-02-01', ex: '2027-02-01', s1: null, s2: null, s3: null, fy: '', note: '', webId: '', ...over,
});
const sheetLine = (over: SheetOver = {}): CertLine => {
  const { f: fo, ...rest } = over;
  return {
    rowNo: 3, f: f(fo), errors: [], gcc: 'GCC-999997', email: 'synthetic@example.test', emailSt: 'พบ',
    vals: { 'เลขที่ใบรับรอง': 'SYN-REV-1', 'ชื่อองค์กร': 'บริษัท ทดสอบรีวิว จำกัด', 'อีเมล': 'synthetic@example.test' }, ...rest,
  };
};

function engine(recs: ReviewRec[]) {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = '2026-10-26';
  e.store = memoryStore();
  e.rebuild();
  e.loading = false;
  recs.forEach((r) => (e.sheetrev[r.id] = r));
  return e;
}
const waiting = (over: SheetOver = {}, reason = 'รหัส GCC ไม่พบในระบบ') =>
  makeReview(sheetLine(over), reason, 'synthetic.xlsx', '2026-10-26T03:00:00Z', 'ผู้ทดสอบ');
const html = (recs: ReviewRec[], canEdit: boolean) => {
  const e = engine(recs);
  return renderToStaticMarkup(<AppProvider engine={e}><SheetReview canEdit={canEdit} /></AppProvider>);
};
/** The whole <button> element that carries this label (the attributes come in any order). */
const buttonFor = (h: string, label: string) => h.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>[^<]*</button>`))?.[0] ?? '';

describe('the review list of the certificate sheet on the Update page (R16)', () => {
  it('lists each waiting record with its reason, certificate, organisation, GCC code as written and the sheet values', () => {
    const h = html([waiting()], true);
    expect(h).toContain('รอตรวจสอบจากไฟล์ชีต');
    expect(h).toContain('เหตุผล รหัส GCC ไม่พบในระบบ');
    expect(h).toContain('SYN-REV-1');
    expect(h).toContain('บริษัท ทดสอบรีวิว จำกัด');
    expect(h).toContain('รหัส GCC ตามชีต GCC-999997');
    expect(h).toContain('อีเมล: synthetic@example.test');
    expect(h).toContain('ค่าในชีต (3 คอลัมน์)');
  });

  it('"รับ" is disabled until a company is picked, and "ไม่รับ" is there', () => {
    const h = html([waiting()], true);
    const take = buttonFor(h, 'รับใบ SYN-REV-1');
    expect(take).not.toBe('');
    expect(take).toContain('disabled');
    expect(buttonFor(h, 'ไม่รับใบ SYN-REV-1')).not.toContain('disabled');
    expect(h).toContain('ยังไม่ได้เลือกบริษัท');
  });

  it('a waiting record with a missing required field stays unaccepted even with a company (the gate names the field)', () => {
    const rec = waiting({ f: { ap: '' } });
    expect(missingFields(rec.f)).toEqual(['ต้องกรอก วันที่อนุมัติ (พ.ศ.)']);
    expect(canAcceptReview(rec, 1e12 + 1)).toBe(false);
    expect(html([rec], true)).toContain('ต้องกรอก วันที่อนุมัติ (พ.ศ.)');
  });

  it('only the waiting records are listed: a decided one leaves the list', () => {
    const decided = { ...waiting({ f: { cert: 'SYN-DONE-1' } }), st: 'r' as const, dBy: 'ผู้ทดสอบ', dAt: '2026-10-26T04:00:00Z' };
    const h = html([waiting(), decided], true);
    expect(h).toContain('SYN-REV-1');
    expect(h).not.toContain('SYN-DONE-1');
    expect((h.match(/aria-label="รับใบ /g) || []).length).toBe(1);
  });

  it('the gate: accept needs a company and the required fields, nothing else', () => {
    const rec = waiting();
    expect(canAcceptReview(rec, null)).toBe(false);
    expect(canAcceptReview(rec, 1e12 + 1)).toBe(true);
  });

  it('a viewer reads the list and gets no buttons and no company picker', () => {
    const h = html([waiting()], false);
    expect(h).toContain('SYN-REV-1');
    expect(h).not.toMatch(/<button/);
    expect(h).not.toContain('ค้นหาบริษัทจากชื่อหรือรหัส GCC');
    expect(h).toContain('บัญชีของคุณดูรายการนี้ได้อย่างเดียว');
  });

  it('an empty list says so', () => {
    expect(html([], true)).toContain('ไม่มีแถวที่รอตรวจจากไฟล์ชีต');
  });
});
