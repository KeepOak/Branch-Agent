import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGitHubDetail } from "./detail.ts";

const sha = "a".repeat(40);
let sequence = 0;
function fixture(options: { failSecondPage?: boolean; kind?: "pull" | "issue" } = {}) {
  const kind = options.kind ?? "pull";
  const target = { kind, owner: "octocat", repo: `reviews-${++sequence}`, number: 7 };
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url.href);
    let value: unknown;
    if (url.pathname.endsWith("/check-runs")) value = { total_count: 0, check_runs: [] };
    else if (url.pathname.endsWith("/status"))
      value = { sha, total_count: 0, statuses: [], state: "pending" };
    else if (url.pathname.endsWith("/reviews")) {
      const page = url.searchParams.get("page");
      if (page === "2" && options.failSecondPage)
        return new Response("fixture unavailable", { status: 503 });
      value = [
        { user: { login: "alice" }, state: page === "1" ? "APPROVED" : "CHANGES_REQUESTED" },
      ];
      return new Response(JSON.stringify(value), {
        headers: page === "1" ? { link: '<https://api.github.com/ignored>; rel="next"' } : {},
      });
    } else if (url.pathname === `/repos/octocat/${target.repo}`)
      value = { private: false, visibility: "public" };
    else if (
      url.pathname === `/repos/octocat/${target.repo}/${kind === "pull" ? "pulls" : "issues"}/7`
    )
      value = {
        title: "Actual document fixture",
        body: "Body",
        user: { login: "author" },
        state: "open",
        created_at: "2026-10-03T00:00:00Z",
        updated_at: "2026-10-03T00:00:00Z",
        comments: 0,
        review_comments: 0,
        changed_files: 0,
        head: { sha, ref: "feature" },
        base: { ref: "main" },
        requested_reviewers: [{ login: "carol" }],
        mergeable: true,
        mergeable_state: "clean",
      };
    else throw new Error(`Unexpected fixture request ${url.href}`);
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  };
  return { target, requests, fetchImpl };
}
test("production detail reader includes paginated reviewer verdicts and merge status", async () => {
  const { target, requests, fetchImpl } = fixture();
  const result = await loadGitHubDetail(target, undefined, fetchImpl);
  assert.equal(result.partial, false);
  assert.ok(result.metadata?.some((item) => item.value === "@alice · Changes requested"));
  assert.ok(result.metadata?.some((item) => item.value === "@carol · Requested"));
  assert.ok(
    result.metadata?.some((item) => item.label === "Mergeability" && item.value === "Mergeable"),
  );
  assert.equal(requests.filter((url) => new URL(url).pathname.endsWith("/reviews")).length, 2);
  assert.equal(
    requests.some((url) => url.includes("/ignored")),
    false,
  );
});
test("production detail reader marks failed later page partial without stale approval", async () => {
  const { target, fetchImpl } = fixture({ failSecondPage: true });
  const result = await loadGitHubDetail(target, undefined, fetchImpl);
  assert.equal(result.partial, true);
  assert.ok(
    result.metadata?.some((item) => item.label === "Reviews" && item.value === "Unavailable"),
  );
  assert.equal(
    result.metadata?.some((item) => item.value.includes("@alice")),
    false,
  );
  assert.equal(result.body, "Body");
});
test("issue reader performs no PR review request or merge-status rendering", async () => {
  const { target, requests, fetchImpl } = fixture({ kind: "issue" });
  const result = await loadGitHubDetail(target, undefined, fetchImpl);
  assert.equal(result.partial, false);
  assert.equal(
    result.metadata?.some((item) => item.label === "Mergeability"),
    false,
  );
  assert.equal(
    requests.some((url) => new URL(url).pathname.endsWith("/reviews")),
    false,
  );
});
