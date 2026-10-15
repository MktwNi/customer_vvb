/** @OnlyCurrentDoc */
/**
 * GCC Registry — ที่เก็บข้อมูลทีม (Google Apps Script + Google Sheet)
 *
 * ใช้คู่กับเว็บ GCC Registry: ดาว สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ ข้อมูลติดต่อที่แก้
 * รายชื่อทีม และผลตรวจข้อมูลซ้ำ จะถูกส่งมาเก็บในชีต "sync" ของไฟล์ Google Sheet นี้
 * และทุกเครื่องจะดึงไปแสดงเหมือนกัน ส่วนไฟล์แนบ (ใบเสนอราคา / ใบแจ้งหนี้) เก็บในโฟลเดอร์
 * "GCC Sales Tracker — เอกสาร" ใน Google Drive ของเจ้าของสคริปต์
 *
 * วิธีติดตั้ง: ดู team-sync/README.md ใน repo
 * อัปเดตจากเวอร์ชันก่อน: คัดลอกบรรทัด TEAM_KEY เดิมเก็บไว้ วางโค้ดนี้แทนทั้งไฟล์ แล้วใส่บรรทัดนั้นกลับ
 * กด Run "setup" (รับรหัสตั้งค่าผู้ดูแลระบบใน Execution log) แล้ว Deploy → Manage deployments → Edit
 * → Version: New version (ดู README หัวข้อ "เปิดใช้บัญชีผู้ใช้")
 *
 * Protocol v4 (POST, body = JSON text, Content-Type: text/plain to avoid a CORS preflight).
 * The web app sends `cv: 4` with every request (builds before the capabilities sent `cv: 3`). A team
 * works in one of three modes (see hello):
 *   legacy   — no accounts yet and TEAM_KEY is set: every request carries `key` (the team code), as in v2
 *   setup    — no accounts and no TEAM_KEY: only hello and claim work
 *   accounts — at least one account exists: requests carry `tok` (a session token); TEAM_KEY grants nothing
 *
 * Public (no key or token):
 *   { action: 'hello' }                          -> { ok, app: 'gcc-team-sync', v: 4, files: true, mode, tid, it }
 *   { action: 'login', u, pk, rm }               -> { ok, tok, exp, me, mc }   (me: see "me" below)
 *   { action: 'claim', code, u, name?, pk, rm }  -> same as login (first admin, or admin recovery)
 *     pk = base64url, no padding, of PBKDF2-HMAC-SHA256(NFC(password), salt 'gcc-team|v1|' + tid + '|' + u,
 *     `it` iterations, 32 bytes), computed in the browser: the password itself never reaches this script.
 *     rm = "remember me": the token lasts 30 days and is renewed while in use (otherwise 12 hours).
 *     code = the one-time 8-digit code setup() prints. With no accounts it creates the first admin
 *     (name = display name); when `u` exists it resets that account to an active admin (name ignored).
 *     With accounts, an unknown `u` and a name add another admin; without a name (recovery) the answer
 *     is unknown_user. setup() also prints the admins' usernames.
 * Token (accounts mode):
 *   { action: 'me', tok }                        -> { ok, me, mc }
 *   { action: 'passwd', tok, old, pk, rm? }      -> { ok, tok, exp, me }   (other devices are signed out)
 *   { action: 'logout', tok, all? }              -> { ok }                 (all: every device is signed out)
 *   { action: 'req_send', tok, k: 'role'|'caps', role?, caps?: [{ k, s? }], note, until? } -> { ok }  any account
 *   { action: 'req_cancel', tok } / { action: 'req_ack', tok }  -> { ok }   (withdraw one's request / hide its result)
 * Token, set.users (an admin):
 *   { action: 'users', tok }                     -> { ok, users: [{ u, name, role, on, mc, ll, c, locked }],
 *                                                     roles, grants, reqs, audit }
 *   { action: 'user_save', tok, u, create?, name?, role?, on?, pk?, unlock?, kick? } -> { ok, user }
 *   { action: 'role_save', tok, id?, n, d?, c?, from?, o? }  -> { ok, id, roles, grants, reqs }
 *   { action: 'role_del', tok, id, to? }         -> { ok, roles, grants, reqs }   (members and grants move to `to`)
 *   { action: 'grant_save', tok, u, c: [{ k, s?, until? }] } / { action: 'grant_del', tok, u, k } -> { ok, roles, grants, reqs }
 *   { action: 'req_decide', tok, u, ok, note?, id? } -> { ok, roles, grants, reqs }
 *     roles  = { <id>: { n, d, c, o, at?, by?, bi?: 1 } } every role, built-ins (bi) included; admin's c is everything
 *     grants = GRANTS, reqs = REQS (see "Script Properties" below); audit = the last 50 rows, newest first:
 *              [{ at, actor, u, action, detail, note }]
 * Team code (legacy mode) or token (accounts mode):
 *   { action: 'ping', key }                     -> { ok, seq, files: true }
 *   { action: 'pull', key, since, limit? }      -> { ok, seq, rows: Row[], more }
 *   { action: 'push', key, ops: Op[] }          -> { ok, seq, n, rejected: string[] }   (+ denied: string[] with tok)
 *   { action: 'upload', key, docId, name, mime, data }  -> { ok, fileId, size }   (data = base64)
 *   { action: 'file', key, fileId }             -> { ok, name, mime, size, data }
 *   { action: 'delfile', key, fileId }          -> { ok }   (moves the file to the owner's Drive trash)
 *   Op  = { k: string, v?: any, del?: boolean, by?: string }
 *   Row = { seq: number, k: string, v: any, del: boolean, by: string, at: string }
 *   With a token, `by` is always the account's display name (the op's by is ignored), every reply adds
 *   me, and a remembered session with fewer than 15 days left also gets a new tok + exp.
 * me = { u, name, role, rid, rn, caps, rq?, req? }: rid = the role in effect (a temporary role while it
 *   lasts), rn = its name, caps = { <capability>: 1 | 'own' } (1 = all work, 'own' = the account's own work;
 *   only what it holds), role = 'admin' | 'sales' | 'viewer' for builds before capabilities (admin = set.users,
 *   sales = any write, else viewer), rq = requests waiting (set.users holders only), req = the account's own
 *   pending request { st: 'p', id, k, role?, caps?, note, until?, at } or its unread result
 *   { st: 'r', ok, by, note, at, k, role?, caps?, until? }.
 * Capabilities (CAPS_, the same catalogue as the web app's lib/caps.ts): what a key needs is in KEY_CAP
 * (default deny: an unknown prefix needs set.users, qchk/ is never pushed). A refused op is listed in
 * `denied` and never stored. push needs a write capability, upload and delfile docs.up, file docs.open.
 * Accounts without set.users get by = their name in log/, dlog/, dact/ values, and by + at = their name
 * and the time in dchk/ and mclose/. pull strips money without view.money and commission without view.comm.
 * A token request from an older build (cv < 4) may still read, but push, upload and delfile answer
 * 'มีเวอร์ชันใหม่ กรุณารีเฟรชหน้าเว็บ (F5)', which those builds show as is (their queue is kept).
 *   Errors: { ok: false, error: 'unauthorized' | 'no_team_key' | 'busy' | 'bad_json' | 'unknown_action'
 *            | 'file_too_large' | 'bad_file_type' | 'empty_file' | 'not_found' | 'drive_permission'
 *            | 'login_required' | 'session_expired' | 'account_disabled' | 'must_change_password' | 'forbidden'
 *            | 'bad_login' | 'locked' (+ retryIn seconds) | 'too_many_attempts' | 'no_accounts' | 'bad_code'
 *            | 'bad_user' | 'bad_name' | 'bad_role' | 'bad_password_data' | 'wrong_password' | 'name_taken'
 *            | 'user_exists' | 'unknown_user' | 'too_many_users' | 'not_self' | 'last_admin' | 'name_locked'
 *            | 'role_in_use' | 'role_locked' | 'bad_cap' | 'cap_held' | 'too_many_roles' | 'req_note' | 'bad_until'
 *            | 'bad_req' | 'no_request' | 'changed' | 'too_many_grants' | 'too_many_reqs' | ... }
 *   A team-code request in accounts mode answers 'login_required' (or, without cv, a Thai sentence that
 *   older web apps show as is).
 * The sheet is an append-only log ordered by seq; a later row for the same key wins.
 * Superseded rows are compacted away automatically once the log grows.
 * `files: true` in ping tells the web app this version stores attachments (older ones omit it).
 * file / delfile only ever touch files inside the documents folder, never the rest of the Drive.
 * Accounts live in Script Properties (USERS: salted hashes of pk, never returned by any action), with
 * ROLES, GRANTS, REQS and RESULTS (see "capabilities and roles" below); the "audit" tab of this
 * spreadsheet records who changed roles, extras and requests.
 */

// ⬇⬇⬇ รหัสทีม (ไม่บังคับ) ทีมที่ซิงก์ด้วยรหัสทีมอยู่แล้ว: วางบรรทัด TEAM_KEY เดิมกลับตรงนี้ ทุกคนจะซิงก์ต่อได้
//     จนกว่าหัวหน้าทีมจะเปิดใช้บัญชีผู้ใช้ (หลังจากนั้นรหัสทีมใช้ไม่ได้อีก) — ทีมใหม่: เว้นว่างไว้ แล้วใช้บัญชีผู้ใช้
const TEAM_KEY = '';

const SHEET_NAME = 'sync';
const HEADER = ['seq', 'k', 'v', 'del', 'by', 'at'];
const MIN_KEY = 8;
const MAX_PULL = 3000;
const MAX_OPS = 1000;
const MAX_CELL = 45000; // Google Sheets limit is 50,000 characters per cell
const COMPACT_MIN_ROWS = 5000;
const SEQ_CACHE_S = 600; // seconds the last seq stays in the script cache (see curSeq_)
const DOC_FOLDER_NAME = 'GCC Sales Tracker — เอกสาร';
const MAX_FILE = 10 * 1024 * 1024; // bytes after decoding (base64 adds a third on the wire)
const DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

// accounts (protocol v3), capabilities (protocol v4)
const API_V = 4;
const CLIENT_V = 4; // web app builds before this one may read, but not write (see doPost)
const NEW_VERSION_MSG = 'มีเวอร์ชันใหม่ กรุณารีเฟรชหน้าเว็บ (F5)';
const KDF_ITER_DEFAULT = 200000; // PBKDF2 iterations the browser uses to turn a password into pk
const TOKEN_LONG_S = 2592000; // "remember me": 30 days, renewed while in use
const TOKEN_SHORT_S = 43200; // otherwise 12 hours, never renewed
const RENEW_BELOW_S = 1296000; // a remembered token with fewer than 15 days left is replaced
const MAX_USERS = 25;
const USERS_MAX_LEN = 8500; // characters of the USERS property (Script Properties hold 9 kB per value)
const AUTH_CACHE_S = 21600; // the user directory in the script cache (the cache's maximum, 6 hours)
const NONE_CACHE_S = 300; // the "no accounts yet" marker
const LOGIN_MAX_FAILS = 5; // wrong passwords for one username within LOGIN_WINDOW_S lock it for as long
const LOGIN_WINDOW_S = 900;
const TEAM_MAX_FAILS = 30; // more wrong passwords than this team-wide in 10-20 minutes stop all logins
const TEAM_WINDOW_S = 600;
const PW_LOCK_MS = 5000; // a password check waits this long for the user lock (see checkPw_), then answers busy
const CODE_TTL_MS = 86400000; // the setup / recovery code from setup() lasts 24 hours
const CODE_MAX_TRIES = 5;
const USER_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PK_RE = /^[A-Za-z0-9_-]{43}$/;
const DUMMY_SALT = 'gcc-no-such-user';
const OLD_CLIENT_MSG = 'ทีมเปลี่ยนเป็นระบบเข้าสู่ระบบแล้ว — รีเฟรชหน้าเว็บ (F5) แล้วเข้าสู่ระบบด้วยบัญชีของคุณ';

// capabilities and roles (protocol v4)
const TZ = 'Asia/Bangkok'; // the team's calendar: an extra "until 31 ต.ค." lasts through that day here
const MAX_ROLES = 10; // the three built-in roles count
const PROP_MAX_BYTES = 8500; // ROLES, GRANTS, REQS, RESULTS (Script Properties hold 9 kB per value)
const NOTE_MAX = 300;
const AUDIT_SHEET = 'audit';
const AUDIT_HEADER = ['at', 'actor', 'u', 'action', 'detail', 'note'];
const AUDIT_KEEP_MS = 365 * 86400000; // older audit rows are dropped on an admin's `users`
/**
 * The capability catalogue, the same as the web app's lib/caps.ts (a test compares the two).
 * g: v = ดูได้, e = แก้ไขได้, a = เข้าถึงและจัดการ. real: pull_ takes this data out for an account without
 * it. scope: may be given for the account's own work only ('own'). needs: dropped while that one is
 * missing. d: the built-in roles [admin, sales, viewer] (1 = all work, 'own' = own work, 0 = no).
 * set.users belongs to admin alone: it is never part of another role, an extra or a request.
 */
