import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { OperatorController } from '../../apps/coordinator/src/operator.js';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { createCoordinatorServer } from '../../apps/coordinator/src/server.js';

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
    async function idle() { await overlay.bringToFront(); await Promise.all(overlay.frames().map((frame) => frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))))); }
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
