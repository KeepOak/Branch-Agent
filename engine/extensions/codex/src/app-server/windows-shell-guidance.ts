import fs from "node:fs";
import path from "node:path";

// Codex runs shell commands through PowerShell 7 (C:\Program Files\PowerShell\7\pwsh.exe or pwsh.exe on PATH)
// when it exists and falls back to Windows PowerShell 5.1. Codex already sets [Console]::OutputEncoding to UTF-8,
// but 5.1's Get-Content/Set-Content/Out-File still read and write ANSI by default, so UTF-8 source (›, ’, §)
// comes back garbled and can be pasted into patches that way.
export const WINDOWS_SHELL_GUIDANCE =
  "PowerShell does not expand `*`/`?` for native programs: use `rg -g '<glob>' <pattern> <dir>`, `Get-ChildItem -Filter`, or explicit paths; never pass `dir/*` to rg, git or node. " +
  "A final probe (`Get-Process -ErrorAction SilentlyContinue`, `Test-Path`, `Select-String`, `rg` with no match) can exit 1 without stderr: not found, not failure. End probes with output or `; exit 0`.";

export const WINDOWS_POWERSHELL_51_GUIDANCE =
  "Shell: Windows PowerShell 5.1 file cmdlets default to ANSI, not UTF-8. Read with `Get-Content -Raw -Encoding UTF8` (or `rg`, `git show`), write with `-Encoding UTF8`, and edit with apply_patch. Never copy plain Get-Content text into edits: ›, ’ and § become garbled (Â§, â€™)." +
  " Windows PowerShell 5.1 strips embedded double quotes in native arguments: never put `\\\"` in one. Run node via a temp `.mjs` file; pass JSON/long bodies via files (`gh api --input file`, `jq -f file`).";

export type PowerShellProbe = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
};

/** True when Codex would find PowerShell 7 the way it looks for it: the default install, then PATH. */
export function hasPowerShell7(probe: PowerShellProbe): boolean {
  const installs = [probe.env.ProgramFiles, probe.env.ProgramW6432]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => path.win32.join(dir, "PowerShell", "7", "pwsh.exe"));
  const onPath = (probe.env.PATH ?? probe.env.Path ?? "")
    .split(";")
    .filter(Boolean)
    .map((dir) => path.win32.join(dir, "pwsh.exe"));
  return [...installs, ...onPath].some((file) => probe.exists(file));
}

export function buildWindowsShellGuidance(
  probe: PowerShellProbe = { platform: process.platform, env: process.env, exists: fs.existsSync },
): string | undefined {
  if (probe.platform !== "win32") {
    return undefined;
  }
  return hasPowerShell7(probe)
    ? WINDOWS_SHELL_GUIDANCE
    : `${WINDOWS_SHELL_GUIDANCE} ${WINDOWS_POWERSHELL_51_GUIDANCE}`;
}
