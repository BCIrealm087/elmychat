# Proposed native-chat composition

## Objective and status

Preserve native Twitch and YouTube message rendering while presenting one ordered stream with arbitrary transparent gaps in OBS. The HTTP shell, scoped one-pair CDP probe, pure compositor core and injected Twitch text-root adapter are implemented. The adapter's synthetic lifecycle tests passed on Windows/Linux; the YouTube adapter and production coordinator wiring remain unimplemented. The operator confirmed bounded native OBS composition, transparency and restoration. Ongoing live native message survival remains unresolved. See [evidence](feasibility-proof.md).

The observed OBS environment exposes both native frames as CDP iframe targets and can render the static pair over a scene source. That bounded result does not establish support across OBS builds or continued rerenders. CDP transports access; the compositor computes layout; future adapters maintain native presentation.

## Component boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Coordinator | Local server, selected source sessions, admission into the compositor, lifecycle orchestration | Platform message rendering |
| Browser control | CDP connections, targets, execution contexts, injections and report delivery | Layout policy or site selectors |
| Platform adapter | Native DOM identity, measurement, observers, positioning, teardown | Global cross-platform ordering |
| Compositor | Serializable rectangles, ordering, spacers, clipping and placement | DOM access, platform HTML or emote rendering |
| Overlay | Shared viewport and eventual native source surfaces | Cross-origin frame DOM access from ordinary page JavaScript |

Both source documents would occupy the same viewport. Their native message roots remain in their original documents and receive positions from the compositor. A normal parent page cannot directly manipulate cross-origin frame DOM; CDP injection is the proposed access mechanism. Do not disable browser web security as an architectural shortcut.

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

Adapters need MutationObserver for message changes and ResizeObserver for delayed native sizing. Measurements must use the shared viewport width. Removing or reusing a native root must retire its old identity. Navigation, frame destruction, and adapter reattachment must invalidate the old source session so stale placements cannot affect replacement nodes.

The Twitch adapter implements that native lifecycle for the observed ordinary-text selector, with bounded coalesced reports and a session-scoped placement API. It repairs supported style rewrites, rejects obsolete layout revisions/widths, and restores attributes on teardown. Native nodes removed by the platform are retired, not archived or recreated. Connected retired roots remain hidden until native removal and count toward the tracking bound. The future coordinator must drain reports, assign receipt time, process evictions, route full source layout snapshots and retire failed source sessions. See the [adapter contract and selector evidence](../packages/adapters/twitch/README.md).

The core bounds retained history (messages and spacers together) and active sources, with defaults of 500 entries and 16 sources. It reports evictions/removals for future adapter cleanup. The coordinator still needs to coalesce measurements/placements, bound pending work, and drop obsolete generations. Observe moderation/removal without retaining detached native elements as a hidden archive. Teardown disconnects observers and restores modified styles.

## Feasibility questions

1. Can the intended OBS/CEF version expose the selected Browser Source and both native frame contexts through CDP?
2. Can the chats load in the intended local-origin embedding arrangement, including platform domain requirements and session/login behavior?
3. Can source and ancestor backgrounds, clipping, scrolling, and native layout be adjusted enough to composite transparent message boxes?
4. Does external positioning survive native rerenders, asynchronous sizing, special messages, and node recycling?
5. How does refresh, source unload, scene change, and context replacement affect recovery?

The first milestone answered the first three for the tested static pair. Questions 4–5 remain adapter/coordinator work, including the observed short, inconsistent message lifetime. Compositor tests establish data/layout behavior, not native DOM stability.

## Reference starting points

- [OBS Browser Source](https://obsproject.com/kb/browser-source)
- [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
- [CDP Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)
- [Twitch embedded chat](https://dev.twitch.tv/docs/embed/chat/)
- [YouTube live chat embedding guidance](https://support.google.com/youtube/answer/2524549)

Selectors and live-platform compatibility will be grounded during adapter work. The reference links are not an assertion that the complete composition approach has official platform support.
