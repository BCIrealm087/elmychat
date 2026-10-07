import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { NativePage } from '../../packages/browser-control/native-page.js';
import { startCoordinatorFixtures } from '../../scripts/proof/fixtures.js';

test('rolling native load, idle periods, reconnects and source pressure keep ownership bounded', { timeout: 90000 }, async () => {
  const fixtures = await startCoordinatorFixtures();
  const profile = await mkdtemp(join(tmpdir(), 'elmychat-load-'));
  let context; let runtime; let native;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 420, height: 600 },
      args: ['--remote-debugging-port=0', '--no-proxy-server', '--site-per-process', '--host-resolver-rules=MAP first-fixture.test 127.0.0.1,MAP second-fixture.test 127.0.0.1'],
    });
    const page = context.pages()[0]; await page.goto(fixtures.targetUrl);
    await page.frameLocator('#twitch').locator('[data-id="native-a"]').waitFor();
    await page.frameLocator('#youtube').locator('#native-text').waitFor();
    const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    runtime = new NativeCoordinator({ endpoint: `http://127.0.0.1:${port}`, targetUrl: fixtures.targetUrl, sources: fixtures.sources, gap: 12, maxEntries: 80 }, {
      openPage: async (...args) => { native = await NativePage.open(...args); return native; },
    });
    const frames = () => fixtures.sources.map((source) => page.frames().find((frame) => frame.url().startsWith(source.urlPrefix)));
    async function idle() {
      await Promise.all(page.frames().map((frame) => frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))));
    }
    async function until(predicate) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) { await idle(); await runtime.step(); if (predicate(runtime.diagnostics())) return; }
      assert.fail(`Load check did not converge: ${JSON.stringify(runtime.diagnostics())}`);
    }
    for (const frame of frames()) await frame.evaluate(() => {
      globalThis.loadTemplate = nativeRoots[0].cloneNode(true); loadTemplate.removeAttribute('style');
      globalThis.loadList = nativeRoots[0].parentElement;
      globalThis.loadBase = new WeakMap([...loadList.children].map((node) => [node, node.getAttribute('style')]));
      globalThis.removedForCheck = [];
    });
    await until((state) => state.chatConnected && state.layout.placements.length === 8);
    const peaks = { trackedRoots: 0, styledNodes: 0, pendingReports: 0, retiredRoots: 0, retainedEntries: 0 };
    for (let batch = 0; batch < 40; batch += 1) {
      const before = runtime.diagnostics();
      for (const frame of frames()) await frame.evaluate((batch) => {
        removedForCheck = [];
        for (let i = 0; i < 40; i += 1) {
          const node = loadTemplate.cloneNode(true);
          node.id = `load-${batch}-${i}`; node.dataset.id = node.id;
          node.setAttribute('style', 'color: rgb(250, 250, 250);');
          loadBase.set(node, node.getAttribute('style')); loadList.append(node);
        }
        while (loadList.children.length > 60) { const node = loadList.firstElementChild; removedForCheck.push(node); node.remove(); }
      }, batch);
      await idle();
      for (const frame of frames()) {
        const state = await frame.evaluate(() => (globalThis.__elmychatTwitchAdapterV1 ?? globalThis.__elmychatYouTubeAdapterV1).diagnostics());
        for (const key of ['trackedRoots', 'styledNodes', 'pendingReports', 'retiredRoots']) peaks[key] = Math.max(peaks[key], state[key]);
        assert.ok(state.trackedRoots <= 60 && state.styledNodes <= 64 && state.pendingReports <= 120, JSON.stringify(state));
        assert.equal(await frame.evaluate(() => removedForCheck.every((node) => node.getAttribute('style') === loadBase.get(node))), true, 'Removed native roots must be restored and released each batch.');
      }
      await until((state) => state.chatConnected && state.sources.every((source, i) => source.adapter.added >= before.sources[i].adapter.added + 40));
      const state = runtime.diagnostics();
      peaks.retainedEntries = Math.max(peaks.retainedEntries, state.resources.retainedEntries);
      assert.ok(state.resources.retainedEntries <= 80 && state.resources.activeSessions === 2);
      assert.equal(state.layout.placements.at(-1).rect.y + state.layout.placements.at(-1).height, 600);
      if (batch % 10 === 9) {
        const spacer = (await runtime.control({ type: 'spacer-add', height: 50 })).entry;
        await runtime.control({ type: 'spacer-update', spacerId: spacer.spacerId, height: 75 });
        await runtime.control({ type: 'spacer-remove', spacerId: spacer.spacerId });
      }
    }
    const loaded = runtime.diagnostics();
    assert.ok(loaded.activity.reportsProcessed >= 3200);
    assert.equal(peaks.trackedRoots, 60); assert.equal(peaks.retainedEntries, 80);
    // Drain retirement acknowledgements, then prove idle polls do not rewrite layouts.
    await idle(); await runtime.step(); await idle(); await runtime.step();
    const beforeIdle = runtime.diagnostics();
    for (let i = 0; i < 30; i += 1) { await idle(); await runtime.step(); }
    const afterIdle = runtime.diagnostics();
    assert.equal(afterIdle.activity.layoutWrites, beforeIdle.activity.layoutWrites);
    assert.equal(afterIdle.activity.reportsProcessed, beforeIdle.activity.reportsProcessed);
    for (let i = 0; i < 10; i += 1) {
      const sessions = runtime.diagnostics().sources.map((source) => source.sessionId);
      const prior = native; prior.connection.close();
      await until((state) => state.chatConnected && state.sources.every((source, index) => source.sessionId !== sessions[index]));
      assert.equal(prior.frames.contexts.size, 0);
      assert.equal(prior.connection.listenerCount('event'), 0);
      assert.ok(runtime.diagnostics().resources.cleanupEntries <= 16);
    }
    const twitch = frames()[0];
    await twitch.evaluate(() => {
      for (let i = 0; i < 501; i += 1) {
        const node = loadTemplate.cloneNode(true); node.id = `pressure-${i}`; node.dataset.id = node.id;
        loadBase.set(node, node.getAttribute('style')); loadList.append(node);
      }
    });
    await until((state) => state.sources[0].status === 'failed' && state.sources[1].status === 'running');
    const pressured = runtime.diagnostics();
    assert.equal(pressured.sources[0].reason, 'native-root-limit');
    assert.ok(pressured.layout.placements.every((entry) => entry.sourceId === 'youtube'));
    const failedAdapter = await twitch.evaluate(() => __elmychatTwitchAdapterV1.diagnostics());
    assert.equal(failedAdapter.trackedRoots, 0); assert.equal(failedAdapter.pendingReports, 0); assert.equal(failedAdapter.styledNodes, 0);
    assert.equal(await twitch.evaluate(() => [...loadList.children].every((node) => node.getAttribute('style') === loadBase.get(node))), true);
    const sessionsStarted = pressured.activity.sessionsStarted;
    for (let i = 0; i < 5; i += 1) await runtime.step();
    assert.equal(runtime.diagnostics().activity.sessionsStarted, sessionsStarted, 'Pressure failures must latch rather than thrash the same document.');
    await twitch.goto(fixtures.sources[0].urlPrefix);
    await twitch.locator('[data-id="native-a"]').waitFor();
    await until((state) => state.chatConnected && state.sources[0].sessionId);
    const final = await runtime.stop();
    assert.ok(final.cleanup.slice(-2).every((entry) => entry.restored));
    assert.equal(final.resources.activeSessions, 0); assert.equal(final.resources.retainedEntries, 0);
    for (const frame of frames()) {
      const result = await frame.evaluate(() => {
        const api = globalThis.__elmychatTwitchAdapterV1 ?? globalThis.__elmychatYouTubeAdapterV1;
        const restored = globalThis.loadBase ? [...loadList.children].every((node) => node.getAttribute('style') === loadBase.get(node)) : beforeStyles.every(([node, raw]) => node.getAttribute('style') === raw);
        return { restored, diagnostics: api.diagnostics() };
      });
      assert.equal(result.restored, true); assert.equal(result.diagnostics.styledNodes, 0); assert.equal(result.diagnostics.trackedRoots, 0);
    }
    const output = resolve('.runtime/proof'); await mkdir(output, { recursive: true });
    await writeFile(join(output, 'hardening-load.json'), JSON.stringify({
      kind: 'synthetic-bounded-load', status: 'passed', browser: context.browser().version(), platform: process.platform,
      arrivals: 3200, batches: 40, idleCycles: 30, transportReconnects: 10, peaks,
      checks: ['rolling-root-removal', 'bounded-style-ownership', 'bounded-report-buffer', 'history-eviction', 'spacing-under-load', 'idle-layout-coalescing', 'reconnect-owner-cleanup', 'pressure-isolation-and-latching', 'document-recovery', 'final-restoration'],
      activity: final.activity, cleanup: final.cleanup,
      limitations: ['Accelerated synthetic operation count, not hours of live OBS use or a heap/CPU benchmark.', 'Platform-owned native DOM and browser resources are outside Elmychat bookkeeping bounds.'],
    }, null, 2) + '\n');
  } finally { await runtime?.stop(); await context?.close(); await fixtures.close(); await rm(profile, { recursive: true, force: true }); }
});
