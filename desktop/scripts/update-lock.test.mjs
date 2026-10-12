import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { createUpdateLock } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "update-lock.js")));

test("one holder at a time; a second acquire is refused, never queued", async () => {
  const released = [];
  const lock = createUpdateLock(handle => { released.push(handle.purpose); });
  const update = lock.acquire("update 0.5.0");
  assert.ok(update); assert.equal(lock.held, true); assert.equal(lock.purpose, "update 0.5.0");
  assert.equal(lock.acquire("replace the staged update"), undefined);
  assert.equal(lock.holds(update), true);
  await lock.release(update);
  assert.equal(lock.held, false); assert.deepEqual(released, ["update 0.5.0"]);
  // A stale or repeated release never frees someone else's hold.
  const replacing = lock.acquire("replace the staged update");
  await lock.release(update);
  assert.equal(lock.holds(replacing), true); assert.deepEqual(released, ["update 0.5.0"]);
  await lock.release(replacing); await lock.release(replacing);
  assert.deepEqual(released, ["update 0.5.0", "replace the staged update"]);
});

test("Undo (#380) holds the lock across its prepare and the swap; a staged-update replacement is refused throughout", async () => {
  const lock = createUpdateLock();
  const steps = [];
  // As main.ts swapEngineInPlace: a held handle runs the swap under the same hold, anything else is refused.
  const swap = async (held) => {
    if (held ? !lock.holds(held) : lock.held) throw new Error("The desktop is not ready to update");
    const own = held ?? lock.acquire("update");
    try { steps.push("swap"); } finally { if (!held) await lock.release(own); }
  };
  // As main.ts underSwapGuard: resolves undefined while anyone holds the lock.
  const replaceStaged = async () => {
    const own = lock.acquire("replace the staged update");
    if (!own) return undefined;
    try { steps.push("replaced"); return true; } finally { await lock.release(own); }
  };
  const undo = lock.acquire("undo");
  try {
    steps.push("prepare undo");                       // prepareComponentUpdateUndo: the reverse publication
    assert.equal(await replaceStaged(), undefined);    // a newer download never replaces the Undo journal
    await assert.rejects(swap(), /not ready/);         // nor does an Update click start its own swap
    await swap(undo);                                  // Undo's own swap runs under its hold
    assert.equal(await replaceStaged(), undefined);
  } finally { await lock.release(undo); }
  assert.equal(await replaceStaged(), true);
  assert.deepEqual(steps, ["prepare undo", "swap", "replaced"]);
});
