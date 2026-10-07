import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { NativePage } from '../../packages/browser-control/native-page.js';
import { startCoordinatorFixtures } from '../../scripts/proof/fixtures.js';
import { twitchAdapterExpression } from '../../packages/adapters/twitch/index.js';

for (const sameProcess of [false, true]) test(`end-to-end native coordinator: ${sameProcess ? 'shared page contexts' : 'isolated iframe targets'}`, { timeout: 60000 }, async () => {
  const fixtures = await startCoordinatorFixtures();
  const profile = await mkdtemp(join(tmpdir(), 'elmychat-coordinator-'));
  let context; let runtime;
  const pages = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 420, height: 600 },
      args: ['--remote-debugging-port=0', '--no-proxy-server',
        ...(sameProcess ? ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'] : ['--site-per-process']),
        '--host-resolver-rules=MAP first-fixture.test 127.0.0.1,MAP second-fixture.test 127.0.0.1'],
    });
    const page = context.pages()[0];
    await page.goto(fixtures.targetUrl);
    await page.frameLocator('#twitch').locator('[data-id="native-a"]').waitFor();
    await page.frameLocator('#youtube').locator('#native-text').waitFor();
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    const config = { endpoint: `http://127.0.0.1:${port}`, targetUrl: fixtures.targetUrl, sources: fixtures.sources, gap: 12 };
    runtime = new NativeCoordinator(config, { openPage: async (settings, pinnedId) => { const connected = await NativePage.open(settings, pinnedId); pages.push(connected); return connected; } });
    async function idle() {
      await Promise.all(page.frames().map((frame) => frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))))));
    }
    async function until(predicate) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await runtime.step(); await idle();
        if (predicate(runtime.diagnostics())) return;
      }
      assert.fail(`Coordinator did not converge: ${JSON.stringify(runtime.diagnostics())}`);
    }
    const roots = () => page.frames().filter((frame) => frame !== page.mainFrame());
    const loadingFrame = page.frames().find((frame) => frame.url().startsWith(fixtures.sources[1].urlPrefix));
    await loadingFrame.evaluate(() => { globalThis.loadingBody = document.body; loadingBody.remove(); });
    for (let i = 0; i < 3; i += 1) { await runtime.step(); await idle(); }
    assert.equal(runtime.diagnostics().sources[0].status, 'running');
    assert.equal(runtime.diagnostics().sources[1].reason, 'native-document-loading');
    assert.equal(await loadingFrame.evaluate(() => typeof globalThis.__elmychatYouTubeAdapterV1), 'undefined');
    await loadingFrame.evaluate(() => { document.documentElement.append(loadingBody); delete globalThis.loadingBody; });
    await until((state) => state.layout.placements.length === 8 && state.layout.placements.every((entry) => entry.visible));
    const initial = runtime.diagnostics();
    const frameTypes = initial.sources.map((source) => {
      const record = [...pages[0].frames.contexts.values()].find((frame) => frame.origin === new URL(fixtures.sources.find((setting) => setting.id === source.id).urlPrefix).origin);
      return record?.sessionId ? 'iframe-target' : 'page-context';
    });
    assert.ok(frameTypes.every((type) => type === (sameProcess ? 'page-context' : 'iframe-target')));
    assert.equal(await page.evaluate(() => { try { document.querySelector('iframe').contentWindow.document.body; return false; } catch (error) { return error.name === 'SecurityError'; } }), true);
    for (const frame of roots()) {
      assert.equal(await frame.evaluate(() => nativeRoots.every((node, i) => document.contains(node) && nativeDescendants[i].every((child) => node.contains(child)))), true);
    }
    const bytes = await page.screenshot({ omitBackground: true });
    const png = PNG.sync.read(bytes);
    const alpha = (x, y) => png.data[(y * png.width + x) * 4 + 3];
    for (const entry of initial.layout.placements) assert.equal(alpha(2, Math.floor(entry.rect.y + 2)), 255, 'Native content must paint across overlapping frames.');
    for (let i = 1; i < initial.layout.placements.length; i += 1) {
      const previous = initial.layout.placements[i - 1].rect;
      const next = initial.layout.placements[i].rect;
      assert.equal(next.y - previous.y - previous.height, 12);
      for (let y = Math.ceil(previous.y + previous.height); y < next.y; y += 1) for (let x = 0; x < png.width; x += 1) assert.equal(alpha(x, y), 0, 'Every gap pixel is transparent.');
    }
    const twitchFrame = page.frames().find((frame) => frame.url().startsWith(fixtures.sources[0].urlPrefix));
    await twitchFrame.evaluate(() => nativeRoots[0].append(document.createElement('br'), document.createTextNode('Delayed native height')));
    const initialTwitch = initial.layout.placements.find((entry) => entry.sourceId === 'twitch' && entry.messageId === 'twitch-1');
    assert.ok(initialTwitch);
    await until((state) => state.layout.placements.some((entry) => entry.sessionId === initialTwitch.sessionId && entry.messageId === initialTwitch.messageId && entry.height > initialTwitch.height));
    assert.equal(runtime.diagnostics().layout.placements.find((entry) => entry.sessionId === initialTwitch.sessionId && entry.messageId === initialTwitch.messageId).sequence, initialTwitch.sequence);
    await page.setViewportSize({ width: 300, height: 460 });
    await until((state) => state.layout.viewport.width === 300 && state.layout.placements.every((entry) => entry.width === 300));
    assert.equal(runtime.diagnostics().layout.placements.at(-1).rect.y + runtime.diagnostics().layout.placements.at(-1).height, 460);
    await twitchFrame.evaluate(() => nativeRoots[0].remove());
    await until((state) => state.layout.placements.length === 7);
    const oldTwitch = runtime.diagnostics().sources[0].sessionId;
    await twitchFrame.goto(fixtures.sources[0].urlPrefix);
    await until((state) => state.sources[0].sessionId !== oldTwitch && state.layout.placements.length === 8);
    const beforeReconnect = runtime.diagnostics().sources.map((source) => source.sessionId);
    pages.at(-1).connection.close();
    await until((state) => state.sources.every((source, i) => source.sessionId !== beforeReconnect[i]) && state.layout.placements.length === 8);
    const oldSessions = runtime.diagnostics().sources.map((source) => source.sessionId);
    await page.reload();
    await until((state) => state.sources.every((source, i) => source.sessionId !== oldSessions[i]) && state.layout.placements.length === 8);
    // Parent frame unload/recreation must retire exactly that source and recover.
    await page.evaluate(() => document.querySelector('#youtube').remove());
    await until((state) => state.sources[1].status === 'waiting' && state.layout.placements.length === 2);
    await page.evaluate((src) => { const frame = document.createElement('iframe'); frame.id = 'youtube'; frame.src = src; document.body.append(frame); }, fixtures.sources[1].urlPrefix);
    await until((state) => state.sources[1].status === 'running' && state.layout.placements.length === 8);
    const finalLayout = runtime.diagnostics().layout;
    const stopped = await runtime.stop();
    assert.ok(stopped.cleanup.slice(-2).every((entry) => entry.restored), JSON.stringify(stopped.cleanup));
    for (const frame of roots()) {
      assert.equal(await frame.evaluate(() => beforeStyles.every(([node, raw, css]) => node.getAttribute('style') === raw && node.style.cssText === css)), true, 'Current native styles must restore exactly.');
    }
    runtime = new NativeCoordinator({ ...config, maxEntries: 2 });
    await until((state) => state.sources.every((source) => source.status === 'running' && source.trackedRoots > 0) && state.layout.placements.length === 2);
    for (let i = 0; i < 4; i += 1) { await runtime.step(); await idle(); }
    assert.equal(runtime.compositor.size, 2, 'Evicted connected roots must not be re-admitted.');
    const currentTwitch = page.frames().find((frame) => frame.url().startsWith(fixtures.sources[0].urlPrefix));
    const retained = runtime.compositor.entries();
    for (const source of fixtures.sources) {
      const frame = page.frames().find((candidate) => candidate.url().startsWith(source.urlPrefix));
      assert.equal(await frame.evaluate(({ retained, platform, sourceId }) => nativeRoots.every((node, i) => {
        const kept = retained.some((entry) => entry.sourceId === sourceId && entry.messageId === `${platform}-${i + 1}`);
        return getComputedStyle(node).visibility === (kept ? 'visible' : 'hidden');
      }), { retained, platform: source.platform, sourceId: source.id }), true, 'Each native root must reflect its actual retained identity, regardless of cross-source admission order.');
    }
    await runtime.stop();
    await currentTwitch.evaluate(twitchAdapterExpression({ sourceId: 'foreign', sessionId: 'foreign-generation', width: 300 }));
    runtime = new NativeCoordinator(config);
    await until((state) => state.sources[0].status === 'failed' && state.sources[1].status === 'running');
    assert.match(runtime.diagnostics().sources[0].reason, /another coordinator/);
    await runtime.stop();
    assert.equal(await currentTwitch.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().sessionId), 'foreign-generation');
    assert.equal(await currentTwitch.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().status), 'running');
    await currentTwitch.evaluate(() => __elmychatTwitchAdapterV1.stop({ sourceId: 'foreign', sessionId: 'foreign-generation' }));
    for (const frame of roots()) assert.equal(await frame.evaluate(() => beforeStyles.every(([node, raw, css]) => node.getAttribute('style') === raw && node.style.cssText === css)), true);
    const output = resolve('.runtime/proof'); await mkdir(output, { recursive: true });
    const name = sameProcess ? 'coordinator-same-process' : 'coordinator';
    await writeFile(join(output, `${name}.png`), bytes);
    await writeFile(join(output, `${name}.json`), JSON.stringify({
      kind: 'synthetic-coordinator-proof', status: 'passed', environment: { browser: context.browser().version(), platform: process.platform, frameTypes },
      checks: ['delayed-document-readiness', 'reports-to-layout', 'transparent-gap-pixels', 'native-node-identity', 'delayed-resize', 'viewport-remeasurement', 'removal', 'frame-navigation', 'socket-reconnect', 'page-refresh', 'iframe-unload', 'teardown-restoration', 'connected-root-eviction', 'foreign-owner-isolation'],
      initialLayout: initial.layout, finalLayout, cleanup: stopped.cleanup,
      limitations: ['Synthetic documents and Chromium; continuous live OBS/platform behavior remains unverified.'],
    }, null, 2) + '\n');
  } finally {
    await runtime?.stop();
    await context?.close();
    await fixtures.close();
    await rm(profile, { recursive: true, force: true });
  }
});
