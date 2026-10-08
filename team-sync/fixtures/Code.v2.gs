// frozen copy of protocol v2 for tests — never deploy
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
 * อัปเดตจากเวอร์ชันก่อนที่ยังไม่มีไฟล์แนบ: เวอร์ชันนี้ใช้ Google Drive จึงต้องกด Run "setup" อีกครั้ง
 * เพื่ออนุญาตสิทธิ์ Drive แล้ว Deploy → Manage deployments → Edit → Version: New version
 *
 * Protocol (POST, body = JSON text, Content-Type: text/plain to avoid a CORS preflight):
 *   { action: 'ping', key }                     -> { ok, seq, files: true }
 *   { action: 'pull', key, since, limit? }      -> { ok, seq, rows: Row[], more }
 *   { action: 'push', key, ops: Op[] }          -> { ok, seq, n, rejected: string[] }
 *   { action: 'upload', key, docId, name, mime, data }  -> { ok, fileId, size }   (data = base64)
 *   { action: 'file', key, fileId }             -> { ok, name, mime, size, data }
 *   { action: 'delfile', key, fileId }          -> { ok }   (moves the file to the owner's Drive trash)
 *   Op  = { k: string, v?: any, del?: boolean, by?: string }
 *   Row = { seq: number, k: string, v: any, del: boolean, by: string, at: string }
 *   Errors: { ok: false, error: 'unauthorized' | 'no_team_key' | 'busy' | 'bad_json' | 'unknown_action'
 *            | 'file_too_large' | 'bad_file_type' | 'empty_file' | 'not_found' | 'drive_permission' | ... }
 * The sheet is an append-only log ordered by seq; a later row for the same key wins.
 * Superseded rows are compacted away automatically once the log grows.
 * `files: true` in ping tells the web app this version stores attachments (older ones omit it).
 * file / delfile only ever touch files inside the documents folder, never the rest of the Drive.
 */

// ⬇⬇⬇ ตั้งรหัสทีมตรงนี้ (สุ่มขึ้นมาเอง อย่างน้อย 8 ตัวอักษร) แล้วบอกรหัสนี้กับคนในทีมเท่านั้น
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

// setup is the first function in the file, so the editor's Run button selects it by default.
/** กด Run ฟังก์ชันนี้ครั้งแรก (และทุกครั้งที่อัปเดตโค้ด) เพื่ออนุญาตสิทธิ์ สร้างชีต "sync" และโฟลเดอร์เอกสาร */
function setup() {
  if (!keyOk_()) throw new Error('ตั้งค่า TEAM_KEY ด้านบนก่อน (สุ่มเอง อย่างน้อย ' + MIN_KEY + ' ตัวอักษร) แล้วกดบันทึก');
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
  const msg = 'พร้อมใช้งาน: สร้างชีต "' + SHEET_NAME + '" และโฟลเดอร์ "' + DOC_FOLDER_NAME + '" ใน Google Drive แล้ว ขั้นต่อไปคือ Deploy เป็น Web app';
  Logger.log(msg);
  try {
    ss.toast(msg, 'GCC ข้อมูลทีม', 10); // shown in the open spreadsheet
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
    if (!keyOk_()) return json_({ ok: false, error: 'no_team_key' });
    if (req.key !== TEAM_KEY) return json_({ ok: false, error: 'unauthorized' });
    switch (req.action) {
      case 'ping':
        // only creating / repairing the sheet needs the lock; a ready sheet is just read
        if (!sheetReady_()) withLock_(() => sheet_());
        return json_({ ok: true, seq: cachedSeq_() ?? seq_(), files: true });
      case 'pull':
        return json_(pull_(Number(req.since) || 0, Math.min(Number(req.limit) || MAX_PULL, MAX_PULL)));
      case 'push':
        return json_(push_(req.ops || []));
      case 'upload':
        return json_(upload_(req));
      case 'file':
        return json_(file_(req.fileId));
      case 'delfile':
        return json_(delFile_(req.fileId));
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    if (err && err.busy) return json_({ ok: false, error: 'busy' });
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

function push_(ops) {
  if (!Array.isArray(ops)) return { ok: false, error: 'bad_ops' };
  if (ops.length > MAX_OPS) return { ok: false, error: 'too_many_ops' };
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    let seq = Number(props.getProperty('SEQ') || 0);
    const now = new Date().toISOString();
    const rows = [];
    const rejected = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i] || {};
      const k = String(op.k || '');
      if (!k || k.length > 500) continue;
      const del = !!op.del;
      const v = del || op.v === undefined ? '' : JSON.stringify(op.v);
      if (v.length > MAX_CELL) {
        rejected.push(k); // never store a placeholder other browsers would apply as data
        continue;
      }
      seq++;
      rows.push([String(seq), k, v, del ? '1' : '0', String(op.by || '').slice(0, 100), now]);
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
    return { ok: true, seq: seq, n: rows.length, rejected: rejected };
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
