import { randomUUID } from 'node:crypto';
import { discover, selectTarget, CdpConnection, FrameContexts } from '../../packages/browser-control/cdp.js';
import { probeExpression } from '../../packages/browser-control/native-probe.js';

export function validateProofConfig(config) {
  if (!config || !Array.isArray(config.sources) || config.sources.length !== 2) throw new Error('The proof requires exactly two source documents.');
  if (!Number.isFinite(config.gap ?? 120) || (config.gap ?? 120) < 0 || (config.gap ?? 120) > 10000) throw new Error('gap must be between 0 and 10000 pixels.');
  for (const source of config.sources) {
    if (typeof source.id !== 'string' || typeof source.urlPrefix !== 'string' || typeof source.selector !== 'string' || !source.selector.trim()) throw new Error('Each source needs id, urlPrefix, and a native root selector.');
    const url = new URL(source.urlPrefix);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || source.urlPrefix.length < url.origin.length) throw new Error('Source URL prefixes must include an HTTP(S) origin.');
  }
  if (new Set(config.sources.map((s) => s.id)).size !== 2) throw new Error('Source IDs must be distinct.');
}

/** One pair only; leave styles visible until explicit restoration or disconnect. */
export async function runNativeProof(config) {
  validateProofConfig(config);
  const { version, targets } = await discover(config.endpoint);
  const target = selectTarget(targets, config);
  const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
  const frames = new FrameContexts(connection);
  const token = randomUUID();
  const selected = [];
  const report = { kind: 'native-pair-capability-proof', status: 'running', browser: version.Browser, protocolVersion: version['Protocol-Version'], targetId: target.id, gap: config.gap ?? 120, sources: [], limitations: ['One static native box per source; not a chat adapter or compositor.', 'Geometry alone does not verify rendered alpha or OBS output.'] };
  async function restore() {
    const results = await Promise.allSettled(selected.map(({ context }) => frames.evaluate(context, probeExpression({ operation: 'restore', token }))));
    frames.stop();
    connection.close();
    return results.map((result) => result.status === 'fulfilled' ? result.value : { restored: false, reason: result.reason.message });
  }
  try {
    await frames.start();
    // Runtime.enable reports existing contexts; auto-attachment may finish asynchronously.
    const deadline = Date.now() + 5000;
    let found;
    while (Date.now() < deadline) {
      await frames.settle();
      const documents = [];
      for (const context of frames.contexts.values()) {
        const info = await frames.evaluate(context, '({url: location.href, topLevel: window === top})').catch(() => null);
        if (info) documents.push({ context, ...info });
      }
      found = config.sources.map((source) => documents.filter((doc) => !doc.topLevel && doc.url.startsWith(source.urlPrefix)));
      if (found.every((matches) => matches.length > 0)) break;
      if (frames.errors.length) throw new Error(frames.errors.join('; '));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!found?.every((matches) => matches.length === 1)) throw new Error('Expected exactly one native frame context for each source. Check frame loading and URL prefixes.');
    if (found[0][0].context === found[1][0].context) throw new Error('Sources must resolve to separate native documents.');
    for (let i = 0; i < config.sources.length; i += 1) {
      const context = found[i][0].context;
      const entry = { context, source: config.sources[i] };
      selected.push(entry);
      entry.measured = await frames.evaluate(context, probeExpression({ operation: 'measure', selector: entry.source.selector, token }));
    }
    let y = 12;
    for (const entry of selected) {
      const placement = await frames.evaluate(entry.context, probeExpression({ operation: 'place', token, y, width: entry.measured.viewport.width }));
      if (Math.abs(placement.y - y) > 1 || placement.width <= 0 || placement.height <= 0 || !placement.sameNativeNode || !placement.sameDescendants) throw new Error(`Native placement failed for ${entry.source.id}.`);
      if (placement.y + placement.height > entry.measured.viewport.height) throw new Error(`The pair does not fit the ${entry.source.id} frame; increase the viewport or reduce the gap.`);
      report.sources.push({ id: entry.source.id, sessionType: entry.context.sessionId ? 'iframe-target' : 'page-context', measured: entry.measured, placement });
      y += placement.height + report.gap;
    }
    report.status = 'geometry-passed';
    return { report, restore, connection, frames, selected, token };
  } catch (error) {
    const cleanup = await restore();
    error.proofReport = { ...report, status: 'blocked', reason: error.message, cleanup };
    throw error;
  }
}
