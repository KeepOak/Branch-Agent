import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MacComputerDriver } from "../dist/mac-computer-driver.js";

test("Mac app requests both permissions before supplying a live embedded driver endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-driver-test-"));
  const binary = join(dir, "cua-driver");
  await writeFile(binary, "fixture");
  const events = [];
  let granted = false;
  const exit = new EventEmitter();
  const sdk = () => ({
    requestMacOSPermissions: () => { events.push("permission request"); return { accessibility: granted, screenRecording: granted }; },
    hasRequiredMacOSPermissions: status => status.accessibility && status.screenRecording,
    EmbeddedPermissionMode: { Unrestricted: 2 },
    EmbeddedCuaDriverHost: class {
      static withOptions(options) {
        assert.equal(options.binaryPath, binary);
        assert.equal(options.hostBundleId, "ai.branch.mac");
        assert.equal(options.permissionMode, 2);
        assert.equal(options.dangerouslyBypassApprovals, true);
        return new this();
      }
      async start() { events.push("start"); return { socketPath: join(dir, "driver.sock"), generation: "one" }; }
      async stop() { events.push("stop"); }
      waitForExit() { return new Promise(resolve => exit.once("exit", resolve)); }
      uniffiDestroy() { events.push("destroy"); }
    },
  });
  const driver = new MacComputerDriver(() => {}, sdk, () => "ai.branch.mac");
  try {
    assert.equal(await driver.start(dir), undefined);
    assert.deepEqual(events, ["permission request"]);
    granted = true;
    const endpoint = JSON.parse(await driver.start(dir));
    assert.deepEqual(endpoint, { v: 1, socketPath: join(dir, "driver.sock"), binaryPath: binary });
    assert.deepEqual(events, ["permission request", "permission request", "start"]);
    assert.equal(await driver.start(dir), JSON.stringify(endpoint));
    await driver.stop();
    assert.deepEqual(events.slice(-2), ["stop", "destroy"]);
    exit.emit("exit");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
