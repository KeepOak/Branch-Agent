// OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/conversation/test_resource_lock_manager.py, tests/sdk/conversation/test_fifo_lock.py (atlas AGENT-LOOP-0182)
// Upstream ResourceLockManager/FIFOLock behaviour, asserted against Branch's existing per-resource
// queue. Lock timeouts are not ported: Branch bounds a queued tool call by its abort signal.
import { describe, expect, it } from "vitest";
import { resolveGlobalMap } from "../../../shared/global-singleton.js";
import { withFileMutationQueueKeysResolution } from "./file-mutation-queue.js";

const fileMutationTails = resolveGlobalMap<string, Promise<void>>(
  Symbol.for("branch.fileMutationTails"),
  "close-only",
);

function lock<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
  return withFileMutationQueueKeysResolution(Promise.resolve(keys), fn);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index++) {
    await Promise.resolve();
  }
}

describe("file mutation queue as a resource lock manager", () => {
  it("test_basic_lock_and_release", async () => {
    await expect(lock(["file:/a.py"], async () => "ok")).resolves.toBe("ok");
  });

  it("test_no_keys_is_noop", async () => {
    await expect(lock([], async () => "ran")).resolves.toBe("ran");
  });

  it("test_serializes_same_resource", async () => {
    const firstDone = deferred();
    let firstInside = false;
    let violation = false;
    const first = lock(["file:/shared.py"], async () => {
      firstInside = true;
      await firstDone.promise;
      firstInside = false;
    });
    await flush();
    const second = lock(["file:/shared.py"], async () => {
      violation = firstInside;
    });
    await flush();
    firstDone.resolve();
    await Promise.all([first, second]);
    expect(violation).toBe(false);
  });

  it("test_parallel_different_resources", async () => {
    const reached = [false, false];
    let arrivals = 0;
    const barrier = deferred();
    const worker = (index: number, key: string) =>
      lock([key], async () => {
        reached[index] = true;
        arrivals += 1;
        if (arrivals === 2) {
          barrier.resolve();
        }
        await barrier.promise;
      });
    await Promise.all([worker(0, "file:/a.py"), worker(1, "file:/b.py")]);
    expect(reached).toEqual([true, true]);
  });

  it("test_sorted_order_prevents_deadlock", async () => {
    const results: string[] = [];
    await Promise.all([
      lock(["r:1", "r:2"], async () => {
        results.push("A");
      }),
      lock(["r:2", "r:1"], async () => {
        results.push("B");
      }),
    ]);
    expect(new Set(results)).toEqual(new Set(["A", "B"]));
  });

  it("test_duplicate_keys_deduplicated", async () => {
    await expect(lock(["file:/a.py", "file:/a.py"], async () => "ok")).resolves.toBe("ok");
  });

  it("test_release_on_exception", async () => {
    await expect(
      lock(["file:/a.py"], async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(lock(["file:/a.py"], async () => "again")).resolves.toBe("again");
  });

  it("test_cleanup_removes_unused_locks", async () => {
    await lock(["file:/tmp.py"], async () => {
      expect(fileMutationTails.has("file:/tmp.py")).toBe(true);
    });
    await flush();
    expect(fileMutationTails.has("file:/tmp.py")).toBe(false);
  });

  it("test_cleanup_preserves_contended_locks", async () => {
    const release = deferred();
    const first = lock(["file:/x"], async () => {
      await release.promise;
    });
    await flush();
    const second = lock(["file:/x"], async () => "second");
    await flush();
    release.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, "second"]);
  });

  it("test_fifo_lock_fairness", async () => {
    const order: number[] = [];
    const hold = deferred();
    const holder = lock(["file:/fair"], async () => {
      await hold.promise;
    });
    await flush();
    const waiters = Array.from({ length: 10 }, (_, id) =>
      lock(["file:/fair"], async () => {
        order.push(id);
      }),
    );
    await flush();
    hold.resolve();
    await Promise.all([holder, ...waiters]);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
