// The Gardener's only GitHub write: opening an issue in the configured repo. Built only when agents.gardener is
// enabled with a repo. Errors carry the HTTP status and nothing from the response body.
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

export function createGardenerIssueWriter(
  options: GardenerIssueWriterOptions,
): (draft: GardenerIssueDraft) => Promise<void> {
  const base = options.apiBase ?? GITHUB_REST_BASE;
  return async (draft) => {
    if (options.token.trim() === "") {
      // Never send an unauthenticated write: with no token, the Gardener files nothing.
      throw new GardenerIssueWriteError(401);
    }
    const [owner = "", name = ""] = draft.repo.split("/");
    const response = await options.fetchImpl(
      `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${options.token}`,
        },
        body: JSON.stringify({ title: draft.title, body: draft.body }),
      },
    );
    if (!response.ok) {
      throw new GardenerIssueWriteError(response.status);
    }
  };
}
