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
export const FEED_URL = 'https://script.google.com/macros/s/AKfycbzq7vOzZryh9-JjfGfdYLOSO2j9xCBTwUgsm0HS46aYdhjnj0QGQ7GRYIhchuICtKfpmg/exec';
const PROXIES = ['https://api.allorigins.win/raw?url={u}', 'https://corsproxy.io/?url={u}', 'https://api.codetabs.com/v1/proxy?quest={u}'];

export interface TgoItem {
  cert: string; act: string; org: string; branch: string; prov: string; apBE: string; exBE: string; ap: string; ex: string; fy: string; id: string;
  /** feed only (the list page has no details) */
  addr?: string; zip?: string; changwat?: string; ind?: string; size?: string; s1?: number | null; s2?: number | null; s3?: number | null;
}
export interface TgoResult { items: TgoItem[]; total: number | null; pages: number; paged: boolean; via: string; since?: string; lastCheck?: string }

/** One cell of the sheet as the feed sends it: text as typed (percent, thousands commas, Buddhist dates), or a number. */
export type Cell = string | number | null;
/** One row of the feed (the cleaned sheet "ข้อมูล CFO"); s1–s3 are shares (0.25 or "25%"), dates are text or JSON dates. */
export interface FeedRow {
  id: Cell; cert: string; act: string; org: string; branch: string; prov: string; addr: string; tambon: string; amphoe: string; changwat: string;
  zip: string; ind: string; size: string; apBE: string; exBE: string; ap: Cell; ex: Cell; s1: Cell; s2: Cell; s3: Cell;
  fy: string; note: string; flags: string;
}

/** A pulled certificate in the shared review queue (tgo/<id>): 'p' waits for a decision, 'a' is accepted (its
 *  company and certificate are in the registry), 'r' is rejected (kept, so a later pull never adds it again). */
export type TgoSt = 'p' | 'a' | 'r';
export interface TgoRec extends TgoItem { st: TgoSt; gid: number | null; by: string; at: string; note: string }

/** An id as the sheet shows it: "32,040", 32040, "32040.0" → "32040". */
export const idOf = (v: unknown) => String(v ?? '').trim().replace(/,/g, '').replace(/\.0+$/, '');

/** A share as a fraction: "12.20%" or "12.20 %" or 0.122 → 0.122; a bare number above 1 is a percentage; else null. */
export function shareOf(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const pct = typeof v === 'string' && /%\s*$/.test(v.trim());
  const n = typeof v === 'number' ? v : Number(String(v).replace(/%\s*$/, '').replace(/,/g, '').trim());
  if (!isFinite(n) || String(v).trim() === '' || n < 0) return null;
  return pct || n > 1 ? +(n / 100).toFixed(6) : n;
}

/** A date as yyyy-mm-dd (Bangkok's calendar day): yyyy-mm-dd as is; dd/mm/yyyy (Buddhist or Gregorian year); a JSON or
 *  Date string with a zone (read as the Bangkok day, UTC+7); a clock time without a zone as its own day. '' if unknown. */
export function dateOf(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dm) return be2iso(s);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const zoned = /(Z|GMT[+-]\d{4}|UTC|[+-]\d{2}:?\d{2})\s*(\(.*\))?$/.test(s);
  const d = zoned ? new Date(t + 7 * 36e5) : new Date(t);
  const part = zoned ? [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()] : [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  return `${part[0]}-${pad(part[1])}-${pad(part[2])}`;
}

/** The queue key of a pulled certificate: its TGO id, else its certificate no. + organisation. */
export const ridOf = (it: Pick<TgoItem, 'id' | 'cert' | 'org'>) => (it.id ? it.id : 'k' + encodeURIComponent(key(it.cert, it.org)));

/** A queue record as the sheet or this browser stores it, read tolerantly; null when it is not one. */
export function toTgoRec(v: unknown): TgoRec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const st = o.st === 'p' || o.st === 'a' || o.st === 'r' ? o.st : null;
  if (!st || typeof o.cert !== 'string' || typeof o.org !== 'string') return null;
  const s = (x: unknown) => (x == null ? '' : String(x));
  const sh = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : null);
  const out: TgoRec = {
    st, gid: typeof o.gid === 'number' && isFinite(o.gid) ? o.gid : null, by: s(o.by), at: s(o.at), note: s(o.note),
    cert: o.cert, act: s(o.act), org: o.org, branch: s(o.branch), prov: s(o.prov), apBE: s(o.apBE), exBE: s(o.exBE), ap: s(o.ap), ex: s(o.ex), fy: s(o.fy), id: s(o.id),
  };
  if (o.addr != null) Object.assign(out, { addr: s(o.addr), zip: s(o.zip), changwat: s(o.changwat), ind: s(o.ind), size: s(o.size), s1: sh(o.s1), s2: sh(o.s2), s3: sh(o.s3) });
  return out;
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

export function fromFeed(r: FeedRow): TgoItem {
  const s = (v: unknown) => String(v ?? '').trim();
  const cert = s(r.cert);
  const fm = /FY(\d\d)/i.exec(cert);
  const fy = s(r.fy) || (fm ? 'FY' + fm[1] : '');
  return {
    cert, act: s(r.act), org: s(r.org), branch: s(r.branch), prov: s(r.prov), apBE: s(r.apBE), exBE: s(r.exBE),
    ap: dateOf(r.ap) || dateOf(r.apBE), ex: dateOf(r.ex) || dateOf(r.exBE), fy, id: idOf(r.id),
    addr: s(r.addr), zip: s(r.zip), changwat: s(r.changwat), ind: s(r.ind), size: s(r.size), s1: shareOf(r.s1), s2: shareOf(r.s2), s3: shareOf(r.s3),
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
