// 零依賴的本機靜態伺服器，給開發測試用。
// 用法：node tools/serve.mjs [port]，預設 8080，根目錄是 repo 根目錄。
// 電腦用 http://localhost 就能開麥克風；手機需要 HTTPS（請另外用 Cloudflare Tunnel 或 ngrok）。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav'
};

http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/interpreter.html';
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    // 用 tunnel 公開時，絕不能送出 .env（API key）、.git、測試工具與測試輸出
    const parts = file.slice(ROOT.length + 1).split(sep);
    if (parts.some(p => p.startsWith('.')) || parts[0] === 'tools' || /\.md$/i.test(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('找不到檔案'); return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('找不到檔案');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`伺服器已啟動：http://localhost:${PORT}/  （除錯模式：/#debug）`));
