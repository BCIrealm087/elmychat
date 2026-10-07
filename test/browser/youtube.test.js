import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { installYouTubeAdapter, youtubeAdapterExpression } from '../../packages/adapters/youtube/index.js';
import { Compositor } from '../../packages/compositor/index.js';

const identity = { sourceId: 'youtube:fixture', sessionId: 'one' };
const kinds = ['text', 'paid-message', 'paid-sticker', 'membership', 'gift-purchase', 'gift-redemption'];
const fixture = await readFile(new URL('../fixtures/youtube/source.html', import.meta.url), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { if (browser) await browser.close(); });

async function idle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
}

async function setup(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 600 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.setContent(fixture);
  await page.evaluate(youtubeAdapterExpression({ ...identity, width: 420, ...options }));
  await idle(page);
  return page;
}

async function call(page, method, data = {}, address = identity) {
  return page.evaluate(({ method, command }) => __elmychatYouTubeAdapterV1[method](command), { method, command: { ...address, ...data } });
}

async function drain(page) {
  await idle(page);
  const result = await call(page, 'takeReports');
  assert.equal(result.status, 'running', result.failure ?? 'Adapter unexpectedly stopped.');
  return result.events;
}

function compositor(events, gap = 0) {
  const core = new Compositor({ viewport: { width: 420, height: 600 } });
  core.activateSource(identity.sourceId, identity.sessionId);
  for (const [index, event] of events.entries()) {
    core.addMessage({ ...event, receivedAtMs: index });
    if (index === 0 && gap) core.setSpacer({ spacerId: 'pause', height: gap });
  }
  return core;
}

test('YouTube text and special native hosts retain lifecycle/descendants and paint exact transparent gaps and clipping', { timeout: 30000 }, async t => {
  const page = await setup(t);
  const events = await drain(page);
  assert.deepEqual(events.map(event => event.messageKind), kinds);
  assert.ok(events.every(event => event.type === 'added' && event.width === 420 && event.height > 0));
  assert.ok(events.every(event => !Object.hasOwn(event, 'text') && !Object.hasOwn(event, 'nativeKey')));
  const core = compositor(events, 120);
  await call(page, 'applyPlacements', { revision: 1, placements: core.layout().placements });
  await idle(page);
  const preserved = await page.evaluate(() => ({
    lifecycle: { ...lifecycle }, baseline: baselineLifecycle,
    roots: nativeRoots.map((root, index) => ({ sameRoot: document.querySelector('#items').children[index] === root, sameParent: root.parentNode === originalParents[index], sameDocument: root.ownerDocument === document, descendants: nativeDescendants[index].every(node => root.contains(node)), y: root.getBoundingClientRect().y })),
  }));
  assert.deepEqual(preserved.lifecycle, preserved.baseline);
  assert.ok(preserved.roots.every(root => root.sameRoot && root.sameParent && root.sameDocument && root.descendants));
  assert.deepEqual(preserved.roots.map(root => root.y), core.layout().placements.map(entry => entry.rect.y));
  const bytes = await page.screenshot({ omitBackground: true });
  const png = PNG.sync.read(bytes);
  const alpha = (x, y) => png.data[(y * png.width + x) * 4 + 3];
  const [first, second] = core.layout().placements;
  for (let y = Math.ceil(first.rect.y + first.rect.height); y < second.rect.y; y += 1) for (let x = 0; x < png.width; x += 1) assert.equal(alpha(x, y), 0);
  for (const entry of core.layout().placements) assert.equal(alpha(22, Math.floor(entry.rect.y + 2)), 255);
  assert.equal(alpha(2, 2), 0, 'Ticker/chrome must not paint outside the message list.');
  core.setViewport({ width: 420, height: 20 });
  await call(page, 'applyPlacements', { revision: 2, placements: core.layout().placements });
  await idle(page);
  const clipped = PNG.sync.read(await page.screenshot({ omitBackground: true }));
  for (let y = 20; y < clipped.height; y += 1) assert.equal(clipped.data[(y * clipped.width + 2) * 4 + 3], 0);
  await call(page, 'stop');
  assert.equal(await page.evaluate(() => beforeStyles.every(([node, inline, css]) => node.getAttribute('style') === inline && node.style.cssText === css)), true);
  assert.deepEqual(await page.evaluate(() => ({ ...lifecycle })), preserved.baseline);
  await mkdir('.runtime/proof', { recursive: true });
  await writeFile('.runtime/proof/youtube-adapter.png', bytes);
  await writeFile('.runtime/proof/youtube-adapter.json', JSON.stringify({ kind: 'synthetic-youtube-adapter', browser: browser.version(), platform: process.platform, messageKinds: kinds, transparentGap: 120, clippedViewport: 20, nativeLifecyclePreserved: true, stylesRestored: true, status: 'passed', limitations: ['Synthetic candidates; special-root DOM names and continuous live OBS/YouTube behavior are unverified.'] }, null, 2));
});

