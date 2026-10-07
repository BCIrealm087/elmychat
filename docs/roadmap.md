# Initial roadmap

This sequence prioritizes the native-rendering feasibility question. Only step 0 is implemented locally; publication and CI execution are tracked separately.

| Step | Work | Completion evidence |
| --- | --- | --- |
| 0. Project foundation | Branch, docs, component boundaries, local overlay server, checks and CI definition | Local checks pass; files are committed on `codex-startup`; remote publication/CI confirmed separately |
| 1. OBS/CEF capability proof | Select one Browser Source, attach to native Twitch/YouTube contexts, measure one message each, and position them with a transparent gap | Record actual OBS/CEF version, attachment method, and visible result; document blockers; one bounded live check if needed |
| 2. Compositor core | Arrival sequencing, measured rectangles, bottom alignment, spacers, visibility, bounded history | Pure behavioral tests for ordering, ties, gaps, viewport bounds, resizing and removal |
| 3. Twitch adapter | Native message observation, identity, positioning, resizing, removal, and teardown | Synthetic tests plus documented live selector evidence and unsupported cases |
| 4. YouTube adapter | Equivalent lifecycle, including special native message roots | Synthetic tests plus documented text/special-message behavior and unsupported cases |
| 5. End-to-end coordinator | Wire reports to placements; manage sessions, reconnect, navigation, refresh, and unload | Automated lifecycle tests; measured native composition in the proven environment |
| 6. Operator controls | Source configuration and usable spacing controls | Configuration validation and tests; minimal operator workflow |
| 7. Hardening and distribution decision | Bounded load, diagnostics, prolonged use, packaging and license decision | Automated resource/lifecycle checks; documented support limits and user-approved distribution choices |

Step 1 may contain a tiny disposable vertical slice; it should not grow into the full compositor or adapters before the browser capability questions are answered. Live proof results belong in a short evidence note recording observed behavior, not a broad claim of universal platform support.

Keep arbitrary spacing in the layout contract from the beginning. Defer additional platforms, platform-send-time synchronization, Elmybot integration, custom rendering, account workflows, and installer work until a requirement and evidence justify them.
