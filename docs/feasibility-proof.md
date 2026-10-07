# Native pair feasibility proof

## What this step establishes

The tool discovers one explicitly selected local debugging target, finds the two source document contexts, measures one visible message in each, and positions the original native roots with a 120px transparent gap. It leaves native descendants in their owning document and does not copy HTML or recreate message rendering. Ctrl+C restores the inline styles changed by the probe and disconnects without closing OBS or navigating the source.

This is deliberately a static pair diagnostic. It does not observe live arrivals, implement global ordering, handle continued rerenders/resizes, provide a settings UI, or run the platform adapters/compositor.

## Evidence and status

| Question | Verification | Status |
| --- | --- | --- |
| Scoped command routing, disconnect rejection, explicit target selection, and context retirement | Node behavioral tests | Passed locally |
| Cross-origin access without disabling web security | Synthetic Chromium frames with different sites | Passed in Linux and Windows CI |
| Separate iframe sessions and multiple contexts on one session | Two browser isolation modes, with assertions on actual session types | Passed in Linux and Windows CI |
| Original root/descendant identity and native paint through overlapping frames | DOM identity checks and screenshot pixel checks | Passed in Linux and Windows CI |
| Arbitrary transparent spacing and removal of surrounding chrome | Check every pixel of the 120px gap and sample native message/background pixels | Passed in Linux and Windows CI |
| Style restoration | Compare original inline attributes/declarations after teardown, including existing inline styles | Passed in Linux and Windows CI |
| Actual Twitch/YouTube embedding, text selectors, OBS/CEF target support and final scene alpha | Operator report, native JSON and screenshot on Windows | Passed for the bounded static pair; persistence remains unresolved |