test('nested supported renderers, ticker copies and unknown roots never become duplicate arrivals', { timeout: 30000 }, async t => {
  const page = await setup(t);
  const initial = await drain(page);
  await page.evaluate(() => {
    const nested = document.createElement('yt-live-chat-text-message-renderer');
    nested.id = 'nested-text'; nested.textContent = 'Native nested synthetic content';
    nativeRoots[1].append(nested);
    const ticker = document.createElement('yt-live-chat-paid-sticker-renderer'); ticker.id = 'ticker-two';
    document.querySelector('.chrome').append(ticker);
  });
  const changes = await drain(page);
  assert.ok(changes.every(event => event.type === 'resized'));
  assert.equal((await page.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics())).trackedRoots, 6);
  assert.equal(await page.evaluate(() => document.querySelector('#nested-text').getAttribute('style')), null);
  const core = compositor(initial);
  for (const event of changes) core.resizeMessage(event);
  await call(page, 'applyPlacements', { revision: 1, placements: core.layout().placements });
  await idle(page);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#unsupported')).visibility), 'hidden');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ticker-copy')).visibility), 'hidden');
});

test('arrivals and late native media resize keep identities and coalesce an undelivered removal', { timeout: 30000 }, async t => {
  const page = await setup(t);
  const initial = await drain(page);
  await page.evaluate(() => {
    nativeRoots[2].querySelector('.media').style.height = '90px';
    const card = document.createElement('yt-live-chat-membership-item-renderer'); card.id = 'later-member'; card.textContent = 'Later synthetic membership';
    document.querySelector('#items').append(card);
  });
  const changes = await drain(page);
  assert.equal(changes.find(event => event.type === 'added').messageKind, 'membership');
  const resized = changes.find(event => event.type === 'resized');
  assert.equal(resized.messageId, initial[2].messageId);
  assert.ok(resized.height > initial[2].height);
  assert.equal(await page.evaluate(() => nativeDescendants[2].every(node => nativeRoots[2].contains(node))), true);
  await page.evaluate(() => {
    globalThis.undelivered = document.createElement('yt-live-chat-paid-message-renderer');
    undelivered.id = 'undelivered'; undelivered.textContent = 'Transient synthetic card';
    document.querySelector('#items').append(undelivered);
  });
  await idle(page);
  await page.evaluate(() => undelivered.remove());
  assert.deepEqual(await drain(page), []);
});

test('native identity changes, removals, scope moves and replacement lists invalidate old placements', { timeout: 30000 }, async t => {
  const page = await setup(t);
  const initial = await drain(page);
  const oldLayout = compositor(initial).layout().placements;
  await page.evaluate(() => { nativeRoots[0].id = 'replacement-text'; nativeRoots[1].remove(); });
  const changed = await drain(page);
  assert.equal(changed.filter(event => event.type === 'removed').length, 2);
  assert.notEqual(changed.find(event => event.type === 'added').messageId, initial[0].messageId);
  await call(page, 'applyPlacements', { revision: 1, placements: oldLayout });
  await idle(page);
  assert.equal(await page.evaluate(() => getComputedStyle(nativeRoots[0]).visibility), 'hidden');
  assert.equal(await page.evaluate(() => nativeRoots[1].getAttribute('style')), null);
  await page.evaluate(() => document.querySelector('.chrome').append(nativeRoots[2]));
  assert.equal((await drain(page)).find(event => event.type === 'removed').reason, 'scope-lost');
  await page.evaluate(() => {
    const items = document.createElement('div'); items.id = 'items';
    const root = document.createElement('yt-live-chat-text-message-renderer'); root.id = 'new-list-text'; root.textContent = 'Fresh synthetic list';
    items.append(root); document.querySelector('#items').replaceWith(items);
  });
  const replacement = await drain(page);
  assert.equal(replacement.filter(event => event.type === 'added').length, 1);
  assert.equal(replacement.filter(event => event.type === 'removed').length, 4);
  assert.equal((await page.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics())).trackedRoots, 1);
});

