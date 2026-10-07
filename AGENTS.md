# Development instructions

## Repository and branch

- Work only in `BCIrealm087/elmychat` and on `codex-startup` unless the user explicitly changes the target.
- Before editing, committing, or pushing, check the repository and branch. Never create or update `main`, another branch, or the Elmybot repository as a workaround.
- The empty repository has no base history. Its first commit belongs on `codex-startup`.
- Push ordinary completed work to this branch when authorized by the task. Do not merge, create a release, or change repository settings without a request.

## Product direction

- Preserve native Twitch and YouTube message rendering. Keep each message inside the document that owns it.
- Keep platform selectors and DOM manipulation in the corresponding adapter. Keep the compositor independent of platform HTML.
- Support native message measurements, a unified arrival order, and arbitrary transparent spacers.
- Treat native OBS/CEF composition as unproven until the feasibility milestone has evidence. A browser mock does not establish OBS compatibility.
- Read `docs/architecture.md` and `docs/roadmap.md` before changing the architecture. Update relevant documentation when behavior or decisions change.
- Elmychat is independent of Elmybot. Do not introduce a dependency on its APIs or credentials without a concrete requirement.

## Engineering and verification

- Use JavaScript ES modules and Node.js 22+ for the initial scaffold. Prefer built-in modules until a real requirement justifies a dependency.
- Keep commands portable to Windows/PowerShell and Linux. Use Node scripts for shared tooling.
- Run `npm ci` and `npm run check` before pushing. Add behavior-focused tests for substantive logic; avoid tests that merely restate constants or file structure.
- Keep runtime state, platform sessions, browser profiles, credentials, and recordings out of git. Bind local services to loopback by default.
- Browser-control access is powerful: do not expose debugging ports to a LAN or operate unrelated tabs. OBS owns its process and lifecycle; do not restart it automatically.
- Use synthetic fixtures for automated DOM tests. Record selector evidence and limitations rather than inventing live-platform compatibility.
- Focus on automated development cycles. The user handles live OBS/platform testing and deployment unless they ask for help. The initial OBS feasibility milestone warrants one bounded operator check when browser automation cannot answer it.
- Report implemented behavior, verification performed, and outstanding limitations separately. Do not describe placeholders as functional adapters.

## Current state

Only the local HTTP server and transparent overlay shell are implemented. CDP transport, platform adapters, and compositor directories contain boundary notes for future work. No license choice, installer, OAuth workflow, or real chat integration has been made.
