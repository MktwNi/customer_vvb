import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasSim, type GasSim } from '../../../team-sync/sim.mjs';
import { base64ToBlob, blobToBase64, deleteDocFile, DOC_ACCEPT, DOC_MAX_BYTES, docMime, downloadDocFile, fileFetchTransport, scriptSupportsFiles, uploadDocFile } from './teamFiles';
import { call, errText, TeamSyncError, type Transport } from './teamSync';

// the 10 MB cases push ~14 MB of base64 through JSON and the simulator
vi.setConfig({ testTimeout: 30000 });
const KEY = 'test-key-123';
const URL = 'https://script.google.com/macros/s/x/exec';
const FOLDER = 'GCC Sales Tracker — เอกสาร';
const TEAM_SYNC = join(__dirname, '..', '..', '..', 'team-sync');
// a real 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Binary PDF-like content: every byte value (NUL, CR/LF, 0x80–0xFF…) between a PDF header and trailer. */
const pdfBytes = () => {
  const enc = new TextEncoder();
  const body = Uint8Array.from({ length: 256 * 40 }, (_, i) => (i * 31 + (i >> 8)) & 255);
  return new Uint8Array([...enc.encode('%PDF-1.7\n%âã\n'), ...body, ...enc.encode('\n%%EOF\n')]);
};
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** A transport answered by the simulated deployment; `calls` lists the actions it received. */
const via = (s: GasSim) => {
  const calls: string[] = [];
  const t: Transport = async (_u, body) => (calls.push(String(body.action)), s.post(body));
  return Object.assign(t, { calls });
};
const folders = (s: GasSim) => s.drive.list().filter((x) => x.kind === 'folder' && x.name === FOLDER);
const item = (s: GasSim, id: string) => s.drive.list().find((x) => x.id === id)!;
const uploadBody = (docId: string, extra: Record<string, unknown> = {}) => ({ action: 'upload', key: KEY, docId, name: docId + '.pdf', mime: 'application/pdf', data: 'JVBERg==', ...extra });

