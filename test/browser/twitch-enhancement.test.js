import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { TwitchEnhancement } from '../../apps/coordinator/src/twitch-enhancement.js';
import { NativePage } from '../../packages/browser-control/native-page.js';
import { enhancementExpression } from '../../packages/adapters/twitch/enhancement.js';
import { ffzBootstrapUrl } from '../../packages/adapters/twitch/ffz-bootstrap.js';
import { twitchAdapterExpression } from '../../packages/adapters/twitch/index.js';
import { startCoordinatorFixtures } from '../../scripts/proof/fixtures.js';
import { waitForPaint } from './paint.js';

const shim = await readFile(new URL('../fixtures/twitch/ffz-proof-shim.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../fixtures/twitch/source.html', import.meta.url), 'utf8');
const hash = body => `sha256-${createHash('sha256').update(body).digest('base64')}`;
const bootstrap = { integrity: hash(shim) };

test('in-document enhancement is idempotent, waits for metadata, accepts empty data and fences stale generations', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage(); let loads = 0;
    await page.route(ffzBootstrapUrl, route => { loads += 1; return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: shim }); });
    await page.setContent(source);
    await page.evaluate(twitchAdapterExpression({ sourceId: 'twitch', sessionId: 'owner:first', width: 420 }));
    await page.evaluate(() => { globalThis.fixtureMetadataDelay = 'manual'; globalThis.fixtureNoEmotes = true; });
    const command = { owner: 'owner', sessionId: 'owner:first', documentUrl: page.url(), emotes: { sevenTv: true, betterTtv: true }, integrity: bootstrap.integrity };
    const call = fields => page.evaluate(enhancementExpression({ ...command, ...fields }));
    assert.equal((await call({ operation: 'begin' })).status, 'loading');
    await page.waitForFunction(() => !!globalThis.fixtureFfz);
    for (let i = 0; i < 5; i += 1) assert.equal((await call({ operation: 'begin' })).status, 'loading');
    await page.evaluate(() => fixtureFfz.releaseMetadata());
    const ready = await call({ operation: 'poll' });
    assert.equal(ready.status, 'ready'); assert.equal(ready.providers.every(provider => provider.moduleReady), true);
    assert.deepEqual(await page.evaluate(() => ({ saved: fixtureFfz.saved, writes: fixtureFfz.writes })), { saved: [], writes: [] });
    await page.evaluate(() => { fixtureFfz.emotes.emote_sets = {}; });
    const empty = await call({ operation: 'poll' });
    assert.equal(empty.status, 'ready'); assert.equal(empty.providers.every(provider => provider.dataStatus === 'empty-or-pending'), true);
    assert.equal(loads, 1);
    await assert.rejects(call({ operation: 'begin', owner: 'foreign' }), /another owner/);
    await page.evaluate('globalThis.__elmychatTwitchAdapterV1.stop({sourceId:"twitch",sessionId:"owner:first"})');
    await page.evaluate(twitchAdapterExpression({ sourceId: 'twitch', sessionId: 'owner:second', width: 420 }));
    assert.equal((await call({ operation: 'begin', sessionId: 'owner:second' })).status, 'ready');
    await assert.rejects(call({ operation: 'stop' }), /generation mismatch/);
    assert.equal((await call({ operation: 'poll', sessionId: 'owner:second' })).status, 'ready');
    assert.equal(loads, 1);
    const stopped = await call({ operation: 'stop', sessionId: 'owner:second' });
    assert.equal(stopped.resetRequired, true); assert.equal(stopped.status, 'unavailable');
    assert.equal(await page.evaluate(() => document.querySelectorAll('script[src*="frankerfacez"]').length), 0);
  } finally { await browser.close(); }
});

