// Team proposal and approval for a goal. propose only reads configured models and computers. approve applies
// the approved proposal once, after the owner's one approve tap on the change approval card.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { createAgent } from "../../agents/agent-create.js";
import { addQueueItem, listQueueItems } from "../../agents/trunk-queue.js";
import { applyTeamProposal, type TeamApplyDeps } from "../../agents/trunk-team-apply.js";
import { registerTeam } from "../../agents/trunk-team-registry.js";
import {
  buildTeamProposal,
  describeTeamProposal,
  type TeamDraftRole,
} from "../../agents/trunk-team.js";
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

function proposalFor(context: GatewayRequestContext, goal: string, roles?: TeamDraftRole[]) {
  return buildTeamProposal({
    goal,
    models: configuredModels(context.getRuntimeConfig()),
    machines: machinesFor(context),
    ...(roles === undefined ? {} : { roles }),
  });
}

/** The Trunk's drafted roles from request params. A non-list is passed on as an empty draft and refused there. */
export function parseRoles(value: unknown): TeamDraftRole[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const role = rec(entry);
    return {
      name: text(role.name),
      job: text(role.job),
      ...(typeof role.machine === "string" ? { machine: role.machine.trim() } : {}),
      ...(typeof role.model === "string" ? { model: role.model.trim() } : {}),
    };
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

type ApplyOutcome =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: ReturnType<typeof errorShape> };

/** The applies running for each team. A second allow for the same team waits for the first, never repeats it. */
const teamAppliesInFlight = new Map<string, Promise<ApplyOutcome>>();

/**
 * Applies an allowed team. The proposal is rebuilt from the configuration at this moment, and only a team that still
 * has the hash the owner allowed is created, so a model or computer that changed while the card waited is refused.
 */
function applyAllowed(
  context: GatewayRequestContext,
  goal: string,
  roles: TeamDraftRole[] | undefined,
  allowedHash: string,
): Promise<ApplyOutcome> {
  const teamId = proposalFor(context, goal, roles);
  const key = teamId.ok ? teamId.proposal.teamId : goal;
  const running = teamAppliesInFlight.get(key);
  if (running) {
    return running;
  }
  const applied = applyOnce(context, goal, roles, allowedHash).finally(() => {
    teamAppliesInFlight.delete(key);
  });
  teamAppliesInFlight.set(key, applied);
  return applied;
}

async function applyOnce(
  context: GatewayRequestContext,
  goal: string,
  roles: TeamDraftRole[] | undefined,
  allowedHash: string,
): Promise<ApplyOutcome> {
  const result = proposalFor(context, goal, roles);
  if (!result.ok || result.proposal.hash !== allowedHash) {
    return {
      ok: false,
      error: errorShape(
        ErrorCodes.INVALID_REQUEST,
        "The team changed after it was allowed. Propose it again.",
      ),
    };
  }
  try {
    const applied = await applyTeamProposal(result.proposal, productionDeps(context));
    wakeEligibleTrunks(context.getRuntimeConfig(), (message) => context.logGateway.warn(message));
    return { ok: true, payload: { status: "applied", ...applied } };
  } catch (error) {
    // Each step checks before it creates, so opening and allowing again finishes what is missing.
    context.logGateway.warn(
      `team ${result.proposal.teamId} was not fully created: ${formatErrorMessage(error)}`,
    );
    return {
      ok: false,
      error: errorShape(
        ErrorCodes.UNAVAILABLE,
        "The team was only partly created. Open it again to finish.",
      ),
    };
  }
}

/**
 * The approval record for each proposal that is waiting for the owner, by team id and hash. Opening the same proposal
 * again returns the record already waiting, so the card and the Inbox show one approval.
 */
const openApprovals = new Map<string, Promise<string | undefined>>();

/**
 * Opens the team's approval: the same record the Inbox shows. The owner's Allow on that record (approval.resolve)
 * is the only thing that starts the apply; nothing is created here.
 */
function openApproval(
  context: GatewayRequestContext,
  goal: string,
  roles: TeamDraftRole[] | undefined,
  proposal: { teamId: string; hash: string },
  question: string,
): Promise<string | undefined> {
  const key = `${proposal.teamId}:${proposal.hash}`;
  const waiting = openApprovals.get(key);
  if (waiting) {
    return waiting;
  }
  let recorded: (id: string | undefined) => void = () => undefined;
  const id = new Promise<string | undefined>((resolve) => {
    recorded = resolve;
  });
  openApprovals.set(key, id);
  const decided = requestOwnerChangeApproval({
    context,
    title: "Create a team",
    question,
    kind: "trunk-team",
    onRecord: (approvalId) => recorded(approvalId),
  });
  void decided.then(async (decision) => {
    recorded(undefined);
    openApprovals.delete(key);
    if (decision === "allow") {
      await applyAllowed(context, goal, roles, proposal.hash);
    }
  });
  return id;
}

export const trunkTeamHandlers: GatewayRequestHandlers = {
  "trunks.team.propose": ({ params, respond, context }) => {
    const p = rec(params);
    const result = proposalFor(context, text(p.goal), parseRoles(p.roles));
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    respond(true, {
      proposal: result.proposal,
      summary: describeTeamProposal(result.proposal),
      choices: {
        models: configuredModels(context.getRuntimeConfig()),
        machines: machinesFor(context),
      },
    });
  },
  "trunks.team.open": async ({ params, respond, context }) => {
    const p = rec(params);
    const goal = text(p.goal);
    const roles = parseRoles(p.roles);
    const result = proposalFor(context, goal, roles);
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    if (text(p.proposalHash) !== result.proposal.hash) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "The team changed since it was proposed. Propose it again.",
        ),
      );
      return;
    }
    const approvalId = await openApproval(
      context,
      goal,
      roles,
      result.proposal,
      describeTeamProposal(result.proposal),
    );
    if (!approvalId) {
      respond(true, { status: "unavailable" });
      return;
    }
    respond(true, { status: "pending", approvalId });
  },
};
