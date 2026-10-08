import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeOperatorConfig } from '../../apps/coordinator/src/operator.js';
import { runEmoteProof, resetEmoteProof } from './run-emote-proof.js';

const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.once('SIGTERM', () => cancellation.abort());
try {
  const [mode, configPath, ...extra] = process.argv.slice(2);
  if (!['7tv','bttv','both','reset'].includes(mode) || extra.length) throw new Error('Usage: npm run proof:emotes -- 7tv|bttv|both|reset [config.json]');
  let config;
  if (configPath) config = { ...JSON.parse(await readFile(resolve(configPath), 'utf8')), mode };
  else {
    const state = JSON.parse(await readFile(resolve('.runtime/operator.json'), 'utf8'));
    if (state.version !== 1 || !state.enabled) throw new Error('Save and connect native chat in the local controls first.');
    const settings = normalizeOperatorConfig(state.config);
    config = { endpoint: `http://127.0.0.1:${settings.debugPort}`, targetUrl: 'http://127.0.0.1:3210/overlay',
      ...(settings.targetId ? { targetId: settings.targetId } : {}), channel: settings.channel, mode };
  }
  if(mode==='reset') {
    console.log(JSON.stringify(await resetEmoteProof(config)));
    console.log('Twitch-only refresh requested. Wait for native chat to reconnect before another test.');
  } else {
    console.log(`Preparing ${mode}: downloading FFZ and attaching to the selected Twitch frame. Native chat must remain connected.`);
    console.log(`The ${Math.round((config.durationMs ?? 60000)/1000)}-second observation window begins after preparation.`);
    console.log('Use known enabled channel/global emotes and ordinary text/badges during this window. Watch native order, spacing and wrapping in OBS.');
    let last;
    const report = await runEmoteProof(config, { signal: cancellation.signal, onProgress: snapshot => {
      const summary = `${snapshot.status}: ${snapshot.providers.map(provider => `${provider.id} ${provider.moduleEnabled ? 'loaded' : 'loading'}, ${provider.visibleImages} visible images`).join('; ')}`;
      if (summary !== last) { console.log(summary); last = summary; }
    } });
    const output = resolve('.runtime/proof'); await mkdir(output, { recursive: true });
    if (report.screenshot) {
      await writeFile(resolve(output, `emotes-${mode}.png`), Buffer.from(report.screenshot, 'base64'));
      delete report.screenshot; report.screenshotFile = `emotes-${mode}.png`;
    }
    const path = resolve(output, `emotes-${mode}.json`);
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.status}. Report: ${path}`);
    if (report.reason) console.error(report.reason);
    if (report.cleanup?.enhancerResetRequired) console.log('FFZ remains in this Twitch document. Run npm run proof:emotes -- reset before another mode or normal use. See docs/emote-proof.md.');
    if (report.status !== 'render-observed') process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
