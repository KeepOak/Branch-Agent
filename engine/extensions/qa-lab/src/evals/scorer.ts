// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/core/src/evals/base.ts
// and packages/core/src/evals/not-scorable.ts (staged scorer pipeline; judge calls use Branch's QA judge lane).
import { randomUUID } from "node:crypto";
import { z } from "zod";

export type ScorerStepName = "preprocess" | "analyze" | "generateScore" | "generateReason";

const SCORER_STEP_NAMES: readonly ScorerStepName[] = [
  "preprocess",
  "analyze",
  "generateScore",
  "generateReason",
];

const NOT_SCORABLE: unique symbol = Symbol.for("branch.evals.notScorable");

/** Value a function step returns to declare the run has nothing to evaluate. */
export type NotScorable = {
  readonly [NOT_SCORABLE]: true;
  readonly reason?: string;
};

/** How a not-scorable run surfaces on a scorer result. */
export type NotScorableOutcome = {
  step: ScorerStepName;
  reason?: string;
};

export function notScorable(reason?: string): NotScorable {
  return { [NOT_SCORABLE]: true, ...(reason !== undefined ? { reason } : {}) };
}

export function isNotScorable(value: unknown): value is NotScorable {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[NOT_SCORABLE] === true
  );
}

/** One judge call request. Branch routes it through the QA judge lane (see judge.ts). */
export type ScorerJudgeRequest = {
  step: ScorerStepName;
  instructions: string;
  prompt: string;
};

/** A judge model: Branch's replacement for Mastra's resolved language model. */
export type ScorerJudgeModel = {
  modelId: string;
  provider?: string;
  generate: (request: ScorerJudgeRequest) => Promise<string | null>;
};

export type ScorerJudgeConfig = {
  model: ScorerJudgeModel;
  instructions: string;
};

export type ScorerStepJudgeConfig = Partial<ScorerJudgeConfig>;

export type ScorerJudgeErrorSummary = {
  name?: string;
  message: string;
};

type ScorerJudgeExecutionBase = {
  prompt: string;
  judgeModelId: string;
  judgeProvider?: string;
  attemptCount: number;
  modelCallCount: number;
  durationMs: number;
  rawOutput?: string;
};

export type ScorerJudgeExecutionSuccess = ScorerJudgeExecutionBase & {
  status: "success";
  output: unknown;
};

export type ScorerJudgeExecutionFailure = ScorerJudgeExecutionBase & {
  status: "failed";
  output?: unknown;
  error: ScorerJudgeErrorSummary;
};

export type ScorerJudgeExecution = ScorerJudgeExecutionSuccess | ScorerJudgeExecutionFailure;

export type ScorerJudgeResults = Partial<
  Record<ScorerStepName, { executions: ScorerJudgeExecution[] }>
>;

/** Standard input for every scorer run. */
export type ScorerRun<TInput = unknown, TOutput = unknown> = {
  runId?: string;
  input?: TInput;
  output: TOutput;
  groundTruth?: unknown;
  expectedTrajectory?: unknown;
  requestContext?: Record<string, unknown>;
};

export type ResolvedScorerRun<TInput, TOutput> = ScorerRun<TInput, TOutput> & { runId: string };

type ResultsRecord = Record<string, unknown>;

export type StepContext<TResults extends ResultsRecord, TInput, TOutput> = {
  run: ResolvedScorerRun<TInput, TOutput>;
  results: TResults;
};

export type ReasonStepContext<TResults extends ResultsRecord, TInput, TOutput> = StepContext<
  TResults,
  TInput,
  TOutput
> & {
  score: TResults extends { generateScoreStepResult: infer S } ? S : number;
};

type FunctionStep<TContext, TOut> = (context: TContext) => TOut | Promise<TOut>;

/** Prompt object for preprocess/analyze: the judge must return JSON matching outputSchema. */
export type PromptObject<TOut, TContext> = {
  description: string;
  outputSchema: z.ZodType<TOut>;
  judge?: ScorerStepJudgeConfig;
  createPrompt: (context: TContext) => string | Promise<string>;
};

/** Prompt object for generateScore: the judge returns `{ "score": number }`. */
export type ScorePromptObject<TContext> = {
  description: string;
  judge?: ScorerStepJudgeConfig;
  createPrompt: (context: TContext) => string | Promise<string>;
};

/** Prompt object for generateReason: the judge returns free text. */
export type ReasonPromptObject<TContext> = ScorePromptObject<TContext>;

type StepDefinition = {
  name: ScorerStepName;
  run?: (context: Record<string, unknown>) => unknown;
  prompt?: {
    description: string;
    outputSchema?: z.ZodType<unknown>;
    judge?: ScorerStepJudgeConfig;
    createPrompt: (context: Record<string, unknown>) => string | Promise<string>;
  };
  description?: string;
};

