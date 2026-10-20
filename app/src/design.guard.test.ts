import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Drift guard for the design system (simple-design/final/design-system.md §10.4): two font weights
 * (600 only on the หมวด band name and on the company name, 700 only on the Montserrat wordmark), eight
 * font sizes, and no decorative glyphs (arrows, ticks, stars, emoji) in the UI code. New code that drifts
 * fails here.
 *
 * The company name (owner, Oct 2569: "ชื่อบริษัทมันเท่ากับส่วนอื่นๆไปหมดเลย"): where a company's name is the
 * title of a row, a card or a panel it carries the one shared class .co-name (index.css): 600, the darkest
 * ink, 16px (.dense 14px in tables, .title 24px heading a panel); the line under it is .t-sec (13px dark
 * grey), details .t-meta (12px light grey). Its 600 lives only in those index.css rules, never inline
 * and never in a component's own rule.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx|css)$/.test(f) || f === 'feeds.ts' ? [p] : [];
  });
const FILES = walk(SRC).map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));

/** Files not on the system yet (none left: the Sales Tracker, the deal panel and the feeds' text are on
 *  it). An entry needs a reason and the list must end empty. */
const PENDING: Record<string, string> = {};
/** The Sales dashboard (.sd-*) is the owner's own layout, kept as designed: its sizes stay off the scale on
 *  purpose; its weights and glyphs are still checked. */
const SIZES_KEPT = /\.sd-/;

// blank out comments but keep line numbers
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^(\s*)\/\/.*$/gm, '$1');
// every number in a value (13.5px counts as 13.5, not 13)
const nums = (g: string) => [...g.matchAll(/(?<![\w.-])\d+(?:\.\d+)?/g)].map((m) => +m[0]);

const SCALE = new Set([12, 13, 14, 16, 18, 24, 28, 40]);
// CSS rules allowed off-system: the หมวด band name (600) and the Montserrat wordmark (700, 19–22px)
const BAND = /^\s*(\.sl-msec\s+)?\.sl-sec-name\b/;
const WORDMARK = /^\s*(\.brand-word|\.tb-brand-text b|\.auth-logo b)\b/;
// …and the company name: a rule of .co-name alone (or with its own modifiers), in index.css only
const CO_NAME = /^\s*\.co-name(\.[\w-]+)*\s*\{/;
const GLYPH = /[→←↑↓↗‹›▾▴⏰📎📅✓✔✕☆★⬇⬆⚙✎📞✉💬⟲฿]/u;
// a "+" in front of a button's words ("+ เพิ่มนัด"): labelled buttons carry no plus (§6.1 #8)
const PLUS_LABEL = /(^|[>'"`{])\s*\+ [\u0E00-\u0E7F]/;

describe('design system guard', () => {
  for (const { rel, src } of FILES) {
    if (PENDING[rel]) continue;
    const code = noComments(src);
    const lines = code.split('\n');
    it(`${rel}: weights 400/500 only (600 = band, company name; 700 = wordmark)`, () => {
      const bad = lines.flatMap((l, i) =>
        [...l.matchAll(/font(?:Weight|-weight)\s*:([^,;}]*)/g)] // also catches `on ? 600 : 400`
          .flatMap((m) => nums(m[1]).filter((n) => n >= 100 && n <= 900 && n % 100 === 0))
          .filter((w) => w !== 400 && w !== 500 && !(w === 600 && (BAND.test(l) || (rel === 'index.css' && CO_NAME.test(l)))) && !(w === 700 && WORDMARK.test(l)))
          .map((w) => `${rel}:${i + 1} weight ${w}`));
      expect(bad).toEqual([]);
    });
    it(`${rel}: sizes on the scale`, () => {
      const bad = lines.flatMap((l, i) =>
        [...l.matchAll(/font(?:Size|-size)\s*:([^,;}]*)/g)]
          .flatMap((m) => nums(m[1]).filter((n) => n >= 6 && n <= 120))
          .filter((s) => !SCALE.has(s) && !WORDMARK.test(l) && !(rel.endsWith('.css') && SIZES_KEPT.test(l)))
          .map((s) => `${rel}:${i + 1} size ${s}`));
      expect(bad).toEqual([]);
    });
    if (/\.(tsx|ts)$/.test(rel))
      it(`${rel}: no decorative glyphs, no "+" on a labelled button`, () => {
        const bad = lines.flatMap((l, i) => (GLYPH.test(l) || PLUS_LABEL.test(l) ? [`${rel}:${i + 1} ${l.trim().slice(0, 70)}`] : []));
        expect(bad).toEqual([]);
      });
  }
  it('the company name: one shared class, used by แผนติดต่อ, ค้นหา, บริษัทที่ติดตาม and the Sales Tracker table', () => {
    const css = noComments(FILES.find((f) => f.rel === 'index.css')!.src);
    const rule = (sel: string) => css.match(new RegExp('^\\s*' + sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}', 'm'))?.[1] ?? '';
    // 600, the darkest ink, a size up from the row's text; a dense table keeps 14px
    expect(rule('.co-name')).toMatch(/font-weight:600/);
    expect(rule('.co-name')).toMatch(/color:var\(--ink\)/);
    expect(rule('.co-name')).toMatch(/font-size:var\(--fs-card\)/);
    expect(rule('.co-name.dense')).toMatch(/font-size:var\(--fs-body\)/);
    expect(rule('.co-name.dense')).not.toMatch(/font-weight/);
    const src = (rel: string) => noComments(FILES.find((f) => f.rel === rel)!.src);
    const uses = (rel: string, re: RegExp) => expect(src(rel), rel).toMatch(re);
    uses('tabs/Plan.tsx', /className="hv-tx pl-who-n co-name"/); // the contact list
    uses('tabs/Plan.tsx', /className="hv-tx pl-task-n co-name"/); // the day's appointments
    uses('tabs/Search.tsx', /className="co-name dense">\{c\.name\}/); // the results table
    uses('tabs/Search.tsx', /className="co-name">\{c\.name\}/); // the phone cards
    uses('tabs/TrackFollow.tsx', /className="co-name">\{r\.c\.name\}/);
    // the Sales Tracker table's customer cell (DealRow), dense so its rows keep their height
    const row = src('tabs/Sales.tsx').match(/function DealRow\([\s\S]*?\n}\n/)?.[0] ?? '';
    expect(row).toMatch(/className="sl-nm-b hv-tx co-name dense"/);
    // nowhere else does 600 appear (a component's own rule or an inline style would drift from it)
    const w600 = FILES.flatMap(({ rel, src: s }) =>
      noComments(s).split('\n').flatMap((l, i) => (/font(?:Weight|-weight)\s*:\s*['"]?600/.test(l) && !BAND.test(l) && !(rel === 'index.css' && CO_NAME.test(l)) ? [`${rel}:${i + 1}`] : [])));
    expect(w600).toEqual([]);
  });
  it('lists what is still pending (shrink to nothing)', () => {
    expect(Object.keys(PENDING).every((k) => FILES.some((f) => f.rel === k))).toBe(true);
    expect(Object.keys(PENDING)).toEqual([]);
  });
});
