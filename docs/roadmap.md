# Initial roadmap

This sequence prioritizes the native-rendering feasibility question. Steps 0–3 are complete for their bounded scope. Automated and native OBS evidence is tracked in [proof evidence](feasibility-proof.md); compositor and Twitch verification are recorded in their API contracts. Step 1 proves bounded static composition; short, inconsistent live message lifetime remains unresolved. Step 3 automates native text-root lifecycle/repair in synthetic fixtures, with explicit unsupported cases and no claim of continuous live OBS/Twitch stability. Step 4, the YouTube adapter, is next.

Use automatic development cycles and stable numbering. Complete implementation, automated verification, CI, and relevant documentation for each step. Include manual operator testing only when omitting it creates a critical risk; automate or simulate all other validation. The native OBS composition result is one critical architectural gate, not a routine manual requirement for later steps.

| Step | Work | Completion evidence |
| --- | --- | --- |
| 0. Project foundation | Branch, docs, component boundaries, local overlay server, checks and CI definition | Local checks pass; files are committed on `codex-startup`; remote publication/CI confirmed separately |
| 1. OBS/CEF capability proof — complete | Implement scoped CDP attachment and a one-pair diagnostic; automate cross-origin composition and teardown checks; then resolve actual OBS/native embedding | Browser tests and CI pass; operator confirmed native pair, scene alpha and restoration with CEF 127 / CDP 1.3; OBS was reported as latest without an exact version; persistence limitation recorded |
| 2. Compositor core — complete | Arrival sequencing, measured rectangles, bottom alignment, spacers, visibility, bounded history | 12 compositor tests pass locally and in Windows/Linux [CI run 37569927744](https://github.com/BCIrealm087/elmychat/actions/runs/37569927744), alongside all existing checks; see the [API contract](../packages/compositor/README.md) |
| 3. Twitch adapter — complete for ordinary text roots | Native message observation, identity, positioning, resizing, removal, and teardown | Eight synthetic browser lifecycle tests passed in Windows/Linux [CI run 37614403981](https://github.com/BCIrealm087/elmychat/actions/runs/37614403981); [live text-root selector evidence and unsupported cases](../packages/adapters/twitch/README.md) recorded |
| 4. YouTube adapter | Equivalent lifecycle, including special native message roots | Synthetic tests plus documented text/special-message behavior and unsupported cases |
| 5. End-to-end coordinator | Wire reports to placements; manage sessions, reconnect, navigation, refresh, and unload | Automated lifecycle tests; measured native composition in the proven environment |
| 6. Operator controls | Source configuration and usable spacing controls | Configuration validation and tests; minimal operator workflow |
| 7. Hardening and distribution decision | Bounded load, diagnostics, prolonged use, packaging and license decision | Automated resource/lifecycle checks; documented support limits and user-approved distribution choices |

Step 1 may contain a tiny disposable vertical slice; it should not grow into the full compositor or adapters before the browser capability questions are answered. Live proof results belong in a short evidence note recording observed behavior, not a broad claim of universal platform support.

Keep arbitrary spacing in the layout contract from the beginning. Defer additional platforms, platform-send-time synchronization, Elmybot integration, custom rendering, account workflows, and installer work until a requirement and evidence justify them.
