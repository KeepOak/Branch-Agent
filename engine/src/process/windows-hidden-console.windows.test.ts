import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withHiddenWindowsConsole } from "../plugin-sdk/windows-spawn.js";
import { spawnWithHiddenConsole } from "./windows-hidden-console-child.js";

describe("Windows inherited hidden console", () => {
  it("starts the child after hidden console allocation fails and warns once", async () => {
    const root = mkdtempSync(join(tmpdir(), "branch-hidden-console-fallback-"));
    try {
      const marker = join(root, "started");
      const warnings: string[] = [];
      const child = await spawnWithHiddenConsole(
        process.execPath,
        ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`],
        false,
        async () => { throw new Error("job retention should be skipped"); },
        async () => { throw new Error("AllocConsole failed"); },
        (message) => warnings.push(message),
      );
      const [code] = await once(child, "exit");
      expect(code).toBe(0);
      expect(existsSync(marker)).toBe(true);
      expect(warnings).toEqual(["hidden console unavailable: AllocConsole failed"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")("gives an unhiding PowerShell grandchild an invisible console (requires Win32 console APIs)", () => {
    const root = mkdtempSync(join(tmpdir(), "branch-hidden-console-"));
    try {
      const standin = join(root, "standin.cjs");
      const command = `Add-Type -Namespace ConsoleProbe -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);'; $h=[ConsoleProbe.Native]::GetConsoleWindow(); Write-Output "handle=$h visible=$([ConsoleProbe.Native]::IsWindowVisible($h))"`;
      writeFileSync(standin, `const { spawnSync } = require("node:child_process");\nconst { readFileSync } = require("node:fs");\nconst result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ${JSON.stringify(command)}], { encoding: "utf8", windowsHide: false });\nprocess.stdout.write(result.stdout); process.stdout.write("rpc=" + readFileSync(0, "utf8")); process.stderr.write(result.stderr); process.exitCode = result.status ?? 1;\n`);
      const invocation = withHiddenWindowsConsole({ command: process.execPath, argv: [standin], resolution: "direct" });
      const result = spawnSync(invocation.command, invocation.argv, {
        encoding: "utf8",
        input: "ping\n",
        windowsHide: invocation.windowsHide,
        timeout: 20_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/handle=[1-9]\d* visible=False/);
      expect(result.stdout).toContain("rpc=ping\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
