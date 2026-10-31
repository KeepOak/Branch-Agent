import { describe, expect, it, vi } from "vitest";

let inFlight = 0;
let maxInFlight = 0;
vi.mock("../config/sessions/session-entry-read-runtime.js", () => ({
  withSessionStoreReaderInWorker: async (params: { storePath: string; agentId?: string }) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return { path: params.storePath, count: 1, recent: [] };
  },
}));
vi.mock("../config/sessions/transcript-target-binding.js", () => ({
  captureSessionTranscriptStorageEnvironment: () => ({}),
}));

const { readStatusSessionStores, STATUS_SESSION_STORE_READ_CONCURRENCY } = await import(
  "./session-stores.js"
);

describe("readStatusSessionStores", () => {
  it("reads agent stores concurrently with a bound and keeps agent order", async () => {
    const agents = Array.from({ length: 16 }, (_, i) => ({ id: `agent-${i}` }));
    const started = Date.now();
    const result = await readStatusSessionStores({} as never, agents, 10);
    const elapsed = Date.now() - started;
    expect(result.byAgent.map((entry) => entry.agent.id)).toEqual(agents.map((a) => a.id));
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(STATUS_SESSION_STORE_READ_CONCURRENCY);
    // Serial reads would take >= 16 * 20 ms.
    expect(elapsed).toBeLessThan(16 * 20);
  });
});
