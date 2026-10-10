// Read state must not depend on agent readiness. One agent still starting up must not fail
// the ready agents' read markers, and "mark all read" must reach every thread at once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roster = vi.hoisted(() => ({
  agents: [
    { id: "main", name: "Main", kind: "branch" },
    { id: "mobile", name: "Mobile", kind: "branch" },
  ],
}));

vi.mock("../agent-list.js", () => ({
  listExistingAgentIdsFromDisk: async () => roster.agents.map((agent) => agent.id),
  listGatewayAgentsBasic: async () => ({ defaultId: "main", agents: roster.agents }),
}));

vi.mock("../../config/sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/sessions.js")>()),
  resolveExistingAgentSessionStoreTargetsSync: (_cfg: unknown, agentId: string) => [
    { agentId, storePath: `/fake/${agentId}/sessions.json` },
  ],
}));

vi.mock("../../config/sessions/session-accessor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/sessions/session-accessor.js")>();
  const { assertAgentDatabaseAdmitted } = await import("../../state/agent-database-admission.js");
  return {
    ...actual,
    // Mirrors the real gate: a pending agent refuses synchronously, a ready agent lists its threads.
    listSessionEntriesReadOnly: (params: { agentId: string }) => {
      assertAgentDatabaseAdmitted(params.agentId);
      return [
        {
          sessionKey: `agent:${params.agentId}:main`,
          entry: { sessionId: `${params.agentId}-main`, updatedAt: 1_000, lastActivityAt: 1_000 },
        },
      ];
    },
  };
});

const { contactHandlers } = await import("./contacts.js");
const admission = await import("../../state/agent-database-admission.js");

let stateDir = "";
const previousState = process.env.BRANCH_STATE_DIR;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-read-state-"));
  process.env.BRANCH_STATE_DIR = stateDir;
});
afterEach(() => {
  admission.recordAgentDatabaseAdmissions([], { source: "startup" });
  if (previousState === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = previousState;
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
});

const owner = {
  connect: { scopes: ["operator.admin", "operator.read", "operator.write"], device: { id: "owner-dev" } },
};

type Reply = { ok: boolean; payload?: any; error?: { message?: string } };

/** A context whose runtime methods never settle: any call that waits on the engine hangs the test. */
function busyContext(broadcast: (...args: unknown[]) => void = () => undefined) {
  const hung = () => new Promise<never>(() => {});
  const base = {
    broadcast,
    getRuntimeConfig: () => ({}),
    getSessionEventSubscriberConnIds: () => [],
    mentionInbox: { invalidateAsync: () => undefined },
    logGateway: { warn: () => undefined, info: () => undefined, debug: () => undefined },
  };
  return new Proxy(base as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : hung),
  });
}

async function call(method: string, params: Record<string, unknown>, context: unknown = busyContext()): Promise<Reply> {
  let reply: Reply | undefined;
  await contactHandlers[method]!({
    params,
    client: owner,
    context,
    respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      reply = { ok, payload, error };
    },
  } as never);
  return reply!;
}

/** The engine state after Mobile's startup inspection has not finished. */
function mobileStillStarting(): void {
  admission.recordAgentDatabaseAdmissions(
    [
      admission.createAgentDatabaseInspectionRefusal({
        agentId: "mobile",
        paths: [path.join(stateDir, "agents", "mobile", "agent.sqlite")],
        pending: true,
        reason: "Agent mobile has not completed startup inspection and preparation.",
      }),
    ],
    { source: "startup" },
  );
}

describe("read state does not wait on agent readiness", () => {
  it("marks a ready contact read while another agent is still starting", async () => {
    const ready = await call("contacts.list", {});
    const mainContact = ready.payload.contacts.find((contact: { id: string }) => contact.id.includes("main"));
    expect(mainContact).toBeDefined();

    mobileStillStarting();

    const reply = await call("contacts.markRead", { contactId: mainContact.id });
    expect(reply.error?.message).toBeUndefined();
    expect(reply.ok).toBe(true);
  });

  it("marks all read through one request, without touching any agent", async () => {
    mobileStillStarting();

    const reply = await call("contacts.markAllRead", { mutationId: "mark-all-1" });
    expect(reply.ok).toBe(true);
    expect(reply.payload).toMatchObject({ applied: true });
  });

  it("answers a repeated mutation id once, so a retry never double-applies", async () => {
    const first = await call("contacts.markAllRead", { mutationId: "mark-all-retry" });
    const second = await call("contacts.markAllRead", { mutationId: "mark-all-retry" });
    expect(first.payload.applied).toBe(true);
    expect(second.payload).toMatchObject({ applied: false, readThroughMs: first.payload.readThroughMs });
  });

  it("tells open windows the contact roster changed, so thread lists reload", async () => {
    const broadcast = vi.fn();
    const reply = await call("contacts.markAllRead", { mutationId: "broadcast-1" }, busyContext(broadcast));
    expect(reply.ok).toBe(true);
    expect(broadcast).toHaveBeenCalledWith("contacts.changed", expect.any(Object), expect.any(Object));
  });

  it("answers mark all read in well under 50 ms with an agent still starting", async () => {
    mobileStillStarting();
    const samples: number[] = [];
    for (let run = 0; run < 15; run += 1) {
      const started = performance.now();
      const reply = await call("contacts.markAllRead", { mutationId: `latency-${run}` });
      samples.push(performance.now() - started);
      expect(reply.ok).toBe(true);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(50);
  });
});

describe("mark all read is visible in the contact list", () => {
  it("lists the ready threads as read without failing the list while another agent is starting", async () => {
    mobileStillStarting();
    expect((await call("contacts.markAllRead", { mutationId: "list-while-starting" })).ok).toBe(true);

    const listed = await call("contacts.list", {});
    expect(listed.ok).toBe(true);
    const main = listed.payload.contacts.find((contact: { id: string }) => contact.id.includes("main"));
    expect(main.threadUnread).toBe(false);
  });

  it("shows the starting agent's threads as read once it is ready, because the marker covers every thread", async () => {
    mobileStillStarting();
    await call("contacts.markAllRead", { mutationId: "list-after-ready" });
    admission.recordAgentDatabaseAdmissions([], { source: "startup" });

    const listed = await call("contacts.list", {});
    const mobile = listed.payload.contacts.find((contact: { id: string }) => contact.id.includes("mobile"));
    expect(mobile).toBeDefined();
    expect(mobile.threadUnread).toBe(false);
  });
});

