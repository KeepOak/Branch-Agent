import { Type } from "typebox";
import { SessionGoalTransitionError } from "../../config/sessions/goals-transitions.js";
import {
  checkpointSessionGoal,
  createSessionGoal,
  getSessionGoal,
  MODEL_UPDATABLE_SESSION_GOAL_STATUSES,
  updateSessionGoalStatus,
} from "../../config/sessions/goals.js";
import { resolveSessionStorePathCore } from "../../config/sessions/paths.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { stringEnum } from "../schema/typebox.js";
import {
  type AnyAgentTool,
  ToolInputError,
  jsonResult,
  readPositiveIntegerParam,
  readToolStringParam,
} from "./common.js";

type GoalToolOptions = {
  agentSessionKey?: string;
  runSessionKey?: string;
  sessionAgentId?: string;
  config?: BranchConfig;
};

const CreateGoalToolSchema = Type.Object({
  objective: Type.String({
    description: "Concrete objective; explicit request only.",
  }),
  acceptance_criteria: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description:
        "Optional completion criteria for this objective; each needs recorded evidence before agent completion.",
    }),
  ),
  token_budget: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], {
      description: "Positive token budget. Omit or pass null unless explicitly requested.",
    }),
  ),
});

const UpdateGoalToolSchema = Type.Object({
  status: stringEnum([...MODEL_UPDATABLE_SESSION_GOAL_STATUSES, "checkpoint"], {
    description:
      "complete | blocked | checkpoint. A checkpoint saves progress without changing the goal status.",
  }),
  note: Type.Optional(Type.String({ description: "Short status note." })),
  goal_id: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Goal id from get_goal; rejects an update to a replaced goal.",
    }),
  ),
  next_action: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required for checkpoint: the next unfinished step, not an instruction to replay completed actions.",
    }),
  ),
  completion_evidence: Type.Optional(
    Type.Array(
      Type.Object({
        criterion: Type.Integer({ minimum: 0 }),
        evidence: Type.String({
          minLength: 1,
          description:
            "Observed result and its receipt/source, not a promise or a completion claim.",
        }),
      }),
    ),
  ),
});

function readAcceptanceCriteria(params: Record<string, unknown>): string[] | undefined {
  const value = params.acceptance_criteria;
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ToolInputError("acceptance_criteria must be an array of non-empty strings");
  }
  return value.map((item: string) => item.trim());
}

function readCompletionEvidence(params: Record<string, unknown>) {
  const value = params.completion_evidence;
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        !Number.isSafeInteger(item.criterion) ||
        item.criterion < 0 ||
        typeof item.evidence !== "string" ||
        !item.evidence.trim(),
    )
  ) {
    throw new ToolInputError(
      "completion_evidence must contain non-negative criterion indexes and non-empty evidence",
    );
  }
  return value.map((item: { criterion: number; evidence: string }) => ({
    criterion: item.criterion,
    evidence: item.evidence.trim(),
  }));
}

function resolveGoalSessionScope(options: GoalToolOptions) {
  const sessionKey = options.runSessionKey?.trim() || options.agentSessionKey?.trim();
  if (!sessionKey) {
    throw new ToolInputError("session key required");
  }
  const parsedSessionAgentId = parseAgentSessionKey(sessionKey)?.agentId;
  const parsedAgentSessionAgentId = parseAgentSessionKey(options.agentSessionKey)?.agentId;
  // Prefer the run session's agent id; fall back to the agent session for legacy tool contexts.
  const agentId = normalizeAgentId(
    parsedSessionAgentId ?? parsedAgentSessionAgentId ?? options.sessionAgentId,
  );
  return {
    sessionKey,
    agentId,
    storePath: resolveSessionStorePathCore(options.config?.session?.store, {
      agentId,
    }),
  };
}

export function createGetGoalTool(options: GoalToolOptions): AnyAgentTool {
  return {
    label: "Get Goal",
    name: "get_goal",
    displaySummary: "Get the current thread goal",
    description:
      "Get the current session goal, including its full objective, status, token usage, and optional budget.",
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await getSessionGoal({
        ...resolveGoalSessionScope(options),
        persist: false,
      });
      return jsonResult(snapshot);
    },
  };
}

