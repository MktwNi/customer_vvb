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
 *   { action: 'push', key, ops: Op[] }          -> { ok, seq, n }
 *   Op  = { k: string, v?: any, del?: boolean, by?: string }
 *   Row = { seq: number, k: string, v: any, del: boolean, by: string, at: string }
 * The sheet is an append-only log ordered by seq; a later row for the same key wins.
 * Superseded rows are compacted away automatically once the log grows.
 */

// ⬇⬇⬇ ตั้งรหัสทีมตรงนี้ (อย่างน้อย 6 ตัวอักษร) แล้วบอกรหัสนี้กับคนในทีมเท่านั้น
const TEAM_KEY = '';

const SHEET_NAME = 'sync';
const HEADER = ['seq', 'k', 'v', 'del', 'by', 'at'];
const MAX_PULL = 3000;
const MAX_OPS = 1000;
const MAX_CELL = 45000; // Google Sheets limit is 50,000 characters per cell
const COMPACT_MIN_ROWS = 5000;

function doGet() {
  return json_({ ok: true, app: 'gcc-team-sync', hint: 'use POST' });
}

/** กด Run ฟังก์ชันนี้ครั้งแรก เพื่ออนุญาตสิทธิ์และสร้างชีต "sync" */
function setup() {
  if (!TEAM_KEY || String(TEAM_KEY).length < 6) throw new Error('ตั้งค่า TEAM_KEY ด้านบนก่อน (อย่างน้อย 6 ตัวอักษร) แล้วกดบันทึก');
  sheet_();
  Logger.log('พร้อมใช้งาน: สร้างชีต "' + SHEET_NAME + '" แล้ว ขั้นต่อไปคือ Deploy เป็น Web app');
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  try {
    if (!TEAM_KEY || String(TEAM_KEY).length < 6) return json_({ ok: false, error: 'no_team_key' });
    if (req.key !== TEAM_KEY) return json_({ ok: false, error: 'unauthorized' });
    switch (req.action) {
      case 'ping':
        sheet_();
        return json_({ ok: true, seq: seq_() });
      case 'pull':
        return json_(pull_(Number(req.since) || 0, Math.min(Number(req.limit) || MAX_PULL, MAX_PULL)));
      case 'push':
        return json_(push_(req.ops || []));
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
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

/** Rows with seq > since, oldest first. Rows are stored in ascending seq order. */
function pull_(since, limit) {
  const cur = seq_();
  if (since >= cur) return { ok: true, seq: cur, rows: [], more: false };
  // read under the same lock as push so a concurrent append/compaction can't shift rows mid-read
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    const sh = sheet_();
    const last = sh.getLastRow();
    const now = seq_();
    if (last < 2) return { ok: true, seq: now, rows: [], more: false };
    const seqs = sh.getRange(2, 1, last - 1, 1).getValues();
    // binary search for the first row with seq > since
    let lo = 0, hi = seqs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(seqs[mid][0]) > since) hi = mid;
      else lo = mid + 1;
    }
    if (lo >= seqs.length) return { ok: true, seq: now, rows: [], more: false };
    const n = Math.min(limit, seqs.length - lo);
    const vals = sh.getRange(2 + lo, 1, n, HEADER.length).getValues();
    return { ok: true, seq: now, rows: vals.map(rowOut_), more: lo + n < seqs.length };
  } finally {
    lock.releaseLock();
  }
}

function push_(ops) {
  if (!Array.isArray(ops)) return { ok: false, error: 'bad_ops' };
  if (ops.length > MAX_OPS) return { ok: false, error: 'too_many_ops' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    let seq = Number(props.getProperty('SEQ') || 0);
    const now = new Date().toISOString();
    const rows = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i] || {};
      const k = String(op.k || '');
      if (!k || k.length > 500) continue;
      const del = !!op.del;
      let v = del || op.v === undefined ? '' : JSON.stringify(op.v);
      if (v.length > MAX_CELL) v = JSON.stringify({ tooLarge: true });
      seq++;
      rows.push([seq, k, v, del ? 1 : 0, String(op.by || '').slice(0, 100), now]);
    }
    if (rows.length) {
      const sh = sheet_();
      // write values as plain text so Sheets never reinterprets keys/JSON (e.g. as dates or numbers)
      const rng = sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length);
      rng.setNumberFormat('@');
      rng.setValues(rows.map((r) => [String(r[0]), r[1], r[2], String(r[3]), r[4], r[5]]));
      props.setProperty('SEQ', String(seq));
      compact_(sh);
    }
    return { ok: true, seq: seq, n: rows.length };
  } finally {
    lock.releaseLock();
  }
}

/** Drop rows superseded by a later row for the same key (keeps seq order). */
function compact_(sh) {
  const last = sh.getLastRow();
  if (last - 1 < COMPACT_MIN_ROWS) return;
  const vals = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
  const latest = {};
  for (let i = 0; i < vals.length; i++) latest[vals[i][1]] = i;
  const keep = vals.filter((r, i) => latest[r[1]] === i);
  if (keep.length > vals.length / 3) return; // not worth rewriting yet
  sh.getRange(2, 1, last - 1, HEADER.length).clearContent();
  const rng = sh.getRange(2, 1, keep.length, HEADER.length);
  rng.setNumberFormat('@');
  rng.setValues(keep.map((r) => r.map(String)));
}
