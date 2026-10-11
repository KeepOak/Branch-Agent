import { Type } from "typebox";
import type { BranchConfig } from "../../config/types.branch.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import {
  callAgentToolGatewayRequest,
  type AgentToolGatewayRequestCaller,
} from "./in-process-gateway.js";

type TeamToolOptions = {
  config?: BranchConfig;
  callGateway?: AgentToolGatewayRequestCaller;
};

const RoleSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 40 }),
    job: Type.String({ minLength: 1, maxLength: 160 }),
    machine: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const TeamProposeSchema = Type.Object(
  {
    goal: Type.String({ minLength: 3, maxLength: 300 }),
    roles: Type.Optional(Type.Array(RoleSchema, { minItems: 1, maxItems: 5 })),
  },
  { additionalProperties: false },
);

/**
 * Drafts a team for the owner's goal and returns it for the owner to approve in the chat. It creates nothing:
 * approval is the owner's, and the engine checks every role against what is configured.
 */
export function createTeamProposeTool(options: TeamToolOptions = {}): AnyAgentTool {
  const gatewayCall = options.callGateway ?? callAgentToolGatewayRequest;
  return {
    label: "Team Propose",
    name: "team_propose",
    displaySummary:
      "Draft a team for the owner's goal, with 1 to 5 roles. The owner approves it in the chat.",
    description:
      "Draft a team for the goal the owner gave you. Give 1 to 5 roles, each with a short name and a one-line job. Call it once you know the goal. Nothing is created by this call: the owner sees the team and approves it.",
    parameters: TeamProposeSchema,
    execute: async (_toolCallId, args, signal) => {
      const input = args as { goal: string; roles?: unknown };
      return jsonResult(
        await gatewayCall({
          method: "trunks.team.propose",
          params: {
            goal: input.goal,
            ...(input.roles !== undefined ? { roles: input.roles } : {}),
          },
          ...(options.config ? { config: options.config } : {}),
          ...(signal ? { signal } : {}),
        }),
      );
    },
  };
}
