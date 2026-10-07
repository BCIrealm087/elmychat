# YouTube native adapter

`index.js` supplies YouTube-specific discovery/type/identity policy to the shared native lifecycle in `../native-runtime.js`. It preserves native custom-element hosts, their document/parents/descendants, and their connected lifecycle. It measures and positions original roots without cloning, reparenting or rendering their contents. The end-to-end coordinator is step 5; `proof:native` still runs the static pair probe, not this continuous adapter.

## Native roots and evidence

Discovery is scoped to exactly one `yt-live-chat-item-list-renderer #items` container. No list yet means waiting; multiple matching lists fail explicitly instead of guessing. This candidate scope keeps ticker/pinned copies outside the scrolling list out of the ordered history. Only outermost recognized roots are admitted, so a native renderer nested in a paid card is not a second message.

| `messageKind` | Native root candidate | Evidence / limit |
| --- | --- | --- |
| `text` | `yt-live-chat-text-message-renderer` | Matched the operator's static OBS proof; lifecycle tested synthetically |
| `paid-message` | `yt-live-chat-paid-message-renderer` | Synthetic policy for a paid-message card; live selector unverified |
| `paid-sticker` | `yt-live-chat-paid-sticker-renderer` | Synthetic policy for a sticker card; live selector unverified |
| `membership` | `yt-live-chat-membership-item-renderer` | Synthetic membership-card candidate; live selector unverified |
| `gift-purchase` | `yt-live-chat-sponsorships-gift-purchase-announcement-renderer` | Synthetic gift-announcement candidate; live selector unverified |
| `gift-redemption` | `yt-live-chat-sponsorships-gift-redemption-announcement-renderer` | Synthetic gift-received candidate; live selector unverified |

The operator's 2026-10-07 OBS report matched the text host with 29 descendants, native dimensions 783x32, preserved root/descendant identity and a transparent scene result in CEF `127.0.6533.120` / CDP `1.3`. That report did **not** establish the container selector, host `id` attribute, any special-message selector, or continuous lifecycle support. Short/inconsistent native pair lifetime remains documented in [proof evidence](../../../docs/feasibility-proof.md).

