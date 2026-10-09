# Emote compatibility and teardown (step 12)

Step 12 hardens the normal Twitch enhancement path. Twitch/FFZ still owns content and message hosts; Elmychat measures and positions them. YouTube, arrival ordering and transparent spacers remain in their existing modules. This is bounded automated compatibility work, not a new live OBS/provider-category guarantee.

## Isolated settings before initialization

`packages/adapters/twitch/settings-isolation.js` registers one dynamic FFZ provider before appending the fixed bootstrap. The provider stores JSON values in memory in the selected document. It never reads/writes shared FFZ profiles, localStorage or IndexedDB, sends storage events, or transfers settings to another provider. A single local profile contains our reviewed appearance policy. Stored enabled add-ons and imported profiles are not loaded into it. Public emote sets remain resolved by FFZ/add-ons.

The audited FFZ embedded-chat provider selection ignores the stored provider choice, sorts supported providers by priority and checks `hasContent()`. Our provider has the highest priority and reports local content. The wrapper verifies actual provider identity before enabling add-ons and again on each readiness check. If upstream does not select it, required APIs/settings disappear, a profile is disabled, or the policy changes, enhancement fails with a compatibility reason and follows the existing one-reset recovery boundary. It does not switch shared providers or rewrite user preferences as a fallback. Existing provider registrations and competing enhancers block installation rather than being replaced.

The isolated provider is bounded to 256 entries, 64 KiB of retained UTF-8 key/value JSON and 4 KiB per ordinary additional key/value. Only the reviewed `cfg-seen` and `cfg-collapsed` settings-menu metadata keys may retain up to 32 KiB each, within the same total and entry bounds. A UI metadata write that exceeds any bound is dropped atomically, preserving the previous value and incrementing `uiWritesDropped` (saturated at 1000000). It does not affect readiness or protected appearance values. Other capacity pressure remains an explicit compatibility failure. Keys are at most 256 characters. Policy/profile seeds are immutable through provider operations; scratch values are copied on read and released on stop. These bounds do not cap upstream DOM, downloads, media, sockets, browser memory or serialization/CPU work outside our retained state.

