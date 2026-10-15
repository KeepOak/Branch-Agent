import { githubApiToken, gitHubPublicApi } from "../github-public-api.js";
import { parseMergedPullRequest, type MergedPullRequest } from "./merge-watch.js";

/*
 * The merge watcher's GitHub read: the 50 most recently updated closed pull requests, keeping the
 * merged ones. It uses the gateway's own GitHub credential when one is set, otherwise it reads
 * anonymously, which a public repository allows at the watcher's pace.
 */
export async function fetchMergedPullRequests(
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MergedPullRequest[]> {
  let token: string | undefined;
  try {
    token = githubApiToken();
  } catch {
    token = undefined;
  }
  const url = `${gitHubPublicApi.GITHUB_API_BASE_URL}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`;
  const body = await gitHubPublicApi.fetchGitHubJson(url, fetchImpl, token);
  if (!Array.isArray(body)) {
    throw new Error("GitHub returned no pull request list");
  }
  return body.flatMap((item) => parseMergedPullRequest(item) ?? []);
}
