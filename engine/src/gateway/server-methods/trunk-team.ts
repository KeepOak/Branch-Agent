// Team proposal and approval for a goal. propose only reads configured models and computers. approve applies
// the approved proposal once, after the owner's one approve tap on the change approval card.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { createAgent } from "../../agents/agent-create.js";
import { addQueueItem, listQueueItems } from "../../agents/trunk-queue.js";
import { applyTeamProposal, type TeamApplyDeps } from "../../agents/trunk-team-apply.js";
import {
  forgetProposal,
  readProposal,
  saveProposal,
  type ProposalRecord,
} from "../../agents/trunk-team-proposals.js";
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
import { publishTeamChange } from "./trunk-team-progress.js";
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
  | { ok: true; created: string[]; skipped: string[] }
  | { ok: false; message: string };

/** The applies running, keyed by team id and proposal hash. A second allow of the same proposal waits for the first. */
const teamAppliesInFlight = new Map<string, Promise<ApplyOutcome>>();

/** The approvals waiting for the owner, keyed by proposal hash, so one proposal has one record at a time. */
const openApprovals = new Map<string, Promise<string | undefined>>();

const UNAVAILABLE_TEXT = "Approval is unavailable right now. Nothing was created.";

/** Changes a proposal's stored state, keeping its other fields, and tells the open cards. */
function setProposalState(
  hash: string,
  base: { teamId: string; goal: string; roles?: TeamDraftRole[] },
  changes: Partial<Omit<ProposalRecord, "hash" | "teamId" | "goal" | "roles" | "updatedAt">>,
): void {
  const current = readProposal(hash);
  const saved = saveProposal({
    ...current,
    ...base,
    hash,
    state: current?.state ?? "pending",
    ...changes,
  });
  publishTeamChange({
    hash: saved.hash,
    teamId: saved.teamId,
    state: saved.state,
    approvalId: saved.approvalId,
    created: saved.created,
    message: saved.message,
  });
}

/**
 * Applies an allowed proposal, once at a time per team and hash. The proposal is rebuilt from the configuration at
 * this moment, and only the hash the owner allowed is created, so a model or computer that changed while the card
 * waited is refused.
 */
function applyAllowed(
  context: GatewayRequestContext,
  goal: string,
  roles: TeamDraftRole[] | undefined,
  teamId: string,
  hash: string,
): Promise<ApplyOutcome> {
  const key = `${teamId}:${hash}`;
  const running = teamAppliesInFlight.get(key);
  if (running) {
    return running;
  }
  const applied = applyOnce(context, goal, roles, teamId, hash).finally(() => {
    teamAppliesInFlight.delete(key);
  });
  teamAppliesInFlight.set(key, applied);
  return applied;
}

async function applyOnce(
  context: GatewayRequestContext,
  goal: string,
  roles: TeamDraftRole[] | undefined,
  teamId: string,
  hash: string,
): Promise<ApplyOutcome> {
  const base = { teamId, goal, ...(roles ? { roles } : {}) };
  const current = proposalFor(context, goal, roles);
  if (!current.ok || current.proposal.hash !== hash) {
    const message = "The team changed after it was allowed. Propose it again.";
    setProposalState(hash, base, { state: "failed", message });
    return { ok: false, message };
  }
  setProposalState(hash, base, { state: "applying" });
  try {
    const applied = await applyTeamProposal(current.proposal, productionDeps(context));
    wakeEligibleTrunks(context.getRuntimeConfig(), (message) => context.logGateway.warn(message));
    setProposalState(hash, base, {
      state: "applied",
      created: applied.created,
      message: undefined,
    });
    return { ok: true, created: applied.created, skipped: applied.skipped };
  } catch (error) {
    // Each step checks before it creates, so a retry finishes what is missing.
    context.logGateway.warn(`team ${teamId} was not fully created: ${formatErrorMessage(error)}`);
    const message = "The team was only partly created. Retry to finish it.";
    setProposalState(hash, base, { state: "failed", message });
    return { ok: false, message };
  }
}

type OpenOutcome = { approvalId: string } | { reason: "unavailable" | "failed" };

