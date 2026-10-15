// Types for scripts/windows-launcher.mjs, which build.mjs copies into dist beside the compiled sources.
export declare const WINDOWS_POINTER: "current.txt";
export declare const WINDOWS_LAUNCHER: "Branch Agent.cmd";
export declare const WINDOWS_LAUNCHER_EXE: "Branch Agent Launcher.exe";
export declare const WINDOWS_LAUNCHER_RESOURCE: "branch-launcher.exe";
export declare const WINDOWS_LAUNCHER_REVISION_FILE: "launcher-revision.txt";
export declare const WINDOWS_LAUNCHER_REVISION: string;
export declare const WINDOWS_APP_USER_MODEL_ID: string;
export interface WindowsLauncherFs {
  readText(path: string): string | undefined;
  exists(path: string): boolean;
}
export declare function windowsLauncherScript(): string;
export declare function windowsLaunchTarget(root: string, fs: WindowsLauncherFs): string | undefined;
export declare function runWindowsLauncher(options: { root: string; args?: string[]; fs: WindowsLauncherFs;
  spawn: (command: string, args: string[], options: { cwd: string; detached: boolean; stdio: "ignore"; windowsHide: boolean }) => unknown }): string | undefined;
export declare function windowsShortcutNeedsLauncher(target: string | undefined, root: string | undefined): boolean;
export declare function windowsLauncherSource(): string;
export declare function windowsLauncherCompiler(env: NodeJS.ProcessEnv, exists: (file: string) => boolean): string;
export declare function windowsLauncherCompileArgs(options: { source: string; out: string; icon?: string }): string[];