test('in-document loader failures and missing APIs preserve native chat and protect existing enhancement', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    async function fresh(extra = '') {
      await page.goto('about:blank'); await page.setContent(extra + source);
      await page.evaluate(twitchAdapterExpression({ sourceId: 'twitch', sessionId: 'owner:first', width: 420 }));
    }
    const call = fields => page.evaluate(enhancementExpression({ owner: 'owner', sessionId: 'owner:first', documentUrl: page.url(),
      emotes: { sevenTv: true }, integrity: bootstrap.integrity, ...fields }));
    await fresh(); await page.route(ffzBootstrapUrl, route => route.abort());
    await call({ operation: 'begin' });
    await page.waitForFunction(() => __elmychatTwitchEnhancementV1.status === 'unavailable');
    assert.match((await call({ operation: 'poll' })).reason, /bootstrap failed/);
    assert.equal(await page.evaluate(() => __elmychatTwitchAdapterV1.diagnostics().status), 'running');
    await page.unroute(ffzBootstrapUrl);
    await fresh();
    const invalid = 'globalThis.FrankerFaceZ={get:()=>({resolve:42})};';
    await page.route(ffzBootstrapUrl, route => route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: invalid }));
    await call({ operation: 'begin', integrity: hash(invalid) });
    await page.waitForFunction(() => !!globalThis.FrankerFaceZ);
    assert.match((await call({ operation: 'poll' })).reason, /Unsupported FFZ engine/);
    await fresh(); await page.evaluate(() => { globalThis.SevenTV = {}; });
    await assert.rejects(call({ operation: 'begin' }), /Existing chat enhancement/);
    assert.equal(await page.evaluate(() => !!globalThis.__elmychatTwitchEnhancementV1), false);
    await fresh('<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for \'script\'">');
    const rejected = await call({ operation: 'begin' });
    assert.equal(rejected.status, 'unavailable'); assert.equal(rejected.resetRequired, false);
    await assert.rejects(call({ operation: 'reset' }), /reset ownership changed/);
  } finally { await browser.close(); }
});

