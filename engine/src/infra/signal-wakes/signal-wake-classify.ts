const TRUNK_HEAD_PREFIX = "trunk/";
// The verdict line is the first line of the comment:
// `branch-verdict: MERGE|FIX head=<40-hex sha> reviewer=<reviewing Trunk id>`.
// Every Trunk posts under one shared GitHub login, so `reviewer=` is what names the reviewing Trunk.
// Older verdicts without it still parse; they just carry no reviewer.
const VERDICT_LINE =
  /^branch-verdict:\s*(MERGE|FIX)\s+head=([0-9a-f]{40})(?:\s+reviewer=([a-z0-9][a-z0-9_-]{0,63}))?(?:\s.*)?$/;
const HEAD_SHA = /^[0-9a-f]{40}$/;
const REVIEWER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FAILING_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);
/** Only these associations may post verdicts. Every Trunk posts under one shared login, so the association is the gate. */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const CHECK_NAME_MAX_CHARS = 80;

export type BranchVerdict = {
  verdict: "MERGE" | "FIX";
  headSha: string;
  /** Id of the Trunk that reviewed the PR, when the verdict line names one. */
  reviewer?: string;
};
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
  const verdict: BranchVerdict = {
    verdict: match[1] === "FIX" ? "FIX" : "MERGE",
    headSha: match[2] ?? "",
  };
  return match[3] === undefined ? verdict : { ...verdict, reviewer: match[3] };
}

export type BranchVerdictCommentInput = {
  verdict: "MERGE" | "FIX";
  headSha: string;
  /** The reviewing Trunk's own id, e.g. `builder-birch`. */
  reviewer: string;
  /** Review text placed after the verdict line. */
  body: string;
};

/**
 * Builds a verdict comment whose first line names the reviewing Trunk. Throws on a short or
 * non-hex sha, or a reviewer id the parser would not read back.
 */
export function formatBranchVerdictComment(input: BranchVerdictCommentInput): string {
  if (!HEAD_SHA.test(input.headSha)) {
    throw new Error(
      `branch-verdict head must be a full 40-character lowercase sha: ${input.headSha}`,
    );
  }
  if (!REVIEWER_ID.test(input.reviewer)) {
    throw new Error(`branch-verdict reviewer must be a Trunk id: ${input.reviewer}`);
  }
  const line = `branch-verdict: ${input.verdict} head=${input.headSha} reviewer=${input.reviewer}`;
  const body = input.body.trim();
  return body ? `${line}\n\n${body}\n` : `${line}\n`;
}

export type VerdictCandidate = { id: number; body: string; authorAssociation?: string };

/** The newest trusted comment (highest id) whose first line is a verdict. Other associations are ignored entirely. */
export function latestBranchVerdict(
  comments: readonly VerdictCandidate[],
): LatestVerdict | undefined {
  let latest: LatestVerdict | undefined;
  for (const comment of comments) {
    if (!isTrustedAssociation(comment.authorAssociation)) {
      continue;
    }
    const verdict = parseBranchVerdict(comment.body);
    if (verdict && (latest === undefined || comment.id > latest.id)) {
      latest = { ...verdict, id: comment.id };
    }
  }
  return latest;
}

export function isTrustedAssociation(association: string | undefined): boolean {
  return association !== undefined && TRUSTED_ASSOCIATIONS.has(association);
}

/**
 * Check names come from the PR's own workflows, so they are untrusted. Strips control
 * characters, neutralises quotes, and caps the length before the name reaches a Trunk.
 */
/** Control characters, including tab and newline, become spaces. */
function isControlChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

export function sanitizeCheckName(name: string): string {
  const printable = Array.from(name, (char) => (isControlChar(char) ? " " : char)).join("");
  const clean = printable.replace(/["`]/g, "'").replace(/\s+/g, " ").trim();
  return clean.length > CHECK_NAME_MAX_CHARS
    ? `${clean.slice(0, CHECK_NAME_MAX_CHARS - 1)}…`
    : clean;
}

export type CheckRunSummary = { name: string; status: string; conclusion: string | null };

/** Names of completed check runs that failed on the head commit. */
export function failingCheckNames(runs: readonly CheckRunSummary[]): string[] {
  return runs
    .filter((run) => run.status === "completed" && FAILING_CONCLUSIONS.has(run.conclusion ?? ""))
    .map((run) => sanitizeCheckName(run.name));
}
