/**
 * Team accounts (Code.gs v3): roles, what each may change, and the password key the browser sends.
 * The plain password never leaves the browser: it is stretched here with PBKDF2 (salted with the
 * team's public id and the username) and only that key goes to the team script, which keeps an HMAC
 * of it. The same write rule as here is enforced by the script (SALES_DENY / ADMIN_DEL in Code.gs).
 */
import type { Role } from './teamSync';

export const ROLE_TH: Record<Role, string> = { admin: 'ผู้ดูแลระบบ', sales: 'พนักงานขาย', viewer: 'ดูอย่างเดียว' };
export const ROLE_DESC: Record<Role, string> = {
  admin: 'ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้ ตั้งค่ารายการ ตรวจข้อมูลซ้ำ และลบข้อมูล',
  sales: 'เพิ่มและแก้ลูกค้า ดีล ผู้ติดต่อ นัด บันทึกการติดต่อ และแนบเอกสาร (ลบดีล/ลูกค้า/ผู้ติดต่อไม่ได้)',
  viewer: 'ดูได้ทุกหน้า และเปิดเอกสาร แต่แก้ไขไม่ได้',
};
export const ROLES: Role[] = ['admin', 'sales', 'viewer'];

/** Records a sales account can't write at all, and those it can't delete (same lists as Code.gs). */
export const SALES_DENY = ['scfg/', 'dedup/', 'team/', 'dundo/'];
export const ADMIN_DEL = ['deal/', 'cust/', 'person/'];

/** A change counts as a delete when it removes the record (an empty value is applied as one). */
export const isDel = (v: unknown, del?: boolean) => !!del || v === undefined || v === null;

/** May this role write record `k`? `null` = no accounts (team code or this browser only): anything. */
export function canWriteKey(role: Role | null, k: string, del: boolean) {
  if (role == null || role === 'admin') return true;
  if (role === 'viewer') return false;
  return !(SALES_DENY.some((p) => k.startsWith(p)) || (del && ADMIN_DEL.some((p) => k.startsWith(p))));
}
/** `edit`: change team data; `delete`: delete deals, customers and people; `admin`: lists, dedup,
 *  the team list, imports and accounts. */
export function can(role: Role | null, cap: 'edit' | 'delete' | 'admin') {
  if (role == null || role === 'admin') return true;
  return role === 'sales' && cap === 'edit';
}

/** Below this the browser refuses to send a password key (a script that asks for a weak hash). */
export const MIN_IT = import.meta.env?.MODE === 'production' ? 100000 : 1000;
export const USER_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const normUser = (u: string) => String(u || '').trim().toLowerCase();

const b64url = (buf: ArrayBuffer) => {
  let s = '';
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The key sent instead of the password: PBKDF2-HMAC-SHA256 over the password (NFC), salt
 *  "gcc-team|v1|<team id>|<username>", `it` rounds, 32 bytes, base64url without padding (43 chars). */
export async function derivePk(tid: string, it: number, u: string, pw: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้ารหัส — เปิดเว็บผ่าน https');
  if (!tid || !(it >= MIN_IT)) throw new Error('สคริปต์ของทีมตั้งค่าการเข้ารหัสไม่ถูกต้อง — ให้หัวหน้าทีมอัปเดต Code.gs');
  const enc = new TextEncoder();
  const key = await subtle.importKey('raw', enc.encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`gcc-team|v1|${tid}|${normUser(u)}`), iterations: it }, key, 256);
  return b64url(bits);
}

const WEAK = ['12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', '11111111', '00000000', 'gcc12345', 'abcd1234'];
/** The checklist under a new password: long enough, not guessable (a common one, the username or
 *  the name), and both fields the same. */
export function passwordChecks(pw: string, u: string, name: string, confirm: string) {
  const p = pw.trim().toLowerCase();
  const bad = [...WEAK, normUser(u), name.trim().toLowerCase()].filter(Boolean);
  return { len: pw.length >= 8, notGuessable: !!p && !bad.includes(p), match: !!pw && pw === confirm };
}

/** A temporary password for a new account or a reset: 10 easy-to-read characters, as xxxx-xxxx-xx
 *  (the dashes are part of it). Made in the admin's browser; only its key goes to the script. */
export function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = new Uint32Array(10);
  crypto.getRandomValues(r);
  const s = Array.from(r, (x) => A[x % A.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
