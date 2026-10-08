# Enhanced native content (step 10)

Step 10 preserves a message's local identity and arrival sequence when Twitch's FFZ renderer identifies an enhancement update. Elmychat continues measuring and positioning renderer-owned hosts inside Twitch's document. It never rebuilds text/emotes, clones hosts, moves descendants or writes invented platform keys. Provider choices still use step 9's explicit JSON; saved controls are step 11 work.

## Identity contract

The Twitch-only reader uses the inspected FFZ `site.fine` API: `searchParent(node, 'chat-line', 12, 0, false)`, then `getChildNode(instance, 3, false)`. Only an exact host match can supply `instance.props.message.id`; ancestors and inline copies cannot identify a host. IDs must be nonempty strings of at most 512 characters. Missing methods/wrappers, exceptions and incompatible hosts fall back to the existing conservative policy. No React internals are scanned by Elmychat.

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

The step 8 live reports establish basic 7TV/BTTV rendering in OBS 32.2.2 / CEF 127 and show FFZ replacing original hosts. They do not establish live continuity through the new Fine reader, exact enhanced typography, every provider category, personal emotes, cosmetics or prolonged stability. The automatic step 10 regressions establish our bounded identity/geometry behavior, not those additional live claims. Appearance/profile isolation remains step 12 work. Original DOM-object retention is still not claimed.

## Verification

`test/twitch-identity.test.js` covers capability failure, exact-host matching and ID validation. `test/browser/enhanced-content.test.js` covers the behavior above with deterministic native renderer fixtures and real CDP transports. Run `npm run check:all` with installed Chromium; existing native lifecycle, render-stability, ASCII-art and origin-mark suites are required regressions. Local Node checks passed; the local browser attempt was blocked by missing Chromium, so completed Windows/Linux CI is the browser verification authority.
