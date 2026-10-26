/**
 * New TGO CFO certificates, from one of two places:
 *  - the feed (preferred): the "อัปเดตรายชื่อ CFO อบก." web app (Google Apps Script) keeps the Google Sheet
 *    "TGO" in step with TGO's site — every record, cleaned, with address, industry, size and scope 1–3.
 *    `<web app url>?format=json&since=yyyy-mm-dd`; Apps Script answers with CORS headers, no proxy needed.
 *  - TGO's public list page itself (port of tgo-sync.js, via a CORS proxy): the first pages' cards only.
 */
import { pad } from './format';

export const TGO_URL = 'https://thaicarbonlabel.tgo.or.th/index.php?lang=TH&mod=YjNKbllXNXBlbUYwYVc5dVgyRndjSEp2ZG1Gcw';
/** The web app's address (ends in /exec). Empty = read TGO's page through a proxy as before. */
export const FEED_URL = '';
const PROXIES = ['https://api.allorigins.win/raw?url={u}', 'https://corsproxy.io/?url={u}', 'https://api.codetabs.com/v1/proxy?quest={u}'];

export interface TgoItem {
  cert: string; act: string; org: string; branch: string; prov: string; apBE: string; exBE: string; ap: string; ex: string; fy: string; id: string;
  /** feed only (the list page has no details) */
  addr?: string; zip?: string; changwat?: string; ind?: string; size?: string; s1?: number | null; s2?: number | null; s3?: number | null;
}
export interface TgoResult { items: TgoItem[]; total: number | null; pages: number; paged: boolean; via: string; since?: string; lastCheck?: string }

/** One row of the feed (the cleaned sheet "ข้อมูล CFO"); s1–s3 are fractions (0.25 = 25%). */
export interface FeedRow {
  id: string; cert: string; act: string; org: string; branch: string; prov: string; addr: string; tambon: string; amphoe: string; changwat: string;
  zip: string; ind: string; size: string; apBE: string; exBE: string; ap: string; ex: string; s1: number | null; s2: number | null; s3: number | null;
  fy: string; note: string; flags: string;
}

/** TGO's cards say "กรุงเทพฯ"; the registry's dictionaries spell it out. */
export const provName = (s: string) => {
  const t = String(s || '').replace(/^จ(?:\.|ังหวัด)\s*/, '').trim();
  return /^(กรุงเทพฯ|กรุงเทพ|กทม\.?)$/.test(t) ? 'กรุงเทพมหานคร' : t;
};

export const feedUrl = (base: string, since?: string) => {
  const u = String(base || '').trim().split('#')[0];
  return u + (u.includes('?') ? '&' : '?') + 'format=json' + (since ? '&since=' + since : '');
};

const num = (v: unknown) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));

export function fromFeed(r: FeedRow): TgoItem {
  const s = (v: unknown) => String(v ?? '').trim();
  const cert = s(r.cert);
  const fm = /FY(\d\d)/i.exec(cert);
  const fy = s(r.fy) || (fm ? 'FY' + fm[1] : '');
  return {
    cert, act: s(r.act), org: s(r.org), branch: s(r.branch), prov: s(r.prov), apBE: s(r.apBE), exBE: s(r.exBE),
    ap: s(r.ap) || be2iso(s(r.apBE)), ex: s(r.ex) || be2iso(s(r.exBE)), fy, id: s(r.id).replace(/\.0+$/, ''),
    addr: s(r.addr), zip: s(r.zip), changwat: s(r.changwat), ind: s(r.ind), size: s(r.size), s1: num(r.s1), s2: num(r.s2), s3: num(r.s3),
  };
}

/** Records approved on/after `since` (all when empty) from the web app's feed. */
export async function fetchFeed(opts: { url: string; since?: string; onProgress?: (m: string) => void }): Promise<TgoResult> {
  const { url, since, onProgress } = opts;
  onProgress?.('กำลังอ่านข้อมูลจาก Google Sheet…');
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 90000);
  let j: { ok?: boolean; error?: string; rows?: FeedRow[]; webTotal?: number | null; sheetRows?: number | null; lastCheck?: string; since?: string } | null = null;
  try {
    const r = await fetch(feedUrl(url, since), { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const t = await r.text();
    try {
      j = JSON.parse(t);
    } catch {
      throw new Error('ลิงก์ไม่ได้ส่งข้อมูลกลับมา ตรวจว่าเป็นลิงก์เว็บแอปที่ลงท้ายด้วย /exec และตั้งผู้ที่มีสิทธิ์เข้าถึงเป็น "ทุกคน"');
    }
  } catch (e) {
    const m = ctl.signal.aborted ? 'หมดเวลารอ' : (e as Error)?.message || String(e);
    throw new Error('อ่านข้อมูลจาก Google Sheet ไม่ได้ (' + (m === 'Failed to fetch' ? 'เชื่อมต่อไม่ได้ ตรวจลิงก์และสิทธิ์เข้าถึงของเว็บแอป' : m) + ')');
  } finally {
    clearTimeout(to);
  }
  if (!j || j.ok === false || !Array.isArray(j.rows)) throw new Error('Google Sheet ตอบกลับไม่ถูกต้อง' + (j?.error ? ': ' + j.error : ''));
  const items = j.rows.map(fromFeed).filter((it) => it.cert || it.org);
  return { items, total: j.webTotal ?? j.sheetRows ?? null, pages: 1, paged: false, via: 'Google Sheet', since: j.since || since || '', lastCheck: j.lastCheck || '' };
}

/** "31/08/2569" (Buddhist or Gregorian year) → "2026-08-31" */
const be2iso = (s: string) => {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '');
  if (!m) return '';
  let y = +m[3];
  if (y > 2400) y -= 543;
  return `${y}-${pad(m[2])}-${pad(m[1])}`;
};
const normOrg = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
export const key = (cert: string, org: string) => String(cert || '').replace(/\s+/g, '').toUpperCase() + '|' + normOrg(org);

