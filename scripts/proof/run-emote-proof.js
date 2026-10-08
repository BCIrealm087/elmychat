import { randomUUID } from 'node:crypto';
import { NativePage } from '../../packages/browser-control/native-page.js';
import { requireLoopback } from '../../packages/browser-control/cdp.js';
import { emoteProofExpression, emoteProofKey } from '../../packages/adapters/twitch/emote-proof.js';

import { fetchBootstrap } from '../../packages/adapters/twitch/ffz-bootstrap.js';
export { fetchBootstrap } from '../../packages/adapters/twitch/ffz-bootstrap.js';

export function validateEmoteProofConfig(config) {
  requireLoopback(config.endpoint);
  if (!['7tv', 'bttv', 'both'].includes(config.mode)) throw new Error('Choose 7tv, bttv or both.');
  if (!/^[a-z0-9_]{1,25}$/.test(config.channel)) throw new Error('A normalized Twitch channel is required.');
  const target = new URL(config.targetUrl);
  requireLoopback(target.origin);
  if (target.pathname !== '/overlay' || target.search || target.hash) throw new Error('Select the managed /overlay target.');
  if (!Number.isInteger(config.durationMs ?? 60000) || (config.durationMs ?? 60000) < 1000 || (config.durationMs ?? 60000) > 120000) {
    throw new Error('Proof duration must be 1–120 seconds.');
  }
}

export function selectEmoteFrame(documents, channel) {
  const matches = documents.filter(doc => {
    const url = new URL(doc.url);
    return !doc.topLevel && url.origin === 'https://www.twitch.tv' && url.pathname === `/embed/${channel}/chat`;
  });
  if (matches.length !== 1) throw new Error('Expected exactly one selected Twitch embed; check loading and channel settings.');
  return matches[0];
}

/** Explicit diagnostic reset, limited to the managed overlay's owned iframe. */
export async function resetEmoteProof(config) {
  validateEmoteProofConfig({ ...config, mode: 'both' });
  const page = await NativePage.open(config);
  try {
    const documents = await page.describe();
    const selected = selectEmoteFrame(documents,config.channel);
    const parent = documents.filter(doc=>doc.topLevel && doc.url===config.targetUrl);
    if(parent.length!==1) throw new Error('Managed overlay parent is unavailable.');
    const state = await page.frames.evaluate(selected.context,`(() => { const state=globalThis[${JSON.stringify(emoteProofKey)}]; return state ? { stopped:state.stopped===true, resetRequired:state.resetRequired===true } : null; })()`);
    if (!state?.stopped || !state.resetRequired) throw new Error('Finish/stop the owned emote diagnostic before requesting its reset.');
    return await page.frames.evaluate(parent[0].context, emoteResetExpression(selected.url));
  } finally { page.close(); }
}

export function emoteResetExpression(documentUrl) {
  return `(() => { const frame=document.getElementById('twitch'); if (!(frame instanceof HTMLIFrameElement) || frame.src!==${JSON.stringify(documentUrl)}) throw new Error('Managed Twitch iframe changed; reset refused.'); frame.src=frame.src; return { resetRequested:true, twitchHistoryReset:true }; })()`;
}

/** Attach alongside the running coordinator. Never install/stop its adapters. */
export async function runEmoteProof(config, { onProgress = () => {}, signal, openPage = settings => NativePage.open(settings), fetcher = fetch } = {}) {
  validateEmoteProofConfig(config);
  const report = { kind: 'native-emote-compatibility-diagnostic', mode: config.mode, status: 'blocked',
    timestamp: new Date().toISOString(), channel: config.channel, samples: [],
    limitations: ['Live rendering requires operator confirmation in OBS.',
      'Visibility counts use DOM geometry, not pixel/clip verification.',
      'Bootstrap integrity does not pin dependent engine/add-on chunks.',
      'FFZ default appearance/cosmetics and existing profiles are not isolated by this diagnostic.',
      'No complete enhancer unload is attempted; refresh only Twitch before another mode.'] };
  let page; let selected; let begun = false; let stage = 'bootstrap-download'; const token = randomUUID();
  try {
    report.bootstrap = await fetchBootstrap(fetcher);
    if (signal?.aborted) throw new Error('Proof cancelled.');
    stage = 'browser-attachment';
    page = await openPage(config);
    stage = 'frame-selection';
    const documents = await page.describe();
    selected = selectEmoteFrame(documents, config.channel);
    report.frameType = selected.context.sessionId ? 'iframe-target' : 'page-context';
    report.browser = await page.connection.send('Browser.getVersion');
    stage = 'native-precondition';
    const native = await page.frames.evaluate(selected.context, 'globalThis.__elmychatTwitchAdapterV1?.diagnostics() ?? null');
    if (native?.status !== 'running') throw new Error('Connect native chat in Elmychat before running this diagnostic.');
    report.nativeSession = { sourceId: native.sourceId, sessionId: native.sessionId };
    stage = 'enhancement';
    let snapshot = await page.frames.evaluate(selected.context, emoteProofExpression({ operation: 'begin', token,
      mode: config.mode, documentUrl: selected.url, integrity: report.bootstrap.integrity }));
    begun = true;
    const deadline = Date.now() + (config.durationMs ?? 60000);
    while (true) {
      report.latest = snapshot;
      report.samples.push({ elapsedMs: (config.durationMs ?? 60000) - Math.max(0,deadline-Date.now()), ...snapshot });
      if (report.samples.length > 64) report.samples.shift();
      if (snapshot.status === 'render-observed' && !report.renderEvidence) report.renderEvidence = snapshot;
      onProgress(snapshot);
      if (snapshot.status === 'blocked') throw new Error(snapshot.reason);
      if (signal?.aborted || Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!page.has(selected.context)) throw new Error('Twitch navigated during the proof; run again in the new document.');
      snapshot = await page.frames.evaluate(selected.context, emoteProofExpression({ operation: 'poll', token }));
    }
    report.status = signal?.aborted ? 'cancelled' : report.renderEvidence ? 'render-observed' : 'inconclusive';
    try { report.screenshot = (await page.connection.send('Page.captureScreenshot', { format: 'png' })).data; }
    catch (error) { report.screenshotError = String(error.message).slice(0,240); }
  } catch (error) {
    report.status = 'blocked'; report.reason = String(error.message).slice(0,400);
    report.failure = {stage,...(error.bootstrapFailure ?? {})};
  }
  finally {
    if (begun) {
      try { report.cleanup = await page.frames.evaluate(selected.context, emoteProofExpression({ operation: 'stop', token })); }
      catch { report.cleanup = { stopped: false, enhancerResetRequired: true, reason: 'Document/transport unavailable; proof expires within three minutes.' }; }
    }
    page?.close();
  }
  return report;
}
