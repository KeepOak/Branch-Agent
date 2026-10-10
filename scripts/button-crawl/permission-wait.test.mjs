import assert from "node:assert/strict";
import test from "node:test";
import { waitForPermissionRequests } from "./permission-wait.mjs";

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("settles at once when no permission request is in flight", async () => {
  const clock = fakeClock();
  const frames = [];
  const result = await waitForPermissionRequests({
    readPending: async () => 0,
    frames: async (n) => { frames.push(n); },
    wait: async () => { throw new Error("must not wait when nothing is pending"); },
    now: clock.now,
  });
  assert.deepEqual(result, { timedOut: false, pending: 0 });
  assert.deepEqual(frames, [1, 2]);
});

test("waits while requests are pending and settles when the count reaches zero", async () => {
  const clock = fakeClock();
  const counts = [2, 1, 0];
  const waits = [];
  const result = await waitForPermissionRequests({
    readPending: async () => counts.shift(),
    frames: async () => {},
    wait: async (ms) => { waits.push(ms); clock.advance(ms); },
    now: clock.now,
  });
  assert.deepEqual(result, { timedOut: false, pending: 0 });
  assert.deepEqual(waits, [20, 20]);
});

test("stops at the cap and reports the requests still pending", async () => {
  const clock = fakeClock();
  const result = await waitForPermissionRequests({
    readPending: async () => 1,
    frames: async () => {},
    wait: async (ms) => clock.advance(1000),
    now: clock.now,
    capMs: 5000,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.pending, 1);
  assert.ok(clock.now() > 5000 && clock.now() <= 7000, `stopped near the cap, at ${clock.now()}ms`);
});
