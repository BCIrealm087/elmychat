// Source navigation is owned by this dedicated overlay and explicit saved settings.
// The coordinator never navigates an OBS page or operates unrelated targets.
const frames = new Map();
// Only the selected overlay receives this command through its CDP context.
// Polling keeps the assigned URL, including its refresh revision, intact.
globalThis.__elmychatManagedOverlayV1 = Object.freeze({
  twitch(command) {
    const record = frames.get('twitch');
    if (location.href !== command.overlayUrl || !record || record.url !== command.expectedUrl ||
        !record.frame.isConnected || record.frame.getAttribute('src') !== record.assignedUrl) throw new Error('Selected Twitch source changed; wait for the managed overlay.');
    if (command.operation === 'inspect') return { available: true, revision: record.revision ?? null };
    if (command.operation !== 'refresh' || typeof command.revision !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(command.revision)) throw new Error('Invalid Twitch refresh revision.');
    if (record.revision !== command.revision) {
      if ((record.revision ?? null) !== command.previousRevision) throw new Error('Stale Twitch refresh revision.');
      const url = new URL(record.url);
      url.searchParams.set('_elmychatRefresh', command.revision);
      record.frame.src = url.href;
      record.assignedUrl = url.href;
      record.revision = command.revision;
    }
    return { acknowledged: true, revision: record.revision };
  },
});
async function update() {
  try {
    const response = await fetch('/api/overlay', { cache: 'no-store' });
    if (!response.ok) throw new Error('Source settings unavailable.');
    const { sources } = await response.json();
    for (const source of sources) {
      let record = frames.get(source.id);
      if (!record) {
        const frame = document.createElement('iframe'); frame.id = source.id; frame.title = source.title;
        record = { frame, url: null }; frames.set(source.id, record); document.body.append(frame);
      }
      if (record.url !== source.url) {
        record.frame.src = source.url;
        record.url = source.url; record.assignedUrl = source.url; record.revision = undefined;
      }
    }
    for (const [id, record] of frames) if (!sources.some((source) => source.id === id)) { record.frame.remove(); frames.delete(id); }
  } catch { /* Preserve loaded native frames through a temporary server outage. */ }
  setTimeout(update, 2000);
}
void update();
