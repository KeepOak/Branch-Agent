# mobile-1 proof: design + scaffold

Head: 6d35a20777de1573c1562240ba614ec751353f14 on trunk/mobile-1-scaffold.

No iOS Simulator (Windows PC, Mac mini paused) and no Android emulator on this machine, so these frames
are the app's own React Native components rendered with react-native-web, captured in headless Chrome
through the DevTools protocol at an iPhone size: 393x852 pt, 3x scale, mobile emulation, with
prefers-color-scheme set to light and then dark. Text uses the PC's system font instead of SF Pro.

How they were made:

1. `cd mobile && npx expo export --platform web --output-dir <dir>`
2. Serve `<dir>` on a loopback port (any static server that falls back to index.html).
3. `node capture.cjs <path to chrome> http://127.0.0.1:<port>/ <out dir>`

Frames checked one by one:

- mobile-1-welcome-light.png: large title "Branch", subtitle, raised pairing-status card with the amber
  "waiting" dot, footnote at the bottom safe area. All text wraps inside the 20 pt margins; no clipping.
- mobile-1-welcome-dark.png: same layout on the near-black dark palette; card one step lighter, amber dot,
  secondary text readable. No buttons on either frame (pairing is the next PR, and dead controls are not shown).
