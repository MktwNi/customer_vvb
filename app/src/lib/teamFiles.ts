// PLACEHOLDER — replaced by the full implementation from branch wf/drive-files (same signatures).
import { call, type Transport } from './teamSync';

export const fileFetchTransport: Transport = async (url, body) => {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  return JSON.parse(await r.text());
};
export function blobToBase64(b: Blob): Promise<string> {
  return b.arrayBuffer().then((a) => {
    let s = '';
    const u = new Uint8Array(a);
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  });
}
export function base64ToBlob(b64: string, mime: string): Blob {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Blob([u], { type: mime });
}
export async function uploadDocFile(t: Transport, url: string, key: string, f: { docId: string; name: string; mime: string; blob: Blob }): Promise<{ fileId: string; size: number }> {
  const r = await call<{ fileId: string; size: number }>(t, url, key, { action: 'upload', docId: f.docId, name: f.name, mime: f.mime, data: await blobToBase64(f.blob) });
  return { fileId: r.fileId, size: r.size };
}
export async function downloadDocFile(t: Transport, url: string, key: string, fileId: string): Promise<{ blob: Blob; name: string; mime: string }> {
  const r = await call<{ name: string; mime: string; data: string }>(t, url, key, { action: 'file', fileId });
  return { blob: base64ToBlob(r.data, r.mime), name: r.name, mime: r.mime };
}
export async function deleteDocFile(t: Transport, url: string, key: string, fileId: string): Promise<void> {
  await call(t, url, key, { action: 'delfile', fileId });
}
export async function scriptSupportsFiles(t: Transport, url: string, key: string): Promise<boolean> {
  const r = await call<{ files?: boolean }>(t, url, key, { action: 'ping' });
  return r.files === true;
}
