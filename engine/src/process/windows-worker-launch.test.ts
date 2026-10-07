import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withMockedPlatform } from "../test-utils/vitest-spies.js";
import { brokerExecaOptions } from "./spawn-broker/execa-client.js";
import { brokerSpawnOptions } from "./spawn-broker/host.js";
import { hiddenWindowsOptions } from "./windows-hidden-options.js";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("hidden Windows runtime workers", () => {
  it("passes hidden options through both broker spawn protocols", async () => {
    await withMockedPlatform("win32", () => {
      expect(hiddenWindowsOptions({ stdio: "ignore" })).toEqual({ stdio: "ignore", windowsHide: true });
      expect(hiddenWindowsOptions({ windowsHide: false })).toEqual({ windowsHide: false });
      expect(brokerSpawnOptions({ stdio: "ignore" })?.windowsHide).toBe(true);
      expect(brokerExecaOptions({ shell: false })?.windowsHide).toBe(true);
    });
  });

  it("hides native SQLite workers and the broker's own children", () => {
    expect(source("../infra/sqlite-readonly-worker-session.ts")).toMatch(
      /const spawnOptions: SpawnOptions = hiddenWindowsOptions\(/,
    );
    expect(source("../infra/sqlite-readonly-worker.ts")).toMatch(/execFile\([\s\S]*?hiddenWindowsOptions\(/);
    expect(source("../infra/sqlite-readonly-worker.ts")).toMatch(/spawnSync\([\s\S]*?hiddenWindowsOptions\(/);
    expect(source("./spawn-broker/host.ts")).toMatch(
      /const brokerLaunchOptions: SpawnOptions = hiddenWindowsOptions\(/,
    );
    expect(source("./spawn-broker/worker.ts")).toMatch(/spawnWithInheritedOomScore\([^\n]*hiddenWindowsOptions\(/);
    expect(source("./spawn-broker/execa-worker.ts")).toMatch(/const spawnOptions = hiddenWindowsOptions\(/);
    const codexTransport = source("../../extensions/codex/src/app-server/transport-stdio.ts");
    expect(codexTransport).toContain("const launch = withHiddenWindowsConsole(invocation)");
    expect(codexTransport).toContain("spawn(launch.command, launch.argv, {");
    expect(codexTransport).toContain('windowsHide: launch.windowsHide ?? (process.platform === "win32")');
  });
});
