import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compositor } from '../packages/compositor/index.js';

function create(options = {}) {
  const core = new Compositor({ viewport: { width: 420, height: 300 }, ...options });
  core.activateSource('twitch', 't1');
  core.activateSource('youtube', 'y1');
  return core;
}

function message(messageId, height = 30, overrides = {}) {
  return { sourceId: 'twitch', sessionId: 't1', messageId, width: 420, height, receivedAtMs: 100, ...overrides };
}

function position(core, messageId) { return core.layout().placements.find((entry) => entry.messageId === messageId); }
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }

test('arrival order wins over equal/reversed clocks and duplicate arrivals keep identity and position', () => {
  const core = create();
  const first = core.addMessage(message('same', 30, { receivedAtMs: 200 }));
  core.addMessage(message('same', 40, { sourceId: 'youtube', sessionId: 'y1', receivedAtMs: 200 }));
  core.addMessage(message('third', 20, { receivedAtMs: 1 }));
  const duplicate = core.addMessage(message('same', 999, { receivedAtMs: 0, sequence: -5 }));
  assert.equal(duplicate.inserted, false);
  assert.deepEqual(duplicate.entry, first.entry);
  assert.deepEqual(core.layout().placements.map((entry) => [entry.sourceId, entry.messageId, entry.rect.y]), [
    ['twitch', 'same', 210], ['youtube', 'same', 240], ['twitch', 'third', 280],
  ]);
  assert.equal(core.size, 3);
});

test('bottom alignment and explicit spacers provide exact empty space without double-counting the normal gap', () => {
  const core = create({ gap: 10 });
  core.addMessage(message('a', 20));
  core.addMessage(message('b', 30));
  core.setSpacer({ spacerId: 'pause', height: 120 });
  core.addMessage(message('c', 40));
  const layout = core.layout();
  assert.equal(layout.contentHeight, 220);
  assert.deepEqual(layout.placements.map((entry) => entry.rect.y), [80, 110, 260]);
  assert.equal(position(core, 'c').rect.y - (position(core, 'b').rect.y + 30), 120);
  assert.deepEqual(layout.spacers[0].rect, { x: 0, y: 140, width: 420, height: 120 });
  core.setSpacer({ spacerId: 'tail', height: 25 });
  assert.equal(position(core, 'c').rect.y + 40, 275);
  core.setSpacer({ spacerId: 'pause', height: 0 });
  assert.equal(position(core, 'c').rect.y - (position(core, 'b').rect.y + 30), 0);
  core.removeSpacer('pause');
  assert.equal(position(core, 'c').rect.y - (position(core, 'b').rect.y + 30), 10);
});

test('leading/consecutive spacers and fractional sizes retain their own height and order', () => {
  const core = create({ viewport: { width: 420, height: 200 }, gap: 7.5 });
  core.setSpacer({ spacerId: 'leading', height: 9.25 });
  core.addMessage(message('a', 20.5));
  core.setSpacer({ spacerId: 'one', height: 10.25 });
  core.setSpacer({ spacerId: 'two', height: 11.75 });
  core.addMessage(message('b', 30.5));
  assert.equal(core.layout().contentHeight, 82.25);
  assert.equal(position(core, 'b').rect.y, 169.5);
  assert.equal(position(core, 'b').rect.y - (position(core, 'a').rect.y + 20.5), 22);
  assert.equal(core.layout().spacers[0].rect.y, 117.75);
});

test('overflow returns exact viewport intersections, hides offscreen boxes and clips an oversized newest message', () => {
  const core = create({ viewport: { width: 420, height: 100 } });
  core.addMessage(message('offscreen', 40));
  core.addMessage(message('partial', 80));
  core.addMessage(message('newest', 60));
  assert.equal(position(core, 'offscreen').visible, false);
  assert.equal(position(core, 'offscreen').clip, null);
  assert.deepEqual(position(core, 'partial').clip, { x: 0, y: 0, width: 420, height: 40 });
  assert.deepEqual(position(core, 'newest').clip, { x: 0, y: 40, width: 420, height: 60 });
  core.resizeMessage(message('newest', 250));
  assert.equal(position(core, 'newest').rect.y, -150);
  assert.deepEqual(position(core, 'newest').clip, { x: 0, y: 0, width: 420, height: 100 });
  assert.equal(position(core, 'partial').visible, false);
});

