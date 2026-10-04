import { beforeAll, describe, expect, it, vi } from "vitest";
import "../../test-support/browser-security.mock.js";
import {
  installAgentContractHooks,
  startServerAndBase,
} from "../server.agent-contract.test-harness.js";
import {
  getPwMocks,
  setBrowserControlServerProfiles,
  setBrowserControlServerSsrFPolicy,
  setBrowserControlServerTabUrl,
} from "../server.control-server.test-harness.js";
import { getBrowserTestFetch } from "../test-support/fetch.js";

const search = vi.fn(async (_options: unknown) => ({ matches: [], total: 0, hasMore: false }));
const find = vi.fn(async (_options: unknown) => ({ elements: [], total: 0, showing: 0 }));
beforeAll(async () => {
  Object.assign(getPwMocks(), { searchPageViaPlaywright: search, findElementsViaPlaywright: find });
  await import("../../server.js");
});

async function post(base: string, path: string, body: object) {
  return getBrowserTestFetch()(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("native browser search/find routes", () => {
  installAgentContractHooks();
  it("returns resolved target/count metadata and forwards source defaults", async () => {
    const base = await startServerAndBase();
    const response = await post(base, "/search", {
      targetId: "abcd1234",
      pattern: 'price "quoted"',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      targetId: "abcd1234",
      url: "https://example.com",
      total: 0,
      matches: [],
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "abcd1234",
        pattern: 'price "quoted"',
        regex: false,
        caseSensitive: false,
        maxResults: 25,
        contextChars: 150,
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("forwards CSS query attributes, requested count, and omitted-text option", async () => {
    const base = await startServerAndBase();
    const response = await post(base, "/find", {
      selector: "article > a",
      attributes: ["href"],
      maxResults: 100_000,
      includeText: false,
    });
    expect(response.status).toBe(200);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: "article > a",
        attributes: ["href"],
        maxResults: 100_000,
        includeText: false,
      }),
    );
  });
  it("rejects malformed parameters before extraction", async () => {
    const base = await startServerAndBase();
    expect((await post(base, "/search", { pattern: "x", regex: "true" })).status).toBe(400);
    expect((await post(base, "/find", { selector: "a", attributes: [1] })).status).toBe(400);
    expect(search).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
  it("enforces the current page policy before search or find", async () => {
    setBrowserControlServerSsrFPolicy({ allowPrivateNetwork: false });
    setBrowserControlServerTabUrl("http://127.0.0.1:8080/admin");
    const base = await startServerAndBase();
    for (const [route, body] of [
      ["/search", { pattern: "secret" }],
      ["/find", { selector: "a" }],
    ] as const) {
      const response = await post(base, route, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason: "navigation_blocked" });
    }
    expect(search).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
  it("does not offer native DOM inspection on existing-session profiles", async () => {
    setBrowserControlServerProfiles(
      { user: { driver: "existing-session", color: "#FF4500" } },
      "user",
    );
    const base = await startServerAndBase();
    for (const [route, body] of [
      ["/search", { pattern: "x" }],
      ["/find", { selector: "a" }],
    ] as const) {
      const response = await post(base, route, body);
      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("snapshot") });
    }
    expect(search).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});
