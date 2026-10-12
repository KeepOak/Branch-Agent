# Branch Agent

Branch Agent is a desktop AI assistant from [KeepOak](https://keepoak.com). This repository contains the engine, React window, Electron desktop launcher, and product artwork.

This is a source snapshot under active development. A feature being present in source does not establish that every workflow is complete or released.

## Requirements

- Node.js matching the engine requirement: `>=24.16.0 <25 || >=26.1.0`.
- pnpm `12.5.1` (the engine pins its exact package-manager integrity).
- Git; npm for the desktop package.
- A configured model provider for assistant replies.

Package versions on `main`: engine `2026.9.8` (synced from upstream OpenClaw), window `0.0.0`, desktop `0.4.4` with Electron `44.5.1`.

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

The `Source builds` workflow runs only when a maintainer dispatches it on `main`. Choose engine, window, desktop, or all three. It uses hosted Linux and Windows runners with Node `24.19.0` and a 15-minute limit per job. The window job builds its engine packages first. It uses the package commands above and does not call model providers. A build that exceeds the deadline fails; source presence does not establish a passing build.

`Desktop checks` runs on pull requests, relevant pushes to `main`, and manual dispatch. Hosted Windows, macOS and Linux jobs install the desktop lockfile with `npm ci`, compile strict TypeScript, and run the two named update/readiness checks at 96 MiB. These jobs build only the desktop sources and skip the Electron binary download. They do not build the engine, launch a visible app, or call model providers.

Saved `dist/` outputs are source build artifacts. `Source builds` does not create installers or publish releases; its artifact retention is three days. Releases come from the `GitHub component release` workflow on a 30-minute schedule at :07 and :37, or from a push to main when the latest release is more than 25 minutes old, when main has moved since the last release and no check on main's head has failed; see [Releases and component updates](CONTRIBUTING.md#releases-and-component-updates).

## Working on Branch

[`CONTRIBUTING.md`](CONTRIBUTING.md) is the contributor workflow: repository layout, setting up a worktree with `node scripts/install-worktree.mjs`, the local strict type checks, running tests by name, the merge gate and the 15-minute CI cap, component releases and updates, and working with AI agents through Graft (`branch graft`). [`AGENTS.md`](AGENTS.md) is the short rule list for coding agents.

## Working with AI agents

Graft (`branch graft`) lets Claude Code, Codex, Gemini CLI, Hermes or any MCP client work with your Trunks, group chats and the Branch window. Turn on "Type branch in any terminal" in the desktop app, then add it once, for example `claude mcp add --scope user branch -- branch graft`. Grafted agents appear in Settings › Grafts. Details: [`engine/docs/cli/mcp/serve.md`](engine/docs/cli/mcp/serve.md).

## Source layout

- `engine/`: assistant runtime, providers, tools, gateway, CLI, and runtime documentation.
- `window/`: desktop window frontend.
- `desktop/`: Electron launcher, packaging, component-release and update scripts.
- `scripts/`: worktree install, strict type checks, CI runners and named-test lists, and the upstream rename script.
- `assets/`: artwork and manifests shipped with the product.

Build instructions, requirements, decision records and design specifications are kept outside this repository.
