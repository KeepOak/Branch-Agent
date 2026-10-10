// The Gardener's only GitHub write: opening an issue in the configured repo. Built only when agents.gardener is
// enabled with a repo. One issue per source: before creating, the writer searches the repo for the fingerprint
// marker, and an existing issue is kept. Errors carry the HTTP status and nothing from the response body. A failed
// search fails the write, so an unknown state never becomes a second issue.
import type { GardenerIssueDraft } from "./gardener-pass.js";
import { GITHUB_REST_BASE } from "./signal-wakes/signal-wake-github.js";

export class GardenerIssueWriteError extends Error {
  constructor(readonly status: number) {
    super(`GitHub issue write failed with status ${status}`);
    this.name = "GardenerIssueWriteError";
  }
}

export type GardenerIssueWriterOptions = {
  fetchImpl: typeof fetch;
  token: string;
  apiBase?: string;
};

/** Refuses to act without a token: with no token, the Gardener reads and files nothing. */
function assertToken(token: string): void {
  if (token.trim() === "") {
    throw new GardenerIssueWriteError(401);
  }
}

function headersFor(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * The number of an issue in the repo that already carries this fingerprint's marker, or undefined when none does.
 * A match without a number is an error, so the writer never creates a second issue on an unknown state.
 */
export function createGardenerIssueFinder(
  options: GardenerIssueWriterOptions,
): (repo: string, fingerprint: string) => Promise<number | undefined> {
  const base = options.apiBase ?? GITHUB_REST_BASE;
  return async (repo, fingerprint) => {
    assertToken(options.token);
    const query = `repo:${repo} is:issue in:body "[gardener:${fingerprint}]"`;
    const response = await options.fetchImpl(
      `${base}/search/issues?q=${encodeURIComponent(query)}&per_page=1`,
      { headers: headersFor(options.token) },
    );
    if (!response.ok) {
      throw new GardenerIssueWriteError(response.status);
    }
    const body = (await response.json()) as { total_count?: unknown; items?: unknown };
    if (typeof body.total_count !== "number" || body.total_count === 0) {
      return undefined;
    }
    const first = Array.isArray(body.items)
      ? (body.items[0] as { number?: unknown } | undefined)
      : undefined;
    if (typeof first?.number !== "number") {
      throw new Error("GitHub search found the issue without its number");
    }
    return first.number;
  };
}

export function createGardenerIssueWriter(
  options: GardenerIssueWriterOptions,
): (draft: GardenerIssueDraft) => Promise<number> {
  const base = options.apiBase ?? GITHUB_REST_BASE;
  const exists = createGardenerIssueFinder(options);
  return async (draft) => {
    const existing = await exists(draft.repo, draft.fingerprint);
    if (existing !== undefined) {
      return existing;
    }
    const [owner = "", name = ""] = draft.repo.split("/");
    const response = await options.fetchImpl(
      `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`,
      {
        method: "POST",
        headers: headersFor(options.token),
        body: JSON.stringify({ title: draft.title, body: draft.body }),
      },
    );
    if (!response.ok) {
      throw new GardenerIssueWriteError(response.status);
    }
    // The created issue number is the local record the pass keeps. A response without one is a failed write.
    const created = (await response.json()) as { number?: unknown };
    if (typeof created.number !== "number") {
      throw new Error("GitHub created the issue without returning its number");
    }
    return created.number;
  };
}
