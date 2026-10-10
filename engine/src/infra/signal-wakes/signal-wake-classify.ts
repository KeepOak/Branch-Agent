const TRUNK_HEAD_PREFIX = "trunk/";
const FIX_VERDICT = /^\s*FIX\b/;
const FAILING_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);
const EXCERPT_MAX_CHARS = 160;

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

/** A verdict comment opens with the bare word FIX; FIXED, Fix or a leading word do not count. */
export function isFixVerdict(body: string): boolean {
  return FIX_VERDICT.test(body);
}

export type CheckRunSummary = { name: string; status: string; conclusion: string | null };

/** Names of completed check runs that failed on the head commit. */
export function failingCheckNames(runs: readonly CheckRunSummary[]): string[] {
  return runs
    .filter((run) => run.status === "completed" && FAILING_CONCLUSIONS.has(run.conclusion ?? ""))
    .map((run) => run.name);
}

/** First line of a comment, trimmed and capped, so the wake text stays short. */
export function commentExcerpt(body: string): string {
  const firstLine = body.trim().split("\n")[0] ?? "";
  return firstLine.length > EXCERPT_MAX_CHARS
    ? `${firstLine.slice(0, EXCERPT_MAX_CHARS - 1)}…`
    : firstLine;
}
