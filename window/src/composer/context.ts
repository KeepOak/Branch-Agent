// "@" adds context (the preview's "Add as context"): the words that go with the message as a pasted-text chip,
// read from the engine (sessions.diff for @diff and @git) or from a folder the person picks (@folder).
import { list, num, rec, str } from "./engine";

const UNAVAILABLE: Record<string, string> = {
  not_git: "This conversation's folder isn't a git checkout, so there are no changes or commits to add.",
  unknown_session: "This conversation has no folder yet, so there are no changes or commits to add.",
  workspace_stopped: "This conversation's computer is stopped. Start it, then add changes or commits.",
  unknown_commit: "That commit isn't in this conversation's checkout.",
};

/** The pasted text for @diff (scope "uncommitted") or @git (scope "all"), or a problem line when there is none. */
export function diffContext(kind: "diff" | "git", result: unknown): { text: string } | { problem: string } {
  const r = rec(result);
  const why = str(r.unavailableReason);
  if (why) return { problem: UNAVAILABLE[why] ?? `There's nothing to add (${why}).` };
  if (kind === "diff") {
    const files = list(r.files);
    if (!files.length) return { problem: "Nothing is changed and unsaved in this conversation's folder." };
    const head = `Changes not yet saved: ${files.length} ${files.length === 1 ? "file" : "files"}, +${num(r.additions) ?? 0} −${num(r.deletions) ?? 0}`;
    const body = files.map((f) => str(f.patch) || `${str(f.path)} (${f.binary === true ? "binary" : "too big to show"})`);
    return { text: [head, ...body].join("\n\n") };
  }
  const commits = list(r.commits);
  if (!commits.length) return { problem: `No commits on ${str(r.branch) || "this branch"} since ${str(r.baseRef) || "its base"}.` };
  const head = `Recent commits on ${str(r.branch) || "this branch"}, newest first:`;
  return { text: [head, ...commits.map((c) => `${str(c.sha).slice(0, 7)} ${str(c.subject)}`)].join("\n") };
}

/** @folder: what's in the picked folder, one path a line. */
export function folderContext(paths: readonly string[]): string | null {
  if (!paths.length) return null;
  const name = paths[0].split("/")[0] || "Folder";
  return [`What's in ${name} (${paths.length} ${paths.length === 1 ? "file" : "files"}):`, ...[...paths].sort()].join("\n");
}
