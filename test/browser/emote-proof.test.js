import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { NativePage } from '../../packages/browser-control/native-page.js';
import { emoteProofExpression, ffzBootstrapUrl } from '../../packages/adapters/twitch/emote-proof.js';
import { startCoordinatorFixtures } from '../../scripts/proof/fixtures.js';
import { waitForPaint } from './paint.js';
import { emoteResetExpression } from '../../scripts/proof/run-emote-proof.js';

const shim = await readFile(new URL('../fixtures/twitch/ffz-proof-shim.js',import.meta.url),'utf8');
const integrity = `sha256-${createHash('sha256').update(shim).digest('base64')}`;
const serveShim = context => context.route(ffzBootstrapUrl,route=>route.fulfill({status:200,contentType:'text/javascript',
  headers:{'access-control-allow-origin':'*'},body:shim}));

for(const sameProcess of [false,true]) test(`emote proof keeps native hosts/order and transparent gaps through ${sameProcess?'page contexts':'OOPIFs'}`,{timeout:60000},async()=>{
  const fixtures = await startCoordinatorFixtures();
  const profile = await mkdtemp(join(tmpdir(),'elmychat-emotes-'));
  let browser; let runtime; let diagnostic;
  try {
    browser = await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:420,height:600},
      args:['--remote-debugging-port=0','--no-proxy-server',...(sameProcess?['--disable-site-isolation-trials','--disable-features=IsolateOrigins,site-per-process']:['--site-per-process']),
        '--host-resolver-rules=MAP first-fixture.test 127.0.0.1,MAP second-fixture.test 127.0.0.1']});
    await serveShim(browser);
    const page = browser.pages()[0]; await page.goto(fixtures.targetUrl);
    await page.frameLocator('#twitch').locator('[data-id="native-a"]').waitFor();
    await page.frameLocator('#youtube').locator('#native-text').waitFor();
    const port = (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];
    const config = {endpoint:`http://127.0.0.1:${port}`,targetUrl:fixtures.targetUrl,sources:fixtures.sources,gap:12};
    runtime = new NativeCoordinator(config);
    async function until(predicate) {
      const deadline = Date.now()+10000;
      while(Date.now()<deadline){await runtime.step();await waitForPaint(page,3);if(await predicate())return;}
      assert.fail('Enhancement fixture did not converge.');
    }
    await until(()=>runtime.diagnostics().layout.placements.length===8);
    diagnostic = await NativePage.open(config);
    const selected = (await diagnostic.describe()).find(doc=>doc.url===fixtures.sources[0].urlPrefix);
    assert.equal(!!selected.context.sessionId,!sameProcess);
    const call = command => diagnostic.frames.evaluate(selected.context,emoteProofExpression({token:'fixture-proof',...command}));
    const before = runtime.diagnostics().layout.placements;
    await call({operation:'begin',mode:'both',documentUrl:selected.url,integrity});
    let snapshot;
    await until(async()=>{snapshot=await call({operation:'poll'});return snapshot.status==='render-observed' && runtime.diagnostics().layout.placements.find(entry=>entry.messageId==='twitch-1').height>before.find(entry=>entry.messageId==='twitch-1').height;});
    assert.equal(snapshot.ownership.reparentedRoots,0); assert.equal(snapshot.ownership.changedNativeKeys,0);
    assert.equal(snapshot.ownership.changedTypography,0);
    assert.ok(snapshot.providers.every(provider=>provider.retainedHostImages>0 && provider.moduleEnabled));
    for(const entry of before){const after=runtime.diagnostics().layout.placements.find(candidate=>candidate.messageId===entry.messageId&&candidate.sourceId===entry.sourceId);assert.equal(after.sequence,entry.sequence);assert.equal(after.sessionId,entry.sessionId);}
    const twitch = page.frames().find(frame=>frame.url()===selected.url);
    assert.deepEqual(await twitch.evaluate(()=>({saved:fixtureFfz.saved,writes:fixtureFfz.writes})),{saved:[],writes:[]});
    for(const frame of page.frames().filter(frame=>frame!==page.mainFrame())) {
      assert.equal(await frame.evaluate(()=>nativeRoots.every((node,i)=>document.contains(node)&&nativeDescendants[i].every(child=>node.contains(child)))),true);
    }
    assert.equal(await page.frameLocator('#youtube').locator('img[data-provider="ffz"]').count(),0);
    const bytes = await page.screenshot({omitBackground:true}); const png = PNG.sync.read(bytes);
    const placements = runtime.diagnostics().layout.placements;
    for(let i=1;i<placements.length;i++) {
      const previous=placements[i-1].rect;const next=placements[i].rect;
      assert.equal(next.y-previous.y-previous.height,12);
      for(let y=Math.ceil(previous.y+previous.height);y<next.y;y++)for(let x=0;x<png.width;x++)assert.equal(png.data[(y*png.width+x)*4+3],0,'Enhanced gaps stay transparent.');
    }
    assert.equal((await call({operation:'stop'})).enhancerResetRequired,true);
    assert.equal((await call({operation:'poll'})).status,'stopped');
    await assert.rejects(call({operation:'begin',mode:'7tv',documentUrl:selected.url,integrity}),/Existing enhancement/);
    assert.ok((await twitch.evaluate(()=>__elmychatTwitchAdapterV1.diagnostics())).status==='running');
    const output=resolve('.runtime/proof');await mkdir(output,{recursive:true});
    const name=`emote-fixture-${sameProcess?'page':'oopif'}`;
    await writeFile(join(output,`${name}.png`),bytes);
    await writeFile(join(output,`${name}.json`),JSON.stringify({kind:'synthetic-enhancement-contract',snapshot,
      checks:['scoped-cdp-injection','native-root-identity','stable-sequence','late-image-resize','transparent-gap-pixels','youtube-untouched','no-saved-addon-writes','reset-boundary'],
      limitations:['Our FFZ shim, not upstream FFZ or live Twitch/OBS compatibility.']},null,2)+'\n');
    const youtubeSession=runtime.diagnostics().sources[1].sessionId;
    const twitchSession=runtime.diagnostics().sources[0].sessionId;
    const parent=(await diagnostic.describe()).find(doc=>doc.topLevel);
    await assert.rejects(diagnostic.frames.evaluate(parent.context,emoteResetExpression('https://www.twitch.tv/embed/other/chat')),/reset refused/);
    await diagnostic.frames.evaluate(parent.context,emoteResetExpression(selected.url));
    await until(()=>runtime.diagnostics().sources[0].sessionId!==twitchSession && runtime.diagnostics().sources[0].status==='running');
    assert.equal(runtime.diagnostics().sources[1].sessionId,youtubeSession);
  } finally {diagnostic?.close();await runtime?.stop();await browser?.close();await fixtures.close();await rm(profile,{recursive:true,force:true});}
});

