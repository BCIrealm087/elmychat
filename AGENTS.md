# Development instructions

## Repository and branch

- Work only in `BCIrealm087/elmychat` and on `codex-startup` unless the user explicitly changes the target.
- Before editing, committing, or pushing, check the repository and branch. Never create or update `main`, another branch, or the Elmybot repository as a workaround.
- The repository was initialized directly on `codex-startup`. Continue its existing history on this branch.
- Push ordinary completed work to this branch when authorized by the task. Do not merge, create a release, or change repository settings without a request.

## Product direction

- Preserve native Twitch and YouTube message rendering. Keep each message inside the document that owns it.
- Keep platform selectors and DOM manipulation in the corresponding adapter. Keep the compositor independent of platform HTML.
- Support native message measurements, a unified arrival order, and arbitrary transparent spacers.
- Native OBS/CEF static composition has operator evidence in `docs/feasibility-proof.md`. Preserve the distinction between that bounded capability and unproved ongoing stability; a browser mock does not establish additional OBS compatibility.
- Read `docs/architecture.md` and `docs/roadmap.md` before changing the architecture. Update relevant documentation when behavior or decisions change.
- Elmychat is independent of Elmybot. Do not introduce a dependency on its APIs or credentials without a concrete requirement.

## Engineering and verification

- Use JavaScript ES modules and Node.js 22+ for the initial scaffold. Prefer built-in modules until a real requirement justifies a dependency.
- Keep commands portable to Windows/PowerShell and Linux. Use Node scripts for shared tooling.
- Run `npm ci` and `npm run check` before pushing. Add behavior-focused tests for substantive logic; avoid tests that merely restate constants or file structure.
- For browser-control or native-probe changes, also run `npm run test:browser`. CI installs Chromium and runs `npm run check:all` on Windows and Linux. A missing browser is a failed verification environment, never a passing/skipped proof.
- Keep runtime state, platform sessions, browser profiles, credentials, and recordings out of git. Bind local services to loopback by default.
- Browser-control access is powerful: do not expose debugging ports to a LAN or operate unrelated tabs. OBS owns its process and lifecycle; do not restart it automatically.
- Use synthetic fixtures for automated DOM tests. Record selector evidence and limitations rather than inventing live-platform compatibility.
- Design roadmaps around automatic development cycles, with stable numbered steps, bounded scope, and clear acceptance criteria. Include human operator testing only when omitting it creates a critical risk; automate, simulate, or CI-verify other validation.
- The user handles live OBS/platform testing and deployment unless they ask for help. For the initial proof, native-platform/OBS rendering is a critical architectural uncertainty that Chromium fixtures cannot establish. Prepare and verify the complete diagnostic before handing over one bounded check; do not mark OBS feasibility proved by synthetic success.
- Report implemented behavior, verification performed, and outstanding limitations separately. Do not describe placeholders as functional adapters.

## Current state

Steps 0–4 are complete for their bounded scope. Step 4's YouTube adapter and shared native lifecycle passed Windows/Linux CI run 37617532360, including all Twitch regressions. Platform selectors/identity policies stay in their own modules; `packages/adapters/native-runtime.js` shares bounded observation, style ownership, measurement/reports and teardown. YouTube has six text/special host candidates scoped to one scrolling list. Only ordinary text-root selectors have static live evidence; special tags, YouTube scope/keys and continuous operation remain unverified. Step 5 coordinator wiring is implemented; nine Node tests pass; initial Windows/Linux CDP integration CI 37620376202 passed, with final follow-up checks and the bounded continuous native gate pending. Read docs/coordinator.md for session ownership, serial polling, ordering and recovery limits. Do not claim the static probe now runs the continuous adapters or that synthetic tests establish live OBS stability. Twitch special rows are unsupported. See adapter READMEs, `packages/compositor/README.md` and `docs/feasibility-proof.md` for contracts/evidence. No license choice, installer, OAuth workflow, or production chat integration has been made.
