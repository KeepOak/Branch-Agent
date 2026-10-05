import { readdirSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { withMockedPlatform } from "../test-utils/vitest-spies.js";
import { hiddenSpawnOptions, spawnProcess } from "./spawn-utils.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runtimeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return runtimeFiles(file);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|test-support|spec)\.[cm]?tsx?$/.test(entry.name)
      ? [file]
      : [];
  });
}

describe("hidden Windows child processes", () => {
  it("forces hidden options at the supervised spawn boundary", async () => {
    const input = { windowsHide: false, stdio: "ignore" } as const;
    spawnMock.mockReturnValue(Object.assign(new EventEmitter(), { pid: 123 }));
    await withMockedPlatform("win32", async () => {
      spawnProcess("taskkill", [], input);
    });
    expect(spawnMock).toHaveBeenCalledWith("taskkill", [], { windowsHide: true, stdio: "ignore" });
    expect(hiddenSpawnOptions(input, "linux")).toBe(input);
  });

  it("covers raw Node spawns before engine imports and rejects new visible overrides", () => {
    const launcher = readFileSync(join(engineRoot, "branch.mjs"), "utf8");
    expect(launcher.indexOf("module.syncBuiltinESMExports()")).toBeLessThan(
      launcher.indexOf('import("./node-host-launcher.mjs")'),
    );
    expect(launcher).toContain("module.syncBuiltinESMExports()");
    for (const api of ["spawn", "spawnSync", "execFile", "execFileSync", "fork", "exec", "execSync"]) {
      expect(launcher).toContain(`"${api}"`);
    }
    const exceptions = new Set([join(engineRoot, "src/daemon/schtasks-state-probe.ts")]);
    const offenders = [join(engineRoot, "src"), join(engineRoot, "extensions")]
      .flatMap(runtimeFiles)
      .filter((file) => !exceptions.has(file) && /windowsHide\s*:\s*false/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
