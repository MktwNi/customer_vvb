// Local stand-in for the Apps Script web app: serves the real Code.gs (via sim.mjs) over HTTP
// with the same CORS behaviour, for development and end-to-end tests. Attached documents are
// kept in the simulator's in-memory Drive (gone when the server stops).
//   node team-sync/dev-server.mjs [port] [teamKey]      (port 0 = any free port)
import { createServer } from 'node:http';
import { createGasSim } from './sim.mjs';

const port = +(process.argv[2] || 8787);
const key = process.argv[3] || 'test-key-123';
const sim = createGasSim({ teamKey: key });

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
server.listen(port, () => console.log(`team-sync dev server on http://localhost:${server.address().port} (key: ${key})`));
