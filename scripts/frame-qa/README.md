# Frame-level QA for the window

A depth-first walk of every control in the window's fixture harness, with each click watched frame by
frame. It finds flicker, layout shifts, scroll resets, idle churn, slow first paint, blank frames,
clipped text, low contrast, console errors, focus loss and keyboard traps.

It uses the same fixture harness as the button crawl (`window/scripts/button-crawl-harness.html`), so it
needs no live engine and changes no state outside its output directory.

## Run

From a worktree with dependencies installed the way CI does it:

```sh
node scripts/install-worktree.mjs window
pnpm -C engine/packages/gateway-protocol run build
pnpm -C engine/packages/gateway-client run build
node scripts/frame-qa/frame-qa.mjs
node scripts/frame-qa/audit-lines.mjs frame-qa-output/<os> <os>
```

Configuration is by environment variable:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FRAME_QA_OS` | from platform | label for the output and findings (`mac`, `linux`, `windows`) |
| `FRAME_QA_OUT` | `frame-qa-output/<os>` | output directory |
| `FRAME_QA_PORT` | `5663` | port for the harness dev server (the server is started and stopped by the run) |
| `FRAME_QA_URL` | empty | use an already running harness instead of starting one |
| `FRAME_QA_BUDGET_MIN` | `60` | wall-clock budget; controls not reached stay `not-reached` |
| `FRAME_QA_MAX_DEPTH` | `3` | overlay nesting depth (menu, dialog, sub-dialog) |
| `FRAME_QA_ROOTS` | all | comma list of root ids such as `place:overview,chat:agent:main:notes` |
| `FRAME_QA_CHROME_PATH` | Playwright Chromium | system Chrome executable, when the bundled browser is not installed |
| `FRAME_QA_CHROME_ARGS` | empty | extra Chromium arguments, space separated |

The run needs Chromium for Playwright (`pnpm -C window exec playwright install chromium`) unless
`FRAME_QA_CHROME_PATH` points at one. On Linux as root it adds `--no-sandbox`.

## What it walks

- Roots: every seeded conversation, every place and every settings page in the harness catalog.
- Each root opens in a fresh browser context, which records a video and a Playwright trace.
- Controls are visited depth first. Each control is keyed by its root, its path and its occurrence, so
  nothing is visited twice. Shared chrome, the sidebar and the settings nav are visited once.
- Overlays (menus and dialogs) are walked to `FRAME_QA_MAX_DEPTH`. An overlay that opens an identical
  overlay is linked to the first one instead of walked again.
- Between siblings the walk restores the base state. It presses Escape, and if the state still differs
  it replays the path from the root (storage is restored to the root's starting snapshot first).
- Destructive, external and sign-in controls are recorded as `skipped` and are not clicked. The rules
  are the button crawl's `denylist.mjs`.
- Each root also runs: five seconds of idle observation, contrast and clipped-text scans, a Tab trail, the
  three shortcuts (`Ctrl/⌘+K`, `Ctrl/⌘+I`, `Ctrl/⌘+,`), and a wheel test on every scrollable.

## How each click is observed

- Clicks use real mouse events: move, hover for 150 ms, then press and release at the control's centre.
  A click that lands on another element is flagged `click-intercepted`.
- Frames come from CDP screencast. Chromium sends a frame only when the picture changes, and every
  frame is acknowledged. The cadence actually achieved is recorded as `intervalMedianMs`.
- Each window is 2 s after a click, or 5 s when the click opened an overlay or changed the route. The
  5 s window is what idle churn is measured over.

## Detectors

| Kind | Rule |
| --- | --- |
| `flicker` | the picture changes and returns to an earlier frame within 300 ms |
| `slow-first-paint` | first visible change, or first stable frame, more than 200 ms after the click |
| `slow` | the click's first visible change more than 300 ms after the click |
| `idle-churn` | the picture changes in two or more one-second bins between 2 s and 5 s after the last input |
| `blank-before-content` | flat frames (under 8 KB JPEG) come before content |
| `layout-shift` | a layout shift the browser reports without a recent input |
| `scroll-reset` | a scroll position jumps 30 px or more with no input |
| `scroll-dead` | a 240 px wheel does not move a scrollable that has overflow |
| `click-intercepted` | the centre point of the control is covered by another element |
| `dead-end` | the click changed no route, dialog, menu, text, focus or hash within 2 s |
| `no-way-back` | Escape does not close the overlay the control opened |
| `focus-loss` | focus falls to the body during Tab, or after Escape instead of returning to the trigger |
| `keyboard-trap` | Escape does not close an overlay |
| `contrast` | WCAG AA text contrast below 4.5:1 (3:1 for large text); disabled controls are exempt |
| `clipped-key-info` | an email, a clock time or a reset time is cut off by its box |
| `console-error`, `react-warning`, `unhandled-rejection`, `request-failed` | from the page |

Timing kinds are marked `[load-affected]` in the audit lines when the run is on a busy machine. Confirm
those on a quieter machine before filing.

## Outputs

- `paths.json`: every control with its status (`pass`, `flag`, `dead-end`, `skipped`, `not-reached`), its
  path, its problems and timings; the visited-graph edges; per-root stats; the coverage summary.
- `findings.jsonl`: one finding per problem, with repro steps and evidence file names.
- `frames/`: evidence images (the frame after the action, and both frames of a flicker).
- `videos/`, `traces/`: one per root.

`audit-lines.mjs` turns `findings.jsonl` into one line per finding. With an audit file it appends one
block under `## QA <os> (frame-level)` in a single write.

## Limits

- Chromium on the host is not Electron. Font rendering, scrollbars, and keyboard modifiers differ from
  the desktop app, so every line says Chromium on its OS.
- The fixture is the harness's fixed data. A state that only the live engine produces, such as a
  long-running agent or a rate-limit warning, is not walked by this run.
- A read-only walk against a live gateway is not included. It would need a transport-level allowlist
  and a client identity that does not trigger pairing. Without both it stays out of scope.
- Contrast is computed from the colours the browser reports, with semi-transparent text blended over its
  background. Gradients and images behind text are not sampled.
