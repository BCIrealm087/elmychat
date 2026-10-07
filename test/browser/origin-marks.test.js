import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { twitchAdapterExpression } from '../../packages/adapters/twitch/index.js';
import { youtubeAdapterExpression } from '../../packages/adapters/youtube/index.js';
import { Compositor } from '../../packages/compositor/index.js';

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); });
async function idle(page) { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))))); }

for (const [platform, expression, key, label, color] of [
  ['twitch', twitchAdapterExpression, '__elmychatTwitchAdapterV1', 'Twitch', '#A970FF'],
  ['youtube', youtubeAdapterExpression, '__elmychatYouTubeAdapterV1', 'YouTube', '#FF0033'],
]) {
  test(`${label} origin marks stay out of native content, follow clipping and leave no decoration behind`, { timeout: 30000 }, async t => {
    const context = await browser.newContext({ viewport: { width: 420, height: 300 } });
    t.after(() => context.close());
    const page = await context.newPage();
    await page.setContent(await readFile(new URL(`../fixtures/${platform}/source.html`, import.meta.url), 'utf8'));
    await page.evaluate(() => {
      // Native padding available in ordinary platform rows; exercise fallback
      // separately. No stable native keys: decorations must not recycle roots.
      for (const root of nativeRoots) {
        root.removeAttribute('id'); root.removeAttribute('data-id'); root.style.paddingLeft = '24px';
      }
      globalThis.contentBefore = nativeRoots.map(root => root.innerHTML);
      globalThis.parentsBefore = nativeRoots.map(root => root.parentNode);
      globalThis.stylesBefore = [...document.querySelectorAll('*')].map(node => [node, node.getAttribute('style')]);
      globalThis.mutations = 0;
      new MutationObserver(records => { mutations += records.length; }).observe(document.body, { subtree: true, attributes: true, childList: true });
      // Page-wide rules must not restyle SVGs inside the isolated marks.
      const hostile = document.createElement('style'); hostile.textContent = 'svg { display:none !important; }'; document.head.append(hostile);
    });
    const address = { sourceId: platform, sessionId: 'origin-marks' };
    const call = (method, data = {}) => page.evaluate(({ key, method, command }) => globalThis[key][method](command), { key, method, command: { ...address, ...data } });
    await page.evaluate(expression({ ...address, width: 420 }));
    await idle(page);
    const initial = await call('takeReports');
    assert.equal(initial.status, 'running');
    assert.equal(initial.events.length, platform === 'twitch' ? 2 : 6);
    assert.ok(initial.events.every(event => event.type === 'added'));
    const core = new Compositor({ viewport: { width: 420, height: 300 }, gap: 10 });
    core.activateSource(platform, address.sessionId);
    for (const event of initial.events) core.addMessage(event);
    await call('applyPlacements', { revision: 1, placements: core.layout().placements });
    await idle(page);
    const markers = await page.evaluate(() => [...document.querySelectorAll('[data-elmychat-origin]')].map(node => ({
      label: node.getAttribute('aria-label'), title: node.title, role: node.getAttribute('role'),
      rect: { x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height },
      visible: getComputedStyle(node).visibility, pointerEvents: getComputedStyle(node).pointerEvents,
      color: node.shadowRoot.querySelector('path:last-child').getAttribute('fill'), svgDisplay: getComputedStyle(node.shadowRoot.querySelector('svg')).display,
      separate: nativeRoots.every(root => !root.contains(node)),
    })));
    assert.equal(markers.length, initial.events.length);
    assert.ok(markers.every(mark => mark.label === `${label} message` && mark.title === label && mark.role === 'img' && mark.color === color && mark.svgDisplay === 'block' && mark.separate && mark.visible === 'visible' && mark.pointerEvents === 'none' && mark.rect.width === 16 && mark.rect.height === 16));
    assert.equal(await page.evaluate(() => nativeRoots.every((root, i) => root.innerHTML === contentBefore[i] && root.parentNode === parentsBefore[i] && root.getBoundingClientRect().x === 0)), true);
    assert.deepEqual((await call('takeReports')).events, [], 'Decoration must not create unkeyed replacement identities.');
    const settled = await page.evaluate(({ key }) => ({ mutations, flushes: globalThis[key].diagnostics().flushes }), { key });
    await idle(page);
    assert.deepEqual(await page.evaluate(({ key }) => ({ mutations, flushes: globalThis[key].diagnostics().flushes }), { key }), settled, 'Idle frames must not rewrite marks or cause observer feedback.');

    const bytes = await page.screenshot({ omitBackground: true });
    const png = PNG.sync.read(bytes);
    let brandPixels = 0;
    for (let y = 0; y < png.height; y += 1) for (let x = 2; x < 18; x += 1) {
      const offset = (y * png.width + x) * 4;
      if (platform === 'twitch' ? png.data[offset] > 100 && png.data[offset + 2] > png.data[offset] && png.data[offset + 1] < png.data[offset] : png.data[offset] > 240 && png.data[offset + 1] < 60) brandPixels += 1;
    }
    assert.ok(brandPixels > 20, 'The actual platform shape/color must paint, not just an empty box.');
    const placements = core.layout().placements;
    for (let i = 1; i < placements.length; i += 1) for (let y = Math.ceil(placements[i - 1].rect.y + placements[i - 1].rect.height); y < placements[i].rect.y; y += 1) for (let x = 0; x < png.width; x += 1) assert.equal(png.data[(y * png.width + x) * 4 + 3], 0, 'Marks must not leak into message gaps.');
    await mkdir('.runtime/proof', { recursive: true });
    await writeFile(`.runtime/proof/${platform}-origin-marks.png`, bytes);

    // A platform removing the decoration layer must recover without new chat identities.
    await page.evaluate(() => document.querySelector('[data-elmychat-origin-layer]').remove());
    await idle(page);
    assert.equal(await page.locator('[data-elmychat-origin]').count(), initial.events.length);
    assert.deepEqual((await call('takeReports')).events, []);
    await page.evaluate(() => document.querySelector('[data-elmychat-origin]').style.visibility = 'hidden');
    await idle(page);
    assert.equal(await page.locator('[data-elmychat-origin]').first().evaluate(node => getComputedStyle(node).visibility), 'visible');

    // When padding shrinks, reserve a gutter rather than covering the first badge/text.
    await page.evaluate(() => nativeRoots[0].style.paddingLeft = '4px');
    await idle(page);
    const resized = await call('takeReports');
    assert.ok(resized.events.every(event => event.type === 'resized' && event.messageId === initial.events[0].messageId));
    assert.equal(await page.evaluate(() => nativeRoots[0].getBoundingClientRect().x), 20);
    assert.equal(await page.evaluate(() => nativeRoots[0].innerHTML === contentBefore[0]), true);

    core.setViewport({ width: 420, height: 8 });
    for (const event of resized.events) core.resizeMessage(event);
    await call('applyPlacements', { revision: 2, placements: core.layout().placements });
    await idle(page);
    const clipped = PNG.sync.read(await page.screenshot({ omitBackground: true }));
    for (let y = 8; y < clipped.height; y += 1) for (let x = 0; x < clipped.width; x += 1) assert.equal(clipped.data[(y * clipped.width + x) * 4 + 3], 0, 'Clipped marks and content must not paint beyond the viewport.');
    await call('retireMessages', { messageIds: initial.events.map(event => event.messageId) });
    await idle(page);
    assert.ok((await page.locator('[data-elmychat-origin]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).visibility))).every(value => value === 'hidden'));
    await call('stop');
    assert.equal(await page.locator('[data-elmychat-origin-layer]').count(), 0);
    assert.equal(await page.locator('[data-elmychat-origin]').count(), 0);
    assert.equal(await page.evaluate(() => stylesBefore.every(([node, style]) => node === nativeRoots[0] || node.getAttribute('style') === style)), true);
    assert.equal(await page.evaluate(() => nativeRoots[0].style.paddingLeft), '4px', 'Teardown preserves foreign native updates.');
    await page.evaluate(expression({ ...address, sessionId: 'reattached', width: 420 }));
    await idle(page);
    assert.equal(await page.locator('[data-elmychat-origin-layer]').count(), 1);
    assert.equal(await page.locator('[data-elmychat-origin]').count(), initial.events.length);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('[data-elmychat-origin-layer]').count(), 0);
  });
}