const CAPS_ = [
  { id: 'view.sales', g: 'v', th: 'ดู Sales Tracker และผู้ติดต่อ', d: [1, 1, 1] },
  { id: 'view.plan', g: 'v', th: 'ดูแผนติดต่อ', d: [1, 1, 1] },
  { id: 'view.money', g: 'v', th: 'ดูยอดเงิน', real: 1, d: [1, 1, 1] },
  { id: 'view.cash', g: 'v', th: 'ดู Cashflow', needs: 'view.money', d: [1, 1, 1] },
  { id: 'view.comm', g: 'v', th: 'ดูค่าคอมมิชชั่น / สัดส่วนรายได้', real: 1, needs: 'view.money', d: [1, 0, 0] },
  { id: 'docs.open', g: 'v', th: 'เปิดเอกสารแนบ', needs: 'view.money', d: [1, 1, 1] },
  { id: 'edit.cust', g: 'e', th: 'ลูกค้าและผู้ติดต่อ', d: [1, 1, 0] },
  { id: 'edit.deal', g: 'e', th: 'ดีลและขั้นตอน', scope: 1, needs: 'view.money', d: [1, 1, 0] },
  { id: 'edit.task', g: 'e', th: 'นัดหมาย', d: [1, 1, 0] },
  { id: 'edit.pay', g: 'e', th: 'แผนชำระเงินและการรับเงิน', scope: 1, needs: 'view.money', d: [1, 1, 0] },
  { id: 'docs.up', g: 'e', th: 'แนบเอกสาร', needs: 'view.money', d: [1, 1, 0] },
  { id: 'edit.ctag', g: 'e', th: 'ติดประเภทลูกค้า', d: [1, 1, 0] },
  { id: 'edit.jqt', g: 'e', th: 'สร้างใบเสนอราคาร่วม', needs: 'view.money', d: [1, 1, 0] },
  { id: 'edit.share', g: 'e', th: 'แก้สัดส่วน % ของงาน', needs: 'view.comm', d: [1, 0, 0] },
  { id: 'del.rec', g: 'e', th: 'ลบดีล ลูกค้า และผู้ติดต่อ', d: [1, 0, 0] },
  { id: 'del.log', g: 'e', th: 'ลบบันทึกการติดต่อ', scope: 1, d: [1, 'own', 0] },
  { id: 'qt.check', g: 'a', th: 'ตรวจ/อนุมัติใบเสนอราคา', needs: 'view.money', d: [1, 0, 0] },
  { id: 'pay.check', g: 'a', th: 'ตรวจยืนยันรับเงิน (บัญชี)', needs: 'view.cash', d: [1, 0, 0] },
  { id: 'notify.mail', g: 'a', th: 'รับอีเมลแจ้งเตือน', d: [1, 1, 0] },
  { id: 'set.lists', g: 'a', th: 'ตั้งค่ารายการ', d: [1, 0, 0] },
  { id: 'set.units', g: 'a', th: 'ตั้งค่าหน่วยงานและอัตราคอมมิชชั่น', needs: 'view.comm', d: [1, 0, 0] },
  { id: 'set.dedup', g: 'a', th: 'ตรวจข้อมูลซ้ำ', d: [1, 0, 0] },
  { id: 'set.data', g: 'a', th: 'นำเข้า ส่งออก และไฟล์สำรอง', d: [1, 0, 0] },
  { id: 'set.users', g: 'a', th: 'จัดการผู้ใช้และสิทธิ์', d: [1, 0, 0] },
];
/** The built-in roles: their ids are what USERS has always stored. admin is locked to everything. */
const BUILTIN_ROLES = [
  { id: 'admin', n: 'ผู้ดูแลระบบ', d: 'ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้และสิทธิ์' },
  { id: 'sales', n: 'พนักงานขาย', d: 'เพิ่มและแก้ลูกค้า ดีล นัดหมาย แผนชำระ และแนบเอกสาร ลบได้เฉพาะบันทึกของตัวเอง' },
  { id: 'viewer', n: 'ดูอย่างเดียว', d: 'ดูได้ทุกหน้า รวมยอดเงินและ Cashflow แก้ไขไม่ได้' },
];
/**
 * What writing (w) and deleting (d) a record needs, by key prefix; the first match wins. A capability id,
 * a list (any one of them), or '' = nobody (qchk/: only the qt_check action writes it). ow / od: when the
 * account holds that capability for its own work only, what makes the record its own: 'deal' = the
 * deal's resp (ผู้รับผิดชอบ) is the account's display name, before and after the change; 'resp' = the
 * resp of the deal in the key is; 'by' = the account wrote the key's latest row. `scfg/<name>` without a
 * dot needs set.lists. Any other key (an unknown prefix or scfg kind) needs set.users: default deny.
 * The web app's lib/caps.ts has the same table (a test compares the two).
 */
const KEY_CAP = [
  { p: 'qchk/', w: '', d: '' },
  { p: 'stage/', w: 'edit.cust', d: 'edit.cust' },
  { p: 'owner/', w: 'edit.cust', d: 'edit.cust' },
  { p: 'watch/', w: 'edit.cust', d: 'edit.cust' },
  { p: 'contact/', w: 'edit.cust', d: 'edit.cust' },
  { p: 'cust/', w: 'edit.cust', d: 'del.rec' },
  { p: 'person/', w: 'edit.cust', d: 'del.rec' },
  { p: 'log/', w: 'edit.cust', d: 'del.log', od: 'by' },
  { p: 'task/', w: 'edit.task', d: 'edit.task' },
  { p: 'deal/', w: 'edit.deal', d: 'del.rec', ow: 'deal' },
  { p: 'dstep/', w: 'edit.deal', d: 'edit.deal', ow: 'resp', od: 'resp' },
  { p: 'dact/', w: 'edit.deal', d: 'del.log', ow: 'resp', od: 'by' },
  { p: 'dlog/', w: ['edit.deal', 'edit.pay', 'docs.up', 'edit.jqt', 'edit.share', 'pay.check'], d: 'set.users' },
  { p: 'ddoc/', w: 'docs.up', d: 'docs.up' },
  { p: 'dpay/', w: 'edit.pay', d: 'edit.pay', ow: 'resp', od: 'resp' },
  { p: 'ctag/', w: 'edit.ctag', d: 'edit.ctag' },
  { p: 'jqt/', w: 'edit.jqt', d: 'del.rec' },
  { p: 'jqm/', w: 'edit.jqt', d: 'edit.jqt' },
  { p: 'dshare/', w: 'edit.share', d: 'edit.share' },
  { p: 'ccol/', w: 'edit.cust', d: 'edit.cust' },
  { p: 'dchk/', w: 'pay.check', d: 'pay.check' },
  { p: 'mclose/', w: 'pay.check', d: 'pay.check' },
  { p: 'scfg/paychk.', w: 'set.users', d: 'set.users' },
  { p: 'scfg/notify.', w: 'set.users', d: 'set.users' },
  { p: 'scfg/unit.', w: 'set.units', d: 'set.units' },
  { p: 'scfg/unitm.', w: 'set.units', d: 'set.units' },
  { p: 'scfg/ct.', w: 'set.lists', d: 'set.lists' },
  { p: 'scfg/cc.', w: 'set.lists', d: 'set.lists' },
  { p: 'dedup/', w: 'set.dedup', d: 'set.dedup' },
  { p: 'team/', w: 'set.users', d: 'set.users' },
  { p: 'dundo/', w: 'set.data', d: 'set.data' },
];
/** Capabilities that write something by push: an account with none of them may not push at all. */
const WRITE_CAPS_ = KEY_CAP.reduce((a, r) => a.concat(r.w || [], r.d || []), ['set.users']).filter((c, i, a) => a.indexOf(c) === i);

// setup is the first function in the file, so the editor's Run button selects it by default.
/**
 * กด Run ฟังก์ชันนี้ครั้งแรก (และทุกครั้งที่อัปเดตโค้ด) เพื่ออนุญาตสิทธิ์ สร้างชีต "sync" และโฟลเดอร์เอกสาร
 * และรับรหัสตั้งค่าผู้ดูแลระบบ (หรือรหัสกู้คืน ถ้ามีบัญชีผู้ใช้แล้ว) ใน Execution log — ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง
 */
function setup() {
  if (TEAM_KEY && !keyOk_()) throw new Error('TEAM_KEY ต้องยาวอย่างน้อย ' + MIN_KEY + ' ตัวอักษร (หรือเว้นว่างไว้ถ้าใช้บัญชีผู้ใช้อย่างเดียว)');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('สคริปต์นี้ต้องสร้างจากไฟล์ Google Sheet: เปิดไฟล์ชีต → ส่วนขยาย (Extensions) → Apps Script แล้ววางโค้ดที่นั่น');
  sheet_();
  try {
    docFolder_(); // also proves the Drive permission was granted
  } catch (err) {
    if (drivePermission_(err)) throw err;
    // the stored folder id can't be opened at all (Drive answers with an "Unexpected error" rather
    // than "not found"): running setup is the owner's explicit fix, so start a new folder. Only here,
    // never on upload, where a brief Drive outage must not orphan every existing attachment.
    PropertiesService.getScriptProperties().deleteProperty('DOC_FOLDER');
    docFolder_();
  }
  // a fresh one-time code on every run, replacing the previous one: the lead claims the first admin
  // account with it, and later it is how an admin who forgot their password gets back in. Only people
  // who can open this script (the Sheet's owner and editors) ever see it.
  const code = withLock_(() => {
    ensureAuthProps_();
    return newOwnerCode_();
  });
  const msg = 'พร้อมใช้งาน: สร้างชีต "' + SHEET_NAME + '" และโฟลเดอร์ "' + DOC_FOLDER_NAME + '" ใน Google Drive แล้ว ขั้นต่อไปคือ Deploy เป็น Web app';
  const db = readUsers_();
  const codeMsg = (hasUsers_(db) ? 'รหัสกู้คืนผู้ดูแลระบบ (ใช้เมื่อลืมรหัสผ่าน): ' : 'รหัสตั้งค่าผู้ดูแลระบบ: ') + code + ' (ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง)';
  // the usernames to recover, for a lead who no longer remembers theirs (whoever sees this log can
  // also read the accounts in Script Properties)
  const admins = Object.keys(db.users).filter((k) => db.users[k].r === 'admin');
  Logger.log(msg);
  if (admins.length) Logger.log('ชื่อผู้ใช้ผู้ดูแลระบบ: ' + admins.join(', '));
  Logger.log(codeMsg);
  try {
    ss.toast(codeMsg + '\n' + msg, 'GCC ข้อมูลทีม', 30); // shown in the open spreadsheet
  } catch (err) {
    /* no spreadsheet window open */
  }
}

function keyOk_() {
  return !!TEAM_KEY && String(TEAM_KEY).length >= MIN_KEY;
}

