# Twitch emote support

Elmychat offers optional 7TV and BTTV emotes in its native Twitch chat, using FFZ inside the selected Twitch document. Both providers can run together. Basic rendering has bounded live evidence in OBS 32.2.2 / CEF 127; the controls, isolation, layout and recovery contracts have Windows/Linux automated coverage. YouTube continues using its native renderer.

This completes the implementation and documentation milestone for steps 8–13 at that bounded support level. The original step-13 acceptance called for separately verified public channel/global categories; the retained reports identify providers but do not distinguish those categories. That evidence item remains open. No installer, packaged release, universal OBS compatibility or prolonged-use guarantee is implied.

## Enable or change providers

1. Start Elmychat with `npm start`, open <http://127.0.0.1:3210/>, and save/connect the intended Twitch channel and YouTube source. Use <http://127.0.0.1:3210/overlay> in the selected OBS Browser Source, with OBS browser debugging configured as described in [operator controls](operator-controls.md#start-and-configure).
2. Under **Twitch emotes**, select **7TV**, **BTTV**, or both, then click **Apply emotes**. Choices are saved locally and reapply on connection. Existing settings default both off.
3. Wait for native Twitch to reconnect and emote status to finish loading. Applying changes refreshes Twitch and clears its retained history; YouTube, the coordinator, gap and current-run spacers continue.
4. Check new messages containing an emote enabled for that channel or a provider-global emote. Earlier plain-text emote names are not guaranteed to be retokenized after activation. **Ready** describes usable modules and APIs; an empty or pending set can be valid, and readiness does not prove a visible image.

