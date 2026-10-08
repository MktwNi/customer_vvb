/**
 * Attached documents (quotations, invoices) kept in the team lead's Google Drive. Files go through
 * the team's Apps Script web app (team-sync/Code.gs: upload / file / delfile) with the team code,
 * so teammates can open them without the Drive folder ever being shared with them. Only the
 * returned fileId needs to be stored (and synced) with the record the file belongs to.
 */
import { call, TeamSyncError, type Cred, type Transport } from './teamSync';

/** Same limit and types as Code.gs; checked here too so a file the script would refuse is not sent. */
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const DOC_MIMES: readonly string[] = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
/** For `<input type="file" accept>`; extensions too, since some systems give HEIC files no type. */
export const DOC_ACCEPT = [...DOC_MIMES, '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'].join(',');

const EXT_MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

/** The type to upload a picked file as, or '' if it isn't supported. Browsers leave `type` empty for
 *  HEIC photos on Windows and a few report "image/jpg", so this falls back to the extension. */
export function docMime(f: { name: string; type: string }): string {
  const t = f.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : f.type.toLowerCase();
  if (DOC_MIMES.includes(t)) return t;
  return EXT_MIME[/\.([^.]+)$/.exec(f.name)?.[1].toLowerCase() ?? ''] || '';
}

/** fetchTransport (teamSync.ts) with a 180 s instead of a 45 s timeout: a 10 MB file is ~13.4 MB of
 *  base64 each way, which takes minutes on a slow mobile connection. */
export const fileFetchTransport: Transport = async (url, body) => {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), 180000);
  let t: string;
  try {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) throw new TeamSyncError(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${r.status})`);
    t = await r.text(); // the timeout also covers a body download that stalls
  } finally {
    clearTimeout(to);
  }
  try {
    return JSON.parse(t);
  } catch {
    // typically Google's sign-in page: the web app is not shared with "Anyone", or not deployed yet
    throw new TeamSyncError('ลิงก์ไม่ถูกต้อง หรือสคริปต์ยังไม่ได้ Deploy ให้ "ทุกคน (Anyone)" เข้าถึงได้');
  }
};

/** Base64 of a blob's bytes (no "data:" prefix), built in chunks so a 10 MB file can't overflow
 *  String.fromCharCode's argument limit. */
export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Rejects with the TeamSyncError the script itself would answer with (Thai text from teamSync's
 *  error table), for a file refused before it is sent. */
async function refused(code: string): Promise<never> {
  await call(async () => ({ ok: false, error: code }), '', null, {});
  throw new TeamSyncError(code, code); // not reached: call() throws on ok:false
}

/** Upload a document for record `docId`; keep the returned fileId to open or delete it later. */
export async function uploadDocFile(t: Transport, url: string, key: Cred, f: { docId: string; name: string; mime: string; blob: Blob }): Promise<{ fileId: string; size: number }> {
  const mime = docMime({ name: f.name, type: f.mime });
  if (!mime) return refused('bad_file_type');
  if (!f.blob.size) return refused('empty_file');
  if (f.blob.size > DOC_MAX_BYTES) return refused('file_too_large');
  const r = await call(t, url, key, { action: 'upload', docId: f.docId, name: f.name, mime, data: await blobToBase64(f.blob) });
  return { fileId: String(r.fileId), size: Number(r.size) };
}

export async function downloadDocFile(t: Transport, url: string, key: Cred, fileId: string): Promise<{ blob: Blob; name: string; mime: string }> {
  const r = await call(t, url, key, { action: 'file', fileId });
  // the script only serves upload types, but never trust a type that could open as a page in the
  // app's origin (text/html, image/svg+xml): anything else becomes a plain download
  const mime = DOC_MIMES.includes(String(r.mime)) ? String(r.mime) : 'application/octet-stream';
  const blob = base64ToBlob(String(r.data ?? ''), mime);
  // never hand a damaged file to the PDF / image viewer
  if (blob.size !== Number(r.size)) throw new TeamSyncError('ได้รับไฟล์ไม่ครบ ลองเปิดอีกครั้ง');
  return { blob, name: String(r.name || ''), mime };
}

/** Moves the file to the owner's Drive trash. A file that is already gone counts as deleted
 *  (removed from another browser, or by the owner in Drive). */
export async function deleteDocFile(t: Transport, url: string, key: Cred, fileId: string): Promise<void> {
  try {
    await call(t, url, key, { action: 'delfile', fileId });
  } catch (e) {
    if (!(e instanceof TeamSyncError && e.code === 'not_found')) throw e;
  }
}

/** Whether the deployed script stores attachments; a script from before this feature has no
 *  `files` flag in its ping (and answers the file actions with unknown_action). */
export async function scriptSupportsFiles(t: Transport, url: string, key: Cred): Promise<boolean> {
  const r = await call(t, url, key, { action: 'ping' });
  return r.files === true;
}

/** Message for a failed upload / open / delete. errText (teamSync.ts) talks about the sheet and
 *  calls unknown script errors "sync failed", both misleading for a file. */
export function fileErrText(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'Google Drive ไม่ตอบกลับ (ไฟล์ใหญ่หรืออินเทอร์เน็ตช้า)';
  if (e instanceof TeamSyncError) {
    if (e.code === 'busy') return 'สคริปต์ของทีมไม่ว่างตอนนี้';
    return e.message.replace(/^ซิงก์ไม่สำเร็จ: /, 'Google Drive ตอบกลับผิดพลาด: ');
  }
  if (e instanceof TypeError) return typeof navigator !== 'undefined' && navigator.onLine === false ? 'ออฟไลน์อยู่' : 'เชื่อมต่อสคริปต์ของทีมไม่ได้';
  return String((e as Error)?.message || e);
}
