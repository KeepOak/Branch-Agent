import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { createJob, JOBS } from "../customize/jobs-data";
import { createTrunk } from "./api";

const engine = (request: ReturnType<typeof vi.fn>): WindowEngine => ({
  request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"], sessionKey: null,
});
afterEach(() => vi.useRealTimers());

describe("new Trunk runtime availability", () => {
  it("does not hand off the returned ID until the gateway's runtime roster contains it", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce({ ok: true, agentId: "new-trunk" })
      .mockResolvedValueOnce({ agents: [{ id: "dev" }] }).mockResolvedValue({ agents: [{ id: "dev" }, { id: "new-trunk" }] });
    let handedOff = false;
    const creation = createTrunk(engine(request), "New Trunk").then((id) => { handedOff = true; return id; });
    await vi.advanceTimersByTimeAsync(0);
    expect(handedOff).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(await creation).toBe("new-trunk");
    expect(request.mock.calls.map(([method]) => method)).toEqual(["agents.create", "agents.list", "agents.list"]);
  });

  it("reports a persisted-but-unavailable Trunk without creating it a second time", async () => {
    vi.useFakeTimers();
    const request = vi.fn((method: string) => Promise.resolve(method === "agents.create"
      ? { ok: true, agentId: "new-trunk" } : { agents: [{ id: "dev" }] }));
    const creation = expect(createTrunk(engine(request), "New Trunk")).rejects.toThrow("was created (new-trunk), but the gateway");
    await vi.advanceTimersByTimeAsync(15_000);
    await creation;
    expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(1);
  });

  it("stops when the creating screen retires and does not navigate or write instructions", async () => {
    vi.useFakeTimers();
    let current = true;
    const request = vi.fn((method: string) => Promise.resolve(method === "agents.create"
      ? { ok: true, agentId: "researcher" } : { agents: [] }));
    const creation = expect(createJob(engine(request), JOBS[2], () => current)).rejects.toThrow("you left this screen");
    await vi.advanceTimersByTimeAsync(0); current = false;
    await vi.advanceTimersByTimeAsync(250); await creation;
    expect(request.mock.calls.some(([method]) => method.startsWith("agents.files."))).toBe(false);
  });

  it("never polls or navigates when creation is refused or returns no identifier", async () => {
    for (const response of [{ ok: false, error: { message: "Permission denied" } }, { ok: true }]) {
      const request = vi.fn().mockResolvedValue(response);
      await expect(createTrunk(engine(request), "New Trunk")).rejects.toThrow();
      expect(request.mock.calls.map(([method]) => method)).toEqual(["agents.create"]);
    }
  });

  it.each(JOBS)("waits for $name before editing the source-generated SOUL.md", async (job) => {
    vi.useFakeTimers();
    const id = job.name.toLowerCase().replaceAll(" ", "-");
    let rosterReads = 0;
    const request = vi.fn((method: string) => {
      if (method === "agents.create") return Promise.resolve({ ok: true, agentId: id });
      if (method === "agents.list") return Promise.resolve({ agents: ++rosterReads > 1 ? [{ id }] : [{ id: "dev" }] });
      if (method === "agents.files.get") return Promise.resolve({ file: { content: "# Existing rules", hash: "source-hash" } });
      return Promise.resolve({ ok: true });
    });
    const creation = createJob(engine(request), job);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.some(([method]) => method.startsWith("agents.files."))).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(await creation).toBe(id);
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: id, name: "SOUL.md", content: `# Existing rules\n\n## Your job\n\n${job.description}.\n`, expectedHash: "source-hash" });
  });
});
