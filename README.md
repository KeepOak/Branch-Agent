# Branch Agent

Branch Agent is a desktop AI assistant from [KeepOak](https://keepoak.com). This repository contains the engine, React window, Electron desktop launcher, and product artwork.

This is a source snapshot under active development. A feature being present in source does not establish that every workflow is complete or released.

## Requirements

- Node.js matching the engine requirement: `>=24.16.0 <25 || >=26.1.0`.
- pnpm `12.5.1` (the engine pins its exact package-manager integrity).
- Git; npm for the desktop package.
- A configured model provider for assistant replies.

Snapshot package versions: engine `2026.9.7`, window `0.0.0`, desktop `0.4.2` with Electron `44.5.1`.

## Build

```bash
npm install -g pnpm@12.5.1
git clone https://github.com/KeepOak/Branch-Agent.git
cd Branch-Agent
cd engine
pnpm install --frozen-lockfile
pnpm build
cd ../window
pnpm install --frozen-lockfile
pnpm build
cd ../desktop
npm ci
npm run build
```

Build the engine before the window: `@branch/gateway-client` and `@branch/gateway-protocol` are local engine packages. Installations and builds may download packages and native runtimes. Product artwork stays at root `assets/`; its manifests use paths relative to the repository root.

## Run the web window

In one terminal:

```bash
cd engine
pnpm branch onboard
pnpm branch gateway --port 19011
```

Configure a model and gateway authentication during onboarding. The engine's CLI and provider documentation are in `engine/docs/`. In a second terminal:

```bash
cd window
VITE_GATEWAY_URL=ws://127.0.0.1:19011 pnpm dev
```

Open `http://127.0.0.1:5174` and connect using the gateway's configured authentication.

## Run the desktop launcher

The desktop launcher expects a built engine, built window, application data directory, and gateway-token file. Set `BRANCH_DESKTOP_DATA` to your application directory and create `desktop.json` there:

```json
{
  "engineDir": "C:/path/to/Branch-Agent/engine",
  "windowDir": "C:/path/to/Branch-Agent/window/dist",
  "nodePath": "C:/Program Files/nodejs/node.exe",
  "gatewayPort": 19031,
  "windowPort": 19032
}
```

Create `gateway-token` in that directory containing a random token. Keep it private. The launcher starts its own gateway and serves the window on loopback. Then run `npm start` from `desktop/`. See [`desktop/README.md`](desktop/README.md) for packaging and update scripts.

## Source builds on GitHub

The `Source builds` workflow runs only when a maintainer dispatches it on `main`. Choose engine, window, desktop, or all three. It uses hosted Linux and Windows runners, a maximum of eight matrix jobs, and a 45-minute limit per job. The window job builds its engine packages first. It uses the package commands above and does not call model providers.

Saved `dist/` outputs are source build artifacts. The workflow does not create installers or publish releases. Artifact retention is three days.

## Source layout

- `engine/`: assistant runtime, providers, tools, gateway, CLI, and runtime documentation.
- `window/`: desktop window frontend.
- `desktop/`: Electron launcher and packaging scripts.
- `assets/`: artwork and manifests shipped with the product.

Build instructions, requirements, decision records, design specifications, and source archives are maintained separately in the private [Branch Agent Instructions Build repository](https://github.com/KeepOak/Branch-Agent-Instructions-Build). Access is restricted.

## Licenses

The engine's MIT license and attribution are preserved in [`engine/LICENSE`](engine/LICENSE), with dependency notices in [`engine/THIRD_PARTY_NOTICES.md`](engine/THIRD_PARTY_NOTICES.md). Other source notices remain with their files. Artwork retains its original embedded metadata; this snapshot does not grant additional rights to third-party assets or change their licenses.
