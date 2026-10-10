// End to end with a fake model. The model's turn is scripted: it greets, asks, and calls team_propose once the
// owner has named the goal. Everything else is real: the transcript, the proposal, the approve handler, the
// room store, the queue, the team registry, and the progress line. The owner's Allow on the Inbox card is faked,
// and createAgent is replaced by an in-memory config write, since its persistence has its own tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedFirstRunGreeting, FIRST_RUN_GREETING_TEXT } from "../../agents/first-run-greeting.js";
import { createTeamProposeTool } from "../../agents/tools/team-tools.js";
import { claimNextQueueItem, listQueueItems } from "../../agents/trunk-queue.js";
import { decideLockdownAdmission } from "../../config/lockdown-policy.js";
import { resolveAgentMainSessionKey } from "../../config/sessions/main-session.js";
import {
  appendTranscriptMessage,
  loadSessionEntry,
  loadTranscriptEvents,
} from "../../config/sessions/session-accessor.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { cleanupSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import { readRoomLog, getRoom } from "../rooms/store.js";

const mocks = vi.hoisted(() => ({
  approval: vi.fn(),
  decide: (() => undefined) as (decision: string) => void,
  cfg: {} as BranchConfig,
  created: [] as Array<{ id: string; model?: string; tools?: unknown }>,
}));

vi.mock("./model-choice-approval.js", () => ({ requestOwnerChangeApproval: mocks.approval }));
vi.mock("./trunk-queue.js", () => ({ wakeEligibleTrunks: vi.fn() }));
vi.mock("../../agents/agent-create.js", () => ({
  createAgent: async (params: { entry: { id: string; tools?: unknown }; model?: string }) => {
    mocks.created.push({ id: params.entry.id, model: params.model, tools: params.entry.tools });
    mocks.cfg.agents!.entries![params.entry.id] = { ...params.entry };
    return { status: "created", agentId: params.entry.id, name: params.entry.id };
  },
}));

const { trunkTeamHandlers } = await import("./trunk-team.js");
const { attachTeamProgress } = await import("./trunk-team-progress.js");

let dir: string;
let previousStateDir: string | undefined;

/** The gateway handler, called the way the in-process tool call reaches it. */
async function gateway(method: "trunks.team.propose" | "trunks.team.open", params: object) {
  const respond = vi.fn();
  await trunkTeamHandlers[method]!({
    params,
    respond,
    context: {
      getRuntimeConfig: () => mocks.cfg,
      nodeRegistry: { listConnected: () => [] },
      logGateway: { warn: vi.fn() },
    } as never,
  } as never);
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  if (!ok) {
    throw new Error((error as { message?: string } | undefined)?.message ?? "failed");
  }
  return payload as Record<string, unknown>;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-team-e2e-"));
  previousStateDir = process.env.BRANCH_STATE_DIR;
  process.env.BRANCH_STATE_DIR = dir;
  mocks.cfg = { agents: { defaults: { model: "anthropic/claude-sonnet" }, entries: { main: {} } } };
  mocks.created.length = 0;
  mocks.approval.mockReset();
  // The owner's answer on the record: it is created first, then answered (see step 4).
  mocks.decide = () => undefined;
  mocks.approval.mockImplementation(
    (params: { onRecord?: (id: string) => void }) =>
      new Promise<string>((resolve) => {
        params.onRecord?.("appr-flow");
        mocks.decide = resolve;
      }),
  );
});

