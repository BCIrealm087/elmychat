# Proposed native-chat composition

## Objective and status

Preserve native Twitch and YouTube message rendering while presenting one ordered stream with arbitrary transparent gaps in OBS. This document captures the attached design discussion as a proposal. The HTTP shell is implemented; browser attachment and native composition are unverified.

OBS documents that Browser Source is based on CEF and accepts CEF flags, and describes transparent backgrounds in its default CSS. That establishes a useful starting point, not proof that a given OBS build exposes usable debugging sessions or transparent nested platform frames. CDP documents target attachment and execution-context evaluation; the exact OBS transport and frame behavior must be tested.

## Component boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Coordinator | Local server, selected source sessions, sequencing, lifecycle orchestration | Platform message rendering |
| Browser control | CDP connections, targets, execution contexts, injections and report delivery | Layout policy or site selectors |
| Platform adapter | Native DOM identity, measurement, observers, positioning, teardown | Global cross-platform ordering |
| Compositor | Serializable rectangles, ordering, spacers, clipping and placement | DOM access, platform HTML or emote rendering |
| Overlay | Shared viewport and eventual native source surfaces | Cross-origin frame DOM access from ordinary page JavaScript |

Both source documents would occupy the same viewport. Their native message roots remain in their original documents and receive positions from the compositor. A normal parent page cannot directly manipulate cross-origin frame DOM; CDP injection is the proposed access mechanism. Do not disable browser web security as an architectural shortcut.

## Proposed message contract

This is design input, not an implemented public API:

```js
{
  sessionId: 'source-session-generation',
  sourceId: 'twitch:example-channel',
  messageId: 'adapter-local-id',
  sequence: 42,       // Assigned monotonically by the coordinator.
  receivedAtMs: 0,    // Coordinator receipt time, diagnostic only.
  width: 420,
  height: 38
}
```

The first version orders by the coordinator's report-arrival sequence. This avoids comparing unsynchronized document clocks; it is not platform send time or a guarantee about which DOM node appeared first across asynchronous contexts. Initial existing-chat batches need a documented per-source order and receive new sequences on attachment. Cross-platform historical ordering is deferred.

A spacer is a separate bounded entry with a non-negative height. Its value should not alter the native message's content. Placements carry the session/source/message identity, vertical coordinate, and visibility decision. Adapters reject placements for obsolete sessions. No live DOM references cross the process boundary.

## Lifecycle and bounds

Adapters need MutationObserver for message changes and ResizeObserver for delayed native sizing. Measurements must use the shared viewport width. Removing or reusing a native root must retire its old identity. Navigation, frame destruction, and adapter reattachment must invalidate the old source session so stale placements cannot affect replacement nodes.

The coordinator should coalesce measurements/placements, bound retained messages and pending work, and drop obsolete generations. Exact limits follow the proof. Observe moderation/removal without retaining detached native elements as a hidden archive. Teardown disconnects observers and restores modified styles.

## Feasibility questions

1. Can the intended OBS/CEF version expose the selected Browser Source and both native frame contexts through CDP?
2. Can the chats load in the intended local-origin embedding arrangement, including platform domain requirements and session/login behavior?
3. Can source and ancestor backgrounds, clipping, scrolling, and native layout be adjusted enough to composite transparent message boxes?
4. Does external positioning survive native rerenders, asynchronous sizing, special messages, and node recycling?
5. How does refresh, source unload, scene change, and context replacement affect recovery?

The first milestone must answer the first three before promising the rest. If it fails, document the exact blocker and alternative source/container options before changing the native-rendering goal.

## Reference starting points

- [OBS Browser Source](https://obsproject.com/kb/browser-source)
- [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
- [CDP Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)
- [Twitch embedded chat](https://dev.twitch.tv/docs/embed/chat/)
- [YouTube live chat embedding guidance](https://support.google.com/youtube/answer/2524549)

Selectors and live-platform compatibility will be grounded during adapter work. The reference links are not an assertion that the complete composition approach has official platform support.
