// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/evals/src/scorers/llm/
// faithfulness/index.ts, hallucination/index.ts, answer-relevancy/index.ts, toxicity/index.ts and
// tool-call-accuracy/index.ts. The judge is Branch's QA judge lane (see judge.ts), not an AI SDK model.
import { z } from "zod";
import {
  createExtractPrompt,
  createReasonPrompt as createAnswerRelevancyReasonPrompt,
  createScorePrompt,
} from "./llm/answer-relevancy-prompts.js";
import {
  createFaithfulnessAnalyzePrompt,
  createFaithfulnessExtractPrompt,
  createFaithfulnessReasonPrompt,
  FAITHFULNESS_AGENT_INSTRUCTIONS,
} from "./llm/faithfulness-prompts.js";
import {
  createHallucinationAnalyzePrompt,
  createHallucinationExtractPrompt,
  createHallucinationReasonPrompt,
  HALLUCINATION_AGENT_INSTRUCTIONS,
} from "./llm/hallucination-prompts.js";
import {
  createAnalyzePrompt as createToolAnalyzePrompt,
  createReasonPrompt as createToolReasonPrompt,
  TOOL_SELECTION_ACCURACY_INSTRUCTIONS,
} from "./llm/tool-call-accuracy-prompts.js";
import {
  createToxicityAnalyzePrompt,
  createToxicityReasonPrompt,
  TOXICITY_AGENT_INSTRUCTIONS,
} from "./llm/toxicity-prompts.js";
import { createScorer, type ResolvedScorerRun, type ScorerJudgeModel } from "./scorer.js";
import {
  extractToolCalls,
  getAssistantMessageFromRunOutput,
  getUserMessageFromRunInput,
  roundToTwoDecimals,
  type AgentScorerRun,
  type ScorerRunOutputForAgent,
} from "./scorer-utils.js";

type AgentRunInput = AgentScorerRun["input"];
type AgentRun = ResolvedScorerRun<AgentRunInput, ScorerRunOutputForAgent>;

const getToolInvocationContext = (output: unknown): string[] => {
  if (!Array.isArray(output)) {
    return [];
  }
  return output
    .filter((message: { role?: unknown }) => message?.role === "assistant")
    .flatMap(
      (message: { content?: { toolInvocations?: Array<{ state?: unknown; result?: unknown }> } }) =>
        message?.content?.toolInvocations ?? [],
    )
    .filter((toolCall) => toolCall.state === "result")
    .map((toolCall) => JSON.stringify(toolCall.result));
};

export type FaithfulnessMetricOptions = {
  scale?: number;
  context?: string[];
};

export function createFaithfulnessScorer(params: {
  model: ScorerJudgeModel;
  options?: FaithfulnessMetricOptions;
}) {
  const { model, options } = params;
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>({
    id: "faithfulness-scorer",
    name: "Faithfulness Scorer",
    description: "A scorer that evaluates the faithfulness of an LLM output to an input",
    judge: { model, instructions: FAITHFULNESS_AGENT_INSTRUCTIONS },
  })
    .preprocess({
      description: "Extract relevant statements from the LLM output",
      outputSchema: z.object({ claims: z.array(z.string()) }),
      createPrompt: ({ run }) =>
        createFaithfulnessExtractPrompt({ output: getAssistantMessageFromRunOutput(run.output) ?? "" }),
    })
    .analyze({
      description: "Score the relevance of the statements to the input",
      outputSchema: z.object({
        verdicts: z.array(z.object({ verdict: z.string(), reason: z.string() })),
      }),
      createPrompt: ({ results, run }) =>
        createFaithfulnessAnalyzePrompt({
          claims: results.preprocessStepResult.claims || [],
          // The provided context, or the tool results the run produced.
          context: options?.context ?? getToolInvocationContext(run.output),
        }),
    })
    .generateScore(({ results }) => {
      const verdicts = results.analyzeStepResult.verdicts;
      // Score against the extracted claims so omitted verdicts stay in the denominator.
      const totalClaims = results.preprocessStepResult.claims?.length || verdicts.length;
      const supportedClaims = verdicts.filter(
        (verdict) => verdict.verdict.toLowerCase().trim() === "yes",
      ).length;
      if (totalClaims === 0) {
        return 0;
      }
      return roundToTwoDecimals(Math.min(1, supportedClaims / totalClaims) * (options?.scale || 1));
    })
    .generateReason({
      description: "Reason about the results",
      createPrompt: ({ run, results, score }) =>
        createFaithfulnessReasonPrompt({
          input: getUserMessageFromRunInput(run.input) ?? "",
          output: getAssistantMessageFromRunOutput(run.output) ?? "",
          context: options?.context ?? getToolInvocationContext(run.output),
          score,
          scale: options?.scale || 1,
          verdicts: results.analyzeStepResult.verdicts || [],
        }),
    });
}

export type GetContextParams = {
  run: AgentRun;
  results: Record<string, unknown>;
  score?: number;
  step: "analyze" | "generateReason";
};

export type GetContextFn = (params: GetContextParams) => string[] | Promise<string[]>;