type StepOutput<T> = Exclude<Awaited<T>, NotScorable>;

type WithStep<TResults extends ResultsRecord, K extends string, V> = TResults &
  Record<`${K}StepResult`, V>;

type PickResult<TResults, K extends string> = TResults extends Record<K, infer V> ? V : unknown;

export type ScorerRunResult<TResults extends ResultsRecord = ResultsRecord, TInput = unknown, TOutput = unknown> =
  ResolvedScorerRun<TInput, TOutput> & {
    score?: number;
    notScorable?: NotScorableOutcome;
    reason?: string;
    preprocessStepResult?: PickResult<TResults, "preprocessStepResult">;
    analyzeStepResult?: PickResult<TResults, "analyzeStepResult">;
    preprocessPrompt?: string;
    analyzePrompt?: string;
    generateScorePrompt?: string;
    generateReasonPrompt?: string;
    judge?: ScorerJudgeResults;
  };

export type ScorerConfig<TInput, TOutput> = {
  id: string;
  name?: string;
  description: string;
  judge?: ScorerJudgeConfig;
  /** Transform the run before the pipeline starts (strip unneeded data). */
  prepareRun?: (
    run: ScorerRun<TInput, TOutput>,
  ) => ScorerRun<TInput, TOutput> | Promise<ScorerRun<TInput, TOutput>>;
};

export class ScorerError extends Error {
  readonly id: string;
  readonly details: Record<string, string>;

  constructor(id: string, message: string, details: Record<string, string>, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ScorerError";
    this.id = id;
    this.details = details;
  }
}

/** Thrown when a scorer step fails; keeps whatever the completed steps produced. */
export class ScorerRunError<TResult extends ScorerRunResult = ScorerRunResult> extends ScorerError {
  readonly scorerId: string;
  readonly failedStep: ScorerStepName;
  readonly completedSteps: ScorerStepName[];
  declare readonly result: TResult | undefined;

  constructor(options: {
    scorerId: string;
    steps: ScorerStepName[];
    failedStep: ScorerStepName;
    completedSteps: ScorerStepName[];
    result?: TResult;
    cause: Error;
  }) {
    super(
      "BRANCH_SCORER_FAILED_TO_RUN_STEP_FAILED",
      `Scorer Run Failed: ${options.cause.message}`,
      {
        scorerId: options.scorerId,
        steps: options.steps.join(", "),
        failedStep: options.failedStep,
        completedSteps: options.completedSteps.join(", "),
      },
      options.cause,
    );
    this.name = "ScorerRunError";
    this.scorerId = options.scorerId;
    this.failedStep = options.failedStep;
    this.completedSteps = options.completedSteps;
    // Non-enumerable so serialising the error never leaks step outputs.
    Object.defineProperty(this, "result", {
      value: options.result,
      enumerable: false,
      writable: false,
    });
  }
}

type PipelineState = {
  results: Record<string, unknown>;
  prompts: Record<string, string>;
  judge: ScorerJudgeResults;
  notScorable?: NotScorableOutcome;
};

function toErrorSummary(error: unknown): ScorerJudgeErrorSummary {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Pull the first JSON value out of a judge reply (fenced, chatty, or bare). */
export function extractJudgeJson(reply: string): unknown {
  const trimmed = reply.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed);
  const candidates = [fenced?.[1]?.trim(), trimmed];
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next candidate
    }
  }
  throw new Error("judge reply did not contain valid JSON");
}

function describeSchema(schema: z.ZodType<unknown>): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema));
  } catch {
    return "a JSON object";
  }
}

const generateScoreSchema = z.object({ score: z.number() });

/** Staged scorer: preprocess -> analyze -> generateScore -> generateReason. */
export class BranchScorer<TInput = unknown, TOutput = unknown, TResults extends ResultsRecord = {}> {
  readonly config: ScorerConfig<TInput, TOutput>;
  private readonly steps: StepDefinition[];