test('height changes and removals relayout without changing arrival order or resurrecting missing messages', () => {
  const core = create({ gap: 5 });
  const a = core.addMessage(message('a', 20)).entry;
  core.addMessage(message('b', 30));
  core.addMessage(message('c', 40));
  const resized = core.resizeMessage(message('a', 50, { receivedAtMs: 9999 }));
  assert.equal(resized.entry.sequence, a.sequence);
  assert.equal(resized.entry.receivedAtMs, 100);
  assert.deepEqual(core.layout().placements.map((entry) => entry.rect.y), [170, 225, 260]);
  assert.equal(core.removeMessage(message('b')).removed[0].messageId, 'b');
  assert.deepEqual(core.layout().placements.map((entry) => entry.rect.y), [205, 260]);
  assert.equal(core.resizeMessage(message('b', 100)).reason, 'unknown-message');
  assert.equal(core.removeMessage(message('b')).accepted, false);
  core.setGap(15);
  assert.equal(position(core, 'a').rect.y, 195);
});

test('width changes require fresh measurements, while height-only resizing retains valid measurements', () => {
  const core = create();
  core.addMessage(message('a', 40));
  core.addMessage(message('b', 60));
  core.setViewport({ width: 300, height: 150 });
  assert.equal(core.layout().measurementWidth, 300);
  assert.equal(position(core, 'a').needsMeasurement, true);
  assert.equal(position(core, 'a').visible, false);
  assert.equal(position(core, 'a').clip, null);
  core.resizeMessage(message('b', 80, { width: 300 }));
  assert.equal(position(core, 'b').needsMeasurement, false);
  assert.deepEqual(position(core, 'b').rect, { x: 0, y: 70, width: 300, height: 80 });
  core.resizeMessage(message('a', 50, { width: 300 }));
  assert.equal(position(core, 'a').visible, true);
  core.setViewport({ width: 300, height: 200 });
  assert.equal(position(core, 'a').needsMeasurement, false);
  assert.equal(position(core, 'b').rect.y, 120);
});

test('collapsed viewports and zero-height messages are retained but never visible', () => {
  const core = create();
  core.addMessage(message('zero', 0));
  core.addMessage(message('box', 50));
  assert.equal(position(core, 'zero').visible, false);
  core.setViewport({ width: 420, height: 0 });
  assert.ok(core.layout().placements.every((entry) => !entry.visible && entry.clip === null));
  core.setViewport({ width: 0, height: 300 });
  assert.ok(core.layout().placements.every((entry) => !entry.visible));
  core.setViewport({ width: 420, height: 300 });
  assert.equal(position(core, 'box').visible, true);
  assert.equal(core.size, 2);
});

test('source generations isolate recycled IDs and reject late reports and retirement without touching the replacement', () => {
  const core = create();
  core.addMessage(message('recycled'));
  core.setSpacer({ spacerId: 'global', height: 120 });
  core.addMessage(message('y', 40, { sourceId: 'youtube', sessionId: 'y1' }));
  const change = core.activateSource('twitch', 't2');
  assert.deepEqual(change.removed.map((entry) => [entry.messageId, entry.reason]), [['recycled', 'session-replaced']]);
  const replacement = core.addMessage(message('recycled', 50, { sessionId: 't2' })).entry;
  for (const operation of ['addMessage', 'resizeMessage', 'removeMessage']) assert.equal(core[operation](message('recycled')).reason, 'stale-session');
  assert.equal(core.retireSource('twitch', 't1').accepted, false);
  assert.deepEqual(core.activateSource('twitch', 't2').removed, []);
  assert.equal(position(core, 'recycled').sequence, replacement.sequence);
  assert.equal(core.retireSource('twitch', 't2').removed[0].reason, 'source-retired');
  assert.equal(core.sourceCount, 1);
  assert.deepEqual(core.entries().map((entry) => entry.kind), ['spacer', 'message']);
});

