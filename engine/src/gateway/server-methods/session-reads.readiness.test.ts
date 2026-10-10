// Thread switching (chat.history) and search (sessions.search) read the shared session store.
// Neither may wait on another agent's readiness: a ready agent answers at once while a
// different agent is still starting, and a starting agent is refused at once.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentDatabaseInspectionRefusal,
  recordAgentDatabaseAdmissions,
} from "../../state/agent-database-admission.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { chatHistoryHandlers } from "./chat-history-handler.js";
import { createHistoryReadContext } from "./chat-history.test-helpers.js";
import { sessionReadHandlers } from "./sessions-read.js";
import type { RespondFn } from "./types.js";

const STARTING_LIMIT_MS = 50;
const SAMPLES = 9;

afterEach(() => {
  recordAgentDatabaseAdmissions([], { source: "startup" });
});

function mobileStillStarting(): void {
  recordAgentDatabaseAdmissions(
    [
      createAgentDatabaseInspectionRefusal({
        agentId: "mobile",
        paths: ["/synthetic/mobile/agent.sqlite"],
        pending: true,
        reason: "Agent mobile has not completed startup inspection and preparation.",
      }),
    ],
    { source: "startup" },
  );
}

/** Fails the test instead of hanging it if a read waits on the engine. */
function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} waited on the engine`)), 2_000);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function timed(run: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await withDeadline(run(), "read");
  return performance.now() - started;
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe("thread switch and search do not wait on agent readiness", () => {
  it("answers chat.history for a ready agent while another agent is still starting", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const context = await createHistoryReadContext();
      mobileStillStarting();
      const elapsed: number[] = [];
      for (let run = 0; run < SAMPLES; run += 1) {
        const respond = vi.fn<RespondFn>();
        elapsed.push(
          await timed(() =>
            Promise.resolve(
              chatHistoryHandlers["chat.history"]!({
                params: { sessionKey: "agent:main:main" },
                client: null,
                context,
                respond,
                req: { type: "req", id: `ready-${run}`, method: "chat.history" },
                isWebchatConnect: () => false,
              }),
            ),
          ),
        );
        expect(respond.mock.calls[0]?.[0]).toBe(true);
      }
      expect(median(elapsed)).toBeLessThan(STARTING_LIMIT_MS);
    });
  });

  it("answers sessions.search for a ready agent while another agent is still starting", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const context = await createHistoryReadContext();
      mobileStillStarting();
      const elapsed: number[] = [];
      for (let run = 0; run < SAMPLES; run += 1) {
        const respond = vi.fn<RespondFn>();
        elapsed.push(
          await timed(() =>
            Promise.resolve(
              sessionReadHandlers["sessions.search"]!({
                params: { query: "hello", agentId: "main", sessionKeys: ["agent:main:main"] },
                client: null,
                context,
                respond,
                req: { type: "req", id: `search-${run}`, method: "sessions.search" },
                isWebchatConnect: () => false,
              } as never),
            ),
          ),
        );
        expect(respond.mock.calls[0]?.[0]).toBe(true);
      }
      expect(median(elapsed)).toBeLessThan(STARTING_LIMIT_MS);
    });
  });

  it("refuses a starting agent's history at once instead of waiting", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const context = await createHistoryReadContext();
      mobileStillStarting();
      const respond = vi.fn<RespondFn>();
      await withDeadline(
        Promise.resolve(
          chatHistoryHandlers["chat.history"]!({
            params: { sessionKey: "agent:mobile:main" },
            client: null,
            context,
            respond,
            req: { type: "req", id: "mobile-history", method: "chat.history" },
            isWebchatConnect: () => false,
          }),
        ),
        "mobile history",
      );
      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: "UNAVAILABLE" }),
      );
    });
  });

  // The minimal state has no mobile store, so this answers without reaching its admission gate.
  // It proves only that a starting agent's search answers at once instead of waiting.
  it("answers a starting agent's search at once instead of waiting", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const context = await createHistoryReadContext();
      mobileStillStarting();
      const respond = vi.fn<RespondFn>();
      await withDeadline(
        Promise.resolve(
          sessionReadHandlers["sessions.search"]!({
            params: { query: "hello", agentId: "mobile", sessionKeys: ["agent:mobile:main"] },
            client: null,
            context,
            respond,
            req: { type: "req", id: "mobile-search", method: "sessions.search" },
            isWebchatConnect: () => false,
          } as never),
        ),
        "mobile search",
      );
      expect(respond).toHaveBeenCalledOnce();
    });
  });
});