test('closed shadow content in a discovered host remains native and reports delayed sizing without lifecycle churn', { timeout: 30000 }, async t => {
  const page = await setup(t);
  const initial = await drain(page);
  await page.evaluate(() => {
    const shadow = nativeRoots[2].attachShadow({ mode: 'closed' });
    globalThis.shadowContent = document.createElement('div'); shadowContent.style.height = '40px'; shadowContent.textContent = 'Native closed shadow fixture';
    shadow.append(shadowContent);
  });
  const first = await drain(page);
  assert.equal(first[0].type, 'resized');
  assert.equal(first[0].messageId, initial[2].messageId);
  await page.evaluate(() => shadowContent.style.height = '100px');
  const resized = await drain(page);
  assert.equal(resized[0].messageId, initial[2].messageId);
  assert.ok(resized[0].height > first[0].height);
  assert.equal(await page.evaluate(() => nativeRoots[2].shadowRoot === null && shadowContent.isConnected && nativeRoots[2].parentNode === originalParents[2]), true);
  assert.deepEqual(await page.evaluate(() => ({ ...lifecycle })), await page.evaluate(() => baselineLifecycle));
});

test('YouTube width, session and revision guards hide stale snapshots and retired roots', { timeout: 30000 }, async t => {
  const page = await setup(t);
  const initial = await drain(page);
  const core = compositor(initial);
  const old = core.layout().placements;
  assert.equal((await call(page, 'stop', {}, { ...identity, sessionId: 'old' })).reason, 'stale-session');
  await call(page, 'applyPlacements', { revision: 2, placements: old });
  assert.equal((await call(page, 'applyPlacements', { revision: 1, placements: old })).reason, 'stale-layout');
  await call(page, 'setWidth', { width: 300 });
  const resizes = await drain(page);
  assert.equal(resizes.length, 6);
  assert.ok(resizes.every(event => event.type === 'resized' && event.width === 300));
  assert.equal((await call(page, 'applyPlacements', { revision: 3, placements: old })).reason, 'stale-width');
  core.setViewport({ width: 300, height: 600 });
  for (const event of resizes) core.resizeMessage(event);
  await call(page, 'applyPlacements', { revision: 3, placements: [core.layout().placements[0]] });
  await idle(page);
  assert.deepEqual(await page.evaluate(() => nativeRoots.map(root => getComputedStyle(root).visibility)), ['visible', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden']);
  await call(page, 'retireMessages', { messageIds: [initial[0].messageId] });
  assert.equal((await drain(page))[0].reason, 'coordinator-retired');
  await call(page, 'applyPlacements', { revision: 4, placements: core.layout().placements });
  await idle(page);
  assert.equal(await page.evaluate(() => getComputedStyle(nativeRoots[0]).visibility), 'hidden');
  await assert.rejects(() => call(page, 'applyPlacements', { revision: 5, placements: [{ ...core.layout().placements[1], clip: null }] }));
  assert.equal((await page.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics())).revision, 4);
  await call(page, 'stop');
  await page.evaluate(installYouTubeAdapter, { ...identity, sessionId: 'two', width: 420 });
  await idle(page);
  assert.equal((await call(page, 'takeReports')).reason, 'stale-session');
});

test('special-host style repair avoids feedback loops and restores platform updates instead of recreating hosts', { timeout: 30000 }, async t => {
  const page = await setup(t);
  const initial = await drain(page);
  const core = compositor(initial);
  await call(page, 'applyPlacements', { revision: 1, placements: core.layout().placements });
  await idle(page);
  await page.evaluate(() => {
    nativeRoots[1].setAttribute('style', 'color: lime; top: 90px; position: relative;');
    document.querySelector('yt-live-chat-item-list-renderer').style.transform = 'translateY(200px)';
    document.body.style.background = 'purple';
  });
  await idle(page);
  assert.equal(await page.evaluate(() => nativeRoots[1].getBoundingClientRect().y), core.layout().placements[1].rect.y);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  const before = await page.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics().flushes);
  await idle(page);
  assert.equal(await page.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics().flushes), before);
  await call(page, 'stop');
  assert.deepEqual(await page.evaluate(() => ({ top: nativeRoots[1].style.top, position: nativeRoots[1].style.position, color: nativeRoots[1].style.color, transform: document.querySelector('yt-live-chat-item-list-renderer').style.transform, background: document.body.style.background })), { top: '90px', position: 'relative', color: 'lime', transform: 'translateY(200px)', background: 'purple' });
  assert.deepEqual(await page.evaluate(() => ({ ...lifecycle })), await page.evaluate(() => baselineLifecycle));
});

