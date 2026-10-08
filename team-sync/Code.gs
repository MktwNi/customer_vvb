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
 * Protocol v3 (POST, body = JSON text, Content-Type: text/plain to avoid a CORS preflight).
 * The web app sends `cv: 3` with every request. A team works in one of three modes (see hello):
 *   legacy   — no accounts yet and TEAM_KEY is set: every request carries `key` (the team code), as in v2
 *   setup    — no accounts and no TEAM_KEY: only hello and claim work
 *   accounts — at least one account exists: requests carry `tok` (a session token); TEAM_KEY grants nothing
 *
 * Public (no key or token):
 *   { action: 'hello' }                          -> { ok, app: 'gcc-team-sync', v: 3, files: true, mode, tid, it }
 *   { action: 'login', u, pk, rm }               -> { ok, tok, exp, me: { u, name, role }, mc }
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
 *   { action: 'users', tok }                     -> { ok, users: [{ u, name, role, on, mc, ll, c, locked }] }  admin
 *   { action: 'user_save', tok, u, create?, name?, role?, on?, pk?, unlock?, kick? } -> { ok, user }       admin
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
 *   me: { u, name, role }, and a remembered session with fewer than 15 days left also gets a new tok + exp.
 * Roles: admin does everything. sales may not write scfg/, dedup/, team/, dundo/ nor delete deal/, cust/,
 * person/ (refused per op in `denied`, never stored); its log/ and dlog/ values get by = its name.
 * viewer only reads: push, upload and delfile answer 'forbidden'.
 *   Errors: { ok: false, error: 'unauthorized' | 'no_team_key' | 'busy' | 'bad_json' | 'unknown_action'
 *            | 'file_too_large' | 'bad_file_type' | 'empty_file' | 'not_found' | 'drive_permission'
 *            | 'login_required' | 'session_expired' | 'account_disabled' | 'must_change_password' | 'forbidden'
 *            | 'bad_login' | 'locked' (+ retryIn seconds) | 'too_many_attempts' | 'no_accounts' | 'bad_code'
 *            | 'bad_user' | 'bad_name' | 'bad_role' | 'bad_password_data' | 'wrong_password' | 'name_taken'
 *            | 'user_exists' | 'unknown_user' | 'too_many_users' | 'not_self' | 'last_admin' | 'name_locked' | ... }
 *   A team-code request in accounts mode answers 'login_required' (or, without cv, a Thai sentence that
 *   older web apps show as is).
 * The sheet is an append-only log ordered by seq; a later row for the same key wins.
 * Superseded rows are compacted away automatically once the log grows.
 * `files: true` in ping tells the web app this version stores attachments (older ones omit it).
 * file / delfile only ever touch files inside the documents folder, never the rest of the Drive.
 * Accounts live in Script Properties (USERS: salted hashes of pk, never returned by any action).
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