function doGet() {
  return json_({ ok: true, app: 'gcc-team-sync', hint: 'use POST' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  try {
    const action = typeof req.action === 'string' ? req.action : '';
    // public: no key or token
    if (action === 'hello') return json_(hello_());
    if (action === 'login') return json_(login_(req));
    if (action === 'claim') return json_(claim_(req));
    let A = auth_(false);
    let actor;
    if (req.tok) {
      // the cached directory can still say "no accounts" for a moment after the first claim
      if (A.m !== 'accounts') A = auth_(true);
      if (A.m !== 'accounts') return json_({ ok: false, error: 'session_expired' });
      actor = actor_(A, String(req.tok));
      if (actor.err) return json_({ ok: false, error: actor.err });
    } else {
      // once an account exists the team code grants nothing; an old web app (no cv) shows this text as is
      if (A.m === 'accounts') return json_({ ok: false, error: req.cv ? 'login_required' : OLD_CLIENT_MSG });
      if (!keyOk_()) return json_({ ok: false, error: 'no_team_key' });
      if (req.key !== TEAM_KEY) return json_({ ok: false, error: 'unauthorized' });
      actor = { legacy: true };
    }
    if (!actor.legacy && actor.mc && ['me', 'passwd', 'logout'].indexOf(action) < 0) return reply_(actor, { ok: false, error: 'must_change_password' });
    const acct = account_(action, req, actor); // null for the actions below
    if (acct) return acct;
    if (!actor.legacy) {
      // a tab still open on a build from before the capabilities may read, but not write: it would
      // send records shaped by the old rules (its queue is kept, and sent again after a refresh)
      if (['push', 'upload', 'delfile'].indexOf(action) >= 0 && !(Number(req.cv) >= CLIENT_V)) return reply_(actor, { ok: false, error: NEW_VERSION_MSG });
      // what the account's capabilities allow, checked here and not inside the cases below (the file
      // cases stay one block); each op of a push is checked again by its key in push_
      const need = action === 'push' ? WRITE_CAPS_ : action === 'upload' || action === 'delfile' ? ['docs.up'] : action === 'file' ? ['docs.open'] : null;
      if (need && !need.some((c) => actor.caps[c])) return reply_(actor, { ok: false, error: 'forbidden' });
    }
    switch (action) {
      case 'ping':
        // only creating / repairing the sheet needs the lock; a ready sheet is just read
        if (!sheetReady_()) withLock_(() => sheet_());
        return reply_(actor, { ok: true, seq: cachedSeq_() ?? seq_(), files: true });
      case 'pull':
        return reply_(actor, pull_(Number(req.since) || 0, Math.min(Number(req.limit) || MAX_PULL, MAX_PULL), actor));
      case 'push':
        return reply_(actor, push_(req.ops || [], actor));
      // the three file actions stay together, right before default: teamFiles.test.ts cuts them out as
      // one block to build a script from before attachments
      case 'upload':
        return reply_(actor, upload_(req));
      case 'file':
        return reply_(actor, file_(req.fileId));
      case 'delfile':
        return reply_(actor, delFile_(req.fileId));
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    if (err && err.busy) return json_({ ok: false, error: 'busy' });
    if (err && err.gcc) return json_({ ok: false, error: err.gcc }); // e.g. too_many_users from saveUsers_
    // code updated and deployed without running setup again to allow Google Drive access
    if (drivePermission_(err)) return json_({ ok: false, error: 'drive_permission' });
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Run fn under the script lock; spreadsheet writes are flushed before the lock is released. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    const e = new Error('busy');
    e.busy = true;
    throw e;
  }
  try {
    const out = fn();
    SpreadsheetApp.flush();
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** The "sync" sheet; creates it (6 columns, header row) or repairs a missing header. */
function sheetReady_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  return !!sh && String(sh.getRange(1, 1).getValue()) === 'seq';
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    // keep only the 6 columns we use so rows don't count 26 cells each toward the file's cell limit
    if (sh.getMaxColumns() > HEADER.length) sh.deleteColumns(HEADER.length + 1, sh.getMaxColumns() - HEADER.length);
  }
  if (String(sh.getRange(1, 1).getValue()) !== 'seq') {
    if (sh.getLastRow() > 0) sh.insertRowsBefore(1, 1);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function seq_() {
  return Number(PropertiesService.getScriptProperties().getProperty('SEQ') || 0);
}

/**
 * The last seq, for the check every poll makes ("anything new?"). Read from the script cache so idle
 * polls use none of the daily Properties quota; push_ writes it there, under the lock, before the rows.
 * When the cache has lost it, it is read from Properties and put back only while holding the lock (no
 * push can be halfway) — taken without waiting, so a poll never queues behind a push for this.
 */
function curSeq_() {
  const c = cachedSeq_();
  if (c != null) return c;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return seq_();
  try {
    return lockedSeq_();
  } finally {
    lock.releaseLock();
  }
}

/** The last seq while holding the script lock (puts it back in the cache if it was lost). */
function lockedSeq_() {
  const c = cachedSeq_();
  if (c != null) return c;
  const s = seq_();
  try {
    CacheService.getScriptCache().put('SEQ', String(s), SEQ_CACHE_S);
  } catch (err) {
    // the cache is only a shortcut
  }
  return s;
}

function cachedSeq_() {
  try {
    const v = CacheService.getScriptCache().get('SEQ');
    return v != null && v !== '' ? Number(v) : null;
  } catch (err) {
    return null;
  }
}

function rowOut_(r) {
  let v = null;
  try {
    v = r[2] === '' || r[2] == null ? null : JSON.parse(r[2]);
  } catch (err) {
    v = null;
  }
  return { seq: Number(r[0]), k: String(r[1]), v: v, del: r[3] === 1 || r[3] === true || r[3] === '1', by: String(r[4] || ''), at: String(r[5] || '') };
}

/**
 * Rows with seq > since, oldest first (rows are stored in ascending seq order). For an account,
 * what its capabilities may not see is taken out of each row (redact_); the rows themselves and
 * their seq stay, so the reader's position in the log is the same for every account.
 */
function pull_(since, limit, actor) {
  const out = pullRows_(since, limit);
  if (actor && !actor.legacy && out.rows.length && (!actor.caps['view.money'] || !actor.caps['view.comm'])) out.rows = out.rows.map((r) => redact_(r, actor.caps));
  return out;
}

function pullRows_(since, limit) {
  const cur = curSeq_();
  if (since >= cur) return { ok: true, seq: cur, rows: [], more: false };
  // read under the lock so a concurrent append/compaction can't shift rows mid-read
  return withLock_(() => {
    const sh = sheet_();
    const last = sh.getLastRow();
    const now = lockedSeq_(); // already holding the lock
    if (last < 2) return { ok: true, seq: now, rows: [], more: false };
    const seqs = sh.getRange(2, 1, last - 1, 1).getValues();
    // linear scan: tolerant of stray blank rows (Number('') would break a binary search)
    let lo = 0;
    while (lo < seqs.length && !(Number(seqs[lo][0]) > since)) lo++;
    if (lo >= seqs.length) return { ok: true, seq: now, rows: [], more: false };
    const n = Math.min(limit, seqs.length - lo);
    const vals = sh.getRange(2 + lo, 1, n, HEADER.length).getValues();
    const rows = vals.filter((r) => r[1] !== '' && Number(r[0]) > since).map(rowOut_);
    return { ok: true, seq: now, rows: rows, more: lo + n < seqs.length };
  });
}

/**
 * Append ops as rows. `actor` is { legacy: true } for the team code, else the signed-in account, whose
 * capabilities decide op by op (KEY_CAP): a refused op is listed in `denied`, never stored, and uses no seq.
 */
function push_(ops, actor) {
  if (!Array.isArray(ops)) return { ok: false, error: 'bad_ops' };
  if (ops.length > MAX_OPS) return { ok: false, error: 'too_many_ops' };
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    // the lead claimed the first account while this team-code push waited for the lock
    if (actor.legacy && hasUsers_(readUsers_())) return { ok: false, error: 'login_required' };
    let seq = Number(props.getProperty('SEQ') || 0);
    const now = new Date().toISOString();
    const caps = actor.legacy ? null : actor.caps;
    // accounts other than admins write log entries and checks in their own name, checks also at this time
    const stamp = !!caps && !caps['set.users'];
    const list = ops.map((op) => {
      op = op || {};
      const del = !!op.del;
      // the web app applies a row without a value as a deletion
      return { op: op, k: String(op.k || ''), del: del, delR: del || op.v === undefined || op.v === null };
    });
    const allowed = caps ? opGate_(list, caps, actor.name) : null;
    const rows = [];
    const rejected = [];
    const denied = [];
    const stored = {}; // keys this push stores
    const shares = []; // dshare/<id> of the deals this push deletes
    for (let i = 0; i < list.length; i++) {
      const x = list[i], op = x.op, k = x.k, del = x.del, delR = x.delR;
      if (!k || k.length > 500) continue;
      if (allowed ? !allowed(x) : k.indexOf('qchk/') === 0) {
        // not stored and uses no seq (qchk/ is written only by the qt_check action, also for the team code)
        (allowed ? denied : rejected).push(k);
        continue;
      }
      let val = op.v;
      if (stamp && !delR && val && typeof val === 'object' && !Array.isArray(val)) {
        // a contact-log entry (company log, deal history, a deal's contact record) always carries the
        // writer's own name (key order kept); a payment check or a month close also the server's time
        if (/^(d?log|dact)\//.test(k) && Object.prototype.hasOwnProperty.call(val, 'by')) val = Object.assign({}, val, { by: actor.name });
        else if (/^(dchk|mclose)\//.test(k)) val = Object.assign({}, val, { by: actor.name, at: now });
      }
      const v = del || val === undefined ? '' : JSON.stringify(val);
      if (v.length > MAX_CELL) {
        rejected.push(k); // never store a placeholder other browsers would apply as data
        continue;
      }
      if (allowed) allowed.done(x, val);
      seq++;
      // with a token the row's author is the account, whatever the op says
      rows.push([String(seq), k, v, del ? '1' : '0', String(actor.legacy ? op.by || '' : actor.name).slice(0, 100), now]);
      stored[k] = 1;
      if (caps && delR && k.indexOf('deal/') === 0) shares.push('dshare/' + k.slice(5));
    }
    // a deleted deal takes its revenue split along: an account without view.comm never received that
    // row, so its browser can't delete it (team-code pushes stay as they always were)
    shares.forEach((k) => {
      if (stored[k] || k.length > 500) return;
      stored[k] = 1;
      seq++;
      rows.push([String(seq), k, '', '1', String(actor.name).slice(0, 100), now]);
    });
    if (rows.length) {
      const sh = sheet_();
      const start = sh.getLastRow() + 1;
      const need = start + rows.length - 1 - sh.getMaxRows();
      if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need); // getRange does not grow the sheet
      // the new last seq is saved before the rows: if writing them fails, those numbers are just
      // skipped, never handed out again (a reader that saw the rows would miss the next ones)
      CacheService.getScriptCache().put('SEQ', String(seq), SEQ_CACHE_S);
      props.setProperty('SEQ', String(seq));
      const rng = sh.getRange(start, 1, rows.length, HEADER.length);
      // plain text so Sheets never reinterprets keys/JSON (e.g. as dates or numbers)
      rng.setNumberFormat('@');
      rng.setValues(rows);
      try {
        compact_(sh, props);
      } catch (err) {
        // only tidying: the rows are saved, so the push succeeded (the next push tries again)
      }
    }
    const out = { ok: true, seq: seq, n: rows.length, rejected: rejected };
    if (!actor.legacy) out.denied = denied;
    return out;
  });
}

/**
 * Drop rows superseded by a later row for the same key (keeps seq order). Only reads the whole
 * sheet once it has grown past the stored threshold (3× the live keys after the last check).
 */
function compact_(sh, props) {
  const last = sh.getLastRow();
  const at = Number(props.getProperty('COMPACT_AT') || COMPACT_MIN_ROWS);
  if (last - 1 < at) return;
  const vals = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
  const latest = {};
  for (let i = 0; i < vals.length; i++) if (vals[i][1] !== '') latest[vals[i][1]] = i;
  const keep = vals.filter((r, i) => r[1] !== '' && latest[r[1]] === i);
  props.setProperty('COMPACT_AT', String(Math.max(COMPACT_MIN_ROWS, 3 * keep.length)));
  if (keep.length > vals.length / 3) return; // not worth rewriting yet
  // one write over the old rows (kept rows, then blanks): if Sheets fails partway nothing is lost —
  // a separate clear followed by a failed write would leave the team's sheet empty
  const out = keep.map((r) => r.map(String));
  while (out.length < vals.length) out.push(['', '', '', '', '', '']);
  const rng = sh.getRange(2, 1, vals.length, HEADER.length);
  rng.setNumberFormat('@');
  rng.setValues(out);
}

// ------------------------------------------------------------------ accounts (sign-in and roles)
//
// Script Properties (never part of any reply):
//   USERS       {"users":{"<u>":{n,r,on,sv,s,h,mc,c,ll}}}: display name, role, active 1|0, session version,
//               salt, h = HMAC-SHA256(key = salt, value = pk), must change password 1|0, created, last login
//   AUTH_SECRET signs session tokens;  TEAM_ID public id in the pk salt;  KDF_ITER iterations for pk
//   OWNER_CODE  {h: sha256 hex of the 8 digits, exp, n: wrong tries} from setup()
// Script cache: AUTHC = the directory without salts and hashes (or a "no accounts" marker), so polling
// reads no Properties; LF:<u> / LK:<u> / LG:<bucket> = wrong-password counters and lockouts, checked
// and counted only under the user lock (checkPw_), which nothing else takes.

/** Public: what this script is, the team's mode, and what the browser needs to derive pk. */
function hello_() {
  const A = auth_(false);
  let tid = A.tid, it = A.it;
  if (A.m !== 'accounts') {
    const props = PropertiesService.getScriptProperties();
    let p = props.getProperties();
    if (!p.TEAM_ID || !p.KDF_ITER || !p.AUTH_SECRET) {
      withLock_(() => ensureAuthProps_());
      p = props.getProperties();
    }
    tid = p.TEAM_ID;
    it = Number(p.KDF_ITER || KDF_ITER_DEFAULT);
  }
  return { ok: true, app: 'gcc-team-sync', v: API_V, files: true, mode: mode_(A), tid: tid, it: it };
}

/** Public: username + pk → a session token. A wrong password never takes the script lock or writes Properties. */
function login_(req) {
  const u = normUser_(req.u), pk = String(req.pk || ''), rm = !!req.rm;
  // while blocked, answered from the cache alone (checkPw_ checks again under its lock)
  if (teamBlocked_()) return { ok: false, error: 'too_many_attempts' };
  const left = lockLeft_(u);
  if (left) return { ok: false, error: 'locked', retryIn: left };
  const p = PropertiesService.getScriptProperties().getProperties();
  const db = usersOf_(p);
  if (!hasUsers_(db)) return { ok: false, error: 'no_accounts' };
  const x = USER_RE.test(u) && PK_RE.test(pk) ? own_(db.users, u) : null;
  // an unknown username costs the same work as a wrong password and gets the same answer
  const bad = checkPw_(u, true, () => (x ? eq_(hash_(pk, x.s), x.h) : (hash_(pk.slice(0, 64) || 'x', DUMMY_SALT), false)));
  if (bad && bad.error !== 'wrong') return bad;
  if (bad) return bad.retryIn ? { ok: false, error: 'locked', retryIn: bad.retryIn } : { ok: false, error: 'bad_login' };
  if (x.on !== 1) return { ok: false, error: 'account_disabled' };
  const y = withLock_(() => {
    const d = readUsers_();
    const z = own_(d.users, u);
    // the password was checked against a copy read before the lock: a password change, recovery or
    // reset saved meanwhile has replaced it, and an account disabled meanwhile gets no token either
    // (one signed with the sv after the disable would work again once the account is re-enabled)
    if (!z || z.s !== x.s || z.h !== x.h) return { err: 'bad_login' };
    if (z.on !== 1) return { err: 'account_disabled' };
    z.ll = new Date().toISOString();
    saveUsers_(d);
    return z;
  });
  if (y.err) return { ok: false, error: y.err };
  clearFails_(u);
  const t = tok_(p.AUTH_SECRET, u, y.sv, rm);
  return { ok: true, tok: t.tok, exp: t.exp, me: meOf_(u, whoOf_(auth_(false), u)), mc: !!y.mc };
}

/**
 * Public: the one-time code from setup() → an admin account. With no accounts it creates the first
 * admin; otherwise it resets `u` to an active admin with the new password (recovery), or adds a new
 * admin when `u` does not exist. The code is used up only by a successful claim.
 */
function claim_(req) {
  const u = normUser_(req.u), pk = String(req.pk || ''), rm = !!req.rm;
  // checked before the code, so a typo does not cost one of its tries
  if (!USER_RE.test(u)) return { ok: false, error: 'bad_user' };
  if (!PK_RE.test(pk)) return { ok: false, error: 'bad_password_data' };
  const digits = String(req.code == null ? '' : req.code).replace(/\D/g, '');
  // without a usable code (most of the time) a guess costs one read and never waits for the lock
  if (digits.length !== 8 || !ownerCode_()) return { ok: false, error: 'bad_code' };
  const r = withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    ensureAuthProps_();
    const oc = ownerCode_();
    if (!oc) return { err: 'bad_code' };
    if (!eq_(sha256hex_(digits), oc.h)) {
      oc.n = (Number(oc.n) || 0) + 1;
      if (oc.n >= CODE_MAX_TRIES) props.deleteProperty('OWNER_CODE');
      else props.setProperty('OWNER_CODE', JSON.stringify(oc));
      return { err: 'bad_code' };
    }
    // the right code: from here a refusal leaves it usable
    const db = readUsers_();
    const now = new Date().toISOString();
    let x = own_(db.users, u);
    if (x) {
      setPk_(x, pk);
      x.r = 'admin';
      x.on = 1;
      x.mc = 0;
      x.sv = (Number(x.sv) || 0) + 1; // signs out every device of this account
      x.ll = now;
    } else {
      // the recovery form sends no display name: there an unknown username is a typo, not a new admin
      // (only someone with the right code gets this far, so it tells nobody else which names exist)
      if (hasUsers_(db) && req.name == null) return { err: 'unknown_user' };
      const name = cleanDisplay_(req.name);
      if (!name) return { err: 'bad_name' };
      if (nameTaken_(db, name, '')) return { err: 'name_taken' };
      if (Object.keys(db.users).length >= MAX_USERS) return { err: 'too_many_users' };
      x = { n: name, r: 'admin', on: 1, sv: 1, s: '', h: '', mc: 0, c: now, ll: now };
      setPk_(x, pk);
      db.users[u] = x;
    }
    saveUsers_(db);
    props.deleteProperty('OWNER_CODE');
    return { x: x, sec: props.getProperty('AUTH_SECRET') };
  });
  if (r.err) return { ok: false, error: r.err };
  clearFails_(u);
  const t = tok_(r.sec, u, r.x.sv, rm);
  return { ok: true, tok: t.tok, exp: t.exp, me: meOf_(u, whoOf_(auth_(false), u)), mc: false };
}

// account actions every signed-in account may use / those that need set.users
const SELF_ACTIONS = ['me', 'passwd', 'logout', 'req_send', 'req_cancel', 'req_ack'];
const ADMIN_ACTIONS = ['users', 'user_save', 'role_save', 'role_del', 'grant_save', 'grant_del', 'req_decide'];

/** The account actions (sign-in, requests, users, roles and extras); null for any other action. */
function account_(action, req, actor) {
  if (SELF_ACTIONS.indexOf(action) < 0 && ADMIN_ACTIONS.indexOf(action) < 0) return null;
  if (actor.legacy) return json_({ ok: false, error: 'login_required' });
  if (action === 'me') return reply_(actor, { ok: true, mc: actor.mc });
  if (action === 'passwd') return json_(passwd_(req, actor));
  if (action === 'logout') {
    if (req.all) withLock_(() => bumpSv_(actor.u));
    return json_({ ok: true });
  }
  if (action === 'req_send') return replyNow_(actor, reqSend_(req, actor));
  if (action === 'req_cancel') return replyNow_(actor, reqDrop_(actor, 'REQS'));
  if (action === 'req_ack') return replyNow_(actor, reqDrop_(actor, 'RESULTS'));
  if (!actor.caps['set.users']) return reply_(actor, { ok: false, error: 'forbidden' });
  if (action === 'users') return reply_(actor, users_());
  if (action === 'user_save') {
    const r = userSave_(req, actor);
    // an admin who signed out their own sessions gets no renewed token
    return reply_(r.self && r.bumped ? Object.assign({}, actor, { rm: false }) : actor, r.out);
  }
  const fn = { role_save: roleSave_, role_del: roleDel_, grant_save: grantSave_, grant_del: grantDel_, req_decide: reqDecide_ }[action];
  return replyNow_(actor, fn(req, actor));
}

/** reply_ with `me` as the directory says right after this request's change (its request, its badge). */
function replyNow_(actor, o) {
  return reply_(Object.assign({}, actor, whoOf_(auth_(false), actor.u)), o);
}

/** Change one's own password (old and new as pk). Every other session of the account ends. */
function passwd_(req, actor) {
  const left = lockLeft_(actor.u);
  if (left) return { ok: false, error: 'locked', retryIn: left };
  const x = own_(readUsers_().users, actor.u);
  if (!x) return { ok: false, error: 'session_expired' };
  // counted like a wrong login, so a stolen session can't be used to guess the password
  const bad = checkPw_(actor.u, false, () => eq_(hash_(String(req.old || ''), x.s), x.h));
  if (bad) return bad.error === 'wrong' ? { ok: false, error: 'wrong_password' } : bad;
  const pk = String(req.pk || '');
  if (!PK_RE.test(pk)) return { ok: false, error: 'bad_password_data' };
  const sv = withLock_(() => {
    const db = readUsers_();
    const y = own_(db.users, actor.u);
    if (!y || y.sv !== actor.sv) return 0; // reset or signed out by an admin meanwhile
    setPk_(y, pk);
    y.mc = 0;
    y.sv = (Number(y.sv) || 0) + 1;
    saveUsers_(db);
    return y.sv;
  });
  if (!sv) return { ok: false, error: 'session_expired' };
  clearFails_(actor.u);
  const t = tok_(actor.sec, actor.u, sv, req.rm === undefined || req.rm === null ? actor.rm : !!req.rm);
  return { ok: true, tok: t.tok, exp: t.exp, me: meOf_(actor.u, actor) };
}

/**
 * Admin: every account (without salts or hashes; locked = seconds until a lockout ends, 0 = none), every
 * role, the extras, the waiting requests and the last 50 audit rows. Extras past their date are removed
 * here, each with an audit row, and so are audit rows older than a year.
 */
function users_() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperties();
  const today = today_();
  if (expired_(objProp_(p.GRANTS), today).length || auditOld_()) {
    withLock_(() => {
      const q = props.getProperties();
      const grants = objProp_(q.GRANTS);
      const gone = expired_(grants, today);
      if (gone.length) {
        gone.forEach((x) => {
          const g = grantOf_(grants, x.u);
          if (x.k === 'role') delete g.r;
          else g.c = g.c.filter((e) => e.k !== x.k);
          setGrant_(grants, x.u, g);
        });
        commit_({ GRANTS: JSON.stringify(grants) }); // only smaller
        audit_(gone.map((x) => ['', x.u, 'grant_expired', x.k === 'role' ? { role: x.id, until: x.until } : { k: x.k, until: x.until }, '']));
      }
      trimAudit_();
    });
    p = props.getProperties();
  }
  const db = usersOf_(p);
  const names = Object.keys(db.users);
  const lk = names.length ? CacheService.getScriptCache().getAll(names.map((u) => 'LK:' + ck_(u))) : {};
  return {
    ok: true,
    users: names.map((u) => Object.assign(pub_(u, db.users[u]), { locked: secsLeft_(lk['LK:' + ck_(u)]) })),
    roles: rolesView_(rolesOf_(p).roles),
    grants: objProp_(p.GRANTS),
    reqs: objProp_(p.REQS),
    audit: auditTail_(50),
  };
}

/** Admin: create an account (temporary password as pk, must change it) or change one. */
function userSave_(req, actor) {
  const u = normUser_(req.u);
  const has = (v) => v !== undefined && v !== null;
  const r = withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const db = usersOf_(p);
    const roles = rolesOf_(p).roles;
    let x = own_(db.users, u);
    if (req.create) {
      if (!USER_RE.test(u)) return { err: 'bad_user' };
      if (x) return { err: 'user_exists' };
      const name = cleanDisplay_(req.name);
      if (!name) return { err: 'bad_name' };
      if (nameTaken_(db, name, '')) return { err: 'name_taken' };
      if (!roleExists_(roles, req.role)) return { err: 'bad_role' };
      const pk = String(req.pk || '');
      if (!PK_RE.test(pk)) return { err: 'bad_password_data' };
      if (Object.keys(db.users).length >= MAX_USERS) return { err: 'too_many_users' };
      x = { n: name, r: req.role, on: 1, sv: 1, s: '', h: '', mc: 1, c: new Date().toISOString(), ll: '' };
      setPk_(x, pk);
      db.users[u] = x;
      saveUsers_(db);
      audit_([[actor.name, u, 'user_add', { role: req.role }, '']]);
      return { x: x, bumped: false, clear: true };
    }
    if (!x) return { err: 'unknown_user' };
    let role = x.r, on = x.on, name = x.n;
    if (has(req.role)) {
      if (!roleExists_(roles, req.role)) return { err: 'bad_role' };
      role = req.role;
    }
    if (has(req.on)) on = req.on === true || Number(req.on) === 1 ? 1 : 0;
    if (has(req.name)) {
      const n = cleanDisplay_(req.name);
      if (!n) return { err: 'bad_name' };
      if (n !== x.n) {
        // the display name is the identity in the team's data: fixed once the account was used
        if (x.ll) return { err: 'name_locked' };
        if (nameTaken_(db, n, u)) return { err: 'name_taken' };
        name = n;
      }
    }
    if (x.r === 'admin' && x.on === 1 && (role !== 'admin' || on !== 1) && activeAdmins_(db) <= 1) return { err: 'last_admin' };
    if (u === actor.u && (role !== x.r || on !== x.on)) return { err: 'not_self' };
    const pk = has(req.pk) ? String(req.pk) : '';
    if (has(req.pk) && !PK_RE.test(pk)) return { err: 'bad_password_data' };
    let bumped = false;
    if (on !== x.on && !on) bumped = true;
    const from = x.r;
    x.on = on;
    x.r = role;
    x.n = name;
    if (pk) {
      setPk_(x, pk); // a new temporary password, set by the admin's browser
      x.mc = 1;
      bumped = true;
    }
    if (req.kick) bumped = true;
    if (bumped) x.sv = (Number(x.sv) || 0) + 1;
    if (role === from) {
      saveUsers_(db);
      return { x: x, bumped: bumped, clear: !!pk || !!req.unlock };
    }
    // a role set by an admin replaces a temporary role from an approved request
    const grants = objProp_(p.GRANTS);
    const g = grantOf_(grants, u);
    const vals = { USERS: prepUsers_(db) };
    if (g.r) {
      delete g.r;
      setGrant_(grants, u, g);
      vals.GRANTS = JSON.stringify(grants); // only smaller
    }
    commit_(vals);
    audit_([[actor.name, u, 'user_role', { from: from, to: role }, '']]);
    return { x: x, bumped: bumped, clear: !!pk || !!req.unlock };
  });
  if (r.err) return { out: { ok: false, error: r.err } };
  if (r.clear) clearFails_(u);
  return { self: u === actor.u, bumped: r.bumped, out: { ok: true, user: Object.assign(pub_(u, r.x), { locked: lockLeft_(u) }) } };
}