test('emote diagnostic distinguishes readiness, rejects unknown dependencies and records CSP/Trusted Types', {timeout:60000},async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  const context=await browser.newContext();await serveShim(context);
  const page=await context.newPage();
  const source=await readFile(new URL('../fixtures/twitch/source.html',import.meta.url),'utf8');
  async function fresh(extra='') {await page.goto('about:blank');await page.setContent(extra+source);}
  const call=command=>page.evaluate(emoteProofExpression({token:'negative-proof',...command}));
  const begin=()=>call({operation:'begin',mode:'bttv',documentUrl:page.url(),integrity});
  try {
    await fresh();await page.evaluate(()=>{globalThis.fixtureNoEmotes=true;});await begin();
    await page.waitForFunction(()=>!!globalThis.FrankerFaceZ);
    const empty=await call({operation:'poll'});
    assert.equal(empty.status,'awaiting-render');assert.equal(empty.providers[0].moduleEnabled,true);assert.equal(empty.providers[0].visibleImages,0);
    assert.deepEqual(await page.evaluate(()=>({saved:fixtureFfz.saved,writes:fixtureFfz.writes})),{saved:[],writes:[]});
    await assert.rejects(call({operation:'poll',token:'foreign'}),/ownership/);
    await call({operation:'stop'});
    await fresh();await begin();await page.waitForFunction(()=>!!globalThis.FrankerFaceZ);
    await page.evaluate(()=>{fixtureFfz.manager.getAddon('ffzap-bttv').requires.push('unreviewed');});
    const dependency=await call({operation:'poll'});assert.equal(dependency.status,'blocked');assert.match(dependency.reason,/Unreviewed dependency/);
    assert.equal(await page.evaluate(()=>fixtureFfz.manager.enabled_addons.length),0);await call({operation:'stop'});
    await fresh();await page.evaluate(()=>{globalThis.BetterTTV={};});
    await assert.rejects(begin(),/Existing enhancement/);
    await fresh('<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">');
    await begin();await page.waitForTimeout(100);
    const csp=await call({operation:'poll'});assert.equal(csp.status,'blocked');assert.ok(csp.securityViolations.some(entry=>entry.directive==='script-src-elem'));
    await call({operation:'stop'});
    await fresh('<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for \'script\'">');
    const tt=await begin();assert.equal(tt.status,'blocked');assert.match(tt.reason,/Bootstrap rejected/);await call({operation:'stop'});
    assert.equal(await page.evaluate(()=>globalThis.__elmychatEmoteProofV1),undefined);
    const retry=await begin();assert.equal(retry.status,'blocked');assert.match(retry.reason,/Bootstrap rejected/);await call({operation:'stop'});
    await fresh();await page.evaluate(()=>{const script=document.createElement('script');script.src='https://cdn.frankerfacez.com/other.js';document.head.append(script);});
    await assert.rejects(begin(),/Existing enhancement/);
  }finally{await browser.close();}
});
