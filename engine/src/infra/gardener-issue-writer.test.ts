import { describe, expect, it, vi } from "vitest";
import { createGardenerIssueWriter, GardenerIssueWriteError } from "./gardener-issue-writer.js";

const DRAFT = {
  repo: "example-owner/example-repo",
  fingerprint: "ci-main:engine-tests",
  title: "Fix failing check on main: engine-tests",
  body: "[gardener:ci-main:engine-tests]\n\nDetails.",
};

describe("createGardenerIssueWriter", () => {
  it("posts the draft to the repo's issues endpoint with the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    const write = createGardenerIssueWriter({
      fetchImpl: fetchImpl as typeof fetch,
      token: "t",
      apiBase: "https://api.github.test",
    });
    await write(DRAFT);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.test/repos/example-owner/example-repo/issues");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer t");
    expect(JSON.parse(String(init.body))).toEqual({ title: DRAFT.title, body: DRAFT.body });
  });

  it("throws a status-only error when GitHub refuses the write", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("secret body", { status: 403 }));
    const write = createGardenerIssueWriter({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    await expect(write(DRAFT)).rejects.toBeInstanceOf(GardenerIssueWriteError);
    await expect(write(DRAFT)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to write without a token and sends no request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    const write = createGardenerIssueWriter({ fetchImpl: fetchImpl as typeof fetch, token: "" });
    await expect(write(DRAFT)).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
