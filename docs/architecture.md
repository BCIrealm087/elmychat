# Proposed native-chat composition

## Objective and status

Preserve native Twitch and YouTube message rendering while presenting one ordered stream with arbitrary transparent gaps in OBS. The HTTP shell, scoped one-pair CDP probe, pure compositor core and both injected adapters are implemented. YouTube supports synthetic policies for text and five special-root candidates; its tests and shared-lifecycle Twitch regressions passed on Windows/Linux. The step 5 coordinator now wires reports, layouts and source generations; its automated browser verification passed on Windows/Linux. The operator confirmed bounded ongoing merged scrolling, native emotes, scene alpha, refresh recovery and graceful restoration. Prolonged stability remains unverified. See [evidence](feasibility-proof.md).

The observed OBS environment exposes both native frames as CDP iframe targets and can render the static pair over a scene source. That bounded result does not establish support across OBS builds or continued rerenders. CDP transports access; the compositor computes layout; adapters maintain native presentation.

## Component boundaries

The next priority after native rendering is optional 7TV/BTTV enhancement inside the Twitch document. The proposed integration uses existing CDP access and a Twitch-specific enhancement lifecycle; third-party code handles emote substitution while Elmychat continues measuring and positioning native hosts. The opt-in [step 8 diagnostic](emote-proof.md) established bounded provider rendering in OBS 32.2.2 / CEF 127 and selects FFZ for lifecycle work. FFZ remounts message hosts inside Twitch's document; retaining the original DOM objects was not achieved. Step 9 now provides an [asynchronous generation-owned lifecycle](twitch-enhancement.md), separate status and one controlled Twitch-only recovery after partial failure. Step 10 adds [bounded renderer identity and enhanced layout](enhanced-content.md); step 11 adds saved provider choices and acknowledged source-only [apply/retry controls](operator-controls.md#twitch-emotes); see [steps 8–13](emote-support-roadmap.md).

| Component | Owns | Must not own |
| --- | --- | --- |
| Coordinator | Local server, selected source sessions, admission into the compositor, lifecycle orchestration | Platform message rendering |
| Browser control | CDP connections, targets, execution contexts, injections and report delivery | Layout policy or site selectors |
| Platform adapter | Native DOM identity, measurement, observers, positioning, teardown | Global cross-platform ordering |
| Compositor | Serializable rectangles, ordering, spacers, clipping and placement | DOM access, platform HTML or emote rendering |
| Overlay | Shared viewport and eventual native source surfaces | Cross-origin frame DOM access from ordinary page JavaScript |

Both source documents occupy the same viewport. Their native message roots remain in their original documents and receive positions from the compositor. A normal parent page cannot directly manipulate cross-origin frame DOM; CDP injection is the proposed access mechanism. Do not disable browser web security as an architectural shortcut.

## Implemented compositor contract

The pure compositor in `packages/compositor/index.js` accepts reports with this shape:

```js
{
  sessionId: 'source-session-generation',
  sourceId: 'twitch:example-channel',
  messageId: 'adapter-local-id',
  receivedAtMs: 0,    // Coordinator receipt time, diagnostic only.
  width: 420,         // Shared placement width at measurement time.
  height: 38
}
```

The first version assigns a monotonic sequence on admission into the coordinator-owned compositor. It orders by report arrival rather than unsynchronized document clocks; it is not platform send time or a guarantee about which DOM node appeared first across asynchronous contexts. Duplicate retained admissions keep their sequence; resize updates cannot insert unknown entries. Initial existing-chat batches need a documented per-source order and receive new sequences on attachment. Cross-platform historical ordering is deferred.

A spacer is a separate bounded entry with a non-negative height. Explicit spacers replace the default gap between messages and never alter message content. Bottom-aligned placements carry session/source/message identity, sequence, a rectangle, a viewport intersection, and a visibility decision. Width changes require remeasurement before showing the affected messages. The compositor rejects reports for obsolete source sessions; adapters must also reject placements for obsolete sessions. No live DOM references cross the process boundary. See the [core API and layout rules](../packages/compositor/README.md).

## Lifecycle and bounds

Adapters need MutationObserver for message changes and ResizeObserver for delayed native sizing. Report width identifies the shared viewport used for placement; measured height reflects the platform's wrapping policy at that viewport. Twitch caps its native message box at a 340px reference sidebar width, while YouTube uses the available shared width. Both reuse native left padding for 16px platform marks; rows with less than 20px padding reserve a separate 20px gutter and measure at the remaining width. The compositor remains independent of these platform policies. Removing or reusing a native root must retire its old identity, except a unique same-flush replacement established by the Twitch renderer reader. That bounded handoff retains the entry; ambiguous, unkeyed or previously removed roots are not matched. Navigation, frame destruction, and adapter reattachment must invalidate the old source session so stale placements cannot affect replacement nodes.