[YouTube's LiveChatMessages reference](https://developers.google.com/youtube/v3/live/docs/liveChatMessages) documents text, paid, sticker, member and membership-gifting event categories; [YouTube Help](https://support.google.com/youtube/answer/7288782?hl=en) describes Supers in the live chat feed. These sources do not publish a DOM-selector contract. The DOM names/scope above are implementation candidates exercised in our synthetic fixtures, not an official API mapping or a claim of current universal support. The adapter does not use that API, reconstruct cards, read amounts/recipients/text, or infer relationships between gift rows.

## Injection and coordinator contract

```js
import { youtubeAdapterExpression } from './index.js';
const expression = youtubeAdapterExpression({
  sourceId: 'youtube:video', sessionId: 'fresh-session-generation',
  width: 420, maxRoots: 500, maxReports: 1000,
});
// Evaluate expression in the explicitly selected native YouTube CDP context.
```

The Node factory compiles the shared runtime and fixed platform policy into one dependency-free function. `installYouTubeAdapter` can also be evaluated directly in a browser test. No browser-side imports, message HTML, ordinary parent cross-origin DOM access, or web-security disable flag is introduced. Installation exposes `globalThis.__elmychatYouTubeAdapterV1`; a running adapter must be stopped before replacement.

| Method | Behavior |
| --- | --- |
| `takeReports({ sourceId, sessionId })` | Drain `{ accepted, status, failure, events }` |
| `applyPlacements({ sourceId, sessionId, revision, placements })` | Full source snapshot of compositor rectangles/intersections; absent IDs are hidden |
| `setWidth({ sourceId, sessionId, width })` | Positive placement measurement width; hide obsolete placements and remeasure |
| `retireMessages({ sourceId, sessionId, messageIds })` | Hide identities evicted/retired by the compositor |
| `stop({ sourceId, sessionId })` | Disconnect observers/listeners, cancel scheduled work and restore styles |
| `diagnostics()` | Scope/selector, waiting/status/failure, session/revision, bounded counts and repair/resize totals |

Events have `type: 'added' | 'resized' | 'removed'`, `sourceId`, `sessionId`, local `messageId`, and `messageKind`. Measurement events add shared `width` and natural `height`; removals add a reason. `messageKind` is diagnostic metadata, not layout policy; the compositor uses the same rectangle contract for every kind. Only source/local identities and geometry cross the boundary, never native key, message text/HTML, shadow contents or payment data.

The coordinator must stamp receipt times, admit events in report order, consume compositor evictions, drain bounded reports, and send increasing positive safe-integer layout revisions for this session. Stale sessions/revisions/visible widths reject before mutation. Unknown/retired IDs cannot place a replacement node. Width-zero compositor layouts may hide roots while retaining the last positive measurement width. Initial/new roots within a flush follow document order, not platform send time. Measurement events coalesce per identity; an undelivered arrival removed before draining creates no ghost message. On adapter failure or stop, retire the whole source session even if the report batch is empty.

## Native lifecycle, styles and bounds

MutationObserver discovers light-DOM hosts and observes removal/reuse/list replacement. Native `id` is the preferred identity-change heuristic, with `data-id` as fallback; neither attribute is live-verified here. Removing/reinserting a host or changing its key gives it a new local identity. Without a key, content replacement conservatively retires/re-admits the host, including content nested in an otherwise supported renderer. This can treat late content insertion as a new arrival. Moving a host out of the selected list retires it with `scope-lost`; it is not re-admitted as a ticker copy.

ResizeObserver measures natural host height, including delayed image/sticker sizing and host-size changes caused by closed-shadow contents. Shadow internals are never traversed or rewritten. A host itself hidden inside a shadow tree cannot be discovered; observing internal shadow changes that do not resize the host is unsupported. The adapter does not move hosts, invoke their connected callbacks, or fabricate a removed native message.

Original child rendering/backgrounds remain native. Owned ancestor styles remove backgrounds, transforms and clipping and hide chrome; roots get fixed positions, shared border-box width, native auto height, visibility and clip intersections. Work coalesces into animation frames, with matching owned style writes ignored by MutationObserver. Foreign style rewrites are repaired and their latest non-owned declarations preserved on restoration. Untouched style attributes restore exactly. A foreign declaration identical to an owned one is indistinguishable; restoration does not guarantee recovery of that intent. Pagehide tears down automatically; navigation/context reconnect remains coordinator work.

Connected retired hosts remain tracked/hidden for repair and teardown until native removal; detached hosts are restored, unobserved and released. Defaults cap roots/reports at 500/1000, with configuration caps 1000/10,000. Shared bounds also cover styled nodes (4096), ancestor depth (64), inline attributes/native keys (65,536 characters) and mutation batches (10,000 records). Overflow, ambiguous scope or invalid measurement fails explicitly, restores modified styles, cancels observers/work and clears retained references/reports. No unbounded native archive, tombstones, polling timer or custom message renderer is introduced.

## Unsupported behavior and verification

Unknown/system/placeholder/deletion rows, polls, engagement notices, jewel/gift animations, ticker/pinned presentation, external menus/popovers, discovery inside shadow roots and live API semantics are unsupported. Known special roots use their measured native card box; the adapter does not recreate paid colors, stickers, badges or membership formatting. It cannot prevent YouTube from deleting a host or prove why messages disappeared in the earlier static probe. Inactive/throttled frames may delay animation-frame work. Continuous live YouTube/OBS behavior and current special-root DOM policies remain unverified.

Nine synthetic browser tests exercise six root kinds, custom-element lifecycle and descendant preservation, transparent gap/clipping pixels, nested/ticker exclusion, native media sizing, list replacement/reuse/removal, closed-shadow host sizing, session/revision/width guards, retirement, style restoration, bounds failures, pagehide and waiting/ambiguous scopes. [CI run 37617532360](https://github.com/BCIrealm087/elmychat/actions/runs/37617532360), code commit `4d691b4`, passed `npm run check:all` on Windows and Linux on 2026-10-07 UTC: all 16 Node tests, nine YouTube browser tests, eight Twitch regression tests and both cross-origin proof tests. Artifacts include `.runtime/proof/youtube-adapter.json` and `.png`.

The fixture shares candidate tags but does not reproduce YouTube's renderer. Local syntax and all 16 Node tests passed, while the local browser run failed because the pinned executable was absent. No browser test was skipped or treated as passed because of that environment failure; rendered/lifecycle verification comes from CI. Step 4 is complete for the bounded candidate-host implementation with the limits above. No new manual OBS check is required. Live special-root compatibility and end-to-end coordinator behavior remain unverified.
