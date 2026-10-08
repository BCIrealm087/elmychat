const byId = (id) => document.getElementById(id);
let token;
let state;
let initialized = false;
let busy = false;
let spacerSnapshot;
let emoteSnapshot;
let emotesDirty = false;
let actionRevision = 0;
const emoteChoices = () => ({ sevenTv: byId('seven-tv').checked, betterTtv: byId('better-ttv').checked });
function fillEmotes(config) {
  const choices = config?.emotes ?? { sevenTv: false, betterTtv: false };
  byId('seven-tv').checked = choices.sevenTv;
  byId('better-ttv').checked = choices.betterTtv;
  emoteSnapshot = JSON.stringify(choices); emotesDirty = false;
}
function notice(message, error = false) { byId('notice').textContent = message; byId('notice').classList.toggle('error', error); }
function number(id) { return Number(byId(id).value); }
function fillConfig(config) {
  if (!config) return;
  byId('channel').value = config.channel;
  byId('video').value = config.videoId;
  byId('port').value = config.debugPort;
  const target = byId('target');
  if (config.targetId && ![...target.options].some((option) => option.value === config.targetId)) target.add(new Option('Saved Browser Source selection', config.targetId));
  target.value = config.targetId ?? '';
}
function renderSpacers(spacers) {
  const snapshot = JSON.stringify(spacers);
  if (snapshot === spacerSnapshot || document.activeElement?.closest('#spacers')) return;
  spacerSnapshot = snapshot;
  byId('spacers').replaceChildren();
  byId('empty-spacers').hidden = spacers.length > 0;
  spacers.forEach((spacer, index) => {
    const row = document.createElement('div'); row.className = 'spacer';
    const label = document.createElement('label'); label.textContent = `Spacer ${index + 1}`; label.htmlFor = `spacer-${index}`;
    const input = document.createElement('input'); input.id = label.htmlFor; input.type = 'number'; input.min = '0'; input.max = '10000'; input.step = 'any'; input.value = spacer.height;
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Update';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
    save.addEventListener('click', () => {
      if (!input.reportValidity() || !input.value.length) return;
      void action('/api/spacing', { type: 'spacer-update', spacerId: spacer.spacerId, height: Number(input.value) }, 'Spacer updated.');
    });
    remove.addEventListener('click', () => { void action('/api/spacing', { type: 'spacer-remove', spacerId: spacer.spacerId }, 'Spacer removed.'); });
    row.append(label, input, save, remove); byId('spacers').append(row);
  });
}
function render(next) {
  state = next; token = next.token ?? token;
  byId('status').textContent = next.chatConnected ? 'Chats connected' : next.enabled ? 'Waiting for chats' : 'Disconnected';
  byId('status').dataset.live = String(next.chatConnected);
  byId('overlay-url').value = next.overlayUrl;
  byId('connection-detail').textContent = next.lastError ?? (next.legacy ? 'Using an explicit coordinator config' : next.enabled ? 'Waiting for the configured OBS source, or connected' : 'Save your sources and connect');
  const list = byId('source-status'); list.replaceChildren();
  for (const source of next.sources ?? []) {
    const item = document.createElement('li');
    const title = document.createElement('strong'); title.textContent = source.platform;
    item.append(title, document.createTextNode(` · ${source.status ?? 'waiting'}${source.reason ? ` · ${source.reason}` : ''}${source.trackedRoots !== undefined && source.trackedRoots !== null ? ` · ${source.trackedRoots} native messages` : ''}`)); list.append(item);
  }
  if (!initialized) { fillConfig(next.config); byId('gap').value = next.gap; initialized = true; }
  const savedEmotes = JSON.stringify(next.config?.emotes ?? { sevenTv: false, betterTtv: false });
  if (!emotesDirty && emoteSnapshot !== savedEmotes) fillEmotes(next.config);
  const twitch = next.sources?.find(source => source.platform === 'twitch');
  const choices = next.config?.emotes;
  const providersOn = !!(choices?.sevenTv || choices?.betterTtv);
  const refreshPending = twitch?.refresh && twitch.refresh.status !== 'ready';
  const unavailable = twitch?.enhancement?.status === 'unavailable' || twitch?.refresh?.status === 'unavailable' || twitch?.refresh?.status === 'unconfirmed';
  const status = !next.enabled ? 'Off' : refreshPending ? unavailable ? 'Unavailable' : 'Loading' : !providersOn ? 'Off' : unavailable ? 'Unavailable' : twitch?.enhancement?.status === 'ready' ? 'Ready' : 'Loading';
  byId('emotes-status').textContent = status;
  byId('emotes-status').dataset.live = String(status === 'Ready');
  byId('emotes-detail').textContent = next.legacy ? 'Save your chat sources to use these controls.' : !next.configured ? 'Save your chat sources first.' : !next.enabled ? 'Connect to apply emote choices.' : refreshPending ? unavailable ? 'Twitch refresh could not be confirmed. Retry when the OBS source is available.' : 'Refreshing Twitch…' : unavailable ? 'Emote support could not load in this Twitch session. Check your connection and retry; chat connection status is shown separately.' : status === 'Loading' ? 'Waiting for Twitch emote support…' : status === 'Ready' ? 'Emote support is ready. Available emotes depend on the channel.' : '7TV and BTTV are off.';
  for (const id of ['seven-tv', 'better-ttv']) byId(id).disabled = busy || !next.configured || next.legacy;
  const dirty = JSON.stringify(emoteChoices()) !== savedEmotes;
  byId('apply-emotes').disabled = busy || !next.configured || !next.enabled || next.legacy || !dirty;
  byId('retry-emotes').hidden = !unavailable;
  byId('retry-emotes').disabled = busy || !next.enabled || next.legacy || dirty;
  renderSpacers(next.spacers ?? []);
  byId('connect').disabled = busy || !next.configured || next.enabled;
  byId('disconnect').disabled = busy || !next.enabled;
  for (const form of ['gap-form', 'spacer-form']) for (const element of byId(form).elements) element.disabled = busy || !next.enabled;
  for (const button of byId('spacers').querySelectorAll('button')) button.disabled = busy || !next.enabled;
}
async function json(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Request failed.');
  return value;
}
async function action(path, body, message) {
  if (busy) return;
  busy = true; actionRevision += 1; notice('Applying…'); if (state) render(state); for (const button of document.querySelectorAll('button')) button.disabled = true;
  try {
    const next = await json(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Elmychat-Token': token }, body: JSON.stringify(body) });
    if (path === '/api/config') fillConfig(next.config);
    if (path === '/api/emotes') {
      fillEmotes(next.config);
      const refresh = next.sources?.find(source => source.platform === 'twitch')?.refresh;
      message = refresh?.status === 'unconfirmed' ? 'Emote choices saved; Twitch refresh could not be confirmed.' : 'Emote choices saved. Twitch is refreshing.';
    }
    // Drop focus before rebuilding a spacer row that was edited or removed.
    if (document.activeElement?.closest('#spacers')) document.activeElement.blur();
    spacerSnapshot = undefined;
    notice(message); render(next);
  } catch (error) { notice(error.message, true); }
  finally { busy = false; for (const button of document.querySelectorAll('button')) button.disabled = false; if (state) render(state); }
}
byId('sources-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action('/api/config', { channel: byId('channel').value, videoId: byId('video').value, debugPort: number('port'), gap: state?.gap ?? 12, targetId: byId('target').value }, 'Sources saved. Load the overlay URL in OBS; existing overlays update automatically.');
});
byId('emotes-form').addEventListener('submit', event => { event.preventDefault(); void action('/api/emotes', { emotes: emoteChoices() }, 'Emote choices saved.'); });
byId('retry-emotes').addEventListener('click', () => { void action('/api/emotes', { retry: true }, 'Retrying Twitch emotes.'); });
for (const id of ['seven-tv', 'better-ttv']) byId(id).addEventListener('change', () => { emotesDirty = JSON.stringify(emoteChoices()) !== emoteSnapshot; if (state) render(state); });
byId('gap-form').addEventListener('submit', (event) => { event.preventDefault(); void action('/api/spacing', { type: 'gap', height: number('gap') }, 'Default gap applied.'); });
byId('spacer-form').addEventListener('submit', (event) => { event.preventDefault(); void action('/api/spacing', { type: 'spacer-add', height: number('spacer-height') }, 'Spacer inserted after the current messages.'); });
byId('connect').addEventListener('click', () => { void action('/api/connect', {}, 'Coordinator connecting.'); });
byId('disconnect').addEventListener('click', () => { void action('/api/disconnect', {}, 'Coordinator disconnected; reachable native styles restored.'); });
byId('copy-url').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(byId('overlay-url').value); notice('Overlay URL copied.'); }
  catch { byId('overlay-url').select(); notice('Select and copy the overlay URL.'); }
});
byId('find-targets').addEventListener('click', async () => {
  try {
    const { targets } = await json('/api/targets');
    byId('target').replaceChildren(new Option('Match the overlay URL automatically', ''));
    for (const target of targets) byId('target').add(new Option(`${target.title || 'Elmychat overlay'} · ${target.id}`, target.id));
    byId('target-help').textContent = targets.length ? `${targets.length} matching OBS source(s) found.` : 'No matching source found. Load the overlay URL in OBS and check the saved debugging port.';
  } catch (error) { notice(error.message, true); }
});
async function poll() {
  if (!busy) {
    const revision = actionRevision;
    try { const next = await json('/api/state'); if (!busy && revision === actionRevision) render(next); }
    catch (error) { byId('status').textContent = 'Server unavailable'; notice(error.message, true); }
  }
  setTimeout(poll, 1000);
}
void poll();
