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
 * อัปเดตจากเวอร์ชันก่อน: คัดลอกบรรทัด TEAM_KEY เดิมเก็บไว้ วางโค้ดนี้แทนทั้งไฟล์ แล้วใส่บรรทัดนั้นกลับ → บันทึก
 * → เลือกฟังก์ชัน setupNotify กด Run แล้วกด "อนุญาต" (Google ขอสิทธิ์ใหม่ 2 อย่าง: ส่งอีเมลในนามคุณ และทำงานเมื่อคุณ
 * ไม่ได้เปิดอยู่) → แล้วจึง Deploy → Manage deployments → Edit → Version: New version
 * ต้อง Run setupNotify ก่อน Deploy เสมอ ถ้าสลับกัน ทั้งทีมจะซิงก์ไม่ได้จนกว่าจะกดอนุญาต (ดู README)
 *
 * Protocol v4 (POST, body = JSON text, Content-Type: text/plain to avoid a CORS preflight).
 * The web app sends `cv: 4` with every request (builds before the capabilities sent `cv: 3`). A team
 * works in one of three modes (see hello):
 *   legacy   — no accounts yet and TEAM_KEY is set: every request carries `key` (the team code), as in v2
 *   setup    — no accounts and no TEAM_KEY: only hello and claim work
 *   accounts — at least one account exists: requests carry `tok` (a session token); TEAM_KEY grants nothing
 *
 * Public (no key or token):
 *   { action: 'hello' }                          -> { ok, app: 'gcc-team-sync', v: 4, files: true, mode, tid, it, notify }
 *     notify = { on: 1 | 0, since: 'yyyy-mm-dd' | '' }: on = setupNotify() has installed the e-mail trigger; since =
 *     the go-live day (quotations confirmed before it need no check). Scripts before this one send no notify.
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
 *   { action: 'me', tok }                        -> { ok, me, mc, roles }   (roles: every role, as in `users` below)
 *   { action: 'passwd', tok, old, pk, rm? }      -> { ok, tok, exp, me }   (other devices are signed out)
 *   { action: 'logout', tok, all? }              -> { ok }                 (all: every device is signed out)
 *   { action: 'req_send', tok, k: 'role'|'caps', role?, caps?: [{ k, s? }], note, until? } -> { ok }  any account
 *   { action: 'req_cancel', tok } / { action: 'req_ack', tok }  -> { ok }   (withdraw one's request / hide its result)
 *   { action: 'notify_me', tok, get? }           -> { ok, notify }   (one's own e-mail settings; also in me.notify)
 *   { action: 'notify_me', tok, on?, t?, sc?, em?, resend? } -> { ok, notify, sent? }   on = { qt, res, dg, pre } 0|1,
 *     t = the digest time (06:30 … 09:00, every 30 minutes), sc = 'mine' | 'team'. A new em (or resend: true while
 *     it is unverified) is stored unverified and gets a 6-digit code by mail (sent = 1, or 0 + mail = the reason);
 *     em: '' removes the address. At most 3 codes an hour.
 *   { action: 'notify_verify', tok, code }       -> { ok }   (the code from the mail, within 15 minutes, 5 tries)
 *   { action: 'notify_test', tok }               -> { ok }   (notify.mail: one mail to one's own verified address,
 *     at most 3 an hour and 6 a day: 'too_many_tests')
 *   { action: 'qt_check', tok, k, st, note?, fp, s? } -> { ok, seq, chk }   (qt.check: see "quotation check" below)
 * Token, set.users (an admin):
 *   { action: 'users', tok }                     -> { ok, users: [{ u, name, role, on, mc, ll, c, locked, em, ok, notify }],
 *                                                     roles, grants, reqs, audit }
 *   { action: 'user_save', tok, u, create?, name?, role?, on?, pk?, unlock?, kick?, em? } -> { ok, user, sent? }
 *     em: the account's notification address, stored unverified; the code goes to that address (as notify_me)
 *   { action: 'notify_status', tok }             -> { ok, on, since, last, quotaLeft, sentToday, triggers, every }
 *   { action: 'role_save', tok, id?, n, d?, c?, from?, o? }  -> { ok, id, roles, grants, reqs }
 *     a `c` that does not name a capability of LATE_CAPS_ (view.exp, edit.exp) keeps what the role has there
 *     (a new role: what the `from` role has): builds before them cannot show them, so their save must not take
 *     them away (newer builds send 0 for off)
 *   { action: 'role_del', tok, id, to? }         -> { ok, roles, grants, reqs }   (members and grants move to `to`)
 *   { action: 'grant_save', tok, u, c: [{ k, s?, until? }] } / { action: 'grant_del', tok, u, k } -> { ok, roles, grants, reqs }
 *   { action: 'req_decide', tok, u, ok, note?, id } -> { ok, roles, grants, reqs }   id = the request shown (REQS[u].id):
 *     another one ('changed', the requester sent a new one meanwhile) or none ('bad_req') decides nothing
 *     roles  = { <id>: { n, d, c, o, at?, by?, bi?: 1 } } every role, built-ins (bi) included; admin's c is everything
 *     grants = GRANTS, reqs = REQS (see "Script Properties" below); audit = the last 50 rows, newest first:
 *              [{ at, actor, u, action, detail, note }]
 * Team code (legacy mode) or token (accounts mode):
 *   { action: 'ping', key }                     -> { ok, seq, files: true }
 *   { action: 'pull', key, since, limit?, xp? } -> { ok, seq, rows: Row[], more }
 *     xp: 1 = the build knows job expenses; without it a month-check row of an expense (dchk/<deal>/exp.<id>)
 *     comes as a deletion, since builds before expenses would list it as a cancelled income check.
 *   { action: 'push', key, ops: Op[] }          -> { ok, seq, n, rejected: string[] }   (+ denied: string[] with tok)
 *   { action: 'upload', key, docId, name, mime, data }  -> { ok, fileId, size }   (data = base64)
 *   { action: 'file', key, fileId }             -> { ok, name, mime, size, data }
 *   { action: 'delfile', key, fileId }          -> { ok }   (moves the file to the owner's Drive trash)
 *   Op  = { k: string, v?: any, del?: boolean, by?: string }
 *   Row = { seq: number, k: string, v: any, del: boolean, by: string, at: string }
 *   With a token, `by` is always the account's display name (the op's by is ignored), every reply adds
 *   me, and a remembered session with fewer than 15 days left also gets a new tok + exp.
 * me = { u, name, role, rid, rn, caps, rq?, req?, notify, grants? }: rid = the role in effect (a temporary role while it
 *   lasts), rn = its name, caps = { <capability>: 1 | 'own' } (1 = all work, 'own' = the account's own work;
 *   only what it holds), role = 'admin' | 'sales' | 'viewer' for builds before capabilities (admin = set.users,
 *   sales = any write, else viewer), rq = requests waiting (set.users holders only), req = the account's own
 *   pending request { st: 'p', id, k, role?, caps?, note, until?, at } or its unread result
 *   { st: 'r', ok, by, note, at, k, role?, caps?, until? }, notify = the account's e-mail settings
 *   { em, ok: 1 | 0 (verified), on: { qt, res, dg, pre }, t, sc } with the defaults filled in; grants = the
 *   account's own GRANTS entry (a temporary role and extras with their dates), only when it has one.
 * Quotation check (notifications): qchk/<docId> = { st: 'ok'|'back', by, at, fp: { a, n, d, f }, note?, via:
 *   'mail'|'app', u } is written only by qt_check (never by push, admins included). k = the full ddoc/<deal>/<docId>
 *   key, which must be the latest live record of that docId; fp = { a: amount, n: docNo, d: docDate, f: name + '|' +
 *   size } as the web app reads the record, and must still match ('changed'); the account that attached it (doc.by)
 *   or wrote it last may not check it ('self_check') unless scfg/notify.cfg.self; 'back' needs a note. With it a
 *   dlog/<id> history row. st 'undo' removes one's own latest check within 10 minutes. s = the signed part of an
 *   e-mail link (#go=qt&doc=<docId>&s=<exp>.<sig>.<u>): valid makes via 'mail', anything else 'app'.
 * E-mail: the time-driven notifyTick (installed by setupNotify) mails verified addresses only, never customers;
 *   the "notify" tab of this spreadsheet logs every mail (90 days) so nothing is sent twice.
 * Capabilities (CAPS_, the same catalogue as the web app's lib/caps.ts): what a key needs is in KEY_CAP
 * (default deny: an unknown prefix needs set.users, qchk/ is never pushed). A refused op is listed in
 * `denied` and never stored. push needs a write capability, upload and delfile docs.up (or edit.exp for an
 * expense's bill: docId exp_<expId>), file docs.open.
 * Accounts without set.users get by = their name in log/, dlog/, dact/ values, by + at = their name
 * and the time in dchk/, mclose/ and dexp/, and in a ddoc/ value by = whoever attached the document (the
 * account for a new one, else the attacher stored with it). pull strips money without view.money and commission without view.comm.
 * Job expenses (ค่าใช้จ่ายของงาน): dexp/<dealId>/<expId> = { c, n?, amt, d, paid?, file?: { id, name, mime, size },
 * by, at } (edit.exp; own work = the deal's resp, as dpay/), their history rows dlog/exp.<id> (edit.exp or
 * pay.check), the month check of an expense dchk/<dealId>/exp.<expId> (pay.check, d = the paid date, f = the
 * bill's file id) and of a month's expenses mclose/<YYYY-MM>/out = { by, at, n, amt } (pay.check). Without
 * view.exp (which needs view.money) pull sends all four as deletions. An account's push that deletes a deal
 * also deletes that deal's expenses (as its dshare/), whether or not the account sees them.
 * A token request from an older build (cv < 4) may still read, but push, upload and delfile answer
 * 'มีเวอร์ชันใหม่ กรุณารีเฟรชหน้าเว็บ (F5)', which those builds show as is (their queue is kept).
 *   Errors: { ok: false, error: 'unauthorized' | 'no_team_key' | 'busy' | 'bad_json' | 'unknown_action'
 *            | 'file_too_large' | 'bad_file_type' | 'empty_file' | 'not_found' | 'drive_permission'
 *            | 'login_required' | 'session_expired' | 'account_disabled' | 'must_change_password' | 'forbidden'
 *            | 'bad_login' | 'locked' (+ retryIn seconds) | 'too_many_attempts' | 'no_accounts' | 'bad_code'
 *            | 'bad_user' | 'bad_name' | 'bad_role' | 'bad_password_data' | 'wrong_password' | 'name_taken'
 *            | 'user_exists' | 'unknown_user' | 'too_many_users' | 'not_self' | 'last_admin' | 'name_locked'
 *            | 'role_in_use' | 'role_locked' | 'bad_cap' | 'cap_held' | 'too_many_roles' | 'req_note' | 'bad_until'
 *            | 'bad_req' | 'no_request' | 'changed' | 'too_many_grants' | 'too_many_reqs' | 'self_check' | 'too_late'
 *            | 'bad_email' | 'bad_notify' | 'too_many_codes' | 'too_many_tests' | 'code_wrong' | 'code_expired' | 'no_email' | 'no_quota'
 *            | 'mail_failed' | ... }
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

// notifications (e-mail) and the quotation check
const NOTIFY_SHEET = 'notify';
const NOTIFY_HEADER = ['at', 'kind', 'u', 'key', 'fp', 'result'];
const NOTIFY_KEEP_MS = 90 * 86400000; // the send log is also what stops a mail going out twice
const NOTIFY_EVERY_MIN = 10; // notifyTick runs about this often
const NOTIFY_TIMES = ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00']; // when a digest may go out
const NOTIFY_RESERVE = 5; // mails kept for new quotations: digests, reminders and codes wait when fewer are left
const TEST_RESERVE = 10; // a test mail (pressed by hand, any number of accounts) waits sooner still
const TEST_PER_HOUR = 3; // test mails per account (each one counts against the day's quota)
const TEST_PER_DAY = 6;
const NOTIFY_BULK = 20; // more new quotations than this in one run is an import or a first upload: not mailed
const NOTIFY_OLD_MS = 48 * 3600000; // a quotation confirmed longer ago than this is not news
const FILE_WAIT_MS = 30 * 60000; // a new quotation waits this long for its file to reach Drive
const RESULT_WAIT_MS = 10 * 60000; // a check is mailed to the attacher this long after, unless it was undone
const UNDO_MS = 10 * 60000; // how long a checker may undo their check
const LINK_TTL_MS = 30 * 86400000; // e-mail links carry a signature that lasts this long
const CODE6_TTL_MS = 15 * 60000; // the code that verifies an e-mail address
const CODE6_TRIES = 5;
const CODE6_PER_HOUR = 3;
const NTICK_S = 330; // a run still going (Apps Script stops a run after 6 minutes)
const LIST_MAX = 20; // rows per list in a digest
const MAIL_SENDER = 'GCC Sales Tracker';
const EMAIL_RE = /^[^\s@<>()"',;:\\[\]]+@[^\s@<>()"',;:\\[\]]+\.[^\s@<>()"',;:\\[\]]+$/;
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
  { id: 'view.exp', g: 'v', th: 'ดูค่าใช้จ่ายและกำไรของงาน', real: 1, needs: 'view.money', d: [1, 1, 0] },
  { id: 'docs.open', g: 'v', th: 'เปิดเอกสารแนบ', needs: 'view.money', d: [1, 1, 1] },
  { id: 'edit.cust', g: 'e', th: 'ลูกค้าและผู้ติดต่อ', d: [1, 1, 0] },
  { id: 'edit.deal', g: 'e', th: 'ดีลและขั้นตอน', scope: 1, needs: 'view.money', d: [1, 1, 0] },
  { id: 'edit.task', g: 'e', th: 'นัดหมาย', d: [1, 1, 0] },
  { id: 'edit.pay', g: 'e', th: 'แผนชำระเงินและการรับเงิน', scope: 1, needs: 'view.money', d: [1, 1, 0] },
  { id: 'edit.exp', g: 'e', th: 'บันทึกค่าใช้จ่ายของงาน', scope: 1, needs: 'view.exp', d: [1, 'own', 0] },
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
  { id: 'set.data', g: 'a', th: 'นำเข้าข้อมูลและไฟล์สำรอง', d: [1, 0, 0] },
  { id: 'set.users', g: 'a', th: 'จัดการผู้ใช้และสิทธิ์', d: [1, 0, 0] },
];
/** The built-in roles: their ids are what USERS has always stored. admin is locked to everything. */
const BUILTIN_ROLES = [
  { id: 'admin', n: 'ผู้ดูแลระบบ', d: 'ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้และสิทธิ์' },
  { id: 'sales', n: 'พนักงานขาย', d: 'เพิ่มและแก้ลูกค้า ดีล นัดหมาย แผนชำระ และแนบเอกสาร บันทึกค่าใช้จ่ายของงานตัวเอง ลบได้เฉพาะบันทึกของตัวเอง' },
  { id: 'viewer', n: 'ดูอย่างเดียว', d: 'ดูได้ทุกหน้า รวมยอดเงินและ Cashflow แก้ไขไม่ได้' },
];
/**
 * Capabilities added after the first web app with capabilities shipped (job expenses). That build cannot show
 * them, so a role_save whose `c` does not name one keeps what the role has (roleSave_); later builds send 0.
 */
const LATE_CAPS_ = ['view.exp', 'edit.exp'];
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
  // the history of a deal's expenses: a key of its own, so pull can leave it out without view.exp
  { p: 'dlog/exp.', w: ['edit.exp', 'pay.check'], d: 'set.users' },
  { p: 'dlog/', w: ['edit.deal', 'edit.pay', 'docs.up', 'edit.jqt', 'edit.share', 'pay.check'], d: 'set.users' },
  { p: 'ddoc/', w: 'docs.up', d: 'docs.up' },
  { p: 'dpay/', w: 'edit.pay', d: 'edit.pay', ow: 'resp', od: 'resp' },
  { p: 'dexp/', w: 'edit.exp', d: 'edit.exp', ow: 'resp', od: 'resp' },
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
  // the e-mail notifications too, so an owner who runs setup after pasting new code has them as well
  try {
    installNotify_();
    Logger.log('การแจ้งเตือนทางอีเมลพร้อมใช้งาน (ตรวจทุก ' + NOTIFY_EVERY_MIN + ' นาที)');
  } catch (err) {
    Logger.log('ยังเปิดการแจ้งเตือนทางอีเมลไม่ได้: ' + String((err && err.message) || err) + ' — เลือก setupNotify แล้วกด Run และกดอนุญาต');
  }
  if (admins.length) Logger.log('ชื่อผู้ใช้ผู้ดูแลระบบ: ' + admins.join(', '));
  Logger.log(codeMsg);
  try {
    ss.toast(codeMsg + '\n' + msg, 'GCC ข้อมูลทีม', 30); // shown in the open spreadsheet
  } catch (err) {
    /* no spreadsheet window open */
  }
}

/**
 * กด Run ฟังก์ชันนี้ครั้งเดียวหลังวางโค้ดเวอร์ชันนี้ (ก่อน Deploy) แล้วกด "อนุญาต": Google จะขอสิทธิ์ส่งอีเมลในนามคุณ
 * และสิทธิ์ทำงานเมื่อคุณไม่ได้เปิดอยู่ สคริปต์จะตั้งเวลาตรวจทุก 10 นาที และสร้างแท็บ "notify" (บันทึกอีเมลที่ส่ง)
 * Run ซ้ำได้ ไม่มีอะไรซ้ำ และไม่ส่งอีเมลย้อนหลังของข้อมูลที่มีอยู่ก่อน
 */
function setupNotify() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('สคริปต์นี้ต้องสร้างจากไฟล์ Google Sheet: เปิดไฟล์ชีต → ส่วนขยาย (Extensions) → Apps Script แล้ววางโค้ดที่นั่น');
  const r = installNotify_();
  const msg = 'การแจ้งเตือนทางอีเมลพร้อมใช้งาน: ตรวจทุก ' + NOTIFY_EVERY_MIN + ' นาที วันนี้ส่งได้อีก ' + r.quota +
    ' ฉบับ ขั้นต่อไป: Deploy → Manage deployments → Edit → Version: New version';
  Logger.log(msg);
  try {
    ss.toast(msg, 'GCC ข้อมูลทีม', 30);
  } catch (err) {
    /* no spreadsheet window open */
  }
}

/**
 * The notification set-up, safe to run again: one notifyTick trigger (an old one is replaced), the notify
 * tab, and on the first run only the go-live day (NOTIFY_SINCE) and the log position (NOTIFY_SEQ = the
 * current seq), so nothing already in the sheet is ever mailed. Asking for the mail quota is what makes
 * Google ask for the mail permission now rather than at the first send.
 */
function installNotify_() {
  const quota = MailApp.getRemainingDailyQuota();
  sheet_();
  notifySheet_();
  ScriptApp.getProjectTriggers().forEach((t) => t.getHandlerFunction() === 'notifyTick' && ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('notifyTick').timeBased().everyMinutes(NOTIFY_EVERY_MIN).create();
  withLock_(() => {
    ensureAuthProps_(); // AUTH_SECRET also signs the e-mail links
    const props = PropertiesService.getScriptProperties();
    const p = props.getProperties();
    const vals = { NOTIFY_ON: '1' };
    if (!p.NOTIFY_SINCE) vals.NOTIFY_SINCE = today_();
    if (p.NOTIFY_SEQ == null || p.NOTIFY_SEQ === '') vals.NOTIFY_SEQ = String(lockedSeq_());
    // with accounts the cached directory carries the notification state (hello reads it from there)
    if (hasUsers_(usersOf_(p))) commit_(vals);
    else Object.keys(vals).forEach((k) => props.setProperty(k, vals[k]));
  });
  return { quota: quota };
}

/**
 * ก่อนย้อนกลับไปใช้สคริปต์เวอร์ชันก่อน (ดู README หัวข้อ "ย้อนกลับ"): กด Run ฟังก์ชันนี้ก่อนวางโค้ดเก่า สคริปต์เก่ารู้จักแค่
 * ผู้ดูแลระบบ / พนักงานขาย / ดูอย่างเดียว บัญชีในบทบาทที่สร้างเอง ย้ายเป็นพนักงานขายถ้าบทบาทนั้นให้ครบอย่างพนักงานขายแบบเดิม
 * ไม่อย่างนั้นเป็นดูอย่างเดียว (รวมบัญชีที่บทบาทชั่วคราวหรือบทบาทพนักงานขายที่ถูกแก้ ให้น้อยกว่านั้น) ไม่อย่างนั้นสคริปต์เก่าจะให้
 * บัญชีเหล่านั้นแก้ได้ทุกอย่าง และหยุดการแจ้งเตือนทางอีเมล
 * Execution log บอกว่าย้ายใครบ้าง (แก้กลับได้ที่ ผู้ใช้และสิทธิ์ ในเว็บ)
 *
 * The scripts before capabilities apply their rules to role 'sales' and block only 'viewer': any other
 * role id would write everything there. Every account but an admin keeps 'sales' only when its own role,
 * and its temporary role while that lasts, give all the original พนักงานขาย gives; anything else becomes
 * 'viewer'. The notifyTick trigger goes too (the old script has no such function). Each move is an audit
 * row; ROLES, GRANTS and REQS stay for when this version is pasted back.
 */
function prepareRollback() {
  const moved = withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const p = props.getProperties();
    const db = usersOf_(p);
    const out = rollbackRoles_(dirOf_(db, p), db);
    const vals = {};
    if (out.length) vals.USERS = prepUsers_(db);
    if (p.NOTIFY_ON === '1') vals.NOTIFY_ON = '0'; // setupNotify turns it on again
    if (!Object.keys(vals).length) return out;
    if (hasUsers_(db)) commit_(vals);
    else Object.keys(vals).forEach((k) => props.setProperty(k, vals[k]));
    audit_(out.map((x) => ['', x.u, 'user_role', { from: x.from, to: x.to }, 'ย้อนกลับเวอร์ชันสคริปต์']));
    return out;
  });
  let triggers = 0;
  try {
    ScriptApp.getProjectTriggers().forEach((t) => {
      if (t.getHandlerFunction() !== 'notifyTick') return;
      ScriptApp.deleteTrigger(t);
      triggers++;
    });
  } catch (err) {
    // never installed (the trigger permission was not granted)
  }
  Logger.log('พร้อมย้อนกลับ: ' + (moved.length ? 'ย้ายบทบาท ' + moved.length + ' บัญชี: ' + moved.map((x) => x.n + ' (' + x.u + ') เป็น' + roleName_({}, x.to)).join(', ') : 'ไม่มีบัญชีที่ต้องย้าย') +
    (triggers ? ' · หยุดการแจ้งเตือนทางอีเมลแล้ว' : '') + ' — วางโค้ดเวอร์ชันก่อนได้เลย ยอดเงินจะไม่ถูกซ่อนจากบัญชีใดอีก');
  return moved;
}

/** The accounts prepareRollback moves to 'viewer' (USERS changed in place): [{ u, n, from, to }]. */
function rollbackRoles_(A, db) {
  if (A.m !== 'accounts') return [];
  const full = roleCaps_({}, 'sales'); // the original พนักงานขาย
  const covers = (rid) => {
    const c = roleCaps_(A.roles || {}, rid);
    return Object.keys(full).every((k) => c[k] === 1 || c[k] === full[k]);
  };
  const today = today_();
  const out = [];
  Object.keys(db.users).forEach((u) => {
    const x = db.users[u];
    if (x.r === 'admin') return;
    const g = own_(A.grants || {}, u) || {};
    const rids = [String(x.r)];
    if (g.r && live_(g.r.until, today)) rids.push(String(g.r.id));
    const to = x.r === 'viewer' || !rids.every(covers) ? 'viewer' : 'sales';
    if (to === x.r) return;
    out.push({ u: u, n: x.n, from: x.r, to: to });
    x.r = to;
  });
  return out;
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
      if (need && !need.some((c) => actor.caps[c]) && !expBill_(action, req, actor.caps)) return reply_(actor, { ok: false, error: 'forbidden' });
    }
    switch (action) {
      case 'ping':
        // only creating / repairing the sheet needs the lock; a ready sheet is just read
        if (!sheetReady_()) withLock_(() => sheet_());
        return reply_(actor, { ok: true, seq: cachedSeq_() ?? seq_(), files: true });
      case 'pull':
        return reply_(actor, pull_(Number(req.since) || 0, Math.min(Number(req.limit) || MAX_PULL, MAX_PULL), actor, Number(req.xp) >= 1));
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

/**
 * An account without docs.up that records job expenses (edit.exp) may still upload an expense's bill (docId
 * exp_<expId>) and move one to the trash (a file stored as "exp_<expId>__<name>"): recording an expense
 * includes its evidence. A file that is not there passes, so delfile answers not_found as for documents.
 */
function expBill_(action, req, caps) {
  if (!caps['edit.exp']) return false;
  if (action === 'upload') return /^exp_/.test(cleanId_(req.docId));
  if (action !== 'delfile') return false;
  const f = docFile_(req.fileId);
  return !f || /^exp_/.test(f.getName());
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
 * their seq stay, so the reader's position in the log is the same for every account. `xp`: the
 * build knows job expenses; to one that does not (the team code too) an expense's month check comes as
 * a deletion, which it ignores, instead of a check whose income line is gone.
 */
function pull_(since, limit, actor, xp) {
  const out = pullRows_(since, limit);
  if (!out.rows.length) return out;
  const caps = actor && !actor.legacy ? actor.caps : null;
  if (caps && (!caps['view.money'] || !caps['view.comm'] || !caps['view.exp'])) out.rows = out.rows.map((r) => redact_(r, caps));
  if (!xp) out.rows = out.rows.map((r) => (!r.del && EXP_CHK_RE.test(r.k) ? gone_(r) : r));
  return out;
}

// the job-expense records (see the protocol at the top): an expense, its history, its month check and the
// month check of a month's expenses
const EXP_KEY_RE = /^(?:dexp\/|dlog\/exp\.|dchk\/[^/]+\/exp\.|mclose\/[^/]+\/)/;
const EXP_CHK_RE = /^dchk\/[^/]+\/exp\./;

/** A pulled row as a deletion (same seq, key, author and time). */
function gone_(row) {
  return Object.assign({}, row, { v: null, del: true });
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
    // accounts other than admins write log entries, checks and expenses in their own name, checks and
    // expenses also at this time
    const stamp = !!caps && !caps['set.users'];
    const list = ops.map((op) => {
      op = op || {};
      const del = !!op.del;
      // the web app applies a row without a value as a deletion
      return { op: op, k: String(op.k || ''), del: del, delR: del || op.v === undefined || op.v === null };
    });
    const allowed = caps ? opGate_(list, caps, actor.name, stamp) : null;
    const rows = [];
    const rejected = [];
    const denied = [];
    const stored = {}; // keys this push stores
    const kept = {}; // each of them: 1 = a value, 0 = deleted (its last op in this push)
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
        // writer's own name (key order kept); a payment check, a month close or a job expense also the
        // server's time
        if (/^(d?log|dact)\//.test(k) && Object.prototype.hasOwnProperty.call(val, 'by')) val = Object.assign({}, val, { by: actor.name });
        else if (/^(dchk|mclose|dexp)\//.test(k)) val = Object.assign({}, val, { by: actor.name, at: now });
        // a document's by is whoever attached it (the quotation check and its mails rely on it): the
        // account for a new document, else the attacher stored with it, whatever the op says
        else if (docIdOf_(k)) val = Object.assign({}, val, { by: allowed.attacher(k) || actor.name });
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
      kept[k] = delR ? 0 : 1;
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
    // and its job expenses, which an account without view.exp never received either (one sheet read, only
    // for a push that deletes a deal). Their month checks stay: accounting sees a checked expense whose
    // deal is gone, as it does a checked income line
    if (shares.length) {
      const ids = {};
      shares.forEach((k) => (ids[k.slice(7)] = 1));
      const under = (k) => k.indexOf('dexp/') === 0 && has_(ids, dealOf_(k));
      const live = liveKeys_(under);
      Object.keys(kept).forEach((k) => under(k) && (kept[k] ? (live[k] = 1) : delete live[k]));
      Object.keys(live).forEach((k) => {
        stored[k] = 1;
        seq++;
        rows.push([String(seq), k, '', '1', String(actor.name).slice(0, 100), now]);
      });
    }
    appendRows_(props, rows, seq);
    // the team's notification settings changed: mails sent from a request (codes, tests) read them again
    if (stored['scfg/notify.cfg']) {
      try {
        CacheService.getScriptCache().remove('NCFG');
      } catch (err) {
        // it expires within the hour anyway
      }
    }
    const out = { ok: true, seq: seq, n: rows.length, rejected: rejected };
    if (!actor.legacy) out.denied = denied;
    return out;
  });
}

/**
 * Append rows [seq, k, v, del, by, at] numbered up to `seq` (caller holds the lock): push_ and the
 * quotation check write through here, so the seq, its cache and compaction stay one path.
 */
function appendRows_(props, rows, seq) {
  if (!rows.length) return;
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
    // only tidying: the rows are saved, so the write succeeded (the next one tries again)
  }
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
    return { ok: true, app: 'gcc-team-sync', v: API_V, files: true, mode: mode_(A), tid: tid, it: it, notify: notifyOf_(p) };
  }
  return { ok: true, app: 'gcc-team-sync', v: API_V, files: true, mode: mode_(A), tid: tid, it: it, notify: notifyState_(A) };
}

/** hello's notify: { on, since } (see the protocol); from the cached directory, else from Properties. */
function notifyState_(A) {
  if (A && A.m === 'accounts' && A.nf) return A.nf;
  return notifyOf_(PropertiesService.getScriptProperties().getProperties());
}

function notifyOf_(p) {
  return { on: p.NOTIFY_ON === '1' ? 1 : 0, since: DATE_RE.test(String(p.NOTIFY_SINCE || '')) ? p.NOTIFY_SINCE : '' };
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
const SELF_ACTIONS = ['me', 'passwd', 'logout', 'req_send', 'req_cancel', 'req_ack', 'notify_me', 'notify_verify', 'notify_test', 'qt_check'];
const ADMIN_ACTIONS = ['users', 'user_save', 'role_save', 'role_del', 'grant_save', 'grant_del', 'req_decide', 'notify_status'];

/** The account actions (sign-in, requests, users, roles and extras); null for any other action. */
function account_(action, req, actor) {
  if (SELF_ACTIONS.indexOf(action) < 0 && ADMIN_ACTIONS.indexOf(action) < 0) return null;
  if (actor.legacy) return json_({ ok: false, error: 'login_required' });
  // every role with what it gives (the request dialog and สิทธิ์ของฉัน list them), from the cached directory
  if (action === 'me') return reply_(actor, { ok: true, mc: actor.mc, roles: rolesView_(auth_(false).roles || {}) });
  if (action === 'passwd') return json_(passwd_(req, actor));
  if (action === 'logout') {
    if (req.all) withLock_(() => bumpSv_(actor.u));
    return json_({ ok: true });
  }
  if (action === 'req_send') return replyNow_(actor, reqSend_(req, actor));
  if (action === 'req_cancel') return replyNow_(actor, reqDrop_(actor, 'REQS'));
  if (action === 'req_ack') return replyNow_(actor, reqDrop_(actor, 'RESULTS'));
  // one's own e-mail settings: any account (one that may only look manages its address too)
  if (action === 'notify_me') {
    const o = notifyMe_(req, actor);
    const w = actorNow_(actor);
    if (o.ok) o.notify = w.notify;
    return reply_(w, o);
  }
  if (action === 'notify_verify') return replyNow_(actor, notifyVerify_(req, actor));
  if (action === 'notify_test') return reply_(actor, notifyTest_(actor));
  if (action === 'qt_check') return reply_(actor, qtCheck_(req, actor));
  if (!actor.caps['set.users']) return reply_(actor, { ok: false, error: 'forbidden' });
  if (action === 'users') return reply_(actor, users_());
  if (action === 'notify_status') return reply_(actor, notifyStatus_());
  if (action === 'user_save') {
    const r = userSave_(req, actor);
    // an admin who signed out their own sessions gets no renewed token; `me` as saved (an own address)
    const who = actorNow_(actor);
    return reply_(r.self && r.bumped ? Object.assign(who, { rm: false }) : who, r.out);
  }
  const fn = { role_save: roleSave_, role_del: roleDel_, grant_save: grantSave_, grant_del: grantDel_, req_decide: reqDecide_ }[action];
  return replyNow_(actor, fn(req, actor));
}

/** reply_ with `me` as the directory says right after this request's change (its request, its badge). */
function replyNow_(actor, o) {
  return reply_(actorNow_(actor), o);
}

/** The actor with what the directory says now: fields whoOf_ leaves out when empty (a request withdrawn,
 *  an extra removed) must not keep the values from the start of the request. */
function actorNow_(actor) {
  const a = Object.assign({}, actor);
  ['req', 'rq', 'grants'].forEach((k) => delete a[k]);
  return Object.assign(a, whoOf_(auth_(false), actor.u));
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
  const A = dirOf_(db, p);
  const names = Object.keys(db.users);
  const lk = names.length ? CacheService.getScriptCache().getAll(names.map((u) => 'LK:' + ck_(u))) : {};
  return {
    ok: true,
    users: names.map((u) => Object.assign(pubN_(A, u, db.users[u]), { locked: secsLeft_(lk['LK:' + ck_(u)]) })),
    roles: rolesView_(rolesOf_(p).roles),
    grants: objProp_(p.GRANTS),
    reqs: objProp_(p.REQS),
    audit: auditTail_(50),
  };
}

/**
 * Admin: create an account (temporary password as pk, must change it) or change one. `em` sets the
 * account's notification address: stored unverified, with a code mailed to it (after the lock).
 */
function userSave_(req, actor) {
  const u = normUser_(req.u);
  const has = (v) => v !== undefined && v !== null;
  const em = has(req.em) ? emailOf_(req.em) : '';
  if (em === null) return { out: { ok: false, error: 'bad_email' } };
  const r = withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const db = usersOf_(p);
    const roles = rolesOf_(p).roles;
    // the address first: a refused code (too many this hour) changes nothing else either
    const N = objProp_(p.NOTIFY), C = objProp_(p.NCODE);
    const e = has(req.em) ? emailSet_(N, C, u, em, false) : { changed: false };
    if (e.err) return { err: e.err };
    const nvals = e.changed ? { NOTIFY: prep_(N, 'too_many_users'), NCODE: prep_(C, 'too_many_users') } : {};
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
      const q = commit_(Object.assign({ USERS: prepUsers_(db) }, nvals));
      audit_([[actor.name, u, 'user_add', { role: req.role }, '']]);
      return { x: x, bumped: false, clear: true, p: q, mail: e.mail };
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
      const q = commit_(Object.assign({ USERS: prepUsers_(db) }, nvals));
      return { x: x, bumped: bumped, clear: !!pk || !!req.unlock, p: q, mail: e.mail };
    }
    // a role set by an admin replaces a temporary role from an approved request
    const grants = objProp_(p.GRANTS);
    const g = grantOf_(grants, u);
    const vals = Object.assign({ USERS: prepUsers_(db) }, nvals);
    if (g.r) {
      delete g.r;
      setGrant_(grants, u, g);
      vals.GRANTS = JSON.stringify(grants); // only smaller
    }
    // an admin has everything: a request it sent before is withdrawn (approved later, a temporary role
    // would have narrowed the new admin)
    const rqs = objProp_(p.REQS);
    const old = role === 'admin' ? own_(rqs, u) : null;
    if (old) {
      delete rqs[u];
      vals.REQS = JSON.stringify(rqs); // only smaller
    }
    const q = commit_(vals);
    const rows = [[actor.name, u, 'user_role', { from: from, to: role }, '']];
    if (old) rows.push([actor.name, u, 'req_cancel', reqDetail_(old), 'เป็นผู้ดูแลระบบแล้ว']);
    audit_(rows);
    return { x: x, bumped: bumped, clear: !!pk || !!req.unlock, p: q, mail: e.mail };
  });
  if (r.err) return { out: { ok: false, error: r.err } };
  if (r.clear) clearFails_(u);
  const out = { ok: true, user: Object.assign(pubN_(dirOf_(usersOf_(r.p), r.p), u, r.x), { locked: lockLeft_(u) }) };
  // the code goes to the new address; whoever reads that mailbox enters it in "การแจ้งเตือนของฉัน"
  if (r.mail) codeSent_(out, sendCode_(u, r.x.n, r.mail));
  return { self: u === actor.u, bumped: r.bumped, out: out };
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
 * (res), so a request's capabilities, the admins' badge and an account's request need no Properties read;
 * also the e-mail settings (ntf = NOTIFY) for me.notify and the notification state (nf) for hello.
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
    ntf: objProp_(p.NOTIFY), nf: notifyOf_(p),
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
 * work does not narrow what the role gives for all work), less any whose `needs` is missing. An admin
 * is an admin whatever GRANTS says (a temporary role never narrows one), as activeAdmins_ counts them.
 */