export function createCreateGoalTool(options: GoalToolOptions): AnyAgentTool {
  return {
    label: "Create Goal",
    name: "create_goal",
    displaySummary: "Create a thread goal",
    description:
      "Create a goal only when explicitly requested by the user or system instructions. Set a positive token_budget only when a budget is explicitly requested; otherwise omit it or pass null. Fails if a goal already exists; the user must clear it before starting another.",
    parameters: CreateGoalToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const objective = readToolStringParam(params, "objective", { required: true });
      const tokenBudget = readPositiveIntegerParam(params, "token_budget", {
        message: "token_budget must be a positive integer",
      });
      const scope = resolveGoalSessionScope(options);
      const acceptanceCriteria = readAcceptanceCriteria(params);
      const goal = await createSessionGoal({
        ...scope,
        actor: { type: "agent", id: scope.sessionKey },
        objective,
        acceptanceCriteria,
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      });
      return jsonResult({ status: "created", goal });
    },
  };
}

export function createUpdateGoalTool(options: GoalToolOptions): AnyAgentTool {
  return {
    label: "Update Goal",
    name: "update_goal",
    displaySummary: "Save progress, complete or block a thread goal",
    description:
      "Save durable progress with status checkpoint, note describing confirmed completed work, and next_action describing the unfinished step. Use goal_id from get_goal to bind an update to that goal. Mark the session goal complete only when the full objective is verified and no required work remains; provide completion_evidence for each acceptance criterion (zero-based index). Recorded evidence is not an independent verification of its truth. Mark it blocked only when the same blocker has recurred for at least three consecutive goal turns and no meaningful progress is possible without user input or an external change. After the user resumes a blocked goal, count those turns from the resume. Difficulty, incomplete work, or a nearly exhausted budget do not justify completion or blocking. Updating a goal does not reply to the user; provide the requested final response afterward.",
    parameters: UpdateGoalToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const requestedStatus = readToolStringParam(params, "status", { required: true });
      const status = MODEL_UPDATABLE_SESSION_GOAL_STATUSES.find(
        (candidate) => candidate === requestedStatus,
      );
      if (status === undefined && requestedStatus !== "checkpoint") {
        throw new ToolInputError(
          `status must be one of ${[...MODEL_UPDATABLE_SESSION_GOAL_STATUSES, "checkpoint"].join(", ")}`,
        );
      }
      const note = readToolStringParam(params, "note");
      const scope = resolveGoalSessionScope(options);
      const current = await getSessionGoal({ ...scope, persist: false });
      const expectedGoalId = readToolStringParam(params, "goal_id") ?? current.goal?.id;
      const completionEvidence = readCompletionEvidence(params);
      try {
        const common = {
          ...scope,
          actor: { type: "agent" as const, id: scope.sessionKey },
          expectedGoalId,
        };
        const goal =
          requestedStatus === "checkpoint"
            ? await checkpointSessionGoal({
                ...common,
                summary: note ?? "",
                nextAction: readToolStringParam(params, "next_action", { required: true }),
              })
            : await updateSessionGoalStatus({
                ...common,
                status: status!,
                completionEvidence,
                ...(note ? { note } : {}),
              });
        return jsonResult({
          status: "updated",
          goal,
          nextAction:
            requestedStatus === "checkpoint"
              ? goal.status === "paused"
                ? "Progress is saved. The goal remains paused; wait until the user resumes before continuing the unfinished work."
                : "Progress is saved. Continue from the next unfinished step; do not repeat confirmed work."
              : "Goal status was updated, but no reply was sent to the user. Continue this turn and provide the requested visible final response.",
        });
      } catch (err) {
        if (err instanceof SessionGoalTransitionError) {
          return jsonResult({
            status: "error",
            error: err.message,
            nextAction:
              err.message.startsWith("Goal is paused;")
                ? "Do not retry this status update or continue goal work until the user resumes. Confirmed progress may be saved as a checkpoint without changing the paused status."
                : err.message === "goal not found" || err.message.startsWith("goal is already")
                ? "Do not retry update_goal. No active goal requires a status change — continue this turn and provide your response to the user."
                : "Do not repeat this unchanged update_goal request. Read get_goal, resolve the missing evidence or changed goal, and continue the unfinished work.",
          });
        }
        throw err;
      }
    },
  };
}