for (const sameProcess of [false, true]) for (const partial of [false, true, 'native-failure']) test(`enhancement lifecycle ${partial === 'native-failure' ? 'recovers a native adapter failure once' : partial ? 'recovers partial initialization once' : 'adopts hooks after reconnect'} through ${sameProcess ? 'page contexts' : 'OOPIFs'}`, { timeout: 60000 }, async () => {
  const fixtures = await startCoordinatorFixtures(); const profile = await mkdtemp(join(tmpdir(), 'elmychat-lifecycle-'));
  let browser; let runtime;
  let releaseBootstrap;
  const bootstrapGate = new Promise(resolve => { releaseBootstrap = resolve; });
  try {
    browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 420, height: 600 },
      args: ['--remote-debugging-port=0', '--no-proxy-server', ...(sameProcess ? ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'] : ['--site-per-process']),
        '--host-resolver-rules=MAP first-fixture.test 127.0.0.1,MAP second-fixture.test 127.0.0.1'] });
    const twitchUrl = 'https://www.twitch.tv/embed/fixture/chat';
    await browser.route(`${twitchUrl}*`, route => route.fulfill({ contentType: 'text/html', body: source }));
    let loads = 0;
    const code = partial === true ? 'globalThis.FrankerFaceZ={get:()=>({resolve:42})};' : shim;
    await browser.route(ffzBootstrapUrl, route => { loads += 1; return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: code }); });
    const page = browser.pages()[0]; await page.goto(fixtures.targetUrl);
    await page.locator('#twitch').evaluate((frame, url) => { frame.src = url; }, twitchUrl);
    await page.frameLocator('#twitch').locator('[data-id="native-a"]').waitFor();
    await page.frameLocator('#youtube').locator('#native-text').waitFor();
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    const settings = { endpoint: `http://127.0.0.1:${port}`, targetUrl: fixtures.targetUrl,
      sources: [{ ...fixtures.sources[0], urlPrefix: twitchUrl, emotes: { sevenTv: true, betterTtv: true } }, fixtures.sources[1]], gap: 12 };
    let transport;
    runtime = new NativeCoordinator(settings, { openPage: async (...args) => { transport = await NativePage.open(...args); return transport; },
      createEnhancement: (choices, owner) => new TwitchEnhancement(choices, owner, { download: async () => { await bootstrapGate; return { integrity: hash(code) }; }, pollMs: 20 }) });
    async function until(predicate) {
      const end = Date.now() + 15000;
      while (Date.now() < end) { await runtime.step(); await waitForPaint(page, 2); if (predicate()) return; }
      assert.fail(JSON.stringify(runtime.diagnostics().sources));
    }
    await until(() => runtime.diagnostics().chatConnected && runtime.diagnostics().layout.placements.length === 8);
    // Inspect the initial transport before a deliberate partial failure can
    // refresh its frame; native composition must work during the pending load.
    const document = (await transport.describe()).find(frame => frame.url === twitchUrl);
    assert.ok(document, 'The connected initial Twitch document must be discoverable before bootstrap release.');
    assert.equal(!!document.context.sessionId, !sameProcess);
    const youtubeSession = runtime.diagnostics().sources[1].sessionId;
    await runtime.control({ type: 'spacer-add', height: 25 });
    releaseBootstrap();
    if (partial === 'native-failure') {
      await until(() => runtime.diagnostics().sources[0].enhancement.status === 'ready' && !runtime.diagnostics().sources[0].enhancement.activeWork);
      const twitch = page.frames().find(frame => frame.url() === twitchUrl);
      await twitch.evaluate(() => {
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 501; i += 1) { const node = document.createElement('div'); node.dataset.aTarget = 'chat-line-message'; node.dataset.id = `overflow-${i}`; node.textContent = 'Native fixture overflow'; fragment.append(node); }
        document.querySelector('.scroll').append(fragment);
      });
    }
    if (partial) {
      await until(() => runtime.diagnostics().sources[0].enhancement.resetAttempted &&
        runtime.diagnostics().sources[0].enhancement.reason?.includes('paused') && runtime.diagnostics().chatConnected);
      assert.equal(runtime.diagnostics().sources[1].sessionId, youtubeSession);
      for (let i = 0; i < 40; i += 1) { await runtime.step(); await waitForPaint(page, 1); }
      assert.equal(loads, 1); assert.equal(runtime.diagnostics().layout.spacers[0].height, 25);
      assert.equal(await page.frameLocator('#twitch').locator('img[data-provider="ffz"]').count(), 0);
    } else {
      await until(() => runtime.diagnostics().sources[0].enhancement.status === 'ready' && !runtime.diagnostics().sources[0].enhancement.activeWork);
      assert.equal(loads, 1);
      const oldSession = runtime.diagnostics().sources[0].sessionId;
      transport.close();
      await until(() => runtime.diagnostics().sources[0].sessionId !== oldSession && runtime.diagnostics().sources[0].enhancement.status === 'ready');
      assert.equal(loads, 1); assert.equal(runtime.diagnostics().sources[0].enhancement.resetRequested, false);
      const twitch = page.frames().find(frame => frame.url() === twitchUrl);
      assert.deepEqual(await twitch.evaluate(() => ({ saved: fixtureFfz.saved, writes: fixtureFfz.writes })), { saved: [], writes: [] });
      const reconnectedYoutube = runtime.diagnostics().sources[1].sessionId;
      await twitch.evaluate(() => location.reload());
      const beforeReload = runtime.diagnostics().sources[0].sessionId;
      await until(() => runtime.diagnostics().sources[0].sessionId !== beforeReload && runtime.diagnostics().sources[0].enhancement.status === 'ready');
      assert.equal(loads, 2); assert.equal(runtime.diagnostics().sources[1].sessionId, reconnectedYoutube);
    }
    assert.equal(await page.frameLocator('#youtube').locator('img[data-provider="ffz"]').count(), 0);
  } finally { releaseBootstrap(); await runtime?.stop(); await browser?.close(); await fixtures.close(); await rm(profile, { recursive: true, force: true }); }
});