function capsOf_(A, u) {
  const x = own_(A.u, u);
  if (!x) return { rid: '', caps: {} };
  const g = own_(A.grants || {}, u) || {};
  const today = today_();
  const tmp = x.r !== 'admin' && g.r && g.r.id !== 'admin' && live_(g.r.until, today) && roleExists_(A.roles || {}, g.r.id) ? String(g.r.id) : '';
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
  out.notify = nfOf_(own_(A.ntf || {}, u), r.caps);
  // the account's own temporary role and extras with their dates (สิทธิ์ของฉัน, and the note when one runs out)
  const g = own_(A.grants || {}, u);
  if (g && (g.r || (Array.isArray(g.c) && g.c.length))) out.grants = g;
  return out;
}

/** `me` in a reply (see the protocol at the top). */
function meOf_(u, w) {
  const me = { u: u, name: w.name, role: w.role, rid: w.rid, rn: w.rn, caps: w.caps };
  if (w.rq !== undefined) me.rq = w.rq;
  if (w.req) me.req = w.req;
  if (w.notify) me.notify = w.notify;
  if (w.grants) me.grants = w.grants;
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
 * is, and a log entry or contact when the account wrote its latest row. With `docs` (an account whose
 * writes are stamped) allowed.attacher(k) is who attached the document of ddoc/ key k ('' for a new one).
 * The sheet is read once, and only for a push that has such an op.
 */
function opGate_(list, caps, name, docs) {
  const deals = {}, keys = {}, ids = {};
  list.forEach((x) => {
    x.r = x.k && x.k.length <= 500 ? keyAccess_(caps, x.k, x.delR) : 0;
    if (x.r === 'deal' || x.r === 'resp') deals[dealOf_(x.k)] = 1;
    else if (x.r === 'by') keys[x.k] = 1;
    if (docs && x.r && !x.delR && docIdOf_(x.k)) ids[docIdOf_(x.k)] = 1;
  });
  const cur = latest_(deals, keys, ids);
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
    const id = docIdOf_(x.k);
    if (id && has_(ids, id) && !x.delR && val && typeof val === 'object') cur.doc[id] = String(val.by || '');
  };
  allowed.attacher = (k) => {
    const id = docIdOf_(k);
    return id && has_(cur.doc, id) ? cur.doc[id] : '';
  };
  return allowed;
}