export type HallucinationMetricOptions = {
  scale?: number;
  context?: string[];
  getContext?: GetContextFn;
};

export function createHallucinationScorer(params: {
  model: ScorerJudgeModel;
  options?: HallucinationMetricOptions;
}) {
  const { model, options } = params;
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>({
    id: "hallucination-scorer",
    name: "Hallucination Scorer",
    description: "A scorer that evaluates the hallucination of an LLM output to an input",
    judge: { model, instructions: HALLUCINATION_AGENT_INSTRUCTIONS },
  })
    .preprocess({
      description: "Extract all claims from the given output",
      outputSchema: z.object({ claims: z.array(z.string()) }),
      createPrompt: ({ run }) =>
        createHallucinationExtractPrompt({ output: getAssistantMessageFromRunOutput(run.output) ?? "" }),
    })
    .analyze({
      description: "Score the relevance of the statements to the input",
      outputSchema: z.object({
        verdicts: z.array(
          z.object({ statement: z.string(), verdict: z.string(), reason: z.string() }),
        ),
      }),
      createPrompt: async ({ run, results }) => {
        const context = options?.getContext
          ? await options.getContext({ run, results, step: "analyze" })
          : (options?.context ?? []);
        return createHallucinationAnalyzePrompt({
          claims: results.preprocessStepResult.claims,
          context,
        });
      },
    })
    .generateScore(({ results }) => {
      const verdicts = results.analyzeStepResult.verdicts;
      const totalStatements = results.preprocessStepResult.claims?.length || verdicts.length;
      const contradicted = verdicts.filter(
        (verdict) => verdict.verdict.toLowerCase().trim() === "yes",
      ).length;
      if (totalStatements === 0) {
        return 0;
      }
      return roundToTwoDecimals(Math.min(1, contradicted / totalStatements) * (options?.scale || 1));
    })
    .generateReason({
      description: "Reason about the results",
      createPrompt: async ({ run, results, score }) => {
        const context = options?.getContext
          ? await options.getContext({ run, results, score, step: "generateReason" })
          : (options?.context ?? []);
        return createHallucinationReasonPrompt({
          input: getUserMessageFromRunInput(run.input) ?? "",
          output: getAssistantMessageFromRunOutput(run.output) ?? "",
          context,
          score,
          scale: options?.scale || 1,
          verdicts: results.analyzeStepResult.verdicts || [],
        });
      },
    });
}

export const ANSWER_RELEVANCY_DEFAULT_OPTIONS: Record<"uncertaintyWeight" | "scale", number> = {
  uncertaintyWeight: 0.3,
  scale: 1,
};

export const ANSWER_RELEVANCY_AGENT_INSTRUCTIONS = `
    You are a balanced and nuanced answer relevancy evaluator. Your job is to determine if LLM outputs are relevant to the input, including handling partially relevant or uncertain cases.

    Key Principles:
    1. Evaluate whether the output addresses what the input is asking for
    2. Consider both direct answers and related context
    3. Prioritize relevance to the input over correctness
    4. Recognize that responses can be partially relevant
    5. Empty inputs or error messages should always be marked as "no"
    6. Responses that discuss the type of information being asked show partial relevance
`;

export function createAnswerRelevancyScorer(params: {
  model: ScorerJudgeModel;
  options?: Record<"uncertaintyWeight" | "scale", number>;
}) {
  const { model, options = ANSWER_RELEVANCY_DEFAULT_OPTIONS } = params;
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>({
    id: "answer-relevancy-scorer",
    name: "Answer Relevancy Scorer",
    description: "A scorer that evaluates the relevancy of an LLM output to an input",
    judge: { model, instructions: ANSWER_RELEVANCY_AGENT_INSTRUCTIONS },
  })
    .preprocess({
      description: "Extract relevant statements from the LLM output",
      outputSchema: z.object({ statements: z.array(z.string()) }),
      createPrompt: ({ run }) => createExtractPrompt(getAssistantMessageFromRunOutput(run.output) ?? ""),
    })
    .analyze({
      description: "Score the relevance of the statements to the input",
      outputSchema: z.object({
        results: z.array(z.object({ result: z.string(), reason: z.string() })),
      }),
      createPrompt: ({ run, results }) =>
        createScorePrompt(
          JSON.stringify(getUserMessageFromRunInput(run.input) ?? ""),
          results.preprocessStepResult.statements || [],
        ),
    })
    .generateScore(({ results }) => {
      if (!results.analyzeStepResult || results.analyzeStepResult.results.length === 0) {
        return 0;
      }
      let relevancyCount = 0;
      for (const { result } of results.analyzeStepResult.results) {
        const verdict = result.trim().toLowerCase();
        if (verdict === "yes") {
          relevancyCount += 1;
        } else if (verdict === "unsure") {
          relevancyCount += options.uncertaintyWeight;
        }
      }
      const score = relevancyCount / results.analyzeStepResult.results.length;
      return roundToTwoDecimals(score * options.scale);
    })
    .generateReason({
      description: "Reason about the results",
      createPrompt: ({ run, results, score }) =>
        createAnswerRelevancyReasonPrompt({
          input: getUserMessageFromRunInput(run.input) ?? "",
          output: getAssistantMessageFromRunOutput(run.output) ?? "",
          score,
          results: results.analyzeStepResult.results,
          scale: options.scale,
        }),
    });
}

