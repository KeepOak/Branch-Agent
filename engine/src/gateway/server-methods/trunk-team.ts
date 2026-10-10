// Team proposal and approval for a goal. propose only reads configured models and computers. approve applies
// the approved proposal once, after the owner's one approve tap on the change approval card.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { createAgent } from "../../agents/agent-create.js";
import { addQueueItem, listQueueItems } from "../../agents/trunk-queue.js";
import { applyTeamProposal, type TeamApplyDeps } from "../../agents/trunk-team-apply.js";
import { registerTeam } from "../../agents/trunk-team-registry.js";
import { buildTeamProposal, describeTeamProposal } from "../../agents/trunk-team.js";
import type { BranchConfig } from "../../config/types.branch.js";
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
        entry: { id: member.agentId, name: member.name },
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
    const result = proposalFor(context, text(p.goal));
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
    const decision = await requestOwnerChangeApproval({
      context,
      title: "Create a team",
      question: describeTeamProposal(result.proposal),
      kind: "trunk-team",
    });
    if (decision !== "allow") {
      respond(true, { status: decision === "unavailable" ? "unavailable" : "declined" });
      return;
    }
    const applied = await applyTeamProposal(result.proposal, productionDeps(context));
    wakeEligibleTrunks(context.getRuntimeConfig(), (message) => context.logGateway.warn(message));
    respond(true, { status: "applied", ...applied });
  },
};
