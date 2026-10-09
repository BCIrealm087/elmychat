# Operator controls

Step 6 adds a local controls page, saved source settings, and live gap/spacer controls. Windows/Linux [CI run 37635603023](https://github.com/BCIrealm087/elmychat/actions/runs/37635603023), commit `f509b9d`, passed all 38 Node and 23 browser tests on each OS with no skipped tests. The bounded native OBS gate from step 5 remains valid; this step introduces no repeat manual gate. Live special-root and prolonged-use limits remain unchanged.

## Start and configure

```sh
npm ci
npm start
```

Open `http://127.0.0.1:3210/` in your browser. Enter the Twitch channel and a YouTube video ID or HTTPS watch, live or youtu.be URL. Click **Save and connect**, then copy the displayed `http://127.0.0.1:3210/overlay` URL into an OBS Browser Source. That URL remains the same when changing chats. The dedicated overlay checks source settings every two seconds and updates only its own native chat frames. Existing loaded frames stay intact through a temporary local-server outage.

Each message has a small platform icon on the left: the purple Twitch mark or the red YouTube play mark. A subtle dark backing keeps it readable over the OBS scene. Native badges, names and emotes remain intact.

Twitch messages wrap within a 340px reference sidebar column so wider OBS sources preserve common Twitch ASCII-art line breaks. Extra width stays transparent to the right of Twitch messages; YouTube uses the available source width. Sources narrower than 340px reflow Twitch text to fit. Fonts, native padding, emotes and Unicode spaces remain native. Rows without enough native left padding receive a narrow icon gutter instead of covering text; unusually tight layouts may wrap earlier. Customized Twitch appearance settings can produce different wrapping; see the [Twitch layout contract](../packages/adapters/twitch/README.md#positioning-and-restoration).

Keep OBS launched with `--remote-debugging-port=9222`, or set its actual port under **OBS connection settings** before saving. This remains browser-source debugging, not obs-websocket. Elmychat never launches/restarts OBS or navigates a selected OBS page through CDP.

The coordinator waits until that exact overlay page exists. The controls show source status, native-root counts and connection errors. **Find matching sources** uses the saved port and lists only pages at the overlay's exact URL. If several OBS sources use that URL, choose the intended one and save again; automatic selection rejects ambiguity. An explicit source selection is persisted; after OBS replaces its target ID, select automatic matching or find the new source and save. Unrelated targets are never candidates in the controls.

**Disconnect and restore** gracefully stops the coordinator and restores reachable native styles. **Connect** starts a fresh coordinator using the saved settings. Ctrl+C also performs graceful cleanup, but preserves the saved connected/disconnected preference for the next launch.

## Twitch emotes

See [setup, the final support matrix and troubleshooting](emote-support.md) for the tested OBS/provider versions and evidence limits. Basic provider rendering is observed; Ready is not a promise that every emote category or channel has been verified.

Step 11 adds independent **7TV** and **BTTV** choices under **Twitch emotes**. Both may be enabled together; old settings default both off. After saving sources and connecting the selected managed OBS overlay, choose providers and click **Apply emotes**. Ordinary source edits preserve the saved choices. Unsaved checkbox edits survive status polling; disconnected controls let you choose a draft, but applying requires a connection. The choices also appear in explicit runtime JSON as Twitch-only `sources[].emotes`.

Applying changed choices or clicking **Retry emotes** refreshes only the selected overlay's Twitch frame and resets its retained Twitch history. It preserves the coordinator, YouTube session and retained message sequences, gap and current-run spacers. No additional extension or provider login is needed for the public emote route. The overlay shell itself and other overlays at the same URL are not refreshed. If an already loaded overlay predates these controls, reload that overlay once to load the updated managed script; new overlays have the helper automatically.

Emote status is separate from chat connection: **Off**, **Loading**, **Ready** or **Unavailable**. Ready describes available enhancement modules, not proof that a particular channel emote has rendered. Failures show a short explanation and an explicit retry action; technical provider/loader details remain in Diagnostics. Retry uses the saved choices, so apply any checkbox changes first. Applying unchanged choices is a no-op. Turning both off uses a fresh Twitch document rather than claiming enhancer hooks were unloaded. Managed connections also request one selected Twitch refresh at startup/reconnect to clear enhancer hooks from the previous session; YouTube is not navigated. An unsupported older overlay records a refresh error and keeps native composition available without loading the new enhancer into the old document.

Provider changes are serialized with spacing/native cycles. The settings file is written before a live transition; a write failure leaves both native sessions and the live loader untouched. If the managed refresh preflight fails, prior preferences are restored on disk and the existing loader remains active. A rollback disk failure is reported explicitly. Each transition has a unique revision acknowledged by the selected top document. Duplicate delivery and ordinary overlay polling cannot reload the frame again or revert its revision URL. A lost/refused acknowledgment is recorded without automatic retries; a fresh ready context confirms reconnection. If no replacement arrives within 15 seconds, native composition can resume in the old document while enhancement stays paused, with an explicit retry available. A response loss is not proof of successful refresh.

Apply keeps emote status Loading while the new Twitch document/native session becomes ready. If Twitch changes its URL during the bootstrap download, installation waits for the coordinator's fresh exact URL instead of treating the pre-install mismatch as a permanent failure. This preparation is bounded by the enhancement readiness deadline and does not add another refresh; Diagnostics records the specific waiting reason. YouTube, gap and spacers continue through this wait.

Normal emote support uses isolated document-local FFZ settings. It does not import or save shared FFZ profiles/add-on preferences, and suppresses the reviewed extra provider badges, name paints, animated avatars and update notices. Native Twitch badges remain supported. Missing isolation/appearance APIs are compatibility failures, with details in Diagnostics and the existing explicit retry path. Some upstream base styles/renderer changes can still affect appearance; see [step 12 compatibility and teardown](emote-compatibility.md).

Node tests cover default migration, preference validation/reload, independent/both-provider choices, persistence and preflight rollback, unchanged-choice no-ops, refresh bounds and native fallback. Browser tests use a deterministic enhancer shim through both OOPIF and page-context CDP paths to verify keyboard operation, draft/persisted choices, narrow layouts, selected-overlay-only refresh, provider combinations, bounded retry, reapplication after refresh, retained YouTube identities/gap/spacers and transparent spacer pixels. Local Node checks pass; local browser execution fails at launch because Chromium is absent, so Windows/Linux CI supplies browser verification. These fixtures do not expand the bounded live provider/category evidence. No repeat routine live gate is required.

If emotes become unavailable, capture Diagnostics before retrying: `sources[].enhancement.lastFailure` retains the original reason/stage through native recovery, and a new Apply/retry clears it. Native chat connection status remains separate. Test newly arriving enabled emotes; activation need not convert historical names from text. Do not run the legacy `proof:emotes` loader alongside normal controls; it does not verify the managed isolated-settings path. See [troubleshooting](emote-support.md#troubleshooting).

## Spacing

**Default gap** accepts 0–10000 pixels, including fractional values, and applies live without reattaching the source sessions or resequencing retained messages. It is saved with the source settings. Zero makes adjacent messages touch.

**Insert spacer** places a transparent entry after the current messages. Until another message arrives it reserves space at the bottom; subsequent arrivals follow it in the same timeline. It replaces the normal gap at that point, rather than adding another default gap. Consecutive spacers add their heights. Each retained spacer can be resized or removed; removing it restores normal adjacency. This initial UI does not move a spacer backwards into earlier history.

Spacers have independent identities, are capped at 32, and share the existing 500-entry history bound with messages. Spacer-driven message evictions are returned to the owning adapters, just like chat-driven evictions; native roots stay retired and cannot be re-admitted. A spacer disappears from the controls if history evicts it. Retained spacers survive native frame refresh/reconnection within the same coordinator, but are cleared when source settings are saved, the coordinator is disconnected/reconnected, or the process restarts. Spacers are current-run state, not persisted settings.

## Saved settings and compatibility

`.runtime/operator.json` stores versioned source IDs, debugging port, optional explicit target selection, default gap, independent Twitch emote choices and connected/disconnected preference. Atomic replacement writes a complete file; failed configuration writes leave the currently working session untouched. Failed gap persistence rolls the gap back. A corrupt file is reported explicitly rather than overwritten. Runtime profiles, cookies and platform credentials are not stored in this configuration.

The existing `npm start -- .runtime/coordinator.json` workflow still accepts an explicit step 5 configuration, and `/native` and `/proof` remain available. The controls can change its live gap/spacers, connect and disconnect. Such gap changes last for that process; they do not rewrite the explicit JSON file. Saving source fields in the controls switches to the managed `/overlay` and stores operator settings. Next time, launch plain `npm start` to use them. A command-line configuration takes priority over saved operator settings for that launch.

`/health` and `.runtime/proof/coordinator-report.json` retain native coordinator diagnostics. After disconnect/shutdown, the report preserves the last cleanup results. It contains geometry and local identities rather than message text or credentials.

## Boundaries and automatic verification

The HTTP server remains bound to loopback. Mutating API calls require a matching local Host/Origin, JSON content type and the server's controls-page nonce; bodies are limited to 16 KiB and ten seconds to finish. At most 16 control requests can be active, including incomplete bodies; excess writes receive HTTP 503 and can be retried after capacity is available. There is no permissive CORS policy. The controls page cannot be embedded in another page. Operator actions are serialized and capped at eight pending operations; spacing commands run at the start of a serialized coordinator cycle, with a 32-command queue bound. Retirement batches carry the original source generation so evictions cannot retire a replacement document's identities. See [hardening checks and support limits](hardening.md).

Node tests cover settings normalization, source/query identity, persistence/reload/failure rollback, source replacement, matching-target selection, action/spacing bounds, history eviction, commands arriving during active work, and HTTP validation/origin/body restrictions. Browser tests operate the real controls on wide/narrow screens, save/select sources, apply gaps, edit/remove spacers, and exercise connect/disconnect. The managed-overlay integration intercepts platform requests with synthetic native fixtures and uses actual CDP attachment to verify unchanged message identities, explicit transparent spacer pixels, source switching with a stable OBS URL, and native style restoration. CI artifacts add `operator-controls*.png/json` and `operator-managed-overlay.png/json`. This does not establish additional live-platform compatibility.
