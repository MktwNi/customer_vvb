// Local stand-in for the Apps Script web app: serves the real Code.gs (via sim.mjs) over HTTP
// with the same CORS behaviour, for development and end-to-end tests. Attached documents are
// kept in the simulator's in-memory Drive (gone when the server stops).
//   node team-sync/dev-server.mjs [port] [teamKey] [--kdf N] [--code file]
//     port 0 = any free port; teamKey defaults to test-key-123 (legacy mode), '' starts in setup mode;
//     --kdf = PBKDF2 iterations for passwords (default 1000, so signing in is quick while developing);
//     --code = another copy of the script, e.g. fixtures/Code.v3.gs (the one deployed before roles), to try
//     a web app build against it.
// setup() runs at start, so the one-time code for claiming the first admin is printed here. The e-mail
// notifications run too: notifyTick every minute (the real trigger: every 10), and every mail the script
// "sends" is printed instead (e.g. the 6-digit code that verifies an address). Nothing leaves the machine.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createGasSim } from './sim.mjs';

const args = process.argv.slice(2);
let kdfIter, codeFile;
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--kdf') kdfIter = Number(args[++i]);
  else if (args[i] === '--code') codeFile = args[++i];
  else pos.push(args[i]);
}
if (kdfIter !== undefined && !(kdfIter >= 1)) throw new Error('--kdf needs a number of iterations, e.g. --kdf 1000');
const port = +(pos[0] || 8787);
const key = pos[1] ?? 'test-key-123';
const code = codeFile ? readFileSync(codeFile, 'utf8') : undefined;
const sim = createGasSim({ teamKey: key, kdfIter, ...(code ? { code } : {}) });
sim.setup();
sim.mail.log = (m) => console.log(`mail to ${m.to}: ${m.subject}`);
// a script from before the e-mail notifications has no notifyTick
if (!code || /function notifyTick\(/.test(code)) setInterval(() => {
  try {
    sim.run('notifyTick');
  } catch (e) {
    console.log('notifyTick: ' + String(e.message || e));
  }
}, 60000).unref();

const server = createServer((req, res) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method === 'GET') {
    res.writeHead(200, headers);
    return res.end(JSON.stringify(sim.get()));
  }
  // decode once at the end: a multi-byte (Thai) character may be split across chunks of a large upload
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let out;
    try {
      out = sim.post(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      out = { ok: false, error: String(e.message || e) };
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(out));
  });
});
server.listen(port, () => {
  console.log(`team-sync dev server on http://localhost:${server.address().port} (key: ${key ? key : 'none — setup mode'}, kdf: ${sim.props.KDF_ITER}${codeFile ? ', script: ' + codeFile : ''})`);
  console.log(`owner code: ${sim.ownerCode()}`);
});