/** Ends every session of `u` (caller holds the lock). */
function bumpSv_(u) {
  const db = readUsers_();
  const x = own_(db.users, u);
  if (!x) return;
  x.sv = (Number(x.sv) || 0) + 1;
  saveUsers_(db);
}

/**
 * The user directory: {m:'none'} without accounts, else {m:'accounts', sec, tid, it, u:{<u>:{n,r,on,sv,mc}}}.
 * Read from the script cache, so polling costs no Properties reads. After a cache miss the accounts
 * form is put back only while holding the lock (taken without waiting): every USERS write happens under
 * the lock and rewrites the cache, so a copy read before such a write can never overwrite it.
 */
function auth_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    let c = null;
    try {
      c = cache.get('AUTHC');
    } catch (err) {
      // the cache is only a shortcut
    }
    if (c) {
      try {
        return JSON.parse(c);
      } catch (err) {
        // rebuilt below
      }
    }
  }
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const db = usersOf_(all);
  if (!hasUsers_(db)) {
    putCache_('AUTHC', '{"m":"none"}', NONE_CACHE_S);
    return { m: 'none' };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return dirOf_(db, all);
  try {
    const p = props.getProperties();
    const d = dirOf_(usersOf_(p), p);
    putCache_('AUTHC', JSON.stringify(d), AUTH_CACHE_S);
    return d;
  } finally {
    lock.releaseLock();
  }
}

