/**
 * The deal card's ปีของงาน control (ContactCard, components/DealPanel.tsx) as markup, from the real engine. A read-only
 * card says why the year cannot change, and the control names that reason (aria-describedby points at it); an editable
 * card has no reason to name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppProvider } from '../state';
import { ContactCard } from './DealPanel';
import { GccEngine } from '../lib/engine';
import { memoryStore } from '../lib/storage';
import type { CapId } from '../lib/caps';
import type { Dataset, RoundRaw } from '../lib/types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-12';
const REASON = 'บัญชีนี้ดูข้อมูลได้ แต่แก้ไขไม่ได้';

function engine(can: (c: CapId) => boolean) {
  const g = json('gcc.json'), c = json('gcc-certs.json');
  const e = new GccEngine();
  e.base = { asOf: g.asOf, dicts: g.dicts, rows: g.rows, cdicts: c.dicts, certs: c.rows, source: 'file' } as Dataset;
  e.R = (json('rounds.json') as RoundRaw[]).map((x) => ({ ...x, annT: Date.parse(x.ann), docT: Date.parse(x.doc) })).sort((a, b) => a.annT - b.annT);
  e.ref = TODAY;
  e.store = memoryStore();
  e.rebuild();
  e.loading = false;
  e.can = can; // the account's rights (GccEngine.can reads the signed-in role)
  return e;
}

/** The ids the card's controls are described by (aria-describedby), in document order. */
const describedBy = (html: string) => [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);

describe('ปีของงาน in the deal card (ContactCard)', () => {
  it('a read-only card names why the year cannot change: the year control is described by that reason', () => {
    const e = engine((c) => c.startsWith('view.'));
    const d = e.addDeal({ client: 'บริษัท ทดสอบ ปีของงาน', year: '2569', resp: 'หมิว' });
    const html = renderToStaticMarkup(
      <AppProvider engine={e}>
        <ContactCard d={d} ro startOpen />
      </AppProvider>,
    );
    const ids = describedBy(html);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(html).toMatch(new RegExp(`id="${id}"[^>]*>${REASON}<`));
    expect(html).toContain(`>${REASON}<`);
  });

  it('an editable card shows no reason and describes nothing with one', () => {
    const e = engine((c) => c.startsWith('view.') || c === 'edit.deal' || c === 'edit.jqt');
    const d = e.addDeal({ client: 'บริษัท ทดสอบ ปีของงาน', year: '2569', resp: 'หมิว' });
    const html = renderToStaticMarkup(
      <AppProvider engine={e}>
        <ContactCard d={d} ro={false} startOpen />
      </AppProvider>,
    );
    expect(html).not.toContain(REASON);
    expect(describedBy(html)).toEqual([]);
  });
});
