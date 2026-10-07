# Operator controls

Step 6 adds a local controls page, saved source settings, and live gap/spacer controls. Windows/Linux [CI run 37635603023](https://github.com/BCIrealm087/elmychat/actions/runs/37635603023), commit `f509b9d`, passed all 38 Node and 23 browser tests on each OS with no skipped tests. The bounded native OBS gate from step 5 remains valid; this step introduces no repeat manual gate. Live special-root and prolonged-use limits remain unchanged.

## Start and configure

```sh
npm ci
npm start
```

Open `http://127.0.0.1:3210/` in your browser. Enter the Twitch channel and a YouTube video ID or HTTPS watch, live or youtu.be URL. Click **Save and connect**, then copy the displayed `http://127.0.0.1:3210/overlay` URL into an OBS Browser Source. That URL remains the same when changing chats. The dedicated overlay checks source settings every two seconds and updates only its own native chat frames. Existing loaded frames stay intact through a temporary local-server outage.

Keep OBS launched with `--remote-debugging-port=9222`, or set its actual port under **OBS connection settings** before saving. This remains browser-source debugging, not obs-websocket. Elmychat never launches/restarts OBS or navigates a selected OBS page through CDP.

The coordinator waits until that exact overlay page exists. The controls show source status, native-root counts and connection errors. **Find matching sources** uses the saved port and lists only pages at the overlay's exact URL. If several OBS sources use that URL, choose the intended one and save again; automatic selection rejects ambiguity. An explicit source selection is persisted; after OBS replaces its target ID, select automatic matching or find the new source and save. Unrelated targets are never candidates in the controls.

**Disconnect and restore** gracefully stops the coordinator and restores reachable native styles. **Connect** starts a fresh coordinator using the saved settings. Ctrl+C also performs graceful cleanup, but preserves the saved connected/disconnected preference for the next launch.

## Spacing

**Default gap** accepts 0–10000 pixels, including fractional values, and applies live without reattaching the source sessions or resequencing retained messages. It is saved with the source settings. Zero makes adjacent messages touch.

**Insert spacer** places a transparent entry after the current messages. Until another message arrives it reserves space at the bottom; subsequent arrivals follow it in the same timeline. It replaces the normal gap at that point, rather than adding another default gap. Consecutive spacers add their heights. Each retained spacer can be resized or removed; removing it restores normal adjacency. This initial UI does not move a spacer backwards into earlier history.

Spacers have independent identities, are capped at 32, and share the existing 500-entry history bound with messages. Spacer-driven message evictions are returned to the owning adapters, just like chat-driven evictions; native roots stay retired and cannot be re-admitted. A spacer disappears from the controls if history evicts it. Retained spacers survive native frame refresh/reconnection within the same coordinator, but are cleared when source settings are saved, the coordinator is disconnected/reconnected, or the process restarts. Spacers are current-run state, not persisted settings.

## Saved settings and compatibility

`.runtime/operator.json` stores versioned source IDs, debugging port, optional explicit target selection, default gap and connected/disconnected preference. Atomic replacement writes a complete file; failed configuration writes leave the currently working session untouched. Failed gap persistence rolls the gap back. A corrupt file is reported explicitly rather than overwritten. Runtime profiles, cookies and platform credentials are not stored in this configuration.

The existing `npm start -- .runtime/coordinator.json` workflow still accepts an explicit step 5 configuration, and `/native` and `/proof` remain available. The controls can change its live gap/spacers, connect and disconnect. Such gap changes last for that process; they do not rewrite the explicit JSON file. Saving source fields in the controls switches to the managed `/overlay` and stores operator settings. Next time, launch plain `npm start` to use them. A command-line configuration takes priority over saved operator settings for that launch.

`/health` and `.runtime/proof/coordinator-report.json` retain native coordinator diagnostics. After disconnect/shutdown, the report preserves the last cleanup results. It contains geometry and local identities rather than message text or credentials.

## Boundaries and automatic verification

The HTTP server remains bound to loopback. Mutating API calls require a matching local Host/Origin, JSON content type and the server's controls-page nonce; bodies are limited to 16 KiB and ten seconds to finish. At most 16 control requests can be active, including incomplete bodies; excess writes receive HTTP 503 and can be retried after capacity is available. There is no permissive CORS policy. The controls page cannot be embedded in another page. Operator actions are serialized and capped at eight pending operations; spacing commands run at the start of a serialized coordinator cycle, with a 32-command queue bound. Retirement batches carry the original source generation so evictions cannot retire a replacement document's identities. See [hardening checks and support limits](hardening.md).

Node tests cover settings normalization, source/query identity, persistence/reload/failure rollback, source replacement, matching-target selection, action/spacing bounds, history eviction, commands arriving during active work, and HTTP validation/origin/body restrictions. Browser tests operate the real controls on wide/narrow screens, save/select sources, apply gaps, edit/remove spacers, and exercise connect/disconnect. The managed-overlay integration intercepts platform requests with synthetic native fixtures and uses actual CDP attachment to verify unchanged message identities, explicit transparent spacer pixels, source switching with a stable OBS URL, and native style restoration. CI artifacts add `operator-controls*.png/json` and `operator-managed-overlay.png/json`. This does not establish additional live-platform compatibility.
