import type { TSchema } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./tool-results.js";

const DESCRIPTION =
  "Record one numbered step in a reasoning chain and return the chain's state so far, including its branches and the number of steps recorded.";

const PARAMETERS = {
  type: "object",
  properties: {
    thought: {
      type: "string",
      description: "The text of this step. Must be a non-empty string.",
    },
    nextThoughtNeeded: {
      type: "boolean",
      description: "True when another step should follow, false when the chain is finished.",
    },
    thoughtNumber: {
      type: "integer",
      description: "Position of this step in the chain, counting from 1.",
      minimum: 1,
    },
    totalThoughts: {
      type: "integer",
      description: "Current estimate of how many steps the chain will take.",
      minimum: 1,
    },
    isRevision: {
      type: "boolean",
      description: "True when this step revises an earlier one. Accepted without changing the result.",
    },
    revisesThought: {
      type: "integer",
      description: "Position of the earlier step this one revises. Accepted without changing the result.",
      minimum: 1,
    },
    branchFromThought: {
      type: "integer",
      description: "Position of the step this branch starts from. Recorded together with branchId.",
      minimum: 1,
    },
    branchId: {
      type: "string",
      description: "Name of the branch this step belongs to. Recorded together with branchFromThought.",
    },
    needsMoreThoughts: {
      type: "boolean",
      description: "True when the estimate in totalThoughts should grow. Accepted without changing the result.",
    },
  },
  required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"],
} as TSchema;

type ThoughtArgs = {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  branchFromThought: unknown;
  branchId: unknown;
};

type ParseResult = { ok: true; args: ThoughtArgs } | { ok: false; error: string };

type SessionState = {
  historyLength: number;
  branches: Set<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsableNumber(value: unknown): value is number {
  return typeof value === "number" && value !== 0 && !Number.isNaN(value);
}

function reject(error: string): ParseResult {
  return { ok: false, error };
}

function parseThoughtArgs(input: unknown): ParseResult {
  const args: Record<string, unknown> = isRecord(input) ? input : {};
  const {
    thought,
    thoughtNumber,
    totalThoughts,
    nextThoughtNeeded,
    branchFromThought,
    branchId,
  } = args;
  if (typeof thought !== "string" || thought === "") {
    return reject("Invalid thought: must be a string");
  }
  if (!isUsableNumber(thoughtNumber)) {
    return reject("Invalid thoughtNumber: must be a number");
  }
  if (!isUsableNumber(totalThoughts)) {
    return reject("Invalid totalThoughts: must be a number");
  }
  if (typeof nextThoughtNeeded !== "boolean") {
    return reject("Invalid nextThoughtNeeded: must be a boolean");
  }
  return {
    ok: true,
    args: { thought, thoughtNumber, totalThoughts, nextThoughtNeeded, branchFromThought, branchId },
  };
}

function failureResult(error: string) {
  const body = { error, status: "failed" };
  return textResult(JSON.stringify(body, null, 2), { ...body, isError: true });
}

function recordStep(state: SessionState, args: ThoughtArgs) {
  state.historyLength += 1;
  if (args.branchFromThought && args.branchId) {
    state.branches.add(String(args.branchId));
  }
  const totalThoughts =
    args.thoughtNumber > args.totalThoughts ? args.thoughtNumber : args.totalThoughts;
  return jsonResult({
    thought: args.thought,
    thoughtNumber: args.thoughtNumber,
    totalThoughts,
    nextThoughtNeeded: args.nextThoughtNeeded,
    branches: [...state.branches],
    thoughtHistoryLength: state.historyLength,
  });
}

export function createSequentialThinkingTool(): AnyAgentTool {
  const state: SessionState = { historyLength: 0, branches: new Set<string>() };
  return {
    name: "sequentialthinking",
    label: "Sequential thinking",
    description: DESCRIPTION,
    parameters: PARAMETERS,
    async execute(_toolCallId, input) {
      const parsed = parseThoughtArgs(input);
      return parsed.ok ? recordStep(state, parsed.args) : failureResult(parsed.error);
    },
  };
}
