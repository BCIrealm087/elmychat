import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { twitchAdapterExpression } from '../../packages/adapters/twitch/index.js';
import { youtubeAdapterExpression } from '../../packages/adapters/youtube/index.js';

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); });
async function idle(page) { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))))); }
for (const [platform, expression, key] of [
  ['twitch', twitchAdapterExpression, '__elmychatTwitchAdapterV1'],
  ['youtube', youtubeAdapterExpression, '__elmychatYouTubeAdapterV1'],
]) {
  async function setup(t) {
    const context = await browser.newContext({ viewport: { width: 420, height: 600 } });
    t.after(() => context.close());
    const page = await context.newPage();
    await page.setContent(await readFile(new URL(`../fixtures/${platform}/source.html`, import.meta.url), 'utf8'));
    await page.evaluate(() => {
      for (const root of nativeRoots.slice(2)) root.remove();
      nativeRoots.length = 2;
      for (const [i, root] of nativeRoots.entries()) {
        root.style.paddingLeft = '24px';
        root.style.background = i ? 'rgb(0,128,255)' : 'rgb(200,50,50)';
        root.style.transition = 'all 1s';
        root.style.animation = 'native-arrival 1s';
      }
      globalThis.originalStyles = nativeRoots.map(node => node.getAttribute('style'));
    });
    const address = { sourceId: platform, sessionId: 'stability' };
    const call = (method, data = {}) => page.evaluate(({ key, method, command }) => globalThis[key][method](command), { key, method, command: { ...address, ...data } });
    await page.evaluate(expression({ ...address, width: 420 }));
    await idle(page);
    const reports = await call('takeReports');
    assert.equal(reports.status, 'running');
    assert.equal(reports.events.length, 2);
    const placement = (event, y) => ({ ...address, messageId: event.messageId, visible: true,
      rect: { x: 0, y, width: 420, height: event.height }, clip: { x: 0, y, width: 420, height: event.height } });
    const placements = [placement(reports.events[0], 50), placement(reports.events[1], 50 + reports.events[0].height + 20)];
    await call('applyPlacements', { revision: 1, placements });
    return { page, address, call, placement, reports, placements };
  }

  test(`${platform} late native growth stays inside its assigned slot until the next layout`, { timeout: 30000 }, async t => {
    const { page, call, placement, reports, placements } = await setup(t);
    const first = placements[0].rect;
    const second = placements[1].rect;
    await page.evaluate(() => nativeRoots[0].querySelector('.emote, .media').style.height = '180px');
    // Hold the coordinator snapshot while the native box resizes. Sample
    // several painted frames, not just final geometry after layout catches up.
    for (let frame = 0; frame < 3; frame += 1) {
      await idle(page);
      const bytes = await page.screenshot({ omitBackground: true });
      const png = PNG.sync.read(bytes);
      for (let y = Math.ceil(first.y + first.height); y < second.y; y += 1) {
        assert.equal(png.data[(y * png.width + 100) * 4 + 3], 0, 'Growing native content must not paint into the gap.');
      }
      const slot = (Math.ceil(second.y + second.height - 2) * png.width + 100) * 4;
      assert.deepEqual([...png.data.subarray(slot, slot + 4)], [0, 128, 255, 255], 'Growth must not superimpose the following message.');
      assert.equal(png.data[((first.y + 2) * png.width + 100) * 4 + 3], 255, 'Keep the confirmed slot visible while waiting for measurements.');
      if (frame === 2) {
        await mkdir('.runtime/proof', { recursive: true });
        await writeFile(`.runtime/proof/${platform}-delayed-growth.png`, bytes);
      }
    }
    const resized = await call('takeReports');
    assert.equal(resized.events.length, 1);
    assert.equal(resized.events[0].type, 'resized');
    assert.equal(resized.events[0].messageId, reports.events[0].messageId);
    assert.ok(resized.events[0].height > first.height + 100, 'Measure the real native box, not a forced slot height.');
    const next = [placement(resized.events[0], 10), placement(reports.events[1], 30 + resized.events[0].height)];
    // Acknowledgment must already reflect the snapshot, with no native
    // transition interpolating through other message slots.
    const committed = await page.evaluate(({ key, command }) => {
      const result = globalThis[key].applyPlacements(command);
      return { result, rows: nativeRoots.map(node => ({ y: node.getBoundingClientRect().y,
        transition: getComputedStyle(node).transitionProperty, animation: getComputedStyle(node).animationName })) };
    }, { key, command: { ...next[0], revision: 2, placements: next } });
    assert.equal(committed.result.status, 'running');
    assert.deepEqual(committed.rows.map(row => row.y), next.map(p => p.rect.y));
    assert.ok(committed.rows.every(row => row.transition === 'none' && row.animation === 'none'));
    await page.evaluate(() => nativeRoots[0].querySelector('.emote, .media').style.height = '8px');
    await idle(page);
    const shrunk = await call('takeReports');
    assert.equal(shrunk.events[0].messageId, resized.events[0].messageId);
    assert.equal(shrunk.events[0].height, first.height);
    await call('applyPlacements', { revision: 3, placements });
    await call('stop');
    assert.equal(await page.locator('[data-elmychat-admission]').count(), 0);
    assert.equal(await page.evaluate(() => nativeRoots.every((node, i) => node.getAttribute('style') === originalStyles[i])), true);
  });

  test(`${platform} arrivals and reused roots cannot flash in an unassigned native position`, { timeout: 30000 }, async t => {
    const { page, call, placement, reports, placements } = await setup(t);
    const arrival = await page.evaluate(() => {
      const node = document.createElement(nativeRoots[0].localName);
      if (nativeRoots[0].hasAttribute('data-a-target')) node.setAttribute('data-a-target', 'chat-line-message');
      node.setAttribute('data-id', 'new-arrival');
      const child = document.createElement('span'); child.textContent = 'new message'; child.style.visibility = 'visible'; node.append(child);
      const nested = document.createElement(nativeRoots[0].localName);
      if (nativeRoots[0].hasAttribute('data-a-target')) nested.setAttribute('data-a-target', 'chat-line-message');
      nested.textContent = 'nested native content'; node.append(nested);
      nativeRoots[0].parentNode.append(node);
      globalThis.arrivalRoot = node;
      return { opacity: getComputedStyle(node).opacity, childVisibility: getComputedStyle(child).visibility, nestedOpacity: getComputedStyle(nested).opacity };
    });
    assert.deepEqual(arrival, { opacity: '0', childVisibility: 'visible', nestedOpacity: '1' }, 'Guard outer hosts before discovery without hiding their nested native content.');
    await idle(page);
    const added = await call('takeReports');
    assert.equal(added.events.length, 1);
    assert.equal(added.events[0].type, 'added');
    assert.equal(await page.evaluate(() => getComputedStyle(arrivalRoot).opacity), '0');
    await call('applyPlacements', { revision: 2, placements: [...placements, placement(added.events[0], 250)] });
    assert.equal(await page.evaluate(() => getComputedStyle(arrivalRoot).opacity), '1');
    await page.evaluate(async () => {
      nativeRoots[0].removeAttribute('id'); nativeRoots[0].setAttribute('data-id', 'replacement');
      // Promise continuation follows the mutation observer but precedes rAF.
      await Promise.resolve();
      globalThis.reusedOpacity = getComputedStyle(nativeRoots[0]).opacity;
    });
    assert.equal(await page.evaluate(() => reusedOpacity), '0');
    await idle(page);
    const replaced = await call('takeReports');
    assert.ok(replaced.events.some(event => event.type === 'removed' && event.messageId === reports.events[0].messageId));
    assert.ok(replaced.events.some(event => event.type === 'added' && event.messageId !== reports.events[0].messageId));
    // The owned guard repairs foreign removal/text replacement, then stays idle.
    await page.evaluate(() => document.querySelector('[data-elmychat-admission]').textContent = '');
    await idle(page);
    await page.evaluate(() => document.querySelector('[data-elmychat-admission]').remove());
    await idle(page);
    assert.equal(await page.locator('[data-elmychat-admission]').count(), 1);
    const flushes = await page.evaluate(key => globalThis[key].diagnostics().flushes, key);
    await idle(page);
    assert.equal(await page.evaluate(key => globalThis[key].diagnostics().flushes, key), flushes);
    await call('stop');
    assert.equal(await page.locator('[data-elmychat-admission]').count(), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(arrivalRoot).opacity), '1');
  });
}
