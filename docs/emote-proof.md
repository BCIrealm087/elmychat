# Twitch emote compatibility diagnostic (step 8)

Status: diagnostic implemented; bounded provider rendering and operator-confirmed reset establish the FFZ route for lifecycle work in OBS 32.2.2 / CEF 127. Original-host retention was not achieved; category and identity/layout limits are recorded below. This is an opt-in development proof, not the future provider controls. Existing operator settings and normal startup do not enable emote enhancement. Step 9 adds a separate [explicit-JSON lifecycle](twitch-enhancement.md); do not run this diagnostic in a document already owned by that lifecycle.

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

The public bootstrap currently redirects from `/script/script.min.js` to `/static/script.min.js` (HTTP 302, observed 2026-10-08 UTC). The downloader follows up to three redirects within `https://cdn.frankerfacez.com`, with one 30-second deadline, and records the resolved URL and redirect chain. Other origins, HTTP downgrades and credentials in redirect URLs are rejected. The hash covers the final script bytes. A download failure records its stage, CDN URL and bounded underlying error codes (including DNS, TLS and connection timeouts). It occurs before attaching to OBS, so it needs no Twitch reset. Certificates and browser security remain enforced. Preparation time precedes the 60-second observation window.

This isolated enabled-list check is **not full FFZ profile isolation**. The upstream engine can apply default appearance, badges/cosmetics and existing Twitch-origin FFZ profiles. Those settings are observed, not overwritten, by this diagnostic; their appearance/isolation audit remains step 12 work before final support. Removing a script tag cannot undo upstream hooks/styles/sockets. Always reset afterward, including after a partial failure. No provider scripts or assets are bundled here.

## Evidence and outcomes

Reports and, when supported, a screenshot are saved locally to `.runtime/proof/emotes-7tv.json`, `emotes-bttv.json`, `emotes-both.json` and corresponding PNGs. Repeating a mode overwrites its previous report. These files are excluded from git; screenshots may contain chat content. JSON omits raw message text, chatter names, cookies and credentials.

Each report records the bootstrap URL, byte count and integrity, browser/protocol version, selected frame transport, native adapter session, bounded readiness samples, engine version, provider manifest/loaded versions, emote-set counts, decoded images and images inside retained baseline native hosts. Set attribution uses FFZ's `data-set` and set `__source` metadata; counting every Twitch image would create false positives. Baseline root/key/parent, typography and badge comparisons help identify native-rendering conflicts. Removed roots and changed keys are recorded separately because native removal/reuse can be legitimate. Only up to 80 baseline roots and 100 images per sampled root are examined; sampling is evidence, not a universal ownership claim.

Samples and terminal progress also show the native adapter's `rendererIdentifiedRoots` and `identityTransfers` counts (terminal labels `identified` / `transfers`). These distinguish a working FFZ identity reader from provider images alone; a positive identified count is a prerequisite for the enhanced continuity check, while zero transfers can mean that no host remount occurred. Normal unenhanced chat and YouTube can legitimately have zero counts. See [the corrected Fine lookup and live follow-up](enhanced-content.md#live-follow-up-2026-10-08).

Reports also record `hosts` (current ordinary roots, native versus enhanced selector matches and sampled visibility) and `nativeAdapter` (status, failure, tracked/retired roots and layout revision). The terminal shows host/visibility counts alongside provider readiness. A failed native adapter blocks the diagnostic instead of silently waiting for emotes. FFZ's add-on status/version getters are called only after its manifest recognizes the ID; the engine can exist before metadata arrives.

FFZ's inspected ChatLine renderer uses `div.chat-line__message[data-room-id]` and omits Twitch's `data-a-target` marker. It can replace baseline DOM hosts during startup. The Twitch adapter and proof now share ordinary-host selectors for both renderers, excluding FFZ inline notice copies, notices and extension messages. Elmychat positions the current renderer-owned hosts in the original Twitch document; it does not recreate or reparent them. The proof explicitly warns when baseline references are gone but new supported hosts exist. That situation does **not** establish original-node retention, even if images render. Room/user attributes are not message identities. Unkeyed content replacement retains the conservative new-arrival policy. Step 10 adds [bounded renderer-identified continuity](enhanced-content.md); its automatic coverage does not change this diagnostic’s historical live evidence.

| Outcome | Meaning |
| --- | --- |
| `loading` | Engine/add-on metadata is not ready. Script `onload` alone does not establish readiness. |
| `awaiting-render` | Enablement was requested, but requested providers have not all produced decoded, geometrically visible images in native hosts. |
| `render-observed` | Every requested provider had an enabled module and a decoded image within a current native message during at least one sample. Confirm appearance in OBS. |
| `inconclusive` | The window ended without that evidence. A quiet chat, empty set, unsupported API or an upstream rendering failure needs investigation; it is not a pass. |
| `blocked` | A scoped precondition, bootstrap, capability, dependency, preference or host-parent check failed. The reason is recorded. |
| `cancelled` | The user stopped the diagnostic before its observation window ended. |

