export const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const DAY = 864e5;

export const pad = (n: number | string) => String(n).padStart(2, '0');
export const fmtN = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

/** ISO date (YYYY-MM-DD) → "6 ต.ค. 2569" */
export const isoTh = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${+d} ${TH_M[+m - 1]} ${+y + 543}`;
};
/** ISO date → "6 ต.ค." (no year); day and month joined by a no-break space so they never part across lines */
export const dmTh = (s?: string | null) => {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${+d} ${TH_M[+m - 1]}`;
};
/** Whole days from ISO date `a` to `b` (negative when `b` is earlier). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5);
/** "YYYY-MM" → "ต.ค. YYYY" (year kept as given) */
export const ymTh = (s?: string | null) => {
  if (!s) return '';
  const [y, m] = s.split('-');
  return `${TH_M[+m - 1]} ${y}`;
};
export const money = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1e6 ? (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' ล้านบาท' : fmtN(n) + ' บาท';

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
};
export const dow = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay();
/** First Mon–Fri on or after the given date. */
export const nextWork = (d: string) => {
  while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
  return d;
};
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** tel: link for the first number in a "a | b", "a, b" or "a / b" list; an extension ("ต่อ 214", "ext 214",
 *  "#214") is dialled after a pause, not as part of the number. */
export const telHref = (p?: string | null) => {
  const first = String(p || '').split(/[|,/;]/)[0];
  const [num, ext] = first.split(/ต่อ|ext\.?|#|x(?=\s*\d)/i);
  const m = num.replace(/[^\d+]/g, '');
  const x = (ext || '').replace(/\D/g, '');
  return m ? 'tel:' + m + (x ? ',' + x : '') : '';
};
/** ISO timestamp → its date (YYYY-MM-DD) in local time (a UTC slice is the day before until 07:00 in Thailand). */
export const localDay = (iso: string) => {
  if (/^\d{4}-\d\d-\d\d$/.test(iso || '')) return iso; // already a day
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso || '').slice(0, 10) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** ISO timestamp → "6 ต.ค. 2569 14:05 น." in local time */
export const dtTh = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())} น.`;
};
/** Code shown for a company row: GCC-000123 (registry), TGO-45 (from the TGO website sync, this
 *  device only), NEW-… (added by hand; ids from 1e12, see teamSync CUSTOM_ID_MIN). */
export const gccCode = (id: number) => (id >= 1e12 ? 'NEW-' + (id - 1e12).toString(36).toUpperCase() : id >= 900000 ? 'TGO-' + (id - 900000) : 'GCC-' + String(id).padStart(6, '0'));
let uidN = 0;
/** Short unique id; the counter keeps ids made in the same millisecond (bulk task plans) apart. */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (++uidN).toString(36);

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  // attached to the document so every browser honours the `download` file name
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