describe('attached documents through Code.gs (run in the simulator)', () => {
  let s: GasSim;
  let t: ReturnType<typeof via>;
  beforeEach(() => {
    s = createGasSim({ teamKey: KEY });
    t = via(s);
  });
  const up = (docId: string, blob = new Blob([pdfBytes()])) => uploadDocFile(t, URL, KEY, { docId, name: docId + '.pdf', mime: 'application/pdf', blob });

  it('round-trips a binary PDF and a PNG byte for byte', async () => {
    const pdf = pdfBytes();
    const a = await uploadDocFile(t, URL, KEY, { docId: 'deal-1.q1', name: 'ใบเสนอราคา QT-001.pdf', mime: 'application/pdf', blob: new Blob([pdf]) });
    const b = await uploadDocFile(t, URL, KEY, { docId: 'deal-1.inv1', name: 'invoice.png', mime: 'image/png', blob: new Blob([PNG], { type: 'image/png' }) });
    expect(a.size).toBe(pdf.length);
    expect(b.size).toBe(PNG.length);
    const da = await downloadDocFile(t, URL, KEY, a.fileId);
    expect(da).toMatchObject({ name: 'ใบเสนอราคา QT-001.pdf', mime: 'application/pdf' });
    expect(da.blob.type).toBe('application/pdf');
    expect(await bytesOf(da.blob)).toEqual(pdf);
    const db = await downloadDocFile(t, URL, KEY, b.fileId);
    expect(db).toMatchObject({ name: 'invoice.png', mime: 'image/png' });
    expect(Buffer.from(await bytesOf(db.blob)).equals(PNG)).toBe(true);
    // in the owner's Drive: "<docId>__<name>" inside the documents folder
    const [folder] = folders(s);
    expect(s.props.DOC_FOLDER).toBe(folder.id);
    expect(item(s, a.fileId)).toMatchObject({ name: 'deal-1.q1__ใบเสนอราคา QT-001.pdf', parent: folder.id, mime: 'application/pdf', size: pdf.length, trashed: false });
    expect(item(s, b.fileId)).toMatchObject({ name: 'deal-1.inv1__invoice.png', parent: folder.id, mime: 'image/png' });
    expect(t.calls).toEqual(['upload', 'upload', 'file', 'file']);
  });

  it('creates the documents folder once, also when two first uploads race for it', async () => {
    await up('a');
    await up('b');
    expect(folders(s)).toHaveLength(1);
    // the other request creates the folder while this one waits for the script lock
    const s2 = createGasSim({ teamKey: KEY });
    s2.beforeLock(() => expect(s2.post(uploadBody('x')).ok).toBe(true));
    expect(s2.post(uploadBody('y')).ok).toBe(true);
    expect(folders(s2)).toHaveLength(1);
    expect(s2.drive.list().filter((x) => x.kind === 'file' && x.parent === folders(s2)[0].id)).toHaveLength(2);
    // setup (run by the owner from the editor) makes the same single folder
    const s3 = createGasSim({ teamKey: KEY });
    s3.setup();
    s3.setup();
    expect(s3.post(uploadBody('z')).ok).toBe(true);
    expect(folders(s3)).toHaveLength(1);
    expect(s3.sheet()!.rows[0][0]).toBe('seq');
  });

  it('makes a new folder when the owner trashed or deleted it; files of the old one are no longer served', async () => {
    const a = await up('a');
    const old = s.props.DOC_FOLDER;
    s.DriveApp.getFolderById(old).setTrashed(true);
    expect(s.post({ action: 'file', key: KEY, fileId: a.fileId })).toEqual({ ok: false, error: 'not_found' });
    const b = await up('b');
    expect(s.props.DOC_FOLDER).not.toBe(old);
    expect(folders(s).map((f) => [f.id === old, f.trashed])).toEqual([[true, true], [false, false]]);
    expect((await downloadDocFile(t, URL, KEY, b.fileId)).name).toBe('b.pdf');
    // deleted for good (trash emptied): the stored id no longer resolves
    s.drive.remove(s.props.DOC_FOLDER);
    const c = await up('c');
    expect(folders(s).filter((f) => !f.trashed)).toHaveLength(1);
    expect(item(s, c.fileId).parent).toBe(s.props.DOC_FOLDER);
    expect((await downloadDocFile(t, URL, KEY, c.fileId)).name).toBe('c.pdf');
  });

  it('accepts files up to exactly 10 MB and refuses larger or empty ones', async () => {
    const big = new Uint8Array(DOC_MAX_BYTES).fill(0xa5);
    expect((await up('big', new Blob([big]))).size).toBe(DOC_MAX_BYTES);
    t.calls.length = 0;
    // one byte more: refused before anything is sent …
    await expect(up('over', new Blob([big, new Uint8Array(1)]))).rejects.toThrow('ไฟล์ใหญ่เกิน 10 MB');
    await expect(up('empty', new Blob([]))).rejects.toThrow('ไฟล์ว่างเปล่า');
    expect(t.calls).toEqual([]);
    // … and by the script itself (an older or modified web app)
    const over = Buffer.alloc(DOC_MAX_BYTES + 1).toString('base64');
    expect(s.post(uploadBody('x', { data: over })).error).toBe('file_too_large');
    expect(s.post(uploadBody('x', { data: over + 'AAAA' })).error).toBe('file_too_large');
    expect(s.post(uploadBody('x', { data: '' })).error).toBe('empty_file');
    expect(s.post(uploadBody('x', { data: undefined })).error).toBe('empty_file');
    expect(s.post(uploadBody('x', { data: 'not base64!' })).error).toBe('bad_data');
    const err = await call(t, URL, KEY, uploadBody('x', { data: over })).catch((e: unknown) => e);
    expect(errText(err)).toBe('ไฟล์ใหญ่เกิน 10 MB');
    expect(s.drive.list().filter((x) => x.kind === 'file')).toHaveLength(1);
  });

  it('accepts only PDF and images', async () => {
    for (const mime of ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'IMAGE/PNG'])
      expect(s.post(uploadBody('ok', { mime }))).toMatchObject({ ok: true, size: 4 });
    for (const mime of ['text/html', 'image/svg+xml', 'application/zip', 'application/octet-stream', 'application/pdf; x', '', undefined])
      expect(s.post(uploadBody('no', { mime }))).toEqual({ ok: false, error: 'bad_file_type' });
    t.calls.length = 0;
    const blob = new Blob([PNG]);
    await expect(uploadDocFile(t, URL, KEY, { docId: 'd', name: 'page.html', mime: 'text/html', blob })).rejects.toThrow('รองรับเฉพาะ PDF หรือรูปภาพ (PNG, JPG, WEBP, HEIC)');
    await expect(uploadDocFile(t, URL, KEY, { docId: 'd', name: 'sheet.xlsx', mime: '', blob })).rejects.toThrow(TeamSyncError);
    expect(t.calls).toEqual([]);
    // a HEIC photo the browser gave no type goes by its extension
    const heic = await uploadDocFile(t, URL, KEY, { docId: 'd', name: 'IMG_0001.HEIC', mime: '', blob });
    expect(item(s, heic.fileId).mime).toBe('image/heic');
    expect(docMime({ name: 'scan.jpg', type: 'image/jpg' })).toBe('image/jpeg');
    expect(docMime({ name: 'x.pdf', type: 'application/octet-stream' })).toBe('application/pdf');
    expect(docMime({ name: 'quote.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('');
    expect(DOC_ACCEPT.split(',')).toEqual(expect.arrayContaining(['application/pdf', 'image/heic', '.heic', '.jpg']));
  });

  it('stores a safe file name, keeps the original for opening, and needs a record id', async () => {
    const blob = new Blob([PNG]);
    const a = await uploadDocFile(t, URL, KEY, { docId: 'deal/7 ไทย__x_', name: '  ../ใบแจ้งหนี้:\tINV<01>?.png ', mime: 'image/png', blob });
    expect(item(s, a.fileId).name).toBe('deal-7-_x__.._ใบแจ้งหนี้_INV_01_.png');
    expect((await downloadDocFile(t, URL, KEY, a.fileId)).name).toBe('.._ใบแจ้งหนี้_INV_01_.png');
    const long = await uploadDocFile(t, URL, KEY, { docId: 'd', name: 'ก'.repeat(300) + '.png', mime: 'image/png', blob });
    expect((await downloadDocFile(t, URL, KEY, long.fileId)).name).toBe('ก'.repeat(146) + '.png');
    expect(s.post(uploadBody('', {})).error).toBe('bad_doc_id');
    expect(s.post(uploadBody('x', { docId: undefined })).error).toBe('bad_doc_id');
  });

  it('requires the team code for every file action', async () => {
    const a = await up('a');
    for (const body of [uploadBody('d'), { action: 'file', fileId: a.fileId }, { action: 'delfile', fileId: a.fileId }])
      expect(s.post({ ...body, key: 'wrong-key-1' })).toEqual({ ok: false, error: 'unauthorized' });
    await expect(uploadDocFile(t, URL, 'wrong-key-1', { docId: 'c', name: 'c.pdf', mime: 'application/pdf', blob: new Blob([PNG]) })).rejects.toThrow('รหัสทีมไม่ถูกต้อง');
    await expect(downloadDocFile(t, URL, 'wrong-key-1', a.fileId)).rejects.toThrow('รหัสทีมไม่ถูกต้อง');
    await expect(deleteDocFile(t, URL, 'wrong-key-1', a.fileId)).rejects.toThrow('รหัสทีมไม่ถูกต้อง'); // not mistaken for "already gone"
    expect(item(s, a.fileId).trashed).toBe(false);
  });

  it('never opens or deletes a file outside the documents folder', async () => {
    const other = s.DriveApp.createFile(s.Utilities.newBlob(s.Utilities.base64Decode('JVBERg=='), 'application/pdf', 'สัญญา.pdf'));
    // before the folder exists
    expect(s.post({ action: 'file', key: KEY, fileId: other.getId() })).toEqual({ ok: false, error: 'not_found' });
    await up('a');
    const sub = s.DriveApp.getFolderById(s.props.DOC_FOLDER).createFolder('ย่อย');
    const nested = sub.createFile(s.Utilities.newBlob([1, 2, 3], 'application/pdf', 'nested.pdf'));
    // e.g. a Google Doc the owner made in the folder: not something the web app uploaded
    const gdoc = s.DriveApp.getFolderById(s.props.DOC_FOLDER).createFile('notes', '', 'application/vnd.google-apps.document');
    for (const fileId of [other.getId(), nested.getId(), sub.getId(), gdoc.getId(), s.props.DOC_FOLDER, 'root', 'no-such-id', '', '../x', 'x'.repeat(300), undefined, 42]) {
      expect(s.post({ action: 'file', key: KEY, fileId })).toEqual({ ok: false, error: 'not_found' });
      expect(s.post({ action: 'delfile', key: KEY, fileId })).toEqual({ ok: false, error: 'not_found' });
    }
    expect([other, nested, gdoc, sub].map((x) => x.isTrashed())).toEqual([false, false, false, false]);
    await expect(downloadDocFile(t, URL, KEY, other.getId())).rejects.toThrow('ไม่พบไฟล์ในโฟลเดอร์เอกสารของทีม');
  });

  it('serves only upload types, and refuses files too big to send back', async () => {
    await up('a');
    const folder = s.DriveApp.getFolderById(s.props.DOC_FOLDER);
    // dropped into the folder by hand: opened as a page in the app's origin, these could read the team code
    const html = folder.createFile(s.Utilities.newBlob([60, 104, 49, 62], 'text/html', 'x__a.html'));
    const svg = folder.createFile(s.Utilities.newBlob([60, 115, 118, 103, 62], 'image/svg+xml', 'x__a.svg'));
    for (const f of [html, svg]) expect(s.post({ action: 'file', key: KEY, fileId: f.getId() })).toEqual({ ok: false, error: 'not_found' });
    const big = folder.createFile(s.Utilities.newBlob(new Array(DOC_MAX_BYTES + 1).fill(1), 'application/pdf', 'scan.pdf'));
    expect(s.post({ action: 'file', key: KEY, fileId: big.getId() })).toEqual({ ok: false, error: 'file_too_large' });
  });

  it('a file Drive can no longer open counts as gone, so its attachment can still be removed', async () => {
    const a = await up('a');
    const get = s.DriveApp.getFileById;
    s.DriveApp.getFileById = () => {
      throw new Error('Unexpected error while getting the method or property getFileById on object DriveApp.');
    };
    try {
      expect(s.post({ action: 'file', key: KEY, fileId: a.fileId })).toEqual({ ok: false, error: 'not_found' });
      await expect(deleteDocFile(t, URL, KEY, a.fileId)).resolves.toBeUndefined();
    } finally {
      s.DriveApp.getFileById = get;
    }
  });

  it('setup starts a new folder when the stored one can\'t be opened; uploads never do', async () => {
    await up('a');
    const old = s.props.DOC_FOLDER;
    const get = s.DriveApp.getFolderById;
    s.DriveApp.getFolderById = (id: string) => {
      if (id === old) throw new Error('Unexpected error while getting the method or property getFolderById on object DriveApp.');
      return get(id);
    };
    try {
      // a brief Drive outage looks the same: an upload must not orphan every attachment by moving on
      expect(s.post(uploadBody('b')).error).toMatch(/Unexpected error/);
      expect(s.props.DOC_FOLDER).toBe(old);
      s.setup();
      expect(s.props.DOC_FOLDER).not.toBe(old);
      expect(s.post(uploadBody('c')).ok).toBe(true);
    } finally {
      s.DriveApp.getFolderById = get;
    }
  });

  it('delfile moves the file to the trash; deleting it again is harmless', async () => {
    const a = await up('a');
    const b = await up('b');
    await deleteDocFile(t, URL, KEY, a.fileId);
    expect(item(s, a.fileId).trashed).toBe(true);
    expect(s.post({ action: 'file', key: KEY, fileId: a.fileId })).toEqual({ ok: false, error: 'not_found' });
    expect(s.post({ action: 'delfile', key: KEY, fileId: a.fileId })).toEqual({ ok: false, error: 'not_found' });
    await expect(deleteDocFile(t, URL, KEY, a.fileId)).resolves.toBeUndefined(); // e.g. removed from another browser
    expect(await bytesOf((await downloadDocFile(t, URL, KEY, b.fileId)).blob)).toEqual(pdfBytes());
    const offline: Transport = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(deleteDocFile(offline, URL, KEY, b.fileId)).rejects.toThrow(TypeError);
  });

  it('uploads and downloads never wait for the sync lock once the folder exists', async () => {
    await up('a');
    const release = s.holdLock(); // e.g. a teammate's large push in progress
    try {
      expect(s.post({ action: 'push', key: KEY, ops: [{ k: 'stage/1', v: 'won' }] }).error).toBe('busy');
      const b = await up('b');
      expect((await downloadDocFile(t, URL, KEY, b.fileId)).name).toBe('b.pdf');
      await deleteDocFile(t, URL, KEY, b.fileId);
    } finally {
      release();
    }
    // only creating the folder takes the lock
    const s2 = createGasSim({ teamKey: KEY });
    const r2 = s2.holdLock();
    expect(s2.post(uploadBody('x')).error).toBe('busy');
    r2();
    expect(s2.post(uploadBody('x')).ok).toBe(true);
  });

  it('ping tells the web app that this script stores files', async () => {
    expect(s.post({ action: 'ping', key: KEY })).toEqual({ ok: true, seq: 0, files: true });
    expect(await scriptSupportsFiles(t, URL, KEY)).toBe(true);
    await expect(scriptSupportsFiles(t, URL, 'wrong-key-1')).rejects.toThrow('รหัสทีมไม่ถูกต้อง');
  });

  it('recognises a deployed script from before attachments', async () => {
    const code = readFileSync(join(TEAM_SYNC, 'Code.gs'), 'utf8');
    const oldCode = code.replace('seq: curSeq_(), files: true', 'seq: curSeq_()').replace(/ {6}case 'upload':[\s\S]*?(?= {6}default:)/, '');
    expect(oldCode).not.toMatch(/Seq_\(\), files|case '(upload|file|delfile)'/);
    const old = createGasSim({ teamKey: KEY, code: oldCode });
    const ot = via(old);
    expect(old.post({ action: 'ping', key: KEY })).toEqual({ ok: true, seq: 0 });
    expect(await scriptSupportsFiles(ot, URL, KEY)).toBe(false);
    const err = await uploadDocFile(ot, URL, KEY, { docId: 'a', name: 'a.pdf', mime: 'application/pdf', blob: new Blob([PNG]) }).catch((e) => e);
    expect(err).toBeInstanceOf(TeamSyncError);
    expect(err.code).toBe('unknown_action');
    expect(errText(err, 'connect')).toBe('สคริปต์ของทีมยังเป็นเวอร์ชันเก่า — อัปเดต Code.gs แล้ว Deploy เวอร์ชันใหม่ เพื่อเปิดใช้การแนบเอกสาร');
    await expect(downloadDocFile(ot, URL, KEY, 'abc')).rejects.toThrow('เวอร์ชันเก่า');
    await expect(deleteDocFile(ot, URL, KEY, 'abc')).rejects.toThrow('เวอร์ชันเก่า');
    expect(old.post({ action: 'push', key: KEY, ops: [{ k: 'stage/1', v: 'won' }] }).ok).toBe(true); // team sync is unaffected
  });

  it('explains a script whose owner has not allowed Google Drive yet, and sync keeps working', async () => {
    const n = createGasSim({ teamKey: KEY, driveAuthorized: false });
    expect(n.post({ action: 'ping', key: KEY })).toMatchObject({ ok: true, files: true });
    expect(n.post({ action: 'push', key: KEY, ops: [{ k: 'stage/1', v: 'won' }] }).ok).toBe(true);
    expect(n.post(uploadBody('a'))).toEqual({ ok: false, error: 'drive_permission' });
    await expect(uploadDocFile(via(n), URL, KEY, { docId: 'a', name: 'a.pdf', mime: 'application/pdf', blob: new Blob([PNG]) })).rejects.toThrow(
      'หัวหน้าทีมยังไม่ได้อนุญาตให้สคริปต์ใช้ Google Drive',
    );
    expect(() => n.setup()).toThrow('Required permissions'); // in the editor this is where Google asks
  });
});

describe('base64 helpers', () => {
  it('match Node\'s encoder and round-trip at chunk boundaries', async () => {
    for (const n of [0, 1, 2, 3, 4, 0x7fff, 0x8000, 0x8001, 100003]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 131 + 7) & 255);
      const b64 = await blobToBase64(new Blob([bytes]));
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      const back = base64ToBlob(b64, 'image/png');
      expect(back.type).toBe('image/png');
      expect(await bytesOf(back)).toEqual(bytes);
    }
  });
});

