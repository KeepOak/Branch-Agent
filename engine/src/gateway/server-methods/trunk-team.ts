// Team proposal and approval for a goal. propose only reads configured models and computers. approve applies
// the approved proposal once, after the owner's one approve tap on the change approval card.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { createAgent } from "../../agents/agent-create.js";
import { addQueueItem, listQueueItems } from "../../agents/trunk-queue.js";
import { applyTeamProposal, type TeamApplyDeps } from "../../agents/trunk-team-apply.js";
import { registerTeam } from "../../agents/trunk-team-registry.js";
import { buildTeamProposal, describeTeamProposal } from "../../agents/trunk-team.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { createRoom, getRoom } from "../rooms/store.js";
import { requestOwnerChangeApproval } from "./model-choice-approval.js";
import { wakeEligibleTrunks } from "./trunk-queue.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Model references already set up in this engine: the defaults and each Trunk's primary and fallbacks. */
export function configuredModels(cfg: BranchConfig): string[] {
  const refs: string[] = [];
  const add = (model: unknown) => {
    if (typeof model === "string") {
      refs.push(model);
      return;
    }
    if (model && typeof model === "object") {
      const { primary, fallbacks } = model as { primary?: unknown; fallbacks?: unknown };
      if (typeof primary === "string") {
        refs.push(primary);
      }
      if (Array.isArray(fallbacks)) {
        refs.push(...fallbacks.filter((f): f is string => typeof f === "string"));
      }
    }
  };
  add(cfg.agents?.defaults?.model);
  for (const entry of Object.values(cfg.agents?.entries ?? {})) {
    add((entry as Rec).model);
  }
  return [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
}

/** This computer, then every connected paired computer. */
function machinesFor(context: GatewayRequestContext): string[] {
  const connected = context.nodeRegistry?.listConnected().map((node) => node.nodeId) ?? [];
  return ["this", ...connected];
}

function proposalFor(context: GatewayRequestContext, goal: string) {
  return buildTeamProposal({
    goal,
    models: configuredModels(context.getRuntimeConfig()),
    machines: machinesFor(context),
  });
}

/** The real side effects. Members are created with no bootstrap, so none of them greets the owner. */
function productionDeps(context: GatewayRequestContext): TeamApplyDeps {
  const cfg = () => context.getRuntimeConfig();
  return {
    hasAgent: (agentId) => Boolean(cfg().agents?.entries?.[agentId]),
    createAgent: async (member) => {
      const result = await createAgent({
        entry: { id: member.agentId, name: member.name, ...placementFor(member.machine) },
        purpose: member.job,
        model: member.model,
        skipBootstrap: true,
      });
      if (result.status === "error") {
        throw new Error(result.message);
      }
    },
    hasRoom: (roomId) => Boolean(getRoom(roomId)),
    createRoom: (input) =>
      createRoom({
        roomId: input.roomId,
        name: input.name,
        members: input.members.map((id) => ({
          kind: "trunk" as const,
          id,
          role: "member" as const,
          enabled: true,
        })),
      }),
    hasJob: (briefText) => listQueueItems().some((item) => item.brief_text === briefText),
    addJob: (input) => {
      addQueueItem(input);
    },
    registerTeam: (teamId, record) => registerTeam(teamId, record),
  };
}

/** The machine a member runs on. "this" is the default, so only a remote computer is written into the entry. */
export function placementFor(machine: string): {
  tools?: { exec: { host: "node"; node: string } };
} {
  return machine === "this" ? {} : { tools: { exec: { host: "node", node: machine } } };
}

type ApproveOutcome =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: ReturnType<typeof errorShape> };

/** Approvals in flight, by team id. A second approve for the same team waits for the first and shares its answer. */
const teamApprovalsInFlight = new Map<string, Promise<ApproveOutcome>>();

async function approveOnce(
  context: GatewayRequestContext,
  goal: string,
  proposalHash: string,
): Promise<ApproveOutcome> {
  const result = proposalFor(context, goal);
  if (!result.ok) {
    return { ok: false, error: errorShape(ErrorCodes.INVALID_REQUEST, result.reason) };
  }
  if (proposalHash !== result.proposal.hash) {
    return {
      ok: false,
      error: errorShape(
        ErrorCodes.INVALID_REQUEST,
        "The team changed since it was proposed. Propose it again.",
      ),
    };
  }
  const decision = await requestOwnerChangeApproval({
    context,
    title: "Create a team",
    question: describeTeamProposal(result.proposal),
    kind: "trunk-team",
  });
  if (decision !== "allow") {
    return {
      ok: true,
      payload: { status: decision === "unavailable" ? "unavailable" : "declined" },
    };
  }
  try {
    const applied = await applyTeamProposal(result.proposal, productionDeps(context));
    wakeEligibleTrunks(context.getRuntimeConfig(), (message) => context.logGateway.warn(message));
    return { ok: true, payload: { status: "applied", ...applied } };
  } catch (error) {
    // Each step checks before it creates, so approving again finishes what is missing.
    context.logGateway.warn(
      `team ${result.proposal.teamId} was not fully created: ${formatErrorMessage(error)}`,
    );
    return {
      ok: false,
      error: errorShape(
        ErrorCodes.UNAVAILABLE,
        "The team was only partly created. Approve it again to finish.",
      ),
    };
  }
}

/** One approval per team at a time: concurrent approves share the first one's outcome, so nothing is created twice. */
function singleFlightApprove(
  context: GatewayRequestContext,
  teamId: string,
  goal: string,
  proposalHash: string,
): Promise<ApproveOutcome> {
  const running = teamApprovalsInFlight.get(teamId);
  if (running) {
    return running;
  }
  const started = approveOnce(context, goal, proposalHash).finally(() => {
    teamApprovalsInFlight.delete(teamId);
  });
  teamApprovalsInFlight.set(teamId, started);
  return started;
}

export const trunkTeamHandlers: GatewayRequestHandlers = {
  "trunks.team.propose": ({ params, respond, context }) => {
    const result = proposalFor(context, text(rec(params).goal));
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    respond(true, { proposal: result.proposal, summary: describeTeamProposal(result.proposal) });
  },
  "trunks.team.approve": async ({ params, respond, context }) => {
    const p = rec(params);
    const goal = text(p.goal);
    const proposal = proposalFor(context, goal);
    if (!proposal.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, proposal.reason));
      return;
    }
    const outcome = await singleFlightApprove(
      context,
      proposal.proposal.teamId,
      goal,
      text(p.proposalHash),
    );
    if (outcome.ok) {
      respond(true, outcome.payload);
    } else {
      respond(false, undefined, outcome.error);
    }
  },
};
