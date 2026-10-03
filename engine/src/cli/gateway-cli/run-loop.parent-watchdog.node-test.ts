import assert from "node:assert/strict";
import { test } from "node:test";
import { installGatewayParentWatchdog } from "./parent-watchdog.ts";

test("parent loss binds to the real gateway stop request with one shutdown reason", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const reasons: string[] = [];
  const release = installGatewayParentWatchdog((reason) => reasons.push(reason), {
    env: { BRANCH_PARENT_PID: "123" },
    readParentPid: () => 123,
    isParentDead: () => true,
  });
  t.mock.timers.tick(1000);
  t.mock.timers.tick(5000);
  assert.deepEqual(reasons, ["parent process gone"]);
  release();
});

test("gateway cleanup releases the parent observer before a later loss", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const release = installGatewayParentWatchdog(() => assert.fail("retired loop requested shutdown"), {
    env: { BRANCH_PARENT_PID: "123" },
    readParentPid: () => 123,
    isParentDead: () => true,
  });
  release();
  t.mock.timers.tick(5000);
});
