# Native coordinator

Step 5 connects the two native adapters to the compositor through the selected OBS Browser Source's CDP socket. The parent page never reads cross-origin chat DOM, copies HTML or recreates messages. All 27 Node tests and 21 browser tests passed on both Windows and Linux in [CI run 37628199537](https://github.com/BCIrealm087/elmychat/actions/runs/37628199537), including late failure isolation, connected-root eviction and foreign owner checks. The operator passed the bounded continuous OBS gate: merged scrolling, native emotes, scene alpha, refresh recovery and graceful restoration. Prolonged use and live special-root compatibility remain unverified.

## Run

For the managed source configuration and controls workflow, use plain `npm start` and [operator controls](operator-controls.md). The explicit JSON procedure below remains supported.

Keep the OBS debugging setup that worked for the static proof. Do not run the static probe and coordinator concurrently. Stop the existing `npm start` server before starting this configured instance.

Copy `docs/coordinator.example.json` to `.runtime/coordinator.json`. Replace the channel/video placeholders in `targetUrl` with the real values; retain the URL's exact query order. If identical Browser Sources exist, use `targetId` from `npm run proof:targets` instead. The coordinator pins that ID after its first connection and will not attach to a replacement target ID automatically.

```sh
npm ci
npm start -- .runtime/coordinator.json
```

Use the matching `http://127.0.0.1:3210/native?twitch=CHANNEL&youtube=VIDEO_ID` in the OBS Browser Source. `/native` uses the same native embed surface as `/proof`; `/proof` remains supported for the static diagnostic. Starting the coordinator before OBS opens the page is supported: it waits for the selected existing target. It never opens, navigates or closes an OBS page or restarts OBS. Source/platform accounts remain native browser sessions.

`http://127.0.0.1:3210/health` exposes current source sessions, failures, measured rectangles and cleanup outcomes. `.runtime/proof/coordinator-report.json` is refreshed approximately every two seconds and again on Ctrl+C. It contains geometry and local identities, not message text, cookies or credentials. Ctrl+C waits for current work, restores reachable source styles and closes its socket/server.

## Lifecycle contract

Each serialized cycle discovers default worlds, reads the selected top-level viewport, drains Twitch then YouTube in configured order, admits reports and routes full per-source layout snapshots. Changed snapshots from the same layout are dispatched concurrently, at most two commands, so the first source acknowledgment cannot postpone the second request. Results and failure retirement are handled before another cycle; healthy sources receive a recovery snapshot after a failed source is retired. Default interval is 100ms **after** a completed cycle; slow CDP work cannot accumulate ticks. Native observers still coalesce reports between drains. Initial native roots are admitted in each adapter's discovery order. Cross-source events drained in the same cycle follow configured source order, not an estimate of platform send time. The monotonic compositor sequence persists across source reconnection.

Dimensions/removals carry source and session identity; obsolete generations are dropped. A width change requests native remeasurement and keeps stale measurements hidden. Height changes relayout without resequencing. History evictions explicitly retire connected native roots so they cannot be re-admitted on the next drain. Layouts are sent only when a source's snapshot changes, with increasing revisions. Adapters apply each complete snapshot synchronously before acknowledging it. Native host motion is disabled while attached, growing content remains clipped to its previous slot until relayout, and unassigned/reused roots stay hidden; see [render stability](render-stability.md). Independent source frames still cannot guarantee atomic painting across documents. Gap configuration uses the existing compositor; the [step 6 controls](operator-controls.md) now provide live gap changes and insert/resize/remove current-run spacers.

Frame navigation/replacement/unload retires the source generation; a unique matching replacement gets a fresh session. Missing or ambiguous frames wait without choosing one. Adapter failure restores/retire its source and is latched for that document; refreshing that source permits a new attempt. Other healthy sources continue. A matching source document without a body waits as `native-document-loading` and retries each cycle without latching a failure. Installation rechecks readiness atomically; unavailable ResizeObserver has a separate explicit failure. A missing YouTube scrolling container is reported as waiting while observation remains active.

Socket loss retires compositor identities and reconnects to the pinned target ID. A still-running adapter may be recovered only if its session belongs to this coordinator process's random owner token. A different coordinator's running adapter is left alone and reported as occupied. Navigating the selected page away from its original exact URL suspends operation and restores reachable source styles. Returning that same target to its original URL can recover. Restarting OBS creates new target IDs: restart this coordinator with an explicit new selection.

## Bounds and limits

Exactly two platform sources, up to 32 default frame contexts, 500 tracked roots and 1000 coalesced reports per adapter, 1–500 retained compositor entries, and the last 16 cleanup outcomes. CDP commands have a five-second deadline; cycles remain serial, with at most two concurrent layout writes and no accumulating tick backlog. Root overflow fails closed and requires a refresh rather than repeatedly reinjecting a failing document. CDP frame-attachment diagnostics are capped at 16.

If a context is destroyed or its socket is unavailable, restoration cannot be confirmed. A disconnected native document may retain its last placement until reconnection restores the old adapter; a new coordinator process cannot take over that live adapter. Refreshing the Browser Source resets the document. This is a known recovery limitation, not proof that abrupt shutdown restores styles. Graceful teardown and same-process reconnection are automated test cases.

Native root removal remains authoritative: the coordinator does not archive or fabricate a message to keep it visible. The prior static probe's disappearing messages were not reported in the bounded continuous test, but their original cause remains undiagnosed. Twitch special rows and YouTube's live special-root/scope/identity compatibility retain their adapter limitations.

## Verification and critical native gate

Ten Node coordinator tests cover reports, stale sessions, evictions, viewport invalidation, ambiguity, failures, reconnect selection and shutdown during injection. Two real-CDP browser tests exercise isolated iframe targets and shared page contexts, original native nodes, all transparent gap pixels, delayed native size, viewport changes, removal, source navigation, socket reconnection, top-page refresh, frame unload/recreation and exact style restoration, connected-root evictions and foreign coordinator isolation. CI artifacts include `coordinator*.json/png` alongside prior proofs. These use synthetic fixtures, not actual Twitch/YouTube or OBS.

After automated verification, step 5's live acceptance is one bounded check of the previous critical persistence failure: run the continuous coordinator with both live chats for two minutes, confirm new messages remain until naturally removed/evicted, refresh the Browser Source once and confirm resumed composition, then Ctrl+C and confirm restoration. Keep the colored scene background to observe alpha. Record whether a source reports waiting/failed, save the coordinator report before and after shutdown, and note the exact OBS version. No repetition of the old static pair probe is needed. The operator completed this bounded gate on 2026-10-07; [observations and report findings](feasibility-proof.md#step-5-continuous-native-observation--2026-10-07) are recorded. No repeat is required to proceed to step 6. The exact OBS version remains unspecified; it was described as latest.
