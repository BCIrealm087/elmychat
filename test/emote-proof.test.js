import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateEmoteProofConfig, selectEmoteFrame, fetchBootstrap, runEmoteProof } from '../scripts/proof/run-emote-proof.js';

const config = { endpoint: 'http://127.0.0.1:9222', targetUrl: 'http://127.0.0.1:3210/overlay', channel: 'fixture', mode: 'both', durationMs: 1000 };
test('emote diagnostic rejects arbitrary targets and ambiguous/native-lookalike frames', () => {
  validateEmoteProofConfig(config);
  for (const change of [{ endpoint:'http://example.com:9222' }, {targetUrl:'http://localhost/chat'}, {mode:'other'}, {channel:'../other'}, {durationMs:121000}]) {
    assert.throws(() => validateEmoteProofConfig({...config,...change}));
  }
  const twitch = { context:{id:1}, url:'https://www.twitch.tv/embed/fixture/chat?parent=127.0.0.1', topLevel:false };
  assert.equal(selectEmoteFrame([twitch, { ...twitch, url:'https://www.twitch.tv.evil/embed/fixture/chat' }], 'fixture'), twitch);
  assert.throws(() => selectEmoteFrame([{...twitch, topLevel:true}], 'fixture'));
  assert.throws(() => selectEmoteFrame([twitch,{...twitch,context:{id:2}}], 'fixture'));
});

test('bootstrap report hashes received bytes and rejects empty/oversized/error responses', async () => {
  const bytes = '/* synthetic engine */';
  const result = await fetchBootstrap(async (url, options) => {
    assert.equal(options.redirect,'error'); assert.ok(options.signal);
    assert.equal(url,'https://cdn.frankerfacez.com/script/script.min.js');
    return new Response(bytes);
  });
  assert.equal(result.integrity,`sha256-${createHash('sha256').update(bytes).digest('base64')}`);
  assert.equal(result.bytes,Buffer.byteLength(bytes));
  await assert.rejects(fetchBootstrap(async()=>new Response('')),/empty/);
  await assert.rejects(fetchBootstrap(async()=>new Response('',{status:503})),/503/);
  await assert.rejects(fetchBootstrap(async()=>new Response(new Uint8Array(5*1024*1024+1))),/size limit/);
});

test('runner reports incomplete rendering honestly, scopes evaluations and always disconnects', async () => {
  const context = { id:1 }; let closed = false; const commands = [];
  const page = {
    describe:async()=>[{context,url:'https://www.twitch.tv/embed/fixture/chat',topLevel:false}],
    has:selected=>selected===context,
    connection:{send:async method=>{if(method==='Browser.getVersion')return{product:'fixture'}; throw new Error('screenshot unsupported');}},
    frames:{evaluate:async(selected,expression)=>{
      assert.equal(selected,context); commands.push(expression);
      if(expression.includes('diagnostics'))return{status:'running',sourceId:'twitch',sessionId:'native'};
      if(expression.includes('"operation":"stop"'))return{stopped:true,enhancerResetRequired:true};
      return {status:'awaiting-render',providers:[{moduleEnabled:true,visibleImages:0}]};
    }},close:()=>{closed=true;},
  };
  const report = await runEmoteProof(config,{openPage:async()=>page,fetcher:async()=>new Response('fixture')});
  assert.equal(report.status,'inconclusive'); assert.ok(report.cleanup.stopped); assert.ok(closed);
  assert.match(report.screenshotError,/unsupported/);
  assert.equal(commands.filter(command=>command.includes('"operation":"begin"')).length,1);
  assert.equal(commands.filter(command=>command.includes('"operation":"stop"')).length,1);
});

test('runner refuses injection until native adapter is connected', async () => {
  let evaluated = 0; let closed = false;
  const page = { describe:async()=>[{context:{},url:'https://www.twitch.tv/embed/fixture/chat',topLevel:false}],
    connection:{send:async()=>({})},frames:{evaluate:async()=>{evaluated++;return null;}},close:()=>{closed=true;} };
  const report = await runEmoteProof(config,{openPage:async()=>page,fetcher:async()=>new Response('fixture')});
  assert.equal(report.status,'blocked'); assert.match(report.reason,/Connect native chat/);
  assert.equal(evaluated,1); assert.ok(closed); assert.equal(report.cleanup,undefined);
});
