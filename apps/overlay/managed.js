// Source navigation is owned by this dedicated overlay and explicit saved settings.
// The coordinator never navigates an OBS page or operates unrelated targets.
const frames = new Map();
async function update() {
  try {
    const response = await fetch('/api/overlay', { cache: 'no-store' });
    if (!response.ok) throw new Error('Source settings unavailable.');
    const { sources } = await response.json();
    for (const source of sources) {
      let frame = frames.get(source.id);
      if (!frame) { frame = document.createElement('iframe'); frame.id = source.id; frame.title = source.title; frames.set(source.id, frame); document.body.append(frame); }
      if (frame.getAttribute('src') !== source.url) frame.src = source.url;
    }
    for (const [id, frame] of frames) if (!sources.some((source) => source.id === id)) { frame.remove(); frames.delete(id); }
  } catch { /* Preserve loaded native frames through a temporary server outage. */ }
  setTimeout(update, 2000);
}
void update();