/** The document id in ddoc/<deal>/<docId>, else ''. */
function docIdOf_(k) {
  const m = /^ddoc\/[^/]+\/([^/]+)$/.exec(k);
  return m ? m[1] : '';
}

/** The deal id in a deal record's key: deal/<id>, dstep/<id>/<stage>, dpay/<id>/<stage>, dact/<id>/<act>, dexp/<id>/<exp>. */
function dealOf_(k) {
  return k.split('/')[1] || '';
}

/**
 * From the latest row of each key: the resp of each deal id in `deals` (null when deleted) and the author
 * of each key in `keys`; from the latest live ddoc/<any deal>/<id> row of each document id in `docs`, who
 * attached it (its value's by, else that row's author). Reads the key, value, deleted and author columns
 * once (caller holds the lock).
 */
function latest_(deals, keys, docs) {
  docs = docs || {};
  const out = { resp: {}, by: {}, doc: {} };
  let left = Object.keys(deals).length + Object.keys(keys).length + Object.keys(docs).length;
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
    const id = docIdOf_(k);
    if (id && has_(docs, id) && !has_(out.doc, id) && !(vals[i][2] === 1 || vals[i][2] === true || vals[i][2] === '1') && vals[i][1] !== '') {
      let v = null;
      try {
        v = JSON.parse(vals[i][1]);
      } catch (err) {
        v = null;
      }
      if (v && typeof v === 'object') {
        out.doc[id] = typeof v.by === 'string' && v.by.trim() ? v.by : String(vals[i][3] || '');
        left--;
      }
    }
  }
  return out;
}

/**
 * The keys `test` accepts whose latest row is a value, not a deletion: { <k>: 1 } (caller holds the lock).
 * One read of the key, value and deleted columns.
 */
function liveKeys_(test) {
  const out = {}, seen = {};
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return out;
  const vals = sh.getRange(2, 2, last - 1, 3).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const k = String(vals[i][0]);
    if (!k || !test(k) || has_(seen, k)) continue;
    seen[k] = 1;
    if (!(vals[i][2] === 1 || vals[i][2] === true || vals[i][2] === '1') && vals[i][1] !== '') out[k] = 1;
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
const MONEY_NOTES = { 'dstep/': ['n'], 'dlog/': ['detail'], 'dchk/': ['note'], 'qchk/': ['note'] };

function unmoney_(s) {
  return typeof s === 'string' ? s.replace(MONEY_TEXT_RE, '…').replace(MONEY_NUM_RE, '…') : s;
}

/**
 * The deal-history detail of the web app's own money entries, which may hold amounts with no separators
 * and no บาท: a plan ("2 งวด · 500 + 750": after the count every number) and the amounts an import kept as
 * typed ('Forecast เดิม "350000"': whatever is quoted).
 */
function unmoneyLog_(action, detail) {
  const a = String(action == null ? '' : action);
  let d = unmoney_(detail);
  if (typeof d !== 'string') return d;
  if (/^(ตั้ง|แก้)แผนชำระ$/.test(a)) d = d.replace(/^(\d+ งวด · )(.*)$/, (m, head, rest) => head + rest.replace(/\d[\d,]*(?:\.\d+)?/g, '…'));
  if (a === 'จำนวนเงินจากไฟล์เดิม') d = d.replace(/"[^"]*"/g, '"…"');
  return d;
}

/**
 * A pulled row as an account without view.money / view.comm / view.exp may see it. Without view.money the
 * money fields are null (a quotation check's fp.a too) and amounts in the app's own notes and in a check's
 * note are "…"; without view.comm a revenue split
 * (dshare/) comes as a deletion and a unit (scfg/unit.*) without its rates; without view.exp (or
 * view.money, which it needs) every job-expense record (EXP_KEY_RE) comes as a deletion. The row keeps its
 * seq. Text people typed themselves ("ราคา 350000") is theirs and stays.
 */
function redact_(row, caps) {
  const k = row.k;
  if ((!caps['view.exp'] || !caps['view.money']) && EXP_KEY_RE.test(k)) return gone_(row);
  if (!caps['view.comm'] && k.indexOf('dshare/') === 0) return gone_(row);
  const v = row.v;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return row;
  let o = null;
  const edit = () => o || (o = Object.assign({}, v));
  if (!caps['view.comm'] && k.indexOf('scfg/unit.') === 0 && has_(v, 'rates')) delete edit().rates;
  if (!caps['view.money']) {
    const p = k.slice(0, k.indexOf('/') + 1);
    (MONEY_FIELDS[p] || []).forEach((f) => has_(v, f) && v[f] != null && (edit()[f] = null));
    (MONEY_NOTES[p] || []).forEach((f) => typeof v[f] === 'string' && (edit()[f] = p === 'dlog/' && f === 'detail' ? unmoneyLog_(v.action, v[f]) : unmoney_(v[f])));
    if (p === 'ddoc/' && v.auto && typeof v.auto === 'object' && typeof v.auto.n === 'string') edit().auto = Object.assign({}, v.auto, { n: unmoney_(v.auto.n) });
    // a quotation check holds the amount it checked (its fingerprint): hidden like the document's own
    if (p === 'qchk/' && v.fp && typeof v.fp === 'object' && v.fp.a != null) edit().fp = Object.assign({}, v.fp, { a: null });
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
 * account sees the result in me.req until it hides it. `id` must still be the request shown: a request
 * replaced after the admin opened it is 'changed' (the admin looks again), never approved unseen. An
 * account that is an admin now (set.users) has nothing to ask for: its old request is refused (role_locked).
 */
function reqDecide_(req, actor) {
  const u = normUser_(req.u);
  if (u === actor.u) return { ok: false, error: 'not_self' };
  const id = req.id == null ? '' : String(req.id);
  if (!id) return { ok: false, error: 'bad_req' };
  const yes = req.ok === true || req.ok === 1;
  const note = noteOf_(req.note);
  if (note === null) return { ok: false, error: 'req_note' };
  return withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const db = usersOf_(p);
    const A = dirOf_(db, p);
    const rec = own_(A.rqs, u);
    if (!rec) return { ok: false, error: 'no_request' };
    if (id !== String(rec.id)) return { ok: false, error: 'changed' };
    const x = own_(db.users, u);
    if (!x) return { ok: false, error: 'unknown_user' };
    if (yes && capsOf_(A, u).caps['set.users']) return { ok: false, error: 'role_locked' };
    const now = new Date().toISOString();
    const out = Object.assign({ ok: yes, by: actor.name, note: note, at: now }, reqDetail_(rec));
    // the history says which role a role request came from
    const detail = Object.assign(reqDetail_(rec), rec.k === 'role' ? { from: capsOf_(A, u).rid } : {});
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
    audit_([[actor.name, u, yes ? 'req_ok' : 'req_no', detail, note]]);
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
 * `needs` is missing is left out. The change applies to every account of the role on its next request. A
 * capability of LATE_CAPS_ that `c` does not name keeps the role's value, or for a new role the value of
 * the role it is copied `from` (a build from before that capability is saving).
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
      // a build from before these capabilities sends none of them: what the role has there stays (a new
      // role copied from another: what that one has)
      const was = old ? old.c : req.from != null && req.from !== '' && roleExists_(R.roles, String(req.from)) ? roleCaps_(R.roles, String(req.from)) : {};
      LATE_CAPS_.forEach((k) => !has_(req.c, k) && was[k] && (c[k] = was[k]));
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

// ------------------------------------------------------------------ notifications (e-mail) and the quotation check
//
// Script Properties:
//   NOTIFY       {<u>:{em, ok:0|1, on:{qt,res,dg,pre}, t, sc}}: each account's address (ok = verified) and choices
//   NCODE        {<u>:{h, exp, n, em, sent:[ms]}}: the code mailed to a new address (sha256 of it, expiry, wrong
//                tries) and when codes were sent (at most 3 an hour)
//   NOTIFY_ON    '1' once setupNotify installed the trigger;  NOTIFY_SINCE  the go-live day (yyyy-mm-dd)
//   NOTIFY_SEQ   the last sync row notifyTick has looked at;  NOTIFY_LAST {at, ok, sent, deferred, err} of its last run
// Sync sheet: qchk/<docId> (written only by qt_check) and scfg/notify.cfg (admins, by push):
//   { pre: days ahead a payment is listed, late: 'daily'|'mon'|'once', appt: 'today'|'today+1', self, sender, site }
// The "notify" tab: one row per mail or decision [at, kind, u, key, fp, result]; a key there is never mailed again.
// Mail goes only to verified addresses of active accounts holding notify.mail, never to a customer's address.

/** An account's e-mail settings with the defaults filled in (sc: the whole team for admins, else own work). */
function nfOf_(n, caps) {
  n = n && typeof n === 'object' ? n : {};
  const on = n.on && typeof n.on === 'object' ? n.on : {};
  const b = (v, d) => (v === 1 || v === true ? 1 : v === 0 || v === false ? 0 : d);
  const em = typeof n.em === 'string' ? n.em : '';
  return {
    em: em,
    ok: em && n.ok === 1 ? 1 : 0,
    on: { qt: b(on.qt, 1), res: b(on.res, 1), dg: b(on.dg, 1), pre: b(on.pre, 0) },
    t: NOTIFY_TIMES.indexOf(n.t) >= 0 ? n.t : '07:30',
    sc: n.sc === 'mine' || n.sc === 'team' ? n.sc : caps && caps['set.users'] ? 'team' : 'mine',
  };
}

/** An account for the admin pages: pub_ plus its notification address and settings. */
function pubN_(A, u, x) {
  const nf = nfOf_(own_(A.ntf || {}, u), capsOf_(A, u).caps);
  return Object.assign(pub_(u, x), { em: nf.em, ok: nf.ok, notify: nf });
}

/** An e-mail address as stored (trimmed, lower case); '' for none; null when it is not an address. */
function emailOf_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

/**
 * Account u's address becomes `em` in N (NOTIFY) and C (NCODE), caller holds the lock: a new address is
 * stored unverified with a fresh code to mail (mail = { to, code }); '' removes it. The same address again
 * changes nothing, unless `resend` while it is unverified. { changed, mail? } or { err: 'too_many_codes' }.
 */
function emailSet_(N, C, u, em, resend) {
  const x = Object.assign({}, own_(N, u) || {});
  const c = own_(C, u) || {};
  const now = Date.now();
  const sent = (Array.isArray(c.sent) ? c.sent : []).filter((t) => now - Number(t) < 3600000);
  if (!em) {
    if (!x.em) return { changed: false };
    delete x.em;
    x.ok = 0;
    N[u] = x;
    if (sent.length) C[u] = { sent: sent };
    else delete C[u];
    return { changed: true };
  }
  if (em === x.em && (x.ok === 1 || !resend)) return { changed: false };
  if (sent.length >= CODE6_PER_HOUR) return { err: 'too_many_codes' };
  const code = newCode6_();
  x.em = em;
  x.ok = 0;
  N[u] = x;
  C[u] = { h: code6Hash_(u, code), exp: now + CODE6_TTL_MS, n: 0, em: em, sent: sent.concat([now]) };
  return { changed: true, mail: { to: em, code: code } };
}

function newCode6_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  return bytes.slice(0, 6).map((b) => (b & 255) % 10).join('');
}

function code6Hash_(u, code) {
  return sha256hex_('ncode|' + u + '|' + code);
}

/** How a code mail went, on a reply: sent 1, or sent 0 and why ('no_quota' | 'mail_failed'). */
function codeSent_(out, err) {
  out.sent = err ? 0 : 1;
  if (err) out.mail = err;
}

/** notify_me (see the protocol at the top): read or change one's own settings and address. */
function notifyMe_(req, actor) {
  const has = (k) => req[k] !== undefined && req[k] !== null;
  if (req.get || !['on', 't', 'sc', 'em', 'resend'].some(has)) return { ok: true };
  let on = null;
  if (has('on')) {
    if (typeof req.on !== 'object' || Array.isArray(req.on)) return { ok: false, error: 'bad_notify' };
    on = {};
    const ks = Object.keys(req.on);
    for (let i = 0; i < ks.length; i++) {
      const v = req.on[ks[i]];
      if (['qt', 'res', 'dg', 'pre'].indexOf(ks[i]) < 0 || [0, 1, true, false].indexOf(v) < 0) return { ok: false, error: 'bad_notify' };
      on[ks[i]] = v === 1 || v === true ? 1 : 0;
    }
  }
  if (has('t') && NOTIFY_TIMES.indexOf(req.t) < 0) return { ok: false, error: 'bad_notify' };
  if (has('sc') && req.sc !== 'mine' && req.sc !== 'team') return { ok: false, error: 'bad_notify' };
  const em = has('em') ? emailOf_(req.em) : undefined;
  if (em === null) return { ok: false, error: 'bad_email' };
  const r = withLock_(() => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const N = objProp_(p.NOTIFY), C = objProp_(p.NCODE);
    let e = { changed: false };
    if (em !== undefined || req.resend) {
      e = emailSet_(N, C, actor.u, em !== undefined ? em : String((own_(N, actor.u) || {}).em || ''), !!req.resend);
      if (e.err) return e;
    }
    const x = Object.assign({}, own_(N, actor.u) || {});
    if (on) x.on = Object.assign({}, x.on || {}, on);
    if (has('t')) x.t = req.t;
    if (has('sc')) x.sc = req.sc;
    N[actor.u] = x;
    const vals = { NOTIFY: prep_(N, 'too_many_users') };
    if (e.changed) vals.NCODE = prep_(C, 'too_many_users');
    commit_(vals);
    return { mail: e.mail || null };
  });
  if (r.err) return { ok: false, error: r.err };
  const out = { ok: true };
  if (r.mail) codeSent_(out, sendCode_(actor.u, actor.name, r.mail));
  return out;
}

/** notify_verify: the 6-digit code mailed to the account's new address makes that address verified. */
function notifyVerify_(req, actor) {
  const digits = String(req.code == null ? '' : req.code).replace(/\D/g, '');
  if (digits.length !== 6) return { ok: false, error: 'code_wrong' };
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const p = props.getProperties();
    const N = objProp_(p.NOTIFY), C = objProp_(p.NCODE);
    const x = own_(N, actor.u), c = own_(C, actor.u);
    if (!x || !c || !c.h || c.em !== x.em || !(Number(c.exp) > Date.now()) || (Number(c.n) || 0) >= CODE6_TRIES) return { ok: false, error: 'code_expired' };
    if (!eq_(code6Hash_(actor.u, digits), c.h)) {
      c.n = (Number(c.n) || 0) + 1;
      C[actor.u] = c.n >= CODE6_TRIES ? { sent: c.sent || [] } : c; // the fifth wrong code ends this one
      props.setProperty('NCODE', JSON.stringify(C));
      return { ok: false, error: 'code_wrong' };
    }
    N[actor.u] = Object.assign({}, x, { ok: 1 });
    C[actor.u] = { sent: c.sent || [] }; // kept for the codes-per-hour limit
    commit_({ NOTIFY: prep_(N, 'too_many_users'), NCODE: JSON.stringify(C) });
    return { ok: true };
  });
}

