import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { twitchAdapterExpression } from '../../packages/adapters/twitch/index.js';
import { Compositor } from '../../packages/compositor/index.js';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { startCoordinatorFixtures } from '../../scripts/proof/fixtures.js';
import { waitForPaint } from './paint.js';

const source = await readFile(new URL('../fixtures/twitch/source.html', import.meta.url), 'utf8');
const shim = await readFile(new URL('../fixtures/twitch/renderer-identity-shim.js', import.meta.url), 'utf8');
const address = { sourceId: 'twitch', sessionId: 'enhanced-content' };
const gif = 'R0lGODlhBAAEAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADwAAACwAAAAABAAEAAAICQABCBxIsCCAgAAh+QQBDwABACwAAAAABAAEAIEA/wAAAAAAAAAAAAAICQABCBxIsCCAgAA7';
let browser;
before(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); });

async function setup(t) {
  const context = await browser.newContext({ viewport: { width: 420, height: 600 } }); t.after(() => context.close());
  const page = await context.newPage(); await page.setContent(source); await page.evaluate(shim);
  await page.evaluate(() => { for (const node of nativeRoots) node.style.paddingLeft = '24px'; });
  await page.evaluate(twitchAdapterExpression({ ...address, width: 420 }));
  const call = (method, fields = {}) => page.evaluate(({ method, command }) => __elmychatTwitchAdapterV1[method](command), { method, command: { ...address, ...fields } });
  const drain = async () => { await waitForPaint(page, 3); const batch = await call('takeReports'); assert.equal(batch.status, 'running', batch.failure); return batch.events; };
  const initial = await drain();
  const core = new Compositor({ viewport: { width: 420, height: 600 }, gap: 20 }); core.activateSource(address.sourceId, address.sessionId);
  for (const event of initial) core.addMessage(event);
  let revision = 0;
  const admit = events => { for (const event of events) {
    if (event.type === 'added') core.addMessage(event);
    else if (event.type === 'resized') core.resizeMessage(event);
    else core.removeMessage(event);
  } };
  const place = () => call('applyPlacements', { revision: ++revision, placements: core.layout().placements });
  await place();
  return { page, call, drain, core, initial, admit, place };
}

test('renderer-owned content changes and unique remounts preserve sequence, slots and retirement', { timeout: 30000 }, async t => {
  const { page, call, drain, core, initial, admit, place } = await setup(t);
  const before = core.entries().map(entry => ({ id: entry.messageId, sequence: entry.sequence }));
  await page.evaluate(() => {
    nativeRoots[0].replaceChildren(document.createTextNode('Same message rendered as emotes and badges'));
    const badge = document.createElement('span'); badge.textContent = 'Native badge'; nativeRoots[0].prepend(badge);
  });
  const changed = await drain(); assert.ok(changed.every(event => event.type === 'resized')); admit(changed); await place();
  const originalY = core.layout().placements[0].rect.y;
  await page.evaluate(() => { globalThis.removedHost = nativeRoots[0]; globalThis.newHost = fixtureReplaceMessage(0); globalThis.newChildren = [...newHost.childNodes]; });
  const remount = await drain(); assert.ok(remount.every(event => event.type === 'resized'));
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().identityTransfers), 1);
  assert.equal(await page.evaluate(() => getComputedStyle(newHost).opacity), '1', 'An unchanged-height remount must retain its assigned slot without waiting for another coordinator write.');
  assert.equal(await page.evaluate(() => newHost.getBoundingClientRect().y), originalY);
  admit(remount); await place();
  assert.deepEqual(core.entries().map(entry => ({ id: entry.messageId, sequence: entry.sequence })), before);
  assert.equal(await page.evaluate(() => !removedHost.isConnected && newHost.isConnected && newChildren.every(node => node.parentNode === newHost)), true);
  assert.equal(await page.evaluate(() => nativeRoots.every(node => !node.hasAttribute('data-id'))), true, 'No invented DOM message keys.');
  await call('retireMessages', { messageIds: [initial[0].messageId] }); await drain();
  await page.evaluate(() => fixtureReplaceMessage(0));
  assert.deepEqual(await drain(), []);
  const retired = await page.evaluate(() => ({ state: __elmychatTwitchAdapterV1.diagnostics(), opacity: getComputedStyle(nativeRoots[0]).opacity }));
  assert.equal(retired.state.retiredRoots, 1); assert.equal(retired.state.identityTransfers, 2); assert.equal(retired.opacity, '0');
  await call('stop');
  assert.equal(await page.evaluate(() => !document.querySelector('[data-elmychat-origin-layer]') && nativeRoots[0].getAttribute('style') === 'color:white;padding-left:24px;'), true);
});

