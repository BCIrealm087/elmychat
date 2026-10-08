# Development instructions

## Repository and branch

- Work only in `BCIrealm087/elmychat` on the selected development branch, `codex-improvements`. The default branch and pull-request merge target is `master`.
- `codex-improvements` is the current work branch for improvements following the initial implementation milestone. Do not write to `master` or any other branch.
- Before editing, committing, or pushing, verify `BCIrealm087/elmychat` and `codex-improvements`. Never create or update another branch or the Elmybot repository as a workaround.
- The repository was initialized directly on `codex-startup` and renamed to `master` after steps 0–7. Preserve its existing history.
- Push ordinary completed work to the explicitly selected working branch when authorized by the task. Do not merge, create a release, or change repository settings without a request.

## Product direction

- Preserve native Twitch and YouTube message rendering. Keep each message inside the document that owns it.
- After native rendering, 7TV/BTTV support is the current product priority. Follow `docs/emote-support-roadmap.md` (steps 8–13). Investigate one in-frame enhancement engine through existing CDP first; do not introduce an Elmychat message renderer. Step 8 has an opt-in diagnostic (`docs/emote-proof.md`); live FFZ/Twitch/OBS compatibility is pending. Production enhancement and steps 9–13 remain planned.
- Keep platform selectors and DOM manipulation in the corresponding adapter. Keep the compositor independent of platform HTML.
- Support native message measurements, a unified arrival order, and arbitrary transparent spacers.
- Treat user experience as part of each improvement: keep additions compact, recognizable, readable over transparent OBS scenes, and consistent with native content. Keep implementation details out of operator-facing flows.
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

On `codex-improvements`, Twitch's native message box is capped at a 340px reference sidebar width to preserve common ASCII-art wrapping in wide overlays. The operator confirmed it works with default settings on 2026-10-07. Reports still use the shared viewport width, with height measured from the narrower box. Keep typography, whitespace and descendants native. Narrow viewports reflow, and customized Twitch appearance settings can differ from the reference. See the Twitch adapter README and supplied E browser regression; customized appearance equivalence remains unverified.

Both adapters add 16px platform marks in an owned, pointer-transparent decoration layer, outside native roots. Use existing left padding of at least 20px; otherwise reserve a 20px gutter and measure at the remaining width (Twitch still caps at 340px). Labels and SVG shadow isolation are part of the contract. Keep decoration writes out of native identity detection and remove the layer on teardown/failure. Markers are bounded by tracked roots; diagnostics expose `originMarkers` and `gutterMessages`. See adapter READMEs, `test/browser/origin-marks.test.js` and `THIRD_PARTY_NOTICES.md`. The operator confirmed the marks work and likes the result on 2026-10-07.

Message paint must remain bounded to its last assigned slot while native auto-height changes. Admission hides outermost supported roots before placement, and detected reuse hides old content before the next frame. Native host transitions/animations are disabled while attached; descendant emote rendering stays native. Changed source snapshots are dispatched together (at most two commands) and applied synchronously in each frame. Separate native frames still lack a cross-frame atomic paint guarantee. Preserve the pixel, pre-discovery, reuse and acknowledgment regressions in `test/browser/render-stability.test.js`; see `docs/render-stability.md`.

Steps 0–7 are complete for their bounded scope. Step 4's YouTube adapter and shared native lifecycle passed Windows/Linux CI run 37617532360, including all Twitch regressions. Platform selectors/identity policies stay in their own modules; `packages/adapters/native-runtime.js` shares bounded observation, style ownership, measurement/reports and teardown. YouTube has six text/special host candidates scoped to one scrolling list. Ordinary-root discovery and bounded continuous composition have operator evidence; live special tags and native identity recycling remain unverified. Step 5 coordinator wiring is implemented; ten coordinator Node tests and both real-CDP integration modes passed Windows/Linux CI 37628199537 (48 tests per OS, including all regressions). The operator confirmed merged scrolling, emotes/transparency, refresh recovery after a short unmeasured delay and restoration; both attached reports agree with healthy sources and successful cleanup. Step 5’s bounded native gate is complete; step 6 operator controls passed Windows/Linux CI run 37635603023 (38 Node and 23 browser tests per OS). Exact OBS version was not supplied, and prolonged stability is not established. Read docs/coordinator.md for session ownership, serial polling, ordering and recovery limits. Do not claim the static probe now runs the continuous adapters or that synthetic tests establish live OBS stability. Twitch special rows are unsupported. See adapter READMEs, `packages/compositor/README.md` and `docs/feasibility-proof.md` for contracts/evidence. No license choice, installer, OAuth workflow, or production support claim has been made.

Step 5 live testing found a YouTube injection readiness failure while Twitch ran successfully. Missing document bodies now wait/retry without latching; installation rechecks readiness and reports unsupported ResizeObserver separately. The subsequent operator report passed the bounded live gate; distinguish that evidence from the automated startup fix.

Step 6 uses OperatorController for saved source settings and serial UI actions. The managed /overlay navigates only its own chat frames when explicitly saved source settings change; CDP still never navigates an OBS page. Runtime spacing commands are serialized inside the coordinator cycle and must relay history evictions with source generation identity. See docs/operator-controls.md for persisted versus current-run settings and loopback API boundaries. No new manual gate is required.

Step 7 passed Windows/Linux CI run 37676706252: 42 Node and 24 browser tests per OS, including sustained reports, real-CDP rolling load, idle coalescing, repeated recovery, source-pressure isolation and shutdown spacer cleanup. See docs/hardening.md for resource/activity diagnostics and support limits. The initial implementation milestone is complete for its bounded scope. Retain the source-checkout workflow; packaged releases and license selection remain deferred, with no public-release or prolonged-stability claim.
