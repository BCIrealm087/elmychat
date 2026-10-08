import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { OperatorController } from '../../apps/coordinator/src/operator.js';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { createCoordinatorServer } from '../../apps/coordinator/src/server.js';
import { waitForPaint } from './paint.js';

async function host(t, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'elmychat-controls-'));
  const statePath = join(folder, 'operator.json');
  const operator = new OperatorController({ statePath, ...options });
  const server = createCoordinatorServer({ operator, health: () => operator.health() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`; operator.overlayUrl = `${base}/overlay`;
  t.after(async () => { await operator.close(); await new Promise((done) => server.close(done)); await rm(folder, { recursive: true, force: true }); });
  return { operator, base, statePath };
}
async function complete(page, message) { await page.getByRole('alert').filter({ hasText: message }).waitFor(); }

test('operator UI configures, persists, edits spacers, selects matching sources, and fits a narrow screen', { timeout: 30000 }, async (t) => {
  const { operator, base, statePath } = await host(t, {
    createRuntime: (config) => new NativeCoordinator(config, { openPage: async () => { throw new Error('Synthetic OBS offline.'); } }),
    discoverTargets: async () => ({ targets: [
      { id: 'related', url: operator.overlayUrl, title: '<img src=x onerror=alert(1)>' }, { id: 'unrelated', url: 'https://elsewhere.test/', title: 'Unrelated' },
    ] }),
  });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel('Twitch channel').fill('Example_Channel');
  await page.getByLabel('YouTube video ID or URL').fill('https://youtu.be/abcdefghijk');
  await page.getByRole('button', { name: 'Save and connect' }).click(); await complete(page, 'Sources saved');
  assert.equal(operator.state().config.channel, 'example_channel');
  assert.equal(operator.state().config.videoId, 'abcdefghijk');
  await page.getByText('OBS connection settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Find matching sources' }).click();
  await page.getByText('1 matching OBS source(s) found.', { exact: true }).waitFor();
  assert.equal(await page.locator('#target option').count(), 2);
  assert.equal(await page.locator('#target img').count(), 0);
  await page.getByLabel('Browser Source selection').selectOption('related');
  await page.getByRole('button', { name: 'Save and connect' }).click(); await complete(page, 'Sources saved');
  assert.equal(operator.state().config.targetId, 'related');
  await page.getByLabel('Default gap between messages (px)').fill('18.5');
  await page.getByRole('button', { name: 'Apply gap' }).click(); await complete(page, 'Default gap applied');
  assert.equal(operator.state().gap, 18.5);
  await page.getByLabel('Insert a transparent spacer (px)').fill('64');
  await page.getByRole('button', { name: 'Insert spacer' }).click(); await complete(page, 'Spacer inserted');
  await page.locator('#spacers input').fill('81.5');
  await page.locator('#spacers').getByRole('button', { name: 'Update' }).click(); await complete(page, 'Spacer updated');
  assert.equal(operator.state().spacers[0].height, 81.5);
  await page.locator('#spacers').getByRole('button', { name: 'Remove' }).click(); await complete(page, 'Spacer removed');
  assert.equal(operator.state().spacers.length, 0);
  await page.getByRole('button', { name: 'Disconnect and restore' }).click(); await complete(page, 'Coordinator disconnected');
  assert.equal(await page.getByRole('button', { name: 'Apply gap' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Connect', exact: true }).click(); await complete(page, 'Coordinator connecting');
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).config.gap, 18.5);
  await page.getByText('OBS connection settings', { exact: true }).click();
  const output = resolve('.runtime/proof'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'operator-controls.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'Controls must fit without horizontal scrolling.');
  await page.screenshot({ path: join(output, 'operator-controls-narrow.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'operator-controls.json'), JSON.stringify({ status: 'passed', checks: ['source-normalization', 'saved-gap', 'spacer-add-update-remove', 'matching-target-selection', 'safe-native-titles', 'disconnect-connect', 'narrow-layout'], limitations: ['Synthetic offline runtime; live rendering covered in managed-overlay integration.'] }, null, 2));
});

test('managed OBS overlay applies live controls to native frames and replaces only configured chats', { timeout: 60000 }, async (t) => {
  const { operator, base } = await host(t);
  const profile = await mkdtemp(join(tmpdir(), 'elmychat-managed-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 420, height: 600 }, args: ['--remote-debugging-port=0', '--no-proxy-server', '--site-per-process'] });
    const fixtures = await Promise.all(['twitch', 'youtube'].map((platform) => readFile(new URL(`../fixtures/${platform}/source.html`, import.meta.url), 'utf8')));
    await context.route('https://www.twitch.tv/**', (route) => route.fulfill({ contentType: 'text/html', body: fixtures[0] }));
    await context.route('https://www.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: fixtures[1] }));
    const overlay = context.pages()[0]; await overlay.goto(`${base}/overlay`);
    const controls = await context.newPage(); await controls.goto(base);
    const errors = []; controls.on('pageerror', (error) => errors.push(error.message));
    const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    await controls.getByLabel('Twitch channel').fill('first_channel');
    await controls.getByLabel('YouTube video ID or URL').fill('abcdefghijk');
    await controls.getByText('OBS connection settings', { exact: true }).click();
    await controls.getByLabel('OBS debugging port').fill(String(port));
    await controls.getByRole('button', { name: 'Save and connect' }).click(); await complete(controls, 'Sources saved');
    async function idle() {
      await overlay.bringToFront();
      await waitForPaint(overlay);
    }
    async function until(predicate) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) { await operator.tick(); await idle(); if (predicate(operator.health())) return; }
      assert.fail(`Managed overlay did not converge: ${JSON.stringify(operator.health())}`);
    }
    await until((health) => health.chatConnected && health.layout.placements.length === 8);
    const initial = operator.health();
    const identities = initial.layout.placements.map((entry) => [entry.sourceId, entry.messageId, entry.sequence]);
    await controls.getByLabel('Default gap between messages (px)').fill('22');
    await controls.getByRole('button', { name: 'Apply gap' }).click(); await complete(controls, 'Default gap applied'); await idle();
    const layout = operator.health().layout;
    assert.deepEqual(layout.placements.map((entry) => [entry.sourceId, entry.messageId, entry.sequence]), identities);
    for (let i = 1; i < layout.placements.length; i += 1) assert.equal(layout.placements[i].rect.y - layout.placements[i - 1].rect.y - layout.placements[i - 1].height, 22);
    await controls.getByLabel('Insert a transparent spacer (px)').fill('80');
    await controls.getByRole('button', { name: 'Insert spacer' }).click(); await complete(controls, 'Spacer inserted');
    const twitch = overlay.frames().find((frame) => frame.url().startsWith('https://www.twitch.tv/embed/'));
    await twitch.evaluate(() => { const added = nativeRoots[0].cloneNode(true); added.dataset.id = 'operator-arrival'; nativeRoots[0].parentElement.append(added); });
    await until((health) => health.layout.placements.length === 9);
    let placed = operator.health().layout.placements;
    assert.equal(placed.at(-1).rect.y - placed.at(-2).rect.y - placed.at(-2).height, 80);
    await controls.locator('#spacers input').fill('120');
    await controls.locator('#spacers').getByRole('button', { name: 'Update' }).click(); await complete(controls, 'Spacer updated'); await idle();
    placed = operator.health().layout.placements;
    assert.equal(placed.at(-1).rect.y - placed.at(-2).rect.y - placed.at(-2).height, 120);
    const pngBytes = await overlay.screenshot({ omitBackground: true });
    const png = PNG.sync.read(pngBytes);
    for (let y = Math.ceil(placed.at(-2).rect.y + placed.at(-2).height); y < placed.at(-1).rect.y; y += 1) for (let x = 0; x < png.width; x += 1) assert.equal(png.data[(y * png.width + x) * 4 + 3], 0, 'Inserted spacer must be transparent across both native frames.');
    await controls.locator('#spacers').getByRole('button', { name: 'Remove' }).click(); await complete(controls, 'Spacer removed');
    placed = operator.health().layout.placements;
    assert.equal(placed.at(-1).rect.y - placed.at(-2).rect.y - placed.at(-2).height, 22);
    for (const frame of overlay.frames().filter((frame) => frame !== overlay.mainFrame())) assert.equal(await frame.evaluate(() => nativeRoots.every((root, i) => document.contains(root) && nativeDescendants[i].every((child) => root.contains(child)))), true);
    await controls.getByLabel('Twitch channel').fill('second_channel');
    await controls.getByLabel('YouTube video ID or URL').fill('lmnopqrstuv');
    await controls.getByRole('button', { name: 'Save and connect' }).click(); await complete(controls, 'Sources saved');
    await until((health) => health.chatConnected && health.layout.placements.length === 8);
    assert.equal(overlay.url(), `${base}/overlay`);
    assert.ok(overlay.frames().some((frame) => frame.url().includes('/embed/second_channel/chat')));
    assert.ok(overlay.frames().some((frame) => frame.url().includes('v=lmnopqrstuv')));
    const final = operator.health();
    await controls.getByRole('button', { name: 'Disconnect and restore' }).click(); await complete(controls, 'Coordinator disconnected');
    assert.ok(operator.health().cleanup.slice(-2).every((entry) => entry.restored));
    for (const frame of overlay.frames().filter((frame) => frame !== overlay.mainFrame())) assert.equal(await frame.evaluate(() => beforeStyles.every(([node, raw, css]) => node.getAttribute('style') === raw && node.style.cssText === css)), true);
    assert.deepEqual(errors, []);
    const output = resolve('.runtime/proof'); await mkdir(output, { recursive: true });
    await writeFile(join(output, 'operator-managed-overlay.png'), pngBytes);
    await writeFile(join(output, 'operator-managed-overlay.json'), JSON.stringify({ kind: 'synthetic-operator-integration', status: 'passed', browser: context.browser().version(), checks: ['UI-to-native-CDP', 'live-gap', 'stable-message-identities', 'spacer-arrival-resize-remove', 'transparent-spacer-pixels', 'native-descendants', 'source-switch-with-stable-OBS-URL', 'disconnect-restoration'], initialLayout: initial.layout, finalLayout: final.layout, cleanup: operator.health().cleanup, limitations: ['Intercepted synthetic native documents; no new live special-root or prolonged OBS claim.'] }, null, 2));
  } finally { await operator.close(); await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('emote preferences are keyboard accessible, survive polling/reload, and fit narrow controls', { timeout: 30000 }, async t => {
  const { operator, base, statePath } = await host(t, {
    createRuntime: config => { const runtime = new NativeCoordinator(config, { openPage: async () => { throw new Error('Synthetic OBS offline.'); } }); runtime.applyEmotes = async () => ({ accepted: true }); return runtime; },
  });
  await operator.configure({ channel: 'fixture', videoId: 'abcdefghijk' });
  const browser = await chromium.launch({ channel: 'chromium', headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 } });
  await page.goto(base);
  const seven = page.getByRole('checkbox', { name: '7TV', exact: true });
  const bttv = page.getByRole('checkbox', { name: 'BTTV', exact: true });
  await seven.waitFor(); await page.waitForFunction(() => !document.getElementById('seven-tv').disabled);
  assert.equal(await seven.isChecked(), false); assert.equal(await bttv.isChecked(), false);
  await seven.focus(); await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  assert.equal(await seven.isChecked(), true, 'Polling must preserve an unsaved keyboard choice.');
  await page.getByRole('button', { name: 'Apply emotes', exact: true }).focus(); await page.keyboard.press('Enter');
  await complete(page, 'Emote choices saved');
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')).config.emotes, { sevenTv: true, betterTtv: false });
  await bttv.focus(); await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Apply emotes', exact: true }).click(); await complete(page, 'Emote choices saved');
  await page.reload(); await page.waitForFunction(() => document.getElementById('better-ttv').checked);
  assert.equal(await seven.isChecked(), true); assert.equal(await bttv.isChecked(), true);
  assert.equal(await page.getByRole('button', { name: 'Retry emotes', exact: true }).isVisible(), false);
  await page.getByText('Applying changes or retrying refreshes Twitch and resets its chat history.', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const output = resolve('.runtime/proof'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'operator-emotes-narrow.png'), fullPage: true });
});

for (const sameProcess of [false, true]) test(`managed emote controls preserve native YouTube/spacers and retry once through ${sameProcess ? 'page contexts' : 'OOPIFs'}`, { timeout: 90000 }, async t => {
  const { TwitchEnhancement } = await import('../../apps/coordinator/src/twitch-enhancement.js');
  const { ffzBootstrapUrl } = await import('../../packages/adapters/twitch/ffz-bootstrap.js');
  const { createHash } = await import('node:crypto');
  const shim = await readFile(new URL('../fixtures/twitch/ffz-proof-shim.js', import.meta.url), 'utf8');
  const integrity = `sha256-${createHash('sha256').update(shim).digest('base64')}`;
  let downloadFailed = false; let downloads = 0; let releaseDownload; let gateDownload = true;
  const { operator, base } = await host(t, { createRuntime: (config, options) => new NativeCoordinator(config, {
    ...options, createEnhancement: (choices, owner) => new TwitchEnhancement(choices, owner, {
      download: async () => {
        downloads += 1; if (downloadFailed) throw new Error('Synthetic download offline');
        if (gateDownload) { gateDownload = false; await new Promise(resolve => { releaseDownload = resolve; }); }
        return { integrity };
      }, pollMs: 20, retryMs: 1,
    }),
  }) });
  const profile = await mkdtemp(join(tmpdir(), 'elmychat-emote-controls-'));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 420, height: 600 },
      args: ['--remote-debugging-port=0', '--no-proxy-server', ...(sameProcess ? ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'] : ['--site-per-process'])] });
    const fixtures = await Promise.all(['twitch', 'youtube'].map(platform => readFile(new URL(`../fixtures/${platform}/source.html`, import.meta.url), 'utf8')));
    await browser.route('https://www.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: fixtures[0] }));
    await browser.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixtures[1] }));
    let bootstrapLoads = 0; let twitchLoads = 0;
    browser.on('request', request => { if (request.isNavigationRequest() && request.url().startsWith('https://www.twitch.tv/embed/')) twitchLoads += 1; });
    await browser.route(ffzBootstrapUrl, route => { bootstrapLoads += 1; return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: shim }); });
    const overlay = browser.pages()[0]; await overlay.goto(`${base}/overlay`);
    const controls = await browser.newPage(); await controls.goto(base);
    const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    await controls.getByLabel('Twitch channel').fill('fixture');
    await controls.getByLabel('YouTube video ID or URL').fill('abcdefghijk');
    await controls.getByText('OBS connection settings', { exact: true }).click();
    await controls.getByLabel('OBS debugging port').fill(String(port));
    await controls.getByRole('button', { name: 'Save and connect' }).click(); await complete(controls, 'Sources saved');
    async function until(predicate) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { await operator.tick(); await overlay.bringToFront(); await waitForPaint(overlay); if (await predicate(operator.health())) return; }
      assert.fail(`Emote controls did not converge: ${JSON.stringify(operator.health())}`);
    }
    await until(health => health.chatConnected && health.layout.placements.length === 8);
    const youtubeSession = operator.health().sources[1].sessionId;
    const youtubeIdentities = operator.health().layout.placements.filter(entry => entry.sourceId === 'youtube').map(entry => [entry.messageId, entry.sequence]);
    const youtubeFrame = overlay.frames().find(frame => frame.url().includes('youtube.com/live_chat'));
    const youtubeToken = await youtubeFrame.evaluate(() => globalThis.documentToken = Math.random());
    await operator.spacing({ type: 'gap', height: 16.5 });
    await operator.spacing({ type: 'spacer-add', height: 60 });
    const spacer = operator.state().spacers[0];
    // A second same-URL overlay must never receive the selected source's refresh.
    const other = await browser.newPage(); await other.goto(`${base}/overlay`);
    await other.frameLocator('#twitch').locator('[data-id="native-a"]').waitFor();
    const otherFrame = other.frames().find(frame => frame.url().includes('twitch.tv/embed'));
    const otherToken = await otherFrame.evaluate(() => globalThis.documentToken = Math.random());
    async function choices(sevenTv, betterTtv) {
      await controls.getByRole('checkbox', { name: '7TV', exact: true }).setChecked(sevenTv);
      await controls.getByRole('checkbox', { name: 'BTTV', exact: true }).setChecked(betterTtv);
      await controls.getByRole('button', { name: 'Apply emotes', exact: true }).click(); await complete(controls, 'Emote choices saved');
    }
    async function preserved() {
      assert.equal(operator.health().sources[1].sessionId, youtubeSession);
      assert.deepEqual(operator.health().layout.placements.filter(entry => entry.sourceId === 'youtube').map(entry => [entry.messageId, entry.sequence]), youtubeIdentities);
      assert.equal(await youtubeFrame.evaluate(() => globalThis.documentToken), youtubeToken);
      assert.equal(await otherFrame.evaluate(() => globalThis.documentToken), otherToken);
      assert.deepEqual(operator.state().spacers, [spacer]); assert.equal(operator.state().gap, 16.5);
    }
    await choices(true, false);
    await until(health => health.chatConnected && !!releaseDownload);
    const preparingSession = operator.health().sources[0].sessionId;
    const preparingLoads = twitchLoads;
    const preparingFrame = overlay.frames().find(frame => frame.url().includes('twitch.tv/embed'));
    // A same-document URL change during preparation must wait for fresh
    // discovery, not install with the stale URL or latch a terminal failure.
    await preparingFrame.evaluate(() => {
      const url = new URL(location.href); url.searchParams.delete('_elmychatRefresh');
      history.replaceState(null, '', url.href);
    });
    releaseDownload();
    const preparationDeadline = Date.now() + 5000;
    while (!operator.health().sources[0].enhancement.awaitingNative && Date.now() < preparationDeadline) await delay(10);
    assert.equal(operator.health().sources[0].enhancement.awaitingNative, true);
    assert.equal(await preparingFrame.evaluate(() => !!globalThis.__elmychatTwitchEnhancementV1), false);
    assert.equal(bootstrapLoads, 0);
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'ready' && !health.sources[0].enhancement.activeWork);
    assert.equal(operator.health().sources[0].sessionId, preparingSession);
    assert.equal(twitchLoads, preparingLoads); assert.equal(bootstrapLoads, 1); assert.equal(downloads, 1);
    await overlay.frameLocator('#twitch').locator('img[data-set="fixture-7tv-emotes"]').waitFor({ state: 'attached' });
    await until(async () => await overlay.frameLocator('#twitch').locator('img[data-set="fixture-7tv-emotes"]').isVisible());
    assert.equal(await overlay.frameLocator('#twitch').locator('img[data-set="fixture-ffzap-bttv"]').count(), 0);
    await preserved();
    await operator.tick(); await waitForPaint(overlay);
    const spacerRect = operator.health().layout.spacers[0].rect;
    const pixels = PNG.sync.read(await overlay.screenshot({ omitBackground: true }));
    for (let y = Math.max(0, Math.ceil(spacerRect.y)); y < Math.min(pixels.height, Math.floor(spacerRect.y + spacerRect.height)); y += 1) for (let x = 0; x < pixels.width; x += 1) assert.equal(pixels.data[(y * pixels.width + x) * 4 + 3], 0, 'Emote apply must preserve transparent spacer pixels.');
    const refresh = operator.health().sources[0].refresh;
    const count = twitchLoads;
    // Duplicate delivery and normal polling cannot repeat or undo a refresh.
    await overlay.evaluate(({ revision, overlayUrl, expectedUrl }) => __elmychatManagedOverlayV1.twitch({ operation: 'refresh', revision, overlayUrl, expectedUrl }),
      { revision: refresh.revision, overlayUrl: `${base}/overlay`, expectedUrl: operator.overlay('127.0.0.1').sources[0].url });
    await overlay.waitForTimeout(2200); await operator.tick();
    assert.equal(twitchLoads, count);
    await choices(true, true);
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'ready');
    const latestLoads = twitchLoads;
    await assert.rejects(overlay.evaluate(({ revision, overlayUrl, expectedUrl }) => __elmychatManagedOverlayV1.twitch({ operation: 'refresh', revision, previousRevision: null, overlayUrl, expectedUrl }),
      { revision: refresh.revision, overlayUrl: `${base}/overlay`, expectedUrl: operator.overlay('127.0.0.1').sources[0].url }), /Stale Twitch refresh/);
    assert.equal(twitchLoads, latestLoads);
    await overlay.frameLocator('#twitch').locator('img[data-set="fixture-ffzap-bttv"]').waitFor({ state: 'attached' });
    await until(async () => await overlay.frameLocator('#twitch').locator('img[data-set="fixture-ffzap-bttv"]').isVisible()); await preserved();
    await choices(false, true);
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'ready');
    assert.equal(await overlay.frameLocator('#twitch').locator('img[data-set="fixture-7tv-emotes"]').count(), 0); await preserved();
    downloadFailed = true;
    await choices(true, true);
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'unavailable');
    await controls.getByRole('button', { name: 'Retry emotes', exact: true }).waitFor({ state: 'visible' });
    assert.equal(operator.health().chatConnected, true); await preserved();
    const attempts = downloads; const failedLoads = bootstrapLoads;
    for (let i = 0; i < 10; i += 1) await operator.tick();
    assert.equal(downloads, attempts);
    downloadFailed = false;
    await controls.getByRole('button', { name: 'Retry emotes', exact: true }).click(); await complete(controls, 'Emote choices saved');
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'ready');
    assert.equal(bootstrapLoads, failedLoads + 1); await preserved();
    // A direct Twitch refresh reapplies saved choices without touching YouTube.
    const beforeSession = operator.health().sources[0].sessionId;
    await overlay.frames().find(frame => frame.url().includes('twitch.tv/embed')).evaluate(() => location.reload());
    await until(health => health.sources[0].sessionId !== beforeSession && health.sources[0].enhancement.status === 'ready'); await preserved();
    await choices(false, false);
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'off');
    assert.equal(await overlay.frameLocator('#twitch').locator('img[data-provider="ffz"]').count(), 0); await preserved();
    await choices(true, true);
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'ready');
    const warmLoads = bootstrapLoads;
    await controls.getByRole('button', { name: 'Disconnect and restore' }).click(); await complete(controls, 'Coordinator disconnected');
    await controls.getByRole('button', { name: 'Connect', exact: true }).click(); await complete(controls, 'Coordinator connecting');
    await operator.tick();
    assert.match(operator.health().lastError, /Expected one selected page; found 2/, 'A new connection must reject ambiguous overlays.');
    await other.close();
    await until(health => health.chatConnected && health.sources[0].enhancement.status === 'ready');
    assert.equal(bootstrapLoads, warmLoads + 1, 'Saved providers must reload once into a clean document on warm reconnect.');
    assert.equal(await youtubeFrame.evaluate(() => globalThis.documentToken), youtubeToken);
    assert.deepEqual(operator.state().config.emotes, { sevenTv: true, betterTtv: true });
    const output = resolve('.runtime/proof'); await mkdir(output, { recursive: true });
    await writeFile(join(output, `operator-emotes-${sameProcess ? 'page' : 'oopif'}.json`), JSON.stringify({ kind: 'synthetic-emote-controls', status: 'passed', checks: ['independent-and-both-providers', 'acknowledged-idempotent-refresh', 'unchanged-YouTube-identities', 'retained-gap-and-spacer', 'selected-overlay-only', 'bounded-explicit-retry', 'saved-choices-after-refresh', 'disable-with-clean-refresh', 'saved-choices-after-warm-reconnect'], limitations: ['Deterministic enhancer shim, not additional live provider/category evidence.'] }, null, 2));
  } finally { releaseDownload?.(); await operator.close(); await browser?.close(); await rm(profile, { recursive: true, force: true }); }
});