/**
 * Opens the proposal's approval: the record the Inbox shows, one per hash. The owner's answer on that record is the
 * only thing that starts the apply, and a declined or expired answer is recorded on the proposal.
 */
function openApproval(
  context: GatewayRequestContext,
  goal: string,
  roles: TeamDraftRole[] | undefined,
  proposal: { teamId: string; hash: string; goal: string },
  question: string,
): Promise<OpenOutcome> {
  const base = { teamId: proposal.teamId, goal, ...(roles ? { roles } : {}) };
  const waiting = openApprovals.get(proposal.hash);
  if (waiting) {
    return waiting.then((approvalId) => (approvalId ? { approvalId } : { reason: "unavailable" }));
  }
  setProposalState(proposal.hash, base, {
    state: "pending",
    approvalId: undefined,
    message: undefined,
  });
  let recorded: (outcome: OpenOutcome) => void = () => undefined;
  let handedOut = false;
  const outcome = new Promise<OpenOutcome>((resolve) => {
    recorded = resolve;
  });
  openApprovals.set(
    proposal.hash,
    outcome.then((result) => ("approvalId" in result ? result.approvalId : undefined)),
  );
  const decided = requestOwnerChangeApproval({
    context,
    title: "Create a team",
    question,
    kind: "trunk-team",
    onRecord: (approvalId) => {
      handedOut = true;
      setProposalState(proposal.hash, base, { approvalId });
      recorded({ approvalId });
    },
  });
  void decided
    .then(async (decision) => {
      if (decision === "unavailable") {
        recorded({ reason: "unavailable" });
        setProposalState(proposal.hash, base, { state: "expired", approvalId: undefined });
        return;
      }
      if (decision === "deny") {
        setProposalState(proposal.hash, base, { state: "declined" });
      } else if (decision === "expired") {
        setProposalState(proposal.hash, base, { state: "expired" });
      } else {
        await applyAllowed(context, goal, roles, proposal.teamId, proposal.hash);
      }
    })
    .catch((error: unknown) => {
      context.logGateway.warn(
        `team ${proposal.teamId} approval failed: ${formatErrorMessage(error)}`,
      );
      if (!handedOut) {
        // The record never registered: no id is kept, and nothing was created.
        forgetProposal(proposal.hash);
        recorded({ reason: "failed" });
      }
    })
    .finally(() => {
      openApprovals.delete(proposal.hash);
    });
  return outcome;
}

/** What an open card should show for a proposal that already has a record, or undefined when a new approval is needed. */
function answerFor(record: ProposalRecord): Record<string, unknown> | undefined {
  switch (record.state) {
    case "declined":
      return { status: "declined" };
    case "applying":
      return { status: "applying" };
    case "applied":
      return { status: "applied", created: record.created ?? [] };
    case "failed":
      return { status: "failed", message: record.message ?? "The team was not created." };
    default:
      return undefined;
  }
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
    const record = readProposal(result.proposal.hash);
    const answer = record ? answerFor(record) : undefined;
    if (answer) {
      respond(true, answer);
      return;
    }
    const opened = await openApproval(
      context,
      goal,
      roles,
      { ...result.proposal, goal },
      describeTeamProposal(result.proposal),
    );
    if ("approvalId" in opened) {
      respond(true, { status: "pending", approvalId: opened.approvalId });
    } else if (opened.reason === "failed") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "The approval could not be opened. Try again."),
      );
    } else {
      respond(true, { status: "unavailable", message: UNAVAILABLE_TEXT });
    }
  },
  "trunks.team.retry": async ({ params, respond, context }) => {
    const p = rec(params);
    const goal = text(p.goal);
    const roles = parseRoles(p.roles);
    const result = proposalFor(context, goal, roles);
    const hash = text(p.proposalHash);
    const record = readProposal(hash);
    if (!result.ok || !record || record.state !== "failed") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Nothing to retry for this team."),
      );
      return;
    }
    const outcome = await applyAllowed(context, goal, roles, result.proposal.teamId, hash);
    if (outcome.ok) {
      respond(true, { status: "applied", created: outcome.created, skipped: outcome.skipped });
    } else {
      respond(true, { status: "failed", message: outcome.message });
    }
  },
};
