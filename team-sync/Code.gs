/** @OnlyCurrentDoc */
/**
 * GCC Registry — ที่เก็บข้อมูลทีม (Google Apps Script + Google Sheet)
 *
 * ใช้คู่กับเว็บ GCC Registry: ดาว สถานะการขาย ผู้รับผิดชอบ นัด บันทึกการติดต่อ ข้อมูลติดต่อที่แก้
 * รายชื่อทีม และผลตรวจข้อมูลซ้ำ จะถูกส่งมาเก็บในชีต "sync" ของไฟล์ Google Sheet นี้
 * และทุกเครื่องจะดึงไปแสดงเหมือนกัน
 *
 * วิธีติดตั้ง: ดู team-sync/README.md ใน repo
 *
 * Protocol (POST, body = JSON text, Content-Type: text/plain to avoid a CORS preflight):
 *   { action: 'ping', key }                     -> { ok, seq }
 *   { action: 'pull', key, since, limit? }      -> { ok, seq, rows: Row[], more }
 *   { action: 'push', key, ops: Op[] }          -> { ok, seq, n, rejected: string[] }
 *   Op  = { k: string, v?: any, del?: boolean, by?: string }
 *   Row = { seq: number, k: string, v: any, del: boolean, by: string, at: string }
 *   Errors: { ok: false, error: 'unauthorized' | 'no_team_key' | 'busy' | 'bad_json' | ... }
 * The sheet is an append-only log ordered by seq; a later row for the same key wins.
 * Superseded rows are compacted away automatically once the log grows.
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

function doGet() {
  return json_({ ok: true, app: 'gcc-team-sync', hint: 'use POST' });
}

/** กด Run ฟังก์ชันนี้ครั้งแรก เพื่ออนุญาตสิทธิ์และสร้างชีต "sync" */
function setup() {
  if (!keyOk_()) throw new Error('ตั้งค่า TEAM_KEY ด้านบนก่อน (สุ่มเอง อย่างน้อย ' + MIN_KEY + ' ตัวอักษร) แล้วกดบันทึก');
  sheet_();
  Logger.log('พร้อมใช้งาน: สร้างชีต "' + SHEET_NAME + '" แล้ว ขั้นต่อไปคือ Deploy เป็น Web app');
}

function keyOk_() {
  return !!TEAM_KEY && String(TEAM_KEY).length >= MIN_KEY;
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
        return json_({ ok: true, seq: seq_() });
      case 'pull':
        return json_(pull_(Number(req.since) || 0, Math.min(Number(req.limit) || MAX_PULL, MAX_PULL)));
      case 'push':
        return json_(push_(req.ops || []));
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    if (err && err.busy) return json_({ ok: false, error: 'busy' });
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
  const cur = seq_();
  if (since >= cur) return { ok: true, seq: cur, rows: [], more: false };
  // read under the lock so a concurrent append/compaction can't shift rows mid-read
  return withLock_(() => {
    const sh = sheet_();
    const last = sh.getLastRow();
    const now = seq_();
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
      const rng = sh.getRange(start, 1, rows.length, HEADER.length);
      // plain text so Sheets never reinterprets keys/JSON (e.g. as dates or numbers)
      rng.setNumberFormat('@');
      rng.setValues(rows);
      props.setProperty('SEQ', String(seq));
      compact_(sh, props);
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
  sh.getRange(2, 1, last - 1, HEADER.length).clearContent();
  const rng = sh.getRange(2, 1, keep.length, HEADER.length);
  rng.setNumberFormat('@');
  rng.setValues(keep.map((r) => r.map(String)));
}
