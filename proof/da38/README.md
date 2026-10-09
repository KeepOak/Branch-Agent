# DA-38 window proof

These artifacts belong only to this proof branch, not the source PR.

## Before

The window source is the original main base `e1d47d8b192868f09f85d382b35b4378a6da55c3`. The scratch gateway serves real RPCs. After a successful connection, an actual socket disconnect/reconnect begins another bootstrap. Its real `agents.list` response is held until the socket disconnects again. Releasing that response lets the old bootstrap incorrectly restore the captured connected state. A previously answered real health promise settles late. Automations then requests against the closed transport and renders its actual `gateway not connected` rejection.

The gateway status button is icon-only in this window. Its actual accessible label/title is `Gateway · running`; the screenshot opens that button's real popover, showing On and Healthy in the same frame as the red Automations error. The accompanying observation records the label and session phase read directly from the window.

## After and disconnected

The fixed window at `51af9a90f5bcf82815eea590db5843991a93f2d5` repeats the same socket fault. The stale bootstrap cannot restore connected state. `disconnected.png` shows the honest connection error and Retry. Clicking that Retry reconnects the same real gateway session. `after.png` shows the real default schedule rows returned by `cron.list`, with the same running gateway button and its real On/Healthy popover open. No cron, health, connection state, or error responses are fabricated. The connection notification is dismissed through its actual Dismiss button before opening the gateway popover for capture.

Production Vite builds; isolated scratch configuration, free loopback ports, and headless Chromium. The harness only controls settlement timing of already answered RPC promises and supplies a neutral computer display name. Scratch setup is marked completed and cron execution is disabled; no model requests are sent. All started process trees are stopped after capture.