test('bounded history evicts oldest messages/spacers and exposes removals for adapter cleanup', () => {
  const core = create({ maxEntries: 3 });
  core.addMessage(message('a'));
  core.setSpacer({ spacerId: 'old', height: 120 });
  core.addMessage(message('b'));
  assert.deepEqual(core.addMessage(message('c')).removed.map((entry) => [entry.messageId, entry.reason]), [['a', 'history-limit']]);
  assert.equal(core.resizeMessage(message('a')).reason, 'unknown-message');
  assert.equal(core.setSpacer({ spacerId: 'new', height: 10 }).removed[0].spacerId, 'old');
  const sequence = core.entries().at(-1).sequence;
  for (let index = 0; index < 2000; index += 1) {
    const result = core.addMessage(message(`load-${index}`));
    assert.equal(result.removed.length, 1);
    assert.equal(core.size, 3);
  }
  assert.equal(core.entries().at(-1).sequence, sequence + 2000);
  assert.equal(core.removeSpacer('new').reason, 'unknown-spacer');
});

test('invalid numeric/identity input and source limits fail before mutating valid state', () => {
  const core = create({ maxSources: 2 });
  core.addMessage(message('a'));
  const before = JSON.stringify(core.layout());
  for (const value of [-1, NaN, Infinity, '30', null, 1_000_001]) {
    assert.throws(() => core.resizeMessage(message('a', value)));
    assert.throws(() => core.setSpacer({ spacerId: 'bad', height: value }));
    assert.throws(() => core.setGap(value));
    assert.throws(() => core.setViewport({ width: 420, height: value }));
    assert.equal(JSON.stringify(core.layout()), before);
  }
  for (const value of [0, -1, Infinity, 1_000_001]) assert.throws(() => core.addMessage(message('bad', 30, { width: value })));
  for (const value of ['', ' ', 'x'.repeat(513), null]) assert.throws(() => core.addMessage(message(value)));
  assert.throws(() => core.addMessage(message('bad', 30, { receivedAtMs: -1 })));
  assert.throws(() => core.activateSource('third', 's1'), /Source limit/);
  assert.equal(JSON.stringify(core.layout()), before);
  core.retireSource('youtube', 'y1');
  assert.equal(core.activateSource('third', 's1').accepted, true);
  for (const maxEntries of [0, 1.5, Infinity, 10_001]) assert.throws(() => create({ maxEntries }));
});

test('input and output snapshots cannot mutate internal layout and remain JSON serializable', () => {
  const size = { width: 420, height: 300 };
  const core = create({ viewport: size });
  const input = Object.freeze(message('a', 30));
  const added = core.addMessage(input);
  size.height = 900;
  added.entry.height = 1000;
  const entries = core.entries();
  entries[0].messageId = 'changed';
  const layout = core.layout();
  assert.deepEqual(JSON.parse(JSON.stringify(layout)), layout);
  layout.viewport.width = 1;
  layout.placements[0].rect.y = 9999;
  layout.placements[0].clip.height = 999;
  assert.deepEqual(position(core, 'a').rect, { x: 0, y: 270, width: 420, height: 30 });
});

test('mixed arrivals, resizes, spacers and removals keep ordered, non-overlapping, bounded geometry', () => {
  const core = create({ maxEntries: 40, gap: 3.5 });
  let seed = 17;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 1500; index += 1) {
    const choice = Math.floor(random() * 5);
    const retained = core.entries().filter((entry) => entry.kind === 'message');
    if (choice === 0) core.setSpacer({ spacerId: `gap-${index % 7}`, height: random() * 500 });
    else if (choice === 1 && retained.length) core.resizeMessage({ ...retained[Math.floor(random() * retained.length)], height: random() * 800 });
    else if (choice === 2 && retained.length) core.removeMessage(retained[Math.floor(random() * retained.length)]);
    else core.addMessage(message(`message-${index}`, random() * 800));
    const layout = core.layout();
    const boxes = [...layout.placements, ...layout.spacers].sort((a, b) => a.sequence - b.sequence);
    assert.ok(core.size <= 40);
    for (let item = 0; item < boxes.length; item += 1) {
      const box = boxes[item];
      assert.ok(Number.isFinite(box.rect.y));
      if (item > 0) {
        const previous = boxes[item - 1];
        assert.ok(box.sequence > previous.sequence);
        assert.ok(box.rect.y + 1e-7 >= previous.rect.y + previous.rect.height);
      }
      if (box.visible) {
        assert.ok(box.clip.y >= 0 && box.clip.height > 0);
        assert.ok(box.clip.y + box.clip.height <= layout.viewport.height + 1e-7);
        near(box.clip.height, Math.min(box.rect.y + box.rect.height, 300) - Math.max(box.rect.y, 0));
      }
    }
    if (boxes.length) near(boxes.at(-1).rect.y + boxes.at(-1).rect.height, 300);
  }
});
