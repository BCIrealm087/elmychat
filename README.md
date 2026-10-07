# Elmychat

Elmychat is an experimental local chat compositor for OBS. The goal is to combine Twitch and YouTube chat in one chronological view while preserving each platform's native rendering, including emotes, badges, replies, and special messages. Arbitrary transparent spacing between messages is part of the design.

**Status:** bounded native composition proved in OBS. The local server, scoped browser-control probe, and native pair diagnostic are implemented. The operator confirmed two native messages, transparent spacing and restoration; message persistence was inconsistent. Production platform adapters and stable merged chat are not implemented. See [proof evidence and limitations](docs/feasibility-proof.md).

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
| `packages/compositor/` | Future platform-independent ordering, rectangles, and spacers |
| `packages/adapters/twitch/` | Future Twitch DOM observation and positioning |
| `packages/adapters/youtube/` | Future YouTube DOM observation and positioning |
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

The first milestone is a small OBS/CEF feasibility proof: attach to both native chat contexts, detect and measure one message from each, and position them with a transparent gap in a single view. Embedded-frame transparency, clipping, native layout interference, and target lifecycle handling need evidence before a full implementation.

Read [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [development guidance](docs/development.md). Contributor and agent rules are in [AGENTS.md](AGENTS.md).

## Scope

Windows and OBS are the initial operator target; keep the development tooling portable. Elmychat is a separate project from Elmybot and requires no bot integration to begin. Distribution, installer, OAuth, additional platforms, and a settings UI will be decided after the native-composition proof.

No redistribution license has been selected yet.