export type ToxicityMetricOptions = {
  scale?: number;
};

export function createToxicityScorer(params: {
  model: ScorerJudgeModel;
  options?: ToxicityMetricOptions;
}) {
  const { model, options } = params;
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>({
    id: "toxicity-scorer",
    name: "Toxicity Scorer",
    description: "A scorer that evaluates the toxicity of an LLM output to an input",
    judge: { model, instructions: TOXICITY_AGENT_INSTRUCTIONS },
  })
    .analyze({
      description: "Score the relevance of the statements to the input",
      outputSchema: z.object({
        verdicts: z.array(z.object({ verdict: z.string(), reason: z.string() })),
      }),
      createPrompt: ({ run }) =>
        createToxicityAnalyzePrompt({
          input: getUserMessageFromRunInput(run.input) ?? "",
          output: getAssistantMessageFromRunOutput(run.output) ?? "",
        }),
    })
    .generateScore(({ results }) => {
      const numberOfVerdicts = results.analyzeStepResult.verdicts.length || 0;
      if (numberOfVerdicts === 0) {
        return 1;
      }
      const toxicityCount = results.analyzeStepResult.verdicts.filter(
        ({ verdict }) => verdict.trim().toLowerCase() === "yes",
      ).length;
      return roundToTwoDecimals((toxicityCount / numberOfVerdicts) * (options?.scale || 1));
    })
    .generateReason({
      description: "Reason about the results",
      createPrompt: ({ results, score }) =>
        createToxicityReasonPrompt({
          score,
          toxics: results.analyzeStepResult.verdicts.map((verdict) => verdict.reason) || [],
        }),
    });
}

export type AvailableTool = { id: string; description?: string };

/** Tools the run could call: from the constructor, or recorded with the stored run. */
function resolveToolDefinitions(run: AgentRun, availableTools?: AvailableTool[]): string {
  const recorded = run.requestContext?.availableTools;
  const tools =
    availableTools ??
    (Array.isArray(recorded)
      ? recorded.flatMap((tool: { name?: unknown; description?: unknown }) =>
          typeof tool?.name === "string"
            ? [{ id: tool.name, description: typeof tool.description === "string" ? tool.description : "" }]
            : [],
        )
      : []);
  return tools.map((tool) => `${tool.id}: ${tool.description ?? ""}`).join("\n");
}

export function createToolCallAccuracyScorerLLM(params: {
  model: ScorerJudgeModel;
  availableTools?: AvailableTool[];
}) {
  const { model, availableTools } = params;
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>({
    id: "llm-tool-call-accuracy-scorer",
    name: "Tool Call Accuracy (LLM)",
    description:
      "Evaluates whether an agent selected appropriate tools for the given task using LLM analysis",
    judge: { model, instructions: TOOL_SELECTION_ACCURACY_INSTRUCTIONS },
  })
    .preprocess(({ run }) => {
      const isInputInvalid =
        !run.input || !run.input.inputMessages || run.input.inputMessages.length === 0;
      const isOutputInvalid = !run.output || run.output.length === 0;
      if (isInputInvalid || isOutputInvalid) {
        throw new Error("Input and output messages cannot be null or empty");
      }
      const { tools: actualTools, toolCallInfos } = extractToolCalls(run.output);
      return { actualTools, hasToolCalls: actualTools.length > 0, toolCallInfos };
    })
    .analyze({
      description: "Analyze the appropriateness of tool selections",
      outputSchema: z.object({
        evaluations: z.array(
          z.object({ toolCalled: z.string(), wasAppropriate: z.boolean(), reasoning: z.string() }),
        ),
        missingTools: z.array(z.string()).optional(),
      }),
      createPrompt: ({ run, results }) =>
        createToolAnalyzePrompt({
          userInput: getUserMessageFromRunInput(run.input) ?? "",
          agentResponse: getAssistantMessageFromRunOutput(run.output) ?? "",
          toolsCalled: results.preprocessStepResult.actualTools || [],
          availableTools: resolveToolDefinitions(run, availableTools),
        }),
    })
    .generateScore(({ results }) => {
      const evaluations = results.analyzeStepResult.evaluations || [];
      if (evaluations.length === 0) {
        const missingTools = results.analyzeStepResult.missingTools || [];
        return missingTools.length > 0 ? 0.0 : 1.0;
      }
      const appropriate = evaluations.filter((evaluation) => evaluation.wasAppropriate).length;
      return roundToTwoDecimals(appropriate / evaluations.length);
    })
    .generateReason({
      description: "Generate human-readable explanation of tool selection evaluation",
      createPrompt: ({ run, results, score }) =>
        createToolReasonPrompt({
          userInput: getUserMessageFromRunInput(run.input) ?? "",
          score,
          evaluations: results.analyzeStepResult.evaluations || [],
          missingTools: results.analyzeStepResult.missingTools || [],
        }),
    });
}
