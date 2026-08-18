import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 8080);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const filePath = path.resolve(root, `.${requestedPath}`);

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const [body, fileStats] = await Promise.all([readFile(filePath), stat(filePath)]);
    response.writeHead(200, {
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'content-length': body.length,
      'last-modified': fileStats.mtime.toUTCString(),
      etag: `W/"${body.length}-${Math.trunc(fileStats.mtimeMs)}"`,
      'cache-control': path.extname(filePath) === '.json' ? 'no-cache' : 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Listening on http://127.0.0.1:${port}`);
});