DOM visibility counts do not prove clipping, pixel correctness, animation or scene alpha. A module-ready flag does not prove channel identity mapping or emote rendering. Bootstrap integrity pins only the fetched bootstrap, not its dependent chunks or add-ons. FFZ's remote APIs may change; unreviewed dependencies are rejected. The live evidence below establishes only basic provider rendering in the tested build. No specific emote category, exact native text/badge/ASCII-art equivalence, full lifecycle or production toggle is established by that bounded result.

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

## Live finding: host transition, 2026-10-08 UTC

The operator's initial report identifies OBS 32.2.2 / CEF Chrome 127.0.6533.120, FFZ 4.82.0 and `7tv-emotes` 1.4.34. The engine/add-on loaded two sets totaling 784 emotes. All seven baseline message hosts were disconnected by the first one-second sample; none of the previous selector's images were detected. The operator observed Twitch disappear while YouTube continued, and a Twitch-only reset restored it. An earlier attempt also hit `Unknown add-on id` before metadata readiness. These are failure evidence, not a successful compatibility gate. The markup/getter corrections have automatic coverage and the subsequent live result is recorded below.

Primary selector evidence: [FFZ Twitch ChatLine](https://github.com/FrankerFaceZ/FrankerFaceZ/blob/master/src/sites/twitch-twilight/modules/chat/line.js), `ffzNewRender` ordinary host output and delayed `forceUpdate`; metadata/getter evidence: [FFZ add-on manager](https://github.com/FrankerFaceZ/FrankerFaceZ/blob/master/src/addons.ts), `hasAddon`, `isAddonExternal`, `isAddonEnabled` and `getVersion`.

## Live recheck and route decision, 2026-10-08 UTC

After the selector/readiness corrections, the operator reported that all three modes and reset worked. The supplied reports identify OBS 32.2.2, CEF Chrome 127.0.6533.120 and CDP 1.3, using the isolated iframe-target transport. Successful runs report FFZ 4.82.0 (serialized as `4.82.0.0.`). The following is sanitized aggregate evidence; runtime reports and chat screenshots are not committed.

| Report timestamp (UTC) | Mode | Recorded result |
| --- | --- | --- |
| 02:10:07.890 | 7TV | `render-observed`, 61 samples. `7tv-emotes` 1.4.34: 2 sets / 212 emotes; first positive sample has 1 decoded, visible provider image, 4 current roots, all visible, and a running adapter. |
| 02:15:39.513 | BTTV | `blocked`, no samples: existing enhancement or proof detected. This attachment does not verify the separately operator-confirmed BTTV-only success. |
| 02:18:35.067 | Both | `render-observed`, 61 samples. 7TV 1.4.34: 2 sets / 212 emotes; `ffzap-bttv` 3.3.24: 3 sets / 109 emotes. First positive sample has 1 decoded, visible image for each provider, 10 current roots / 8 visible, and a running adapter. |

Both successful runs recorded an unchanged saved enabled list and no sampled CSP violations. The loader followed one same-origin HTTP 302 from `https://cdn.frankerfacez.com/script/script.min.js` to `https://cdn.frankerfacez.com/static/script.min.js`; the 795-byte bootstrap had integrity `sha256-faQFbO/sGGT+KzeiEL/FQsCl8iBa2LlMT55QDGr7NxA=`. This pins only the observed bootstrap bytes. Set totals describe these runs, not a provider support guarantee.

All sampled baseline hosts were removed (3 in 7TV; 5 in both), along with their baseline badge nodes. Positive images were in replacement hosts matching the FFZ selector, inside the selected Twitch document, with adapter width 340px. Zero retained-host images and zero connected baseline roots mean the original-node retention criterion was not met. Unchanged typography/key counters on removed roots do not demonstrate equivalence. The combined run's last sample returned to `awaiting-render` with no visible provider images; the earlier positive sample remains the evidence, without a claim of continuous image visibility.

Diagnostic cleanup reported its work stopped and an enhancer reset still required. The operator separately confirmed reset worked; the cleanup flag itself is not proof that FFZ unloaded. The BTTV-only attachment's existing-enhancer blocker does not contradict provider images in the combined run, but is kept distinct from a passing standalone report. No additional routine live gate is required to select this route for development.

**Decision:** proceed with FFZ and its 7TV/BTTV add-ons for step 9's bounded lifecycle. Step 8's route decision is complete for basic rendering in current Twitch/FFZ-owned hosts, accepting upstream remounts rather than original DOM-object retention. Elmychat still does not clone, reparent or recreate message content. This does not establish identity continuity, exact text/badge/ASCII-art equivalence, animated/wide/overlay/personal emotes, isolated FFZ appearance settings, prolonged stability or production readiness. Those limits remain in steps 9–13.

The corrected diagnostic and regressions passed [Windows/Linux CI run 37716250460](https://github.com/BCIrealm087/elmychat/actions/runs/37716250460), with 50 Node and 37 browser tests per OS. Synthetic coverage includes delayed strict add-on metadata, FFZ host remounts, selector exclusions, current-host geometry and source-only reset; it remains distinct from the actual-loader evidence above.
