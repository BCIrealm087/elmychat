# Compositor core

`index.js` implements pure JavaScript state and layout. It accepts serializable measurements and identities, never DOM nodes, platform selectors, message text, or HTML. The coordinator will own one instance; adapters will measure and apply its output in their original documents. It is not yet connected to the OBS probe or overlay.

```js
import { Compositor } from './index.js';

const core = new Compositor({
  viewport: { width: 420, height: 800 },
  gap: 8,
  maxEntries: 500,
  maxSources: 16,
});
core.activateSource('twitch:channel', 'generation-1');
core.activateSource('youtube:video', 'generation-1');
core.addMessage({
  sourceId: 'twitch:channel', sessionId: 'generation-1', messageId: 'native-1',
  width: 420, height: 40, receivedAtMs: 1000,
});
core.setSpacer({ spacerId: 'pause', height: 120 });
core.addMessage({
  sourceId: 'youtube:video', sessionId: 'generation-1', messageId: 'native-2',
  width: 420, height: 32, receivedAtMs: 1000,
});
const layout = core.layout();
// Message tops: 608 and 768, with exactly 120px between their boxes.
```

## Arrival and identity

First admission assigns a monotonic sequence shared by messages and spacers. Receipt timestamps are diagnostic only (default 0); equal or reversed clocks do not change order. A duplicate `addMessage` for a retained identity is idempotent and ignores its new measurement. Use `resizeMessage` to update dimensions without changing sequence or receipt time. The core is the coordinator's sequencing component; no sequence supplied by a caller is trusted. Existing chat batches must be admitted in the adapter's documented source order; historical cross-platform ordering is not inferred.

A message identity is the full `(sourceId, sessionId, messageId)` tuple. Source activation is an explicit coordinator action. It replaces the previous session and removes its messages; incoming reports never activate a session. Stale arrivals, resizes, removals, and retirement requests return `accepted: false` with `stale-session`. `resizeMessage` cannot insert a missing/evicted message. Adapters must assign a new message identity when a native root is recycled and the coordinator must assign a fresh session ID on reattachment. Do not reactivate an old session from a report.

## Layout and measurement

All entries are bottom aligned in one viewport, oldest first and newest last. Short content leaves empty space above; overflow extends above y=0. The full message rectangle may have a negative top. A message intersecting the viewport is visible and has a `clip` rectangle in viewport coordinates; a wholly offscreen, zero-height, or stale-width message has `visible: false` and `clip: null`. Adapters must implement hiding/clipping; these results do not themselves paint or alter CSS.

The `width` in a message report is the shared placement width at which its native height was measured. `layout().measurementWidth` tells adapters the required width. Positions use that width without scaling message content. `setViewport` with a different width flags unmatched messages with `needsMeasurement: true` and hides them until `resizeMessage` reports a measurement at the new width. Cached heights temporarily reserve estimated space during remeasurement. Changing only viewport height recalculates positions without invalidating measurements. A zero-sized viewport is allowed and hides messages; a message measurement must have positive width.

`gap` applies only between adjacent messages. Explicit spacer entries replace that gap, including a zero-height spacer; consecutive spacers add their heights. Leading/trailing spacers reserve space too. `setSpacer` appends a new spacer or changes a retained spacer in place. Spacers are global and survive source retirement. `removeSpacer` restores adjacency, so the normal message gap then applies. Automatic gaps are computed, not retained entries.

## API and lifecycle

| Method | Behavior |
| --- | --- |
| `activateSource(sourceId, sessionId)` | Register/replace a source generation; same generation is idempotent |
| `retireSource(sourceId, sessionId)` | Remove only the matching generation and its messages |
| `addMessage(report)` | Admit a new native identity; retained duplicates do not reorder |
| `resizeMessage(report)` | Update an existing identity's width/height |
| `removeMessage(identity)` | Retire a native message and close its layout space |
| `setSpacer({ spacerId, height })` | Append or resize a global transparent spacer |
| `removeSpacer(spacerId)` | Remove a retained spacer |
| `setViewport({ width, height })` / `setGap(pixels)` | Validate and update layout configuration |
| `entries()` / `layout()` | Return fresh serializable snapshots |
| `size` / `sourceCount` | Current retained entry / active source counts |

Entry mutations return `accepted`, optional `entry`/`inserted`, and `removed`. Removal records include the full identity/sequence and a reason (`history-limit`, `session-replaced`, `source-retired`, `message-removed`, or `spacer-removed`). The coordinator must consume them to hide/retire adapter roots, including history evictions; their absence from the next layout is not a CSS hide command. Unknown resize/removal operations are rejected without recreating an entry.

The core retains at most `maxEntries` messages and spacers together and evicts oldest first, including offscreen entries. It retains at most `maxSources` active source sessions. It keeps no unbounded tombstone archive: deduplication covers retained identities, not every identity ever seen. The coordinator/adapter must retire evicted identities and avoid reporting them as new arrivals. Iteration and snapshot size are O(retained entries), capped at 10,000 entries / 64 sources; defaults are 500 / 16. No queues, timers, native references, dependencies, or persistence are introduced.

Pixels must be finite and nonnegative (positive for message measurement width), capped at 1,000,000 per dimension/gap/spacer; fractions are supported. IDs are nonempty strings of at most 512 characters. Invalid configuration/measurements throw before changing state. Source-capacity exhaustion throws rather than silently retiring another source. Sequences never reset on removal; numeric sequence exhaustion rejects admission. Returned snapshots cannot mutate retained state.

## Verification

The 12 compositor tests run with `npm test` / `npm run check`, covering ordering and clock ties, spacing, clipping, resize invalidation, session retirement, removals, bounded history, validation, snapshot isolation, and a deterministic 1,500-operation geometry exercise. A separate 2,000-arrival test verifies retention/eviction. Local syntax checks and all 16 Node tests passed. [CI run 37569927744](https://github.com/BCIrealm087/elmychat/actions/runs/37569927744), code commit `cf7aa59`, passed `npm run check:all` on Windows and Linux on 2026-10-07 UTC, including all 16 Node tests and both existing browser proof tests.

See [architecture](../../docs/architecture.md) and [roadmap](../../docs/roadmap.md). Live native survival, DOM observation, and actual viewport clipping remain adapter/coordinator work. Step 2 adds no new manual OBS check.
