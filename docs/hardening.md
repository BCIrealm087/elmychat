# Hardening and milestone boundary

Step 7 hardens resource ownership and diagnostics, and adds accelerated load/recovery verification. The implementation and Node checks are complete; Windows/Linux browser verification is pending. This is a bounded development milestone, not a claim of prolonged live OBS stability.

## Changes

Report delivery marks newly delivered roots in one pass through the tracked collection, rather than searching the collection once per added event. Coalesced add/resize reports retain the existing identity/removal semantics. Cleanup snapshots returned by diagnostics are copied so a consumer cannot alter retained restoration evidence.

The HTTP server admits at most 16 active control requests, including incomplete bodies and actions waiting to finish. Excess authenticated writes receive HTTP 503 and may be retried after capacity becomes available. The existing action queue remains separately bounded. GET health remains available during this pressure. No unbounded queue is added.

## Resource boundaries

| Resource | Coordinator boundary | Exhaustion behavior |
| --- | --- | --- |
| Retained messages and spacers | 500 total by default; explicit configuration can lower it | Oldest entries evicted; owning adapters retire connected roots |
| Native roots | 500 per source, including retired connected roots | Source fails and restores its styles; healthy source continues |
| Pending native reports | 1000 per source, coalesced by identity | Source fails/restores rather than dropping arbitrary reports |
| Styled nodes | 4096 per adapter; ancestor depth at most 64 | Adapter fails/restores when exceeded |
| Mutation records per callback | 10000 | Adapter fails/restores when exceeded |
| Inline style / native identity attribute | 65536 characters each | Explicit adapter failure |
| Current-run spacers | 32, sharing the history limit | New insertion rejected |
| Coordinator spacing commands | 32 queued | Excess commands rejected; queued work rejected during shutdown |
| Operator actions | 8 pending | Excess actions rejected before execution |
| HTTP control requests | 16 active; body at most 16 KiB and ten seconds to finish | 503 capacity, 413 size, or 408 incomplete-body timeout |
| CDP commands | 64 pending; five-second command timeout | Excess work rejected; expired/disconnected requests settled |
| Selected page | At most 32 default frame contexts at discovery | Connection waits/fails rather than operating a larger page |
| Cleanup evidence | Last 16 records per coordinator | Oldest evidence discarded; counters remain available |

One coordinator cycle is awaited at a time. Simultaneous ticks coalesce; there is no accumulating timer queue. A native-root pressure failure latches for that document generation instead of repeatedly installing an adapter into the same overloaded DOM. Replacing/refreshing the document permits recovery. Socket recovery restores only an adapter owned by the same coordinator; foreign ownership remains protected. Reachable shutdown restores styles and clears active sessions and retained message history. Spacers follow the current-run lifecycle described in [operator controls](operator-controls.md).

These bounds concern Elmychat's bookkeeping and queued work. They do not cap the platform's DOM, network/media resources, Chromium/CEF heap, process memory, or total CPU cost. Native candidate discovery still inspects platform DOM. A bounded collection is not a latency guarantee or a benchmark.

## Diagnostics

`/health` and `.runtime/proof/coordinator-report.json` add:

- `resources`: retained entries, active sessions, blocked sources, pending spacing commands, and retained cleanup records.
- `bounds`: the configured history limit and the coordinator/adapter limits above.
- `activity`: successful connections, session starts, processed current-session reports, successful layout writes, and last/longest completed cycle duration in milliseconds.
- `sources[].adapter`: tracked and retired roots, pending reports, styled nodes, addition/removal/resize/repair counters and flushes. These are the last report-drain snapshot; they are not synchronous measurements of all frames.

Activity counters belong to one coordinator instance and reset after changing sources or disconnecting/reconnecting through the controls. Cycle durations include debugger/network waits; they are not CPU utilization. An idle coordinator still polls for native changes, but does not resend an unchanged layout. Diagnostics contain geometry and local identities, not an archive of message HTML/text. Existing health fields remain compatible.

## Automatic acceptance

Node tests process 24000 synthetic reports across 240 batches and 30 source replacements, then 120 idle cycles. They check history/session/cleanup bounds, stable idle layout-write counts, detached cleanup snapshots and final cleanup. Additional pressure checks verify that a 33rd queued spacing command is rejected, shutdown settles all queued requests, CDP timeouts release all 64 slots and ignore late replies, and 16 incomplete HTTP requests leave health responsive and release capacity after completion.

The browser load test uses actual CDP and both native adapters in cross-site synthetic frames: 3200 new roots across 40 rolling batches, a 60-root window per frame, 80 retained entries, spacer edits during load, 30 idle cycles, ten transport reconnects, a Twitch root-pressure failure while YouTube continues, document replacement and final restoration. It verifies removed-root style restoration, bounded style/report ownership, unchanged idle layouts, retired context listeners and exact current-root cleanup. CI saves `hardening-load.json` with operation counts, observed peaks, counters and cleanup evidence. Existing native paint, transparency, special-candidate and UI regressions remain in the suite.

This is accelerated operation-count coverage. It does not simulate hours of platform network behavior, establish memory/CPU budgets, or prove all scene/process lifecycles. No repeat of the step 5 native gate is required for this milestone.

## Support limits

The tested operator setup used Windows and OBS described as latest, with CEF 127/CDP 1.3 in the original proof. No exact OBS version or broad version matrix was supplied. Bounded native evidence covers merged ordinary chat scrolling, emotes/alpha, refresh recovery and graceful restoration. Twitch special rows remain unsupported; YouTube's paid/sticker/membership/gift candidates and identity-recycling policies have synthetic coverage only. Platform DOM/embedding changes can invalidate selectors or prevent loading. Authentication remains in the OBS browser session; there is no account setup or OAuth workflow.

Abrupt coordinator termination cannot run teardown; refresh the Browser Source to recreate its document if presentation remains altered. Unreachable/destroyed documents cannot have restoration confirmed. A changed explicit target ID requires matching/selecting the new OBS target. Elmychat does not restart OBS, change scenes, change global browser security, or control unrelated pages. Keep the HTTP server and debugger on loopback.

## Distribution decision for this milestone

Recommendation: retain the current source-checkout workflow and defer packaged releases and license selection. The application runs through Node.js 22+ and `npm start`; runtime modules use Node built-ins. Playwright and PNG parsing remain development-only verification dependencies. `package.json` stays private; no installer, executable bundle, npm publication, release or license file is introduced.

This recommendation closes the experimental implementation milestone without making a redistribution or production-support claim. Public packaging, a redistribution license, signing/update mechanisms and wider onboarding require a separate user-selected scope and decision before implementation. The branch rename is a separate repository action, not a release.