test('identical-text reuse without DOM changes, detach/reinsert and later replacement receive new identities', { timeout: 30000 }, async t => {
  const { page, call, drain, initial } = await setup(t);
  await page.evaluate(() => { fixtureMessageInstances[0].props.message.id = 'different-message-identical-text'; });
  // No mutation callback or resize: the ordinary report drain must see it.
  const reused = await call('takeReports');
  assert.ok(reused.events.some(event => event.type === 'removed' && event.messageId === initial[0].messageId));
  const replacement = reused.events.find(event => event.type === 'added'); assert.ok(replacement);
  assert.equal(await page.evaluate(() => getComputedStyle(nativeRoots[0]).opacity), '0');
  await page.evaluate(() => { const node = nativeRoots[0]; const parent = node.parentNode; node.remove(); parent.prepend(node); });
  const moved = await drain();
  assert.ok(moved.some(event => event.type === 'removed' && event.messageId === replacement.messageId));
  const movedId = moved.find(event => event.type === 'added').messageId;
  await page.evaluate(() => { globalThis.earlierParent = nativeRoots[0].parentNode; nativeRoots[0].remove(); });
  assert.ok((await drain()).some(event => event.type === 'removed' && event.messageId === movedId));
  await page.evaluate(() => { const node = nativeRoots[0].cloneNode(true); fixtureMessageInstances[0] = fixtureBindMessage(node, 'different-message-identical-text'); nativeRoots[0] = node; earlierParent.prepend(node); });
  const later = await drain(); assert.equal(later.length, 1); assert.equal(later[0].type, 'added'); assert.notEqual(later[0].messageId, movedId);
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().identityTransfers), 0);
});

test('duplicate renderer IDs, DOM-only IDs and conflicting identities cannot transfer hosts', { timeout: 30000 }, async t => {
  const { page, drain, initial } = await setup(t);
  await page.evaluate(() => {
    const previous = nativeRoots[0]; const id = fixtureMessageInstances[0].props.message.id;
    const first = previous.cloneNode(true), second = previous.cloneNode(true);
    fixtureBindMessage(first, id); fixtureBindMessage(second, id); previous.replaceWith(first, second);
  });
  const duplicate = await drain();
  assert.ok(duplicate.some(event => event.type === 'removed' && event.messageId === initial[0].messageId));
  assert.equal(duplicate.filter(event => event.type === 'added').length, 2);
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().identityTransfers), 0);
  await page.evaluate(() => { nativeRoots[1].dataset.id = 'conflicting-dom-key'; });
  const conflicting = await drain(); const conflictingId = conflicting.find(event => event.type === 'added').messageId;
  await page.evaluate(() => { fixtureReplaceMessage(1).dataset.id = 'conflicting-dom-key'; });
  const conflictRemount = await drain();
  assert.ok(conflictRemount.some(event => event.type === 'removed' && event.messageId === conflictingId));
  assert.ok(conflictRemount.some(event => event.type === 'added' && event.messageId !== conflictingId));
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().identityTransfers), 0);
  await page.evaluate(() => { delete globalThis.FrankerFaceZ; });
  await drain();
  await page.evaluate(() => { nativeRoots[1].dataset.id = 'dom-only-key'; });
  const keyed = await drain(); const keyedId = keyed.find(event => event.type === 'added').messageId;
  await page.evaluate(() => { const copy = nativeRoots[1].cloneNode(true); nativeRoots[1].replaceWith(copy); nativeRoots[1] = copy; });
  const domRemount = await drain(); assert.ok(domRemount.some(event => event.type === 'removed' && event.messageId === keyedId));
  assert.ok(domRemount.some(event => event.type === 'added' && event.messageId !== keyedId));
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().identityTransfers), 0);
});

