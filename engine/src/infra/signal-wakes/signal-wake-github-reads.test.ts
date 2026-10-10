import { describe, expect, it, vi } from "vitest";
import { createSignalWakeGitHub } from "./signal-wake-github.js";

const REPO = { owner: "example-owner", name: "example-repo" };
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("createSignalWakeGitHub: Gardener reads", () => {
  it("getBranchSha reads the branch ref and reuses its ETag on a 304", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ object: { sha: SHA } }), {
          status: 200,
          headers: { etag: '"main-1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"main-1"' } }));
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    expect(await github.getBranchSha(REPO, "main")).toBe(SHA);
    expect(await github.getBranchSha(REPO, "main")).toBe(SHA);
    const [firstUrl] = fetchImpl.mock.calls[0] as [string];
    expect(firstUrl).toBe(
      "https://api.github.com/repos/example-owner/example-repo/git/ref/heads/main",
    );
    const secondHeaders = new Headers(
      (fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers,
    );
    expect(secondHeaders.get("If-None-Match")).toBe('"main-1"');
  });

  it("getBranchSha is undefined when the body has no sha", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    expect(await github.getBranchSha(REPO, "main")).toBeUndefined();
  });

  it("getCommitTime returns the committer date in epoch ms", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ commit: { committer: { date: "2026-10-10T10:00:00Z" } } }), {
        status: 200,
      }),
    );
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    expect(await github.getCommitTime(REPO, SHA)).toBe(Date.parse("2026-10-10T10:00:00Z"));
  });

  it("listComments carries created_at as createdAt, and omits it when GitHub sends none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 1, user: { login: "rev" }, body: "FIX", created_at: "2026-10-10T10:00:00Z" },
          { id: 2, user: { login: "rev" }, body: "PASS" },
        ]),
        { status: 200 },
      ),
    );
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    const comments = await github.listComments(REPO, 4);
    expect(comments[0]?.createdAt).toBe("2026-10-10T10:00:00Z");
    expect(comments[1]).not.toHaveProperty("createdAt");
  });
});