The original uniform 4 KiB limit caused a startup regression. The retained operator report identifies a capacity failure; a local DOM harness with the current CDN engine reproduces the same failure when `main_menu.getSettingsTree()` writes a 9310-byte `cfg-seen` list for 356 settings. The audited [menu implementation](https://github.com/FrankerFaceZ/FrankerFaceZ/blob/7c950ab521824f659093135f2acb662bc2e8388e/src/modules/main_menu/index.js) initializes seen/collapsed UI lists automatically; their retention does not select profiles, add-ons or emote data. With the corrected provider, that same menu builds and the appearance policy verifies. The live report does not expose the rejected key or value, and this DOM harness cannot verify OBS rendering. The synthetic fixture now includes a startup list larger than 4 KiB before add-on loading; Node tests cover both ordinary strict limits and optional UI value/entry/total pressure.

## Appearance audit and policy

Only the following reviewed settings differ from FFZ/add-on defaults. Diagnostics records each registered setting's literal prior default (or `structured-or-computed`) and the applied value, with at most 13 records. This records upstream defaults in a fresh local provider, not private values from a user's saved profiles.

| Settings | Local policy | Purpose |
| --- | --- | --- |
| `chat.rich.enabled` | false | Avoid new rich-content cards in ordinary messages. |
| `chat.subs.native` | true | Retain native subscription handling; unsupported special roots remain unsupported. |
| `chat.badges.custom-mod`, `chat.badges.custom-vip` | false | Preserve Twitch moderator/VIP badges. |
| `chat.badges.unify-bot-badge` | 0 | Avoid replacing the native bot badge. |
| `chat.badges.fix-colors` | false | Avoid additional FFZ badge recoloring. |
| `chat.badges.hidden` | Hide FFZ and reviewed add-on categories | Keep native Twitch badges visible while suppressing added badges, including unconditional BTTV/core badge data. |
| 7TV `nametag_paints`, `nametag_paints_drop_shadows`, `badges`, `animated_avatars` | false when 7TV is selected | Enable emotes without these extra cosmetics. |
| BTTV `pro_badges`, `update_messages` | false when BTTV is selected | Suppress extra Pro badges and synthetic emote-update messages. |

No custom font, font size, line-height, row-padding, border, username format, emote alignment or source-priority profile is imported. The audited default font size of 14 and empty font family keep FFZ's optional chat-font CSS tweak off; its default row padding/borders/alternate-background tweaks are off. Elmychat does not force descendant typography to fixed values. The adapter retains its native 340px wrapping cap, origin gutter, root paint/clip ownership and ancestor transparency rules. FFZ's base stylesheet still affects emote margins/vertical alignment and some unsupported notices/ancestor overflow. Upstream renderer/stylesheet changes can still affect appearance; exact unmodified-Twitch pixel equivalence and custom Twitch appearance parity are not claimed.

Browser fixtures check native badge membership, root/ancestor fonts, line height, margins, padding and transparency while both providers are active. Existing ASCII-art, icon, enhanced-layout, clipping, paint and spacer-pixel tests remain required. Fixtures model the reviewed settings contract; they are not a copy of upstream rendering.

## Bounded diagnostics and ownership

Provider data counting scans at most 2048 set properties and 20000 emote properties per poll. `countsTruncated` reports capped counts; it does not make a loaded module fail. No emote names, message text or set objects are retained in diagnostics. The Node boundary keeps only known bounded fields, at most two provider summaries, capped strings and at most 16 appearance records; nested health snapshots are detached copies. Ready documents retain the existing five-second check interval. Native cycles, HTTP/control queues and report buffers keep their prior bounds.

The version-2 compatibility wrapper keeps the stable marker name so it detects older/foreign wrappers. Reconnect can adopt only the current wrapper version with matching owner, exact document and choices. Each generation still checks the native session. A changed engine instance, standalone provider or proof marker after startup is a competing-enhancer failure. Channel navigation cannot carry our loader into an unselected document, publish old callbacks, stop a new owner, or refresh a different channel.

## Stop, late chunks and reload

Stop cancels the worker, loading timer and script callbacks and removes our bootstrap element. Native adapter teardown restores its owned presentation styles and removes its icon/admission layers. The provider drops scratch values and refuses further writes while retaining its small immutable policy for any remaining FFZ hooks. Its global registration is restored only when still ours and safely removable.

If execution was rejected before append, the registration is removed immediately. If FFZ's dependent chunk may still initialize after stop, one inert bounded registration remains until that chunk selects the memory provider or the document is reloaded. This prevents late upstream initialization from falling back to shared profiles; it creates no new Elmychat timer or retry work. Diagnostics exposes `registrationRetained`. Foreign replacement values/descriptors are not overwritten during cleanup.

Provider/engine hooks, sockets, renderer changes and upstream styles may remain. No full disable/unload or restoration of original pre-FFZ DOM objects is claimed. A selected Twitch-only reload is the clean reset boundary. The existing lifecycle permits one owned partial-failure recovery, then pauses enhancement while native chat resumes. It never reloads OBS, the overlay shell, YouTube or another tab. Destroyed/unreachable contexts cannot confirm cleanup.

## Upstream audit, loading and licenses

Source audit on 2026-10-08:

- [FFZ commit `7c950ab`](https://github.com/FrankerFaceZ/FrankerFaceZ/tree/7c950ab521824f659093135f2acb662bc2e8388e): `src/settings/index.ts` dynamic registration/provider selection, `providers.ts` contract, `profile.ts` / `context.ts` profile lookup; Twitch chat CSS/settings and core badge handling.
- [Add-ons commit `8336c98`](https://github.com/FrankerFaceZ/Add-Ons/tree/8336c984f8957c9f674b3017d2c2ccbffba483fe): 7TV cosmetic settings, BTTV update/Pro settings and unconditional BTTV/core badge registration. Audited manifests remain 7TV 1.4.34 and BTTV 3.3.24, with `ffzap-core` required for BTTV.
- [FFZ license](https://github.com/FrankerFaceZ/FrankerFaceZ/blob/7c950ab521824f659093135f2acb662bc2e8388e/LICENSE): Apache License 2.0. The audited Add-Ons tree/manifests do not establish a single repository-wide license for every add-on or provider asset. Do not infer that FFZ's license covers those resources.

Only the fixed remote FFZ bootstrap is downloaded/hashed by Node; the actual browser request must match that SRI hash. A runtime reuses that bootstrap integrity across fresh Twitch generations. A new runtime downloads a fresh hash. FFZ's bootstrap then loads an independently mutable engine chunk, and the engine loads add-on chunks/media. The hash and this source audit do not pin those dependencies. Changed APIs/policy fail through capability checks; no automatic web-security/CSP weakening or cross-provider fallback is used. Upstream requests/authentication remain in the selected browser session.

No FFZ/add-on implementation or provider emote/media asset is copied into Elmychat. The contract fixture and memory provider are our code. Source-checkout distribution remains unchanged; packaging, vendoring, redistribution rights, third-party asset permissions and Elmychat's own license need a separate decision before a release. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Automatic verification and remaining evidence

Node tests cover distinct documents, immutable/copying settings, foreign registrations/descriptors, missing APIs/settings, capacity, late initialization, cleanup and bounded/detached health snapshots. Browser tests cover local appearance, unchanged shared fixture preferences, unsupported isolation, capped counts and competing enhancement. Both real-CDP transports exercise 800 rolling native arrivals, 20 idle cycles, three transport reconnects, channel isolation, one conflict recovery and final native restoration while retaining YouTube identities/session, gap and a spacer. CI writes `emote-hardening-page.json` / `emote-hardening-oopif.json`. Existing native hardening and enhancement failure suites remain required.

Local Node checks are available; local Chromium is absent, so the browser command fails at launch and Windows/Linux CI supplies browser verification. The bounded live basic-rendering and identity evidence remains in [emote proof](emote-proof.md) and [enhanced content](enhanced-content.md). The legacy opt-in proof still reports its original profile/cosmetic limitations and does not verify this new isolated provider. The Apply follow-up was operator-confirmed working before step 12. Actual live isolated appearance/API selection, broader OBS versions, prolonged use and provider-specific animation/stacking/personal categories remain unverified; consolidate support claims in step 13 without treating synthetic readiness as live image evidence.