/**
 * notify_test: one mail to one's own verified address. It counts against the day's quota, so an account
 * gets TEST_PER_HOUR an hour and TEST_PER_DAY a day ('too_many_tests'), and a test waits while no more
 * than TEST_RESERVE mails are left: tests can never use up what digests and new quotations need.
 */
function notifyTest_(actor) {
  if (!actor.caps['notify.mail']) return { ok: false, error: 'forbidden' };
  const n = actor.notify || {};
  if (!n.ok || !n.em) return { ok: false, error: 'no_email' };
  const ok = withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const T = objProp_(props.getProperty('NTEST'));
    // each account's tests of the last 24 hours (the others' older ones are dropped on the way)
    Object.keys(T).forEach((k) => {
      const l = (Array.isArray(T[k]) ? T[k] : []).filter((t) => now - Number(t) < 86400000);
      if (l.length) T[k] = l;
      else delete T[k];
    });
    const mine = own_(T, actor.u) || [];
    if (mine.length >= TEST_PER_DAY || mine.filter((t) => now - Number(t) < 3600000).length >= TEST_PER_HOUR) return false;
    T[actor.u] = mine.concat([now]);
    props.setProperty('NTEST', JSON.stringify(T));
    return true;
  });
  if (!ok) return { ok: false, error: 'too_many_tests' };
  const err = sendMail_(testMail_(liveCfg_(), actor.name, n.em), TEST_RESERVE);
  logQuiet_([['test', actor.u, 'test:' + actor.u + ':' + Date.now(), '', err || 'sent']]);
  return err ? { ok: false, error: err } : { ok: true };
}

/** The verification code to a new address; '' when sent, else why not (it waits like a digest when the
 *  day's mails run low: at most CODE6_PER_HOUR an account, they could otherwise use the quotations' share). */
function sendCode_(u, name, mail) {
  const err = sendMail_(codeMail_(liveCfg_(), name, mail.to, mail.code), NOTIFY_RESERVE);
  logQuiet_([['code', u, 'code:' + u + ':' + Date.now(), '', err || 'sent']]);
  return err;
}

/** The log rows of a mail sent from a request: the mail went out, so a busy lock must not turn the reply
 *  into an error (a code the user then asks for again); those rows only feed the day's count. */
function logQuiet_(list) {
  try {
    logNotify_(list);
  } catch (err) {
    if (!(err && err.busy)) throw err;
  }
}

/** notify_status (set.users): what the admin page's status card shows. */
function notifyStatus_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  let triggers = 0, quota = null;
  try {
    triggers = ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'notifyTick').length;
  } catch (err) {
    triggers = 0; // the trigger permission was not granted (setupNotify was never run)
  }
  try {
    quota = MailApp.getRemainingDailyQuota();
  } catch (err) {
    quota = null;
  }
  const today = today_();
  const sentToday = notifyRows_().filter((r) => r.result === 'sent' && dayOf_(r.at) === today).length;
  const nf = notifyOf_(p);
  return { ok: true, on: nf.on && triggers ? 1 : 0, since: nf.since, last: objProp_(p.NOTIFY_LAST), quotaLeft: quota, sentToday: sentToday, triggers: triggers, every: NOTIFY_EVERY_MIN };
}

/**
 * Send one mail now (never while holding the lock): '' when sent, 'no_quota' when no more than `keep`
 * mails are left today (the reserve for new quotations), else 'mail_failed'.
 */
function sendMail_(m, keep) {
  let left;
  try {
    left = MailApp.getRemainingDailyQuota();
  } catch (err) {
    return 'mail_failed';
  }
  if (!(left > keep)) return 'no_quota';
  try {
    MailApp.sendEmail(m);
  } catch (err) {
    return /too many times|quota/i.test(String((err && err.message) || err)) ? 'no_quota' : 'mail_failed';
  }
  return '';
}

// ---- settings of the whole team (scfg/notify.cfg)

