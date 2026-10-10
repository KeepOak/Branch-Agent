# Measure a local worker

This is the arch-0 prerequisite for local worker isolation. It reuses the
`branch worker` launch contract described in
[`engine/docs/cli/worker.md`](../../../engine/docs/cli/worker.md), research
section 7 option 2, and the release worker configurations in
`engine/tsdown.config.ts`. RSS collection follows the `process.resourceUsage()`
preload pattern in `engine/scripts/profile-extension-memory.mts`.

## Run

Install the checkout with `node scripts/install-worktree.mjs both`. Then:

```sh
cd engine
node scripts/run-vitest.mjs run src/worker/worker-measure-report.test.ts
node --import ./scripts/tsx.mjs ../scripts/measure-worker.mjs build
cd ..
node scripts/measure-worker.mjs run worker-measure.json
```

The local run refuses to start unless free memory is above 6 GiB. The
`Local worker measurement` PR workflow runs this on Windows, macOS and Linux
runners and saves one JSON report per OS. Each job has the existing 15-minute
limit. Build configurations run sequentially.

## What the numbers mean

- **Start time:** wall-clock milliseconds from spawning the release worker
  application to its first admitted inference request. Building the bundle and
  starting the scratch gateway are outside this interval.
- **Idle RSS:** median application-process RSS during one second after a tiny
  fake turn finishes and the managed worker confirms idle retention.
- **Peak RSS:** the application's OS high-water RSS, obtained through
  `process.resourceUsage().maxRSS` (KiB converted to bytes). It includes cold
  startup and the turn, not just peaks caught by the 25 ms sampling timer.
- **MB:** decimal megabytes. The card's rule is strict: idle RSS below
  400,000,000 bytes means **per-turn child**; otherwise **pooled worker**.

The measured executable is the shipped sealed worker application, not a
TypeScript loader or a mocked worker. A small preload reports RSS over a separate
IPC channel; stdout retains the worker's normal result protocol. Managed mode
holds the same application idle after its single turn, allowing an idle reading.
There is no provider credential and no external model call.

The scratch engine is the existing `ComposedGatewayHarness`, using the real
gateway worker admission, placement, inference, transcript and live-event
handlers, with a fake inference result. It is not a full desktop gateway.
The report requires exactly one inference call, a transcript commit and a
completed retained turn. It uses its own temporary home, state and config,
and a kernel-assigned loopback port. It never connects to the running app.

These are **application-process** readings: they exclude the scratch gateway
and separate storage children. They are not a whole-process-tree admission
budget or a realistic long-turn workload estimate. Measure those separately
when implementing memory-aware admission. No artificial model-history load,
forced garbage collection, worker heap cap or compile-cache prewarm is applied.

Use the three CI reports in the PR body, including OS, architecture and runtime
version. Apply the card's recommendation conservatively across all three OSes:
per-turn children only if every measured idle RSS is below 400 MB.
