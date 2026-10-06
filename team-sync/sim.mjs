// Runs team-sync/Code.gs in Node with in-memory fakes of the Google Apps Script services it
// uses (SpreadsheetApp, LockService, PropertiesService, ContentService). Used by the unit tests
// and by dev-server.mjs, so the real script — not a reimplementation — is what gets exercised.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

function fakeSheet(name) {
  const rows = []; // 1-based rows → rows[r-1], each an array of cell values ('' = empty)
  const cell = (r, c) => (rows[r - 1] && rows[r - 1][c - 1] !== undefined ? rows[r - 1][c - 1] : '');
  const range = (r, c, nr = 1, nc = 1) => ({
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
  });
  return {
    name,
    rows,
    getRange: range,
    getLastRow: () => {
      for (let i = rows.length; i > 0; i--) if (rows[i - 1] && rows[i - 1].some((x) => x !== '' && x != null)) return i;
      return 0;
    },
    setFrozenRows: () => {},
  };
}

/** Create an isolated simulated deployment. `teamKey` replaces the empty TEAM_KEY constant. */
export function createGasSim({ teamKey = 'test-key-123', code } = {}) {
  let src = code ?? readFileSync(join(here, 'Code.gs'), 'utf8');
  src = src.replace(/const TEAM_KEY = '.*?';/, `const TEAM_KEY = ${JSON.stringify(teamKey)};`);
  const sheets = {};
  const props = {};
  let locked = false;
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = fakeSheet(n)),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (locked) throw new Error('lock timeout');
          locked = true;
        },
        tryLock: () => (locked ? false : (locked = true)),
        releaseLock: () => {
          locked = false;
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => {
          props[k] = String(v);
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    JSON, Date, Math, String, Number, Array, Object, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;globalThis.__api = { doGet, doPost, compact_ };', sandbox, { filename: 'Code.gs' });
  const api = sandbox.__api;
  return {
    /** POST a request object; returns the parsed JSON response. */
    post: (body) => JSON.parse(api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
    get: () => JSON.parse(api.doGet().getContent()),
    sheet: () => sheets.sync,
    props,
  };
}
