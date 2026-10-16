# R1 real browser: what was studied, what was built, what was skipped

Reference: `NousResearch/hermes-agent@73b9f2af7b87a619f42396710c332be04353aef2` (MIT, `third_party/hermes-agent/LICENSE`).

## What was studied

The desktop preview pane in `apps/desktop/src/app/chat/right-rail/`:

- `preview-browser-bar.tsx` and `preview-input.ts`: how typed text becomes a URL or a search.
- `preview-nav.ts`, `preview-guest-offscreen.ts`: guest navigation, and keeping inactive guests mounted off screen rather than hidden.
- `preview-act.ts`, `preview-drive.ts`: how the agent acts on the guest. Reads use `executeJavaScript`, actions use `sendInputEvent` on the guest webContents. No CDP port is involved.
- `preview-reader.ts`: reader extraction.
- `real-profile-consent-dialog.tsx`: the consent gate before the agent uses a real profile.

The main process in `apps/desktop/electron/`:

- `main.ts`: `will-attach-webview` (where the guest preload was attached), `setWindowOpenHandler` (popups denied by default).
- `preview-guest-throttle.ts`: the guest partition and attach preferences.
- `preview-guest-escape.ts`: the `before-input-event` exit path.
- `dev-cdp.ts`: the renderer debugging port stays closed in packaged builds.

## What was built in Branch

- `desktop/src/browser-guest-policy.ts` (pure, `node --test` covered): the only partition a guest may use, the attach decision, the guest preference overrides, URL decisions (web pages and about:blank only), the popup decision, and the permission refusal.
- `desktop/src/main.ts`: `webviewTag` only on R1 windows (`createWindow`, conversation windows, pop-out windows). Guests are forced onto the Branch partition with no preload, no Node and the sandbox on. Guest permissions and downloads are refused. Popups become tab requests on `branch-desktop:browser-open-tab`. Navigation to file, chrome, devtools, javascript or data addresses is blocked.
- `desktop/src/preload.ts`: `browserGuest` (`local`, `openPopout`, `onOpenTab`). The sandboxed preload cannot import modules, so the loopback check is repeated there.
- `window/src/guest/`: the human's own pane (tabs, address bar, back, forward, reload, reader, pop-out, consent for the Trunk).
- `engine/extensions/browser/src/guest/`: the Trunk's route to the pane, with fallback to the engine's own browser.

## What was changed on purpose

- **Partition name.** Hermes uses its own partition name. Branch uses `persist:branch-browser`.
- **Popups.** Hermes forwards `_blank` links through a guest preload. Branch strips guest preloads and uses `setWindowOpenHandler`, which denies the popup and asks the host to open a tab.
- **Trunk drive.** Hermes drives the guest from the desktop side through the agent. Branch uses gateway requests (`browser.guest.request` and `browser.guest.respond`) answered by the pane. Navigation guard and SSRF checks run in the engine before any navigate is sent.
- **Local versus remote.** The pane is the human's own browser. It is shown next to the Trunk's screencast view, which is kept for remote and headless browsers.
- **Consent.** The consent gate covers the Trunk's first use of the pane in a session, not a real Chrome profile. Branch does not import a real profile.

## What was skipped

- Annotate, tour, mind and nudge: not part of v1.
- Real-profile import: Branch has no real-profile mode in v1.
- Escape handling inside the guest: while the pane has focus, Escape goes to the page, as in Chrome, so R1 cannot close its stage from inside a guest.
- Cmd and Ctrl shortcuts into the guest: not forwarded.

## Copied code

No Hermes code was copied. The design, the file layout and the names of the reference modules were used as a guide. `docs/upstream/COPIED.csv` has no rows for this change. The NOTICE line credits the design reference.

## Unblock and follow-ups

- Per-page engine guard tests with a real Playwright profile are still needed for the fallback path.
- A pane-host plugin contract (PR B) would let a plugin contribute a pane. Today nothing does.
