import fs from "node:fs";
import path from "node:path";

// Codex runs shell commands through PowerShell 7 (C:\Program Files\PowerShell\7\pwsh.exe or pwsh.exe on PATH)
// when it exists and falls back to Windows PowerShell 5.1. Codex already sets [Console]::OutputEncoding to UTF-8,
// but 5.1's Get-Content/Set-Content/Out-File still read and write ANSI by default, so UTF-8 source (›, ’, §)
// comes back garbled and can be pasted into patches that way.
export const WINDOWS_POWERSHELL_51_GUIDANCE =
  "Shell: commands here run in Windows PowerShell 5.1, whose file cmdlets default to ANSI, not UTF-8. " +
  "Read text with `Get-Content -Raw -Encoding UTF8` (or `rg`, `git show`), write it with `-Encoding UTF8`, " +
  "and make file edits with apply_patch. Never copy text read through a plain Get-Content into an edit; " +
  "characters such as ›, ’ and § come back garbled (Â§, â€™).";

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
  if (probe.platform !== "win32" || hasPowerShell7(probe)) {
    return undefined;
  }
  return WINDOWS_POWERSHELL_51_GUIDANCE;
}
