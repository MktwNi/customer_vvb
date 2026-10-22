/**
 * The add dialog's check (ExistsPrompt) for a deal typed by name with a company picked (`pick`): each person the pick is not
 * the deal's company for says what they get and how the deal is linked. The way is the card's button when their card shows
 * one (contactNotHere, as it is before the pick), else the company search on the deal; the line says the same as the card.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../state';
import { ExistsPrompt } from './PeopleCos';
import { GccEngine } from '../lib/engine';
import { memoryStore } from '../lib/storage';
import { CUSTOM_ID_MIN } from '../lib/teamSync';
import type { Found } from '../lib/people';
import type { Dataset, RoundRaw } from '../lib/types';

const DATA = join(__dirname, '..', '..', '..', 'project', 'data');
const json = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const TODAY = '2026-10-12';
// (each test builds the engine from the whole registry: slower than the default under a full run)
vi.setConfig({ testTimeout: 30000 });
const blank = { jur: '', prov: '', ind: '', biz: '', addr: '', phone: '', email: '', web: '', contact: '', note: '' };
const CARD = '(กดปุ่มในการ์ดดีลถ้าจะเชื่อม)';
const SEARCH = '(เชื่อมได้ที่ช่องค้นบริษัทของดีล)';

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

/** The dialog as AddPerson draws it: the people found (not at the company typed), the company picked for the deal. */
function dialog(e: GccEngine, pids: string[], deal: string, gid: number) {
  const found: Found[] = pids.map((id) => ({ p: e.people[id], by: ['name'], here: false }));
  const d = e.sales.deals[deal];
  const html = renderToStaticMarkup(
    <AppProvider engine={e}>
      <ExistsPrompt found={found} coName={e.company(gid)?.name || ''} pick={{ deal, client: d.client.trim(), gid }} onUse={() => {}} onOpen={() => {}} />
    </AppProvider>,
  );
  // (React marks where adjacent text meets with comments; the text itself is what is checked)
  return html.replace(/<!-- -->/g, '');
}
const count = (html: string, s: string) => html.split(s).length - 1;

describe('the dialog\'s check for a deal typed by name, a company picked: the line for each person says what they get and how the deal links', () => {
  it('one person already at the company the deal\'s name gives, another company picked: the deal is not linked, and the card has no button for them, so the line points to the deal\'s company search', () => {
    const e = engine();
    const x = e.addCustomer({ name: 'เอ บี ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 41 });
    const z = e.addCustomer({ name: 'ซี ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 42 });
    const pid = e.addPerson({ name: 'คุณพี หนึ่ง', gid: x });
    const d = e.addDeal({ client: 'เอ บี ทดสอบ', year: '2569' });
    expect(e.contactNotHere(d, e.people[pid])).toBe(false);
    expect(e.pickedIsDealCompany(d.id, pid, z)).toBe(false);
    const html = dialog(e, [pid], d.id, z);
    expect(html).toContain(`เพิ่ม “ซี ทดสอบ” ให้ “คุณพี หนึ่ง” และผูกกับดีลนี้ · ดีลยังไม่ได้เชื่อมกับ “เอ บี ทดสอบ” ${SEARCH}`);
    expect(html).not.toContain('กดปุ่มในการ์ดดีล');
  });

  it('one person not at the deal\'s company, another company picked: the card has the one button for them, and the line says so', () => {
    const e = engine();
    e.addCustomer({ name: 'เอ บี สอง', ...blank }, { id: CUSTOM_ID_MIN + 43 });
    const z = e.addCustomer({ name: 'ซี สอง', ...blank }, { id: CUSTOM_ID_MIN + 44 });
    const pid = e.addPerson({ name: 'คุณพี สอง', gid: z });
    const d = e.addDeal({ client: 'เอ บี สอง', year: '2569' });
    expect(e.contactNotHere(d, e.people[pid])).toBe(true);
    const html = dialog(e, [pid], d.id, z);
    expect(html).toContain(`ดีลยังไม่ได้เชื่อมกับ “เอ บี สอง” ${CARD}`);
    expect(html).not.toContain('ช่องค้นบริษัท');
  });

  it('several people, one at the deal\'s company and one with none: the picked company goes to the one apart only, and only that row says so', () => {
    const e = engine();
    const x1 = e.addCustomer({ name: 'สองมิกซ์ ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 61 });
    const x2 = e.addCustomer({ name: 'สองมิกซ์ ทดสอบ', ...blank }, { id: CUSTOM_ID_MIN + 62 });
    const p1 = e.addPerson({ name: 'คุณมิกซ์ หนึ่ง', gid: x1 });
    const p2 = e.addPerson({ name: 'คุณมิกซ์ สอง' });
    const d = e.addDeal({ client: 'สองมิกซ์ ทดสอบ', year: '2569' });
    expect(e.pickedIsDealCompany(d.id, p1, x2)).toBe(false);
    expect(e.pickedIsDealCompany(d.id, p2, x2)).toBe(true);
    const html = dialog(e, [p1, p2], d.id, x2);
    expect(count(html, 'ให้คนนี้เท่านั้น')).toBe(1);
    expect(html).toContain(`จะเพิ่ม “สองมิกซ์ ทดสอบ” ให้คนนี้เท่านั้น · ดีลยังไม่ได้เชื่อมกับ “สองมิกซ์ ทดสอบ” ${SEARCH}`);
    expect(html.indexOf('คุณมิกซ์ หนึ่ง')).toBeLessThan(html.indexOf('ให้คนนี้เท่านั้น'));
    expect(html.indexOf('ให้คนนี้เท่านั้น')).toBeLessThan(html.indexOf('คุณมิกซ์ สอง'));
  });

  it('several people all at the company the deal gets: no line says the deal is apart', () => {
    const e = engine();
    const x = e.addCustomer({ name: 'เอ บี สาม', ...blank }, { id: CUSTOM_ID_MIN + 63 });
    const p1 = e.addPerson({ name: 'คุณสาม หนึ่ง', gid: x });
    const p2 = e.addPerson({ name: 'คุณสาม สอง', gid: x });
    const d = e.addDeal({ client: 'เอ บี สาม', year: '2569' });
    const html = dialog(e, [p1, p2], d.id, x);
    expect(html).not.toContain('ให้คนนี้เท่านั้น');
    expect(html).not.toContain('ดีลยังไม่ได้เชื่อม');
  });
});
