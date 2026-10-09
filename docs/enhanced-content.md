# Enhanced native content (step 10)

Step 10 preserves a message's local identity and arrival sequence when Twitch's FFZ renderer identifies an enhancement update. Elmychat continues measuring and positioning renderer-owned hosts inside Twitch's document. It never rebuilds text/emotes, clones hosts, moves descendants or writes invented platform keys. Provider choices use [saved managed controls](operator-controls.md#twitch-emotes) or step 9's explicit JSON. See [the final support matrix](emote-support.md).

## Identity contract

The Twitch-only reader uses the inspected FFZ `site.fine` API: `searchParent(node, 'chat-line', 12, 0, false)`, then `getFirstChild(instance)` and `getChildNode(child, 3, false)`. FFZ marks ChatLine components `_ffz_no_scan`; searching downward from the component itself returns no host. The explicit child accessor starts the bounded search at its rendered child without changing that upstream scan guard. Only an exact host match can supply `instance.props.message.id`; ancestors and inline copies cannot identify a host. IDs must be nonempty strings of at most 512 characters. Missing methods/wrappers, exceptions and incompatible hosts fall back to the existing conservative policy. No React internals are scanned by Elmychat.

The source basis is FFZ commit `7c950ab521824f659093135f2acb662bc2e8388e`, inspected on 2026-10-08: [ChatLine registration and updateLineById](https://github.com/FrankerFaceZ/FrankerFaceZ/blob/7c950ab521824f659093135f2acb662bc2e8388e/src/sites/twitch-twilight/modules/chat/line.js) use `props.message.id` to identify rerenders; [Fine](https://github.com/FrankerFaceZ/FrankerFaceZ/blob/7c950ab521824f659093135f2acb662bc2e8388e/src/utilities/compat/fine.ts) provides the bounded parent/host lookups. This supports the adapter contract, but does not prove that those lookups succeed in every live Twitch/CEF version. Synthetic fixtures model that API rather than downloading mutable upstream code into CI.

- A stable renderer ID allows child/text/emote/badge replacement to retain the local message ID. Geometry mutations still trigger natural measurement and resize reports.
- A disconnected host can transfer its entry to a unique replacement with the same renderer ID in the same discovery flush. Both hosts must have established renderer identity, with exactly one old and one current candidate for that key. The entry keeps sequence, placement, delivery and retirement state. An unchanged-height remount receives its prior slot immediately, without requiring an otherwise unnecessary coordinator write.
- DOM `data-id` remains an optional native heuristic. It takes precedence; a conflict with the renderer disables transfer. DOM-only keys never authorize a transfer between hosts. Room, user, username, text and DOM order are never substitute keys.
- Duplicate keys, missing APIs, unknown-to-known identity transitions, later replacements after an observed removal, and remove/reinsert of the same DOM host use the conservative removal/new-arrival policy. No detached-message archive or cross-session matching is introduced. FFZ startup can still create new arrivals if the original hosts lacked usable renderer identity.
- Existing report drains also recheck established renderer IDs. This detects host reuse with identical visible text and changed React props even without a DOM mutation. It introduces no extra timer or idle layout writes. A changed ID retires the old entry before reporting the new one.

Retired entries remain retired through a verified same-flush handoff. Ordinary removal still releases their roots. The existing root/report/history limits apply; temporary key maps are bounded by tracked roots. Native IDs stay inside the adapter. Health diagnostics expose only `rendererIdentifiedRoots` and `identityTransfers` counts. YouTube supplies no renderer reader and retains its existing identity policy.

## Layout and category boundaries

| Content | Implemented behavior / evidence |
| --- | --- |
| Static images and delayed assets | Natural height growth/shrink reports retain established identity. Paint remains clipped to the last assigned slot until relayout; gaps and spacers stay transparent. Offline SVG/image fixtures verify this. |
| Animated images | Descendant animation stays native; only host motion is disabled. An offline two-frame GIF regression checks continuing animation. This is not a provider-specific live animation guarantee. |
| Wide images and wrapping | Native dimensions and descendants remain intact. Twitch's 340px reference box and narrower viewport wrapping remain authoritative; wide paint is clipped horizontally. Elmychat does not scale provider assets. The supplied E ASCII-art regression remains in the full suite. |
| Stacked / zero-width overlays | Native in-flow boxes and overlays painting within the measured host box are supported. A zero-width fixture verifies overlapping native descendants without expanding the inline width. Out-of-flow effects extending beyond the measured box are clipped; expanding measurement to include such overhang is unsupported. |
| Rerenders and rapid arrivals | Unique verified replacements preserve sequence; actual new IDs keep arrival order. Fixtures cover ambiguity, reuse, retirement, bursts, foreign host styles and idle behavior. |
| Platform marks / cross-origin sources | Marks stay in their separate owned layer. Real-CDP page-context and OOPIF fixtures check identity/sequence, YouTube session preservation, gaps and explicit spacer alpha through Twitch remount/growth. |

The step 8 live reports establish basic 7TV/BTTV rendering in OBS 32.2.2 / CEF 127 and show FFZ replacing original hosts. They do not establish live continuity through the new Fine reader, exact enhanced typography, every provider category, personal emotes, cosmetics or prolonged stability. The automatic step 10 regressions establish our bounded identity/geometry behavior, not those additional live claims. Appearance/profile isolation is implemented in [step 12](emote-compatibility.md), with full live appearance parity still unverified. Original DOM-object retention is still not claimed.

## Verification

`test/twitch-identity.test.js` covers capability failure, exact-host matching, ID validation and FFZ's guarded-component lookup. The browser renderer fixture models that guard too: component descent returns null, while the public child accessor reaches the host. `test/browser/enhanced-content.test.js` covers the behavior above with deterministic native renderer fixtures and real CDP transports. Run `npm run check:all` with installed Chromium; existing native lifecycle, render-stability, ASCII-art and origin-mark suites are required regressions. Local Node checks passed; the local browser attempt was blocked by missing Chromium, so completed Windows/Linux CI is the browser verification authority.

### Live follow-up, 2026-10-08

The operator supplied a combined proof at 18:32:49 UTC on OBS 32.2.2 / CEF 127 with FFZ 4.82.0: 7TV 1.4.34 had decoded visible images, both provider modules were enabled, and native chat remained running. No visible BTTV image was sampled, so the combined result was correctly inconclusive. All 79 sampled original hosts were replaced by enhanced hosts. A subsequent health snapshot recorded 124 Twitch roots but zero renderer-identified roots or transfers. These files establish the live reader failure separately from working 7TV rendering; the coordinator's enhancement status was off because the proof owned the loader.

Source inspection reproduced a concrete cause: the original component-based `getChildNode` call stops at FFZ's scan guard, which our initial fixture omitted. The reader and fixtures now use/model the child-accessor contract above. The correction passed Windows/Linux [CI run 37826740965](https://github.com/BCIrealm087/elmychat/actions/runs/37826740965) at commit `dec6784`, with 61 Node and 52 browser tests per OS. The subsequent positive live count and retained-message comparison are recorded below.

The operator also observed pre-existing 7TV names remaining text after late activation while new arrivals rendered correctly. FFZ caches `msg.ffz_tokens`; its automatic reprocessing on `load_tracker:complete:chat-data` depends on `chat.update-when-loaded` and a one-shot `can_reprocess` flag in the inspected ChatLine source. Historical retokenization after provider loading is not guaranteed by our loader. Elmychat does not replace old text itself; FFZ owns tokenization/rerendering. This is a plausible explanation, not proof of those live settings or the exact cache path. Explicitly requesting an FFZ token update during the continuity check can exercise existing messages once the corrected reader is active.

### Positive live reader and retained-identity check, 2026-10-08

After updating the reader, the operator confirmed a positive identified-root count, selected the Twitch iframe in OBS remote DevTools and ran the FFZ token-update snippet. The supplied `identity-before(1).json` and `identity-after.json` snapshots span ordinary arrivals as well as that requested update; they are not a mutation trace of the command itself. Both snapshots retain the same selected target, Twitch session and YouTube session, with healthy native sources and an 800x600 shared viewport. The operator reported no noticeable visual change and continuing correct-looking 7TV emotes.

| Observation | Before | After | Bounded conclusion |
| --- | --- | --- | --- |
| Twitch tracked / renderer-identified roots | 4 / 4 | 66 / 66 | The corrected reader identifies every tracked ordinary Twitch host at both endpoints. |
| Twitch identity transfers | 2 | 2 | Two renderer-verified handoffs had already occurred before the baseline. No additional handoff was recorded during the interval; the requested update is not a demonstrated remount. |
| Twitch removals | 2 | 2 | No additional removal was recorded across the snapshots. |
| Baseline Twitch identities | 4 messages | All 4 retained | Local IDs and compositor sequences are unchanged. The 62 later messages are additional arrivals. |
| One retained Twitch measurement | 30.1875px | 31.1875px | That entry retained identity and sequence through a height change; the snapshots cannot attribute the resize to a specific mutation. |
| Baseline YouTube identities | 190 messages | All 190 retained | Their local IDs and sequences are unchanged; the session was preserved. |
| Explicit spacers | None | None | This live interval did not exercise spacer preservation. |

Both reported layouts contain no overlapping adjacent message rectangles. Layout geometry is not pixel/alpha proof. This check establishes bounded live reader operation and retained-identity continuity in the operator's existing OBS setup, plus adapter-reported handoffs before the baseline. It does not establish which DOM descendants changed on the explicit rerender, exact message-specific handoff attribution, original DOM-object retention, all enhancement categories, or prolonged stability. No repeat manual gate is required for step 10; retain automatic coverage and these limits for later work.
