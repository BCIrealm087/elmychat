# Twitch native adapter

`index.js` implements a self-contained browser-injected adapter for native **ordinary text message roots**. It preserves each root and its descendants inside Twitch's document. It observes arrivals/removal/reuse with MutationObserver, measures native height for the current viewport with ResizeObserver, and applies compositor rectangles, hiding and clipping. It does not clone, reparent, render, send, or archive messages. Production coordinator wiring is step 5; the existing static proof command is unchanged.

The lifecycle is now shared with YouTube through `../native-runtime.js`; Twitch discovery and identity policy stay here. A Node factory compiles the runtime and fixed policy into the same dependency-free injectable function, preserving direct browser evaluation and the existing API. Reports additionally carry `messageKind: 'text'` as diagnostic metadata. Discovery admits outermost matched roots, preventing nested copies from becoming separate arrivals. All eight Twitch browser tests passed again on Windows/Linux in [CI run 37617532360](https://github.com/BCIrealm087/elmychat/actions/runs/37617532360), code commit `4d691b4`, verifying this extraction alongside the YouTube suite.

## Injection and report contract

```js
import { twitchAdapterExpression } from './index.js';

// Evaluate through the already selected native Twitch frame's CDP context.
const expression = twitchAdapterExpression({
  sourceId: 'twitch:channel', sessionId: 'fresh-session-generation',
  width: 420, maxRoots: 500, maxReports: 1000,
});
```

Installation returns a serializable confirmation and installs `globalThis.__elmychatTwitchAdapterV1`. A running adapter cannot be replaced implicitly. Stop the old session before installing a new one; every reattachment requires a fresh session ID. `installTwitchAdapter` is also directly evaluable in browser tests. No ordinary parent-page cross-origin access or security bypass is involved.

| Method | Command / result |
| --- | --- |
| `takeReports({ sourceId, sessionId })` | Drain `{ accepted, status, failure, events }`; no text/HTML/platform ID |
| `applyPlacements({ sourceId, sessionId, revision, placements })` | Full source snapshot applied before acknowledgment; absent identities are hidden |
| `setWidth({ sourceId, sessionId, width })` | Positive shared measurement width; hide old placements and report new dimensions |
| `retireMessages({ sourceId, sessionId, messageIds })` | Hide/retire retained native identities after compositor eviction/removal |
| `stop({ sourceId, sessionId })` | Disconnect observers/listeners, cancel scheduled work and restore owned styles |
| `diagnostics()` | Selector, session, status, bounds-related counts, revision, repair/resize/flush totals |

Reports have `type: 'added' | 'resized' | 'removed'`, the full source/session/local-message identity, and either shared `width`/native `height` or a removal `reason`. The coordinator must add its receipt time and admit reports to the compositor in received order. Initial roots and newly discovered roots within a flush are reported in document order; reports across flushes follow observation delivery, not platform send time.

Undrained measurements coalesce per identity, preserving an initial `added` until delivery. An undelivered arrival removed before draining produces no events. Removal supersedes a pending resize. The coordinator must inspect `status` even with an empty batch, and retire the entire source session if the adapter fails/stops. It must process compositor evictions via `retireMessages`, route only this source's placements, and assign increasing safe-integer `revision` values. Old sessions and revisions are rejected before mutation. Visible placements at an obsolete width are rejected; width-zero compositor layouts can hide roots without requesting a zero-width measurement.

## Identity, native changes and bounds

Every discovered root gets a monotonic adapter-local identity. Detachment, losing the selector, changed native `data-id`, or remove/reinsert even within one observer batch retires that identity. A connected replacement/reused root receives a new identity; a placement for a retired ID cannot reach it. `data-id` is an optional native-key heuristic tested synthetically, not confirmed by the live proof. Without that key, child/text replacement conservatively starts a new identity. This may also treat late badge/content insertion as a new arrival; pure sizing/style changes retain identity. Moderation semantics and platform-specific identity refinement remain future work.

Connected coordinator-retired roots stay hidden and are not re-admitted. They remain tracked for safe style repair/restoration until Twitch removes them. Detached roots are restored, unobserved, and released immediately; no detached native archive or unbounded tombstone map is kept. Defaults cap connected tracked roots at 500 and undrained reports at 1000; configuration caps are 1000 / 10,000. Ancestor depth is capped at 64, styled nodes at 4096, inline attribute size at 65,536 characters, and mutation batches at 10,000 records. If a bound or measurement is violated, the adapter fails explicitly, cancels work, restores modified styles, and clears references/reports. It never silently loses a delivered removal to make room in its queue.

Observation work is coalesced into animation frames; placement commands cancel pending frame work and apply their complete snapshot synchronously. Adapter style writes that match the expected attributes do not reschedule mutation work. Native style rewrites trigger repair; ResizeObserver reports delayed emote/font/content sizing. No polling timer or artificial message lifetime is introduced. In inactive/throttled documents, animation-frame delivery can be delayed; coordinator recovery and inactive OBS scenes are step 5 concerns.

## Positioning and restoration

The adapter temporarily hides native chrome through ancestors, clears backgrounds/transforms/clipping on those paths, and hides overflow at the document viewport. Native roots use fixed positions, border-box measurement width, native auto height, and compositor clip intersections. Native child markup is untouched. Unknown, retired, absent, and stale-width identities stay hidden. Absolute pixel clip coordinates keep growing native content inside the last assigned slot until the coordinator delivers updated layout. An owned stylesheet hides outermost supported roots before discovery; inline opacity admits placed roots without suppressing nested native renderers. Reuse detection hides old placements in the mutation observer before paint. Host transitions/animations are disabled during attachment so native movement cannot interpolate through neighboring slots; descendants remain native. Teardown removes the guard and restores host styles. This adapter alone does not perform global ordering or spacing. See [render stability and regression coverage](../../../docs/render-stability.md).

Twitch message boxes now use `min(shared viewport width, 340px)` instead of stretching across the entire OBS source. The 340px reference corresponds to the conventional sidebar baseline; [FrankerFaceZ's chat width implementation](https://github.com/FrankerFaceZ/FrankerFaceZ/blob/master/src/sites/twitch-twilight/modules/chat/index.js) uses 340 as its fallback while recognizing that Twitch's actual right-column width can vary. Twitch's [embed documentation](https://dev.twitch.tv/docs/embed/chat/) permits arbitrary frame widths and does not define a universal character count or ASCII-art format. This is a compatibility reference, not a promise that every user's Twitch settings match 340px.

Wide overlays retain the reference line breaks and leave the remaining horizontal space transparent. Narrower overlays wrap natively at their available width. Native fonts, padding, line height, username/badge prefixes, whitespace and text nodes remain untouched, including U+2800 braille blanks used in ASCII art. No art detection, manual line-break insertion, monospace substitution, or scaling is performed. Customized Twitch fonts, zoom, timestamps, badges and sidebar widths can still change wrapping. YouTube uses its available source width.

Report `width` and placement rectangles continue to address the shared viewport, with native height measured from the narrower Twitch box. The adapter's `diagnostics().messageWidth` exposes the reference wrapping width before any fallback icon gutter. A viewport width change still invalidates old placements and emits new measurements, even when the 340px wrapping width and height stay unchanged. Clipping uses the actual native box width; restoration removes the width override.

`test/fixtures/twitch/ascii-art.html` retains the operator's supplied ten-row E and Unicode blanks in a synthetic sidebar. The browser regression compares native glyph positions, line breaks, text, typography and height before/after composition in two wide viewports, then verifies narrow wrapping, accurate resize reports, clipping, stable identity and full style restoration. It saves `.runtime/proof/twitch-ascii-art.png` with the CI artifacts. Synthetic geometry does not establish exact live Twitch font metrics or OBS screenshot equivalence.

## Platform marks

Every tracked message gets a separate 16px purple Twitch mark, with a subtle dark backing and the accessible label `Twitch message`. The adapter owns a fixed decoration layer attached to the document body. Marks never enter native roots, change their children, or interfere with badge/emote events. A shadow root isolates each bundled SVG from native page styles; there is no image fetch. The SVG source/license is recorded in [THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md).

Rows with at least 20px native left padding keep their original position and wrapping width, placing the mark within that empty gutter. This preserves the supplied E's native glyph geometry, including in a 340px source. Low-padding rows instead shift right by a 20px gutter and measure at `min(shared width - gutter, 340px)`; unusually narrow/customized styles can therefore wrap earlier. No native padding is rewritten. Marks align with the first line, clip to the viewport and message box, and stay hidden for absent/retired/stale placements. Removing a root removes its mark; failure, stop and pagehide remove the layer. Connected retired roots retain hidden marks within the existing root bound. `originMarkers` and `gutterMessages` expose counts in diagnostics, separately from native style ownership.

Owned decoration writes do not recycle unkeyed native identities or schedule observer feedback. Foreign removal/style writes are repaired on the next scheduled flush. SVGs use namespace-aware DOM construction, without HTML string insertion, so native Trusted Types enforcement is supported. The two-platform browser regression enforces that policy and verifies native content/parent identity, visible brand pixels, accessible labels, shadow isolation, idle stability, fallback gutter, clipping/gap alpha, retirement, restoration, reattachment and pagehide; screenshots are included in CI artifacts. The operator confirmed the platform marks work and likes the result on 2026-10-07; live special-host compatibility retains its limits.

Inline attribute snapshots are applied with attribute writes. Untouched native styles restore exactly, including the distinction between no attribute and an empty one. If the platform changes styles while attached, restoration preserves its latest foreign declarations and strips unchanged adapter declarations instead of reverting all platform updates. A foreign write identical to an owned declaration is indistinguishable from the adapter's value; that ownership ambiguity is a limitation. Document removal/pagehide tears down automatically; the future coordinator still owns context retirement and reconnect. No node is recreated to keep a disappeared message visible.

## Selector evidence and support limits

The sole discovery selector is `[data-a-target="chat-line-message"]`. In the operator's 2026-10-07 OBS proof, it matched a Twitch `DIV` with 38 descendants, reported a 783x49.59375 native box, and retained root/descendant identity at placement in CEF `127.0.6533.120` / CDP `1.3`. The screenshot showed native text/badges and transparent scene composition. This is evidence for that selected text root, not for continuous adapter operation. Its short/inconsistent lifetime was recorded in [proof evidence](../../../docs/feasibility-proof.md).

The synthetic fixture deliberately shares the selector and tests native node mechanics; it does not reproduce Twitch's renderer. Subscriptions, notices, raids, rewards, deleted-message placeholders, pinned/special rows, shadow-root messages, and custom extensions are not claimed as supported. The adapter cannot prevent Twitch from removing a node. It detects/removes/re-identifies it and repairs supported style changes. It does not establish the cause of the observed OBS disappearance or guarantee live Twitch stability across versions.

## Verification

Eight browser lifecycle tests cover native identity and pixel alpha, compositor clipping, arrivals/delayed sizing, removal/recycling, unkeyed replacement, style repair/restoration, stale sessions/revisions/widths, retirement and explicit bounds failures, observer disconnect and pagehide. [CI run 37614403981](https://github.com/BCIrealm087/elmychat/actions/runs/37614403981), code commit `97e5c75`, passed `npm run check:all` on Windows and Linux on 2026-10-07 UTC: all 16 Node tests, eight Twitch browser tests and both existing cross-origin proof tests. Synthetic JSON/screenshots are saved under `.runtime/proof/` and included in that run's artifacts.

Local Node/syntax checks passed. The local browser run failed because the pinned executable was absent; the Playwright installer then failed with invalid ZIP responses from its download endpoint. No browser test was skipped or called passing on this basis; rendered/lifecycle verification comes from CI. No new human OBS check is required for this bounded adapter implementation. Step 3 is complete for ordinary text-root lifecycle with the support limits above; bounded live end-to-end Twitch composition, native emotes/alpha, refresh recovery and restoration were operator-confirmed in step 5. Prolonged use and Twitch special rows retain their support limits. See [native evidence](../../../docs/feasibility-proof.md#step-5-continuous-native-observation--2026-10-07).