/**
 * The cached directory: the accounts (no salts or hashes) plus ROLES, GRANTS, REQS (rqs) and RESULTS
 * (res), so a request's capabilities, the admins' badge and an account's request need no Properties read.
 */
function dirOf_(db, p) {
  const u = {};
  Object.keys(db.users).forEach((k) => {
    const x = db.users[k];
    u[k] = { n: x.n, r: x.r, on: x.on, sv: x.sv, mc: x.mc };
  });
  if (!Object.keys(u).length) return { m: 'none' };
  return {
    m: 'accounts', sec: p.AUTH_SECRET, tid: p.TEAM_ID, it: Number(p.KDF_ITER || KDF_ITER_DEFAULT), u: u,
    roles: rolesOf_(p).roles, grants: objProp_(p.GRANTS), rqs: objProp_(p.REQS), res: objProp_(p.RESULTS),
  };
}

function mode_(A) {
  return A.m === 'accounts' ? 'accounts' : keyOk_() ? 'legacy' : 'setup';
}

function readUsers_() {
  return usersOf_({ USERS: PropertiesService.getScriptProperties().getProperty('USERS') });
}

function usersOf_(p) {
  const db = JSON.parse((p && p.USERS) || '{"users":{}}');
  if (!db.users || typeof db.users !== 'object') db.users = {};
  return db;
}

function hasUsers_(db) {
  return Object.keys(db.users).length > 0;
}

/** Save USERS (caller holds the lock) and rewrite the cached directory, so a change applies at once. */
function saveUsers_(db) {
  commit_({ USERS: prepUsers_(db) });
}

/** USERS as stored, refused (too_many_users) when it would not fit. */
function prepUsers_(db) {
  const s = JSON.stringify(db);
  if (s.length > USERS_MAX_LEN) throw gccError_('too_many_users');
  return s;
}

/** A JSON Script Property value, refused (the error `code`) when it would not fit. */
function prep_(o, code) {
  const s = JSON.stringify(o);
  if (bytes_(s) > PROP_MAX_BYTES) throw gccError_(code);
  return s;
}

/**
 * Write Script Properties prepared with prep_ / prepUsers_ (caller holds the lock), then rewrite the
 * cached directory once, so the change applies to the next request of every account. Returns them all.
 */
function commit_(vals) {
  const props = PropertiesService.getScriptProperties();
  Object.keys(vals).forEach((k) => props.setProperty(k, vals[k]));
  const p = props.getProperties();
  putCache_('AUTHC', JSON.stringify(dirOf_(usersOf_(p), p)), AUTH_CACHE_S);
  return p;
}

/** UTF-8 length of a string (what the Properties limit counts; a Thai character is 3 bytes). */
function bytes_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      n += 4; // a surrogate pair
      i++;
    } else n += 3;
  }
  return n;
}

/** A Script Property holding a JSON object; {} when missing or not an object. */
function objProp_(s) {
  try {
    const o = JSON.parse(s || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (err) {
    return {};
  }
}

/** Creates the team id, the pk iteration count and the token secret if missing (caller holds the lock). */
function ensureAuthProps_() {
  const props = PropertiesService.getScriptProperties();
  const p = props.getProperties();
  if (!p.TEAM_ID) props.setProperty('TEAM_ID', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  if (!p.KDF_ITER) props.setProperty('KDF_ITER', String(KDF_ITER_DEFAULT));
  if (!p.AUTH_SECRET) props.setProperty('AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
}

/** A session token: 'g1.' + base64url(JSON {u, sv, exp, rm}) + '.' + base64url(HMAC-SHA256 of that). */
function tok_(sec, u, sv, rm) {
  const exp = Date.now() + (rm ? TOKEN_LONG_S : TOKEN_SHORT_S) * 1000;
  const P = b64_(JSON.stringify({ u: u, sv: sv, exp: exp, rm: rm ? 1 : 0 }));
  return { tok: 'g1.' + P + '.' + sig_(P, sec), exp: exp };
}

function sig_(P, sec) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(P, sec));
}

/**
 * The account a token belongs to: {u, name, role, rid, rn, caps, rq?, req?, mc, rm, exp, sv, sec}, or
 * {err}. Name, role, capabilities and the active flag come from the directory, so a change applies on
 * the account's next request.
 */
function actor_(A, tok) {
  try {
    const parts = tok.split('.');
    if (parts.length !== 3 || parts[0] !== 'g1' || !eq_(sig_(parts[1], A.sec), parts[2])) return { err: 'session_expired' };
    const t = JSON.parse(unb64_(parts[1]));
    if (!(Number(t.exp) > Date.now())) return { err: 'session_expired' };
    const u = String(t.u);
    const x = own_(A.u, u);
    if (!x) return { err: 'session_expired' };
    if (x.on !== 1) return { err: 'account_disabled' };
    if (x.sv !== t.sv) return { err: 'session_expired' };
    return Object.assign({ u: u, mc: !!x.mc, rm: !!t.rm, exp: Number(t.exp), sv: x.sv, sec: A.sec }, whoOf_(A, u));
  } catch (err) {
    return { err: 'session_expired' };
  }
}

/** The JSON reply; for an account it adds me, and renews a remembered token that has under 15 days left. */
function reply_(actor, o) {
  if (actor && !actor.legacy) {
    o.me = meOf_(actor.u, actor);
    if (actor.rm && actor.exp - Date.now() < RENEW_BELOW_S * 1000) {
      const t = tok_(actor.sec, actor.u, actor.sv, true);
      o.tok = t.tok;
      o.exp = t.exp;
    }
  }
  return json_(o);
}

function hash_(pk, salt) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(pk, salt));
}

function setPk_(x, pk) {
  x.s = Utilities.getUuid();
  x.h = hash_(pk, x.s);
}

/** Compares two strings in time that does not depend on where they differ. */
function eq_(a, b) {
  a = String(a);
  b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return d === 0;
}

function b64_(s) {
  return Utilities.base64EncodeWebSafe(s);
}

function unb64_(s) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString();
}

function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
    .map((b) => ('0' + (b & 255).toString(16)).slice(-2))
    .join('');
}

function gccError_(code) {
  const e = new Error(code);
  e.gcc = code;
  return e;
}

function own_(o, k) {
  return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null;
}

function normUser_(s) {
  return String(s || '').trim().toLowerCase();
}

/** A display name: whitespace collapsed, 1-40 characters, no control characters; '' when not valid. */
function cleanDisplay_(s) {
  const n = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const len = Array.from(n).length;
  return len >= 1 && len <= 40 && !/[\u0000-\u001f\u007f]/.test(n) ? n : '';
}

function nameTaken_(db, n, exceptU) {
  const low = n.toLowerCase();
  return Object.keys(db.users).some((k) => k !== exceptU && String(db.users[k].n).toLowerCase() === low);
}

function pub_(u, x) {
  return { u: u, name: x.n, role: x.r, on: x.on, mc: !!x.mc, ll: x.ll || '', c: x.c || '' };
}

function activeAdmins_(db) {
  return Object.keys(db.users).filter((k) => db.users[k].r === 'admin' && db.users[k].on === 1).length;
}

function putCache_(k, v, ttl) {
  const cache = CacheService.getScriptCache();
  try {
    cache.put(k, v, ttl);
  } catch (err) {
    try {
      cache.remove(k); // never leave an older copy behind
    } catch (err2) {
      // the cache is only a shortcut
    }
  }
}

// Wrong passwords are counted in the script cache only: a failed login never takes the script lock or
// writes Properties, so guessing can't slow the team's syncing or use up the daily quota.

/**
 * Checks a password of `u` (right() → true when it matches) and counts it when wrong, as one step:
 * under the user lock, which only these checks take (the web app executes as its owner, so every
 * request shares it), requests sent at the same moment are checked and counted one after another,
 * and none gets past a lockout another has just set. Returns null when right, else {ok:false, error}:
 * too_many_attempts (`team` only), locked + retryIn, or wrong (+ retryIn when this one locked `u`).
 */
