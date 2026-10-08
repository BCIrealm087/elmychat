import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const files = {
  starter: readFileSync(new URL('../../overlay/index.html', import.meta.url)),
  proof: readFileSync(new URL('../../overlay/proof.html', import.meta.url)),
  control: readFileSync(new URL('../../operator/index.html', import.meta.url)),
  script: readFileSync(new URL('../../operator/control.js', import.meta.url)),
  overlay: readFileSync(new URL('../../overlay/managed.html', import.meta.url)),
  overlayScript: readFileSync(new URL('../../overlay/managed.js', import.meta.url)),
};
function denied(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }
function readBody(request) {
  return new Promise((resolve, reject) => {
    let chunks = []; let length = 0;
    const timer = setTimeout(() => finish(denied('Request body timed out.', 408)), 10000);
    function finish(error) {
      clearTimeout(timer);
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onAborted);
      if (error) { chunks = []; request.resume(); reject(error); }
      else { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(denied('Invalid JSON body.', 400)); } }
    }
    function onData(chunk) { length += chunk.length; if (length > 16384) finish(denied('Request exceeds 16 KiB.', 413)); else chunks.push(chunk); }
    function onEnd() { finish(); }
    function onError(error) { finish(error); }
    function onAborted() { finish(denied('Request aborted.', 400)); }
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onAborted);
  });
}

/** Fixed loopback routes; writes require same origin, JSON and a server nonce. */
export function createCoordinatorServer({ health = () => ({ status: 'ok', phase: 'scaffold', chatConnected: false }), operator } = {}) {
  const token = randomUUID();
  let activeControls = 0;
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const port = request.socket.localPort;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = request.headers.host;
    const pathname = request.url?.split('?')[0];
    function send(status, body, type = 'application/json; charset=utf-8') {
      response.writeHead(status, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    }
    try {
      if (!allowedHosts.includes(host)) throw denied('Use the local coordinator address.', 403);
      if (operator && request.method === 'POST' && ['/api/config', '/api/connect', '/api/disconnect', '/api/spacing', '/api/emotes'].includes(pathname)) {
        if (request.headers.origin !== `http://${host}` || request.headers['x-elmychat-token'] !== token) throw denied('Open the local controls page to perform this action.', 403);
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw denied('Send application/json.', 415);
        if (activeControls >= 16) throw denied('Too many active control requests; retry after pending requests finish.', 503);
        activeControls += 1;
        try {
          const input = await readBody(request);
          let state;
          if (pathname === '/api/config') state = await operator.configure(input);
          else if (pathname === '/api/connect') state = await operator.connect();
          else if (pathname === '/api/disconnect') state = await operator.disconnect();
          else if (pathname === '/api/emotes') state = await operator.emotes(input);
          else state = await operator.spacing(input);
          send(200, { ...state, token });
        } finally { activeControls -= 1; }
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        send(405, 'Method not allowed\n', 'text/plain; charset=utf-8'); return;
      }
      if (pathname === '/' || pathname === '/control') {
        response.setHeader('X-Frame-Options', 'DENY');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        send(200, operator ? files.control : files.starter, 'text/html; charset=utf-8');
      } else if (pathname === '/proof' || pathname === '/native') send(200, files.proof, 'text/html; charset=utf-8');
      else if (pathname === '/overlay') send(200, files.overlay, 'text/html; charset=utf-8');
      else if (pathname === '/assets/control.js') send(200, files.script, 'text/javascript; charset=utf-8');
      else if (pathname === '/assets/managed.js') send(200, files.overlayScript, 'text/javascript; charset=utf-8');
      else if (pathname === '/health') send(200, health());
      else if (operator && pathname === '/api/state') send(200, { ...operator.state(), token });
      else if (operator && pathname === '/api/overlay') send(200, operator.overlay(host.split(':')[0]));
      else if (operator && pathname === '/api/targets') send(200, { targets: await operator.targets() });
      else send(404, 'Not found\n', 'text/plain; charset=utf-8');
    } catch (error) {
      send(error.statusCode ?? (error instanceof TypeError || error instanceof RangeError ? 400 : 409), { error: error.message });
    }
  });
}
