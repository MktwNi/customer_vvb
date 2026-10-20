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
// CSS rules allowed off-system: the หมวด band name (600) and the Montserrat wordmark (700, 19–22px)…
const BAND = /^(\.sl-msec\s+)?\.sl-sec-name$/;
const WORDMARK = /^(\.brand-word|\.tb-brand-text b|\.auth-logo b)$/;
// …and the company name: a rule of .co-name alone (or with its own modifiers), in index.css only
const CO_NAME = /^\.co-name(\.[\w-]+)*$/;
const GLYPH = /[→←↑↓↗‹›▾▴⏰📎📅✓✔✕☆★⬇⬆⚙✎📞✉💬⟲฿]/u;
// a "+" in front of a button's words ("+ เพิ่มนัด"): labelled buttons carry no plus (§6.1 #8)
const PLUS_LABEL = /(^|[>'"`{])\s*\+ [฀-๿]/;

/**
 * A stylesheet's rules, those inside an @media too: each selector with its declarations and where they
 * start. The checks below read a rule's own selector, so a rule sharing a line with an allowed one is
 * still checked (review: `.co-name.x{…}.tag{font-weight:600}` on one line passed a line-based check).
 */
function cssRules(css: string) {
  const out: { sel: string; body: string; at: number }[] = [];
  const open: string[] = [];
  let mark = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      // the selector: after the last statement (`@import …;`) before it
      open.push(css.slice(mark, i).split(';').pop()!.trim());
      mark = i + 1;
    } else if (css[i] === '}') {
      const sel = open.pop();
      if (sel != null && css.slice(mark, i).trim()) out.push({ sel, body: css.slice(mark, i), at: mark });
      mark = i + 1;
    }
  }
  return out;
}
const lineAt = (s: string, i: number) => s.slice(0, i).split('\n').length;
/** Every part of a selector list is one of these (`.co-name,.tag` is not the company name). */
const all = (sel: string, re: RegExp) => sel.split(',').every((x) => re.test(x.trim()));
/** The weight tokens (`--fw-band:600` on :root): `var(--fw-band)` is a 600 as much as `600` is. */
const tokensOf = (files: { src: string }[]) =>
  Object.fromEntries(files.flatMap(({ src }) => [...noComments(src).matchAll(/(--fw-[\w-]+)\s*:\s*(\d+)/g)].map((m) => [m[1], +m[2]] as const)));
/** The weights a font-weight value names: numbers (also `on ? 600 : 400`) and weight tokens. */
const weightsIn = (v: string, fw: Record<string, number>) => [
  ...nums(v).filter((n) => n >= 100 && n <= 900 && n % 100 === 0),
  ...[...v.matchAll(/var\(\s*(--fw-[\w-]+)/g)].map((m) => fw[m[1]] ?? 0),
];
/** 400 and 500 anywhere; 600 on the band name and (index.css) the company name; 700 on the wordmark. */
const weightOk = (rel: string, sel: string, w: number) =>
  w === 400 || w === 500 || (w === 600 && (all(sel, BAND) || (rel === 'index.css' && all(sel, CO_NAME)))) || (w === 700 && all(sel, WORDMARK));

/** Weights off the system in a stylesheet, rule by rule. */
function cssWeightDrift(rel: string, css: string, fw: Record<string, number>) {
  const code = noComments(css);
  return cssRules(code).flatMap(({ sel, body, at }) =>
    [...body.matchAll(/font-weight\s*:([^;]*)/g)].flatMap((m) =>
      weightsIn(m[1], fw).filter((w) => !weightOk(rel, sel, w)).map((w) => `${rel}:${lineAt(code, at + m.index!)} ${sel} weight ${w}`)));
}
/** Weights off the system in a component (inline styles: never a 600, which lives in index.css). */
function codeWeightDrift(rel: string, src: string, fw: Record<string, number>) {
  return noComments(src).split('\n').flatMap((l, i) =>
    [...l.matchAll(/font(?:Weight|-weight)\s*:([^,;}]*)/g)]
      .flatMap((m) => weightsIn(m[1], fw).filter((w) => w !== 400 && w !== 500))
      .map((w) => `${rel}:${i + 1} weight ${w}`));
}
/** Sizes off the scale in a stylesheet, rule by rule (the dashboard's own .sd-* and the wordmark kept). */
function cssSizeDrift(rel: string, css: string) {
  const code = noComments(css);
  return cssRules(code).flatMap(({ sel, body, at }) =>
    all(sel, SIZES_KEPT) || all(sel, WORDMARK)
      ? []
      : [...body.matchAll(/font-size\s*:([^;]*)/g)].flatMap((m) =>
          nums(m[1]).filter((n) => n >= 6 && n <= 120 && !SCALE.has(n)).map((n) => `${rel}:${lineAt(code, at + m.index!)} ${sel} size ${n}`)));
}
const FW = tokensOf(FILES);

