import assert from "node:assert/strict";
import { test } from "node:test";
import { installGatewayParentWatchdog } from "./parent-watchdog.ts";

test("parent loss invokes the real gateway stop binding once", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let stops = 0;
  const release = installGatewayParentWatchdog(() => stops++, {
    env: { BRANCH_PARENT_PID: "123" },
    readParentPid: () => 123,
    isParentDead: () => true,
  });
  t.mock.timers.tick(1000);
  t.mock.timers.tick(5000);
  assert.equal(stops, 1);
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
