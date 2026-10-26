/**
 * A followed company's contact in the three places that show it, from the real engine: the ติดตาม row's line under the
 * name, the company drawer's header ("ติดต่อล่าสุด") and the drawer's การติดต่อ tab count. All three read followContact
 * (lib/follow.ts), so for one company they give the same day and the same count.
 * The app context is mocked (the drawer takes its selection from it); the list and the drawer are rendered as markup.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { useApp } from '../state';
import { CompanyDrawer } from './CompanyDrawer';
import { FollowList } from '../tabs/TrackFollow';
import { GccEngine } from '../lib/engine';
import { memoryStore } from '../lib/storage';
import type { Dataset, RoundRaw } from '../lib/types';

type App = ReturnType<typeof useApp>;
// the app context the list and the drawer read; each test sets it (the drawer's selection is ui.sel)
const app = vi.hoisted(() => ({ v: null as unknown as App }));
vi.mock('../state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state')>()),
  useApp: () => app.v,
  useEngineVersion: () => 0,
}));

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-12';
/** The date and the count are written with no-break spaces in the list (lib/follow.ts whole). */
const nb = (s: string) => s.replace(/ /g, ' ');
/** The text as React writes it into markup (its entities), to find a name in the page. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

function engine() {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = TODAY;
  e.store = memoryStore();
  e.rebuild();
  e.loading = false;
  e.can = (c) => c.startsWith('view.'); // a read-only account: the drawer and the list render without their buttons
  return e;
}

/** The app context with the drawer's company selected on its ข้อมูลบริษัท tab. */
function useCtx(e: GccEngine, sel: number | null) {
  app.v = {
    engine: e,
    ui: { sel, dTab: 'info', slYear: '' },
    set: () => {},
    go: () => {},
    open: () => {},
    openSched: () => {},
    setF: () => {},
    setRef: () => {},
  } as unknown as App;
}

/** The ติดตาม list's row of a company, from its row's start to the next row's. */
function rowOf(html: string, name: string) {
  return html.split('class="fw-r').find((p) => p.includes(`class="co-name">${esc(name)}<`))!;
}
/** The count the row prints ("3 ครั้ง"), undefined when it prints none. */
const rowCount = (row: string) => {
  const m = row.match(/(\d+) ครั้ง/);
  return m ? m[1] : undefined;
};

/** The drawer's header date line and its การติดต่อ tab count (no badge when it is 0). */
function drawerOf(e: GccEngine, id: number) {
  useCtx(e, id);
  const html = renderToStaticMarkup(<CompanyDrawer />);
  return {
    header: html.match(/<span class="dr-line">([\s\S]*?)<\/span>/)![1],
    badge: html.match(/<span>การติดต่อ<\/span>(?:<span class="n">([^<]*)<\/span>)?/)![1],
  };
}

describe('a followed company: the list row, the drawer header and the drawer tab say the same', () => {
  const e = engine();
  const [A, B, C, D] = e.B.companies.slice(0, 4);
  // A: two calls and one open appointment (and one done, not counted)
  e.crm.log[A.id] = [
    { at: '2026-10-02T10:00:00', by: 'คุณ ก', type: 'call', result: '', text: '' },
    { at: '2026-10-10T15:00:00', by: 'คุณ ก', type: 'meet', result: '', text: '' },
  ];
  e.crm.tasks.push(
    { id: 'TA1', gid: A.id, title: '', type: 'call', date: '2026-12-01', time: '10:00', note: '', done: false },
    { id: 'TA2', gid: A.id, title: '', type: 'call', date: '2026-09-01', time: '', note: '', done: true },
  );
  // B: a call logged at 19:30 UTC, the next day in Thailand
  e.crm.log[B.id] = [{ at: '2026-10-25T19:30:00.000Z', by: 'คุณ ก', type: 'call', result: '', text: '' }];
  // C: a note only, no contact
  e.crm.log[C.id] = [{ at: '2026-10-05T09:00:00', by: 'คุณ ก', type: 'note', result: '', text: 'ส่งเอกสารแล้ว' }];
  // D: no entries at all
  e.crm.watch.push(A.id, B.id, C.id, D.id);

  // Bangkok time, for the whole render: 19:30 UTC on 25 Oct is 02:30 on 26 Oct
  const tz = process.env.TZ;
  let html = '';
  beforeAll(() => {
    process.env.TZ = 'Asia/Bangkok';
    useCtx(e, null);
    html = renderToStaticMarkup(<FollowList />);
  });
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('a company with two calls and one open appointment: 3 in the row and on the tab, the header shows the last call day', () => {
    const row = rowOf(html, A.name);
    expect(row).toContain(`ติดต่อแล้ว · ล่าสุด ${nb('10 ต.ค. 2569')} · ${nb('3 ครั้ง')}`);
    const d = drawerOf(e, A.id);
    expect(d.header).toContain('ติดต่อล่าสุด <b>10 ต.ค. 2569</b>');
    expect(d.badge).toBe('3');
    expect(rowCount(row)).toBe(d.badge);
  });

  it('a contact at 19:30 UTC shows the Thai day (26 ต.ค.) in the row and in the drawer header', () => {
    const row = rowOf(html, B.name);
    expect(row).toContain(`ติดต่อแล้ว · ล่าสุด ${nb('26 ต.ค. 2569')}`);
    const d = drawerOf(e, B.id);
    expect(d.header).toContain('ติดต่อล่าสุด <b>26 ต.ค. 2569</b>');
    expect(d.badge).toBe('1');
  });

  it('a note-only company stays ยังไม่ได้ติดต่อ in the row and the drawer header, and counts 1 in both', () => {
    const row = rowOf(html, C.name);
    expect(row).toContain('ยังไม่ได้ติดต่อ');
    expect(rowCount(row)).toBeUndefined(); // the row names no count without a contact
    const d = drawerOf(e, C.id);
    expect(d.header).toContain('ยังไม่ได้ติดต่อ');
    expect(d.badge).toBe('1');
  });

  it('a company with no entries shows no count: the row says ยังไม่ได้ติดต่อ and the tab has no badge', () => {
    const row = rowOf(html, D.name);
    expect(row).toContain('ยังไม่ได้ติดต่อ');
    expect(rowCount(row)).toBeUndefined();
    const d = drawerOf(e, D.id);
    expect(d.header).toContain('ยังไม่ได้ติดต่อ');
    expect(d.badge).toBeUndefined();
  });
});