describe('design system guard', () => {
  for (const { rel, src } of FILES) {
    if (PENDING[rel]) continue;
    const code = noComments(src);
    const lines = code.split('\n');
    it(`${rel}: weights 400/500 only (600 = band, company name; 700 = wordmark)`, () => {
      expect(rel.endsWith('.css') ? cssWeightDrift(rel, src, FW) : codeWeightDrift(rel, src, FW)).toEqual([]);
    });
    it(`${rel}: sizes on the scale`, () => {
      const bad = rel.endsWith('.css')
        ? cssSizeDrift(rel, src)
        : lines.flatMap((l, i) =>
            [...l.matchAll(/font(?:Size|-size)\s*:([^,;}]*)/g)]
              .flatMap((m) => nums(m[1]).filter((n) => n >= 6 && n <= 120))
              .filter((n) => !SCALE.has(n))
              .map((n) => `${rel}:${i + 1} size ${n}`));
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
    // the phone cards under the 16px/600 section bands keep 14px, as Cashflow's (review: band and name read alike)
    const card = src('tabs/Sales.tsx').match(/function DealCard\([\s\S]*?\n}\n/)?.[0] ?? '';
    expect(card).toMatch(/className="sl-nm-b hv-tx co-name dense"/);
    // the company's identity line under its name is .t-sec on ค้นหา (table and phone cards) and บริษัทที่ติดตาม
    uses('tabs/Search.tsx', /className="co-name">\{c\.name\}<\/span>\s*<span className="t-sec">/);
    uses('tabs/Search.tsx', /className="co-name dense">\{c\.name\}<\/span>\s*<span className="t-sec sxr-sub">/);
    uses('tabs/TrackFollow.tsx', /className="co-name">\{r\.c\.name\}<\/span>\s*<span className="t-sec"/);
    // a heading over names stays a size up from them (review: 14/500 and 16/500 headings over 14/600 and 16/600 names)
    const px: Record<string, number> = { '--fs-meta': 12, '--fs-sec': 13, '--fs-body': 14, '--fs-card': 16, '--fs-section': 18 };
    const size = (body: string) => px[body.match(/font-size:var\((--fs-[\w-]+)\)/)?.[1] ?? ''] ?? 0;
    const track = cssRules(noComments(FILES.find((f) => f.rel === 'track.css')!.src));
    const feedT = track.find((r) => r.sel === '.tr-feed-t')!.body;
    expect(size(feedT)).toBeGreaterThan(size(rule('.co-name.dense')));
    // …and the registry's own heading a size up from those card titles
    expect(size(track.find((r) => r.sel === '.tr-regh h2')!.body)).toBeGreaterThan(size(feedT));
    expect(size(rule('.pl-day-t b'))).toBeGreaterThan(size(rule('.co-name')));
    // one date column in งานที่กำลังจะถึง: an installment's date as the appointments' (.pl-up-when), a late one red
    expect(rule('.pl-pay.up>small')).toBe(rule('.pl-up-when').replace(/;white-space:nowrap$/, ''));
    expect(css.indexOf('.pl-pay.late>small{color:var(--bad)}')).toBeGreaterThan(css.indexOf('.pl-pay.up>small{'));
    // nowhere else does 600 appear (a component's own rule or an inline style would drift from it), also
    // as a weight token
    const w600 = FILES.flatMap(({ rel, src: s }) =>
      (rel.endsWith('.css') ? cssWeightDrift(rel, s, FW) : codeWeightDrift(rel, s, FW)).filter((x) => / weight 600$/.test(x)));
    expect(w600).toEqual([]);
    expect(FW['--fw-band']).toBe(600);
  });
  it('the guard reads each rule on its own, and weight tokens too (review: two ways a 600 slipped past it)', () => {
    const css = (rel: string, s: string) => cssWeightDrift(rel, s, FW).map((x) => x.replace(/^[^ ]+ /, ''));
    // allowed: the company name in index.css, the band name, the wordmark
    expect(css('index.css', '.co-name{font-size:var(--fs-card);font-weight:600}\n.co-name.dense{font-size:var(--fs-body)}')).toEqual([]);
    expect(css('index.css', '.sl-sec-name{font-weight:600}.sl-msec .sl-sec-name{font-weight:var(--fw-band)}')).toEqual([]);
    expect(css('index.css', '@media (max-width:640px){.auth-logo b{font-weight:700}}.brand-word{font-weight:700!important}')).toEqual([]);
    // caught before too: another rule's 600, a .co-name 600 outside index.css, a descendant .co-name
    expect(css('track.css', '.x{font-weight:600}')).toEqual(['.x weight 600']);
    expect(css('track.css', '.co-name{font-weight:600}')).toEqual(['.co-name weight 600']);
    expect(css('index.css', '.fw-name .co-name{font-weight:600}')).toEqual(['.fw-name .co-name weight 600']);
    // a rule sharing a line with an allowed one, a selector list, a rule inside @media
    expect(css('index.css', '.co-name.x{font-size:var(--fs-body)}.tag{font-weight:600}')).toEqual(['.tag weight 600']);
    expect(css('index.css', '.co-name,.tag{font-weight:600}')).toEqual(['.co-name,.tag weight 600']);
    expect(css('index.css', '@media (max-width:560px){.co-name.title{font-size:18px}.tag{font-weight:600}}')).toEqual(['.tag weight 600']);
    // a weight token that is a 600
    expect(css('index.css', '.other{font-weight:var(--fw-band)}')).toEqual(['.other weight 600']);
    expect(css('index.css', '.other{font-weight:var(--fw-name)}')).toEqual([]);
    // inline, in a component: a number, a choice, a token
    expect(codeWeightDrift('x.tsx', "<b style={{ fontWeight: 600 }}>", FW)).toEqual(['x.tsx:1 weight 600']);
    expect(codeWeightDrift('x.tsx', "style={{ fontWeight: on ? 600 : 400 }}", FW)).toEqual(['x.tsx:1 weight 600']);
    expect(codeWeightDrift('x.tsx', "style={{ fontWeight: 'var(--fw-band)' }}", FW)).toEqual(['x.tsx:1 weight 600']);
    // the line a finding names is the declaration's
    expect(cssWeightDrift('a.css', '.a{color:red}\n\n.b{\n  font-weight:600}', FW)).toEqual(['a.css:4 .b weight 600']);
    // sizes are read rule by rule too: the dashboard's own sizes stay theirs only
    expect(cssSizeDrift('index.css', '.sd-big{font-size:34px}.sd-x span{font-size:12.5px}')).toEqual([]);
    expect(cssSizeDrift('index.css', '.sd-big{font-size:34px}.other{font-size:15px}')).toEqual(['index.css:1 .other size 15']);
    expect(cssSizeDrift('index.css', '.sd-big,.other{font-size:34px}')).toEqual(['index.css:1 .sd-big,.other size 34']);
  });
  it('lists what is still pending (shrink to nothing)', () => {
    expect(Object.keys(PENDING).every((k) => FILES.some((f) => f.rel === k))).toBe(true);
    expect(Object.keys(PENDING)).toEqual([]);
  });
});
