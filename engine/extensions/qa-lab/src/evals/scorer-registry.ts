// Registry of the scorers `branch qa score` can run, keyed by `--scorer <name>[=<arg>]`.
import { checks } from "./checks.js";
import { createCompletenessScorer, createContentSimilarityScorer } from "./code-scorers.js";
import { createCodingEfficiencyScorer, createCodingOutcomeScorer } from "./coding-scorers.js";
import {
  createAnswerRelevancyScorer,
  createFaithfulnessScorer,
  createHallucinationScorer,
  createToolCallAccuracyScorerLLM,
  createToxicityScorer,
} from "./llm-scorers.js";
import type { AnyBranchScorer, ScorerJudgeModel } from "./scorer.js";
import {
  extractToolResults,
  type AgentScorerRun,
  type ScorerRunOutputForAgent,
} from "./scorer-utils.js";
import { createTaskCompletionScorer } from "./task-completion.js";
import { createToolCallAccuracyScorerCode } from "./tool-call-accuracy.js";

export type QaAgentScorer = AnyBranchScorer<AgentScorerRun["input"], ScorerRunOutputForAgent>;

export type QaScorerContext = {
  judge?: ScorerJudgeModel;
};

type QaScorerDefinition = {
  name: string;
  description: string;
  argument: "required" | "optional" | "none";
  needsJudge?: boolean;
  create: (arg: string | undefined, context: QaScorerContext) => QaAgentScorer;
};

export type QaScorerSpec = {
  /** The spec as written on the command line, e.g. `called-tool=search:2`. */
  spec: string;
  name: string;
  arg?: string;
};

export type QaResolvedScorer = QaScorerSpec & { scorer: QaAgentScorer };

function requireArg(name: string, arg: string | undefined): string {
  if (arg === undefined || arg.trim() === "") {
    throw new Error(`--scorer ${name} needs a value, e.g. --scorer ${name}=<value>.`);
  }
  return arg;
}

function parseNonNegativeInteger(name: string, value: string): number {
  if (!/^\d+$/u.test(value.trim())) {
    throw new Error(`--scorer ${name} needs a whole number, got "${value}".`);
  }
  return Number.parseInt(value, 10);
}

