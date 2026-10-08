# Elmychat

Elmychat is an experimental local chat compositor for OBS. The goal is to combine Twitch and YouTube chat in one chronological view while preserving each platform's native rendering, including emotes, badges, replies, and special messages. Arbitrary transparent spacing between messages is part of the design.

**Status:** the initial development milestone (steps 0–7) is complete for its bounded scope. Native composition was observed in OBS, including merged scrolling, emotes/transparency, refresh recovery and restoration. Saved source configuration, the managed overlay, live gaps/spacers and resource/lifecycle hardening passed all **66 automated tests per OS** in Windows/Linux [CI run 37676706252](https://github.com/BCIrealm087/elmychat/actions/runs/37676706252). See the [operator workflow](docs/operator-controls.md) and [hardening evidence and support limits](docs/hardening.md).

Prolonged live stability and broader OBS compatibility remain unverified. Twitch special rows are unsupported; YouTube special roots and native identity-recycling policies retain synthetic coverage only. The earlier static-probe persistence issue remains undiagnosed, while the bounded continuous gate passed. See [proof evidence](docs/feasibility-proof.md), the [compositor contract](packages/compositor/README.md), [Twitch support](packages/adapters/twitch/README.md), and [YouTube support](packages/adapters/youtube/README.md).

## Development

Repository: `BCIrealm087/elmychat`. Current development branch: **`codex-improvements`**. The default branch and pull-request merge target is **`master`**.

Install Node.js 22 or newer, then run these commands from the repository root (PowerShell, Bash, or another terminal):

```sh
git switch codex-improvements
npm ci
npm run check
npm start
```

Open <http://127.0.0.1:3210/> for the local controls. Enter your Twitch channel and YouTube video, save and connect, then use <http://127.0.0.1:3210/overlay> in OBS. Source changes update that overlay automatically; gap/spacer controls apply live. Launch OBS with browser debugging enabled on the configured port. Settings are saved under `.runtime/operator.json`. See the [operator workflow](docs/operator-controls.md). Press Ctrl+C for graceful cleanup. Playwright and PNG parsing remain development-only dependencies.

The controls page is separate from the transparent managed overlay. The separate `/proof?twitch=CHANNEL&youtube=VIDEO_ID` page loads the two native chat embeds for the bounded diagnostic. Read the [proof procedure and limits](docs/feasibility-proof.md) before using it. Loading either page alone does not demonstrate native composition.

## Directory structure

| Path | Responsibility |
| --- | --- |
| `apps/coordinator/src/` | Local HTTP entry point; selected browser sessions and lifecycle orchestration |
| `apps/overlay/` | Transparent page loaded by the OBS Browser Source |
| `packages/compositor/` | Pure platform-independent ordering, rectangles, spacers, visibility, and bounded history |
| `packages/adapters/twitch/` | Injected Twitch text-root lifecycle, measurement, positioning, clipping and teardown |
| `packages/adapters/youtube/` | Injected YouTube text/special host candidates, scoped discovery and native positioning |
| `packages/adapters/native-runtime.js` | Shared bounded observer, measurement, style ownership, reports and teardown |
| `packages/browser-control/` | Scoped CDP target/context access and native one-box probe |
| `test/` | Automated behavioral tests |
| `test/fixtures/` | Synthetic DOM fixtures |
| `scripts/` | Development checks and bounded feasibility harnesses |
| `docs/` | Architecture, development guidance, and roadmap |
| `.github/workflows/` | CI for the development branch |

These directories define boundaries within one npm project. They are not separate published packages or workspaces yet.

## Proposed approach

Keep each chat's native message elements inside its own document. Give both surfaces transparent backgrounds and place them over the same viewport. The local coordinator uses Chrome DevTools Protocol (CDP) to inject a platform-specific adapter into each context. Adapters report native message measurements; a shared compositor calculates positions and spacers, then sends positions back to the owning adapter.

Initial ordering uses arrival at the coordinator, with a monotonic sequence to break ties. Platform send-time ordering is a separate future decision. The compositor must not copy message HTML or recreate platform rendering.

The first milestone proved bounded native composition in OBS: attach to both native chat contexts, detect and measure one message from each, and position them with a transparent gap in a single view. The pure compositor now defines the layout policy for the adapters. The continuous adapters and coordinator now implement message lifecycle, clipping, native-layout interference and target recovery for the documented bounded scope.

For continuous composition, run `npm start -- .runtime/coordinator.json` using the [coordinator setup and lifecycle contract](docs/coordinator.md). `/native?twitch=CHANNEL&youtube=VIDEO_ID` loads the native surface; loading it alone does not install the adapters.

Read [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [development guidance](docs/development.md). Contributor and agent rules are in [AGENTS.md](AGENTS.md).

## Scope

Windows and OBS are the initial operator target; keep the development tooling portable. Elmychat is a separate project from Elmybot and requires no bot integration to begin. The local settings UI is implemented. This milestone retains the Node/source-checkout workflow; installers, packaged releases, OAuth and additional platforms require separately selected future scope.

No redistribution license has been selected yet.

The next planned priority after native rendering is [optional 7TV/BTTV support](docs/emote-support-roadmap.md). That roadmap is not implemented; there is currently no emote-provider toggle.
