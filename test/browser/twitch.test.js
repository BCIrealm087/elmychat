import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { installTwitchAdapter, twitchAdapterExpression } from '../../packages/adapters/twitch/index.js';
import { Compositor } from '../../packages/compositor/index.js';

const identity = { sourceId: 'twitch:fixture', sessionId: 'one' };
const fixture = await readFile(new URL('../fixtures/twitch/source.html', import.meta.url), 'utf8');
const artFixture = await readFile(new URL('../fixtures/twitch/ascii-art.html', import.meta.url), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { if (browser) await browser.close(); });

async function setup(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 300 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.setContent(fixture);
  // Exercise the exact serialized expression used by future CDP injection.
  await page.evaluate(twitchAdapterExpression({ ...identity, width: 420, ...options }));
  await idle(page);
  return page;
}

async function idle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
}

async function call(page, method, data = {}, address = identity) {
  return page.evaluate(({ method, command }) => globalThis.__elmychatTwitchAdapterV1[method](command), { method, command: { ...address, ...data } });
}

async function drain(page) {
  await idle(page);
  const result = await call(page, 'takeReports');
  assert.equal(result.status, 'running', result.failure ?? 'Adapter unexpectedly stopped.');
  return result.events;
}

function layout(events, viewport = { width: 420, height: 300 }, spacer = 120) {
  const core = new Compositor({ viewport });
  core.activateSource(identity.sourceId, identity.sessionId);
  for (let index = 0; index < events.length; index += 1) {
    core.addMessage({ ...events[index], receivedAtMs: index });
    if (index === 0 && spacer > 0) core.setSpacer({ spacerId: 'pause', height: spacer });
  }
  return core;
}

// Measure glyphs without changing the native text or inserting line breaks.
async function artGeometry(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-a-target="chat-line-message"]');
    const text = document.querySelector('#art').firstChild;
    const box = root.getBoundingClientRect();
    const rows = new Map();
    const glyphs = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text.data[i] !== 'E') continue;
      const range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1);
      const rect = range.getBoundingClientRect();
      const y = Math.round((rect.y - box.y) * 100) / 100;
      rows.set(y, (rows.get(y) ?? '') + text.data[i]);
      glyphs.push({ x: rect.x - box.x, y, width: rect.width, height: rect.height });
    }
    const css = getComputedStyle(root);
    return { width: box.width, height: box.height, rows: [...rows.values()], glyphs, text: text.data,
      typography: [css.fontFamily, css.fontSize, css.lineHeight, css.letterSpacing, css.whiteSpace, css.overflowWrap, css.paddingLeft, css.paddingRight] };
  });
}

test('Twitch ASCII art retains native sidebar wrapping in wide overlays and remeasures narrow ones', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 840, height: 500 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.setContent(artFixture);
  await page.evaluate(() => {
    globalThis.artRoot = document.querySelector('[data-a-target="chat-line-message"]');
    globalThis.artText = document.querySelector('#art').firstChild;
    globalThis.artChildren = [...artRoot.querySelectorAll('*')];
    globalThis.originalStyles = [...document.querySelectorAll('*')].map(node => [node, node.getAttribute('style')]);
  });
  const native = await artGeometry(page);
  assert.deepEqual(native.rows.map(row => row.length), [34, 34, 12, 12, 34, 34, 12, 12, 34, 34], 'The fixture must exercise the supplied ten-row E.');
  assert.ok(native.text.includes('\u2800'), 'Keep the supplied Unicode braille blanks.');
  await page.evaluate(twitchAdapterExpression({ ...identity, width: 840 }));
  const events = await drain(page);
  const core = layout(events, { width: 840, height: 500 }, 0);
  await call(page, 'applyPlacements', { revision: 1, placements: core.layout().placements });
  await idle(page);
  assert.deepEqual(await artGeometry(page), native, 'Placement must preserve every native glyph position, line break, space and font metric.');
  assert.equal(events[0].width, 840, 'Reports still address the shared compositor viewport.');
  assert.equal(events[0].height, native.height);
  assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().messageWidth), 340);
  assert.equal(await page.evaluate(() => document.querySelector('#art').firstChild === artText && artChildren.every(node => artRoot.contains(node))), true);
  await mkdir('.runtime/proof', { recursive: true });
  await writeFile('.runtime/proof/twitch-ascii-art.png', await page.screenshot({ omitBackground: true }));

  await page.setViewportSize({ width: 600, height: 500 });
  await call(page, 'setWidth', { width: 600 });
  const wider = await drain(page);
  assert.equal(wider.length, 1);
  assert.equal(wider[0].width, 600);
  assert.equal(wider[0].messageId, events[0].messageId);
  assert.deepEqual(await artGeometry(page), native, 'A second wide source must not rewrap the art.');
  assert.equal(await page.evaluate(() => getComputedStyle(artRoot).visibility), 'hidden');
  core.setViewport({ width: 600, height: 500 }); core.resizeMessage(wider[0]);
  await call(page, 'applyPlacements', { revision: 2, placements: core.layout().placements });
  await idle(page);
  assert.equal(await page.evaluate(() => getComputedStyle(artRoot).visibility), 'visible');

  await page.setViewportSize({ width: 280, height: 500 });
  await call(page, 'setWidth', { width: 280 });
  const narrow = await drain(page);
  const narrowArt = await artGeometry(page);
  assert.equal(narrowArt.width, 280);
  assert.ok(narrowArt.height > native.height, 'Narrow viewports must report the actual rewrapped height.');
  assert.equal(narrow[0].height, narrowArt.height);
  assert.equal(narrow[0].messageId, events[0].messageId);
  core.setViewport({ width: 280, height: 80 }); core.resizeMessage(narrow[0]);
  await call(page, 'applyPlacements', { revision: 3, placements: core.layout().placements });
  await idle(page);
  const clipped = PNG.sync.read(await page.screenshot({ omitBackground: true }));
  for (let y = 80; y < clipped.height; y += 1) for (let x = 0; x < clipped.width; x += 1) assert.equal(clipped.data[(y * clipped.width + x) * 4 + 3], 0);
  await call(page, 'stop');
  assert.equal(await page.evaluate(() => originalStyles.every(([node, style]) => node.getAttribute('style') === style)), true);
  assert.deepEqual(await artGeometry(page), native, 'Stopping restores the native sidebar layout.');
});