function checkPw_(u, team, right) {
  // a lock syncing never takes; where Apps Script gives none, counting stays best effort but sign-in works
  let lock = null;
  try {
    lock = LockService.getUserLock();
  } catch (err) {
    lock = null;
  }
  if (lock && !lock.tryLock(PW_LOCK_MS)) throw gccError_('busy');
  try {
    if (team && teamBlocked_()) return { ok: false, error: 'too_many_attempts' };
    const left = lockLeft_(u);
    if (left) return { ok: false, error: 'locked', retryIn: left };
    if (right()) return null;
    const lockedFor = failLogin_(u);
    return lockedFor ? { ok: false, error: 'wrong', retryIn: lockedFor } : { ok: false, error: 'wrong' };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** Cache key part for a username (any text a request sent; cache keys are limited to 250 characters). */
function ck_(u) {
  return String(u).slice(0, 64);
}

/** Counts a wrong password for `u` (caller holds the user lock); returns the lockout in seconds when this one locked it, else 0. */
function failLogin_(u) {
  const cache = CacheService.getScriptCache(), now = Date.now(), k = ck_(u);
  const g = 'LG:' + Math.floor(now / (TEAM_WINDOW_S * 1000));
  cache.put(g, String((Number(cache.get(g)) || 0) + 1), TEAM_WINDOW_S * 2);
  let f = null;
  try {
    f = JSON.parse(cache.get('LF:' + k) || 'null');
  } catch (err) {
    f = null;
  }
  if (!f || !(now - Number(f.t0) < LOGIN_WINDOW_S * 1000)) f = { n: 0, t0: now };
  f.n = (Number(f.n) || 0) + 1;
  if (f.n >= LOGIN_MAX_FAILS) {
    cache.put('LK:' + k, String(now + LOGIN_WINDOW_S * 1000), LOGIN_WINDOW_S);
    cache.remove('LF:' + k);
    return LOGIN_WINDOW_S;
  }
  cache.put('LF:' + k, JSON.stringify(f), LOGIN_WINDOW_S);
  return 0;
}

/** Seconds until the lockout of `u` ends, or 0. */
function lockLeft_(u) {
  return secsLeft_(CacheService.getScriptCache().get('LK:' + ck_(u)));
}

function secsLeft_(until) {
  const ms = Number(until) - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** More than TEAM_MAX_FAILS wrong passwords in this and the previous 10-minute window, team-wide. */
function teamBlocked_() {
  const b = Math.floor(Date.now() / (TEAM_WINDOW_S * 1000));
  const g = CacheService.getScriptCache().getAll(['LG:' + b, 'LG:' + (b - 1)]);
  return (Number(g['LG:' + b]) || 0) + (Number(g['LG:' + (b - 1)]) || 0) > TEAM_MAX_FAILS;
}

function clearFails_(u) {
  const cache = CacheService.getScriptCache(), k = ck_(u);
  cache.remove('LF:' + k);
  cache.remove('LK:' + k);
}

/** A new one-time 8-digit code (caller holds the lock); only its hash is stored. Returns '1234-5678'. */
function newOwnerCode_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  const digits = bytes.slice(0, 8).map((b) => (b & 255) % 10).join('');
  PropertiesService.getScriptProperties().setProperty('OWNER_CODE', JSON.stringify({ h: sha256hex_(digits), exp: Date.now() + CODE_TTL_MS, n: 0 }));
  return digits.slice(0, 4) + '-' + digits.slice(4);
}

/** The stored code if it can still be used (not expired, tries left), else null. */
function ownerCode_() {
  let oc = null;
  try {
    oc = JSON.parse(PropertiesService.getScriptProperties().getProperty('OWNER_CODE') || 'null');
  } catch (err) {
    oc = null;
  }
  return oc && oc.h && Number(oc.exp) > Date.now() && (Number(oc.n) || 0) < CODE_MAX_TRIES ? oc : null;
}

// ------------------------------------------------------------------ capabilities and roles
//
// Script Properties (all JSON; read through the cached directory, written only under the lock, and every
// write rewrites the cache):
//   ROLES   {v:1, roles:{<id>:{n, d, c:{<cap>:1|'own'}, o, at, by}}}: custom roles, and the built-ins
//           sales / viewer once an admin edited them (else their CAPS_ defaults). admin is always everything.
//   GRANTS  {<u>:{r?:{id, until, by, at}, c?:[{k, s:'all'|'own', until?, by, at}]}}: a temporary role from an
//           approved request (USERS keeps the account's own role) and extras for one account. until is a
//           yyyy-mm-dd in the team's time zone and counts through that day; a lapsed entry grants nothing
//           and is removed (with an audit row) on the next admin `users`.
//   REQS    {<u>:{id, k:'role'|'caps', role?, caps?:[{k, s}], note, until?, at}}: one pending request per account.
//   RESULTS {<u>:{ok, by, note, at, k, role?, caps?, until?}}: the decision the account has not hidden yet.

/** The catalogue entry of a capability, or null. */
function capDef_(id) {
  for (let i = 0; i < CAPS_.length; i++) if (CAPS_[i].id === id) return CAPS_[i];
  return null;
}

function builtinIx_(id) {
  for (let i = 0; i < BUILTIN_ROLES.length; i++) if (BUILTIN_ROLES[i].id === id) return i;
  return -1;
}

/** ROLES as stored: { v: 1, roles: {...} }. */
function rolesOf_(p) {
  const o = objProp_(p && p.ROLES);
  const roles = o.roles && typeof o.roles === 'object' && !Array.isArray(o.roles) ? o.roles : {};
  return { v: 1, roles: roles };
}

function roleExists_(roles, id) {
  return typeof id === 'string' && id !== '' && (builtinIx_(id) >= 0 || !!own_(roles, id));
}

function roleName_(roles, id) {
  const s = id === 'admin' ? null : own_(roles, id);
  if (s && s.n) return String(s.n);
  const i = builtinIx_(id);
  return i >= 0 ? BUILTIN_ROLES[i].n : '';
}

/** A role's capabilities { <cap>: 1 | 'own' }: admin everything, a stored role its own, a built-in its
 *  defaults, an unknown id nothing (default deny). set.users only ever with admin. */
function roleCaps_(roles, id) {
  const c = {};
  if (id === 'admin') {
    CAPS_.forEach((x) => (c[x.id] = 1));
    return c;
  }
  const s = own_(roles, id);
  const i = builtinIx_(id);
  if (s && s.c && typeof s.c === 'object') {
    CAPS_.forEach((x) => {
      const v = s.c[x.id];
      if (v && x.id !== 'set.users') c[x.id] = v === 'own' && x.scope ? 'own' : 1;
    });
  } else if (i >= 0) {
    CAPS_.forEach((x) => x.d[i] && (c[x.id] = x.d[i]));
  }
  return dropUnmet_(c);
}

/** Drops every capability whose `needs` is missing, until none is left (pay.check → view.cash → view.money). */
function dropUnmet_(c) {
  for (let again = true; again; ) {
    again = false;
    CAPS_.forEach((x) => {
      if (c[x.id] && x.needs && !c[x.needs]) {
        delete c[x.id];
        again = true;
      }
    });
  }
  return c;
}

/** Today in the team's time zone, yyyy-mm-dd. */
function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/** A role or an extra still in force: no end date, or one not past (`until` counts through that day). */
function live_(until, today) {
  return !until || String(until) >= today;
}

/**
 * What account `u` may do: { rid, caps }. rid = a temporary role while it lasts, else its own role;
 * caps = that role's capabilities plus the account's extras still in force (an extra limited to own
 * work does not narrow what the role gives for all work), less any whose `needs` is missing.
 */
function capsOf_(A, u) {
  const x = own_(A.u, u);
  if (!x) return { rid: '', caps: {} };
  const g = own_(A.grants || {}, u) || {};
  const today = today_();
  const tmp = g.r && g.r.id !== 'admin' && live_(g.r.until, today) && roleExists_(A.roles || {}, g.r.id) ? String(g.r.id) : '';
  const rid = tmp || String(x.r);
  const caps = roleCaps_(A.roles || {}, rid);
  if (rid !== 'admin') {
    (Array.isArray(g.c) ? g.c : []).forEach((e) => {
      const def = e && capDef_(e.k);
      if (!def || def.id === 'set.users' || !live_(e.until, today)) return;
      if (caps[def.id] !== 1) caps[def.id] = e.s === 'own' && def.scope ? 'own' : 1;
    });
    dropUnmet_(caps);
  }
  return { rid: rid, caps: caps };
}

/** The role name builds before the capabilities know: admin with set.users, sales with any write, else viewer. */
function legacyRole_(caps) {
  return caps['set.users'] ? 'admin' : WRITE_CAPS_.some((c) => caps[c]) ? 'sales' : 'viewer';
}

/** Requests waiting for a decision (from active accounts). */
function pendingCount_(A) {
  const q = A.rqs || {};
  return Object.keys(q).filter((u) => {
    const x = own_(A.u, u);
    return x && x.on === 1;
  }).length;
}

/** What the directory says about account `u` for `me`: name, role, capabilities and its request. */
function whoOf_(A, u) {
  const x = own_(A.u || {}, u);
  const r = capsOf_(A, u);
  const out = { name: x ? x.n : '', role: legacyRole_(r.caps), rid: r.rid, rn: roleName_(A.roles || {}, r.rid), caps: r.caps };
  if (r.caps['set.users']) out.rq = pendingCount_(A);
  const q = own_(A.rqs || {}, u), s = own_(A.res || {}, u);
  if (q) out.req = Object.assign({ st: 'p' }, q);
  else if (s) out.req = Object.assign({ st: 'r' }, s);
  return out;
}

/** `me` in a reply (see the protocol at the top). */
function meOf_(u, w) {
  const me = { u: u, name: w.name, role: w.role, rid: w.rid, rn: w.rn, caps: w.caps };
  if (w.rq !== undefined) me.rq = w.rq;
  if (w.req) me.req = w.req;
  return me;
}

/** Every role for the admin pages: built-ins first (bi: 1), each with the capabilities it gives. */
function rolesView_(roles) {
  const out = {};
  BUILTIN_ROLES.forEach((b, i) => {
    const s = b.id === 'admin' ? null : own_(roles, b.id);
    out[b.id] = Object.assign({ n: b.n, d: b.d, o: i }, s || {}, { c: roleCaps_(roles, b.id), bi: 1 });
  });
  Object.keys(roles).forEach((id) => {
    if (builtinIx_(id) < 0 && roles[id] && typeof roles[id] === 'object') out[id] = Object.assign({}, roles[id], { c: roleCaps_(roles, id) });
  });
  return out;
}

// ---- which records a capability lets an account write (push_)

/** The KEY_CAP entry for key `k`; scfg/<name> without a dot gets set.lists; anything else null (set.users). */
function keyRule_(k) {
  for (let i = 0; i < KEY_CAP.length; i++) if (k.indexOf(KEY_CAP[i].p) === 0) return KEY_CAP[i];
  if (/^scfg\/[^.]*$/.test(k)) return { p: 'scfg/', w: 'set.lists', d: 'set.lists' };
  return null;
}

/** What `caps` allow for key `k`: 0 = nothing, 1 = any record, or the rule that decides whether the
 *  record is the account's own ('deal', 'resp', 'by') when the capability covers its own work only. */
function keyAccess_(caps, k, del) {
  const r = keyRule_(k);
  const need = r ? (del ? r.d : r.w) : 'set.users';
  if (!need) return 0;
  const list = Array.isArray(need) ? need : [need];
  let own = 0;
  for (let i = 0; i < list.length; i++) {
    const v = caps[list[i]];
    if (v === 1) return 1;
    if (v === 'own') own = (r && (del ? r.od : r.ow)) || 1;
  }
  return own;
}

/**
 * The per-op check of push_ for an account: allowed(x) says whether its capabilities allow op x, and
 * allowed.done(x, value) is called for each op stored, so later ops of the same push see it (a new deal,
 * then its steps). "Own work" is decided on the sheet: a deal record is the account's when its resp
 * (ผู้รับผิดชอบ) is the account's display name, a deal's steps, contacts and payments when that deal's
 * is, and a log entry or contact when the account wrote its latest row. The sheet is read once, and only
 * for a push that has such an op.
 */
function opGate_(list, caps, name) {
  const deals = {}, keys = {};
  list.forEach((x) => {
    x.r = x.k && x.k.length <= 500 ? keyAccess_(caps, x.k, x.delR) : 0;
    if (x.r === 'deal' || x.r === 'resp') deals[dealOf_(x.k)] = 1;
    else if (x.r === 'by') keys[x.k] = 1;
  });
  const cur = latest_(deals, keys);
  const allowed = (x) => {
    if (x.r === 1 || !x.r) return x.r === 1;
    if (x.r === 'by') return !has_(cur.by, x.k) || sameName_(cur.by[x.k], name);
    const id = dealOf_(x.k);
    const resp = has_(cur.resp, id) ? cur.resp[id] : null;
    if (x.r === 'resp') return resp != null && sameName_(resp, name);
    // 'deal': the deal itself, the account's both before and after this change
    const v = x.op.v;
    return (resp == null || sameName_(resp, name)) && !!v && typeof v === 'object' && sameName_(v.resp, name);
  };
  allowed.done = (x, val) => {
    if (x.k.indexOf('deal/') === 0) cur.resp[x.k.slice(5)] = x.delR ? null : String((val && val.resp) || '');
    if (has_(keys, x.k)) cur.by[x.k] = name;
  };
  return allowed;
}

/** The deal id in a deal record's key: deal/<id>, dstep/<id>/<stage>, dpay/<id>/<stage>, dact/<id>/<act>. */
function dealOf_(k) {
  return k.split('/')[1] || '';
}

/**
 * From the latest row of each key: the resp of each deal id in `deals` (null when deleted) and the author
 * of each key in `keys`. Reads the key, value, deleted and author columns once (caller holds the lock).
 */
function latest_(deals, keys) {
  const out = { resp: {}, by: {} };
  let left = Object.keys(deals).length + Object.keys(keys).length;
  if (!left) return out;
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return out;
  const vals = sh.getRange(2, 2, last - 1, 4).getValues();
  for (let i = vals.length - 1; i >= 0 && left > 0; i--) {
    const k = String(vals[i][0]);
    if (k.indexOf('deal/') === 0 && has_(deals, k.slice(5)) && !has_(out.resp, k.slice(5))) {
      let v = null;
      if (!(vals[i][2] === 1 || vals[i][2] === true || vals[i][2] === '1') && vals[i][1] !== '') {
        try {
          v = JSON.parse(vals[i][1]);
        } catch (err) {
          v = null;
        }
      }
      out.resp[k.slice(5)] = v && typeof v === 'object' ? String(v.resp || '') : null;
      left--;
    }
    if (has_(keys, k) && !has_(out.by, k)) {
      out.by[k] = String(vals[i][3] || '');
      left--;
    }
  }
  return out;
}

/** Two display names are the same person: compared as names are typed (spaces, case, NFC); '' never matches. */
function sameName_(a, b) {
  const n = (s) => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  return n(a) !== '' && n(a) === n(b);
}

function has_(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

// ---- what a capability lets an account read (pull_)

// money in text the web app writes itself (a stage note "ใบเสนอราคา QT-1 · 350,000 บาท", the deal history
// "รับชำระ PAY1" / "2 งวด · 53,500 + 53,500"): an amount before บาท, and any number with thousands separators
const MONEY_TEXT_RE = /\d[\d,]*(?:\.\d+)?\s*บาท/g;
const MONEY_NUM_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?/g;
// the fields that hold money, and the text fields that may mention it, by key prefix
const MONEY_FIELDS = { 'deal/': ['forecast', 'actual'], 'ddoc/': ['amount', 'detected'], 'dpay/': ['amt', 'pct', 'got', 'fullAt'], 'jqm/': ['share', 'pct'], 'dchk/': ['amt'], 'mclose/': ['amt'] };
const MONEY_NOTES = { 'dstep/': ['n'], 'dlog/': ['detail'], 'dchk/': ['note'] };

function unmoney_(s) {
  return typeof s === 'string' ? s.replace(MONEY_TEXT_RE, '…').replace(MONEY_NUM_RE, '…') : s;
}

/**
 * A pulled row as an account without view.money / view.comm may see it. Without view.money the money
 * fields are null and amounts in the app's own notes are "…"; without view.comm a revenue split
 * (dshare/) comes as a deletion and a unit (scfg/unit.*) without its rates. The row keeps its seq.
 * Text people typed themselves ("ราคา 350000") is theirs and stays.
 */
function redact_(row, caps) {
  const k = row.k;
  if (!caps['view.comm'] && k.indexOf('dshare/') === 0) return Object.assign({}, row, { v: null, del: true });
  const v = row.v;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return row;
  let o = null;
  const edit = () => o || (o = Object.assign({}, v));
  if (!caps['view.comm'] && k.indexOf('scfg/unit.') === 0 && has_(v, 'rates')) delete edit().rates;
  if (!caps['view.money']) {
    const p = k.slice(0, k.indexOf('/') + 1);
    (MONEY_FIELDS[p] || []).forEach((f) => has_(v, f) && v[f] != null && (edit()[f] = null));
    (MONEY_NOTES[p] || []).forEach((f) => typeof v[f] === 'string' && (edit()[f] = unmoney_(v[f])));
    if (p === 'ddoc/' && v.auto && typeof v.auto === 'object' && typeof v.auto.n === 'string') edit().auto = Object.assign({}, v.auto, { n: unmoney_(v.auto.n) });
  }
  return o ? Object.assign({}, row, { v: o }) : row;
}

// ---- requests (any account) and their decision (set.users)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** An end date: '' for none, the date when it is a real yyyy-mm-dd not before today, else null. */
function untilOf_(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  if (!DATE_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s >= today_() ? s : null;
}

/** A note: trimmed, '' when empty, null when longer than NOTE_MAX characters. */
function noteOf_(v) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  return Array.from(s).length > NOTE_MAX ? null : s;
}

/** Capabilities asked for or given: [{ k, s, until? }] in catalogue order, or { err }. Never set.users. */
function capList_(list, withUntil) {
  if (!Array.isArray(list) || !list.length || list.length > CAPS_.length) return { err: 'bad_cap' };
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const e = list[i] || {};
    const def = capDef_(typeof e === 'string' ? e : e.k);
    if (!def || def.id === 'set.users') return { err: 'bad_cap' };
    const c = { k: def.id, s: e.s === 'own' && def.scope ? 'own' : 'all' };
    if (withUntil) {
      const until = untilOf_(e.until);
      if (until === null) return { err: 'bad_until' };
      if (until) c.until = until;
    }
    out[def.id] = c;
  }
  return CAPS_.filter((x) => out[x.id]).map((x) => out[x.id]);
}

/** Already held: for all work, or for own work when only that is asked. */
function held_(caps, c) {
  return caps[c.k] === 1 || (caps[c.k] === 'own' && c.s === 'own');
}

/** The list plus whatever its capabilities need and `have` lacks (asked for all work, with the same end date). */
function withNeeds_(list, have) {
  const out = list.slice();
  const add = (c) => {
    let n = capDef_(c.k).needs;
    while (n && !have[n] && !out.some((x) => x.k === n)) {
      const e = { k: n, s: 'all' };
      if (c.until) e.until = c.until;
      out.push(e);
      n = capDef_(n).needs;
    }
  };
  list.forEach(add);
  return CAPS_.map((x) => out.filter((c) => c.k === x.id)[0]).filter(Boolean);
}

function reqDetail_(rec) {
  const d = { k: rec.k };
  if (rec.role) d.role = rec.role;
  if (rec.caps) d.caps = rec.caps;
  if (rec.until) d.until = rec.until;
  return d;
}

/**
 * Any account but an admin: ask for another role, or for capabilities, with a reason and an optional end
 * date. It replaces the account's earlier request and hides its last result. Never admin or set.users.
 */
function reqSend_(req, actor) {
  if (actor.caps['set.users']) return { ok: false, error: 'forbidden' }; // an admin already has everything
  const note = noteOf_(req.note);
  if (!note) return { ok: false, error: 'req_note' };
  const until = untilOf_(req.until);
  if (until === null) return { ok: false, error: 'bad_until' };
  if (req.k !== 'role' && req.k !== 'caps') return { ok: false, error: 'bad_req' };
  const r = withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const A = dirOf_(usersOf_(p), p);
    const w = capsOf_(A, actor.u);
    const rec = { id: Utilities.getUuid().replace(/-/g, '').slice(0, 12), k: req.k };
    if (req.k === 'role') {
      const role = String(req.role == null ? '' : req.role);
      if (role === 'admin') return { err: 'role_locked' }; // made only by an admin, on the accounts page
      if (!roleExists_(A.roles, role)) return { err: 'bad_role' };
      if (role === w.rid) return { err: 'cap_held' };
      rec.role = role;
    } else {
      const caps = capList_(req.caps, false);
      if (caps.err) return caps;
      if (caps.some((c) => held_(w.caps, c))) return { err: 'cap_held' };
      rec.caps = withNeeds_(caps, w.caps);
    }
    rec.note = note;
    if (until) rec.until = until;
    rec.at = new Date().toISOString();
    A.rqs[actor.u] = rec;
    const vals = { REQS: prep_(A.rqs, 'too_many_reqs') };
    if (own_(A.res, actor.u)) {
      delete A.res[actor.u];
      vals.RESULTS = JSON.stringify(A.res);
    }
    commit_(vals);
    audit_([[actor.name, actor.u, 'req_send', reqDetail_(rec), note]]);
    return {};
  });
  return r.err ? { ok: false, error: r.err } : { ok: true };
}

