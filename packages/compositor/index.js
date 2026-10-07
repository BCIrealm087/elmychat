const MAX_PIXELS = 1_000_000;

function id(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new TypeError(`${name} must be a nonempty string of at most 512 characters.`);
  return value;
}

function pixels(value, name, positive = false) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0) || value > MAX_PIXELS) throw new RangeError(`${name} must be ${positive ? 'positive' : 'nonnegative'} and at most ${MAX_PIXELS} pixels.`);
  return value;
}

function limit(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} must be an integer from 1 to ${maximum}.`);
  return value;
}

function viewport(value) {
  return { width: pixels(value?.width, 'viewport.width'), height: pixels(value?.height, 'viewport.height') };
}

function identity(value) {
  return {
    sourceId: id(value?.sourceId, 'sourceId'),
    sessionId: id(value?.sessionId, 'sessionId'),
    messageId: id(value?.messageId, 'messageId'),
  };
}

function dimensions(value) {
  return { width: pixels(value?.width, 'width', true), height: pixels(value?.height, 'height') };
}

function sameMessage(entry, address) {
  return entry.kind === 'message' && entry.sourceId === address.sourceId && entry.sessionId === address.sessionId && entry.messageId === address.messageId;
}

function rejected(reason) { return { accepted: false, reason, removed: [] }; }
function removed(entry, reason) { return { ...entry, reason }; }

/** Serializable layout state only. The future coordinator owns this instance. */
export class Compositor {
  #viewport;
  #gap;
  #maxEntries;
  #maxSources;
  #sources = new Map();
  #entries = [];
  #nextSequence = 1;

  constructor({ viewport: size, gap = 0, maxEntries = 500, maxSources = 16 } = {}) {
    this.#viewport = viewport(size);
    this.#gap = pixels(gap, 'gap');
    this.#maxEntries = limit(maxEntries, 'maxEntries', 10_000);
    this.#maxSources = limit(maxSources, 'maxSources', 64);
  }

  get size() { return this.#entries.length; }
  get sourceCount() { return this.#sources.size; }

  // Activation is an explicit coordinator action, never inferred from reports.
  activateSource(sourceId, sessionId) {
    id(sourceId, 'sourceId');
    id(sessionId, 'sessionId');
    if (!this.#sources.has(sourceId) && this.#sources.size >= this.#maxSources) throw new RangeError('Source limit reached; retire a source first.');
    if (this.#sources.get(sourceId) === sessionId) return { accepted: true, removed: [] };
    const retired = this.#entries.filter((entry) => entry.kind === 'message' && entry.sourceId === sourceId);
    this.#entries = this.#entries.filter((entry) => entry.kind !== 'message' || entry.sourceId !== sourceId);
    this.#sources.set(sourceId, sessionId);
    return { accepted: true, removed: retired.map((entry) => removed(entry, 'session-replaced')) };
  }

  retireSource(sourceId, sessionId) {
    id(sourceId, 'sourceId');
    id(sessionId, 'sessionId');
    if (this.#sources.get(sourceId) !== sessionId) return rejected('stale-session');
    const retired = this.#entries.filter((entry) => entry.kind === 'message' && entry.sourceId === sourceId);
    this.#entries = this.#entries.filter((entry) => entry.kind !== 'message' || entry.sourceId !== sourceId);
    this.#sources.delete(sourceId);
    return { accepted: true, removed: retired.map((entry) => removed(entry, 'source-retired')) };
  }

  #admit(entry) {
    if (!Number.isSafeInteger(this.#nextSequence)) throw new RangeError('Arrival sequence exhausted; create a new compositor.');
    const added = { ...entry, sequence: this.#nextSequence++ };
    this.#entries.push(added);
    const evicted = this.#entries.length > this.#maxEntries ? [this.#entries.shift()] : [];
    return { accepted: true, inserted: true, entry: { ...added }, removed: evicted.map((value) => removed(value, 'history-limit')) };
  }

  addMessage(value) {
    const address = identity(value);
    if (this.#sources.get(address.sourceId) !== address.sessionId) return rejected('stale-session');
    const existing = this.#entries.find((entry) => sameMessage(entry, address));
    if (existing) return { accepted: true, inserted: false, entry: { ...existing }, removed: [] };
    const size = dimensions(value);
    const receivedAtMs = value.receivedAtMs ?? 0;
    if (!Number.isFinite(receivedAtMs) || receivedAtMs < 0) throw new RangeError('receivedAtMs must be finite and nonnegative.');
    return this.#admit({ kind: 'message', ...address, ...size, receivedAtMs });
  }

  resizeMessage(value) {
    const address = identity(value);
    if (this.#sources.get(address.sourceId) !== address.sessionId) return rejected('stale-session');
    const entry = this.#entries.find((candidate) => sameMessage(candidate, address));
    if (!entry) return rejected('unknown-message');
    Object.assign(entry, dimensions(value));
    return { accepted: true, entry: { ...entry }, removed: [] };
  }

  removeMessage(value) {
    const address = identity(value);
    if (this.#sources.get(address.sourceId) !== address.sessionId) return rejected('stale-session');
    const index = this.#entries.findIndex((entry) => sameMessage(entry, address));
    if (index === -1) return rejected('unknown-message');
    return { accepted: true, removed: [removed(this.#entries.splice(index, 1)[0], 'message-removed')] };
  }

  // Global spacers have their own identity namespace and remain on source retirement.
  setSpacer({ spacerId, height } = {}) {
    id(spacerId, 'spacerId');
    pixels(height, 'height');
    const entry = this.#entries.find((candidate) => candidate.kind === 'spacer' && candidate.spacerId === spacerId);
    if (!entry) return this.#admit({ kind: 'spacer', spacerId, height });
    entry.height = height;
    return { accepted: true, inserted: false, entry: { ...entry }, removed: [] };
  }

  removeSpacer(spacerId) {
    id(spacerId, 'spacerId');
    const index = this.#entries.findIndex((entry) => entry.kind === 'spacer' && entry.spacerId === spacerId);
    if (index === -1) return rejected('unknown-spacer');
    return { accepted: true, removed: [removed(this.#entries.splice(index, 1)[0], 'spacer-removed')] };
  }

  setViewport(size) { this.#viewport = viewport(size); }
  setGap(gap) { this.#gap = pixels(gap, 'gap'); }

  entries() { return this.#entries.map((entry) => ({ ...entry })); }

  layout() {
    const { width, height } = this.#viewport;
    // A spacer replaces the normal gap; consecutive spacers add their heights.
    const gapBefore = (index) => index > 0 && this.#entries[index - 1].kind === 'message' && this.#entries[index].kind === 'message' ? this.#gap : 0;
    const contentHeight = this.#entries.reduce((total, entry, index) => total + gapBefore(index) + entry.height, 0);
    let y = height - contentHeight;
    const placements = [];
    const spacers = [];
    for (let index = 0; index < this.#entries.length; index += 1) {
      const entry = this.#entries[index];
      y += gapBefore(index);
      const rect = { x: 0, y, width, height: entry.height };
      const top = Math.max(0, y);
      const clippedHeight = Math.max(0, Math.min(height, y + entry.height) - top);
      if (entry.kind === 'spacer') {
        spacers.push({ ...entry, rect });
      } else {
        const needsMeasurement = entry.width !== width;
        const visible = width > 0 && clippedHeight > 0 && !needsMeasurement;
        placements.push({
          ...entry,
          rect,
          needsMeasurement,
          visible,
          // Intersection in viewport coordinates; adapters must implement clipping.
          clip: visible ? { x: 0, y: top, width, height: clippedHeight } : null,
        });
      }
      y += entry.height;
    }
    return { viewport: { ...this.#viewport }, measurementWidth: width, contentHeight, placements, spacers };
  }
}
