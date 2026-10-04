/**
 * Reviewer precedence and merge states adapted from Kilo-Org/kilocode,
 * packages/kilo-vscode/src/agent-manager/pr/am-pr-utils.ts
 * at 6fd9b7b29ce63b5a38176e45b738e94ed6167cfb.
 */
type ReviewerState = "pending" | "approved" | "changes_requested" | "commented";
type Reviewer = { login: string; state: ReviewerState };
type ReviewRequest = { requestedReviewer?: { login?: string }; login?: string };
type Review = { author?: { login?: string }; state?: string };
type Metadata = { label: string; value: string };
type JsonPage = { value: unknown; hasNextPage: boolean };

const REVIEWER_STATE: Record<string, ReviewerState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
};

export function parseReviewers(requests: ReviewRequest[], reviews: Review[]): Reviewer[] {
  const map = new Map<string, Reviewer>();
  for (const node of requests) {
    const user = node.requestedReviewer ?? node;
    if (!user?.login) continue;
    map.set(user.login, { login: user.login, state: "pending" });
  }
  for (const node of reviews) {
    const login = node.author?.login;
    const state = Object.hasOwn(REVIEWER_STATE, node.state ?? "")
      ? REVIEWER_STATE[node.state ?? ""]
      : undefined;
    if (!login || !state) continue;
    if (!map.has(login) || state !== "commented") {
      map.set(login, { login, state });
    }
  }
  return [...map.values()];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function login(value: unknown): { login?: string } {
  return record(value) && typeof value.login === "string" ? { login: value.login } : {};
}

const REVIEW_LABEL: Record<ReviewerState, string> = {
  pending: "Requested",
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
};

/** GitHub REST reviews arrive oldest first; read every page before applying verdict precedence. */
export async function fetchPullReviewMetadata(
  itemUrl: string,
  requestedReviewers: unknown,
  fetchPage: (url: string) => Promise<JsonPage>,
): Promise<Metadata[]> {
  const requests = Array.isArray(requestedReviewers)
    ? requestedReviewers.map((user) => ({ requestedReviewer: login(user) }))
    : [];
  const reviews: Review[] = [];
  let page = 1;
  let hasNextPage: boolean;
  do {
    const response = await fetchPage(`${itemUrl}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(response.value) || response.value.some((entry) => !record(entry))) {
      throw new Error("GitHub reviews were not an array of objects");
    }
    for (const entry of response.value as Record<string, unknown>[]) {
      reviews.push({
        author: login(entry.user),
        state: typeof entry.state === "string" ? entry.state : undefined,
      });
    }
    hasNextPage = response.hasNextPage;
    page += 1;
  } while (hasNextPage);
  return parseReviewers(requests, reviews).map(({ login, state }) => ({
    label: "Review",
    value: `@${login} · ${REVIEW_LABEL[state]}`,
  }));
}

/** Mergeability is a GitHub observation, independent of CI and reviewer verdicts. */
export function pullMergeMetadata(value: Record<string, unknown>): Metadata[] {
  const mergeable =
    value.mergeable === true ? "Mergeable" : value.mergeable === false ? "Conflicting" : "Unknown";
  const states: Record<string, string> = {
    CLEAN: "Clean",
    BEHIND: "Behind",
    BLOCKED: "Blocked",
    DIRTY: "Conflicting",
    UNSTABLE: "Unstable",
    DRAFT: "Draft",
    HAS_HOOKS: "Has hooks",
    UNKNOWN: "Unknown",
  };
  const state =
    typeof value.mergeable_state === "string"
      ? states[value.mergeable_state.toUpperCase()]
      : undefined;
  return [
    { label: "Mergeability", value: mergeable },
    ...(state ? [{ label: "Merge status", value: state }] : []),
  ];
}
