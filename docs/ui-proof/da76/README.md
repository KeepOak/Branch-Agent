# DA-76: Settings returns to the page you left

Captured with the existing `window/scripts/frame-harness.html`, the real WindowShell and production CSS, and synthetic engine responses. Viewports: 1280 × 900 and 600 × 900. No running desktop app or user data was used.

Journey: open Overview, open General Settings, click the Settings Back button.

- Before: `Back to Sapling` opens the default conversation (`before-settings.png`, `before-returned.png`).
- After: `Back to where you were` returns to Overview (`after-settings.png`, `after-returned.png`).
- Narrow: the label fits and the action returns to Overview (`after-narrow-settings.png`, `after-narrow-returned.png`).

Shell regression tests additionally cover multiple Settings pages, Library, a saved topic return route, browser history, and a Settings launch with no previous route. Route tests reject invalid and nested Settings return destinations.

Scope: isolated shell fixture verification, not a connected engine or released desktop build. Released-build verification remains pending independent review, merge, and release.
