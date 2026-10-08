# Twitch emote compatibility diagnostic (step 8)

Status: diagnostic implemented; actual FFZ/Twitch/OBS compatibility remains pending. This is an opt-in development proof, not the future provider controls. Existing operator settings and normal startup do not enable emote enhancement.

## One bounded live check

Keep Elmychat running with `npm start`, native chat connected, and the managed `/overlay` Browser Source visible in OBS. Wait for a few ordinary Twitch messages. Open a second terminal in the project directory. The diagnostic reads your existing saved channel, debugging port and selected Browser Source:

```sh
npm run proof:emotes -- 7tv
npm run proof:emotes -- reset
npm run proof:emotes -- bttv
npm run proof:emotes -- reset
npm run proof:emotes -- both
npm run proof:emotes -- reset
```

Run each command separately. Each provider run lasts 60 seconds. During that window, use known enabled channel/global emotes for the requested provider and ordinary text with native badges. Include the E ASCII art and, where available, static, animated, wide and stacked/overlay emotes. Watch OBS for preserved text/badges, wrapping, order, height changes, transparent gaps and platform icons. Use the existing spacer controls if useful. The diagnostic never sends chat messages.

After each run, `reset` requests a refresh of only the managed Twitch iframe. Wait for Twitch to reconnect and new ordinary messages before starting the next mode. This clears its retained chat history. YouTube, the coordinator and current-run spacers stay active. Reset is explicit, restricted to the selected overlay's `#twitch` iframe, and refused unless this document contains a stopped, owned diagnostic that requested a reset. It does not restart OBS, change the Browser Source URL, or touch another tab/dock. Ctrl+C stops the probe and writes its report; then run `reset` if requested. A crashed probe expires within three minutes, after which reset can be requested. If the debugging connection is unavailable, refreshing the Browser Source manually clears the enhancer but refreshes both chats.

The diagnostic downloads the fixed public FFZ bootstrap, hashes it and injects it with SHA-256 integrity into exactly one selected Twitch embed through existing CDP. Network access to FFZ and provider services is required. It enables `7tv-emotes`, `ffzap-bttv`, or both; BTTV also requires `ffzap-core`. It clones the add-on enabled list and requests dependencies first, each without saving, to avoid FFZ's dependency-recursion persistence behavior. It checks the saved enabled list remains unchanged. Existing engine instances/scripts and saved enabled add-ons are blockers. No web-security, CSP or Trusted Types protections are disabled.

This isolated enabled-list check is **not full FFZ profile isolation**. The upstream engine can apply default appearance, badges/cosmetics and existing Twitch-origin FFZ profiles. Those settings are observed, not overwritten, by this diagnostic; their emote-only configuration audit belongs to the following lifecycle step. Removing a script tag cannot undo upstream hooks/styles/sockets. Always reset afterward, including after a partial failure. No provider scripts or assets are bundled here.

## Evidence and outcomes

Reports and, when supported, a screenshot are saved locally to `.runtime/proof/emotes-7tv.json`, `emotes-bttv.json`, `emotes-both.json` and corresponding PNGs. Repeating a mode overwrites its previous report. These files are excluded from git; screenshots may contain chat content. JSON omits raw message text, chatter names, cookies and credentials.

Each report records the bootstrap URL, byte count and integrity, browser/protocol version, selected frame transport, native adapter session, bounded readiness samples, engine version, provider manifest/loaded versions, emote-set counts, decoded images and images inside retained baseline native hosts. Set attribution uses FFZ's `data-set` and set `__source` metadata; counting every Twitch image would create false positives. Baseline root/key/parent, typography and badge comparisons help identify native-rendering conflicts. Removed roots and changed keys are recorded separately because native removal/reuse can be legitimate. Only up to 80 baseline roots and 100 images per sampled root are examined; sampling is evidence, not a universal ownership claim.

| Outcome | Meaning |
| --- | --- |
| `loading` | Engine/add-on metadata is not ready. Script `onload` alone does not establish readiness. |
| `awaiting-render` | Enablement was requested, but requested providers have not all produced decoded, geometrically visible images in native hosts. |
| `render-observed` | Every requested provider had an enabled module and a decoded image within a current native message during at least one sample. Confirm appearance in OBS. |
| `inconclusive` | The window ended without that evidence. A quiet chat, empty set, unsupported API or an upstream rendering failure needs investigation; it is not a pass. |
| `blocked` | A scoped precondition, bootstrap, capability, dependency, preference or host-parent check failed. The reason is recorded. |
| `cancelled` | The user stopped the diagnostic before its observation window ended. |

DOM visibility counts do not prove clipping, pixel correctness, animation or scene alpha. A module-ready flag does not prove channel identity mapping or emote rendering. Bootstrap integrity pins only the fetched bootstrap, not its dependent chunks or add-ons. FFZ's remote APIs may change; unreviewed dependencies are rejected. The remaining critical step-8 evidence is the exact Twitch embed in the operator's OBS/CEF build. Record its OBS version and the three reports/screenshots, plus which emote categories and native text/badge/ASCII-art behavior were observed. Until then, no live category, full lifecycle, production toggle or compatibility claim is complete.

For an explicitly configured managed overlay, supply a local JSON file as a second argument:

```json
{
  "endpoint": "http://127.0.0.1:9222",
  "targetUrl": "http://127.0.0.1:3210/overlay",
  "channel": "your_channel",
  "durationMs": 60000
}
```

Add `targetId` if matching overlay URLs repeat. Duration is limited to 1–120 seconds. Arbitrary remote targets or custom script URLs are not accepted.

## Automated verification

`test/emote-proof.test.js` covers selection, loopback/config validation, bootstrap hashing/size/failure, native-connection preconditions, incomplete rendering and cleanup. `test/browser/emote-proof.test.js` uses a deterministic FFZ API shim, not mutable upstream scripts. It covers isolated iframe targets and shared page contexts, late emote sizing, retained native roots and sequence, transparent gap pixels, untouched YouTube, enabled-list persistence, source-only reset, empty rendering, unknown dependencies, existing enhancers, CSP and Trusted Types failures. Existing ASCII-art, marks and paint-stability regressions remain part of CI. Fixture success establishes our transport/layout contract, not actual FFZ compatibility.

The initial diagnostic and all regressions passed [Windows/Linux CI run 37713051190](https://github.com/BCIrealm087/elmychat/actions/runs/37713051190), with 47 Node and 34 browser tests per OS. Chromium was unavailable in the local development environment; browser verification came from CI. The subsequent cleanup refinement releases the diagnostic marker when Trusted Types rejects the script before it can be appended; accepted/partially executed loaders still require a source refresh.

See [the roadmap](emote-support-roadmap.md) and its primary upstream source links. This wrapper checks the inspected FFZ singleton/add-on/emote APIs; it does not copy the upstream implementation.
