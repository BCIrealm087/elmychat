import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NativeCoordinator, validateRuntimeConfig, validateSpacingCommand } from './runtime.js';
import { discover } from '../../../packages/browser-control/cdp.js';

export function normalizeOperatorConfig(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Source settings are required.');
  const channel = typeof input.channel === 'string' ? input.channel.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) throw new TypeError('Enter a Twitch channel name (1–25 letters, numbers or underscores).');
  let videoId = typeof input.videoId === 'string' ? input.videoId.trim() : '';
  if (videoId.length > 1024) throw new TypeError('YouTube input is too long.');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    let url;
    try { url = new URL(videoId); } catch { throw new TypeError('Enter an 11-character YouTube video ID or video URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) throw new TypeError('Use a YouTube video ID or an HTTPS YouTube video URL.');
    videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.startsWith('/live/') ? url.pathname.slice(6) : '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId ?? '')) throw new TypeError('This URL does not identify a YouTube video.');
  }
  const debugPort = input.debugPort ?? 9222;
  const gap = input.gap ?? 12;
  if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) throw new RangeError('OBS debugging port must be 1..65535.');
  validateSpacingCommand({ type: 'gap', height: gap });
  const targetId = input.targetId === '' ? undefined : input.targetId ?? undefined;
  if (targetId !== undefined && (typeof targetId !== 'string' || !targetId.length || targetId.length > 512)) throw new TypeError('Invalid selected Browser Source.');
  return { channel, videoId, debugPort, gap, ...(targetId ? { targetId } : {}) };
}

export function sourceUrls(config, hostname = '127.0.0.1') {
  if (!config) return [];
  const parent = encodeURIComponent(hostname);
  return [
    { id: 'twitch', title: 'Native Twitch chat', url: `https://www.twitch.tv/embed/${config.channel}/chat?parent=${parent}` },
    { id: 'youtube', title: 'Native YouTube live chat', url: `https://www.youtube.com/live_chat?v=${config.videoId}&embed_domain=${parent}` },
  ];
}

export function operatorRuntimeConfig(config, overlayUrl) {
  return validateRuntimeConfig({
    endpoint: `http://127.0.0.1:${config.debugPort}`, targetUrl: overlayUrl, ...(config.targetId ? { targetId: config.targetId } : {}), gap: config.gap,
    sources: [
      { id: 'twitch', platform: 'twitch', urlPrefix: `https://www.twitch.tv/embed/${config.channel}/chat` },
      { id: 'youtube', platform: 'youtube', urlPrefix: `https://www.youtube.com/live_chat?v=${config.videoId}` },
    ],
  });
}