Recorded automated evidence: [CI run 37565575785](https://github.com/BCIrealm087/elmychat/actions/runs/37565575785), commit `96d3a31`, passed all four protocol/HTTP tests and both browser tests on Linux and Windows on 2026-10-07 UTC. The run includes per-platform JSON reports and screenshots. The browser is Chrome for Testing `153.0.8010.12`, CDP `1.3`, driven by pinned Playwright `1.63.0` with Node 22. The Linux report records a 420x600 viewport, two 66px-high boxes at y=12 and y=198, and exactly 120px of transparent gap. Both isolation modes assert their actual attachment types before passing.

The local browser installer initially returned HTML instead of the Chromium ZIP. The exact pinned Chrome build was retrieved from official Chrome storage, but this execution container denies the Unix socket used by Chromium's process singleton (`socket() failed: Operation not permitted`), preventing browser launch. No browser test was skipped or called successful because of that environment problem; rendering evidence comes from CI.

The first CI runs caught empty `style` attributes returning after CSSOM-based temporary edits, even though the CSS declarations were cleared. The probe now applies attribute snapshots instead, and restoration checks compare both original attributes and declarations. Original roots and descendants remain intact throughout.

## Native OBS observation — 2026-10-07

The operator reported using the latest OBS on Windows; an exact OBS version number was not supplied. The native report identifies embedded Chromium as `Chrome/127.0.6533.120`, CDP `1.3`. Both sources attached through `iframe-target` sessions with 800x600 document viewports. The text selectors matched native roots and the immediate placement checks retained the selected nodes and descendants.

Twitch measured 783x49.59375 and was placed at y=12 with width 800. YouTube measured 783x32 and was placed at y=181.59375 with width 800, giving the requested 120px gap. The report returned `geometry-passed`. The operator saw both messages with the scene Color Source showing through; the supplied screenshot also shows two native message presentations over the green source with clear space between them. Ctrl+C restored the original layout.

Persistence was inconsistent across repeated probes: the second message commonly disappeared after about one second; the first sometimes remained or disappeared after roughly 5–10 seconds. Other attempts lost both messages or briefly showed only one. The probe applies styles once and performs no ongoing observation or repair. Its initial node-identity checks do not establish later survival. Native node removal/replacement, subsequent style/layout changes, or other lifecycle behavior are possible explanations, not a diagnosed cause.

**Step 1 is complete for its bounded capability question:** native frame access, immediate positioning, rendered transparency and explicit restoration work in the tested environment. This does not establish a stable merged chat. Message lifetime, rerender interference, and ongoing visibility remain unresolved requirements for the platform adapters and coordinator (steps 3–5), which should gain automated lifecycle diagnostics/tests. Repeating this unchanged static probe is not required. Residual chrome such as the bottom scrollbar visible in the screenshot also remains adapter work; the proof is not a finished overlay.

## Step 5 automated integration — 2026-10-07

The continuous coordinator is implemented separately from this static probe. [CI run 37620747140](https://github.com/BCIrealm087/elmychat/actions/runs/37620747140), commit `fb83caa`, passed 26 Node tests and 21 browser tests on both Windows and Linux. Both real-CDP isolation modes verified reports-to-layout routing, original roots/descendants, native paint and every gap pixel, delayed resize, viewport remeasurement, removal, frame navigation, socket reconnection, page refresh, iframe unload/recreation, connected-root history retirement, foreign coordinator ownership isolation and exact reachable-document teardown restoration. `coordinator*.json/png` are included with the existing CI artifacts.

This is synthetic Chromium evidence. It does not diagnose the observed short native OBS message lifetime or establish continuous live platform compatibility. The [coordinator setup and one bounded persistence/refresh check](coordinator.md) are ready; that critical native gate remains open. No repeat of the unchanged static probe is required.

## Automated commands

```sh
npm ci
npx playwright install chromium --no-shell
npm run check:all
npm run proof:synthetic
```

Linux systems lacking browser libraries can use `npx playwright install --with-deps chromium --no-shell`. CI does this automatically. Playwright is a dev dependency; the runtime CDP transport uses Node's built-in WebSocket. Synthetic reports and screenshots are written under `.runtime/proof/`, ignored by git and uploaded as CI artifacts.

The fixture page is explicitly synthetic. Its messages, colors, and decorations are test content; it is not a Twitch/YouTube rendering reproduction. Both source hostnames are mapped to loopback only in the controlled test browser. Tests check the same-origin restriction still blocks ordinary parent DOM access and do not use `--disable-web-security`.

## Bounded native gate

This check is needed because synthetic Chromium cannot prove platform frame policies/selectors or OBS/CEF scene compositing. Failure here could invalidate the core architecture. Prepare the automated proof first; the user performs the live check when ready.

1. Start the local coordinator with `npm start`. Use a Twitch channel and an active YouTube live video with at least one visible text message each. Add a Browser Source using `http://127.0.0.1:3210/proof?twitch=CHANNEL&youtube=VIDEO_ID`, with a viewport large enough for both boxes and the gap (420x800 is a starting point). The page builds `parent` and `embed_domain` from its own hostname. Domain-policy acceptance on loopback remains a question to test.
2. Enable OBS remote debugging on loopback when launching OBS. OBS's official debugging guide documents `--remote-debugging-port=9222` and the origin allowlist flag for browser DevTools. This Node client does not send a browser Origin header; record a WebSocket connection failure rather than adding a wildcard allowlist or disabling web security. This is CDP, not the separate obs-websocket control service. The tool does not restart OBS.
3. Run `npm run proof:targets -- http://127.0.0.1:9222`. Copy `docs/native-proof.example.json` to `.runtime/native-proof.json`, replace `targetUrl` with the exact Browser Source URL (or use the listed `targetId`), and retain the two source URL prefixes. The supplied selectors are provisional text-message candidates, not verified live adapter support. If the frames load but a selector misses, record that failure; inspect the native message root before changing it.
4. Run `npm run proof:native -- .runtime/native-proof.json`. The JSON report records the CEF browser/protocol version, attachment mode, measured native dimensions, placements, or a precise blocked reason. Add the OBS version to the operator record separately. Reports contain no message text or HTML, though discovery URLs/titles can reveal source identifiers and should stay local.
5. Observe one genuine message from each platform with the empty gap between them; put an ordinary scene source underneath to check that the gap shows through. Then press Ctrl+C and confirm normal chat presentation returns. Record OBS version, browser version, iframe loading, geometry result, visible composition/alpha, teardown result, and any blocker. Geometry success alone is not a rendered-alpha pass.

If the frame navigates, the selected node disappears, or native layout rerenders during the static proof, stop and rerun rather than treating that as successful ongoing-chat support. A failed connection cannot restore styles remotely; refreshing the proof source restores the original documents. The probe restores the initial inline-style snapshot, so keep the check brief and do not run it against an operational scene.

## Primary references

- [OBS Browser Source](https://obsproject.com/kb/browser-source): CEF basis and transparent source CSS.
- [OBS browser debugging guide](https://github.com/obsproject/obs-studio/wiki/Browser-source-development-and-debugging): remote debugging flags.
- [Twitch chat embedding](https://dev.twitch.tv/docs/embed/chat/): native chat iframe and required parent parameter.
- [YouTube live chat embedding](https://support.google.com/youtube/answer/2524549): live video ID and matching embed domain.
- [CDP Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/) and [Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/): frame attachment and context evaluation.
- [Playwright browser installation](https://playwright.dev/docs/browsers): version-specific browser downloads and system dependencies.

## Step 5 live startup blocker — 2026-10-07

The operator health report connected to OBS and showed Twitch running with 57 measured roots, but YouTube failed during injection with the combined document/ResizeObserver readiness error. This is not a passed continuous native gate. Startup now waits for a missing source body without latching that transient condition, rechecks readiness at installation, and reports a missing ResizeObserver separately. Node and real-CDP regression coverage includes a document becoming ready in the same context. Fix verification is tracked in CI; live persistence remains open.

## Step 5 continuous native observation — 2026-10-07

Following the readiness fix, the operator reported combined Twitch/YouTube scrolling behaving correctly, visible native emotes, scene transparency, Browser Source refresh recovery after a short unmeasured delay, and apparent native-layout restoration on Ctrl+C. OBS was again described as latest on Windows; its exact version was not supplied. The new coordinator reports contain no browser/protocol version, so the earlier CEF 127 observation is not reasserted as freshly measured here.

The supplied `coordinator-before-stop.json` records `status: connected`, `chatConnected: true`, `lastError: null` at cycle 2839, with both source adapters running and neither waiting for a container. The shared viewport is 800×600. The retained layout contains 393 measured native entries: 143 Twitch and 250 YouTube, matching the reported tracked-root counts. Its sequence reaches 1004. The four visible entries at that snapshot are Twitch messages, each 800×30 at y=120, 270, 420 and 570, giving 120px gaps. Both platforms have retained entries; the snapshot alone does not demonstrate simultaneous mixed-source pixels. The operator's observation supplies the rendered combined-chat, emote and scene-alpha evidence.

The supplied `coordinator-after-stop.json` records `status: stopped`, `chatConnected: false`, `lastError: null` at cycle 2930. Source retirement reasons are `teardown`, there are no remaining placements, and both source cleanup results have `restored: true`. This agrees with the operator's restoration observation. The before/after snapshots are not a refresh timeline or a measured duration record; refresh recovery and its brief delay are operator-reported.

**Step 5 is complete for its bounded end-to-end gate:** ongoing native composition, rendered alpha/emotes, refresh recovery and graceful restoration were observed in the tested setup. The previous static-probe disappearance was not reported in this continuous test, but its original cause has not been established. This does not prove prolonged stability, all OBS versions, special paid/membership/gift behavior, live native identity recycling, or recovery after abrupt process loss. Those support limits remain explicit. No repeat of this gate is needed to begin step 6.

The startup fix and synthetic regressions passed all 27 Node tests and 21 browser tests on Windows/Linux in [CI run 37628199537](https://github.com/BCIrealm087/elmychat/actions/runs/37628199537), commit `2e98bad`. Raw operator runtime reports remain outside git; this note preserves the relevant findings.
