# Pixel office source

Ported from `pixel-agents-hq/pixel-agents` at `3537e14`, via the Branch redesign port in `pixel-office-20261005/source`. `webview-ui/src/office`, `components`, `hooks` and `transport` contain the upstream webview; `core/src` contains its shared types and assets code. `webview-ui/src/branch` is the Branch integration layer.

The window dynamically imports `webview-ui/src/branch/mount.tsx` when Grove opens. Vite builds a content-hashed lazy chunk and shares the window's React. The host hydrates `Storage` from `users.prefs` before mounting; layout, seats, looks and settings all save through that adapter. No office state uses localStorage.

Assets in `upstream-assets` and `branch-assets` are packed into `webview-ui/src/branch/generated/assets.gen.ts`. To regenerate from the repository root:

```sh
node --import ./engine/scripts/tsx.mjs window/src/places/office/pixel/scripts/build-assets.ts
```