test('Twitch discovery, compositor placement and clipping preserve native roots and paint a transparent gap', { timeout: 30000 }, async (t) => {
  const page = await setup(t);
  const events = await drain(page);
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.type === 'added' && event.width === 420 && event.height > 0));
  const core = layout(events);
  assert.equal((await call(page, 'applyPlacements', { revision: 1, placements: core.layout().placements })).accepted, true);
  await idle(page);
  const native = await page.evaluate(() => nativeRoots.map((root, index) => ({
    sameRoot: document.querySelectorAll('[data-a-target="chat-line-message"]')[index] === root,
    sameDescendants: nativeDescendants[index].every(node => root.contains(node)),
    x: root.getBoundingClientRect().x, y: root.getBoundingClientRect().y,
  })));
  assert.ok(native.every(root => root.sameRoot && root.sameDescendants && root.x === 0));
  assert.deepEqual(native.map(root => root.y), core.layout().placements.map(entry => entry.rect.y));
  const screenshot = await page.screenshot({ omitBackground: true });
  const png = PNG.sync.read(screenshot);
  const [first, second] = core.layout().placements;
  for (let y = Math.ceil(first.rect.y + first.rect.height); y < second.rect.y; y += 1) {
    for (let x = 0; x < png.width; x += 1) assert.equal(png.data[(y * png.width + x) * 4 + 3], 0);
  }
  assert.equal(png.data[(Math.floor(first.rect.y + 2) * png.width + 2) * 4 + 3], 255);
  core.setViewport({ width: 420, height: 20 });
  const clipped = core.layout();
  await call(page, 'applyPlacements', { revision: 2, placements: clipped.placements });
  await idle(page);
  const clipImage = PNG.sync.read(await page.screenshot({ omitBackground: true }));
  for (let y = 20; y < clipImage.height; y += 1) assert.equal(clipImage.data[(y * clipImage.width + 2) * 4 + 3], 0, 'Pixels below the compositor viewport must be clipped.');
  await mkdir('.runtime/proof', { recursive: true });
  await writeFile('.runtime/proof/twitch-adapter.png', screenshot);
  await writeFile('.runtime/proof/twitch-adapter.json', JSON.stringify({ kind: 'synthetic-twitch-adapter', browser: browser.version(), platform: process.platform, initialMessages: events.length, nativeIdentityPreserved: true, transparentGap: 120, clippedViewport: 20, status: 'passed', limitations: ['Synthetic DOM; live Twitch lifecycle and OBS remain unverified for the adapter.'] }, null, 2));
  assert.equal((await call(page, 'stop')).restored, true);
  assert.equal(await page.evaluate(() => beforeStyles.every(([node, inline, css]) => node.getAttribute('style') === inline && node.style.cssText === css)), true);
});

