# PR #1290 streaming frame budget on the Legion (real GPU)

Board card KeepOak/Branch-Agent-Private#811. Measured on PR #1290 head `3394f5fff8e1ade597e11e7e672d62d757d285d3`. No product code changed; this branch only holds the proof and is never merged.

## Setup

- Lenovo Legion laptop, interactive desktop session (session 1). Panel runs at 165 Hz on Intel Graphics (ANGLE D3D11); the NVIDIA RTX 5070 Laptop GPU is also present. `chrome://gpu`: Compositing, Rasterization, Canvas and WebGL all **Hardware accelerated** (`gpu-feature-status.png`).
- Installed Chrome 154, headed (visible window), 1200x800 viewport.
- **Dev build**: `vite` dev server on a private loopback port. React runs in development mode.
- Harness (`harness/`): the production `Thread` component with a fake engine, as in the NAS proof. The fixture is 12,442 characters: 35 sections, each with a heading, a paragraph, a 3-item list (bold and inline code) and a `js` code fence, plus a closing paragraph. It arrives as 55-character chunks every 32 ms, the NAS's 55 chars / 32 ms run.
- Frame time is the `requestAnimationFrame` interval from the first chunk until the reveal finishes, the same method as the NAS. Long tasks use the `longtask` PerformanceObserver.
- 5 non-recorded passes, then 1 recorded pass with a Chrome trace (devtools.timeline, frame, screenshots, V8 sampling).

## Results

The target is p95 at or under 16.7 ms. **It passes on every pass.**

| Pass | Frames | Median | p95 | p99 | Max | Frames > 16.7 ms | Long tasks > 50 ms |
|---|---|---|---|---|---|---|---|
| 1 | 1231 | 6.1 ms | 6.2 ms | 6.2 ms | 12.1 ms | 0 | 0 |
| 2 | 1232 | 6.1 ms | 6.1 ms | 6.2 ms | 12.2 ms | 0 | 0 |
| 3 | 1233 | 6.1 ms | 6.2 ms | 6.2 ms | 6.4 ms | 0 | 0 |
| 4 | 1231 | 6.1 ms | 6.2 ms | 6.2 ms | 12.2 ms | 0 | 0 |
| 5 | 1232 | 6.1 ms | 6.2 ms | 6.2 ms | 6.5 ms | 0 | 0 |
| 6 (recorded, tracing on) | 1233 | 6.1 ms | 6.2 ms | 12.0 ms | 109.1 ms* | 1* | 0 |

6.06 ms is one vsync at 165 Hz, so the median sits exactly on vsync. The 12.1 ms maxima are single skipped vsyncs.

\* The one 109 ms interval in the recorded pass is tracing start-up, not the app. The trace shows a 114.8 ms task (`V8.InvokeApiInterruptCallbacks`, the CPU profiler starting) that ends at the `stream-start` mark. Inside the streaming window the trace shows:

- Renderer main thread: 25,922 tasks. p95 2.89 ms, p99 4.09 ms, max **5.87 ms**. No task over 50 ms.
- Chrome's dropped-frame counters (`dropped_v3`/`dropped_v4`) stayed at **0** over 589 expected frames.
- PipelineReporter: 1,294 main frames `STATE_PRESENTED_ALL`, 15 `STATE_PRESENTED_PARTIAL`, none dropped. The other 1,294 PARTIAL entries are `FORKED` duplicates.
- AnimationFrame (LoAF) intervals: median 6.06 ms, p95 7.89 ms, p99 9.57 ms, max 10.97 ms. Main-thread work per frame: median 5 ms, p95 6 ms, max 9 ms. No blocking frames.
- viz `Display::DrawAndSwap` intervals: median 6.06 ms, p95 6.13 ms, max 7.05 ms.

The reveal kept pace: it finished about 210 ms after the last chunk arrived (feed 7.27 s, reveal done 7.47 s). The final DOM had 35 code blocks and 105 list items.

For comparison, the NAS VM (software rendering) measured median 33.3 ms and p95 83.3 ms.

Headroom note: in this dev build, main-thread work per frame (median 5 ms) is close to the 6.06 ms budget at 165 Hz. At 60 Hz (16.7 ms) there is about 3x headroom. A production build does less React work per frame.

## Trace screenshots

- `trace-frame-chart.png`: presented-frame intervals, main-thread frame intervals and task durations across the whole streaming window.
- `perfetto-overview.png`, `perfetto-renderer-main.png`: the recorded Chrome trace (400 ms slice) in Perfetto UI. The renderer main thread shows short React commits each frame.
- `trace-shot-*.jpg`: frames from the trace's own screenshot filmstrip.
- `trace-slice-3000-3400ms.json`: the 400 ms trace slice (metadata stripped). Open it in DevTools Performance or ui.perfetto.dev.

## Visual comparison with the approved preview (docs/design/r1/preview.html)

`compare-preview-vs-pr.png`, `preview-typing.png`, `preview-streaming.png`, `typing-start.png`, `early-stream.png`

- **Matches:** a face plus "<Name> is ..." plus three animated dots before text arrives. Text streams in place with a soft fade on the newest text. The view follows the bottom with no jumps.
- **Differences:**
  1. Label: the preview says "Scout is **thinking**"; the PR says "is **typing**" before text and "is **working**" during text.
  2. The preview *replaces* the thinking row with the reply, headed by the sender name. In the PR, the "is working" row stays under the streaming text until the run ends.
  3. Fade: the preview fades each word from `opacity:0; filter:blur(2px)` over 320 ms, staggered 28 ms per word (`.tokP17`). The PR fades each chunk from `opacity:.25` over 180 ms with no blur (`.stream-chunk`/`stream-in`).
- Note: the preview reveals a short canned line; it has no long multi-block reply to compare against. Its avatars are broken images because the file was opened outside its asset folder.

## Reproduce

Copy `harness/*` into `window/test-integration/` of a checkout at the PR head and install with `node scripts/install-worktree.mjs window`. Then, from `window/`:

```
MODE=dev LABEL=dev OUT=<out dir> PASSES=5 RECORD=1 GPU=1 node test-integration/stream-perf-orchestrate.mjs
node test-integration/stream-perf-trace.mjs <out dir>/trace.json <out dir>
```

The orchestrator starts Vite on loopback port 5291, runs the driver, then stops Vite by its process id. It never uses the app's ports (19031/19032) or its data folder.