No additional browser extension or provider login is required for this public emote route. Both providers off restores a fresh native Twitch document. **Retry emotes** uses saved choices; apply edited checkboxes first. Applying unchanged choices does nothing. Explicit coordinator JSON uses the same Twitch-only choices; see [configuration](twitch-enhancement.md#explicit-development-configuration).

## Support matrix

| Capability | Support and evidence | Boundary |
| --- | --- | --- |
| Basic 7TV rendering | A live 7TV report and combined report sampled decoded, visible provider images in current Twitch/FFZ hosts; the operator confirmed the modes worked. | Tested OBS 32.2.2 / CEF Chrome 127.0.6533.120, FFZ 4.82.0, 7TV add-on 1.4.34. Original hosts were replaced. |
| Basic BTTV rendering / both providers | The combined live report sampled a decoded, visible image from each provider. BTTV-only success was operator-confirmed; its supplied standalone attachment was blocked. | BTTV add-on 3.3.24 with `ffzap-core`. The blocked attachment is not a standalone passing report. |
| Public channel/global sets | Implemented through the selected FFZ add-ons; public basic rendering is observed. | Reports do not label each observed image channel versus global. Separate category verification remains open; set counts do not prove it. |
| Animation, wide images and in-box stacked/zero-width emotes | Native descendant rendering and measured layout have deterministic browser coverage, including an animated GIF. | Provider-specific live categories remain unverified. Paint outside the measured host is clipped; overlay overhang is unsupported. |
| Personal emotes | Resolution is delegated to the enhancer. | No live personal-emote support claim. |
| Native badges, typography, wrapping and platform marks | Native descendants remain renderer-owned. Default-settings ASCII-art wrapping and marks were operator-confirmed; fixtures cover badges, appearance, the supplied E, clipping and transparency. | FFZ base styles can alter appearance. Exact pixel parity and customized Twitch appearance parity remain unverified. |
| Identity, arrival order and spacing | Verified renderer IDs preserve in-place updates and unique same-flush remounts. A live before/after pair retained all four baseline Twitch identities/sequences; CDP fixtures cover gap/spacer continuity and YouTube preservation. | No original-DOM retention claim. Ambiguous/unkeyed or already-removed hosts remain new arrivals. Live mutation-specific remount attribution and explicit spacer checks were not captured. |
| Apply/retry, settings isolation and failure recovery | Managed controls and one owned Twitch-only recovery are automated. After the startup-capacity fix, the operator reported normal emotes working again. | That latest confirmation has no new versioned report or appearance measurements; it does not prove every isolated cosmetic setting. A shared FFZ engine failure can affect both selected providers. |
| Cosmetics | Reviewed extra badges, name paints, shadows, animated avatars and BTTV notices are disabled by local policy. | Cosmetics are outside the emote controls. Full live isolated appearance parity remains unverified. |
| Cleanup and broader environments | Owned work/styles are released; selected Twitch reload is the enhancer reset boundary. Both CDP transports pass synthetic coverage. | Full FFZ unload, other OBS/CEF versions, ordinary-browser operation without CDP and prolonged live stability are not established. |

Evidence comes from [the original live route check](emote-proof.md#live-recheck-and-route-decision-2026-10-08-utc), [the corrected identity reader follow-up](enhanced-content.md#positive-live-reader-and-retained-identity-check-2026-10-08), and the latest operator confirmation after commit `4ec0cbc`. The latter confirms the reported startup failure stopped occurring; it adds no provider-category or full appearance evidence. Runtime reports, chat text and screenshots are not committed.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Ready, but an emote remains text | Use a new message with an exact enabled name for the selected channel/provider. Old messages need not be retokenized. Empty/pending sets and readiness alone do not establish a channel lookup or image render. |
| Loading | Allow the bounded preparation/readiness window to finish. Native chat status is separate and YouTube/spacing continue. Repeated Apply clicks do not accelerate it. |
| Unavailable with native chat connected | Open **Diagnostics** or <http://127.0.0.1:3210/health>. Save the original failure before retrying. Check the reason, then use **Retry emotes** once the reported cause is addressed. |
| Native Twitch recovered, but emotes stay paused | This is the one-reset failure boundary. Capture `lastFailure`, then explicitly retry. The loader does not keep refreshing Twitch. |
| Existing engine, proof or competing-enhancer conflict | Finish/reset an owned legacy proof before using normal controls. For an enhancer installed by another tool, remove its startup injection for this source and refresh that Twitch source before retrying. Elmychat does not take ownership of foreign hooks. |
| Refresh is unconfirmed or the overlay helper is missing | Check that the intended managed overlay is selected. An overlay loaded before these controls may need one manual Browser Source refresh to get the helper; this manual action refreshes both chats. Avoid using it routinely. |
| Download/network or unsupported API/settings failure | Keep the exact diagnostic reason and versions. Restore access to the reported CDN/provider service, or report a compatibility failure for investigation. Retry cannot repair an upstream API mismatch. |
| `FFZ session settings capacity exceeded` on an older checkout | Update `codex-improvements`, restart the local coordinator and reconnect. Commit `4ec0cbc` permits bounded startup-menu metadata and drops optional UI overflow without failing readiness. A continuing failure needs its new original reason. |

Normal controls are the preferred workflow. The legacy `proof:emotes` diagnostic loads a separate, less-isolated FFZ path and conflicts with an active normal enhancer. Its `reset` is for its own stopped diagnostic; it is not a general managed-loader reset. Do not run it for routine Apply troubleshooting. See [diagnostic restrictions](emote-proof.md).

For a useful issue report, include the checkout commit, OBS/CEF versions, selected provider choices, action taken and the Twitch source's `enhancement` and native-adapter diagnostics from `/health`. `sources[].enhancement.lastFailure` preserves the original bounded reason and stage across recovery; a new Apply/retry clears it. Include current status/reason, provider versions, isolation status, `uiWritesDropped`, and reset outcome when present. Describe whether new ordinary Twitch messages and YouTube still appear. Health omits message text/credentials, but may include channel/source URLs and local identifiers; review it before sharing. Keep screenshots separate because they may contain chat content.

## Verification and update boundary

The final runtime regression baseline is [Windows/Linux CI run 37864687971](https://github.com/BCIrealm087/elmychat/actions/runs/37864687971) at `4ec0cbc`: **79 Node and 60 browser tests per OS**, zero failures/skips. Step 13 reruns the same complete suite for its documentation commit; that commit's CI result is authoritative for the final branch state. Local Node checks are available; local Chromium is absent, so a launch failure locally is not a browser pass.

Coverage includes native adapters/composition, ASCII art, origin marks, paint stability, enhanced identity/layout, independent/both-provider controls, settings capacity and immutable policy, failed/delayed loaders, one-reset recovery, stale generations and both real-CDP transports. Rolling/idle/reconnect/channel/conflict fixtures retain YouTube identity, gap/spacers and final native cleanup. These fixtures use our deterministic enhancer shim, not live provider downloads. The current-CDN menu reproducer separately exposed the startup capacity regression; it cannot establish OBS rendering.

The loading route still downloads/hashes the fixed FFZ bootstrap and lets it load remote engine/add-on chunks. No new bootstrap route or bundled third-party code was introduced in step 13. Historical bootstrap integrity, source revisions, licensing and independently mutable dependencies are recorded in [the live report](emote-proof.md) and [compatibility audit](emote-compatibility.md#upstream-audit-loading-and-licenses). A bootstrap hash does not pin the full engine or assets. Future upstream changes require capability/regression checks and evidence proportionate to the changed behavior; no routine repeat live gate is imposed by this documentation milestone.