Platform marks live in one adapter-owned decoration layer per native document, with at most one mark per tracked root. They never enter native message elements or their shadow trees. Bundled SVGs use isolated shadow roots, platform colors, labels and a compact dark backing; no network image or page stylesheet dependency is added. Marks follow source/session visibility and viewport/message clipping, remain pointer-transparent and disappear on removal or teardown. Decoration mutations are excluded from native identity detection while foreign style/removal writes trigger repair. Existing gap/resize/recovery behavior stays in the coordinator and compositor. Root paint uses an absolute clip bounded to its last assigned slot during native resizing. An owned stylesheet hides outermost supported roots before admission, and detected reuse hides them before paint. Complete placement snapshots apply in one task with host transitions/animations disabled; native descendants remain untouched. See [render stability](render-stability.md).

The Twitch adapter implements that native lifecycle for the observed ordinary-text selector, with bounded coalesced reports and a session-scoped placement API. It repairs supported style rewrites, rejects obsolete layout revisions/widths, and restores attributes on teardown. Native nodes removed by the platform are retired, not archived or recreated. Connected retired roots remain hidden until native removal and count toward the tracking bound. The coordinator drains reports, assigns receipt time, processes evictions, routes full source layout snapshots and retires failed source sessions. See the [adapter contract and selector evidence](../packages/adapters/twitch/README.md).

Both platform modules now supply fixed discovery/type/identity policies to `packages/adapters/native-runtime.js`, sharing only the observer, geometry/style ownership, reports and lifecycle machinery. Twitch additionally supplies an exact-host FFZ Fine identity reader; the shared runtime never contains platform selectors or React discovery logic. The Node factory compiles a self-contained injectable function; selectors remain in platform modules and out of the compositor. YouTube restricts discovery to a single scrolling-list container, classifies outermost text/paid/sticker/membership/gift host candidates, and preserves custom-element lifecycle and shadow content. Its `messageKind` report metadata does not change layout policy. Only the YouTube text selector has static live evidence; the scrolling-container policy was exercised in the bounded live coordinator test, while identity-recycling and special-root compatibility retain synthetic coverage only. See the [YouTube contract and limits](../packages/adapters/youtube/README.md).

Step 6 adds `OperatorController` for persisted source/connection settings, serial control actions and a local control page. The dedicated managed overlay reads saved settings and updates only its own chat frame URLs. Live gap/spacer commands enter the same serial coordinator loop as native reports; history evictions preserve source generation identity. See [operator controls](operator-controls.md).

The core bounds retained history (messages and spacers together) and active sources, with defaults of 500 entries and 16 sources. It reports evictions/removals for adapter cleanup. The coordinator serializes bounded report drains, dispatches up to two changed source layout snapshots concurrently, and drops obsolete generations. Per-source acknowledgment confirms styles have been applied; separate native documents still do not provide atomic cross-frame painting. See the [coordinator contract](coordinator.md) for ordering, reconnect ownership and abrupt-disconnect limits. Observe moderation/removal without retaining detached native elements as a hidden archive. Teardown disconnects observers and restores modified styles.

Step 7 adds resource/activity diagnostics, bounded active HTTP control requests, linear report-delivery marking and shutdown cleanup of current-run spacers. Accelerated rolling native fixtures exercise removal, retirement, repeated transport recovery, source-pressure isolation and final restoration. See [hardening and support limits](hardening.md); these bookkeeping bounds do not establish process memory, CPU or prolonged live stability guarantees.

Step 12's [compatibility hardening](emote-compatibility.md) registers a bounded document-local FFZ settings provider before bootstrap execution. It isolates stored profiles and reviewed cosmetics without adding platform selectors or rendering to the compositor. The Twitch wrapper verifies the selected provider and fences competing engines; Node retains only bounded diagnostics. Stop cancels Elmychat work and releases scratch settings while an inert local policy may remain for late upstream chunks until the selected Twitch document is reloaded. Full provider unload remains unclaimed.

## Feasibility questions

1. Can the intended OBS/CEF version expose the selected Browser Source and both native frame contexts through CDP?
2. Can the chats load in the intended local-origin embedding arrangement, including platform domain requirements and session/login behavior?
3. Can source and ancestor backgrounds, clipping, scrolling, and native layout be adjusted enough to composite transparent message boxes?
4. Does external positioning survive native rerenders, asynchronous sizing, special messages, and node recycling?
5. How does refresh, source unload, scene change, and context replacement affect recovery?

The first milestone answered the first three for the tested static pair. Questions 4–5 now have passing automated adapter/coordinator coverage on Windows/Linux, and bounded continuous native OBS evidence now confirms merged scrolling, emotes/transparency, refresh recovery and restoration. The earlier static disappearance remains undiagnosed; prolonged use, live special messages, identity recycling and broader scene/process lifecycle compatibility remain unverified. Compositor tests establish data/layout behavior, not native DOM stability.

## Reference starting points

- [OBS Browser Source](https://obsproject.com/kb/browser-source)
- [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
- [CDP Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)
- [Twitch embedded chat](https://dev.twitch.tv/docs/embed/chat/)
- [YouTube live chat embedding guidance](https://support.google.com/youtube/answer/2524549)

Selectors and live-platform compatibility will be grounded during adapter work. The reference links are not an assertion that the complete composition approach has official platform support.
