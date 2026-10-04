/**
 * save_run_learning / delete_run_learning for scheduled runs.
 *
 * Copied from MarlBurroW/hivekeep src/server/tools/cron-learning-tools.ts
 * (AUTOMATION-0200). Only isolated scheduled runs get these tools; the job and
 * run come from the run's session key, never from model arguments.
 */
import { isRecord } from "@branch/normalization-core/record-coerce";
import { Type } from "typebox";
import {
  CRON_LEARNING_CATEGORIES,
  type CronLearningCategory,
  deleteCronLearning,
  saveCronLearning,
} from "../../cron/cron-learnings.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { optionalStringEnum } from "../schema/string-enum.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

export const SAVE_RUN_LEARNING_TOOL_NAME = "save_run_learning";
export const DELETE_RUN_LEARNING_TOOL_NAME = "delete_run_learning";

type CronRunScope = { jobId: string; runId: string };

/** Reads job and run ids from `agent:<id>:cron:<job>:run:<runId>`. */
export function resolveCronRunScope(sessionKey: string | undefined): CronRunScope | undefined {
  const parsed = parseAgentSessionKey(sessionKey);
  const match = parsed ? /^cron:([^:]+):run:([^:]+)$/.exec(parsed.rest) : null;
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { jobId: match[1], runId: match[2] };
}

const SaveRunLearningSchema = Type.Object(
  {
    content: Type.String({
      description:
        'The learning to persist. Be specific and actionable (e.g., "The API endpoint requires header X-Auth-Token, not Authorization").',
    }),
    category: optionalStringEnum(CRON_LEARNING_CATEGORIES, {
      description: "Optional category for organization.",
    }),
  },
  { additionalProperties: false },
);

const DeleteRunLearningSchema = Type.Object(
  { learning_id: Type.String({ description: "ID of the learning to delete." }) },
  { additionalProperties: false },
);

function isCategory(value: unknown): value is CronLearningCategory {
  return (CRON_LEARNING_CATEGORIES as readonly unknown[]).includes(value);
}

/** Creates the learning tools for a scheduled run; other sessions get none. */
export function createCronLearningTools(opts: {
  runSessionKey?: string;
  env?: NodeJS.ProcessEnv;
}): AnyAgentTool[] {
  const scope = resolveCronRunScope(opts.runSessionKey);
  if (!scope) {
    return [];
  }
  const saveTool: AnyAgentTool = {
    label: "Save run learning",
    name: SAVE_RUN_LEARNING_TOOL_NAME,
    displaySummary: "Save a lesson for later runs of this schedule.",
    description:
      "Save a lesson learned during this scheduled run. This learning will be shown to future runs " +
      "of this same schedule, helping avoid repeated mistakes and refine methods. Use this when you " +
      "discover something unexpected about the environment, a command that works differently than " +
      "expected, a recovery strategy that succeeded, or a more efficient approach.",
    parameters: SaveRunLearningSchema,
    execute: async (_toolCallId, args) => {
      const content = isRecord(args) && typeof args.content === "string" ? args.content : "";
      const category = isRecord(args) && isCategory(args.category) ? args.category : null;
      try {
        const learning = await saveCronLearning({
          jobId: scope.jobId,
          runId: scope.runId,
          content,
          category,
          env: opts.env,
        });
        return jsonResult({ success: true, learningId: learning.id });
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
  const deleteTool: AnyAgentTool = {
    label: "Delete run learning",
    name: DELETE_RUN_LEARNING_TOOL_NAME,
    displaySummary: "Delete a stale lesson of this schedule.",
    description:
      "Delete a stale or incorrect learning from this schedule. Use when you discover a previously " +
      "saved learning is wrong or no longer applicable.",
    parameters: DeleteRunLearningSchema,
    execute: async (_toolCallId, args) => {
      const learningId =
        isRecord(args) && typeof args.learning_id === "string" ? args.learning_id : "";
      const success = await deleteCronLearning({
        jobId: scope.jobId,
        learningId,
        env: opts.env,
      });
      return jsonResult(success ? { success: true } : { error: "Learning not found." });
    },
  };
  return [saveTool, deleteTool];
}
