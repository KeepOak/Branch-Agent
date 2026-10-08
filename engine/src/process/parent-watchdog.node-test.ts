import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { once } from "node:events";
import { test } from "node:test";
import { startParentWatchdog } from "./parent-watchdog.ts";

for (const value of [undefined, "", "0", "-1", "1.5", "garbage"]) {
  test(`does not watch an unconfigured or invalid parent: ${String(value)}`, (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    let calls = 0;
    const stop = startParentWatchdog(() => calls++, undefined, {
      env: { BRANCH_PARENT_PID: value },
      readParentStartTime: () => null,
      readParentPid: () => assert.fail("inactive watchdog read the parent"),
      isParentDead: () => assert.fail("inactive watchdog probed a PID"),
    });
    t.mock.timers.tick(5000);
    stop();
    assert.equal(calls, 0);
  });
}

test("preserves the 1000ms default and fires only once on definite death", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  let probes = 0;
  const stop = startParentWatchdog(() => calls++, undefined, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentStartTime: () => null,
    readParentPid: () => 123,
    isParentDead: (pid) => {
      assert.equal(pid, 123);
      probes++;
      return true;
    },
  });
  t.mock.timers.tick(999);
  assert.equal(probes, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
  t.mock.timers.tick(4000);
  assert.equal(calls, 1);
  stop();
});

test("stays alive after an inconclusive probe, then detects definite death", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let dead = false;
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentStartTime: () => null,
    readParentPid: () => 123,
    isParentDead: () => dead,
  });
  t.mock.timers.tick(30);
  assert.equal(calls, 0);
  dead = true;
  t.mock.timers.tick(10);
  assert.equal(calls, 1);
  stop();
});

test("detects reparenting even when the configured PID still exists", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let ppid = 123;
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentStartTime: () => null,
    readParentPid: () => ppid,
    isParentDead: () => assert.fail("reparenting must not require a liveness probe"),
  });
  ppid = 1;
  t.mock.timers.tick(10);
  assert.equal(calls, 1);
  stop();
});

for (const unknown of [-1, 0]) {
  test(`unknown parent query ${unknown} defers to configured parent liveness`, (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    let ppid = 123;
    let dead = false;
    let calls = 0;
    const stop = startParentWatchdog(() => calls++, 10, {
      env: { BRANCH_PARENT_PID: "123" },
      readParentStartTime: () => null,
      readParentPid: () => ppid,
      isParentDead: (pid) => { assert.equal(pid, 123); return dead; },
    });
    ppid = unknown;
    t.mock.timers.tick(30);
    assert.equal(calls, 0);
    dead = true;
    t.mock.timers.tick(10);
    assert.equal(calls, 1);
    t.mock.timers.tick(30);
    assert.equal(calls, 1);
    stop();
  });
}

test("an unknown initial parent does not turn its first successful read into reparenting", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let ppid = -1;
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentStartTime: () => null,
    readParentPid: () => ppid,
    isParentDead: () => false,
  });
  ppid = 123;
  t.mock.timers.tick(30);
  assert.equal(calls, 0);
  stop();
});

test("sticky Windows creator PID cannot hide a changed parent birth identity", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let birth: number | null = 100;
  let calls = 0;
  let probes = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentPid: () => 123,
    isParentDead: () => false, // Models a reused numerical PID that still exists.
    readParentStartTime: (pid) => { assert.equal(pid, 123); probes++; return birth; },
  });
  t.mock.timers.tick(10);
  assert.equal(calls, 0);
  birth = null;
  t.mock.timers.tick(10);
  assert.equal(calls, 0, "unknown birth query must preserve the original identity");
  birth = 101;
  t.mock.timers.tick(10);
  assert.equal(calls, 1);
  const finalProbes = probes;
  t.mock.timers.tick(30);
  assert.equal(calls, 1);
  assert.equal(probes, finalProbes, "one-shot timer kept probing after orphaning");
  stop();
});

test("failed initial birth identity retries without treating recovery as PID reuse", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let birth: number | null = null;
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentPid: () => 123,
    isParentDead: () => false,
    readParentStartTime: () => birth,
  });
  t.mock.timers.tick(20);
  assert.equal(calls, 0);
  birth = 100;
  t.mock.timers.tick(20);
  assert.equal(calls, 0);
  birth = 101;
  t.mock.timers.tick(10);
  assert.equal(calls, 1);
  stop();
});