test('static, animated, wide and zero-width content keeps identity, sizing, clipping and native descendants', { timeout: 30000 }, async t => {
  const { page, call, drain, core, initial, admit, place } = await setup(t);
  let pending;
  await page.route('https://assets.fixture.test/delayed.svg', route => { pending = route; });
  await page.evaluate(gif => {
    const body = document.createElement('span'); nativeRoots[0].replaceChildren(body); globalThis.emoteBody = body;
    const animated = document.createElement('img'); animated.src = `data:image/gif;base64,${gif}`; animated.style.cssText = 'width:32px;height:32px;vertical-align:bottom';
    const zero = document.createElement('span'); zero.style.cssText = 'display:inline-block;position:relative;width:0;height:32px;vertical-align:bottom';
    const overlay = document.createElement('span'); overlay.style.cssText = 'position:absolute;left:-16px;top:0;width:8px;height:8px;background:blue'; zero.append(overlay);
    const delayed = document.createElement('img'); delayed.src = 'https://assets.fixture.test/delayed.svg';
    body.append(animated, zero, delayed); globalThis.animatedEmote = animated; globalThis.zeroEmote = zero; globalThis.delayedEmote = delayed;
  }, gif);
  const inserted = await drain(); assert.ok(inserted.every(event => event.type === 'resized')); admit(inserted); await place();
  await page.waitForFunction(() => animatedEmote.complete && animatedEmote.naturalWidth === 4);
  const oldSlot = core.layout().placements[0].rect;
  const nextSlot = core.layout().placements[1].rect;
  assert.ok(pending); await pending.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="180"><rect width="60" height="180" fill="red"/></svg>' });
  await page.waitForFunction(() => delayedEmote.complete && delayedEmote.naturalHeight === 180);
  await waitForPaint(page, 3);
  const screenshot = PNG.sync.read(await page.screenshot({ omitBackground: true }));
  for (let y = Math.ceil(oldSlot.y + oldSlot.height); y < nextSlot.y; y += 1) for (let x = 0; x < screenshot.width; x += 1) {
    assert.equal(screenshot.data[(y * screenshot.width + x) * 4 + 3], 0, 'Late emote growth must not paint through the assigned gap.');
  }
  const loaded = await drain(); assert.equal(loaded.length, 1); assert.equal(loaded[0].type, 'resized'); assert.equal(loaded[0].messageId, initial[0].messageId);
  assert.ok(loaded[0].height > oldSlot.height + 100); admit(loaded); await place();
  assert.equal(core.entries()[0].sequence, 1);
  assert.equal(await page.evaluate(() => zeroEmote.getBoundingClientRect().width), 0);
  assert.equal(await page.evaluate(() => animatedEmote.parentNode === emoteBody && delayedEmote.parentNode === emoteBody), true);
  const palette = new Set();
  const end = Date.now() + 3000;
  while (Date.now() < end && palette.size < 2) {
    const png = PNG.sync.read(await page.locator('img[src^="data:image/gif"]').screenshot());
    const offset = ((16 * png.width) + 4) * 4;
    palette.add(png.data[offset] > png.data[offset + 1] ? 'red' : 'green');
  }
  assert.equal(palette.size, 2, 'Native animated GIF frames continue while attached.');
  await page.evaluate(() => {
    delayedEmote.style.width = '500px'; delayedEmote.style.height = '40px';
    nativeRoots[0].style.cssText = 'color:white;padding-left:24px;position:relative;width:900px;transform:translateY(100px);clip-path:none;transition:all 1s;';
  });
  const wide = await drain(); assert.ok(wide.every(event => event.type === 'resized')); admit(wide); await place();
  const measured = await page.evaluate(() => ({ width: nativeRoots[0].getBoundingClientRect().width,
    transform: getComputedStyle(nativeRoots[0]).transform, transition: getComputedStyle(nativeRoots[0]).transitionProperty,
    image: delayedEmote.getBoundingClientRect().width }));
  assert.deepEqual(measured, { width: 340, transform: 'none', transition: 'none', image: 500 });
  await page.evaluate(() => { delayedEmote.remove(); });
  const shrink = await drain(); assert.equal(shrink[0].messageId, initial[0].messageId); assert.ok(shrink[0].height < wide[0].height); admit(shrink); await place();
  await call('setWidth', { width: 180 }); const narrow = await drain(); assert.ok(narrow.every(event => event.type === 'resized' && event.width === 180));
  assert.equal(await page.evaluate(() => nativeRoots[0].getBoundingClientRect().width), 180);
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().added), 2);
});

test('rapid arrivals and rerenders stay bounded and preserve order without idle write loops', { timeout: 30000 }, async t => {
  const { page, drain, core, admit, place } = await setup(t);
  for (let batch = 0; batch < 4; batch += 1) {
    await page.evaluate(batch => {
      for (let i = 0; i < 20; i += 1) { const node = document.createElement('div'); node.textContent = 'Repeated text from one user'; fixtureBindMessage(node, `arrival-${batch}-${i}`); document.querySelector('.scroll').append(node); }
      fixtureReplaceMessage(0);
    }, batch);
    const events = await drain(); assert.equal(events.filter(event => event.type === 'added').length, 20); assert.ok(events.every(event => event.type !== 'removed'));
    admit(events); await place();
    const placements = core.layout().placements;
    for (let i = 1; i < placements.length; i += 1) assert.ok(placements[i].rect.y >= placements[i - 1].rect.y + placements[i - 1].rect.height + 20);
  }
  const state = await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics());
  assert.equal(state.trackedRoots, 82); assert.equal(state.identityTransfers, 4); assert.equal(state.originMarkers, 82);
  await waitForPaint(page, 5);
  assert.deepEqual(await drain(), []);
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().flushes), state.flushes);
  assert.deepEqual(core.entries().slice(0, 2).map(entry => entry.sequence), [1, 2]);
});

