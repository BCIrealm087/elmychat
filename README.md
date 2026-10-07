# Elmychat

Elmychat is an experimental local chat compositor for OBS. The goal is to combine Twitch and YouTube chat in one chronological view while preserving each platform's native rendering, including emotes, badges, replies, and special messages. Arbitrary transparent spacing between messages is part of the design.

**Status:** bounded native composition proved in OBS; the pure compositor and both platform adapters are implemented. The YouTube adapter and shared-lifecycle extraction are being CI-verified. Adapters observe native roots, report measurements/removal, apply layout/clipping and restore styles. The operator's static probe confirmed native messages, transparent spacing and restoration, with inconsistent message persistence. The components are not yet wired into a live merged chat; Twitch special rows are unsupported and YouTube special roots remain synthetic candidates. See [proof evidence](docs/feasibility-proof.md), the [compositor contract](packages/compositor/README.md), [Twitch support](packages/adapters/twitch/README.md), and [YouTube support](packages/adapters/youtube/README.md).

## Development

Active repository: `BCIrealm087/elmychat`. Active branch: **`codex-startup`**.

Install Node.js 22 or newer, then run these commands from the repository root (PowerShell, Bash, or another terminal):

```sh
git switch codex-startup
npm ci
npm run check
npm start
```

Open <http://127.0.0.1:3210/> for the transparent starter overlay. The small status label is intentional and will be removed when a real chat view replaces it. <http://127.0.0.1:3210/health> returns the coordinator's bootstrap status. Press Ctrl+C to stop the server. The starter runtime needs no platform credentials or OBS debugging flags; Playwright and PNG parsing are development-only dependencies for automated rendering verification.

The starter overlay contains no platform frames. The separate `/proof?twitch=CHANNEL&youtube=VIDEO_ID` page loads the two native chat embeds for the bounded diagnostic. Read the [proof procedure and limits](docs/feasibility-proof.md) before using it. Loading either page alone does not demonstrate native composition.

## Directory structure

| Path | Responsibility |
| --- | --- |
| `apps/coordinator/src/` | Local HTTP entry point; future browser sessions and orchestration |
| `apps/overlay/` | Transparent page loaded by the OBS Browser Source |
| `packages/compositor/` | Pure platform-independent ordering, rectangles, spacers, visibility, and bounded history |
| `packages/adapters/twitch/` | Injected Twitch text-root lifecycle, measurement, positioning, clipping and teardown |
| `packages/adapters/youtube/` | Injected YouTube text/special host candidates, scoped discovery and native positioning |
| `packages/adapters/native-runtime.js` | Shared bounded observer, measurement, style ownership, reports and teardown |
| `packages/browser-control/` | Scoped CDP target/context access and native one-box probe |
| `test/` | Automated behavioral tests |
| `test/fixtures/` | Future synthetic DOM fixtures |
| `scripts/` | Development checks and bounded feasibility harnesses |
| `docs/` | Architecture, development guidance, and roadmap |
| `.github/workflows/` | CI for the development branch |

These directories define boundaries within one npm project. They are not separate published packages or workspaces yet.

## Proposed approach

Keep each chat's native message elements inside its own document. Give both surfaces transparent backgrounds and place them over the same viewport. A local coordinator would use Chrome DevTools Protocol (CDP) to inject a platform-specific adapter into each context. Adapters report native message measurements; a shared compositor calculates positions and spacers, then sends positions back to the owning adapter.

Initial ordering uses arrival at the coordinator, with a monotonic sequence to break ties. Platform send-time ordering is a separate future decision. The compositor must not copy message HTML or recreate platform rendering.

The first milestone proved bounded native composition in OBS: attach to both native chat contexts, detect and measure one message from each, and position them with a transparent gap in a single view. The pure compositor now defines the layout policy for future adapters. Continued native message survival, native clipping, layout interference, and target lifecycle handling remain adapter/coordinator work.

Read [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [development guidance](docs/development.md). Contributor and agent rules are in [AGENTS.md](AGENTS.md).

## Scope

Windows and OBS are the initial operator target; keep the development tooling portable. Elmychat is a separate project from Elmybot and requires no bot integration to begin. Distribution, installer, OAuth, additional platforms, and a settings UI will be decided after the native-composition proof.

No redistribution license has been selected yet.
