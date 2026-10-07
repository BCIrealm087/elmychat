import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

export async function startFixtures() {
  const template = await readFile(new URL('../../test/fixtures/proof/source.html', import.meta.url), 'utf8');
  const servers = [];
  async function serve(html) {
    const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
  }
  try {
    const first = await serve(template.replaceAll('SOURCE', 'first'));
    const second = await serve(template.replaceAll('SOURCE', 'second'));
    const firstUrl = `http://first-fixture.test:${first}/chat`;
    const secondUrl = `http://second-fixture.test:${second}/chat`;
    const overlay = await serve(`<!doctype html><html><head><title>Synthetic Elmychat proof</title><style>html,body{margin:0;background:transparent}iframe{position:absolute;inset:0;border:0;width:100%;height:100%;background:transparent}</style></head><body><iframe id="first" src="${firstUrl}"></iframe><iframe id="second" src="${secondUrl}"></iframe></body></html>`);
    return {
      targetUrl: `http://127.0.0.1:${overlay}/`,
      sources: [{ id: 'synthetic-first', urlPrefix: firstUrl, selector: '.message' }, { id: 'synthetic-second', urlPrefix: secondUrl, selector: '.message' }],
      close: () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))),
    };
  } catch (error) {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    throw error;
  }
}

/** Real adapter fixtures in cross-site frames; no copied rendering in the parent. */
export async function startCoordinatorFixtures() {
  const templates = await Promise.all(['twitch', 'youtube'].map((platform) => readFile(new URL(`../../test/fixtures/${platform}/source.html`, import.meta.url), 'utf8')));
  const servers = [];
  async function serve(html) {
    const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
  }
  const close = () => Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
  try {
    const first = await serve(templates[0]);
    const second = await serve(templates[1]);
    const sources = [
      { id: 'twitch', platform: 'twitch', urlPrefix: `http://first-fixture.test:${first}/chat` },
      { id: 'youtube', platform: 'youtube', urlPrefix: `http://second-fixture.test:${second}/chat` },
    ];
    const overlay = await serve(`<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}iframe{position:absolute;inset:0;border:0;width:100%;height:100%;background:transparent}</style></head><body>${sources.map((source) => `<iframe id="${source.id}" src="${source.urlPrefix}"></iframe>`).join('')}</body></html>`);
    return { targetUrl: `http://127.0.0.1:${overlay}/`, sources, close };
  } catch (error) { await close(); throw error; }
}
