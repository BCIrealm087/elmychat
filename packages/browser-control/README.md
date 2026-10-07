# Browser-control boundary

`cdp.js` implements bounded CDP requests over Node's built-in WebSocket, loopback endpoint discovery, explicit single-page selection, and default execution-context tracking. It attaches only to the selected page socket and its related iframe sessions, handling both out-of-process frames and multiple contexts on one session. Retired contexts are rejected; the coordinator owns reconnect/recovery. Frame attachment diagnostics are capped at 16.

`native-probe.js` temporarily measures and positions one original message root in its owning document and restores modified inline styles on teardown. It is a one-pair feasibility tool, not a production platform adapter. Selectors live in explicit proof configuration, not transport code. See [proof evidence](../../docs/feasibility-proof.md).

`native-page.js` is the adapter bridge: discover only the selected page, evaluate bounded default frame worlds, install the fixed platform adapter, and route addressed commands. It imports platform injection expressions and adapter keys; DOM selectors stay in platform modules. The coordinator pins the first selected target ID and uses a random owner token to recover only its own still-running adapters after socket loss. See [coordinator lifecycle/limits](../../docs/coordinator.md).
