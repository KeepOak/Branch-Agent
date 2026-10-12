// Shared result types for the command scan (atlas SAFETY-0019).

/** How a finding should be treated by the existing approval path. */
export type CommandScanIntent = "hard_stop" | "ask";

export type CommandScanFinding = {
  /** Stable rule id, e.g. "rm.recursive-force-root-or-home". */
  id: string;
  reason: string;
  intent: CommandScanIntent;
  /** The command step (or whole source) the finding is about. */
  command: string;
};

export type CommandScanOptions = {
  /** Directory the command runs in. */
  cwd?: string;
  /** Directory the session is anchored to; defaults to cwd. */
  originalCwd?: string;
  /** Home directory used for "~" and "$HOME". */
  home?: string;
  /** Report targets that cannot be verified (variables, globs, substitutions). */
  strict?: boolean;
};

/** One parsed command word: decoded value plus the raw source text. */
export type CommandScanWord = { value: string; raw: string };