async function saveAtomic(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

/** Owns persisted settings and serial operator actions; CDP remains in runtime. */
export class OperatorController {
  #config = null;
  #enabled = false;
  #legacy = null;
  #runtime;
  #lastHealth = { status: 'idle', chatConnected: false, sources: [], lastError: null, cleanup: [] };
  #queue = Promise.resolve();
  #pending = 0;
  #closing = false;
  #revision = 0;
  #save;
  #create;
  #discover;

  constructor({ statePath, overlayUrl = 'http://127.0.0.1:3210/overlay', createRuntime = (config) => new NativeCoordinator(config), save = saveAtomic, discoverTargets = discover } = {}) {
    this.statePath = statePath;
    this.overlayUrl = overlayUrl;
    this.#create = createRuntime;
    this.#save = save;
    this.#discover = discoverTargets;
  }

  async load(legacyConfig) {
    if (legacyConfig) { this.#legacy = validateRuntimeConfig(legacyConfig); this.#enabled = true; this.#runtime = this.#create(this.#legacy); return; }
    let state;
    try { state = JSON.parse(await readFile(this.statePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw new Error(`Saved operator settings could not be read: ${error.message}`); }
    if (state.version !== 1 || typeof state.enabled !== 'boolean') throw new Error('Unsupported operator settings file.');
    this.#config = normalizeOperatorConfig(state.config);
    this.#enabled = state.enabled;
    if (this.#enabled) this.#runtime = this.#create(operatorRuntimeConfig(this.#config, this.overlayUrl));
  }

  #exclusive(operation) {
    if (this.#closing) return Promise.reject(new Error('Coordinator is shutting down.'));
    if (this.#pending >= 8) return Promise.reject(new Error('Too many pending operator actions.'));
    this.#pending += 1;
    const next = this.#queue.then(operation);
    this.#queue = next.catch(() => {});
    return next.finally(() => { this.#pending -= 1; });
  }

  #persist(config = this.#config, enabled = this.#enabled) {
    return this.#save(this.statePath, { version: 1, config, enabled });
  }

  health() { return this.#runtime?.diagnostics() ?? this.#lastHealth; }
  state() {
    const health = this.health();
    return {
      configured: !!this.#config || !!this.#legacy, legacy: !!this.#legacy, enabled: this.#enabled, config: this.#config, revision: this.#revision,
      overlayUrl: this.overlayUrl, gap: this.#runtime?.config.gap ?? this.#config?.gap ?? this.#legacy?.gap ?? 12,
      status: health.status, chatConnected: health.chatConnected, lastError: health.lastError, sources: health.sources,
      spacers: (health.layout?.spacers ?? []).map(({ spacerId, height }) => ({ spacerId, height })), cleanup: health.cleanup,
    };
  }
  overlay(hostname) { return { revision: this.#revision, sources: sourceUrls(this.#config, hostname) }; }
  async tick() { if (this.#runtime) return this.#runtime.step(); return this.health(); }

  configure(input) {
    const config = normalizeOperatorConfig(input);
    return this.#exclusive(async () => {
      // A failed disk write leaves the currently working session untouched.
      await this.#persist(config, true);
      if (this.#runtime) this.#lastHealth = await this.#runtime.stop();
      this.#config = config; this.#legacy = null; this.#enabled = true; this.#revision += 1;
      this.#runtime = this.#create(operatorRuntimeConfig(config, this.overlayUrl));
      return this.state();
    });
  }
  connect() {
    return this.#exclusive(async () => {
      if (!this.#config && !this.#legacy) throw new Error('Save your source settings first.');
      if (!this.#runtime) {
        if (this.#config) await this.#persist(this.#config, true);
        this.#enabled = true;
        this.#runtime = this.#create(this.#legacy ?? operatorRuntimeConfig(this.#config, this.overlayUrl));
      }
      return this.state();
    });
  }
  disconnect() {
    return this.#exclusive(async () => {
      if (this.#config) await this.#persist(this.#config, false);
      if (this.#runtime) this.#lastHealth = await this.#runtime.stop();
      this.#runtime = undefined; this.#enabled = false;
      return this.state();
    });
  }
  spacing(input) {
    const command = validateSpacingCommand(input);
    return this.#exclusive(async () => {
      if (!this.#runtime) throw new Error('Connect the coordinator before changing live spacing.');
      const oldGap = this.#runtime.config.gap;
      const result = await this.#runtime.control(command);
      if (command.type === 'gap') {
        if (this.#config) {
          const config = { ...this.#config, gap: command.height };
          try { await this.#persist(config); }
          catch (error) { await this.#runtime.control({ type: 'gap', height: oldGap }); throw error; }
          this.#config = config;
        } else this.#legacy.gap = command.height;
      }
      return { ...this.state(), changed: result.entry ? { spacerId: result.entry.spacerId, height: result.entry.height } : null };
    });
  }
  async targets() {
    if (this.#closing) throw new Error('Coordinator is shutting down.');
    const endpoint = this.#legacy?.endpoint ?? `http://127.0.0.1:${this.#config?.debugPort ?? 9222}`;
    const { targets } = await this.#discover(endpoint);
    const targetUrl = this.#legacy?.targetUrl ?? this.overlayUrl;
    return targets.filter((target) => target.url === targetUrl).map(({ id, title, url }) => ({ id, title, url }));
  }
  async close() {
    this.#closing = true;
    await this.#queue;
    if (this.#runtime) this.#lastHealth = await this.#runtime.stop();
    this.#runtime = undefined;
    return this.health();
  }
}