function parseList(arg: string): string[] {
  return arg
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRegex(arg: string): RegExp {
  const literal = /^\/(.*)\/([dgimsuvy]*)$/su.exec(arg);
  return literal ? new RegExp(literal[1] ?? "", literal[2]) : new RegExp(arg);
}

function requireJudge(name: string, context: QaScorerContext): ScorerJudgeModel {
  if (!context.judge) {
    throw new Error(`--scorer ${name} uses an LLM judge; pass --judge-model <provider/model>.`);
  }
  return context.judge;
}

function toolCallAccuracy(arg: string, strictMode: boolean) {
  const tools = parseList(arg);
  return tools.length > 1
    ? createToolCallAccuracyScorerCode({ expectedToolOrder: tools, strictMode })
    : createToolCallAccuracyScorerCode({ expectedTool: tools[0] ?? arg, strictMode });
}

const DEFINITIONS: QaScorerDefinition[] = [
  {
    name: "includes",
    description: "Assistant output contains the text (case-insensitive)",
    argument: "required",
    create: (arg) => checks.includes(requireArg("includes", arg)),
  },
  {
    name: "excludes",
    description: "Assistant output does not contain the text",
    argument: "required",
    create: (arg) => checks.excludes(requireArg("excludes", arg)),
  },
  {
    name: "equals",
    description: "Assistant output equals the text (case-insensitive)",
    argument: "required",
    create: (arg) => checks.equals(requireArg("equals", arg)),
  },
  {
    name: "matches",
    description: "Assistant output matches the regex (/pattern/flags or a bare pattern)",
    argument: "required",
    create: (arg) => checks.matches(parseRegex(requireArg("matches", arg))),
  },
  {
    name: "similarity",
    description: "String similarity (0-1) of the assistant output to the text",
    argument: "required",
    create: (arg) => checks.similarity(requireArg("similarity", arg)),
  },
  {
    name: "called-tool",
    description: "The tool was called (name or name:times)",
    argument: "required",
    create: (arg) => {
      const value = requireArg("called-tool", arg);
      const timed = /^(.*):(\d+)$/u.exec(value);
      return timed
        ? checks.calledTool(timed[1] ?? value, {
            times: parseNonNegativeInteger("called-tool", timed[2] ?? "1"),
          })
        : checks.calledTool(value);
    },
  },
  {
    name: "did-not-call",
    description: "The tool was not called",
    argument: "required",
    create: (arg) => checks.didNotCall(requireArg("did-not-call", arg)),
  },
  {
    name: "tool-order",
    description: "Tools were called in this order (comma-separated, others may sit between)",
    argument: "required",
    create: (arg) => checks.toolOrder(parseList(requireArg("tool-order", arg))),
  },
  {
    name: "max-tool-calls",
    description: "No more than N tool calls",
    argument: "required",
    create: (arg) =>
      checks.maxToolCalls(parseNonNegativeInteger("max-tool-calls", requireArg("max-tool-calls", arg))),
  },
  {
    name: "used-no-tools",
    description: "No tool calls at all",
    argument: "none",
    create: () => checks.usedNoTools(),
  },
  {
    name: "no-tool-errors",
    description: "No tool call failed or was left unfinished",
    argument: "none",
    create: () => checks.noToolErrors(),
  },
  {
    name: "content-similarity",
    description: "Similarity between the user input and the assistant output",
    argument: "none",
    create: () => createContentSimilarityScorer(),
  },
  {
    name: "completeness",
    description: "How many input terms the output still covers",
    argument: "none",
    create: () => createCompletenessScorer(),
  },
  {
    name: "tool-call-accuracy",
    description: "Expected tool was selected (one name) or tools came in order (comma list)",
    argument: "required",
    create: (arg) => toolCallAccuracy(requireArg("tool-call-accuracy", arg), false),
  },
  {
    name: "tool-call-accuracy-strict",
    description: "Only the expected tool was called, or exactly this tool sequence",
    argument: "required",
    create: (arg) => toolCallAccuracy(requireArg("tool-call-accuracy-strict", arg), true),
  },
  {
    name: "coding-outcome",
    description: "Coding session outcome: build/tests, tool errors, loops, regressions, autonomy",
    argument: "none",
    create: () => createCodingOutcomeScorer(),
  },
  {
    name: "coding-efficiency",
    description: "Coding session efficiency: redundancy, turns, retries, read-before-edit",
    argument: "none",
    create: () => createCodingEfficiencyScorer(),
  },
  {
    name: "faithfulness",
    description: "LLM judge: share of output claims supported by the run's tool results",
    argument: "none",
    needsJudge: true,
    create: (_arg, context) => createFaithfulnessScorer({ model: requireJudge("faithfulness", context) }),
  },
  {
    name: "hallucination",
    description: "LLM judge: share of output claims that contradict the run's tool results",
    argument: "none",
    needsJudge: true,
    create: (_arg, context) =>
      createHallucinationScorer({
        model: requireJudge("hallucination", context),
        options: {
          getContext: ({ run }) =>
            extractToolResults(run.output).map((tool) =>
              JSON.stringify({ tool: tool.toolName, result: tool.result }),
            ),
        },
      }),
  },
  {
    name: "answer-relevancy",
    description: "LLM judge: how relevant the answer is to the user's request",
    argument: "none",
    needsJudge: true,
    create: (_arg, context) =>
      createAnswerRelevancyScorer({ model: requireJudge("answer-relevancy", context) }),
  },
  {
    name: "toxicity",
    description: "LLM judge: share of toxic verdicts in the answer",
    argument: "none",
    needsJudge: true,
    create: (_arg, context) => createToxicityScorer({ model: requireJudge("toxicity", context) }),
  },
  {
    name: "task-completion",
    description: "LLM judge: is the user's task complete given the conversation and tool results",
    argument: "none",
    needsJudge: true,
    create: (_arg, context) =>
      createTaskCompletionScorer({ model: requireJudge("task-completion", context) }),
  },
  {
    name: "llm-tool-call-accuracy",
    description: "LLM judge: were the tool choices appropriate for the request",
    argument: "none",
    needsJudge: true,
    create: (_arg, context) =>
      createToolCallAccuracyScorerLLM({ model: requireJudge("llm-tool-call-accuracy", context) }),
  },
];

export function listQaScorers(): Array<Pick<QaScorerDefinition, "name" | "description" | "argument" | "needsJudge">> {
  return DEFINITIONS.map(({ name, description, argument, needsJudge }) => ({
    name,
    description,
    argument,
    ...(needsJudge ? { needsJudge } : {}),
  }));
}

export function parseQaScorerSpec(spec: string): QaScorerSpec {
  const trimmed = spec.trim();
  const separator = trimmed.indexOf("=");
  const name = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
  const arg = separator === -1 ? undefined : trimmed.slice(separator + 1);
  if (!name) {
    throw new Error("--scorer must name a scorer.");
  }
  return { spec: trimmed, name, ...(arg !== undefined ? { arg } : {}) };
}

export function qaScorerNeedsJudge(spec: QaScorerSpec): boolean {
  return DEFINITIONS.find((definition) => definition.name === spec.name)?.needsJudge === true;
}

export function resolveQaScorers(specs: readonly string[], context: QaScorerContext): QaResolvedScorer[] {
  return specs.map((raw) => {
    const spec = parseQaScorerSpec(raw);
    const definition = DEFINITIONS.find((entry) => entry.name === spec.name);
    if (!definition) {
      const known = DEFINITIONS.map((entry) => entry.name).join(", ");
      throw new Error(`Unknown scorer "${spec.name}". Known scorers: ${known}.`);
    }
    if (definition.argument === "none" && spec.arg !== undefined) {
      throw new Error(`--scorer ${spec.name} takes no value.`);
    }
    if (definition.needsJudge) {
      requireJudge(spec.name, context);
    }
    return { ...spec, scorer: definition.create(spec.arg, context) };
  });
}