describe('fileFetchTransport', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('posts JSON as text/plain and gives a slow upload 180 s (team sync gives up after 45 s)', async () => {
    vi.useFakeTimers();
    let seen: RequestInit | undefined;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      seen = init;
      return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
    });
    const p = fileFetchTransport(URL, { action: 'file', key: KEY, fileId: 'x' });
    const settled = vi.fn();
    p.then(settled, settled);
    await vi.advanceTimersByTimeAsync(179000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    const err = await p.catch((e) => e);
    expect(err.name).toBe('TimeoutError');
    expect(errText(err, 'connect')).toContain('ลองกดอีกครั้ง');
    expect(seen!.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(JSON.parse(String(seen!.body))).toEqual({ action: 'file', key: KEY, fileId: 'x' });
  });

  it('turns HTTP errors and non-JSON pages (Google sign-in) into readable errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Sign in</html>'));
    await expect(fileFetchTransport(URL, {})).rejects.toThrow('ลิงก์ไม่ถูกต้อง');
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }));
    await expect(fileFetchTransport(URL, {})).rejects.toThrow('HTTP 503');
  });
});

describe('team-sync/dev-server.mjs (real HTTP and fetch)', () => {
  it('uploads, opens and deletes a document; large Thai bodies arrive intact', async () => {
    const srv = spawn(process.execPath, [join(TEAM_SYNC, 'dev-server.mjs'), '0', KEY], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = '';
        srv.stdout!.on('data', (c) => {
          out += c;
          const m = /http:\/\/localhost:\d+/.exec(out);
          if (m) resolve(m[0]);
        });
        srv.on('exit', (code) => reject(new Error('dev server exited: ' + code)));
      });
      expect(await scriptSupportsFiles(fileFetchTransport, url, KEY)).toBe(true);
      const pdf = Buffer.from(new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31 + (i >> 8)) & 255));
      const a = await uploadDocFile(fileFetchTransport, url, KEY, { docId: 'e2e', name: 'ใบเสนอราคา.pdf', mime: 'application/pdf', blob: new Blob([pdf]) });
      expect(a.size).toBe(pdf.length);
      const d = await downloadDocFile(fileFetchTransport, url, KEY, a.fileId);
      expect(d.name).toBe('ใบเสนอราคา.pdf');
      // Buffer.equals, not toEqual: a multi-second deep compare blocks the loop past the server's keep-alive
      expect(Buffer.from(await bytesOf(d.blob)).equals(pdf)).toBe(true);
      await deleteDocFile(fileFetchTransport, url, KEY, a.fileId);
      await expect(downloadDocFile(fileFetchTransport, url, KEY, a.fileId)).rejects.toThrow('ไม่พบไฟล์');
      // Thai text spanning many request chunks (each character is 3 bytes in UTF-8)
      const note = 'บันทึกการติดต่อ'.repeat(2800);
      expect(await fileFetchTransport(url, { action: 'push', key: KEY, ops: [{ k: 'log/1/a', v: { text: note } }] })).toMatchObject({ ok: true, n: 1 });
      const pulled = (await fileFetchTransport(url, { action: 'pull', key: KEY, since: 0 })) as { rows: { v: { text: string } }[] };
      expect(pulled.rows[0].v.text).toBe(note);
    } finally {
      srv.kill();
    }
  });
});