test('new arrivals and delayed native sizing report once without rebuilding native content', { timeout: 30000 }, async (t) => {
  const page = await setup(t);
  const initial = await drain(page);
  await page.evaluate(() => {
    const root = document.createElement('div');
    root.dataset.aTarget = 'chat-line-message';
    root.dataset.id = 'native-c';
    root.textContent = 'A later synthetic arrival';
    document.querySelector('.scroll').append(root);
    nativeRoots[0].querySelector('.emote').style.height = '70px';
  });
  const changes = await drain(page);
  assert.equal(changes.filter(event => event.type === 'added').length, 1);
  const resized = changes.find(event => event.type === 'resized');
  assert.equal(resized.messageId, initial[0].messageId);
  assert.ok(resized.height > initial[0].height);
  assert.deepEqual(await drain(page), []);
  assert.equal(await page.evaluate(() => nativeDescendants[0].every(node => nativeRoots[0].contains(node))), true);
  await page.evaluate(() => {
    globalThis.undelivered = document.createElement('div');
    undelivered.dataset.aTarget = 'chat-line-message';
    undelivered.textContent = 'Undelivered synthetic arrival';
    document.querySelector('.scroll').append(undelivered);
  });
  await idle(page);
  await page.evaluate(() => undelivered.remove());
  assert.deepEqual(await drain(page), [], 'An undelivered arrival removed before draining must not leave a ghost entry.');
});

test('node removal, keyed reuse and remove/reinsert invalidate old identities and reject their placements', { timeout: 30000 }, async (t) => {
  const page = await setup(t);
  const initial = await drain(page);
  const oldLayout = layout(initial).layout().placements;
  await page.evaluate(() => {
    nativeRoots[0].dataset.id = 'replacement';
    nativeRoots[1].remove();
  });
  const changes = await drain(page);
  assert.equal(changes.filter(event => event.type === 'removed').length, 2);
  const replacement = changes.find(event => event.type === 'added');
  assert.notEqual(replacement.messageId, initial[0].messageId);
  await call(page, 'applyPlacements', { revision: 1, placements: oldLayout });
  await idle(page);
  assert.equal(await page.evaluate(() => getComputedStyle(nativeRoots[0]).visibility), 'hidden');
  await page.evaluate(() => {
    const parent = nativeRoots[0].parentElement;
    nativeRoots[0].remove();
    parent.append(nativeRoots[0]);
  });
  const moved = await drain(page);
  assert.equal(moved.find(event => event.type === 'removed').messageId, replacement.messageId);
  assert.notEqual(moved.find(event => event.type === 'added').messageId, replacement.messageId);
  assert.equal(await page.evaluate(() => nativeRoots[1].getAttribute('style')), null, 'Detached roots must have their styles restored.');
});

test('unkeyed content replacement creates a new identity while pure style resizing does not', { timeout: 30000 }, async (t) => {
  const page = await setup(t);
  await drain(page);
  await page.evaluate(() => nativeRoots[0].removeAttribute('data-id'));
  const unkeyed = (await drain(page)).find(event => event.type === 'added');
  await page.evaluate(() => nativeRoots[0].style.padding = '20px');
  const resized = await drain(page);
  assert.equal(resized[0].type, 'resized');
  assert.equal(resized[0].messageId, unkeyed.messageId);
  await page.evaluate(() => nativeRoots[0].textContent = 'Recycled synthetic content');
  const reused = await drain(page);
  assert.equal(reused.find(event => event.type === 'removed').messageId, unkeyed.messageId);
  assert.notEqual(reused.find(event => event.type === 'added').messageId, unkeyed.messageId);
});

test('platform style rewrites are repaired without feedback loops and teardown preserves foreign updates', { timeout: 30000 }, async (t) => {
  const page = await setup(t);
  const initial = await drain(page);
  const core = layout(initial);
  await call(page, 'applyPlacements', { revision: 1, placements: core.layout().placements });
  await idle(page);
  await page.evaluate(() => {
    nativeRoots[0].setAttribute('style', 'color: lime; position: relative; top: 90px;');
    document.querySelector('.scroll').style.transform = 'translateY(200px)';
    document.body.style.background = 'purple';
  });
  await idle(page);
  assert.equal(await page.evaluate(() => nativeRoots[0].getBoundingClientRect().y), core.layout().placements[0].rect.y);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  const before = await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().flushes);
  await idle(page);
  const after = await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().flushes);
  assert.equal(after, before, 'Owned style writes must not schedule an observer feedback loop.');
  await call(page, 'stop');
  assert.deepEqual(await page.evaluate(() => ({ position: nativeRoots[0].style.position, top: nativeRoots[0].style.top, color: nativeRoots[0].style.color, transform: document.querySelector('.scroll').style.transform, background: document.body.style.background })), { position: 'relative', top: '90px', color: 'lime', transform: 'translateY(200px)', background: 'purple' });
  assert.equal(await page.evaluate(() => nativeRoots[0].style.getPropertyValue('clip-path')), '');
});

