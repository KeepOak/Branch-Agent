// kenryu42/cc-safety-net@acd15d5d5c6dba1a3e979d0db592afc20c463094:src/gate/analyzer/git/rules.ts (atlas SAFETY-0019)
import type { CommandScanFinding } from "./command-scan-types.js";

export const GIT_REASONS = {
  checkoutDoubleDash:
    "git checkout -- discards uncommitted changes permanently. Use 'git stash' first.",
  checkoutForce: "git checkout --force discards uncommitted changes. Use 'git stash' first.",
  switchDiscard:
    "git switch --discard-changes discards uncommitted changes. Use 'git stash' first.",
  restore:
    "git restore discards uncommitted changes. Use 'git stash' first, or use --staged to only unstage.",
  resetHard:
    "git reset --hard destroys all uncommitted changes permanently. Use 'git stash' first.",
  resetMerge: "git reset --merge can lose uncommitted changes. Use 'git stash' first.",
  clean: "git clean -f removes untracked files permanently. Use 'git clean -n' to preview first.",
  pushForce:
    "git push --force destroys remote history. Use --force-with-lease for safer force push.",
  pushDelete:
    "git push deletes remote refs. Ask the user to run it manually if deletion is intended.",
  pushMirror:
    "git push --mirror can force-update and delete remote refs. Ask the user to run it manually if mirror push is intended.",
  branchDelete: "git branch -D force-deletes without merge check. Use -d for safe delete.",
  tagDelete:
    "git tag -d permanently deletes tags. Ask the user to run it manually if deletion is intended.",
  reflogDelete:
    "git reflog delete removes recovery history. Ask the user to run it manually if deletion is intended.",
  stashDrop: "git stash drop permanently deletes stashed changes. Consider 'git stash list' first.",
  stashClear:
    "git stash clear deletes ALL stashed changes permanently. Use 'git stash list' to review; ask the user to run it manually if intended.",
  worktreeRemoveForce:
    "git worktree remove --force can delete uncommitted changes. Remove --force flag.",
} as const;

type GitRule = { id: string; reason: string };

/** Global git options that take a separate value and come before the subcommand. */
const GIT_GLOBAL_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

function splitGitSubcommand(argv: readonly string[]): {
  subcommand: string | null;
  rest: string[];
} {
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index] ?? "";
    if (GIT_GLOBAL_OPTS_WITH_VALUE.has(token)) {
      index++;
      continue;
    }
    if (!token.startsWith("-")) {
      return { subcommand: token.toLowerCase(), rest: argv.slice(index + 1) };
    }
  }
  return { subcommand: null, rest: [] };
}

function hasShortFlag(rest: readonly string[], flag: string): boolean {
  return rest.some((token) => /^-[A-Za-z]+$/u.test(token) && token.includes(flag));
}

function hasLong(rest: readonly string[], option: string): boolean {
  return rest.some((token) => token === option || token.startsWith(option + "="));
}

function rule(id: string, reason: string): GitRule {
  return { id, reason };
}

function checkoutRule(rest: readonly string[]): GitRule | null {
  if (rest.includes("--")) {
    return rule("git.checkout-double-dash", GIT_REASONS.checkoutDoubleDash);
  }
  if (hasLong(rest, "--force") || hasShortFlag(rest, "f")) {
    return rule("git.checkout-force", GIT_REASONS.checkoutForce);
  }
  return null;
}

function restoreRule(rest: readonly string[]): GitRule | null {
  const stagedOnly = hasLong(rest, "--staged") && !hasLong(rest, "--worktree");
  return stagedOnly ? null : rule("git.restore", GIT_REASONS.restore);
}

function pushRule(rest: readonly string[]): GitRule | null {
  if (hasLong(rest, "--mirror")) {
    return rule("git.push-mirror", GIT_REASONS.pushMirror);
  }
  if (hasLong(rest, "--delete") || hasShortFlag(rest, "d") || rest.some((t) => t.startsWith(":"))) {
    return rule("git.push-delete", GIT_REASONS.pushDelete);
  }
  const forced =
    hasLong(rest, "--force") || hasShortFlag(rest, "f") || rest.some((t) => t.startsWith("+"));
  return forced ? rule("git.push-force", GIT_REASONS.pushForce) : null;
}

function stashRule(rest: readonly string[]): GitRule | null {
  if (rest[0] === "drop") {
    return rule("git.stash-drop", GIT_REASONS.stashDrop);
  }
  if (rest[0] === "clear") {
    return rule("git.stash-clear", GIT_REASONS.stashClear);
  }
  return null;
}

function resetRule(rest: readonly string[]): GitRule | null {
  if (hasLong(rest, "--hard")) {
    return rule("git.reset-hard", GIT_REASONS.resetHard);
  }
  if (hasLong(rest, "--merge")) {
    return rule("git.reset-merge", GIT_REASONS.resetMerge);
  }
  return null;
}

function cleanRule(rest: readonly string[]): GitRule | null {
  const dryRun = hasLong(rest, "--dry-run") || hasShortFlag(rest, "n");
  const forced = hasLong(rest, "--force") || hasShortFlag(rest, "f");
  return forced && !dryRun ? rule("git.clean-force", GIT_REASONS.clean) : null;
}

const SUBCOMMAND_RULES: Record<string, (rest: readonly string[]) => GitRule | null> = {
  checkout: checkoutRule,
  switch: (rest) =>
    hasLong(rest, "--discard-changes")
      ? rule("git.switch-discard-changes", GIT_REASONS.switchDiscard)
      : null,
  restore: restoreRule,
  reset: resetRule,
  clean: cleanRule,
  push: pushRule,
  branch: (rest) =>
    rest.includes("-D") || (hasLong(rest, "--delete") && hasLong(rest, "--force"))
      ? rule("git.branch-force-delete", GIT_REASONS.branchDelete)
      : null,
  tag: (rest) =>
    hasShortFlag(rest, "d") || hasLong(rest, "--delete")
      ? rule("git.tag-delete", GIT_REASONS.tagDelete)
      : null,
  reflog: (rest) =>
    rest[0] === "delete" || rest[0] === "expire"
      ? rule("git.reflog-delete", GIT_REASONS.reflogDelete)
      : null,
  stash: stashRule,
  worktree: (rest) =>
    rest[0] === "remove" && (hasLong(rest, "--force") || hasShortFlag(rest, "f"))
      ? rule("git.worktree-remove-force", GIT_REASONS.worktreeRemoveForce)
      : null,
};

/** Returns a finding for a destructive git invocation, or null. */
export function analyzeGit(argv: readonly string[], command: string): CommandScanFinding | null {
  const { subcommand, rest } = splitGitSubcommand(argv);
  const check = subcommand ? SUBCOMMAND_RULES[subcommand] : undefined;
  const match = check?.(rest) ?? null;
  return match ? { id: match.id, reason: match.reason, intent: "ask", command } : null;
}
