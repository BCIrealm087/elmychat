# Development

## Setup and commands

Use `BCIrealm087/elmychat` on `codex-startup`. Node.js 22+ and its bundled npm are the only runtime requirements. There are currently no third-party npm dependencies.

| Command | Behavior |
| --- | --- |
| `npm ci` | Install the committed dependency lockfile |
| `npm start` | Serve the starter overlay on `127.0.0.1:3210` |
| `npm run dev` | Run the coordinator with Node's watch mode |
| `npm test` | Run Node's built-in behavioral tests |
| `npm run check:syntax` | Parse every JavaScript source/test/tool file |
| `npm run check` | Run syntax checks and tests |

The commands work in PowerShell and Bash without shell-specific environment-variable syntax. The dev watcher follows JavaScript imports; restart it after changing the HTML file because the shell reads HTML at startup. If port 3210 is occupied, stop the conflicting service or change the entry-point port deliberately; there is no configuration loader yet.

## Verification

The bootstrap test starts an ephemeral loopback server and checks the overlay, health, allowed methods, HEAD, and unavailable file paths. CI runs the same checks on Linux and Windows using Node 22, for pushes to and PRs targeting `codex-startup`.

Current local checks establish HTTP serving only. They do not test OBS, native frames, live selectors, or message composition. For future layout logic, test ordering, ties, spacers, clipping, resizing, and removal with pure data. Test adapters with synthetic DOM fixtures. Reserve a live operator check for the browser/CEF capability question that synthetic tests cannot answer.

## Local state

Future persisted runtime data belongs in `.runtime/`; browser profiles belong in `browser-profiles/`. Both are ignored. No credentials or environment configuration are needed for this scaffold. Keep the HTTP service and future debugging interface on loopback, and avoid operating unrelated browser sessions.

## Contribution scope

Use focused commits and update status documentation with substantive behavior changes. Do not add a framework, installer, distribution license, bot coupling, or published package until the project needs it. The user handles live testing and deployment unless they request assistance.