/** The requester withdraws its request (REQS) or hides its result (RESULTS); nothing there is fine too. */
function reqDrop_(actor, name) {
  withLock_(() => {
    const o = objProp_(PropertiesService.getScriptProperties().getProperty(name));
    const rec = own_(o, actor.u);
    if (!rec) return;
    delete o[actor.u];
    commit_({ [name]: JSON.stringify(o) });
    if (name === 'REQS') audit_([[actor.name, actor.u, 'req_cancel', reqDetail_(rec), '']]);
  });
  return { ok: true };
}

/**
 * set.users: approve or refuse account u's request (never one's own). A role without an end date becomes
 * the account's role; with one, a temporary role. Capabilities become extras of that account. The
 * account sees the result in me.req until it hides it. `id` (optional) must still be the request shown.
 */
function reqDecide_(req, actor) {
  const u = normUser_(req.u);
  if (u === actor.u) return { ok: false, error: 'not_self' };
  const yes = req.ok === true || req.ok === 1;
  const note = noteOf_(req.note);
  if (note === null) return { ok: false, error: 'req_note' };
  return withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const db = usersOf_(p);
    const A = dirOf_(db, p);
    const rec = own_(A.rqs, u);
    if (!rec) return { ok: false, error: 'no_request' };
    if (req.id != null && req.id !== rec.id) return { ok: false, error: 'changed' };
    const x = own_(db.users, u);
    if (!x) return { ok: false, error: 'unknown_user' };
    const now = new Date().toISOString();
    const out = Object.assign({ ok: yes, by: actor.name, note: note, at: now }, reqDetail_(rec));
    const vals = {};
    if (yes) {
      const g = grantOf_(A.grants, u);
      if (rec.k === 'role') {
        if (rec.role === 'admin' || !roleExists_(A.roles, rec.role)) return { ok: false, error: 'bad_role' };
        if (rec.until) g.r = { id: rec.role, until: rec.until, by: actor.name, at: now };
        else {
          if (x.r === 'admin' && x.on === 1 && activeAdmins_(db) <= 1) return { ok: false, error: 'last_admin' };
          x.r = rec.role;
          delete g.r;
          vals.USERS = prepUsers_(db);
        }
      } else {
        g.c = mergeCaps_(g.c, (rec.caps || []).map((c) => extra_(c, rec.until, actor.name, now)));
      }
      setGrant_(A.grants, u, g);
      vals.GRANTS = prep_(A.grants, 'too_many_grants');
    }
    delete A.rqs[u];
    A.res[u] = out;
    vals.REQS = JSON.stringify(A.rqs); // only smaller
    vals.RESULTS = fitResults_(A.res);
    const q = commit_(vals);
    audit_([[actor.name, u, yes ? 'req_ok' : 'req_no', reqDetail_(rec), note]]);
    return view_(q);
  });
}

/** RESULTS as stored; the oldest results nobody hid yet give way when it would not fit. */
function fitResults_(res) {
  let s = JSON.stringify(res);
  while (bytes_(s) > PROP_MAX_BYTES && Object.keys(res).length > 1) {
    const old = Object.keys(res).sort((a, b) => String(res[a].at).localeCompare(String(res[b].at)))[0];
    delete res[old];
    s = JSON.stringify(res);
  }
  return s;
}

/** What the admin pages show after a change: every role, the extras and the waiting requests. */
function view_(p) {
  return { ok: true, roles: rolesView_(rolesOf_(p).roles), grants: objProp_(p.GRANTS), reqs: objProp_(p.REQS) };
}

// ---- roles (set.users)

/** A role name: whitespace collapsed, 1-30 characters, no control characters; '' when not valid. */
function cleanRoleName_(s) {
  const n = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const len = Array.from(n).length;
  return len >= 1 && len <= 30 && !/[\u0000-\u001f\u007f]/.test(n) ? n : '';
}

/** A role's capabilities as sent: { <cap>: 1 | 'own' | 'all' | true }, or { err }. Never set.users. */
function capMap_(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { err: 'bad_cap' };
  const out = {};
  const ids = Object.keys(c);
  for (let i = 0; i < ids.length; i++) {
    const v = c[ids[i]];
    if (!v) continue;
    const def = capDef_(ids[i]);
    if (!def || def.id === 'set.users') return { err: 'bad_cap' };
    out[def.id] = v === 'own' && def.scope ? 'own' : 1;
  }
  return { c: out };
}

/**
 * Create a role (no id; at most MAX_ROLES with the built-ins) or change one: name (unique), description,
 * capabilities (`c`, or copied `from` another role) and order. admin can't be changed. A capability whose
 * `needs` is missing is left out. The change applies to every account of the role on its next request.
 */
function roleSave_(req, actor) {
  const id = req.id == null || req.id === '' ? '' : String(req.id);
  if (id === 'admin') return { ok: false, error: 'role_locked' };
  return withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const R = rolesOf_(p);
    const all = rolesView_(R.roles);
    if (id && !roleExists_(R.roles, id)) return { ok: false, error: 'bad_role' };
    if (!id && Object.keys(all).length >= MAX_ROLES) return { ok: false, error: 'too_many_roles' };
    const old = id ? all[id] : null;
    const n = req.n == null && old ? old.n : cleanRoleName_(req.n);
    if (!n) return { ok: false, error: 'bad_name' };
    if (Object.keys(all).some((k) => k !== id && String(all[k].n).toLowerCase() === n.toLowerCase())) return { ok: false, error: 'name_taken' };
    const d = req.d == null ? (old ? String(old.d || '') : '') : Array.from(String(req.d).replace(/\s+/g, ' ').trim()).slice(0, 120).join('');
    let c;
    if (req.c != null) {
      const m = capMap_(req.c);
      if (m.err) return { ok: false, error: m.err };
      c = m.c;
    } else if (req.from != null && req.from !== '') {
      if (!roleExists_(R.roles, String(req.from))) return { ok: false, error: 'bad_role' };
      c = roleCaps_(R.roles, String(req.from));
      delete c['set.users'];
    } else c = old ? old.c : {};
    dropUnmet_(c);
    let rid = id;
    while (!rid || (!id && (all[rid] || builtinIx_(rid) >= 0))) rid = 'r' + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    const os = Object.keys(all).map((k) => Number(all[k].o) || 0);
    const o = req.o != null && isFinite(Number(req.o)) ? Number(req.o) : old ? Number(old.o) || 0 : Math.max.apply(null, os.concat([0])) + 1;
    const before = old ? old.c : {};
    R.roles[rid] = { n: n, d: d, c: c, o: o, at: new Date().toISOString(), by: actor.name };
    const q = commit_({ ROLES: prep_(R, 'too_many_roles') });
    const add = Object.keys(c).filter((k) => before[k] !== c[k]).map((k) => (c[k] === 'own' ? k + ':own' : k));
    const del = Object.keys(before).filter((k) => !c[k]);
    audit_([[actor.name, '', 'role_save', { id: rid, n: n, add: add, del: del, new: !old }, '']]);
    return Object.assign(view_(q), { id: rid });
  });
}

