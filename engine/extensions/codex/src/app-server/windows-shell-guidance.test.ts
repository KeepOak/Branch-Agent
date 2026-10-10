import { describe, expect, it } from "vitest";
import { buildDeveloperInstructions } from "./thread-prompt.js";
import {
  buildWindowsShellGuidance,
  WINDOWS_SHELL_GUIDANCE,
  WINDOWS_POWERSHELL_51_GUIDANCE,
  type PowerShellProbe,
} from "./windows-shell-guidance.js";

const windows = (files: string[], env: NodeJS.ProcessEnv = {}): PowerShellProbe => ({
  platform: "win32",
  env: { ProgramFiles: "C:\\Program Files", PATH: "C:\\Windows\\System32", ...env },
  exists: (file) => files.includes(file),
});

describe("Windows shell guidance for Codex turns", () => {
  it("tells a Windows PowerShell 5.1 turn to read and write files as UTF-8", () => {
    const guidance = buildWindowsShellGuidance(windows([]));
    expect(guidance).toContain("rg -g");
    expect(guidance).toContain(".mjs");
    expect(guidance).toContain("-Encoding UTF8");
    expect(guidance).toBe(`${WINDOWS_SHELL_GUIDANCE} ${WINDOWS_POWERSHELL_51_GUIDANCE}`);
    expect(WINDOWS_POWERSHELL_51_GUIDANCE).toContain("-Encoding UTF8");
  });

  it("pwsh 7 gets the common block only", () => {
    const guidance = buildWindowsShellGuidance(windows(["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]));
    expect(guidance).toContain("rg -g");
    expect(guidance).toContain("SilentlyContinue");
    expect(guidance).toBe(WINDOWS_SHELL_GUIDANCE);
    expect(guidance).not.toContain("PowerShell 5.1");
    expect(guidance).not.toContain("-Encoding UTF8");
    expect(guidance).not.toContain(".mjs");
    expect(
      buildWindowsShellGuidance(windows(["D:\\tools\\pwsh.exe"], { PATH: "D:\\tools;C:\\Windows" })),
    ).toBe(WINDOWS_SHELL_GUIDANCE);
  });

  it("stays out when the host is not Windows", () => {
    expect(buildWindowsShellGuidance({ platform: "linux", env: {}, exists: () => false })).toBeUndefined();
  });

  it("reaches the thread developer instructions on a 5.1 host", () => {
    const instructions = buildDeveloperInstructions(
      { config: {}, agentId: "builder", sessionKey: "agent:builder:main" } as Parameters<
        typeof buildDeveloperInstructions
      >[0],
      { windowsShellProbe: windows([]) },
    );
    expect(instructions).toContain(WINDOWS_POWERSHELL_51_GUIDANCE);
  });
});