for (const sameProcess of [false, true]) test(`enhanced identity/layout preserves native sources and spacer alpha through ${sameProcess ? 'page contexts' : 'OOPIFs'}`, { timeout: 60000 }, async () => {
  const fixtures = await startCoordinatorFixtures(); const profile = await mkdtemp(join(tmpdir(), 'elmychat-content-'));
  let context; let runtime;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 420, height: 600 },
      args: ['--remote-debugging-port=0', '--no-proxy-server', ...(sameProcess ? ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'] : ['--site-per-process']),
        '--host-resolver-rules=MAP first-fixture.test 127.0.0.1,MAP second-fixture.test 127.0.0.1'] });
    const page = context.pages()[0]; await page.goto(fixtures.targetUrl);
    await page.frameLocator('#twitch').locator('[data-id="native-a"]').waitFor(); await page.frameLocator('#youtube').locator('#native-text').waitFor();
    const twitch = page.frames().find(frame => frame.url() === fixtures.sources[0].urlPrefix);
    await twitch.evaluate(shim);
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    runtime = new NativeCoordinator({ endpoint: `http://127.0.0.1:${port}`, targetUrl: fixtures.targetUrl, sources: fixtures.sources, gap: 12 });
    async function until(predicate) {
      const end = Date.now() + 10000;
      while (Date.now() < end) { await runtime.step(); await waitForPaint(page, 2); if (predicate()) return; }
      assert.fail('Enhanced content fixture did not converge.');
    }
    await until(() => runtime.diagnostics().layout.placements.length === 8);
    await runtime.control({ type: 'spacer-add', height: 35 });
    const previous = runtime.diagnostics().layout.placements.map(({ sourceId, messageId, sequence, sessionId }) => ({ sourceId, messageId, sequence, sessionId }));
    await twitch.evaluate(() => {
      const node = fixtureReplaceMessage(0); const emote = document.createElement('span'); emote.style.cssText = 'display:inline-block;width:60px;height:85px;background:blue;vertical-align:bottom'; node.append(emote);
    });
    await until(() => runtime.diagnostics().sources[0].adapter.identityTransfers === 1 && runtime.diagnostics().layout.placements.find(entry => entry.messageId === 'twitch-1').rect.height > 85);
    assert.deepEqual(runtime.diagnostics().layout.placements.map(({ sourceId, messageId, sequence, sessionId }) => ({ sourceId, messageId, sequence, sessionId })), previous);
    assert.equal(runtime.diagnostics().layout.spacers[0].height, 35);
    assert.equal(runtime.diagnostics().sources[0].adapter.rendererIdentifiedRoots, 2);
    const png = PNG.sync.read(await page.screenshot({ omitBackground: true }));
    const entries = [...runtime.diagnostics().layout.placements.map(entry => ({ rect: entry.rect })), ...runtime.diagnostics().layout.spacers].sort((a, b) => a.rect.y - b.rect.y);
    for (let i = 1; i < entries.length; i += 1) for (let y = Math.max(0, Math.ceil(entries[i - 1].rect.y + entries[i - 1].rect.height)); y < Math.min(png.height, entries[i].rect.y); y += 1) {
      for (let x = 0; x < png.width; x += 1) assert.equal(png.data[(y * png.width + x) * 4 + 3], 0);
    }
    for (const spacer of runtime.diagnostics().layout.spacers) for (let y = Math.max(0, Math.ceil(spacer.rect.y)); y < Math.min(png.height, spacer.rect.y + spacer.rect.height); y += 1) {
      for (let x = 0; x < png.width; x += 1) assert.equal(png.data[(y * png.width + x) * 4 + 3], 0, 'Native emotes and platform marks must not paint in spacers.');
    }
    assert.equal(await page.frameLocator('#youtube').locator('[data-user-id="same-user"]').count(), 0);
  } finally { await runtime?.stop(); await context?.close(); await fixtures.close(); await rm(profile, { recursive: true, force: true }); }
});
