const TRUNK_HEAD_PREFIX = "trunk/";
// The verdict line is the first line of the comment: `branch-verdict: MERGE|FIX head=<40-hex sha>`.
const VERDICT_LINE = /^branch-verdict:\s*(MERGE|FIX)\s+head=([0-9a-f]{40})(?:\s.*)?$/;
const FAILING_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

export type BranchVerdict = { verdict: "MERGE" | "FIX"; headSha: string };
export type LatestVerdict = BranchVerdict & { id: number };

/** Maps a PR head branch `trunk/<trunkId>-...` to the longest matching configured Trunk id. */
export function trunkForHeadRef(headRef: string, trunkIds: readonly string[]): string | undefined {
  if (!headRef.startsWith(TRUNK_HEAD_PREFIX)) {
    return undefined;
  }
  const rest = headRef.slice(TRUNK_HEAD_PREFIX.length);
  let best: string | undefined;
  for (const trunkId of trunkIds) {
    const matches = rest.startsWith(`${trunkId}-`);
    if (matches && (best === undefined || trunkId.length > best.length)) {
      best = trunkId;
    }
  }
  return best;
}

/** Reads the verdict from a comment's first line. Anything else is not a verdict. */
export function parseBranchVerdict(body: string): BranchVerdict | undefined {
  const firstLine = (body.trim().split("\n")[0] ?? "").trim();
  const match = VERDICT_LINE.exec(firstLine);
  if (!match) {
    return undefined;
  }
  return { verdict: match[1] === "FIX" ? "FIX" : "MERGE", headSha: match[2] ?? "" };
}

/** The newest comment (highest id) whose first line is a verdict. */
export function latestBranchVerdict(
  comments: readonly { id: number; body: string }[],
): LatestVerdict | undefined {
  let latest: LatestVerdict | undefined;
  for (const comment of comments) {
    const verdict = parseBranchVerdict(comment.body);
    if (verdict && (latest === undefined || comment.id > latest.id)) {
      latest = { ...verdict, id: comment.id };
    }
  }
  return latest;
}

export type CheckRunSummary = { name: string; status: string; conclusion: string | null };

/** Names of completed check runs that failed on the head commit. */
export function failingCheckNames(runs: readonly CheckRunSummary[]): string[] {
  return runs
    .filter((run) => run.status === "completed" && FAILING_CONCLUSIONS.has(run.conclusion ?? ""))
    .map((run) => run.name);
}