test('bounded root/report failures and pagehide tear down all YouTube styles and observers', { timeout: 30000 }, async t => {
  const page = await setup(t, { maxRoots: 6 });
  await drain(page);
  await page.evaluate(() => {
    const root = document.createElement('yt-live-chat-paid-message-renderer'); root.id = 'overflow'; document.querySelector('#items').append(root);
  });
  await idle(page);
  const failed = await call(page, 'takeReports');
  assert.equal(failed.failure, 'native-root-limit');
  assert.equal(failed.status, 'failed');
  assert.equal(await page.evaluate(() => beforeStyles.every(([node, inline]) => node.getAttribute('style') === inline)), true);
  const overflow = await setup(t, { maxReports: 1 });
  assert.equal((await call(overflow, 'takeReports')).failure, 'report-overflow');
  assert.equal(await overflow.evaluate(() => beforeStyles.every(([node, inline]) => node.getAttribute('style') === inline)), true);
  const hidden = await setup(t);
  await drain(hidden);
  await hidden.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal((await call(hidden, 'takeReports')).status, 'stopped');
  assert.equal(await hidden.evaluate(() => beforeStyles.every(([node, inline]) => node.getAttribute('style') === inline)), true);
  await hidden.evaluate(() => nativeRoots[0].querySelector('.media').style.height = '100px');
  await idle(hidden);
  assert.deepEqual((await call(hidden, 'takeReports')).events, []);
  assert.equal((await hidden.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics())).trackedRoots, 0);
});

test('missing lists wait for native loading and ambiguous lists fail without guessing a target', { timeout: 30000 }, async t => {
  const context = await browser.newContext({ viewport: { width: 420, height: 600 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.setContent('<html><body><div>Loading synthetic native chat</div></body></html>');
  await page.evaluate(installYouTubeAdapter, { ...identity, width: 420 });
  await idle(page);
  assert.equal((await page.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics())).waitingForContainer, true);
  assert.deepEqual(await drain(page), []);
  await page.evaluate(() => {
    const list = document.createElement('yt-live-chat-item-list-renderer');
    const items = document.createElement('div'); items.id = 'items';
    const root = document.createElement('yt-live-chat-text-message-renderer'); root.id = 'loaded'; root.textContent = 'Loaded native synthetic text';
    items.append(root); list.append(items); document.body.append(list);
  });
  const loaded = await drain(page);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].messageKind, 'text');
  await page.evaluate(() => {
    const list = document.createElement('yt-live-chat-item-list-renderer'); const items = document.createElement('div'); items.id = 'items'; list.append(items); document.body.append(list);
  });
  await idle(page);
  const failed = await call(page, 'takeReports');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure, 'ambiguous-message-container');
  assert.equal((await page.evaluate(() => __elmychatYouTubeAdapterV1.diagnostics())).styledNodes, 0);
});
