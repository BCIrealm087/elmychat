import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
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
    assert.equal(options.redirect,'manual'); assert.ok(options.signal);
    assert.equal(url,'https://cdn.frankerfacez.com/script/script.min.js');
    return new Response(bytes);
  });
  assert.equal(result.integrity,`sha256-${createHash('sha256').update(bytes).digest('base64')}`);
  assert.equal(result.bytes,Buffer.byteLength(bytes));
  await assert.rejects(fetchBootstrap(async()=>new Response('')),/empty/);
  await assert.rejects(fetchBootstrap(async()=>new Response('',{status:503})),/503/);
  await assert.rejects(fetchBootstrap(async()=>new Response(new Uint8Array(5*1024*1024+1))),/size limit/);
});

test('real HTTP redirect resolves the bootstrap and hashes final bytes', async () => {
  const bytes = '/* final FFZ fixture bytes */';
  const server = createServer((request,response)=>{
    if(request.url==='/script/script.min.js') {response.writeHead(302,{Location:'/static/script.min.js'});response.end();}
    else {response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bytes);}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const calls = []; const signals = [];
  try {
    const bootstrap = await fetchBootstrap((url,options)=>{
      calls.push(url);signals.push(options.signal);
      return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options);
    });
    assert.deepEqual(calls,['https://cdn.frankerfacez.com/script/script.min.js','https://cdn.frankerfacez.com/static/script.min.js']);
    assert.equal(signals[0],signals[1],'The complete download shares one deadline.');
    assert.equal(bootstrap.resolvedUrl,calls[1]);assert.equal(bootstrap.redirects[0].status,302);
    assert.equal(bootstrap.integrity,`sha256-${createHash('sha256').update(bytes).digest('base64')}`);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('bootstrap redirects reject other origins, downgrade, credentials, missing locations and loops',async()=>{
  for(const location of ['https://other.example/script.js','http://cdn.frankerfacez.com/static/script.js','https://user:secret@cdn.frankerfacez.com/static/script.js']) {
    let calls=0;
    await assert.rejects(fetchBootstrap(async()=>{calls++;return new Response(null,{status:302,headers:{Location:location}});}),/approved HTTPS CDN/);
    assert.equal(calls,1,'An unapproved destination is never requested.');
  }
  await assert.rejects(fetchBootstrap(async()=>new Response(null,{status:302})),/Location header/);
  let calls=0;
  await assert.rejects(fetchBootstrap(async()=>{calls++;return new Response(null,{status:302,headers:{Location:'/script/script.min.js'}});}),/three redirects/);
  assert.equal(calls,4);
});

test('network failures preserve cause codes and stage without attaching to OBS',async()=>{
  for(const code of ['ENOTFOUND','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UND_ERR_CONNECT_TIMEOUT']) {
    let opened=false;
    const cause=Object.assign(new Error('network failed at https://user:secret@proxy.example/'),{code});
    const report=await runEmoteProof(config,{fetcher:async()=>{throw new TypeError('fetch failed',{cause});},openPage:async()=>{opened=true;}});
    assert.equal(report.status,'blocked');assert.equal(report.failure.stage,'bootstrap-download');
    assert.ok(report.failure.causes.some(item=>item.code===code));assert.match(report.reason,new RegExp(code));
    assert.equal(report.failure.url,'https://cdn.frankerfacez.com/script/script.min.js');assert.equal(opened,false);
    assert.equal(JSON.stringify(report).includes('user:secret'),false);
  }
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
