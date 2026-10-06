// Local stand-in for the Apps Script web app: serves the real Code.gs (via sim.mjs) over HTTP
// with the same CORS behaviour, for development and end-to-end tests.
//   node team-sync/dev-server.mjs [port] [teamKey]
import { createServer } from 'node:http';
import { createGasSim } from './sim.mjs';

const port = +(process.argv[2] || 8787);
const key = process.argv[3] || 'test-key-123';
const sim = createGasSim({ teamKey: key });

createServer((req, res) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method === 'GET') {
    res.writeHead(200, headers);
    return res.end(JSON.stringify(sim.get()));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out;
    try {
      out = sim.post(body);
    } catch (e) {
      out = { ok: false, error: String(e.message || e) };
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(out));
  });
}).listen(port, () => console.log(`team-sync dev server on http://localhost:${port} (key: ${key})`));
