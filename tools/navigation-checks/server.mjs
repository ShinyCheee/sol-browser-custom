import { once } from 'node:events';
import { createServer } from 'node:http';

function buildFixturePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Contents 4 0 R >>',
    '<< /Length 25 >>\nstream\n0 0 1 rg 30 30 90 90 re f\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  const table = offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `xref\n0 5\n0000000000 65535 f \n${table}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

const SW_SCRIPT = [
  "self.addEventListener('install', () => self.skipWaiting());",
  "self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));",
  "self.addEventListener('fetch', e => {",
  "  if (new URL(e.request.url).pathname === '/api-real') {",
  "    e.respondWith(new Response('{\"serviceworker\":true}', { headers: { 'Content-Type': 'application/json' } }));",
  '  }',
  '});',
].join('');

const AGENT_DOC_HTML =
  '<title>Guide</title><main><h1>Installation</h1><p>Lancez la commande setup.</p>' +
  '<a href="/agent-api">Référence API</a> <a href="https://example.com/ext">Externe</a>' +
  '<button>Envoyer</button><input name="q"><input type="password" name="password">' +
  '<pre style="height:70px;margin:40px 120px 0 0;padding:12px;background:#eee">npm install sol</pre></main>';

export async function startFixtureServer(argv) {
  const echoRequests = [];
  const sessionRequests = [];
  const siteRequests = [];
  let markdownImageRequests = 0;

  const server = createServer((req, res) => {
    if (req.url === '/markdown-image.svg') {
      markdownImageRequests++;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="green"/></svg>');
    }
    if (argv.includes('--site-sessions')) {
      siteRequests.push({ host: req.headers.host, url: req.url, cookie: req.headers.cookie });
    }
    if (req.url === '/site-redirect') {
      res.writeHead(302, { Location: `http://localhost:${server.address().port}/signed-in` });
      return res.end();
    }
    if (['/document', '/download'].includes(req.url)) {
      sessionRequests.push({ url: req.url, cookie: req.headers.cookie });
    }
    if (req.url === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(SW_SCRIPT);
    }
    if (req.url === '/echo') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        echoRequests.push({ headers: req.headers, method: req.method, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: body, password: 'fixture-secret' }));
      });
      return;
    }
    if (req.url === '/api-real') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"real":true}');
    }
    if (req.url === '/redirect-once') {
      res.writeHead(307, { Location: '/echo' });
      return res.end();
    }
    if (req.url === '/document') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end(buildFixturePdf());
    }
    if (req.url === '/large-icon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="blue"/></svg>');
    }
    if (req.url === '/favicon.ico') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>');
    }
    if (req.url === '/agent-doc') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(AGENT_DOC_HTML);
    }
    if (req.url === '/agent-api') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<title>API</title><main><h1>API</h1><p>La méthode connect ouvre une session.</p></main>');
    }
    if (req.url === '/reset') return req.socket.resetAndDestroy();
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/redirect' });
      return res.end();
    }
    if (req.url === '/download') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="sol-check.txt"',
      });
      return res.end('Sol navigation regression check');
    }
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'Content-Type': 'text/html' });
    const respond = () =>
      res.end(
        `<html><head><title>Check ${req.url}</title><link href='/favicon.ico' rel='icon' sizes='16x16'><link sizes='any' href='/large-icon.svg' rel='icon'></head>` +
          `<body style="background:#f5f6fa;color:#172233;font:20px system-ui;margin:0"><div style="background:#2769d4;height:100px"></div>` +
          `<main style="padding:40px"><h1>Server page ${req.url}</h1></main></body></html>`,
      );
    if (req.url === '/slow') setTimeout(respond, 1500);
    else respond();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const serverPort = server.address().port;

  return {
    server,
    serverPort,
    origin: `http://127.0.0.1:${serverPort}`,
    echoRequests,
    sessionRequests,
    siteRequests,
    getMarkdownImageRequests: () => markdownImageRequests,
  };
}
