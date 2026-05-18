import http from 'node:http';
import { buildMockImageToVideoResponse, normalizeMockExternalMode } from '../services/MockExternalProvider.js';

const port = Number(process.env.MOCK_EXTERNAL_PORT || 3099);
const mode = normalizeMockExternalMode(process.env.MOCK_EXTERNAL_MODE || 'success');

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${port}`}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode }));
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/image-to-video') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    return;
  }

  const body = await readJson(req);
  console.log(`[mock:external] received task_id=${body.task_id || '-'} tool_type=${body.tool_type || '-'} mode=${mode}`);
  const response = buildMockImageToVideoResponse(mode);
  res.writeHead(response.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(response.body));
});

server.listen(port, () => {
  console.log(`[mock:external] listening http://localhost:${port}`);
  console.log(`[mock:external] mode=${mode}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

