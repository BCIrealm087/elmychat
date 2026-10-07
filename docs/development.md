# Development

## Setup and commands

Use `BCIrealm087/elmychat` on `codex-startup`. Node.js 22+ and its bundled npm are the runtime requirements. Pinned Playwright and PNG parsing packages are dev dependencies for browser verification. The coordinator and native CDP probe use only built-in modules.

| Command | Behavior |
| --- | --- |
| `npm ci` | Install the committed dependency lockfile |
| `npm start` | Serve the starter overlay on `127.0.0.1:3210` |
| `npm run dev` | Run the coordinator with Node's watch mode |
| `npm test` | Run Node's built-in behavioral tests |
| `npm run test:browser` | Run synthetic Chromium composition checks (install browser first) |
| `npm run check:syntax` | Parse every JavaScript source/test/tool file |
| `npm run check` | Run syntax checks and tests |
| `npm run check:all` | Run syntax, unit/server checks, and browser proof tests |
| `npm run proof:synthetic` | Generate synthetic rendering evidence and screenshot |
| `npm run proof:targets -- ENDPOINT` | List local debugger page IDs and exact URLs |
| `npm run proof:native -- CONFIG` | Temporarily position one native message per source |

The commands work in PowerShell and Bash without shell-specific environment-variable syntax. The dev watcher follows JavaScript imports; restart it after changing the HTML file because the shell reads HTML at startup. If port 3210 is occupied, stop the conflicting service or change the entry-point port deliberately; there is no configuration loader yet.

## Verification

The bootstrap test starts an ephemeral loopback server and checks the overlay, health, allowed methods, HEAD, and unavailable file paths. CDP tests verify response routing, loopback/target selection, disconnects, and retired contexts. Compositor tests verify arrival order, ties, exact spacing, bottom alignment, viewport clipping, resize invalidation, removal, source generations, bounded history and mixed-operation geometry using pure data. Browser tests verify actual cross-site context access, original-node identity, measured placement, pixel alpha, and restoration in Chromium. Install the browser with `npx playwright install chromium --no-shell`; CI installs it and runs `npm run check:all` on Linux and Windows using Node 22, for pushes to and PRs targeting `codex-startup`.

Synthetic browser checks establish browser mechanics, not actual OBS, Twitch/YouTube policies, or live selectors. The operator completed the bounded OBS gate; see [proof evidence and persistence limitations](feasibility-proof.md). The compositor is not wired to native sources yet and adds no new manual gate. Test future adapters with synthetic DOM fixtures, including removal/replacement and style/layout interference. Reserve further live operator checks for critical questions that automated tests cannot answer.

## Local state

Future persisted runtime data belongs in `.runtime/`; browser profiles belong in `browser-profiles/`. Both are ignored. No credentials or environment configuration are needed for this scaffold. Keep the HTTP service and future debugging interface on loopback, and avoid operating unrelated browser sessions.

## Contribution scope

Use focused commits and update status documentation with substantive behavior changes. Do not add a framework, installer, distribution license, bot coupling, or published package until the project needs it. The user handles live testing and deployment unless they request assistance.