// accounts (protocol v3)
const API_V = 3;
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
const ROLES = ['admin', 'sales', 'viewer'];
// key prefixes sales may not write at all / may not delete (the web app has the same lists)
const SALES_DENY = ['scfg/', 'dedup/', 'team/', 'dundo/'];
const ADMIN_DEL = ['deal/', 'cust/', 'person/'];
const DUMMY_SALT = 'gcc-no-such-user';
const OLD_CLIENT_MSG = 'ทีมเปลี่ยนเป็นระบบเข้าสู่ระบบแล้ว — รีเฟรชหน้าเว็บ (F5) แล้วเข้าสู่ระบบด้วยบัญชีของคุณ';

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
    if (!actor.legacy && actor.role === 'viewer' && ['push', 'upload', 'delfile'].indexOf(action) >= 0) return reply_(actor, { ok: false, error: 'forbidden' });
    switch (action) {
      case 'ping':
        // only creating / repairing the sheet needs the lock; a ready sheet is just read
        if (!sheetReady_()) withLock_(() => sheet_());
        return reply_(actor, { ok: true, seq: cachedSeq_() ?? seq_(), files: true });
      case 'pull':
        return reply_(actor, pull_(Number(req.since) || 0, Math.min(Number(req.limit) || MAX_PULL, MAX_PULL)));
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

/** Rows with seq > since, oldest first (rows are stored in ascending seq order). */
function pull_(since, limit) {
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

/** Append ops as rows. `actor` is { legacy: true } for the team code, else the signed-in account. */
function push_(ops, actor) {
  if (!Array.isArray(ops)) return { ok: false, error: 'bad_ops' };
  if (ops.length > MAX_OPS) return { ok: false, error: 'too_many_ops' };
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    // the lead claimed the first account while this team-code push waited for the lock
    if (actor.legacy && hasUsers_(readUsers_())) return { ok: false, error: 'login_required' };
    let seq = Number(props.getProperty('SEQ') || 0);
    const now = new Date().toISOString();
    const sales = !actor.legacy && actor.role === 'sales';
    const rows = [];
    const rejected = [];
    const denied = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i] || {};
      const k = String(op.k || '');
      if (!k || k.length > 500) continue;
      const del = !!op.del;
      // the web app applies a row without a value as a deletion
      const delR = del || op.v === undefined || op.v === null;
      if (sales && (startsAny_(k, SALES_DENY) || (delR && startsAny_(k, ADMIN_DEL)))) {
        denied.push(k); // not stored and uses no seq
        continue;
      }
      let val = op.v;
      // a contact-log entry written by sales always carries its own name (key order kept)
      if (sales && !delR && /^d?log\//.test(k) && val && typeof val === 'object' && !Array.isArray(val) && Object.prototype.hasOwnProperty.call(val, 'by'))
        val = Object.assign({}, val, { by: actor.name });
      const v = del || val === undefined ? '' : JSON.stringify(val);
      if (v.length > MAX_CELL) {
        rejected.push(k); // never store a placeholder other browsers would apply as data
        continue;
      }
      seq++;
      // with a token the row's author is the account, whatever the op says
      rows.push([String(seq), k, v, del ? '1' : '0', String(actor.legacy ? op.by || '' : actor.name).slice(0, 100), now]);
    }
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

function startsAny_(k, prefixes) {
  return prefixes.some((p) => k.indexOf(p) === 0);
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
  return { ok: true, tok: t.tok, exp: t.exp, me: { u: u, name: y.n, role: y.r }, mc: !!y.mc };
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
  return { ok: true, tok: t.tok, exp: t.exp, me: { u: u, name: r.x.n, role: r.x.r }, mc: false };
}

/** me / passwd / logout / users / user_save; null for any other action. */
function account_(action, req, actor) {
  if (['me', 'passwd', 'logout', 'users', 'user_save'].indexOf(action) < 0) return null;
  if (actor.legacy) return json_({ ok: false, error: 'login_required' });
  if (action === 'me') return reply_(actor, { ok: true, mc: actor.mc });
  if (action === 'passwd') return json_(passwd_(req, actor));
  if (action === 'logout') {
    if (req.all) withLock_(() => bumpSv_(actor.u));
    return json_({ ok: true });
  }
  if (actor.role !== 'admin') return reply_(actor, { ok: false, error: 'forbidden' });
  if (action === 'users') return reply_(actor, users_());
  const r = userSave_(req, actor);
  // an admin who signed out their own sessions gets no renewed token
  return reply_(r.self && r.bumped ? Object.assign({}, actor, { rm: false }) : actor, r.out);
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
  return { ok: true, tok: t.tok, exp: t.exp, me: { u: actor.u, name: actor.name, role: actor.role } };
}

/** Admin: every account, without salts or hashes. locked = seconds until a lockout ends (0 = none). */
function users_() {
  const db = readUsers_();
  const names = Object.keys(db.users);
  const lk = names.length ? CacheService.getScriptCache().getAll(names.map((u) => 'LK:' + ck_(u))) : {};
  return { ok: true, users: names.map((u) => Object.assign(pub_(u, db.users[u]), { locked: secsLeft_(lk['LK:' + ck_(u)]) })) };
}

/** Admin: create an account (temporary password as pk, must change it) or change one. */
function userSave_(req, actor) {
  const u = normUser_(req.u);
  const has = (v) => v !== undefined && v !== null;
  const r = withLock_(() => {
    const db = readUsers_();
    let x = own_(db.users, u);
    if (req.create) {
      if (!USER_RE.test(u)) return { err: 'bad_user' };
      if (x) return { err: 'user_exists' };
      const name = cleanDisplay_(req.name);
      if (!name) return { err: 'bad_name' };
      if (nameTaken_(db, name, '')) return { err: 'name_taken' };
      if (ROLES.indexOf(req.role) < 0) return { err: 'bad_role' };
      const pk = String(req.pk || '');
      if (!PK_RE.test(pk)) return { err: 'bad_password_data' };
      if (Object.keys(db.users).length >= MAX_USERS) return { err: 'too_many_users' };
      x = { n: name, r: req.role, on: 1, sv: 1, s: '', h: '', mc: 1, c: new Date().toISOString(), ll: '' };
      setPk_(x, pk);
      db.users[u] = x;
      saveUsers_(db);
      return { x: x, bumped: false, clear: true };
    }
    if (!x) return { err: 'unknown_user' };
    let role = x.r, on = x.on, name = x.n;
    if (has(req.role)) {
      if (ROLES.indexOf(req.role) < 0) return { err: 'bad_role' };
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
    saveUsers_(db);
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

function dirOf_(db, p) {
  const u = {};
  Object.keys(db.users).forEach((k) => {
    const x = db.users[k];
    u[k] = { n: x.n, r: x.r, on: x.on, sv: x.sv, mc: x.mc };
  });
  if (!Object.keys(u).length) return { m: 'none' };
  return { m: 'accounts', sec: p.AUTH_SECRET, tid: p.TEAM_ID, it: Number(p.KDF_ITER || KDF_ITER_DEFAULT), u: u };
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
  const s = JSON.stringify(db);
  if (s.length > USERS_MAX_LEN) throw gccError_('too_many_users');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('USERS', s);
  putCache_('AUTHC', JSON.stringify(dirOf_(db, props.getProperties())), AUTH_CACHE_S);
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
 * The account a token belongs to: {u, name, role, mc, rm, exp, sv, sec}, or {err}. Role, name and the
 * active flag come from the directory, so a change applies on the account's next request.
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
    return { u: u, name: x.n, role: x.r, mc: !!x.mc, rm: !!t.rm, exp: Number(t.exp), sv: x.sv, sec: A.sec };
  } catch (err) {
    return { err: 'session_expired' };
  }
}

/** The JSON reply; for an account it adds me, and renews a remembered token that has under 15 days left. */
function reply_(actor, o) {
  if (actor && !actor.legacy) {
    o.me = { u: actor.u, name: actor.name, role: actor.role };
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
  const lock = LockService.getUserLock();
  if (!lock.tryLock(PW_LOCK_MS)) throw gccError_('busy');
  try {
    if (team && teamBlocked_()) return { ok: false, error: 'too_many_attempts' };
    const left = lockLeft_(u);
    if (left) return { ok: false, error: 'locked', retryIn: left };
    if (right()) return null;
    const lockedFor = failLogin_(u);
    return lockedFor ? { ok: false, error: 'wrong', retryIn: lockedFor } : { ok: false, error: 'wrong' };
  } finally {
    lock.releaseLock();
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