/** scfg/notify.cfg with the defaults filled in (see above); site = the web app's address up to its last '/'. */
function notifyCfg_(v) {
  v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const pre = Number(v.pre);
  const sender = String(v.sender == null ? '' : v.sender).replace(/[\u0000-\u001f\u007f<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return {
    pre: Number.isInteger(pre) && pre >= 0 && pre <= 60 ? pre : DUE_SOON,
    late: ['daily', 'mon', 'once'].indexOf(v.late) >= 0 ? v.late : 'daily',
    appt: v.appt === 'today' ? 'today' : 'today+1',
    self: v.self === true,
    sender: sender || MAIL_SENDER,
    site: siteOf_(v.site),
  };
}

/** The base address links start from ('https://host/path/'), or '' when `s` is not an https address. */
function siteOf_(s) {
  const m = /^(https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)(\/[^\s"'<>?#\\]*)?/.exec(String(s || ''));
  return m ? m[1] + String(m[2] || '/').replace(/[^/]*$/, '') : '';
}

/** The team's settings for a mail sent from a request (a code, a test): cached by notifyTick, else read. */
function liveCfg_() {
  try {
    const c = CacheService.getScriptCache().get('NCFG');
    if (c) return JSON.parse(c);
  } catch (err) {
    // read below
  }
  const r = withLock_(() => latestOf_((k) => k === 'scfg/notify.cfg'))['scfg/notify.cfg'];
  const cfg = notifyCfg_(rowVal_(r));
  putCache_('NCFG', JSON.stringify(cfg), 3600);
  return cfg;
}

// ---- the sync sheet, read for a check or a run

/**
 * The latest row of each key `want` accepts: { <k>: { seq, k, v, del, by, at } } (caller holds the lock).
 * One read of the whole sheet.
 */
function latestOf_(want) {
  const out = {};
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return out;
  const vals = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const k = String(vals[i][1]);
    if (!k || has_(out, k) || !want(k)) continue;
    out[k] = rowOut_(vals[i]);
  }
  return out;
}

function rowVal_(r) {
  return r && !r.del ? r.v : null;
}

/** The latest row of every key, from rows in seq order. */
function latestMap_(rows) {
  const L = {};
  rows.forEach((r) => (L[r.k] = r));
  return L;
}

// ---- the quotation check (qt_check)

/** What a check compares: the document's amount, number, date and file (name|size), as the web app reads them. */
function fpOf_(doc) {
  return { a: doc.amount, n: doc.docNo, d: doc.docDate, f: doc.name + '|' + doc.size };
}

function fpSame_(x, y) {
  if (!x || !y || typeof y !== 'object') return false;
  const a = x.a == null ? null : Number(x.a), b = y.a == null ? null : Number(y.a);
  const sameA = a === null || b === null ? a === b : Math.abs(a - b) < 0.005;
  return sameA && String(x.n == null ? '' : x.n) === String(y.n == null ? '' : y.n) && String(x.d == null ? '' : x.d) === String(y.d == null ? '' : y.d) && String(x.f == null ? '' : x.f) === String(y.f == null ? '' : y.f);
}

function fpHash_(fp) {
  return sha256hex_('fp|' + [fp.a == null ? '' : Number(fp.a), fp.n, fp.d, fp.f].join('|')).slice(0, 16);
}

/**
 * Whether a quotation needs a check: confirmed as the Forecast (an amount) at the QUOTATION stage of an
 * open deal, on or after the go-live day (`since`). The web app's lib/notify.ts has the same rule.
 */
function qtNeeds_(doc, deal, since) {
  return !!doc && !!deal && !!since && doc.kind === 'quotation' && doc.target === 'forecast' && doc.amount != null && doc.stage === QUOTE_STAGE && deal.jobStatus !== 'closed' && dayOf_(doc.cAt || doc.at) >= since;
}

/** 'ok' | 'back' when the quotation's check still matches it, else 'wait' (none, or made before a change). */
function checkOf_(L, doc) {
  const v = rowVal_(L['qchk/' + doc.id]);
  return v && typeof v === 'object' && (v.st === 'ok' || v.st === 'back') && fpSame_(fpOf_(doc), v.fp) ? v.st : 'wait';
}

/** The deal-history id of a check (the same for its undo). */
function qcLogId_(docId, at) {
  return 'qc-' + String(docId).slice(0, 80) + '-' + (Date.parse(at) || 0).toString(36);
}

/** The signature in a quotation link: the first 16 bytes of HMAC-SHA256(AUTH_SECRET, 'lnk|u|doc|fp|exp'). */
function linkSig_(sec, u, docId, fph, exp) {
  const b = Utilities.computeHmacSha256Signature('lnk|' + u + '|' + docId + '|' + fph + '|' + exp, sec).slice(0, 16);
  return Utilities.base64EncodeWebSafe(b).replace(/=+$/, '');
}

/** The s= part of a quotation link mailed to account u: '<expiry, base 36>.<signature>.<u>'. */
function linkS_(sec, u, docId, fph, now) {
  const exp = (now + LINK_TTL_MS).toString(36);
  return exp + '.' + linkSig_(sec, u, docId, fph, exp) + '.' + u;
}

/**
 * A link's s= against the document as it is now: { ok, u } (u = whom it was mailed to). Another document,
 * a changed one, another account, a later expiry or a past one all fail. The link carries no authority:
 * it only says the check came through the mail.
 */
function linkOk_(sec, s, docId, fph, now) {
  const m = /^([0-9a-z]{1,12})\.([\w-]{22})\.([a-z0-9][a-z0-9._-]{2,31})$/.exec(String(s || ''));
  if (!m || !sec) return { ok: false };
  if (!(parseInt(m[1], 36) > now)) return { ok: false, u: m[3] };
  return { ok: eq_(linkSig_(sec, m[3], docId, fph, m[1]), m[2]), u: m[3] };
}

/**
 * qt.check: check a quotation ('ok'), send it back with a note ('back'), or undo one's own latest check
 * within 10 minutes ('undo'). Not a push: under the lock the document is compared with the sheet (see the
 * protocol at the top), then qchk/<docId> and a deal-history row are appended the way push_ appends.
 */
function qtCheck_(req, actor) {
  if (!actor.caps['qt.check']) return { ok: false, error: 'forbidden' };
  const k = String(req.k == null ? '' : req.k);
  const m = /^ddoc\/([^/]+)\/([^/]+)$/.exec(k);
  const st = req.st;
  if (!m || k.length > 500 || ['ok', 'back', 'undo'].indexOf(st) < 0) return { ok: false, error: 'bad_req' };
  const note = noteOf_(req.note);
  if (note === null || (st === 'back' && !note)) return { ok: false, error: 'req_note' };
  const dealId = m[1], docId = m[2], name = String(actor.name).slice(0, 100);
  const out = withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    // this document under any deal (a quotation merged into a joint one moves there), its check, the deal
    const L = latestOf_((key) => key === 'qchk/' + docId || key === 'deal/' + dealId || key === 'scfg/notify.cfg' || /^ddoc\/[^/]+\/[^/]+$/.test(key) && key.slice(key.lastIndexOf('/') + 1) === docId);
    const now = Date.now(), at = new Date(now).toISOString();
    let seq = Number(props.getProperty('SEQ') || 0);
    if (st === 'undo') {
      const v = rowVal_(L['qchk/' + docId]);
      if (!v || typeof v !== 'object' || v.u !== actor.u) return { ok: false, error: 'changed' };
      if (!(now - Date.parse(v.at) <= UNDO_MS)) return { ok: false, error: 'too_late' };
      const rows = [[String(++seq), 'qchk/' + docId, '', '1', name, at]];
      rows.push([String(++seq), 'dlog/' + qcLogId_(docId, v.at), '', '1', name, at]);
      appendRows_(props, rows, seq);
      return { ok: true, seq: seq };
    }
    let live = null;
    Object.keys(L).forEach((key) => {
      const r = L[key];
      if (key.indexOf('ddoc/') === 0 && !r.del && r.v != null && (!live || r.seq > live.seq)) live = r;
    });
    if (!live || live.k !== k) return { ok: false, error: 'changed' };
    const doc = toDoc_(live.v, dealId, docId);
    if (!doc || doc.kind !== 'quotation') return { ok: false, error: 'bad_req' };
    const fp = fpOf_(doc);
    if (!fpSame_(fp, req.fp)) return { ok: false, error: 'changed' };
    const cfg = notifyCfg_(rowVal_(L['scfg/notify.cfg']));
    // whoever attached it, or wrote it last (an amount corrected while checking), is not the second pair of eyes
    if (!cfg.self && (sameName_(doc.by, actor.name) || sameName_(live.by, actor.name))) return { ok: false, error: 'self_check' };
    const fph = fpHash_(fp);
    const link = req.s ? linkOk_(actor.sec, req.s, docId, fph, now) : { ok: false };
    const rec = { st: st, by: actor.name, at: at, fp: fp };
    if (note) rec.note = note;
    rec.via = link.ok ? 'mail' : 'app';
    rec.u = actor.u;
    const deal = toDeal_(rowVal_(L['deal/' + dealId]), dealId);
    const lid = qcLogId_(docId, at);
    const log = {
      id: lid, at: at, by: actor.name, action: st === 'ok' ? 'ตรวจใบเสนอราคาแล้ว' : 'ส่งใบเสนอราคากลับแก้ไข', client: deal ? deal.client : '',
      detail: ((doc.docNo || doc.name) + (note ? ' · ' + note : '')).slice(0, 300), deal: dealId,
    };
    const rows = [[String(++seq), 'qchk/' + docId, JSON.stringify(rec), '0', name, at]];
    rows.push([String(++seq), 'dlog/' + lid, JSON.stringify(log), '0', name, at]);
    appendRows_(props, rows, seq);
    // a link mailed to another checker (a forwarded mail) still needs one's own qt.check: allowed, and logged
    if (link.ok && link.u !== actor.u) appendNotify_([['fwd', actor.u, 'qchk/' + docId + ':' + at, fph, 'via:' + link.u]]);
    return { ok: true, seq: seq, chk: rec };
  });
  return out;
}

// ---- the send log (the "notify" tab of this spreadsheet, never pulled)

function notifySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(NOTIFY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(NOTIFY_SHEET);
    if (sh.getMaxColumns() > NOTIFY_HEADER.length) sh.deleteColumns(NOTIFY_HEADER.length + 1, sh.getMaxColumns() - NOTIFY_HEADER.length);
    sh.getRange(1, 1, 1, NOTIFY_HEADER.length).setValues([NOTIFY_HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Append log rows [kind, u, key, fp, result] (caller holds the lock). */
function appendNotify_(list) {
  if (!list.length) return;
  const sh = notifySheet_();
  const now = new Date().toISOString();
  const start = sh.getLastRow() + 1;
  const need = start + list.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  const rng = sh.getRange(start, 1, list.length, NOTIFY_HEADER.length);
  rng.setNumberFormat('@');
  rng.setValues(list.map((x) => [now, String(x[0] || ''), String(x[1] || ''), String(x[2] || '').slice(0, 500), String(x[3] || ''), String(x[4] || '').slice(0, 200)]));
}

/** Append log rows, taking the lock for the moment it takes (never while a mail is going out). */
function logNotify_(list) {
  if (list.length) withLock_(() => appendNotify_(list));
}

/** Every log row, oldest first: [{ at, kind, u, key, fp, result }]. */
function notifyRows_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTIFY_SHEET);
  const last = sh ? sh.getLastRow() : 0;
  if (last < 2) return [];
  return sh
    .getRange(2, 1, last - 1, NOTIFY_HEADER.length)
    .getValues()
    .filter((r) => r[0] !== '')
    .map((r) => ({ at: String(r[0]), kind: String(r[1]), u: String(r[2]), key: String(r[3]), fp: String(r[4]), result: String(r[5]) }));
}

/** Drops log rows older than 90 days (rows are in time order). */
function trimNotify_(now) {
  withLock_(() => {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTIFY_SHEET);
    if (!sh || sh.getLastRow() < 2) return;
    const cut = new Date(now - NOTIFY_KEEP_MS).toISOString();
    const at = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    let n = 0;
    while (n < at.length && String(at[n][0]) < cut) n++;
    if (n) sh.deleteRows(2, n);
  });
}

// ---- the run (notifyTick)

/**
 * Runs every 10 minutes (installed by setupNotify): new quotations to the checkers, a check's result to
 * whoever attached the quotation, new permission requests to the admins, each person's weekday digest at
 * their time, and a reminder before a timed appointment. The sync sheet is read under the lock, which is
 * released before anything is sent; the notify tab remembers what went out.
 */
function notifyTick() {
  const cache = CacheService.getScriptCache();
  try {
    if (cache.get('NTICK')) return null; // the previous run is still going
  } catch (err) {
    // the cache is only a guard
  }
  putCache_('NTICK', '1', NTICK_S);
  try {
    return notifyRun_(Date.now());
  } finally {
    try {
      cache.remove('NTICK');
    } catch (err) {
      // expires by itself
    }
  }
}

/** One run at time `now` (ms); returns what NOTIFY_LAST records. */
function notifyRun_(now) {
  const props = PropertiesService.getScriptProperties();
  const p = props.getProperties();
  const last = { at: new Date(now).toISOString(), ok: 1, sent: 0, deferred: 0, err: '' };
  const db = usersOf_(p);
  // without accounts there is nobody to mail (and no identity to check with)
  if (p.NOTIFY_ON !== '1' || !hasUsers_(db)) return saveLast_(props, last);
  const A = dirOf_(db, p);
  const ck = clockOf_(now);
  const people = peopleOf_(A);
  const mailable = people.filter((x) => x.mail);
  // what an earlier run sent but could not write to the notify tab (see below): written now, and in any
  // case never sent again
  let pend = pendOf_(p);
  if (pend.length) {
    try {
      logNotify_(pend);
      clearPend_(props);
      pend = [];
    } catch (err) {
      if (!(err && err.busy)) throw err;
    }
  }
  const logged = notifyRows_();
  const seen = {};
  logged.forEach((r) => (seen[r.key] = r.result));
  pend.forEach((x) => (seen[String(x[2])] = String(x[4])));
  if (logged.length && logged[0].at < new Date(now - NOTIFY_KEEP_MS).toISOString()) trimNotify_(now);
  const cursor = p.NOTIFY_SEQ == null || p.NOTIFY_SEQ === '' ? null : Number(p.NOTIFY_SEQ);
  const digests = mailable.filter((x) => x.nf.on.dg && ck.wd <= 5 && x.nf.t <= ck.hm && !has_(seen, 'dg:' + x.u + ':' + ck.today));
  const pres = mailable.filter((x) => x.nf.on.pre && x.caps['view.plan']);
  const preWho = pres.map((x) => x.u).sort().join(',');
  // the whole sheet is read for a reminder only when an appointment of today is about an hour away
  const preDue = pres.length > 0 && preSoon_(ck, preWho);
  const reqs = reqsDue_(A, mailable, seen, now);
  if (cursor !== null && curSeq_() <= cursor && !digests.length && !preDue && !reqs.length) return saveLast_(props, last);
  // read under the lock (only new rows, unless something needs the whole picture), then let go of it
  const snap = withLock_(() => readNew_(cursor === null ? Infinity : cursor, digests.length + reqs.length > 0 || preDue, pres.length > 0));
  const c = { A: A, ck: ck, people: people, seen: seen, out: [], logs: [], hold: Infinity, L: null, S: null, cfg: notifyCfg_(null) };
  if (snap.all) {
    c.L = latestMap_(snap.all);
    c.S = salesOf_(snap.all);
    c.cfg = notifyCfg_(rowVal_(c.L['scfg/notify.cfg']));
    putCache_('NCFG', JSON.stringify(c.cfg), 3600);
    qtMails_(c, snap.rows);
    resultMails_(c, snap.rows);
    c.waiting = waitingQts_(c);
    c.dealList = Object.keys(c.S.deals).sort().map((id) => c.S.deals[id]);
    c.tasks = tasksOf_(c.L);
    savePre_(ck, preWho, c.tasks);
    c.steps = stepsDue_(c);
    reqs.forEach((x) => c.out.push({ kind: 'req', u: x.a.u, key: x.key, fp: '', keep: 0, m: reqMail_(c, x) }));
    digests.forEach((x) => {
      const D = digestOf_(c, x);
      const key = 'dg:' + x.u + ':' + ck.today;
      if (digestCount_(D).all) c.out.push({ kind: 'dg', u: x.u, key: key, fp: '', keep: NOTIFY_RESERVE, m: digestMail_(c, x, D) });
      else c.logs.push(['dg', x.u, key, '', 'empty']);
    });
    preMails_(c, pres);
  }
  // send: the lock is not held here
  c.out.forEach((x) => {
    const err = sendMail_(x.m, x.keep);
    if (err === 'no_quota') {
      // tried again on the next run (a quotation's row is read again from where it is)
      last.deferred++;
      last.err = 'quota';
      if (x.seq) c.hold = Math.min(c.hold, x.seq);
      return;
    }
    if (err) last.err = err;
    else last.sent++;
    c.logs.push([x.kind, x.u, x.key, x.fp, err ? 'error' : 'sent']);
  });
  if (last.deferred && !has_(seen, 'quota:' + ck.today)) c.logs.push(['quota', '', 'quota:' + ck.today, '', 'deferred ' + last.deferred]);
  // the mails are out: the log is what keeps them from going out again, so a busy lock must not end the
  // run here. Tried a few times; if the lock stays busy, the rows wait in Script Properties (and the
  // cache) for the next run, which reads them as sent. The log position and NOTIFY_LAST still move on.
  const rows = pend.concat(c.logs);
  if (rows.length) {
    let tries = 3;
    for (;;) {
      try {
        logNotify_(rows);
        if (pend.length) clearPend_(props);
        break;
      } catch (err) {
        if (!(err && err.busy)) throw err;
        if (--tries > 0) continue;
        savePend_(props, rows);
        if (!last.err) last.err = 'busy';
        break;
      }
    }
  }
  const next = c.hold < Infinity ? c.hold - 1 : snap.seq;
  if (next !== cursor) props.setProperty('NOTIFY_SEQ', String(next));
  if (last.err && last.err !== 'quota' && last.err !== 'busy') last.ok = 0;
  return saveLast_(props, last);
}

function saveLast_(props, last) {
  props.setProperty('NOTIFY_LAST', JSON.stringify(last));
  return last;
}

/** Log rows [kind, u, key, fp, result] a run sent but could not write yet (NOTIFY_PEND and the cache). */
function pendOf_(p) {
  const out = [], keys = {};
  const add = (s) => {
    let l = [];
    try {
      l = JSON.parse(s || '[]');
    } catch (err) {
      l = [];
    }
    (Array.isArray(l) ? l : []).forEach((x) => {
      if (!Array.isArray(x) || has_(keys, String(x[2]))) return;
      keys[String(x[2])] = 1;
      out.push(x);
    });
  };
  add(p.NOTIFY_PEND);
  try {
    add(CacheService.getScriptCache().get('NPEND'));
  } catch (err) {
    // the property alone
  }
  return out;
}

/** Keep log rows for the next run: all of them in the cache, and in Script Properties as many as fit
 *  (the mails sent first: they are what must not go out twice). */
function savePend_(props, rows) {
  putCache_('NPEND', JSON.stringify(rows.slice(-1000)), 21600);
  let keep = rows;
  if (bytes_(JSON.stringify(keep)) > PROP_MAX_BYTES) keep = rows.filter((x) => x[4] === 'sent');
  while (keep.length && bytes_(JSON.stringify(keep)) > PROP_MAX_BYTES) keep = keep.slice(1);
  props.setProperty('NOTIFY_PEND', JSON.stringify(keep));
}

function clearPend_(props) {
  props.deleteProperty('NOTIFY_PEND');
  try {
    CacheService.getScriptCache().remove('NPEND');
  } catch (err) {
    // expires by itself
  }
}

/** Minutes since midnight of 'HH:mm'. */
function minOf_(hm) {
  return Number(String(hm).slice(0, 2)) * 60 + Number(String(hm).slice(3, 5));
}

/** A timed appointment `m` (minutes) gets its reminder in the run that falls 46-70 minutes before it
 *  (runs are about 10 minutes apart: one of them falls in this window). */
function preWindow_(m, nowMin) {
  return m - nowMin > 45 && m - nowMin <= 70;
}

/**
 * Whether a reminder before an appointment may be due now, from the times of today's open appointments
 * the last whole read saw (cache NPRE; new task/ rows make the run read again, and so does a change in
 * who has reminders on). Unknown (no cache, another day, other people): true.
 */
function preSoon_(ck, who) {
  let o = null;
  try {
    o = JSON.parse(CacheService.getScriptCache().get('NPRE') || 'null');
  } catch (err) {
    o = null;
  }
  if (!o || o.d !== ck.today || o.w !== who || !Array.isArray(o.m)) return true;
  const nowMin = minOf_(ck.hm);
  return o.m.some((m) => preWindow_(Number(m), nowMin));
}

function savePre_(ck, who, tasks) {
  const m = tasks.filter((t) => !t.done && t.date === ck.today && t.time).map((t) => minOf_(t.time));
  putCache_('NPRE', JSON.stringify({ d: ck.today, w: who, m: m }), 21600);
}

/** The team's calendar at `now`: today, tomorrow, the time (HH:mm), the weekday (1 Monday … 7 Sunday) and
 *  how many days back the previous weekday digest went out (3 on a Monday, else 1). */
function clockOf_(now) {
  const s = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd HH:mm u').split(' ');
  const wd = Number(s[2]);
  return { now: now, today: s[0], hm: s[1], wd: wd, tomorrow: addDays_(s[0], 1), gap: wd === 1 ? 3 : 1 };
}

/** Active accounts with their capabilities and settings; mail = they may get mail (verified, notify.mail). */
function peopleOf_(A) {
  const N = A.ntf || {};
  return Object.keys(A.u)
    .filter((u) => A.u[u].on === 1)
    .map((u) => {
      const caps = capsOf_(A, u).caps;
      const nf = nfOf_(own_(N, u), caps);
      return { u: u, n: A.u[u].n, caps: caps, nf: nf, mail: !!(nf.ok && nf.em && caps['notify.mail']) };
    });
}

/**
 * The sync rows after `since` and, when `full` or when those include a document or a check (or, with
 * `tasks`, an appointment), every row (caller holds the lock). { rows, all (null when not read), seq }.
 */
function readNew_(since, full, tasks) {
  const sh = sheet_();
  const seq = lockedSeq_();
  const last = sh.getLastRow();
  if (last < 2) return { rows: [], all: full ? [] : null, seq: seq };
  const ks = sh.getRange(2, 1, last - 1, 2).getValues();
  let lo = 0;
  while (lo < ks.length && !(Number(ks[lo][0]) > since)) lo++;
  const re = tasks ? /^(ddoc|qchk|task)\// : /^(ddoc|qchk)\//;
  const hot = full || ks.slice(lo).some((r) => re.test(String(r[1])));
  if (!hot) return { rows: [], all: null, seq: seq };
  const all = sh.getRange(2, 1, ks.length, HEADER.length).getValues().filter((r) => r[1] !== '').map(rowOut_);
  return { rows: all.filter((r) => r.seq > since), all: all, seq: seq };
}

/** Active checkers who get a mail about this quotation: never whoever attached it or wrote it last. */
function checkersOf_(c, doc, lastBy) {
  return c.people.filter((x) => x.mail && x.caps['qt.check'] && x.nf.on.qt && !sameName_(x.n, doc.by) && (c.cfg.self || !sameName_(x.n, lastBy)));
}

/** The account whose display name is `name`, or null. */
function personOf_(c, name) {
  for (let i = 0; i < c.people.length; i++) if (sameName_(c.people[i].n, name)) return c.people[i];
  return null;
}

/**
 * New quotations in the rows read: each needing a check (qtNeeds_) and not checked yet goes to every checker
 * once per version (fingerprint). A row waits for its file to reach Drive, up to 30 minutes; one confirmed
 * more than 48 hours ago, or more than 20 at once (an import, a first upload), is logged and not mailed.
 */
function qtMails_(c, rows) {
  const since = c.A.nf ? c.A.nf.since : '';
  const cands = [];
  rows.forEach((r) => {
    if (r.k.indexOf('ddoc/') !== 0 || r.del) return;
    const cur = c.L[r.k];
    if (!cur || cur.seq !== r.seq) return; // a later row of the same record says more
    const parts = r.k.split('/');
    if (parts.length !== 3) return;
    const doc = toDoc_(r.v, parts[1], parts[2]);
    const deal = c.S.deals[parts[1]];
    if (!qtNeeds_(doc, deal, since)) return;
    const fph = fpHash_(fpOf_(doc));
    const dk = 'qt:' + doc.id + ':' + fph;
    if (has_(c.seen, dk)) return; // decided on an earlier run
    if (checkOf_(c.L, doc) !== 'wait') {
      c.logs.push(['qt', '', dk, fph, 'checked']);
      return;
    }
    const t = Math.max(Date.parse(doc.cAt || '') || 0, Date.parse(doc.at || '') || 0);
    if (!(c.ck.now - t <= NOTIFY_OLD_MS)) {
      c.logs.push(['qt', '', dk, fph, 'skipped-old']);
      return;
    }
    if (!doc.fileId && c.ck.now - (Date.parse(r.at) || 0) < FILE_WAIT_MS) {
      c.hold = Math.min(c.hold, r.seq);
      return;
    }
    const all = checkersOf_(c, doc, cur.by);
    const to = all.filter((x) => !has_(c.seen, dk + ':' + x.u));
    if (to.length) cands.push({ doc: doc, deal: deal, fph: fph, dk: dk, all: all, to: to, seq: r.seq });
  });
  if (cands.length > NOTIFY_BULK) {
    cands.forEach((q) => c.logs.push(['qt', '', q.dk, q.fph, 'skipped-bulk']));
    return;
  }
  cands.forEach((q) => {
    const att = personOf_(c, q.doc.by);
    q.to.forEach((x) => c.out.push({ kind: 'qt', u: x.u, key: q.dk + ':' + x.u, fp: q.fph, seq: q.seq, keep: 0, m: qtMail_(c, q, x, att) }));
  });
}

/** The latest live ddoc/<deal>/<docId> of a document id: { k, row, doc }, or null. */
function liveDoc_(L, docId) {
  let best = null;
  Object.keys(L).forEach((k) => {
    const r = L[k];
    if (k.indexOf('ddoc/') !== 0 || r.del || r.v == null) return;
    const parts = k.split('/');
    if (parts.length === 3 && parts[2] === docId && (!best || r.seq > best.seq)) best = r;
  });
  if (!best) return null;
  const parts = best.k.split('/');
  const doc = toDoc_(best.v, parts[1], parts[2]);
  return doc ? { k: best.k, row: best, doc: doc } : null;
}

/**
 * Checks in the rows read: the result goes to whoever attached the quotation, once the checker can no
 * longer undo it (10 minutes); an undone check (a later deletion) sends nothing.
 */
function resultMails_(c, rows) {
  rows.forEach((r) => {
    if (r.k.indexOf('qchk/') !== 0 || r.del) return;
    const cur = c.L[r.k];
    if (!cur || cur.seq !== r.seq) return; // undone, or checked again since
    const v = r.v;
    if (!v || typeof v !== 'object' || (v.st !== 'ok' && v.st !== 'back')) return;
    const docId = r.k.slice(5);
    const key = 'res:' + docId + ':' + v.at;
    if (has_(c.seen, key)) return;
    if (c.ck.now - (Date.parse(v.at) || Date.parse(r.at) || 0) < RESULT_WAIT_MS) {
      c.hold = Math.min(c.hold, r.seq);
      return;
    }
    const d = liveDoc_(c.L, docId);
    if (!d) return;
    const x = personOf_(c, d.doc.by);
    if (!x || !x.mail || !x.nf.on.res || x.u === v.u) return;
    c.out.push({ kind: 'res', u: x.u, key: key, fp: '', seq: r.seq, keep: 0, m: resultMail_(c, v, d, x) });
  });
}

/** Requests waiting for a decision that an admin has not been mailed about yet (sent in the last 48 hours). */
function reqsDue_(A, mailable, seen, now) {
  const out = [];
  const q = A.rqs || {};
  Object.keys(q).forEach((u) => {
    const who = own_(A.u, u), rec = q[u];
    if (!who || who.on !== 1 || !rec || !rec.id || !(now - (Date.parse(rec.at) || 0) <= NOTIFY_OLD_MS)) return;
    mailable.forEach((a) => {
      const key = 'rq:' + rec.id + ':' + a.u;
      if (a.caps['set.users'] && a.u !== u && !has_(seen, key)) out.push({ u: u, n: who.n, rec: rec, a: a, key: key });
    });
  });
  return out;
}

/** Quotations waiting for a check, oldest first: [{ doc, deal, by (wrote it last), fph, day }]. */
function waitingQts_(c) {
  const since = c.A.nf ? c.A.nf.since : '';
  const out = [];
  Object.keys(c.S.docs).forEach((k) => {
    const doc = c.S.docs[k];
    const deal = c.S.deals[doc.deal];
    if (!qtNeeds_(doc, deal, since) || checkOf_(c.L, doc) !== 'wait') return;
    const row = c.L['ddoc/' + k];
    out.push({ doc: doc, deal: deal, by: row ? row.by : '', fph: fpHash_(fpOf_(doc)), day: dayOf_(doc.cAt || doc.at) });
  });
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.deal.client.localeCompare(b.deal.client));
}

