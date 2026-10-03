# Branch Agent desktop

Electron launcher version 0.4.2. It starts a separately built Branch engine, serves the built window on loopback, and uses an isolated Electron profile under its application data directory.

Run `npm ci`, `npm run build`, then `npm start`. Set `BRANCH_DESKTOP_DATA` and configure `desktop.json`, the engine path, window build path, Node path, and `gateway-token` as described in the root README.

`scripts/package.sh` packages a portable Windows folder with Electron 44.5.1. Set `BRANCH_DESKTOP_OUT` to your output folder. The engine and window remain separate. `scripts/publish-engine.sh` and `scripts/publish-window.sh` install built copies into the configured application directory; read their environment settings before using them. Updates to the engine are offered through a restart action, and window publications reload the window.

`scripts/package.ps1` supports packaging from an existing runtime folder. Its default preserves that executable's hash; stamping version metadata creates a new executable hash. Set its input paths for your installation. `scripts/refresh.sh` packages a version and updates shortcuts, so use it only when you intend those changes.
