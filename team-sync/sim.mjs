// Runs team-sync/Code.gs in Node with in-memory fakes of the Google Apps Script services it
// uses (SpreadsheetApp, LockService, PropertiesService, CacheService, ContentService, DriveApp, Utilities,
// Logger). Used by the unit tests and by dev-server.mjs, so the real script — not a reimplementation —
// is what gets exercised.
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

// Mirrors real Sheets limits that matter: a new sheet has 1000 rows × 26 columns and getRange()
// throws outside them (it does not grow the sheet, unlike appendRow).
function fakeSheet(name) {
  let rows = []; // 1-based rows → rows[r-1], each an array of cell values ('' = empty)
  let maxRows = 1000, maxCols = 26;
  const cell = (r, c) => (rows[r - 1] && rows[r - 1][c - 1] !== undefined ? rows[r - 1][c - 1] : '');
  const range = (r, c, nr = 1, nc = 1) => {
    if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > maxRows || c + nc - 1 > maxCols)
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return {
    getValue: () => cell(r, c),
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
    setValues: (vals) => {
      if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error('setValues: size mismatch');
      vals.forEach((v, i) => {
        const row = rows[r + i - 1] || (rows[r + i - 1] = []);
        // number format '@' (plain text) is always applied by the script, so store strings
        v.forEach((x, j) => (row[c + j - 1] = x === '' || x == null ? '' : String(x)));
      });
    },
    clearContent: () => {
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows[r + i - 1]) rows[r + i - 1][c + j - 1] = '';
    },
    setNumberFormat: () => {},
    };
  };
  return {
    name,
    get rows() {
      return rows;
    },
    getRange: range,
    getMaxRows: () => maxRows,
    getMaxColumns: () => maxCols,
    insertRowsAfter: (after, n) => {
      rows.splice(after, 0, ...Array.from({ length: n }, () => []));
      maxRows += n;
    },
    insertRowsBefore: (before, n) => {
      rows.splice(before - 1, 0, ...Array.from({ length: n }, () => []));
      maxRows += n;
    },
    deleteColumns: (from, n) => {
      rows = rows.map((row) => row.filter((_, j) => j < from - 1 || j >= from - 1 + n));
      maxCols -= n;
    },
    getLastRow: () => {
      for (let i = rows.length; i > 0; i--) if (rows[i - 1] && rows[i - 1].some((x) => x !== '' && x != null)) return i;
      return 0;
    },
    setFrozenRows: () => {},
  };
}

// ------------------------------------------------------------------ Drive + Utilities

/** Errors as Apps Script throws them: String(err) is "Exception: <message>". */
const gasError = (msg) => Object.assign(new Error(msg), { name: 'Exception' });
const NO_ITEM = 'No item with the given ID could be found. Possibly because you have not edited this item or you do not have access to it.';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Apps Script's Byte[] is a plain array of signed numbers (-128..127), not a typed array.
const toByteArray = (buf) => Array.from(buf, (b) => (b << 24) >> 24);
function fromByteArray(a) {
  if (!Array.isArray(a)) throw gasError('The parameters (' + typeof a + ") don't match the method signature.");
  const buf = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    const b = a[i];
    if (!Number.isInteger(b) || b < -128 || b > 127) throw gasError('Cannot convert ' + b + ' to byte.');
    buf[i] = b & 255;
  }
  return buf;
}

const blobData = new WeakMap(); // blob → Buffer, so files don't round-trip through Byte[] internally
function fakeBlob(buf, type = null, name = null) {
  const b = {
    getBytes: () => toByteArray(buf),
    getContentType: () => type,
    setContentType: (t) => ((type = t), b),
    getName: () => name,
    setName: (n) => ((name = n), b),
    getDataAsString: () => buf.toString('utf8'),
    copyBlob: () => fakeBlob(Buffer.from(buf), type, name),
  };
  blobData.set(b, buf);
  return b;
}

/** A string (as UTF-8) or a Byte[] as a Buffer, the way Utilities' overloads take either. */
const bytesOf = (x) => (Array.isArray(x) ? fromByteArray(x) : Buffer.from(String(x), 'utf8'));