async function get(url: string, proxy: string) {
  const tries: string[] = [];
  if (proxy) tries.push(proxy.includes('{u}') ? proxy : proxy + '{u}');
  tries.push('{u}', ...PROXIES);
  let last: unknown;
  for (const t of tries) {
    const full = t === '{u}' ? url : t.replace('{u}', encodeURIComponent(url));
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(full, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      if (/TGO\s*CFO/i.test(html)) return { html, via: t === '{u}' ? 'direct' : t.split('/')[2] };
      last = new Error('ไม่พบรายการ CFO ในหน้าที่ดึงมา');
    } catch (e) {
      last = e;
    }
  }
  throw new Error('เชื่อมต่อเว็บไซต์ TGO ไม่ได้ (' + ((last as Error)?.message || 'ถูกบล็อก') + ') ลองตั้งค่า Proxy ของหน่วยงานในตั้งค่าขั้นสูง');
}

function texts(el: Element) {
  const out: string[] = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = w.nextNode())) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

export function parse(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tm = /ทั้งหมด\s*([\d,]+)\s*รายการ/.exec(doc.body.textContent || '');
  const items: TgoItem[] = [];
  doc.querySelectorAll('h4').forEach((h) => {
    const cert = (h.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/^TGO\s*CFO/i.test(cert)) return;
    let card: Element = h;
    while (card.parentElement && card.parentElement !== doc.body && [...card.parentElement.querySelectorAll('h4')].filter((x) => /TGO\s*CFO/i.test(x.textContent || '')).length === 1)
      card = card.parentElement;
    const T = texts(card), full = T.join(' ');
    const h3 = card.querySelector('h3');
    const act = h3 ? (h3.textContent || '').replace(/\s+/g, ' ').trim() : '';
    const ai = T.indexOf(act);
    const line = T.slice(ai + 1).find((t) => t.includes(',') && !/วันที่/.test(t)) || '';
    const ci = line.lastIndexOf(',');
    const org = (ci > 0 ? line.slice(0, ci) : line).trim();
    const prov = ci > 0 ? line.slice(ci + 1).trim() : '';
    const bm = /\(([^()]*)\)\s*$/.exec(org);
    const apBE = (/วันที่อนุมัติ\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(full) || [])[1] || '';
    const exBE = (/วันที่หมดอายุ\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(full) || [])[1] || '';
    const av = /(?:data-[\w-]*id|data-key|onclick)\s*=\s*("[^"]*"|'[^']*')/i.exec(card.outerHTML);
    const idm = av && /(\d{3,7})/.exec(av[1]);
    const fy = (/FY(\d\d)/i.exec(cert) || [])[1];
    if (org) items.push({ cert, act, org, branch: bm ? bm[1] : '', prov, apBE, exBE, ap: be2iso(apBE), ex: be2iso(exBE), fy: fy ? 'FY' + fy : '', id: idm ? idm[1] : '' });
  });
  return { total: tm ? +tm[1].replace(/,/g, '') : null, items };
}

export async function fetchAll(opts: { proxy: string; maxPages?: number; isKnown?: (it: TgoItem) => boolean; onProgress?: (m: string) => void }): Promise<TgoResult> {
  const { proxy, maxPages, isKnown, onProgress } = opts;
  onProgress?.('กำลังดึงหน้า 1…');
  const first = await get(TGO_URL, proxy);
  const p1 = parse(first.html);
  if (!p1.items.length) throw new Error('อ่านรูปแบบหน้าเว็บไม่ได้ เว็บไซต์ TGO อาจเปลี่ยนโครงสร้าง');
  const seen = new Set(p1.items.map((i) => key(i.cert, i.org)));
  const items = [...p1.items];
  let pages = 1, paged = true;
  if (!p1.items.every(isKnown || (() => false)))
    for (let n = 2; n <= (maxPages || 1); n++) {
      onProgress?.(`กำลังดึงหน้า ${n}…`);
      let pg;
      try {
        pg = parse((await get(TGO_URL + '&page=' + n, proxy)).html);
      } catch {
        break;
      }
      const fresh = pg.items.filter((i) => !seen.has(key(i.cert, i.org)));
      if (!fresh.length) {
        if (n === 2) paged = false;
        break;
      }
      fresh.forEach((i) => {
        seen.add(key(i.cert, i.org));
        items.push(i);
      });
      pages = n;
      if (isKnown && fresh.every(isKnown)) break;
    }
  return { items, total: p1.total, pages, paged, via: first.via };
}
