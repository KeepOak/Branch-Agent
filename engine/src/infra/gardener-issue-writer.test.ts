import { describe, expect, it, vi } from "vitest";
import {
  createGardenerIssueFinder,
  createGardenerIssueWriter,
  GardenerIssueWriteError,
} from "./gardener-issue-writer.js";

const DRAFT = {
  repo: "example-owner/example-repo",
  fingerprint: "ci-main:engine-tests",
  title: "Fix failing check on main: engine-tests",
  body: "[gardener:ci-main:engine-tests]\n\nDetails.",
};

/** A fake GitHub: the issue search reports `existing` matches, and issue creation answers 201. */
function fakeIssueApi(existing: number) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/search/issues")) {
      return Response.json({ total_count: existing, items: [] });
    }
    return Response.json({ number: 7 }, { status: 201 });
  });
}

const postCalls = (fetchImpl: ReturnType<typeof fakeIssueApi>) =>
  fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("createGardenerIssueWriter", () => {
  it("searches for the marker, then posts the draft to the repo's issues endpoint with the token", async () => {
    const fetchImpl = fakeIssueApi(0);
    const write = createGardenerIssueWriter({
      fetchImpl: fetchImpl as typeof fetch,
      token: "t",
      apiBase: "https://api.github.test",
    });
    await write(DRAFT);
    const [searchUrl] = fetchImpl.mock.calls[0] as [string];
    expect(searchUrl).toContain("/search/issues?q=");
    expect(decodeURIComponent(searchUrl)).toContain('"[gardener:ci-main:engine-tests]"');
    const [url, init] = postCalls(fetchImpl)[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.test/repos/example-owner/example-repo/issues");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer t");
    expect(JSON.parse(String(init.body))).toEqual({ title: DRAFT.title, body: DRAFT.body });
  });

  it("keeps an existing issue for the fingerprint and posts nothing", async () => {
    const fetchImpl = fakeIssueApi(1);
    const write = createGardenerIssueWriter({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    await write(DRAFT);
    expect(postCalls(fetchImpl)).toHaveLength(0);
  });

  it("throws a status-only error when GitHub refuses the write", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("secret body", { status: 403 }));
    const write = createGardenerIssueWriter({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    await expect(write(DRAFT)).rejects.toBeInstanceOf(GardenerIssueWriteError);
    await expect(write(DRAFT)).rejects.toMatchObject({ status: 403 });
  });

  it("posts nothing when the search fails, so an unknown state never becomes a second issue", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    const write = createGardenerIssueWriter({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    await expect(write(DRAFT)).rejects.toMatchObject({ status: 503 });
    expect(postCalls(fetchImpl as unknown as ReturnType<typeof fakeIssueApi>)).toHaveLength(0);
  });

  it("returns the created issue number", async () => {
    const write = createGardenerIssueWriter({
      fetchImpl: fakeIssueApi(0) as typeof fetch,
      token: "t",
    });
    expect(await write(DRAFT)).toBe(7);
  });

  it("a created issue without a number is a failed write", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/search/issues")
        ? Response.json({ total_count: 0, items: [] })
        : Response.json({}, { status: 201 }),
    );
    const write = createGardenerIssueWriter({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    await expect(write(DRAFT)).rejects.toThrow(/without returning its number/);
  });

  it("refuses to write without a token and sends no request", async () => {
    const fetchImpl = fakeIssueApi(0);
    const write = createGardenerIssueWriter({ fetchImpl: fetchImpl as typeof fetch, token: "" });
    await expect(write(DRAFT)).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createGardenerIssueFinder", () => {
  it("reports whether an issue with the fingerprint marker exists", async () => {
    const found = createGardenerIssueFinder({
      fetchImpl: fakeIssueApi(2) as typeof fetch,
      token: "t",
    });
    expect(await found("example-owner/example-repo", "ci-main:engine-tests")).toBe(true);
    const none = createGardenerIssueFinder({
      fetchImpl: fakeIssueApi(0) as typeof fetch,
      token: "t",
    });
    expect(await none("example-owner/example-repo", "ci-main:engine-tests")).toBe(false);
  });
});
