# Typing and streaming proof

Synthetic group fixture using the production Thread component, with two people typing and an agent streaming a 12,442-character reply containing headings, lists and code fences. No private conversation data.

- `typing.png`: independent named activity rows.
- `streamed.png`: end of the long streamed reply.
- `scrolled-up.png`: reading earlier content while more text arrives; scrollTop remains 200.
- `long-reply.webm`: 17.12-second screen recording of the long reply and scroll-up check.
- `performance.json`: non-recorded sample; variable frame budget, not a sustained-60-fps certification.
- `recorded-performance.json`: measurements with recording enabled, kept separate because recording adds work.

## Acceptance still open

Sustained 60 fps is not verified. A 55-character/32-ms non-recorded run reached median 16.8 ms / p95 50 ms, but repeat measurements varied. A slower sample measured median 33.3 ms / p95 83.3 ms; recording measured median 33.3 ms / p95 83.3 ms. These numbers must not be represented as a frame-budget pass. The PR stays draft for target-device profiling and any further optimization.

## Reproduction

Use the feature PR checkout and its locally installed window dependencies. The synthetic fixture uses the real Thread component and a fake engine returning test-only identities. Capture from a separate loopback Vite production preview, never from a running app's ports or data. Feed 35 sections containing prose, lists, and JavaScript fences in incremental chunks. Measure requestAnimationFrame intervals separately from recording, and test scrollTop after scrolling up and sending additional chunks. Capture the typing state before text arrives, the final reply, and the preserved reading position.

The proof branch is never merged. Product changes and regression tests are in the feature PR.
