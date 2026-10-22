/**
 * บริษัทที่ติดตาม as markup (tabs/TrackFollow.tsx), from the real engine: an account that may change follows gets a
 * box on every row, the header box "เลือกทั้งหมด (N บริษัท)" and the bar; an account that may not gets none of them
 * (it has no ติดตาม button on a row either), and the rows themselves are the same for both.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppProvider } from '../state';
import { FollowList } from './TrackFollow';
import { GccEngine } from '../lib/engine';
import { memoryStore } from '../lib/storage';
import type { CapId } from '../lib/caps';
import type { Dataset, RoundRaw } from '../lib/types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-12';

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

/** The list as the page draws it, for an account whose rights are `can`. */
function listFor(can: (c: CapId) => boolean, n: number) {
  const e = engine();
  const ids = e.B.companies.slice(0, n).map((c) => c.id);
  e.crm.watch.push(...ids);
  e.rebuild();
  e.can = can; // the account's rights (GccEngine.can reads the signed-in role)
  return renderToStaticMarkup(
    <AppProvider engine={e}>
      <FollowList />
    </AppProvider>,
  );
}
const count = (html: string, re: RegExp) => (html.match(re) || []).length;

describe('บริษัทที่ติดตาม for an account that may change follows (ลูกค้าและผู้ติดต่อ)', () => {
  const html = listFor((c) => c.startsWith('view.') || c === 'edit.cust' || c === 'edit.task', 6);

  it('a box on each row, named after its company, and the header box with the count', () => {
    expect(count(html, /class="fw-pk"/g)).toBe(6);
    expect(count(html, /aria-label="เลือก /g)).toBe(6);
    expect(html).toContain('เลือกทั้งหมด (6 บริษัท)');
  });

  it('the bar is there in its quiet state, before anything is picked', () => {
    expect(html).toContain('bk-bar idle');
    expect(html).toContain('ติ๊กเลือกหลายบริษัท');
  });
});

describe('บริษัทที่ติดตาม for an account that may not change follows (view only)', () => {
  const html = listFor((c) => c.startsWith('view.'), 6);

  it('no boxes, no header box, no bar: the rows and their names stay', () => {
    expect(html).not.toContain('fw-pk');
    expect(html).not.toContain('aria-label="เลือก ');
    expect(html).not.toContain('เลือกทั้งหมด');
    expect(html).not.toContain('bk-bar');
    expect(html).not.toContain('เลิกติดตาม');
    expect(count(html, /class="fw-r/g)).toBe(6);
  });
});
