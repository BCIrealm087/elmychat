import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const overlay = readFileSync(new URL('../../overlay/index.html', import.meta.url));
const proof = readFileSync(new URL('../../overlay/proof.html', import.meta.url));

/** Create a server without listening, so tests and later orchestration own its lifecycle. */
export function createCoordinatorServer({ health = () => ({ status: 'ok', phase: 'scaffold', chatConnected: false }) } = {}) {
  return createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed\n');
      return;
    }

    // Fixed routes only: do not translate untrusted URLs into filesystem paths.
    const pathname = request.url?.split('?')[0];
    let body;
    if (pathname === '/' || pathname === '/proof' || pathname === '/native') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      body = pathname === '/' ? overlay : proof;
    } else if (pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      body = JSON.stringify(health());
    } else {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      body = 'Not found\n';
    }
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}
