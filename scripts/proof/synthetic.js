import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { startFixtures } from './fixtures.js';
import { runNativeProof } from './run-native-proof.js';

export async function runSyntheticProof({ sameProcess = false } = {}) {
  const fixtures = await startFixtures();
  const profile = await mkdtemp(join(tmpdir(), 'elmychat-proof-'));
  let context;
  let proof;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 420, height: 600 },
      args: ['--remote-debugging-port=0', '--no-proxy-server',
        ...(sameProcess ? ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'] : ['--site-per-process']),
        '--host-resolver-rules=MAP first-fixture.test 127.0.0.1,MAP second-fixture.test 127.0.0.1'],
    });
    const page = context.pages()[0];
    await page.goto(fixtures.targetUrl);
    await page.frameLocator('#first').locator('.message').waitFor();
    await page.frameLocator('#second').locator('.message').waitFor();
    const debugPort = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    const blocked = await page.evaluate(() => {
      try { document.querySelector('iframe').contentWindow.document.body; return false; } catch (error) { return error.name === 'SecurityError'; }
    });
    assert.equal(blocked, true, 'Ordinary parent JavaScript must remain cross-origin restricted.');
    proof = await runNativeProof({ endpoint: `http://127.0.0.1:${debugPort}`, targetUrl: fixtures.targetUrl, gap: 120, sources: fixtures.sources });
    const report = proof.report;
    const first = report.sources[0].placement;
    const second = report.sources[1].placement;
    assert.equal(second.y - first.y - first.height, 120);
    for (const frame of page.frames().filter((f) => f !== page.mainFrame())) {
      assert.equal(await frame.evaluate(() => document.querySelector('.message') === originalMessage && originalChildren.every((node) => originalMessage.contains(node))), true);
    }
    const bytes = await page.screenshot({ omitBackground: true });
    const png = PNG.sync.read(bytes);
    const pixel = (x, y) => [...png.data.subarray((Math.floor(y) * png.width + x) * 4, (Math.floor(y) * png.width + x) * 4 + 4)];
    assert.deepEqual(pixel(2, first.y + 2), [200, 50, 50, 255], 'Lower iframe native message must paint through the upper transparent iframe.');
    assert.deepEqual(pixel(2, second.y + 2), [50, 100, 200, 255], 'Upper native frame must keep its own rendering.');
    for (let y = Math.ceil(first.y + first.height); y < second.y; y += 1) for (let x = 0; x < png.width; x += 1) assert.equal(pixel(x, y)[3], 0, 'Every pixel in the arbitrary gap must be transparent.');
    assert.equal(pixel(2, 599)[3], 0, 'Unrelated native decorations must not paint.');
    const cleanup = await proof.restore();
    assert.ok(cleanup.every((item) => item.restored));
    proof = undefined;
    for (const frame of page.frames().filter((f) => f !== page.mainFrame())) assert.equal(await frame.evaluate(() => document.querySelectorAll('[style]').length), 0, 'Original inline styles must be restored.');
    report.status = 'synthetic-rendering-passed';
    report.sameOriginRestrictionPreserved = true;
    report.transparentGapVerifiedByPixels = true;
    report.nativeNodeIdentityPreserved = true;
    report.stylesRestored = true;
    report.environment = { browser: context.browser().version(), platform: process.platform, mode: sameProcess ? 'same-process-requested' : 'site-per-process' };
    report.limitations.push('Synthetic documents, not Twitch/YouTube or OBS/CEF.');
    const output = resolve('.runtime/proof');
    await mkdir(output, { recursive: true });
    const name = sameProcess ? 'synthetic-same-process' : 'synthetic';
    await writeFile(join(output, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(output, `${name}.png`), bytes);
    return report;
  } finally {
    if (proof) await proof.restore();
    if (context) await context.close();
    await fixtures.close();
    await rm(profile, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runSyntheticProof(), null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
