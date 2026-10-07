# Native pair feasibility proof

## What this step establishes

The tool discovers one explicitly selected local debugging target, finds the two source document contexts, measures one visible message in each, and positions the original native roots with a 120px transparent gap. It leaves native descendants in their owning document and does not copy HTML or recreate message rendering. Ctrl+C restores the inline styles changed by the probe and disconnects without closing OBS or navigating the source.

This is deliberately a static pair diagnostic. It does not observe live arrivals, implement global ordering, handle continued rerenders/resizes, provide a settings UI, or replace the future platform adapters/compositor.

## Evidence and status

| Question | Verification | Status |
| --- | --- | --- |
| Scoped command routing, disconnect rejection, explicit target selection, and context retirement | Node behavioral tests | Passed locally |
| Cross-origin access without disabling web security | Synthetic Chromium frames with different sites | Passed in Linux and Windows CI |
| Separate iframe sessions and multiple contexts on one session | Two browser isolation modes, with assertions on actual session types | Passed in Linux and Windows CI |
| Original root/descendant identity and native paint through overlapping frames | DOM identity checks and screenshot pixel checks | Passed in Linux and Windows CI |
| Arbitrary transparent spacing and removal of surrounding chrome | Check every pixel of the 120px gap and sample native message/background pixels | Passed in Linux and Windows CI |
| Style restoration | Compare original inline attributes/declarations after teardown, including existing inline styles | Passed in Linux and Windows CI |
| Actual Twitch/YouTube embedding, selectors, OBS/CEF target support and final scene alpha | Native pair in the intended OBS version | Unverified; critical live gate |

Recorded automated evidence: [CI run 37565575785](https://github.com/BCIrealm087/elmychat/actions/runs/37565575785), commit `96d3a31`, passed all four protocol/HTTP tests and both browser tests on Linux and Windows on 2026-10-07 UTC. The run includes per-platform JSON reports and screenshots. The browser is Chrome for Testing `153.0.8010.12`, CDP `1.3`, driven by pinned Playwright `1.63.0` with Node 22. The Linux report records a 420x600 viewport, two 66px-high boxes at y=12 and y=198, and exactly 120px of transparent gap. Both isolation modes assert their actual attachment types before passing.

The local browser installer initially returned HTML instead of the Chromium ZIP. The exact pinned Chrome build was retrieved from official Chrome storage, but this execution container denies the Unix socket used by Chromium's process singleton (`socket() failed: Operation not permitted`), preventing browser launch. No browser test was skipped or called successful because of that environment problem; rendering evidence comes from CI.

The first CI runs caught empty `style` attributes returning after CSSOM-based temporary edits, even though the CSS declarations were cleared. The probe now applies attribute snapshots instead, and restoration checks compare both original attributes and declarations. Original roots and descendants remain intact throughout.

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