  constructor(config: ScorerConfig<TInput, TOutput>, steps: StepDefinition[] = []) {
    if (!config.id) {
      throw new ScorerError(
        "BRANCH_SCORER_FAILED_TO_CREATE_MISSING_ID",
        "Scorers must have an ID field. Please provide an ID in the scorer config.",
        {},
      );
    }
    this.config = config;
    this.steps = steps;
  }

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name ?? this.config.id;
  }

  get description(): string {
    return this.config.description;
  }

  getSteps(): Array<{ name: ScorerStepName; type: "prompt" | "function"; description?: string }> {
    return this.steps.map((step) => ({
      name: step.name,
      type: step.prompt ? "prompt" : "function",
      ...(step.prompt?.description ?? step.description
        ? { description: step.prompt?.description ?? step.description }
        : {}),
    }));
  }

  preprocess<TOut>(
    step:
      | FunctionStep<StepContext<TResults, TInput, TOutput>, TOut>
      | PromptObject<TOut, StepContext<TResults, TInput, TOutput>>,
  ): BranchScorer<TInput, TOutput, WithStep<TResults, "preprocess", StepOutput<TOut>>> {
    return this.addStep("preprocess", step);
  }

  analyze<TOut>(
    step:
      | FunctionStep<StepContext<TResults, TInput, TOutput>, TOut>
      | PromptObject<TOut, StepContext<TResults, TInput, TOutput>>,
  ): BranchScorer<TInput, TOutput, WithStep<TResults, "analyze", StepOutput<TOut>>> {
    return this.addStep("analyze", step);
  }

  generateScore(
    step:
      | FunctionStep<StepContext<TResults, TInput, TOutput>, number | NotScorable>
      | ScorePromptObject<StepContext<TResults, TInput, TOutput>>,
  ): BranchScorer<TInput, TOutput, WithStep<TResults, "generateScore", number>> {
    return this.addStep("generateScore", step);
  }

  generateReason(
    step:
      | FunctionStep<ReasonStepContext<TResults, TInput, TOutput>, string | undefined>
      | ReasonPromptObject<ReasonStepContext<TResults, TInput, TOutput>>,
  ): BranchScorer<TInput, TOutput, WithStep<TResults, "generateReason", string>> {
    return this.addStep("generateReason", step);
  }

  private addStep<TNext extends ResultsRecord>(
    name: ScorerStepName,
    step: unknown,
  ): BranchScorer<TInput, TOutput, TNext> {
    const definition: StepDefinition = { name };
    if (typeof step === "function") {
      definition.run = step as (context: Record<string, unknown>) => unknown;
    } else if (isPromptObjectStep(step)) {
      definition.prompt = step;
    } else {
      throw new ScorerError(
        "BRANCH_SCORER_INVALID_STEP",
        `Step "${name}" must be a function or a prompt object`,
        { scorerId: this.id, step: name },
      );
    }
    return new BranchScorer<TInput, TOutput, TNext>(this.config, [...this.steps, definition]);
  }

  async run(
    input: ScorerRun<TInput, TOutput>,
  ): Promise<ScorerRunResult<TResults, TInput, TOutput>> {
    if (!this.steps.some((step) => step.name === "generateScore")) {
      throw new ScorerError(
        "BRANCH_SCORER_FAILED_TO_RUN_MISSING_GENERATE_SCORE",
        "Cannot execute pipeline without generateScore() step",
        { scorerId: this.id, steps: this.steps.map((step) => step.name).join(", ") },
      );
    }
    const prepared = this.config.prepareRun ? await this.config.prepareRun(input) : input;
    const run: ResolvedScorerRun<TInput, TOutput> = {
      ...prepared,
      runId: prepared.runId ?? randomUUID(),
    };
    const state: PipelineState = { results: {}, prompts: {}, judge: {} };
    const completedSteps: ScorerStepName[] = [];
    for (const step of this.steps) {
      try {
        const stepResult = await this.executeStep(step, run, state);
        if (isNotScorable(stepResult)) {
          state.notScorable = {
            step: step.name,
            ...(stepResult.reason !== undefined ? { reason: stepResult.reason } : {}),
          };
          break;
        }
        state.results[`${step.name}StepResult`] = stepResult;
        completedSteps.push(step.name);
      } catch (error) {
        throw new ScorerRunError<ScorerRunResult<TResults, TInput, TOutput>>({
          scorerId: this.id,
          steps: this.steps.map((entry) => entry.name),
          failedStep: step.name,
          completedSteps,
          result: hasResultFields(state) ? this.toResult(run, state) : undefined,
          cause: toError(error),
        });
      }
    }
    return this.toResult(run, state);
  }

  private async executeStep(
    step: StepDefinition,
    run: ResolvedScorerRun<TInput, TOutput>,
    state: PipelineState,
  ): Promise<unknown> {
    const context: Record<string, unknown> = { run, results: { ...state.results } };
    if (step.name === "generateReason") {
      context.score = state.results.generateScoreStepResult;
    }
    if (step.run) {
      return await step.run(context);
    }
    if (!step.prompt) {
      throw new Error(`Step "${step.name}" is not a prompt object`);
    }
    return await this.executePromptStep(step.name, step.prompt, context, state);
  }

  private async executePromptStep(
    stepName: ScorerStepName,
    promptStep: NonNullable<StepDefinition["prompt"]>,
    context: Record<string, unknown>,
    state: PipelineState,
  ): Promise<unknown> {
    const startedAt = performance.now();
    const prompt = await promptStep.createPrompt(context);
    state.prompts[`${stepName}Prompt`] = prompt;
    const model = promptStep.judge?.model ?? this.config.judge?.model;
    const instructions = promptStep.judge?.instructions ?? this.config.judge?.instructions;
    if (!model || !instructions) {
      throw new ScorerError(
        "BRANCH_SCORER_FAILED_TO_RUN_MISSING_MODEL_OR_INSTRUCTIONS",
        `Step "${stepName}" requires a model and instructions`,
        { scorerId: this.id, step: stepName },
      );
    }
    const schema =
      stepName === "generateScore"
        ? generateScoreSchema
        : stepName === "generateReason"
          ? undefined
          : promptStep.outputSchema;
    const judgePrompt = schema
      ? `${prompt}\n\nRespond with only a JSON object that matches this JSON schema:\n${describeSchema(schema)}`
      : prompt;
    const record = (execution: ScorerJudgeExecution) => {
      const existing = state.judge[stepName]?.executions ?? [];
      state.judge[stepName] = { executions: [...existing, execution] };
    };
    const base = {
      prompt,
      judgeModelId: model.modelId,
      ...(model.provider ? { judgeProvider: model.provider } : {}),
      attemptCount: 1,
    };
    let rawOutput: string | undefined;
    try {
      const reply = await model.generate({ step: stepName, instructions, prompt: judgePrompt });
      if (reply === null || reply === undefined) {
        throw new Error("judge did not return a reply");
      }
      rawOutput = reply;
      const output = schema ? schema.parse(extractJudgeJson(reply)) : reply.trim();
      const value =
        stepName === "generateScore" ? (output as z.infer<typeof generateScoreSchema>).score : output;
      record({
        ...base,
        status: "success",
        output: value,
        modelCallCount: 1,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return value;
    } catch (error) {
      record({
        ...base,
        status: "failed",
        modelCallCount: rawOutput === undefined ? 0 : 1,
        durationMs: Math.round(performance.now() - startedAt),
        ...(rawOutput !== undefined ? { rawOutput } : {}),
        error: toErrorSummary(error),
      });
      throw error;
    }
  }

  private toResult(
    run: ResolvedScorerRun<TInput, TOutput>,
    state: PipelineState,
  ):ScorerRunResult<TResults, TInput, TOutput> {
    const { results, prompts, judge, notScorable: notScorableOutcome } = state;
    const score = results.generateScoreStepResult;
    const result: Record<string, unknown> = { ...run };
    if (notScorableOutcome) {
      result.notScorable = notScorableOutcome;
    } else if (score !== undefined) {
      result.score = score;
    }
    const optional: Array<[string, unknown]> = [
      ["generateScorePrompt", prompts.generateScorePrompt],
      ["reason", results.generateReasonStepResult],
      ["generateReasonPrompt", prompts.generateReasonPrompt],
      ["preprocessStepResult", results.preprocessStepResult],
      ["preprocessPrompt", prompts.preprocessPrompt],
      ["analyzeStepResult", results.analyzeStepResult],
      ["analyzePrompt", prompts.analyzePrompt],
    ];
    for (const [key, value] of optional) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    if (Object.keys(judge).length > 0) {
      result.judge = judge;
    }
    return result as ScorerRunResult<TResults, TInput, TOutput>;
  }
}

function hasResultFields(state: PipelineState): boolean {
  return (
    Object.keys(state.results).length > 0 ||
    Object.keys(state.prompts).length > 0 ||
    Object.keys(state.judge).length > 0
  );
}

function isPromptObjectStep(step: unknown): step is NonNullable<StepDefinition["prompt"]> {
  return (
    typeof step === "object" &&
    step !== null &&
    "description" in step &&
    "createPrompt" in step &&
    typeof (step as { createPrompt: unknown }).createPrompt === "function"
  );
}

export function isScorerStepName(value: unknown): value is ScorerStepName {
  return SCORER_STEP_NAMES.includes(value as ScorerStepName);
}

/** Creates a scorer builder. Add a generateScore step before running it. */
export function createScorer<TInput = unknown, TOutput = unknown>(
  config: ScorerConfig<TInput, TOutput>,
): BranchScorer<TInput, TOutput, {}> {
  return new BranchScorer<TInput, TOutput, {}>({
    ...config,
    name: config.name ?? config.id,
  });
}

/** Any scorer regardless of its accumulated result types. */
export type AnyBranchScorer<TInput = unknown, TOutput = unknown> = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  run: (input: ScorerRun<TInput, TOutput>) => Promise<ScorerRunResult<ResultsRecord, TInput, TOutput>>;
};
