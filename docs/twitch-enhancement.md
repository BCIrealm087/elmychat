# Twitch enhancement lifecycle (step 9)

Step 9 implements an opt-in FFZ lifecycle in the existing native coordinator. Normal saved settings keep providers off. Provider preferences, controls and explicit apply/retry actions remain step 11 work; enhanced identity/layout is step 10. The [step 8 evidence](emote-proof.md) supports the basic rendering route, not production readiness or every emote category.

## Explicit development configuration

In an explicit coordinator JSON file, use an exact Twitch channel prefix and add provider choices to its Twitch source:

```json
{
  "id": "twitch",
  "platform": "twitch",
  "urlPrefix": "https://www.twitch.tv/embed/your_channel/chat",
  "emotes": { "sevenTv": true, "betterTtv": true }
}
```

Either choice may be false. Missing choices default to false; unknown keys, non-boolean values, YouTube enhancement, and non-Twitch/partial embed paths are rejected. Run the existing explicit JSON workflow with `npm start -- .runtime/coordinator.json`. This is a development configuration surface, not a new saved-setting or control-page toggle. Applying provider changes currently means stopping that configured runtime and refreshing Twitch to clear its retained enhancer before starting the changed configuration. A running enhancer cannot be removed by deleting its script tag.

The bootstrap URL remains fixed. Node downloads and hashes the approved HTTPS FFZ bootstrap before in-frame injection, using the same redirect, deadline and size checks as the proof. Caller cancellation also aborts the download. Upstream chunks/add-ons are still mutable; no third-party implementation or assets are bundled. Existing enhancer/proof instances and saved enabled add-ons are blockers. The enabled list is cloned and dependencies enabled in reviewed order without saving. This does not isolate all FFZ profiles or default cosmetics; the appearance audit and broader isolation remain step 12 work, before final support.

## Ownership, scheduling and readiness

`TwitchEnhancement` belongs to one coordinator process. It starts only after that generation's native Twitch adapter is running. Its background worker never runs network downloads or readiness waits inside a native coordinator cycle. YouTube, message reports, layouts, gap controls and spacers continue while enhancement loads or fails. There is one active worker and only the latest desired binding; repeated ticks do not queue installs.

Each command carries the process owner, native session, selected context and exact document URL. The in-frame wrapper checks the native adapter session before beginning. A per-document marker prevents duplicate scripts and add-on requests; a same-process reconnect can rebind an owned running enhancer to the new native session. Foreign owners or conflicting provider choices are left untouched. After navigation, obsolete download/evaluation results cannot publish status, enable providers in a replacement document, stop its rebound wrapper, or request its refresh. Reachable retired bindings release our callbacks/script element; lost contexts cannot provide confirmed cleanup.

Preparation permits at most two bootstrap downloads, each with one 30-second deadline, separated by 250ms. No retry occurs after exhausted downloads until a new document generation. Readiness polling runs once per second with a 65-second deadline; the browser wrapper also has a 75-second loading watchdog. CDP commands retain their existing five-second deadline. Ready documents are checked at most once per five seconds. Provider failures do not alter the native connection status or repeatedly request enablement.

The separate `sources[].enhancement` health field (also in coordinator reports and terminal source status) has `off`, `loading`, `ready`, or `unavailable`. It includes bounded provider versions, module readiness, set/emote counts, download attempts, reset requirement and recovery outcome. `ready` means the requested modules and inspected emote-data API are usable; it does **not** mean a visible image was observed or every channel lookup completed. Data with no attributed sets is `empty-or-pending`, rather than falsely classified as a failed provider. An empty channel is valid, and a module-ready flag alone cannot distinguish it from pending upstream fetches. Actual image observation remains the diagnostic's separate evidence.

## Partial failure and reset boundary

A download or foreign-owner failure leaves native chat active and does not refresh Twitch. After owned partial execution, unsupported APIs, failed script loading, preference conflicts or readiness timeout, the worker stops its own callbacks and requests at most **one** automatic recovery refresh in that lifecycle. The marker, binding, document URL and native session must still match. Check and `location.reload()` execute in one task inside that selected Twitch document; the coordinator never reloads the OBS page, YouTube or an unrelated tab.

After this recovery, enhancement is paused for the remainder of that runtime; the new native Twitch adapter resumes without another loader attempt. Twitch history resets, while the coordinator, YouTube session, gap and retained spacers continue. This deliberately avoids a provider-driven reload loop. `resetAttempted` records consuming the one recovery opportunity; `resetOutcome` is `requested` only after acknowledgment, or `unconfirmed` when ownership/context/transport changes or the response is lost. The response is not proof that chat has reconnected. The next native generation's ordinary connection status supplies that evidence.

Shutdown cancels Node work and releases reachable wrapper callbacks, timers and script elements before native restoration. FFZ hooks/sockets/styles can remain: `resetRequired` is retained and full unload is never claimed. Native frame replacement is the clean reset boundary. A new process must not adopt another process's hooks. In-frame appearance changes and identity across FFZ remounts remain documented limitations.

## Automated verification

Node lifecycle/coordinator tests cover delayed readiness, empty data, bounded downloads, stale downloads and command responses, channel/context changes, same-process reconnect, foreign ownership, timeout, one recovery attempt, refused reset, cancellation and continued native layout/spacing under pressure. Browser fixtures exercise idempotent enablement, strict delayed manifests, dependency persistence, empty sets, missing APIs, failed scripts and Trusted Types. Real-CDP tests cover both OOPIF and page-context transports, adoption without a second script, source refresh with a fresh install, and partial-failure recovery preserving YouTube and spacers.

These tests use our deterministic FFZ shim; they do not download live upstream code. Local Node verification is available; Chromium is absent in the development environment, so browser verification runs in Windows/Linux CI. No repeated routine live gate is required for this lifecycle step. The existing [step 8 report](emote-proof.md#live-recheck-and-route-decision-2026-10-08-utc) remains the bounded actual-loader evidence.