const Utilities = {
  // Apps Script refuses malformed base64 with this message (it does not skip bad characters)
  base64Decode: (s) => {
    s = String(s);
    if (s.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw gasError('Could not decode string.');
    return toByteArray(Buffer.from(s, 'base64'));
  },
  base64Encode: (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : fromByteArray(data)).toString('base64'),
  // the web-safe alphabet (- and _) with the = padding kept, as Apps Script does
  base64EncodeWebSafe: (data) => bytesOf(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64DecodeWebSafe: (s) => toByteArray(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  newBlob: (data, contentType = null, name = null) => fakeBlob(typeof data === 'string' ? Buffer.from(data, 'utf8') : fromByteArray(data), contentType, name),
  computeDigest: (alg, value) => {
    if (alg !== 'SHA_256') throw gasError('Digest algorithm ' + alg + ' is not supported by the simulator.');
    return toByteArray(createHash('sha256').update(bytesOf(value)).digest());
  },
  computeHmacSha256Signature: (value, key) => toByteArray(createHmac('sha256', bytesOf(key)).update(bytesOf(value)).digest()),
  getUuid: () => randomUUID(),
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
};

/** pk as the web app derives it: base64url (no padding) of PBKDF2-HMAC-SHA256(NFC(pw), salt, it, 32 bytes). */
export function derivePk(tid, it, u, pw) {
  return pbkdf2Sync(String(pw).normalize('NFC'), 'gcc-team|v1|' + tid + '|' + u, Number(it), 32, 'sha256').toString('base64url');
}

/** One user's Drive. Like the real one, an item inside a trashed folder counts as trashed, a
 *  trashed item is still found by id, and an id deleted for good (emptied trash) throws. */
function fakeDrive(authorized) {
  const ROOT = 'root';
  const items = new Map([[ROOT, { id: ROOT, kind: 'folder', name: 'My Drive', parent: null, trashed: false }]]);
  const newId = () => '1' + randomBytes(24).toString('base64url').slice(0, 32); // Drive-like 33-character id
  const allowed = (method) => {
    if (!authorized) throw gasError(`You do not have permission to call DriveApp.${method}. Required permissions: https://www.googleapis.com/auth/drive`);
  };
  const inTrash = (it) => {
    for (let x = it; x; x = items.get(x.parent)) if (x.trashed) return true;
    return false;
  };
  const iterator = (list) => {
    let i = 0;
    return {
      hasNext: () => i < list.length,
      next: () => {
        if (i >= list.length) throw gasError('Cannot retrieve the next object: iterator has reached the end.');
        return list[i++];
      },
    };
  };
  const add = (it) => (items.set(it.id, it), it);
  const parentsOf = (it) => iterator(it.parent && items.has(it.parent) ? [folderObj(items.get(it.parent))] : []);
  const fileObj = (it) => {
    const f = {
      getId: () => it.id,
      getName: () => it.name,
      setName: (n) => ((it.name = String(n)), f),
      getMimeType: () => it.mime,
      getSize: () => (it.kind === 'file' ? it.data.length : 0),
      getBlob: () => {
        if (it.kind !== 'file') throw gasError(`Converting from ${FOLDER_MIME} to application/pdf is not supported.`);
        return fakeBlob(Buffer.from(it.data), it.mime, it.name);
      },
      getParents: () => parentsOf(it),
      isTrashed: () => inTrash(it),
      setTrashed: (v) => ((it.trashed = !!v), f),
    };
    return f;
  };
  const folderObj = (it) => {
    const f = {
      getId: () => it.id,
      getName: () => it.name,
      setName: (n) => ((it.name = String(n)), f),
      getParents: () => parentsOf(it),
      isTrashed: () => inTrash(it),
      setTrashed: (v) => ((it.trashed = !!v), f),
      createFolder: (name) => folderObj(add({ id: newId(), kind: 'folder', name: String(name), mime: FOLDER_MIME, parent: it.id, trashed: false })),
      // createFile(blob) or createFile(name, content, mimeType)
      createFile: (blob, content, mime) => {
        const b = typeof blob === 'string' ? Utilities.newBlob(String(content ?? ''), mime || 'text/plain', blob) : blob;
        const data = blobData.get(b);
        if (!data) throw gasError("The parameters (Object) don't match the method signature for DriveApp.Folder.createFile.");
        return fileObj(add({ id: newId(), kind: 'file', name: b.getName() || 'Untitled', mime: b.getContentType() || 'application/octet-stream', data: Buffer.from(data), parent: it.id, trashed: false }));
      },
      getFiles: () => iterator([...items.values()].filter((x) => x.kind === 'file' && x.parent === it.id).map(fileObj)),
      getFilesByName: (name) => iterator([...items.values()].filter((x) => x.kind === 'file' && x.parent === it.id && x.name === String(name)).map(fileObj)),
    };
    return f;
  };
  const lookup = (method, wrap, kinds) => (id) => {
    allowed(method);
    const it = items.get(String(id));
    if (!it || !kinds.includes(it.kind)) throw gasError(NO_ITEM);
    return wrap(it);
  };
  const root = () => folderObj(items.get(ROOT));
  const DriveApp = {
    getFolderById: lookup('getFolderById', folderObj, ['folder']),
    getFileById: lookup('getFileById', fileObj, ['file', 'folder']), // a folder id gives a File with the folder MIME type
    getRootFolder: () => (allowed('getRootFolder'), root()),
    createFolder: (name) => (allowed('createFolder'), root().createFolder(name)),
    createFile: (...a) => (allowed('createFile'), root().createFile(...a)),
  };
  const remove = (id) => {
    for (const x of [...items.values()]) if (x.parent === id) remove(x.id);
    items.delete(id);
  };
  const drive = {
    list: () =>
      [...items.values()]
        .filter((it) => it.id !== ROOT)
        .map((it) => ({ id: it.id, kind: it.kind, name: it.name, parent: it.parent, trashed: inTrash(it), mime: it.mime, size: it.kind === 'file' ? it.data.length : 0 })),
    remove,
  };
  return { DriveApp, drive };
}

/**
 * Create an isolated simulated deployment. `teamKey` replaces the empty TEAM_KEY constant;
 * `driveAuthorized: false` = the owner has not allowed Google Drive access yet (DriveApp throws);
 * `kdfIter` = the PBKDF2 iterations of the team (stored as KDF_ITER before the script runs, so tests
 * derive passwords quickly; a real script starts at 200000).
 */
export function createGasSim({ teamKey = 'test-key-123', code, driveAuthorized = true, kdfIter = 1000 } = {}) {
  let src = code ?? readFileSync(join(here, 'Code.gs'), 'utf8');
  src = src.replace(/const TEAM_KEY = '.*?';/, `const TEAM_KEY = ${JSON.stringify(teamKey)};`);
  const sheets = {};
  const props = { KDF_ITER: String(kdfIter) };
  // the script cache (CacheService): `cache` holds the values, `cacheExp` when each expires by the
  // host's clock (Date.now(), so vi.setSystemTime moves it); Google may also drop entries early, see evictCache
  const cache = {};
  const cacheExp = {};
  const live = (k) => {
    if (!(k in cache)) return false;
    if (cacheExp[k] !== undefined && Date.now() >= cacheExp[k]) {
      delete cache[k];
      delete cacheExp[k];
      return false;
    }
    return true;
  };
  const stats = { propRead: 0, propWrite: 0, cacheGet: 0 }; // calls, as counted against Apps Script quotas
  const logs = []; // Logger.log output (the editor's Execution log)
  const { DriveApp, drive } = fakeDrive(driveAuthorized);
  let locked = false;
  let onLock = null;
  const acquire = () => {
    if (locked) return false;
    const fn = onLock;
    onLock = null;
    if (fn) fn(); // e.g. another request that got the lock first runs to completion
    return (locked = true);
  };
  const sandbox = {
    SpreadsheetApp: {
      flush: () => {},
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = fakeSheet(n)),
        toast: () => {},
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (!acquire()) throw new Error('lock timeout');
        },
        tryLock: () => acquire(),
        releaseLock: () => {
          locked = false;
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (stats.propRead++, k in props ? props[k] : null),
        getProperties: () => (stats.propRead++, { ...props }),
        setProperty: (k, v) => {
          stats.propWrite++;
          props[k] = String(v);
        },
        deleteProperty: (k) => {
          stats.propWrite++;
          delete props[k];
        },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (stats.cacheGet++, live(k) ? cache[k] : null),
        getAll: (keys) => {
          stats.cacheGet++;
          const out = {};
          for (const k of keys) if (live(k)) out[k] = cache[k];
          return out;
        },
        // Apps Script's limits: keys up to 250 characters, expiry 1 s to 6 hours (600 s by default)
        put: (k, v, ttl = 600) => {
          if (String(k).length > 250) throw gasError('Argument too large: key');
          if (!(ttl >= 1 && ttl <= 21600)) throw gasError('Invalid argument: expirationInSeconds');
          cache[k] = String(v);
          cacheExp[k] = Date.now() + ttl * 1000;
        },
        remove: (k) => {
          delete cache[k];
          delete cacheExp[k];
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    DriveApp,
    Utilities,
    Logger: { log: (m) => void logs.push(String(m)) },
    JSON, Math, String, Number, Array, Object, Error,
  };
  // the host's Date at the time of each call, so vi.useFakeTimers / vi.setSystemTime also move the
  // script's clock (token expiry, the "at" column), even for a simulator created before them
  Object.defineProperty(sandbox, 'Date', { get: () => globalThis.Date, enumerable: true });
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;globalThis.__api = { doGet, doPost, compact_, setup };', sandbox, { filename: 'Code.gs' });
  const api = sandbox.__api;
  const post = (body) => JSON.parse(api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  /** The last one-time code setup() printed ("1234-5678"), if any. */
  const ownerCode = () => (logs.join('\n').match(/(\d{4}-\d{4})(?!.*\d{4}-\d{4})/s) || [])[1];
  /** pk for a username and password, with this team's id and iteration count (run setup or hello first). */
  const pk = (u, pw) => derivePk(props.TEAM_ID, props.KDF_ITER, u, pw);
  return {
    /** POST a request object; returns the parsed JSON response. */
    post,
    get: () => JSON.parse(api.doGet().getContent()),
    /** Run setup() as the owner does from the editor. */
    setup: () => api.setup(),
    sheet: () => sheets.sync,
    /** Pre-create a sheet (e.g. an existing empty "sync" sheet without a header). */
    addSheet: (n) => (sheets[n] = fakeSheet(n)),
    props,
    cache,
    /** Drop everything in the script cache, as Google may do at any time. */
    evictCache: () => Object.keys(cache).forEach((k) => (delete cache[k], delete cacheExp[k])),
    /** Properties / cache calls made so far (the counters can be reset by assigning 0). */
    stats,
    /** Everything Logger.log printed. */
    logs,
    ownerCode,
    pk,
    /**
     * Turn the team into accounts mode as the lead does: run setup, then claim the printed code as
     * the first admin. Returns the admin's session token.
     */
    bootstrapAdmin: ({ u, name, pw, rm = true }) => {
      api.setup();
      const r = post({ action: 'claim', cv: 3, code: ownerCode(), u, name, pk: pk(u, pw), rm });
      if (!r.ok) throw new Error('claim failed: ' + r.error);
      return r.tok;
    },
    /** The fake services as Code.gs sees them (e.g. to put a file elsewhere in the owner's Drive). */
    DriveApp,
    Utilities,
    /** Every Drive item (trashed ones included); remove(id) deletes for good, like emptying the trash. */
    drive,
    /** Take the script lock as another execution would; returns the release function. */
    holdLock: () => {
      if (!acquire()) throw new Error('lock already held');
      return () => (locked = false);
    },
    /** Run fn just before the next lock is granted (a concurrent request that got there first). */
    beforeLock: (fn) => {
      onLock = fn;
    },
  };
}