test("does not treat PID 1 or an initial init parent as missing", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let ppid = 1;
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "1" },
    readParentStartTime: () => null,
    readParentPid: () => ppid,
    isParentDead: () => assert.fail("PID 1 must not be probed"),
  });
  ppid = 456;
  t.mock.timers.tick(40);
  assert.equal(calls, 0);
  stop();
});

test("explicit cleanup cancels observation before the parent exits", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentStartTime: () => null,
    readParentPid: () => 123,
    isParentDead: () => true,
  });
  stop();
  stop();
  t.mock.timers.tick(50);
  assert.equal(calls, 0);
});

test("native ESRCH stops but EPERM and unknown errors keep the engine alive", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let code = "EPERM";
  t.mock.method(process, "kill", () => { throw Object.assign(new Error(code), { code }); });
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentStartTime: () => null,
    readParentPid: () => 123,
  });
  t.mock.timers.tick(10);
  assert.equal(calls, 0);
  code = "EINVAL";
  t.mock.timers.tick(10);
  assert.equal(calls, 0);
  code = "ESRCH";
  t.mock.timers.tick(10);
  assert.equal(calls, 1);
  stop();
});

test("native Linux liveness rejects zombies while retaining live sibling threads", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  let threads = "2";
  t.mock.method(process, "kill", () => true);
  t.mock.method(fs, "readFileSync", () => `State:\tZ (zombie)\nThreads:\t${threads}\n`);
  let calls = 0;
  const stop = startParentWatchdog(() => calls++, 10, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentStartTime: () => null,
    readParentPid: () => 123,
  });
  try {
    t.mock.timers.tick(10);
    assert.equal(calls, 0);
    threads = "1";
    t.mock.timers.tick(10);
    assert.equal(calls, 1);
  } finally {
    stop();
    Object.defineProperty(process, "platform", platform);
  }
});

test("observation sees an owned parent fixture exit naturally with a sticky creator PID", { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ["-e", `
    process.once("message", () => { process.disconnect(); });
    process.send("ready");
  `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const closed = once(child, "close");
  const reapBound = setTimeout(() => child.kill("SIGKILL"), 2000);
  let stop = () => {};
  let bound: ReturnType<typeof setTimeout> | undefined;
  let calls = 0;
  try {
    await once(child, "message");
    const orphan = new Promise<void>((resolve) => {
      stop = startParentWatchdog(() => { calls++; resolve(); }, 10, {
        env: { BRANCH_PARENT_PID: String(child.pid) },
        // Models Windows's retained creator PID while using real native liveness.
        readParentPid: () => child.pid!,
      });
    });
    child.send("exit");
    const [code] = await closed;
    assert.equal(code, 0, "owned fixture did not exit naturally");
    await Promise.race([
      orphan,
      new Promise<void>((_, reject) => {
        bound = setTimeout(() => reject(new Error("watchdog did not observe owned parent exit")), 2000);
      }),
    ]);
    assert.equal(calls, 1);
  } finally {
    stop();
    clearTimeout(bound);
    clearTimeout(reapBound);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await closed.catch(() => undefined);
  }
});

test("the upstream real missing-parent case fires after an owned child exits", { timeout: 5000 }, async () => {
  // Only this short-lived fixture child is created; no existing process is signalled.
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid!;
  const closed = once(child, "close");
  const reapBound = setTimeout(() => child.kill("SIGKILL"), 2000);
  let stop = () => {};
  let bound: ReturnType<typeof setTimeout> | undefined;
  try {
    const [code] = await closed;
    assert.equal(code, 0, "owned fixture did not exit normally before its deadline");
    await Promise.race([
      new Promise<void>((resolve) => {
        stop = startParentWatchdog(resolve, 10, { env: { BRANCH_PARENT_PID: String(pid) } });
      }),
      new Promise<void>((_, reject) => {
        bound = setTimeout(() => reject(new Error("watchdog did not fire")), 2000);
      }),
    ]);
  } finally {
    stop();
    clearTimeout(bound);
    clearTimeout(reapBound);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await closed.catch(() => undefined);
  }
});

test("an unrefed parent timer does not retain an otherwise idle engine", { timeout: 5000 }, async () => {
  const moduleUrl = new URL("./parent-watchdog.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { startParentWatchdog } from ${JSON.stringify(moduleUrl)};
    startParentWatchdog(() => process.exit(2), undefined, {
      env: { BRANCH_PARENT_PID: String(process.pid) },
    });
  `], { stdio: "pipe" });
  let stderr = "";
  child.stderr.on("data", (bytes) => { stderr += String(bytes); });
  const bound = setTimeout(() => child.kill("SIGKILL"), 2000);
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr);
  } finally {
    clearTimeout(bound);
  }
});