/** Delete a custom role (never a built-in). Its accounts and temporary roles move to `to` in the same write. */
function roleDel_(req, actor) {
  const id = String(req.id == null ? '' : req.id);
  if (builtinIx_(id) >= 0) return { ok: false, error: 'role_locked' };
  return withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const R = rolesOf_(p);
    if (!own_(R.roles, id)) return { ok: false, error: 'bad_role' };
    const db = usersOf_(p);
    const grants = objProp_(p.GRANTS);
    const members = Object.keys(db.users).filter((u) => db.users[u].r === id);
    const temp = Object.keys(grants).filter((u) => grants[u] && grants[u].r && grants[u].r.id === id);
    const to = req.to == null ? '' : String(req.to);
    if (members.length || temp.length) {
      if (!to) return { ok: false, error: 'role_in_use' };
      if (to === id || to === 'admin' || !roleExists_(R.roles, to)) return { ok: false, error: 'bad_role' };
    }
    members.forEach((u) => (db.users[u].r = to));
    temp.forEach((u) => (grants[u].r = Object.assign({}, grants[u].r, { id: to })));
    const n = R.roles[id].n;
    delete R.roles[id];
    const vals = { ROLES: JSON.stringify(R) };
    if (members.length) vals.USERS = prepUsers_(db);
    if (temp.length) vals.GRANTS = JSON.stringify(grants);
    const q = commit_(vals);
    audit_([[actor.name, '', 'role_del', { id: id, n: n, to: to, users: members.concat(temp) }, '']]);
    return view_(q);
  });
}

// ---- extras for one account (set.users)

/** GRANTS[u] as a copy to change: { r?, c: [] }. */
function grantOf_(grants, u) {
  const g = own_(grants, u) || {};
  const out = { c: Array.isArray(g.c) ? g.c.slice() : [] };
  if (g.r) out.r = g.r;
  return out;
}

/** Store GRANTS[u], or drop it when it holds nothing. */
function setGrant_(grants, u, g) {
  const o = {};
  if (g.r) o.r = g.r;
  if (g.c && g.c.length) o.c = g.c;
  if (o.r || o.c) grants[u] = o;
  else delete grants[u];
}

function extra_(c, until, by, at) {
  const e = { k: c.k, s: c.s === 'own' ? 'own' : 'all' };
  if (c.until || until) e.until = c.until || until;
  e.by = by;
  e.at = at;
  return e;
}

/** Extras, each capability once (the newer one wins), in catalogue order. */
function mergeCaps_(old, add) {
  const keep = (Array.isArray(old) ? old : []).filter((e) => e && !add.some((a) => a.k === e.k));
  const all = keep.concat(add);
  return CAPS_.map((x) => all.filter((e) => e.k === x.id)[0]).filter(Boolean);
}

/** Lapsed entries of GRANTS: [{ u, k, until, id? }] (k = 'role' for a temporary role). */
function expired_(grants, today) {
  const out = [];
  Object.keys(grants).forEach((u) => {
    const g = grants[u] || {};
    if (g.r && !live_(g.r.until, today)) out.push({ u: u, k: 'role', id: g.r.id, until: g.r.until });
    (Array.isArray(g.c) ? g.c : []).forEach((e) => e && !live_(e.until, today) && out.push({ u: u, k: e.k, until: e.until }));
  });
  return out;
}

/**
 * Give account u extra capabilities (never oneself, never set.users): [{ k, s?, until? }]. One the
 * account's role already gives is refused (cap_held); what they need is added. An extra given again
 * replaces the earlier one (scope, end date).
 */
function grantSave_(req, actor) {
  const u = normUser_(req.u);
  if (u === actor.u) return { ok: false, error: 'not_self' };
  const list = capList_(req.c, true);
  if (list.err) return { ok: false, error: list.err };
  return withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const A = dirOf_(usersOf_(p), p);
    if (!own_(A.u, u)) return { ok: false, error: 'unknown_user' };
    const rid = capsOf_(A, u).rid;
    const base = roleCaps_(A.roles, rid);
    if (rid === 'admin' || list.some((c) => held_(base, c))) return { ok: false, error: 'cap_held' };
    const now = new Date().toISOString();
    const add = withNeeds_(list, base).map((c) => extra_(c, '', actor.name, now));
    const g = grantOf_(A.grants, u);
    g.c = mergeCaps_(g.c, add);
    setGrant_(A.grants, u, g);
    const q = commit_({ GRANTS: prep_(A.grants, 'too_many_grants') });
    audit_([[actor.name, u, 'grant_save', { caps: add.map((e) => ({ k: e.k, s: e.s, until: e.until || '' })) }, '']]);
    return view_(q);
  });
}

/** Remove one extra of account u (k = a capability, or 'role' for a temporary role). */
function grantDel_(req, actor) {
  const u = normUser_(req.u);
  if (u === actor.u) return { ok: false, error: 'not_self' };
  const k = String(req.k == null ? '' : req.k);
  return withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const grants = objProp_(p.GRANTS);
    const g = grantOf_(grants, u);
    const had = k === 'role' ? g.r : g.c.filter((e) => e.k === k)[0];
    if (!had) return view_(p);
    if (k === 'role') delete g.r;
    else g.c = g.c.filter((e) => e.k !== k);
    setGrant_(grants, u, g);
    const q = commit_({ GRANTS: JSON.stringify(grants) }); // only smaller
    audit_([[actor.name, u, 'grant_del', k === 'role' ? { role: had.id } : { k: k }, '']]);
    return view_(q);
  });
}

// ---- the audit tab (same spreadsheet, never pulled)

/** The "audit" sheet; created with its header on first use. */
function auditSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(AUDIT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_SHEET);
    if (sh.getMaxColumns() > AUDIT_HEADER.length) sh.deleteColumns(AUDIT_HEADER.length + 1, sh.getMaxColumns() - AUDIT_HEADER.length);
    sh.getRange(1, 1, 1, AUDIT_HEADER.length).setValues([AUDIT_HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Append audit rows [actor, u, action, detail, note] (caller holds the lock). */
function audit_(list) {
  if (!list.length) return;
  const sh = auditSheet_();
  const now = new Date().toISOString();
  const start = sh.getLastRow() + 1;
  const need = start + list.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  const rng = sh.getRange(start, 1, list.length, AUDIT_HEADER.length);
  rng.setNumberFormat('@');
  rng.setValues(list.map((x) => [now, String(x[0] || '').slice(0, 100), String(x[1] || ''), x[2], JSON.stringify(x[3] || {}), String(x[4] || '')]));
}

/** Whether the oldest audit row is older than a year (one cell read). */
function auditOld_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET);
  if (!sh || sh.getLastRow() < 2) return false;
  return String(sh.getRange(2, 1).getValue()) < new Date(Date.now() - AUDIT_KEEP_MS).toISOString();
}

/** Drops audit rows older than a year (caller holds the lock); rows are in time order. */
function trimAudit_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const cut = new Date(Date.now() - AUDIT_KEEP_MS).toISOString();
  const at = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  let n = 0;
  while (n < at.length && String(at[n][0]) < cut) n++;
  if (n) sh.deleteRows(2, n);
}

/** The last `n` audit rows, newest first. */
function auditTail_(n) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET);
  const last = sh ? sh.getLastRow() : 0;
  if (last < 2) return [];
  const from = Math.max(2, last - n + 1);
  return sh
    .getRange(from, 1, last - from + 1, AUDIT_HEADER.length)
    .getValues()
    .reverse()
    .map((r) => {
      let detail = {};
      try {
        detail = JSON.parse(r[4] || '{}');
      } catch (err) {
        detail = {};
      }
      return { at: String(r[0]), actor: String(r[1]), u: String(r[2]), action: String(r[3]), detail: detail, note: String(r[5]) };
    });
}

// ------------------------------------------------------------------ attached documents (Google Drive)

/** Save an attached document (base64) in the documents folder. */
function upload_(req) {
  const mime = String(req.mime || '').toLowerCase();
  if (DOC_TYPES.indexOf(mime) < 0) return { ok: false, error: 'bad_file_type' };
  const data = typeof req.data === 'string' ? req.data : '';
  if (!data) return { ok: false, error: 'empty_file' };
  // exact decoded size from the base64 length, so an oversized file is refused before decoding it
  const pad = data.slice(-2) === '==' ? 2 : data.slice(-1) === '=' ? 1 : 0;
  if (Math.floor(data.length / 4) * 3 - pad > MAX_FILE) return { ok: false, error: 'file_too_large' };
  const docId = cleanId_(req.docId);
  if (!docId) return { ok: false, error: 'bad_doc_id' };
  let bytes;
  try {
    bytes = Utilities.base64Decode(data);
  } catch (err) {
    return { ok: false, error: 'bad_data' };
  }
  if (!bytes.length) return { ok: false, error: 'empty_file' };
  if (bytes.length > MAX_FILE) return { ok: false, error: 'file_too_large' };
  // no lock while the file is written: a multi-second upload must not hold up the team's sync
  const folder = docFolder_(), fileName = docId + '__' + cleanName_(req.name);
  // the same document sent again (a reply that was lost, a retry, a second tab): answer with the file
  // already saved instead of making a copy nobody can see or delete
  const same = folder.getFilesByName(fileName);
  while (same.hasNext()) {
    const f = same.next();
    if (!f.isTrashed() && f.getSize() === bytes.length) return { ok: true, fileId: f.getId(), size: f.getSize() };
  }
  const file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));
  return { ok: true, fileId: file.getId(), size: file.getSize() };
}

function file_(fileId) {
  const f = docFile_(fileId);
  if (!f) return { ok: false, error: 'not_found' };
  // a large scan the owner put in the folder by hand would exceed Apps Script's response limits
  if (f.getSize() > MAX_FILE) return { ok: false, error: 'file_too_large' };
  const name = f.getName();
  const cut = name.indexOf('__'); // "<docId>__<original name>"; cleanId_ keeps "__" out of docId
  return { ok: true, name: cut >= 0 ? name.slice(cut + 2) : name, mime: f.getMimeType(), size: f.getSize(), data: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function delFile_(fileId) {
  const f = docFile_(fileId);
  if (!f) return { ok: false, error: 'not_found' };
  f.setTrashed(true); // the owner can still restore it from the Drive trash for 30 days
  return { ok: true };
}

/** A file inside the documents folder that is not in the trash, else null: the team code must
 *  never open or delete any other file in the owner's Drive. */
function docFile_(fileId) {
  const id = String(fileId || '');
  if (!/^[\w-]{1,200}$/.test(id)) return null;
  const folder = docFolderReady_();
  if (!folder) return null;
  let f;
  try {
    f = DriveApp.getFileById(id);
  } catch (err) {
    // a missing permission must still say so; any other failure means this file can't be served,
    // and answering not_found lets the web app remove an attachment whose file is gone
    if (drivePermission_(err)) throw err;
    return null;
  }
  // only the types uploads are allowed to have: an .html or .svg dropped into the folder by hand
  // must never be handed to the browser as a page (getFileById also resolves Google Docs/folders)
  if (!f || f.isTrashed() || DOC_TYPES.indexOf(f.getMimeType()) < 0) return null;
  const parents = f.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folder.getId()) return f;
  return null;
}

/** The documents folder if it exists and is not in the trash, else null (reading needs no lock). */
function docFolderReady_() {
  const id = PropertiesService.getScriptProperties().getProperty('DOC_FOLDER');
  const f = id ? driveGet_((x) => DriveApp.getFolderById(x), id) : null;
  return f && !f.isTrashed() ? f : null;
}

/** The documents folder, created on first use (or again after the owner trashed / deleted it).
 *  Created under the lock, so two first uploads at the same moment can't make two folders. */
function docFolder_() {
  return (
    docFolderReady_() ||
    withLock_(() => {
      const ready = docFolderReady_(); // another request may have created it while this one waited
      if (ready) return ready;
      const f = DriveApp.createFolder(DOC_FOLDER_NAME);
      PropertiesService.getScriptProperties().setProperty('DOC_FOLDER', f.getId());
      return f;
    })
  );
}

/** A Drive item by id, or null if it no longer exists. Anything else (no permission, a Drive
 *  outage) is thrown — treating it as "gone" would create a second documents folder. */
function driveGet_(get, id) {
  try {
    return get(id);
  } catch (err) {
    if (/no item with the given id/i.test(String((err && err.message) || err))) return null;
    throw err;
  }
}

/** Apps Script's error when the owner hasn't allowed (or their admin blocks) Google Drive access. */
function drivePermission_(err) {
  const m = String((err && err.message) || err);
  return /DriveApp|auth\/drive/.test(m) && /permission|access denied/i.test(m);
}

/** The record id part of a stored file name: letters, digits, . - _ but never "__" or a trailing
 *  "_", so the "__" after it always marks where the original name starts. */
function cleanId_(s) {
  return String(s || '').replace(/[^\w.-]+/g, '-').replace(/_{2,}/g, '_').slice(0, 100).replace(/_$/, '');
}

/** A file name that is safe everywhere it may be saved: no path separators, control characters or
 *  characters Windows refuses; at most 150 characters, keeping the extension. */
function cleanName_(s) {
  let n = String(s || '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim();
  const chars = Array.from(n); // by code point, so a cut never splits an emoji in two
  if (chars.length > 150) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : '';
    n = chars.slice(0, 150 - ext.length).join('') + ext;
  }
  return n || 'เอกสาร';
}