afterEach(async () => {
  attachTeamProgress(() => undefined);
  await cleanupSessionStateForTest({ stateDir: dir });
  if (previousStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = previousStateDir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a team, from the first conversation to the first progress line", () => {
  it("greets, drafts the team from the goal, applies it on approval, and reports its first job", async () => {
    // 1. The Trunk is created: its first line is in the main session.
    const sessionsDir = path.join(dir, "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const storePath = path.join(sessionsDir, "sessions.json");
    const cfg = mocks.cfg;
    const sessionKey = resolveAgentMainSessionKey({ cfg, agentId: "main" });
    const ownerWorkspaceDir = fs.mkdtempSync(path.join(dir, "owner-"));
    await seedFirstRunGreeting({ cfg, agentId: "main", storePath, ownerWorkspaceDir });
    const sessionId = loadSessionEntry({ agentId: "main", sessionKey, storePath })?.sessionId ?? "";
    const greeted = await loadTranscriptEvents({
      agentId: "main",
      sessionId,
      sessionKey,
      storePath,
    });
    expect(JSON.stringify(greeted)).toContain(FIRST_RUN_GREETING_TEXT);

    // 2. The owner answers, then names the goal.
    for (const [index, text] of ["Good, you?", "Ship the Q3 newsletter"].entries()) {
      await appendTranscriptMessage(
        { agentId: "main", sessionId, sessionKey, storePath },
        {
          message: {
            role: "user",
            content: [{ type: "text", text }],
            timestamp: Date.now() + index,
          },
          idempotencyKey: `owner-${index}`,
        },
      );
    }

    // 3. The model drafts the team once it knows the goal: the tool is called with the roles it chose.
    const tool = createTeamProposeTool({
      callGateway: async ({ method, params }) =>
        gateway(method as "trunks.team.propose", params as object),
    } as never);
    const drafted = await tool.execute("call-1", {
      goal: "Ship the Q3 newsletter",
      roles: [
        { name: "Researcher", job: "Find the three topics readers asked about." },
        { name: "Editor", job: "Cut every draft to 300 words.", model: "anthropic/claude-sonnet" },
      ],
    } as never);
    const proposal = (
      drafted.details as {
        proposal: {
          teamId: string;
          hash: string;
          roomId: string;
          members: Array<{ agentId: string }>;
        };
      }
    ).proposal;
    expect(proposal.members).toHaveLength(2);
    expect(mocks.created).toHaveLength(0);

    // 4. The owner taps Approve on the card, and allows it in the Inbox.
    const attached: Array<[string, unknown]> = [];
    attachTeamProgress((event, payload) => {
      attached.push([event, payload]);
    });
    const opened = await gateway("trunks.team.open", {
      goal: "Ship the Q3 newsletter",
      roles: [
        { name: "Researcher", job: "Find the three topics readers asked about." },
        { name: "Editor", job: "Cut every draft to 300 words.", model: "anthropic/claude-sonnet" },
      ],
      proposalHash: proposal.hash,
    });
    // Opening creates the record the Inbox shows, and nothing else.
    expect(opened).toEqual({ status: "pending", approvalId: "appr-flow" });
    expect(mocks.created).toHaveLength(0);

    // The owner's one tap on the card resolves that record as allowed.
    mocks.decide("allow");
    await vi.waitFor(() => expect(mocks.created).toHaveLength(proposal.members.length));

    // 5. The Trunks, the room, and the queue jobs exist, once each.
    expect(mocks.created.map((entry) => entry.id)).toEqual(
      proposal.members.map((member) => member.agentId),
    );
    expect(getRoom(proposal.roomId)?.members.map((member) => member.id)).toEqual(
      proposal.members.map((member) => member.agentId),
    );
    expect(listQueueItems().filter((item) => item.team === proposal.teamId)).toHaveLength(2);

    // 6. A builder outside the team cannot take its job; a member can, and the room hears about it.
    expect(claimNextQueueItem("builder-outsider")).toBeUndefined();
    const member = proposal.members[0]!.agentId;
    const claim = claimNextQueueItem(member);
    expect(claim?.team).toBe(proposal.teamId);
    const lines = readRoomLog(proposal.roomId).events.map(
      (event) => (event.payload as { text?: string }).text,
    );
    expect(lines).toContain('Builder Researcher picked up "Researcher: Ship the Q3 newsletter".');
  });
});

describe("the approve path under Lockdown", () => {
  it("is refused at admission, so the team is not created", () => {
    expect(
      decideLockdownAdmission({
        method: "trunks.team.open",
        params: { goal: "Ship it", proposalHash: "h" },
        scope: "operator.write",
        isOwner: () => true,
      }),
    ).toEqual({ admitted: false, reason: "locked" });
    expect(
      decideLockdownAdmission({
        method: "approval.resolve",
        params: { id: "a", kind: "system-agent", decision: "allow-once" },
        scope: "operator.write",
        isOwner: () => true,
      }),
    ).toEqual({ admitted: false, reason: "locked" });
    expect(mocks.created).toHaveLength(0);
  });
});

describe("one tap on the card", () => {
  /** The gateway's admission for the card's tap: under Lockdown, approval.resolve allow never reaches the record. */
  function tap(lockdown: boolean): { admitted: boolean } {
    if (!lockdown) {
      mocks.decide("allow");
      return { admitted: true };
    }
    return decideLockdownAdmission({
      method: "approval.resolve",
      params: { id: "appr-tap", kind: "system-agent", decision: "allow-once" },
      scope: "operator.write",
      isOwner: () => true,
    });
  }

  async function openedTeam(goal: string) {
    const proposed = await gateway("trunks.team.propose", { goal });
    const proposal = (proposed as { proposal: { hash: string } }).proposal;
    const opened = await gateway("trunks.team.open", { goal, proposalHash: proposal.hash });
    return { opened: opened as { approvalId: string } };
  }

  beforeEach(() => {
    mocks.created.length = 0;
    mocks.approval.mockReset();
    mocks.approval.mockImplementation(
      (params: { onRecord?: (id: string) => void }) =>
        new Promise<string>((resolve) => {
          params.onRecord?.("appr-tap");
          mocks.decide = resolve;
        }),
    );
  });

  it("creates the team on one tap when Lockdown is off", async () => {
    await openedTeam("Ship a one-tap newsletter");
    expect(tap(false)).toEqual({ admitted: true });
    await vi.waitFor(() => expect(mocks.created.length).toBe(3));
  });

  it("refuses the same tap under Lockdown: the record is not answered, and nothing is created", async () => {
    await openedTeam("Ship a locked newsletter");

    const refused = tap(true);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(refused).toEqual({ admitted: false, reason: "locked" });
    expect(mocks.created).toHaveLength(0);
  });
});