/** Appointments (task/*) with the company's ผู้รับผิดชอบ (owner/<gid>), the person they go to. */
function tasksOf_(L) {
  const out = [];
  Object.keys(L).forEach((k) => {
    if (k.indexOf('task/') !== 0) return;
    const v = rowVal_(L[k]);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    const gid = v.gid == null ? '' : String(v.gid);
    out.push({
      id: k.slice(5), gid: gid, title: pStr_(v.title, 200), type: pStr_(v.type, 20), note: pStr_(v.note, 300), done: v.done === true,
      date: pIso_(v.date).slice(0, 10), time: /^\d{2}:\d{2}/.test(String(v.time || '')) ? String(v.time).slice(0, 5) : '',
      resp: String(rowVal_(L['owner/' + gid]) || ''),
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
}

/** Deal stages dated today or tomorrow on open deals (a won deal's planned instalments are payments instead). */
function stepsDue_(c) {
  const S = c.S, ck = c.ck, out = [];
  const pays = payStages_(S.cfg);
  Object.keys(S.steps).forEach((key) => {
    const j = key.indexOf('/');
    const deal = S.deals[key.slice(0, j)], stage = key.slice(j + 1), st = S.steps[key];
    if (!deal || deal.jobStatus === 'closed' || S.cfg.stages.indexOf(stage) < 0) return;
    if (st.d !== ck.today && st.d !== ck.tomorrow) return;
    // dated today with something written (a call logged, a document attached) is done, not to do
    if (st.d === ck.today && String(st.n || '').trim()) return;
    if (pays.indexOf(stage) >= 0 && dealResult_(S, deal) === 'YES' && planLines_(S, deal)) return;
    out.push({ deal: deal, stage: stage, d: st.d });
  });
  return out.sort((a, b) => a.d.localeCompare(b.d) || a.deal.client.localeCompare(b.deal.client));
}

/** Late instalments in a digest: every day, on Mondays (and the first day late), or only the first day late. */
function lateShown_(mode, lateDays, ck) {
  if (mode === 'daily') return true;
  const fresh = lateDays >= 1 && lateDays <= ck.gap; // late since the previous weekday digest
  return mode === 'mon' ? ck.wd === 1 || fresh : fresh;
}

/**
 * What one person's digest holds, by what their capabilities show: qt (quotations waiting for them to
 * check), pay (instalments: late / due today / within cfg.pre days, and the total still owed) and appt
 * (today / tomorrow / late appointments). sc 'mine' keeps their own work (ผู้รับผิดชอบ = their name).
 */
function digestOf_(c, x) {
  const ck = c.ck, today = ck.today, mine = x.nf.sc === 'mine';
  const ours = (name) => !mine || sameName_(name, x.n);
  const D = { qt: null, pay: null, appt: null };
  if (x.caps['qt.check']) D.qt = c.waiting.filter((q) => c.cfg.self || (!sameName_(q.doc.by, x.n) && !sameName_(q.by, x.n)));
  if (x.caps['view.money']) {
    const P = { late: [], today: [], soon: [], total: 0 };
    payDue_(c.S, c.dealList.filter((d) => ours(d.resp)), '', addDays_(today, c.cfg.pre), today).forEach((e) => {
      const l = e.line;
      if (l.due < today) {
        if (!lateShown_(c.cfg.late, l.lateDays, ck)) return;
        P.late.push(e);
      } else (l.due === today ? P.today : P.soon).push(e);
      P.total += l.left;
    });
    D.pay = P;
  }
  if (x.caps['view.plan'] || x.caps['view.sales']) {
    const two = c.cfg.appt === 'today+1';
    const A = { today: [], tomorrow: [], late: [] };
    if (x.caps['view.plan'])
      c.tasks.forEach((t) => {
        if (t.done || !t.date || !ours(t.resp)) return;
        if (t.date === today) A.today.push({ t: t });
        else if (two && t.date === ck.tomorrow) A.tomorrow.push({ t: t });
        else if (t.date < today) A.late.push({ t: t });
      });
    if (x.caps['view.sales'])
      c.steps.forEach((e) => {
        if (!ours(e.deal.resp)) return;
        if (e.d === today) A.today.push({ s: e });
        else if (two) A.tomorrow.push({ s: e });
      });
    D.appt = A;
  }
  return D;
}

function digestCount_(D) {
  const qt = D.qt ? D.qt.length : 0;
  const pay = D.pay ? D.pay.late.length + D.pay.today.length + D.pay.soon.length : 0;
  const appt = D.appt ? D.appt.today.length + D.appt.tomorrow.length + D.appt.late.length : 0;
  return { qt: qt, pay: pay, appt: appt, all: qt + pay + appt };
}

/** A reminder about 1 hour before each timed appointment today, to whoever chose it. */
function preMails_(c, pres) {
  if (!pres.length) return;
  const nowMin = minOf_(c.ck.hm);
  const soon = c.tasks.filter((t) => !t.done && t.date === c.ck.today && t.time && preWindow_(minOf_(t.time), nowMin));
  pres.forEach((x) => {
    soon.forEach((t) => {
      if (x.nf.sc === 'mine' && !sameName_(t.resp, x.n)) return;
      const key = 'pre:' + t.id + ':' + t.date + ':' + t.time + ':' + x.u;
      if (!has_(c.seen, key)) c.out.push({ kind: 'pre', u: x.u, key: key, fp: '', keep: NOTIFY_RESERVE, m: preMail_(c, x, t) });
    });
  });
}

// ---- parity: sales.ts ----
// Plain ports of the web app's rules (app/src/lib/sales.ts and format.ts) that the reminders follow, kept
// line for line so a digest lists exactly the instalments the web app shows (a test compares them on random
// data): how records are read (toDeal / toDoc / toPay / toStep), dealResult, wonDate, dueOf, planLines, the
// status part of lineView, and payDue, which also lists a closed job with money still owed (as Cashflow
// counts it) and nothing for a joint quotation's member (its header deal carries the money).

const DEFAULT_STAGES = ['CALL1', 'CALL2', 'QUOTATION', 'FOLLOW1', 'FOLLOW2', 'CLOSED DEAL', 'PAY1', 'PAY2'];
const STAGE_TH = { CALL1: 'โทรครั้งที่ 1', CALL2: 'โทรครั้งที่ 2', QUOTATION: 'ส่งใบเสนอราคา', FOLLOW1: 'ติดตามครั้งที่ 1', FOLLOW2: 'ติดตามครั้งที่ 2', 'CLOSED DEAL': 'ผลการขาย (YES / NO)', PAY1: 'ชำระงวดที่ 1', PAY2: 'ชำระงวดที่ 2' };
const DEAL_STAGE = 'CLOSED DEAL';
const QUOTE_STAGE = 'QUOTATION';
const DUE_SOON = 7;
const DOC_KINDS = ['quotation', 'invoice', 'receipt', 'other'];
const DOC_TARGETS = ['forecast', 'actual', 'none'];
const DOC_BASES = ['total', 'subtotal', 'netPay', 'manual'];

function pStr_(v, max) {
  return (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' ? String(v) : '').slice(0, max === undefined ? 3000 : max);
}

function pNum_(v) {
  return typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null;
}

function pIso_(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 40) : '';
}

/** toDeal: the fields the reminders use. */
function toDeal_(v, id) {
  if (!v || typeof v !== 'object') return null;
  return { id: id, client: pStr_(v.client, 200) || 'ลูกค้า', resp: pStr_(v.resp, 100), gid: pNum_(v.gid), jobStatus: v.jobStatus === 'closed' ? 'closed' : 'open', forecast: pNum_(v.forecast) };
}

function toDoc_(v, deal, id) {
  if (!v || typeof v !== 'object') return null;
  const amount = pNum_(v.amount);
  const fileId = pStr_(v.fileId, 200);
  const doc = {
    id: id, deal: deal, kind: DOC_KINDS.indexOf(v.kind) >= 0 ? v.kind : 'other', name: pStr_(v.name, 120) || 'เอกสาร', size: pNum_(v.size) ?? 0,
    fileId: /^[\w-]{0,200}$/.test(fileId) ? fileId : '', docNo: pStr_(v.docNo, 60), docDate: pIso_(v.docDate).slice(0, 10), amount: amount,
    target: amount == null ? 'none' : DOC_TARGETS.indexOf(v.target) >= 0 ? v.target : 'none', detected: pNum_(v.detected),
    basis: DOC_BASES.indexOf(v.basis) >= 0 ? v.basis : 'manual', stage: pStr_(v.stage, 60), at: pIso_(v.at), by: pStr_(v.by, 100),
  };
  if (pIso_(v.cAt)) doc.cAt = pIso_(v.cAt);
  if (v.kept === true) doc.kept = true;
  return doc;
}

function toStep_(v) {
  return v && typeof v === 'object' ? { d: pIso_(v.d).slice(0, 10), n: pStr_(v.n, 3000) } : null;
}

function toPay_(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const amt = pNum_(v.amt), got = pNum_(v.got), pct = pNum_(v.pct), rel = pNum_(v.rel), fullAt = pNum_(v.fullAt);
  return {
    amt: amt != null && amt >= 0 ? amt : null,
    pct: pct != null && pct >= 0 && pct <= 100 ? pct : null,
    due: pIso_(v.due).slice(0, 10),
    rel: rel != null && Number.isInteger(rel) && rel >= -365 && rel <= 730 ? rel : null,
    rcv: pIso_(v.rcv).slice(0, 10),
    got: got != null && got >= 0 ? got : null,
    full: v.full === true,
    fullAt: fullAt != null && fullAt >= 0 ? fullAt : null,
    add: v.add === true,
  };
}

/**
 * The tracker as the web app holds it, from sync rows in seq order applied the way teamSync applyRow applies
 * them (a deletion removes, a record that can't be read leaves the one before): { cfg: { stages }, deals,
 * steps, docs, pays (keyed '<deal>/<stage>' / '<deal>/<docId>'), docsBy (a deal's documents by time), jqt, jqm }.
 */
function salesOf_(rows) {
  const S = { cfg: { stages: DEFAULT_STAGES.slice() }, deals: {}, steps: {}, docs: {}, pays: {}, docsBy: {}, jqt: {}, jqm: {} };
  rows.forEach((r) => {
    const k = String(r.k), i = k.indexOf('/');
    if (i < 0) return;
    const type = k.slice(0, i), rest = k.slice(i + 1), j = rest.indexOf('/');
    const del = !!r.del || r.v == null;
    const put = (bag, v) => {
      if (del) delete bag[rest];
      else if (v) bag[rest] = v;
    };
    if (type === 'deal') put(S.deals, del ? null : toDeal_(r.v, rest));
    else if (type === 'dstep' && j >= 0) put(S.steps, del ? null : toStep_(r.v));
    else if (type === 'ddoc' && j >= 0) put(S.docs, del ? null : toDoc_(r.v, rest.slice(0, j), rest.slice(j + 1)));
    else if (type === 'dpay' && j >= 0) put(S.pays, del ? null : toPay_(r.v));
    else if (k === 'scfg/stages' && !del && Array.isArray(r.v)) S.cfg.stages = r.v.map(String);
    else if (type === 'jqt') put(S.jqt, 1);
    else if (type === 'jqm' && j >= 0) put(S.jqm, 1);
  });
  Object.keys(S.docs).forEach((k) => {
    const doc = S.docs[k];
    (S.docsBy[doc.deal] || (S.docsBy[doc.deal] = [])).push(doc);
  });
  Object.keys(S.docsBy).forEach((id) => S.docsBy[id].sort((a, b) => (a.at || '').localeCompare(b.at || '')));
  return S;
}

function addDays_(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween_(a, b) {
  return Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5);
}

/** localDay: an ISO time's day in the team's time zone (a day stays as it is). */
function dayOf_(iso) {
  if (/^\d{4}-\d\d-\d\d$/.test(iso || '')) return iso;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso || '').slice(0, 10) : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function stepOf_(S, id, stage) {
  return S.steps[id + '/' + stage] || { d: '', n: '' };
}

function payStages_(cfg) {
  const i = cfg.stages.indexOf(DEAL_STAGE);
  return i < 0 ? [] : cfg.stages.slice(i + 1).filter((p) => /^PAY/i.test(p));
}

function stageTh_(p) {
  return STAGE_TH[p] || (/^PAY(\d+)$/i.test(p) ? 'ชำระงวดที่ ' + +p.slice(3) : '');
}

function dealResult_(S, d) {
  const v = stepOf_(S, d.id, DEAL_STAGE).n.trim().toUpperCase();
  return v === 'YES' ? 'YES' : v === 'NO' ? 'NO' : v ? 'WAIT' : '';
}

function wonDate_(S, d) {
  return dealResult_(S, d) === 'YES' ? stepOf_(S, d.id, DEAL_STAGE).d : '';
}

function dueOf_(l, won) {
  return l.due || (l.rel != null && won ? addDays_(won, l.rel) : '');
}

/** jointRole: 'header' with jqt/<id>, 'member' with a jqm/<header>/<id> whose header deal exists, else 'plain'. */
function jointRole_(S, d) {
  if (S.jqt[d.id]) return 'header';
  return Object.keys(S.jqm).some((k) => k.slice(k.indexOf('/') + 1) === d.id && !!S.deals[k.slice(0, k.indexOf('/'))]) ? 'member' : 'plain';
}

function planLines_(S, d) {
  const pre = d.id + '/';
  const names = Object.keys(S.pays).filter((k) => k.indexOf(pre) === 0).map((k) => k.slice(pre.length));
  if (!names.length) return null;
  const pays = payStages_(S.cfg), no = (p) => +p.replace(/\D/g, '') || 99;
  return pays
    .filter((p) => names.indexOf(p) >= 0)
    .concat(names.filter((p) => pays.indexOf(p) < 0).sort((a, b) => no(a) - no(b) || a.localeCompare(b)))
    .map((stage, i) => ({ stage: stage, n: i + 1, inList: pays.indexOf(stage) >= 0, line: S.pays[pre + stage] }));
}

/** lineView without the display fields: amt, due, got, status, left, lateDays. */
function lineView_(S, d, x, today) {
  const docs = (S.docsBy[d.id] || []).filter((z) => z.stage === x.stage && z.target === 'actual' && z.amount != null);
  const l = x.line, hand = !!l.rcv && (!docs.length || l.add);
  const handGot = hand ? (l.got ?? l.amt ?? 0) : 0;
  const got = docs.reduce((a, z) => a + (z.amount || 0), 0) + handGot;
  const amt = l.amt ?? 0, res = dealResult_(S, d), due = dueOf_(l, wonDate_(S, d));
  const full = l.full && (l.fullAt == null || Math.abs(got - l.fullAt) < 0.005);
  const status =
    res === 'NO' ? 'off'
    : got > 0 && (got >= amt || full) ? 'paid'
    : got > 0 ? 'part'
    : res !== 'YES' ? 'draft'
    : due && due < today ? 'late'
    : due && daysBetween_(today, due) <= DUE_SOON ? 'due'
    : 'wait';
  const owed = status === 'part' || status === 'late' || status === 'due' || status === 'wait';
  return { stage: x.stage, n: x.n, inList: x.inList, amt: amt, due: due, got: got, status: status, left: owed ? Math.max(0, amt - got) : 0, lateDays: owed && due && due < today ? daysBetween_(due, today) : 0 };
}

/** Instalments still to be received of won deals, due from `from` to `to` (from '' = also every late one), soonest first. */
function payDue_(S, deals, from, to, today) {
  const out = [];
  deals.forEach((d) => {
    if (dealResult_(S, d) !== 'YES' || jointRole_(S, d) === 'member') return;
    (planLines_(S, d) || []).forEach((x) => {
      const l = lineView_(S, d, x, today);
      if (l.status !== 'paid' && l.status !== 'off' && l.due && l.due >= from && l.due <= to) out.push({ deal: d, line: l });
    });
  });
  return out.sort((a, b) => a.line.due.localeCompare(b.line.due) || a.deal.client.localeCompare(b.deal.client));
}

// ---- end of parity: sales.ts ----

// ---- the mails (table layout, inline styles, 600px wide; Gmail drops web fonts, so nothing depends on Kanit)

const MC = { ink: '#0E1430', ink2: '#475069', muted: '#5E6680', link: '#1745B8', brand: '#1F5BD8', frame: '#F6F8FE', tint: '#F0F4FD', line: '#E6EBF5', div: '#EEF1F8', ok: '#0B6B45', bad: '#A3301A', badBg: '#FDE8E3', warn: '#8A4B00', warnBg: '#FFF1D6' };
const MFONT = "Kanit,'Noto Sans Thai','Leelawadee UI',Tahoma,Arial,sans-serif";
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_WD = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_WD_S = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TASK_TH = { call: 'โทร', email: 'อีเมล', meet: 'นัดพบ', follow: 'ติดตามผล' };
const BASIS_TH = { total: 'รวม VAT', subtotal: 'ก่อน VAT', netPay: 'หลังหักภาษี ณ ที่จ่าย', manual: 'ยอดที่พิมพ์' };

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 101650 → '101,650'; 1234.5 → '1,234.5' (fmtMoney: thousands separators, up to 2 decimals). */
function baht_(n) {
  const r = Math.round(Number(n) * 100) / 100;
  const parts = Math.abs(r).toFixed(2).split('.');
  const f = parts[1] === '00' ? '' : '.' + parts[1].replace(/0$/, '');
  return (r < 0 ? '-' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + f;
}

/** '2026-10-12' → '12 ต.ค.'; o.y adds the Buddhist year; o.wd 'short' / 'full' puts the weekday first. */
function thDay_(iso, o) {
  const s = String(iso || '').slice(0, 10);
  if (!DATE_RE.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  let out = d.getUTCDate() + ' ' + TH_MON[d.getUTCMonth()];
  if (o && o.y) out += ' ' + (d.getUTCFullYear() + 543);
  if (o && o.wd) out = (o.wd === 'full' ? TH_WD : TH_WD_S)[d.getUTCDay()] + ' ' + out;
  return out;
}

/** An ISO time → '12 ต.ค. 2569 09:40' in the team's time zone. */
function thAt_(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return thDay_(Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), { y: 1 }) + ' ' + Utilities.formatDate(d, TZ, 'HH:mm');
}

/** A link into the web app ('' until an admin saved the team settings, which hold the site's address). */
function go_(cfg, hash) {
  return cfg.site ? cfg.site + (hash ? '#' + hash : '') : '';
}

function mChip_(text, fg, bg) {
  return '<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:' + bg + ';color:' + fg + ';font-size:12px;line-height:18px;white-space:nowrap">' + esc_(text) + '</span>';
}

function mA_(text, href, style) {
  return href ? '<a href="' + esc_(href) + '" style="' + style + ';text-decoration:none">' + esc_(text) + '</a>' : '<span style="' + style + '">' + esc_(text) + '</span>';
}

function mButton_(text, href) {
  if (!href) return '';
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:' + MC.brand + ';border-radius:999px"><a href="' + esc_(href) + '" style="display:inline-block;padding:12px 32px;font-family:' + MFONT + ';font-size:16px;font-weight:500;line-height:22px;color:#FFFFFF;text-decoration:none">' + esc_(text) + '</a></td></tr></table>';
}

/** The frame of every mail: the brand band (the logo needs the site's address), the body rows, the footer. */
function mShell_(cfg, pre, small, body, footHtml) {
  const logo = cfg.site ? '<td style="padding-right:12px;vertical-align:middle"><img src="' + esc_(cfg.site + 'icon-192.png') + '" width="34" height="34" alt="" style="display:block;border-radius:50%;background:#FFFFFF"></td>' : '';
  return '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:' + MC.frame + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc_(pre) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MC.frame + ';font-family:' + MFONT + '"><tr><td align="center" style="padding:24px 12px 32px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid ' + MC.line + ';border-radius:20px;border-collapse:separate">' +
    '<tr><td style="background:' + MC.brand + ';border-radius:19px 19px 0 0;padding:16px 28px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' + logo +
    '<td style="vertical-align:middle;font-family:Montserrat,Arial,sans-serif;font-weight:700;font-size:18px;line-height:22px;color:#FFFFFF">Global Carbon Corporation</td></tr></table>' +
    '<div style="font-family:' + MFONT + ';font-size:13px;line-height:20px;color:#E3EAFB;padding-top:4px">' + esc_(small) + '</div></td></tr>' +
    body +
    '<tr><td style="border-top:1px solid ' + MC.div + ';padding:16px 28px 22px;font-family:' + MFONT + ';font-size:12px;line-height:19px;color:' + MC.muted + '">' + footHtml + '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function mSettings_(cfg) {
  return mA_('ตั้งค่าการแจ้งเตือนของฉัน', go_(cfg, 'go=notify'), 'color:' + MC.link);
}

function mSec_(title, right) {
  return '<tr><td style="padding:22px 28px 4px;font-family:' + MFONT + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-size:16px;font-weight:500;line-height:24px;color:' + MC.ink + '">' + esc_(title) + '</td>' +
    '<td align="right" style="font-size:13px;line-height:24px;color:' + MC.ink2 + '">' + esc_(right || '') + '</td></tr></table></td></tr>';
}

function mSub_(text) {
  return '<tr><td style="padding:10px 28px 2px;font-family:' + MFONT + ';font-size:12px;line-height:18px;color:' + MC.muted + '">' + esc_(text) + '</td></tr>';
}

function mNone_(text) {
  return '<tr><td style="padding:4px 28px 6px;font-family:' + MFONT + ';font-size:13px;line-height:20px;color:' + MC.muted + '">' + esc_(text) + '</td></tr>';
}

/** One list row: the name (a link into the web app), one line under it, and a right cell (text + a chip or a link). */
function mRow_(name, href, line, right, rightHtml) {
  return '<tr><td style="padding:0 28px;font-family:' + MFONT + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="padding:9px 0;border-bottom:1px solid ' + MC.div + ';vertical-align:top">' + mA_(name, href, 'font-size:14px;font-weight:500;line-height:22px;color:' + MC.ink) + '<br>' +
    '<span style="font-size:13px;line-height:20px;color:' + MC.ink2 + '">' + esc_(line) + '</span></td>' +
    '<td align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid ' + MC.div + ';vertical-align:top;white-space:nowrap">' +
    '<span style="font-size:14px;line-height:22px;color:' + MC.ink + '">' + esc_(right || '') + '</span><br>' + (rightHtml || '') + '</td></tr></table></td></tr>';
}

function mMore_(n) {
  return n > 0 ? mNone_('และอีก ' + n + ' รายการ ดูได้ในเว็บ') : '';
}

/** A titled block of lines (a value table, a note) on the light panel. */
function mPanel_(title, innerHtml) {
  return '<tr><td style="padding:14px 28px 24px;font-family:' + MFONT + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MC.tint + ';border-radius:14px;border-collapse:separate"><tr><td style="padding:12px 18px 10px">' +
    '<div style="font-size:13px;line-height:20px;color:' + MC.ink2 + ';padding-bottom:6px">' + esc_(title) + '</div>' + innerHtml + '</td></tr></table></td></tr>';
}

function mValue_(label, value, sub, subColor, strong) {
  return '<tr><td style="padding:8px 0;border-top:1px solid ' + MC.line + ';font-size:13px;line-height:20px;color:' + MC.ink2 + ';width:132px;vertical-align:top">' + esc_(label) + '</td>' +
    '<td style="padding:8px 0;border-top:1px solid ' + MC.line + ';line-height:22px;vertical-align:top"><span style="font-size:' + (strong ? '18px;font-weight:500' : '14px') + ';color:' + MC.ink + '">' + esc_(value) + '</span>' +
    (sub ? '<br><span style="font-size:12px;color:' + (subColor || MC.ink2) + '">' + esc_(sub) + '</span>' : '') + '</td></tr>';
}

function mHead_(kicker, title, lines) {
  return '<tr><td style="padding:24px 28px 4px;font-family:' + MFONT + '">' +
    (kicker ? '<div style="font-size:13px;line-height:20px;color:' + MC.ink2 + '">' + esc_(kicker) + '</div>' : '') +
    '<div style="font-size:24px;font-weight:500;line-height:34px;color:' + MC.ink + '">' + esc_(title) + '</div>' +
    lines.map((l, i) => '<div style="font-size:' + (i === 0 ? '16px;line-height:26px;color:' + MC.ink : '13px;line-height:20px;color:' + MC.ink2) + '">' + l + '</div>').join('') + '</td></tr>';
}

function mPara_(html) {
  return '<tr><td style="padding:8px 28px 4px;font-family:' + MFONT + ';font-size:13px;line-height:21px;color:' + MC.muted + '">' + html + '</td></tr>';
}

function mBtnRow_(text, href) {
  return href ? '<tr><td style="padding:16px 28px 2px">' + mButton_(text, href) + '</td></tr>' : '';
}

/** MailApp's message: one recipient, the HTML and a plain-text copy, the team's sender name. */
function msg_(cfg, to, subject, html, text, replyTo) {
  const m = { to: to, subject: subject.slice(0, 250), htmlBody: html, body: text, name: cfg.sender };
  if (replyTo && replyTo !== to) m.replyTo = replyTo;
  return m;
}

/** "ใบเสนอราคาใหม่รอตรวจ" to one checker (screen 01): its button opens the check in the web app. */
function qtMail_(c, q, x, att) {
  const doc = q.doc, cfg = c.cfg;
  const amt = baht_(doc.amount) + ' บาท', no = doc.docNo || doc.name, client = q.deal.client;
  const href = go_(cfg, 'go=qt&doc=' + encodeURIComponent(doc.id) + '&s=' + linkS_(c.A.sec, x.u, doc.id, q.fph, c.ck.now));
  const others = q.all.filter((y) => y.u !== x.u).map((y) => y.n);
  const kept = doc.kept && doc.detected != null && Math.abs(doc.amount - doc.detected) >= 0.005;
  const values =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:' + MFONT + '">' +
    mValue_('ลูกค้า', client) +
    mValue_('เลขที่', doc.docNo || '—') +
    mValue_('ลงวันที่', thDay_(doc.docDate, { y: 1 }) || '—') +
    (kept ? mValue_('ยอดในเอกสาร', baht_(doc.detected) + ' บาท') : '') +
    mValue_('ยอด' + (BASIS_TH[doc.basis] ? ' (' + BASIS_TH[doc.basis] + ')' : ''), amt, 'นับเป็น Forecast ของงานนี้', MC.ink2, true) +
    '</table>';
  const body =
    mHead_('ใบเสนอราคาใหม่รอตรวจ', client, [esc_(no + ' · ' + amt) + (BASIS_TH[doc.basis] ? ' <span style="font-size:13px;color:' + MC.ink2 + '">' + esc_(BASIS_TH[doc.basis]) + '</span>' : ''), esc_(doc.by + ' แนบเมื่อ ' + thAt_(doc.cAt || doc.at))]) +
    mBtnRow_('ตรวจและอนุมัติ', href) +
    mPara_(href ? 'ปุ่มนี้เปิดเว็บ (ต้องเข้าสู่ระบบ) ให้ดูไฟล์คู่กับตัวเลข แล้วกด “ข้อมูลถูกต้อง อนุมัติ” หรือ “ส่งกลับแก้ไข”' : 'เปิดเว็บ Sales Tracker แล้วกด “ตรวจใบนี้” ที่ใบเสนอราคาของงานนี้') +
    mPanel_('ค่าที่บันทึกไว้กับไฟล์ ' + doc.name, values);
  const foot = esc_('ส่งถึง ' + x.n + ' เพราะบัญชีนี้มีสิทธิ์ตรวจใบเสนอราคา' + (others.length ? ' · ส่งให้ ' + others.join(', ') + ' ด้วย คนใดคนหนึ่งตรวจก็พอ' : '')) + '<br>' +
    (att && att.nf.ok ? esc_('ตอบกลับอีเมลนี้จะถึง ' + att.n) + ' · ' : '') + mSettings_(cfg);
  const html = mShell_(cfg, doc.by + ' แนบ ' + no + ' ของ ' + client + ' ' + amt + ' รอตรวจ', 'Sales Tracker · ใบเสนอราคารอตรวจ', body, foot);
  const text = ['ใบเสนอราคาใหม่รอตรวจ', client, no + ' · ' + amt, doc.by + ' แนบเมื่อ ' + thAt_(doc.cAt || doc.at), '', href ? 'ตรวจและอนุมัติ: ' + href : 'ตรวจได้ในเว็บ Sales Tracker', '(ต้องเข้าสู่ระบบ ลิงก์นี้ไม่อนุมัติอะไรเอง)'].join('\n');
  return msg_(cfg, x.nf.em, 'ใบเสนอราคาใหม่รอตรวจ: ' + client + ' · ' + no + ' · ' + amt, html, text, att && att.nf.ok ? att.nf.em : '');
}

/** The check's result to whoever attached the quotation. */
function resultMail_(c, v, d, x) {
  const cfg = c.cfg, doc = d.doc, ok = v.st === 'ok';
  const deal = c.S.deals[doc.deal];
  const client = deal ? deal.client : 'ลูกค้า', no = doc.docNo || doc.name;
  const href = go_(cfg, 'go=deal&id=' + encodeURIComponent(doc.deal));
  const checker = personOf_(c, v.by);
  // the amount, and amounts in the checker's note, only to an attacher who may still see money
  const money = !!x.caps['view.money'];
  const note = v.note ? (money ? String(v.note) : unmoney_(String(v.note))) : '';
  const body =
    mHead_(ok ? 'ใบเสนอราคาตรวจแล้ว' : 'ใบเสนอราคาถูกส่งกลับแก้ไข', client, [esc_(no + (money && doc.amount != null ? ' · ' + baht_(doc.amount) + ' บาท' : '')), esc_(v.by + (ok ? ' ตรวจแล้วเมื่อ ' : ' ส่งกลับเมื่อ ') + thAt_(v.at))]) +
    (note ? mPanel_('ข้อความจาก ' + v.by, '<div style="font-size:14px;line-height:22px;color:' + MC.ink + '">' + esc_(note) + '</div>') : '') +
    (ok ? '' : mPara_(esc_('แก้แล้วแนบฉบับแก้ไขที่ใบเสนอราคาของงานนี้ ใบใหม่จะส่งให้ผู้ตรวจอีกครั้ง'))) +
    mBtnRow_('เปิดงานนี้', href) +
    '<tr><td style="padding:0 0 22px"></td></tr>';
  const foot = esc_('ส่งถึง ' + x.n + ' เพราะเป็นคนแนบใบเสนอราคานี้') + (checker && checker.nf.ok ? esc_(' · ตอบกลับอีเมลนี้จะถึง ' + checker.n) : '') + '<br>' + mSettings_(cfg);
  const subj = (ok ? 'ใบเสนอราคาตรวจแล้ว: ' : 'ใบเสนอราคาถูกส่งกลับแก้ไข: ') + client + ' · ' + no;
  const html = mShell_(cfg, subj, 'Sales Tracker · ผลตรวจใบเสนอราคา', body, foot);
  const text = [subj, v.by + ' · ' + thAt_(v.at), note ? 'ข้อความ: ' + note : '', href ? 'เปิดงานนี้: ' + href : ''].filter(Boolean).join('\n');
  return msg_(cfg, x.nf.em, subj, html, text, checker && checker.nf.ok ? checker.nf.em : '');
}

/** A new permission request, to each admin. */
function reqMail_(c, r) {
  const cfg = c.cfg, rec = r.rec;
  const what = rec.k === 'role' ? 'ขอบทบาท ' + (roleName_(c.A.roles || {}, rec.role) || rec.role) : 'ขอสิทธิ์ ' + (rec.caps || []).map((x) => (capDef_(x.k) || { th: x.k }).th + (x.s === 'own' ? ' (เฉพาะงานของตัวเอง)' : '')).join(', ');
  const until = rec.until ? 'ถึง ' + thDay_(rec.until, { y: 1 }) : 'ไม่มีวันสิ้นสุด';
  const href = go_(cfg, 'go=reqs');
  const body =
    mHead_('คำขอสิทธิ์รออนุมัติ', r.n, [esc_(what), esc_(until + ' · ส่งเมื่อ ' + thAt_(rec.at))]) +
    mPanel_('เหตุผล', '<div style="font-size:14px;line-height:22px;color:' + MC.ink + '">' + esc_(rec.note) + '</div>') +
    mBtnRow_('ดูคำขอ', href) +
    '<tr><td style="padding:0 0 22px"></td></tr>';
  const foot = esc_('ส่งถึง ' + r.a.n + ' เพราะบัญชีนี้จัดการผู้ใช้และสิทธิ์ได้ · อนุมัติได้ที่ ผู้ใช้และสิทธิ์ › คำขอสิทธิ์') + '<br>' + mSettings_(cfg);
  const subj = 'คำขอสิทธิ์จาก ' + r.n + ': ' + what;
  const text = [subj, until, 'เหตุผล: ' + rec.note, href ? 'ดูคำขอ: ' + href : 'ดูได้ที่ ผู้ใช้และสิทธิ์ › คำขอสิทธิ์ ในเว็บ'].join('\n');
  return msg_(cfg, r.a.nf.em, subj, mShell_(cfg, r.n + ' ' + what, 'Sales Tracker · คำขอสิทธิ์', body, foot), text, '');
}

/** "สรุปวันนี้" (screen 02): the counts, then each section with its groups. */
function digestMail_(c, x, D) {
  const cfg = c.cfg, ck = c.ck, today = ck.today, n = digestCount_(D);
  const scope = x.nf.sc === 'team' ? 'งานของทั้งทีม' : 'งานที่ฉันรับผิดชอบ';
  const tiles = [];
  const text = [];
  const tile = (label, num, subHtml) => ({ label: label, num: num, sub: subHtml });
  // under each count only the groups that have something, so a tile stays two short lines
  const subOf = (parts) => parts.filter((x) => x[1] > 0).map((x) => (x[2] ? '<span style="color:' + x[2] + '">' : '') + esc_(x[0] + ' ' + x[1]) + (x[2] ? '</span>' : '')).join(' · ') || esc_('ไม่มี');
  if (D.qt) tiles.push(tile('รอตรวจ', D.qt.length, esc_(D.qt.length ? 'เก่าสุด ' + thDay_(D.qt[0].day) : 'ไม่มี')));
  if (D.pay) tiles.push(tile('งวดเงิน', n.pay, subOf([['เลยกำหนด', D.pay.late.length, MC.bad], ['วันนี้', D.pay.today.length], ['ภายใน ' + cfg.pre + ' วัน', D.pay.soon.length]])));
  if (D.appt) tiles.push(tile('นัดหมาย', n.appt, subOf([['วันนี้', D.appt.today.length], ['พรุ่งนี้', D.appt.tomorrow.length], ['เลยมาแล้ว', D.appt.late.length]])));
  const w = Math.floor((100 - 2 * (tiles.length - 1)) / (tiles.length || 1));
  let body =
    '<tr><td style="padding:26px 28px 4px;font-family:' + MFONT + '"><div style="font-size:24px;font-weight:500;line-height:34px;color:' + MC.ink + '">' + esc_('สรุปวันนี้ · ' + thDay_(today, { wd: 'full', y: 1 })) + '</div>' +
    '<div style="font-size:14px;line-height:22px;color:' + MC.ink2 + '">' + esc_('สวัสดีตอนเช้า ' + x.n + ' · ' + scope) + '</div></td></tr>' +
    // the tiles are cells of one row (spacer cells between), so they stay the same height when a line wraps
    '<tr><td style="padding:16px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>' +
    tiles.map((t, i) =>
      (i ? '<td width="2%" style="font-size:0;line-height:0">&nbsp;</td>' : '') +
      '<td width="' + w + '%" style="border:1px solid ' + MC.line + ';border-radius:14px;padding:12px 14px;vertical-align:top;font-family:' + MFONT + '">' +
      '<div style="font-size:13px;line-height:20px;color:' + MC.ink2 + '">' + esc_(t.label) + '</div><div style="font-size:24px;font-weight:500;line-height:32px;color:' + MC.ink + '">' + t.num + '</div>' +
      '<div style="font-size:12px;line-height:18px;color:' + MC.muted + '">' + t.sub + '</div></td>').join('') +
    '</tr></table></td></tr>';
  const list = (rows, fn) => rows.slice(0, LIST_MAX).map(fn).join('') + mMore_(rows.length - LIST_MAX);
  if (D.qt) {
    body += mSec_('ใบเสนอราคารอตรวจ', D.qt.length + ' ใบ');
    body += D.qt.length
      ? list(D.qt, (q) => {
          const href = go_(cfg, 'go=qt&doc=' + encodeURIComponent(q.doc.id) + '&s=' + linkS_(c.A.sec, x.u, q.doc.id, q.fph, ck.now));
          return mRow_(q.deal.client, href, (q.doc.docNo || q.doc.name) + ' · ' + q.doc.by + ' แนบ ' + thDay_(q.day), baht_(q.doc.amount) + ' บาท', href ? mA_('ตรวจ', href, 'font-size:13px;line-height:20px;color:' + MC.link) : '');
        })
      : mNone_('ไม่มี');
    text.push('ใบเสนอราคารอตรวจ ' + D.qt.length + ' ใบ');
    D.qt.slice(0, LIST_MAX).forEach((q) => text.push('- ' + q.deal.client + ' · ' + (q.doc.docNo || q.doc.name) + ' · ' + baht_(q.doc.amount) + ' บาท'));
  }
  if (D.pay) {
    const P = D.pay;
    const jointN = (d) => Object.keys(c.S.jqm).filter((k) => k.indexOf(d.id + '/') === 0).length;
    const payRow = (e, chip) => {
      const d = e.deal, l = e.line, jn = jointRole_(c.S, d) === 'header' ? jointN(d) : 0;
      return mRow_(d.client + (jn ? ' · ใบเสนอราคาร่วม ' + jn + ' บริษัท' : ''), go_(cfg, 'go=deal&id=' + encodeURIComponent(d.id)), l.stage + ' · ครบกำหนด ' + thDay_(l.due, l.due > today ? { wd: 'short' } : null) + (d.resp ? ' · ' + d.resp : ''), baht_(l.left) + ' บาท', chip(l));
    };
    body += mSec_('งวดเงิน', 'รวม ' + baht_(P.total) + ' บาท');
    body += mSub_('เลยกำหนด') + (P.late.length ? list(P.late, (e) => payRow(e, (l) => mChip_('เลยกำหนด ' + l.lateDays + ' วัน', MC.bad, MC.badBg))) : mNone_('ไม่มี'));
    body += mSub_('ครบกำหนดวันนี้') + (P.today.length ? list(P.today, (e) => payRow(e, () => mChip_('ครบกำหนดวันนี้', MC.warn, MC.warnBg))) : mNone_('ไม่มี'));
    body += mSub_('ภายใน ' + cfg.pre + ' วัน') + (P.soon.length ? list(P.soon, (e) => payRow(e, (l) => mChip_('ถึงกำหนด ' + daysBetween_(today, l.due) + ' วัน', MC.warn, MC.warnBg))) : mNone_('ไม่มี'));
    text.push('งวดเงิน ' + n.pay + ' รายการ รวม ' + baht_(P.total) + ' บาท');
    P.late.concat(P.today, P.soon).slice(0, LIST_MAX).forEach((e) => text.push('- ' + e.deal.client + ' · ' + e.line.stage + ' · ครบกำหนด ' + thDay_(e.line.due) + ' · ' + baht_(e.line.left) + ' บาท'));
  }
  if (D.appt) {
    const A = D.appt;
    const apptRow = (e, late) => {
      if (e.s) return mRow_(e.s.deal.client, go_(cfg, 'go=deal&id=' + encodeURIComponent(e.s.deal.id)), [e.s.stage + (stageTh_(e.s.stage) ? ' ' + stageTh_(e.s.stage) : ''), e.s.deal.resp].filter(Boolean).join(' · '), 'ไม่ระบุเวลา', '');
      const t = e.t;
      return mRow_(t.title || 'นัดหมาย', go_(cfg, 'go=plan&d=' + t.date), [TASK_TH[t.type] || 'นัดหมาย', t.note, t.resp].filter(Boolean).join(' · '), late ? thDay_(t.date) + (t.time ? ' ' + t.time : '') : t.time || 'ไม่ระบุเวลา', late ? mChip_('เกินกำหนด ' + daysBetween_(t.date, today) + ' วัน', MC.bad, MC.badBg) : '');
    };
    body += mSec_('นัดหมาย', '');
    body += mSub_('วันนี้ · ' + thDay_(today, { wd: 'short' })) + (A.today.length ? list(A.today, (e) => apptRow(e, false)) : mNone_('ไม่มีนัด'));
    if (cfg.appt === 'today+1') body += mSub_('พรุ่งนี้ · ' + thDay_(ck.tomorrow, { wd: 'short' })) + (A.tomorrow.length ? list(A.tomorrow, (e) => apptRow(e, false)) : mNone_('ไม่มีนัด'));
    body += mSub_('เลยมาแล้ว ยังไม่ได้ทำ') + (A.late.length ? list(A.late, (e) => apptRow(e, true)) : mNone_('ไม่มี'));
    text.push('นัดหมาย ' + n.appt + ' รายการ');
    A.today.concat(A.tomorrow, A.late).slice(0, LIST_MAX).forEach((e) => text.push('- ' + (e.s ? e.s.deal.client + ' · ' + e.s.stage + ' · ' + thDay_(e.s.d) : (e.t.title || 'นัดหมาย') + ' · ' + thDay_(e.t.date) + (e.t.time ? ' ' + e.t.time : ''))));
  }
  body += mBtnRow_('เปิดเว็บ Sales Tracker', go_(cfg, '')).replace('padding:16px 28px 2px', 'padding:22px 28px 26px') || '<tr><td style="padding:0 0 22px"></td></tr>';
  const foot = esc_('ส่งถึง ' + x.n + ' ทุกวันจันทร์–ศุกร์ ' + x.nf.t + ' · ' + scope + ' · วันไหนไม่มีเรื่องจะไม่ส่ง') + '<br>' + (cfg.site ? esc_('กดชื่อบริษัทเพื่อเปิดในเว็บ') + ' · ' : '') + mSettings_(cfg);
  const parts = [];
  if (n.qt) parts.push('รอตรวจ ' + n.qt);
  if (n.pay) parts.push('งวดเงิน ' + n.pay);
  if (n.appt) parts.push('นัดหมาย ' + n.appt);
  const pre = [];
  if (n.qt) pre.push('รอตรวจ ' + n.qt);
  if (D.pay && D.pay.late.length) pre.push('งวดเงินเลยกำหนด ' + D.pay.late.length);
  if (D.appt && D.appt.today.length) pre.push('นัดวันนี้ ' + D.appt.today.length);
  const subj = 'สรุปวันนี้ ' + thDay_(today, { wd: 'short' }) + ': ' + parts.join(' · ');
  const html = mShell_(cfg, (pre.length ? pre : parts).join(' · '), 'Sales Tracker · สรุปวันนี้', body, foot);
  return msg_(cfg, x.nf.em, subj, html, [subj, ''].concat(text, ['', go_(cfg, '') ? 'เปิดเว็บ: ' + go_(cfg, '') : '']).join('\n'), '');
}

/** About an hour before a timed appointment. */
function preMail_(c, x, t) {
  const cfg = c.cfg;
  const href = go_(cfg, 'go=plan&d=' + t.date);
  const what = [TASK_TH[t.type] || 'นัดหมาย', t.note].filter(Boolean).join(' · ');
  const body = mHead_('อีกประมาณ 1 ชั่วโมง', t.title || 'นัดหมาย', [esc_(t.time + ' น. · ' + what), esc_(t.resp ? 'ผู้รับผิดชอบ ' + t.resp : '')]) + mBtnRow_('เปิดแผนติดต่อ', href) + '<tr><td style="padding:0 0 22px"></td></tr>';
  const foot = esc_('ส่งถึง ' + x.n + ' เพราะเปิด "เตือนอีกครั้งก่อนนัด 1 ชั่วโมง" ไว้') + '<br>' + mSettings_(cfg);
  const subj = 'อีกประมาณ 1 ชั่วโมง: ' + (t.title || 'นัดหมาย') + ' ' + t.time + ' น.';
  return msg_(cfg, x.nf.em, subj, mShell_(cfg, subj, 'Sales Tracker · นัดหมาย', body, foot), [subj, what, href ? 'เปิดแผนติดต่อ: ' + href : ''].filter(Boolean).join('\n'), '');
}

/** The 6-digit code for a new address. */
function codeMail_(cfg, name, to, code) {
  const body =
    mHead_('ยืนยันอีเมลสำหรับการแจ้งเตือน', 'สวัสดี ' + name, []) +
    '<tr><td style="padding:16px 28px 4px;font-family:' + MFONT + '"><div style="font-size:28px;font-weight:500;line-height:40px;letter-spacing:4px;color:' + MC.ink + '">' + esc_(code) + '</div></td></tr>' +
    mPara_(esc_('ใส่รหัสนี้ใน “การแจ้งเตือนของฉัน” ในเว็บ Sales Tracker ภายใน 15 นาที ระบบจะเริ่มส่งการแจ้งเตือนถึงอีเมลนี้หลังยืนยัน')) +
    mPara_(esc_('ถ้าไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร อีเมลนี้จะไม่ได้รับการแจ้งเตือน')) +
    '<tr><td style="padding:0 0 22px"></td></tr>';
  const subj = 'รหัสยืนยันอีเมล: ' + code;
  return msg_(cfg, to, subj, mShell_(cfg, subj, 'Sales Tracker · ยืนยันอีเมล', body, esc_('ส่งถึงอีเมลที่เพิ่งใส่ไว้กับบัญชีของ ' + name)), [subj, 'ใส่รหัสนี้ใน "การแจ้งเตือนของฉัน" ภายใน 15 นาที', 'ถ้าไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร'].join('\n'), '');
}

function testMail_(cfg, name, to) {
  const body =
    mHead_('อีเมลทดสอบ', 'ส่งถึง ' + name + ' ได้แล้ว', [esc_('การแจ้งเตือนจาก Sales Tracker จะมาถึงอีเมลนี้')]) +
    mPara_(esc_('ถ้าอีเมลนี้อยู่ในสแปมหรือโปรโมชัน ให้กด “ไม่ใช่สแปม” หรือย้ายไปกล่องจดหมายหลัก ฉบับต่อไปจะเข้ากล่องหลัก')) +
    mBtnRow_('เปิดเว็บ Sales Tracker', go_(cfg, '')) +
    '<tr><td style="padding:0 0 22px"></td></tr>';
  return msg_(cfg, to, 'อีเมลทดสอบจาก Sales Tracker', mShell_(cfg, 'อีเมลทดสอบจาก Sales Tracker', 'Sales Tracker · ทดสอบ', body, mSettings_(cfg)), 'อีเมลทดสอบจาก Sales Tracker: ส่งถึง ' + name + ' ได้แล้ว', '');
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
