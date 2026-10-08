import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NativeCoordinator } from '../../apps/coordinator/src/runtime.js';
import { TwitchEnhancement } from '../../apps/coordinator/src/twitch-enhancement.js';
import { NativePage } from '../../packages/browser-control/native-page.js';
import { ffzBootstrapUrl } from '../../packages/adapters/twitch/ffz-bootstrap.js';
import { startCoordinatorFixtures } from '../../scripts/proof/fixtures.js';
import { waitForPaint } from './paint.js';

const source=await readFile(new URL('../fixtures/twitch/source.html',import.meta.url),'utf8');
const shim=await readFile(new URL('../fixtures/twitch/ffz-proof-shim.js',import.meta.url),'utf8');
const integrity=`sha256-${createHash('sha256').update(shim).digest('base64')}`;
for(const sameProcess of [false,true]) test(`enhanced rolling load, channel isolation and conflict recovery through ${sameProcess?'page contexts':'OOPIFs'}`,{timeout:90000},async()=>{
  const fixtures=await startCoordinatorFixtures(),profile=await mkdtemp(join(tmpdir(),'elmychat-emote-load-'));
  let browser,runtime,transport;let loads=0,downloads=0;
  try {
    browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:420,height:600},
      args:['--remote-debugging-port=0','--no-proxy-server',...(sameProcess?['--disable-site-isolation-trials','--disable-features=IsolateOrigins,site-per-process']:['--site-per-process']),
        '--host-resolver-rules=MAP first-fixture.test 127.0.0.1,MAP second-fixture.test 127.0.0.1']});
    const twitchUrl='https://www.twitch.tv/embed/fixture/chat';
    await browser.route('https://www.twitch.tv/embed/**',route=>route.fulfill({contentType:'text/html',body:source}));
    await browser.route(ffzBootstrapUrl,route=>{loads++;return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:shim});});
    const page=browser.pages()[0];await page.goto(fixtures.targetUrl);
    await page.locator('#twitch').evaluate((frame,url)=>{frame.src=url;},twitchUrl);
    await page.frameLocator('#twitch').locator('[data-id="native-a"]').waitFor();
    await page.frameLocator('#youtube').locator('#native-text').waitFor();
    const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];
    runtime=new NativeCoordinator({endpoint:`http://127.0.0.1:${port}`,targetUrl:fixtures.targetUrl,maxEntries:80,gap:12,
      sources:[{...fixtures.sources[0],urlPrefix:twitchUrl,emotes:{sevenTv:true,betterTtv:true}},fixtures.sources[1]]},{
      openPage:async(...args)=>{transport=await NativePage.open(...args);return transport;},
      createEnhancement:(choices,owner)=>new TwitchEnhancement(choices,owner,{download:async()=>{downloads++;return{integrity};},pollMs:20})});
    async function until(predicate) {
      const end=Date.now()+15000;
      while(Date.now()<end){await runtime.step();await waitForPaint(page);if(await predicate(runtime.diagnostics()))return;}
      assert.fail(JSON.stringify(runtime.diagnostics()));
    }
    await until(state=>state.chatConnected&&state.sources[0].enhancement.status==='ready'&&!state.sources[0].enhancement.activeWork);
    const youtube=page.frames().find(frame=>frame.url().includes('second-fixture.test'));
    const youtubeDocument=await youtube.evaluate(()=>globalThis.documentToken=Math.random());
    const frames=()=>[page.frames().find(frame=>frame.url()===twitchUrl),youtube];
    for(const frame of frames())await frame.evaluate(()=>{
      globalThis.loadTemplate=nativeRoots[0].cloneNode(true);loadTemplate.removeAttribute('style');
      globalThis.loadList=nativeRoots[0].parentElement;
      globalThis.loadBase=new WeakMap([...loadList.children].map(node=>[node,node.getAttribute('style')]));
    });
    const spacer=(await runtime.control({type:'spacer-add',height:33})).entry;
    const peaks={roots:0,reports:0,settings:0};
    for(let batch=0;batch<20;batch++){
      const prior=runtime.diagnostics().sources.map(source=>source.adapter.added);
      for(const frame of frames())await frame.evaluate(batch=>{
        for(let i=0;i<20;i++){const node=loadTemplate.cloneNode(true);node.id=`load-${batch}-${i}`;node.dataset.id=node.id;loadBase.set(node,node.getAttribute('style'));loadList.append(node);}
        while(loadList.children.length>60)loadList.firstElementChild.remove();
      },batch);
      await until(state=>state.chatConnected&&state.sources.every((source,index)=>source.adapter.added>=prior[index]+20));
      const state=runtime.diagnostics();assert.ok(state.resources.retainedEntries<=80);
      for(const source of state.sources){peaks.roots=Math.max(peaks.roots,source.adapter.trackedRoots);peaks.reports=Math.max(peaks.reports,source.adapter.pendingReports);assert.ok(source.adapter.trackedRoots<=60&&source.adapter.pendingReports<=120);}
      peaks.settings=Math.max(peaks.settings,state.sources[0].enhancement.isolation.entries);
      assert.equal(state.sources[0].enhancement.isolation.status,'isolated');
    }
    for(let i=0;i<3;i++){const previous=transport;previous.close();await until(state=>state.chatConnected&&state.sources[0].enhancement.status==='ready');assert.equal(previous.frames.contexts.size,0);}
    assert.equal(loads,1);assert.equal(downloads,1);
    for(let i=0;i<3;i++){await runtime.step();await waitForPaint(page);}
    const idle=runtime.diagnostics().activity;
    for(let i=0;i<20;i++){await runtime.step();await waitForPaint(page);}
    assert.equal(runtime.diagnostics().activity.layoutWrites,idle.layoutWrites);
    assert.equal(runtime.diagnostics().activity.reportsProcessed,idle.reportsProcessed);
    // Put a new spacer after reconnect admission has exercised history bounds.
    const retained=(await runtime.control({type:'spacer-add',height:spacer.height})).entry;
    const youtubeSession=runtime.diagnostics().sources[1].sessionId;
    const youtubeIds=runtime.diagnostics().layout.placements.filter(entry=>entry.sourceId==='youtube').map(entry=>[entry.messageId,entry.sequence]);
    // An unselected channel must not inherit a loader or native adapter.
    await page.locator('#twitch').evaluate(frame=>{frame.src='https://www.twitch.tv/embed/other/chat';});
    await until(state=>state.resources.activeSessions===1&&state.sources[1].status==='running');
    const foreign=page.frames().find(frame=>frame.url().includes('/other/'));
    assert.equal(await foreign.evaluate(()=>!!globalThis.FrankerFaceZ||!!globalThis.__elmychatTwitchAdapterV1),false);
    await page.locator('#twitch').evaluate((frame,url)=>{frame.src=url;},twitchUrl);
    await until(state=>state.chatConnected&&state.sources[0].enhancement.status==='ready');
    assert.equal(loads,2);assert.equal(downloads,1);
    const selected=frames()[0];await selected.evaluate(()=>{globalThis.SevenTV={foreign:true};});
    await until(state=>state.chatConnected&&state.sources[0].enhancement.resetRequested&&state.sources[0].enhancement.reason?.includes('paused'));
    for(let i=0;i<10;i++){await runtime.step();await waitForPaint(page);}
    const recovered=runtime.diagnostics();assert.equal(loads,2);assert.equal(recovered.sources[1].sessionId,youtubeSession);
    assert.deepEqual(recovered.layout.placements.filter(entry=>entry.sourceId==='youtube').map(entry=>[entry.messageId,entry.sequence]),youtubeIds);
    assert.equal(await youtube.evaluate(()=>globalThis.documentToken),youtubeDocument);
    assert.ok(recovered.layout.spacers.some(entry=>entry.spacerId===retained.spacerId));
    assert.equal(runtime.config.gap,12);
    const final=await runtime.stop();assert.equal(final.resources.activeSessions,0);
    assert.ok(final.cleanup.slice(-2).every(record=>record.restored));
    for(const frame of frames())assert.equal(await frame.evaluate(()=>{
      const api=globalThis.__elmychatTwitchAdapterV1??globalThis.__elmychatYouTubeAdapterV1;
      return api.diagnostics().styledNodes===0&&api.diagnostics().trackedRoots===0;
    }),true);
    const output=resolve('.runtime/proof');await mkdir(output,{recursive:true});
    await writeFile(join(output,`emote-hardening-${sameProcess?'page':'oopif'}.json`),JSON.stringify({kind:'synthetic-emote-hardening',status:'passed',arrivals:800,idleCycles:20,reconnects:3,peaks,
      checks:['bounded-enhanced-load','idle-no-layout-writes','one-bootstrap-per-document','channel-isolation','one-conflict-recovery','YouTube-identities-and-spacer-retained','native-restoration'],
      limitations:['Deterministic FFZ contract fixture; no additional live OBS/category guarantee.','Upstream hooks require source reload; provider unload is not claimed.']},null,2));
  } finally {await runtime?.stop();await browser?.close();await fixtures.close();await rm(profile,{recursive:true,force:true});}
});