test('session/revision checks, full snapshots and width remeasurement prevent stale painting', { timeout: 30000 }, async (t) => {
  const page = await setup(t);
  const initial = await drain(page);
  const core = layout(initial);
  const placements = core.layout().placements;
  assert.equal((await call(page, 'stop', {}, { ...identity, sessionId: 'old' })).reason, 'stale-session');
  await call(page, 'applyPlacements', { revision: 2, placements });
  assert.equal((await call(page, 'applyPlacements', { revision: 1, placements })).reason, 'stale-layout');
  await call(page, 'setWidth', { width: 300 });
  const resized = await drain(page);
  assert.equal(resized.length, 2);
  assert.ok(resized.every(event => event.type === 'resized' && event.width === 300));
  assert.equal((await call(page, 'applyPlacements', { revision: 3, placements })).reason, 'stale-width');
  core.setViewport({ width: 300, height: 300 });
  for (const event of resized) core.resizeMessage(event);
  await call(page, 'applyPlacements', { revision: 3, placements: [core.layout().placements[1]] });
  await idle(page);
  assert.deepEqual(await page.evaluate(() => nativeRoots.map(root => getComputedStyle(root).visibility)), ['hidden', 'visible']);
  const diagnostics = await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics());
  await assert.rejects(() => call(page, 'applyPlacements', { revision: 4, placements: [{ ...core.layout().placements[0], clip: null }] }));
  assert.equal((await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics())).revision, diagnostics.revision);
  await call(page, 'stop');
  await page.evaluate(installTwitchAdapter, { ...identity, sessionId: 'two', width: 420 });
  await idle(page);
  assert.equal((await call(page, 'takeReports')).reason, 'stale-session');
  assert.equal((await call(page, 'stop')).reason, 'stale-session');
});

test('retirement keeps connected roots hidden; root/report overflow restores the document and fails explicitly', { timeout: 30000 }, async (t) => {
  const page = await setup(t, { maxRoots: 2 });
  const initial = await drain(page);
  await call(page, 'retireMessages', { messageIds: [initial[0].messageId] });
  const removed = await drain(page);
  assert.equal(removed[0].reason, 'coordinator-retired');
  await page.evaluate(() => nativeRoots[0].style.visibility = 'visible');
  await idle(page);
  assert.equal(await page.evaluate(() => getComputedStyle(nativeRoots[0]).visibility), 'hidden');
  assert.deepEqual(await drain(page), []);
  await page.evaluate(() => {
    const node = document.createElement('div'); node.dataset.aTarget = 'chat-line-message'; node.textContent = 'Overflow'; document.body.append(node);
  });
  await idle(page);
  const failed = await call(page, 'takeReports');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure, 'native-root-limit');
  assert.equal(await page.evaluate(() => beforeStyles.every(([node, inline]) => node === nativeRoots[0] || node.getAttribute('style') === inline)), true);
  assert.deepEqual(await page.evaluate(() => ({ visibility: nativeRoots[0].style.visibility, position: nativeRoots[0].style.position })), { visibility: 'visible', position: '' });
  const context = await browser.newContext({ viewport: { width: 420, height: 300 } });
  t.after(() => context.close());
  const overflow = await context.newPage();
  await overflow.setContent(fixture);
  await overflow.evaluate(installTwitchAdapter, { ...identity, width: 420, maxReports: 1 });
  await idle(overflow);
  const reportFailure = await call(overflow, 'takeReports');
  assert.equal(reportFailure.status, 'failed');
  assert.equal(reportFailure.failure, 'report-overflow');
  assert.equal(await overflow.evaluate(() => beforeStyles.every(([node, inline]) => node.getAttribute('style') === inline)), true);
});

test('teardown disconnects observers and stops responding to later arrivals or pagehide', { timeout: 30000 }, async (t) => {
  const page = await setup(t);
  await drain(page);
  await call(page, 'stop');
  await page.evaluate(() => {
    nativeRoots[0].querySelector('.emote').style.height = '100px';
    const node = document.createElement('div'); node.dataset.aTarget = 'chat-line-message'; document.body.append(node);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  await idle(page);
  const result = await call(page, 'takeReports');
  assert.equal(result.status, 'stopped');
  assert.deepEqual(result.events, []);
  const counts = await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics());
  assert.equal(counts.trackedRoots, 0);
  assert.equal(counts.styledNodes, 0);
  await page.evaluate(installTwitchAdapter, { ...identity, sessionId: 'two', width: 420 });
  await idle(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal((await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics())).status, 'stopped');
  assert.equal((await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics())).styledNodes, 0);
});
