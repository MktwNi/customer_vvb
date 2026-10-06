// Copies the datasets the app reads from ../project/data (the single source of truth,
// also written by tools/tgo-sync.mjs) into public/data so Vite serves and bundles them.
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, '..', 'project', 'data');
const dst = join(root, 'public', 'data');
const FILES = ['gcc.json', 'gcc-certs.json', 'gcc-sources.json', 'rounds.json', 'th-provinces.json', 'gcc-detail'];

if (!existsSync(src)) {
  console.error(`sync-data: source folder not found: ${src}`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of FILES) {
  const from = join(src, f), to = join(dst, f);
  if (!existsSync(from)) { console.warn(`sync-data: missing ${f}`); continue; }
  if (existsSync(to) && !statSync(from).isDirectory() && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  cpSync(from, to, { recursive: true });
  n++;
}
console.log(`sync-data: ${n} item(s) copied to public/data`);
