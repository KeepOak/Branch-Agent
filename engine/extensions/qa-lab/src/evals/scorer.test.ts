// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/core/src/evals/base.test.ts
// (step pipeline, prompt objects, mixed/async steps, run failures); judge calls use a stub model.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createScorer,
  extractJudgeJson,
  notScorable,
  ScorerError,
  ScorerRunError,
  type ScorerJudgeModel,
  type ScorerJudgeRequest,
} from "./scorer.js";

const scoringInput = {
  input: [{ role: "user", content: "test input" }],
  output: { role: "assistant", text: "test output" },
};

type Input = typeof scoringInput.input;
type Output = typeof scoringInput.output;

function createJudgeModel(responses: Array<string | Error>) {
  const requests: ScorerJudgeRequest[] = [];
  let callCount = 0;
  const model: ScorerJudgeModel = {
    modelId: "mock-model-id",
    provider: "mock-provider",
    generate: async (request) => {
      requests.push(request);
      const response = responses[callCount] ?? responses.at(-1) ?? "";
      callCount += 1;
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
  return { model, requests, getCallCount: () => callCount };
}

function base(judge?: ScorerJudgeModel) {
  return createScorer<Input, Output>({
    id: "test-scorer",
    description: "A test scorer",
    ...(judge ? { judge: { model: judge, instructions: "You are a judge." } } : {}),
  });
}

describe("createScorer", () => {
  describe("Steps as functions scorer", () => {
    it("should create a basic scorer with functions", async () => {
      const scorer = base().generateScore(({ run }) => (run.output.text.length > 0 ? 1 : 0));
      const { runId, ...result } = await scorer.run(scoringInput);
      expect(runId).toBeDefined();
      expect(result).not.toHaveProperty("judge");
      expect(result).toEqual({ ...scoringInput, score: 1 });
    });

    it("should create a scorer with preprocess, analyze, and reason", async () => {
      const scorer = base()
        .preprocess(({ run }) => ({ reformattedOutput: run.output.text.toUpperCase() }))
        .analyze(({ results }) => ({ length: results.preprocessStepResult.reformattedOutput.length }))
        .generateScore(({ results }) => (results.analyzeStepResult.length > 5 ? 1 : 0))
        .generateReason(({ score, results }) => `score ${score} for ${results.analyzeStepResult.length}`);
      const { runId, ...result } = await scorer.run(scoringInput);
      expect(runId).toBeDefined();
      expect(result).toEqual({
        ...scoringInput,
        score: 1,
        reason: "score 1 for 11",
        preprocessStepResult: { reformattedOutput: "TEST OUTPUT" },
        analyzeStepResult: { length: 11 },
      });
    });

    it("should create a scorer with analyze only and keep a provided runId", async () => {
      const scorer = base()
        .analyze(() => ({ status: true }))
        .generateScore(({ results }) => (results.analyzeStepResult.status ? 1 : 0));
      const result = await scorer.run({ ...scoringInput, runId: "fixed-run-id" });
      expect(result.runId).toBe("fixed-run-id");
      expect(result.analyzeStepResult).toEqual({ status: true });
      expect(result.preprocessStepResult).toBeUndefined();
    });

    it("applies prepareRun before the pipeline", async () => {
      const scorer = createScorer<Input, Output>({
        id: "prepared",
        description: "strips output",
        prepareRun: (run) => ({ ...run, output: { role: "assistant", text: "" } }),
      }).generateScore(({ run }) => (run.output.text.length > 0 ? 1 : 0));
      const result = await scorer.run(scoringInput);
      expect(result.score).toBe(0);
      expect(result.output.text).toBe("");
    });

    it("lists its steps", () => {
      const scorer = base()
        .preprocess(() => ({}))
        .generateScore({ description: "score it", createPrompt: () => "score" });
      expect(scorer.getSteps()).toEqual([
        { name: "preprocess", type: "function" },
        { name: "generateScore", type: "prompt", description: "score it" },
      ]);
      expect(scorer.name).toBe("test-scorer");
    });
  });

  describe("Steps as prompt objects scorer", () => {
    it("with all steps", async () => {
      const { model, requests } = createJudgeModel([
        JSON.stringify({ reformattedInput: "TEST INPUT", reformattedOutput: "TEST OUTPUT" }),
        "```json\n{\"inputLength\": 10, \"outputLength\": 11}\n```",
        "Here you go: {\"score\": 0.5}",
        "  The output is half right.  ",
      ]);
      const scorer = base(model)
        .preprocess({
          description: "Reformat",
          outputSchema: z.object({ reformattedInput: z.string(), reformattedOutput: z.string() }),
          createPrompt: () => "Test Preprocess prompt",
        })
        .analyze({
          description: "Analyze",
          outputSchema: z.object({ inputLength: z.number(), outputLength: z.number() }),
          createPrompt: ({ results }) => `Analyze ${results.preprocessStepResult.reformattedOutput}`,
        })
        .generateScore({ description: "Score", createPrompt: () => "Score prompt" })
        .generateReason({ description: "Reason", createPrompt: ({ score }) => `Reason for ${score}` });

      const { runId, ...result } = await scorer.run(scoringInput);

      expect(runId).toBeDefined();
      expect(result.score).toBe(0.5);
      expect(result.reason).toBe("The output is half right.");
      expect(result.analyzeStepResult).toEqual({ inputLength: 10, outputLength: 11 });
      expect(result.analyzePrompt).toBe("Analyze TEST OUTPUT");
      expect(result.generateReasonPrompt).toBe("Reason for 0.5");
      expect(Object.keys(result.judge ?? {})).toEqual([
        "preprocess",
        "analyze",
        "generateScore",
        "generateReason",
      ]);
      expect(result.judge?.preprocess?.executions[0]).toMatchObject({
        status: "success",
        prompt: "Test Preprocess prompt",
        output: { reformattedInput: "TEST INPUT", reformattedOutput: "TEST OUTPUT" },
        judgeModelId: "mock-model-id",
        judgeProvider: "mock-provider",
        attemptCount: 1,
        modelCallCount: 1,
        durationMs: expect.any(Number),
      });
      expect(JSON.parse(JSON.stringify(result.judge))).toEqual(result.judge);
      // The judge sees the scorer instructions and a JSON schema for structured steps.
      expect(requests[0]?.instructions).toBe("You are a judge.");
      expect(requests[0]?.prompt).toContain("Test Preprocess prompt");
      expect(requests[0]?.prompt).toContain("reformattedInput");
      expect(requests[3]?.prompt).toBe("Reason for 0.5");
    });

    it("lets a step judge override the scorer judge", async () => {
      const scorerJudge = createJudgeModel(['{"score": 0}']);
      const stepJudge = createJudgeModel(['{"score": 1}']);
      const scorer = base(scorerJudge.model).generateScore({
        description: "Score",
        judge: { model: stepJudge.model, instructions: "Step judge." },
        createPrompt: () => "score",
      });
      const result = await scorer.run(scoringInput);
      expect(result.score).toBe(1);
      expect(scorerJudge.getCallCount()).toBe(0);
      expect(stepJudge.requests[0]?.instructions).toBe("Step judge.");
    });

    it("fails a prompt step without a judge model", async () => {
      const scorer = base().generateScore({ description: "Score", createPrompt: () => "score" });
      const error = await scorer.run(scoringInput).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ScorerRunError);
      expect((error as ScorerRunError).message).toBe(
        'Scorer Run Failed: Step "generateScore" requires a model and instructions',
      );
    });

    it("fails the step when the judge reply does not match the schema", async () => {
      const { model } = createJudgeModel(['{"verdict": "yes"}']);
      const scorer = base(model).generateScore({ description: "Score", createPrompt: () => "score" });
      const error = (await scorer.run(scoringInput).catch((caught: unknown) => caught)) as ScorerRunError;
      expect(error.failedStep).toBe("generateScore");
      const execution = error.result?.judge?.generateScore?.executions[0];
      expect(execution).toMatchObject({ status: "failed", rawOutput: '{"verdict": "yes"}' });
    });
  });

  describe("Mixed and async scorer", () => {
    it("with preprocess function and analyze prompt object", async () => {
      const { model } = createJudgeModel(['{"summary": "ok"}']);
      const scorer = base(model)
        .preprocess(async ({ run }) => ({ text: run.output.text }))
        .analyze({
          description: "Summarize",
          outputSchema: z.object({ summary: z.string() }),
          createPrompt: async ({ results }) => `Summarize ${results.preprocessStepResult.text}`,
        })
        .generateScore(async ({ results }) => (results.analyzeStepResult.summary === "ok" ? 1 : 0));
      const result = await scorer.run(scoringInput);
      expect(result.score).toBe(1);
      expect(Object.keys(result.judge ?? {})).toEqual(["analyze"]);
      expect(result.judge?.analyze?.executions).toHaveLength(1);
    });
  });

  describe("Scorer run failures", () => {
    it("retains analyze output when score generation fails", async () => {
      const scorer = createScorer<Input, Output>({
        id: "analyze-result-failure-scorer",
        description: "Retains analyze output on score failure",
      })
        .analyze(() => ({ status: false, note: "" }))
        .generateScore(() => {
          throw new Error("score generation failed");
        });

      const error = await scorer
        .run({ ...scoringInput, runId: "failure-run-id" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ScorerRunError);
      const scorerError = error as ScorerRunError;
      expect(scorerError).toMatchObject({
        details: { failedStep: "generateScore", completedSteps: "analyze" },
        failedStep: "generateScore",
        completedSteps: ["analyze"],
      });
      expect(scorerError.message).toBe("Scorer Run Failed: score generation failed");
      expect(scorerError.cause).toBeDefined();
      expect(scorerError.result).toMatchObject({
        input: scoringInput.input,
        output: scoringInput.output,
        analyzeStepResult: { status: false, note: "" },
        runId: "failure-run-id",
      });
      expect(scorerError.result).not.toHaveProperty("score");
      expect(scorerError.result).not.toHaveProperty("judge");
      const serialized = JSON.stringify(scorerError);
      expect(serialized).not.toContain("analyzeStepResult");
      expect(JSON.parse(serialized)).not.toHaveProperty("result");
    });

    it("retains score zero and successful judge entries when reason generation fails", async () => {
      const { model } = createJudgeModel([
        JSON.stringify({ score: 0 }),
        new Error("reason provider failed"),
      ]);
      const scorer = base(model)
        .generateScore({ description: "score", createPrompt: () => "score this output" })
        .generateReason({ description: "reason", createPrompt: () => "explain this score" });

      const error = (await scorer.run(scoringInput).catch((caught: unknown) => caught)) as ScorerRunError;

      expect(error).toBeInstanceOf(ScorerRunError);
      expect(error.failedStep).toBe("generateReason");
      expect(error.completedSteps).toEqual(["generateScore"]);
      expect(error.result?.score).toBe(0);
      expect(error.result?.judge?.generateScore?.executions[0]?.status).toBe("success");
      expect(error.result?.judge?.generateReason?.executions[0]).toMatchObject({
        status: "failed",
        prompt: "explain this score",
        judgeModelId: "mock-model-id",
        judgeProvider: "mock-provider",
        attemptCount: 1,
        modelCallCount: 0,
        error: { message: "reason provider failed" },
      });
      expect(error.result?.judge?.generateReason?.executions[0]).not.toHaveProperty("output");
    });

    it("does not create a result when the first scorer step fails without output", async () => {
      const scorer = base().generateScore(() => {
        throw new Error("no score available");
      });
      const error = await scorer.run(scoringInput).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ScorerRunError);
      expect(error).toMatchObject({ failedStep: "generateScore", completedSteps: [], result: undefined });
    });

    it("refuses to run without a generateScore step", async () => {
      const scorer = base().preprocess(() => ({ ok: true }));
      await expect(scorer.run(scoringInput as never)).rejects.toThrow(
        "Cannot execute pipeline without generateScore() step",
      );
    });

    it("requires a scorer id", () => {
      expect(() => createScorer({ id: "", description: "no id" })).toThrow(ScorerError);
    });
  });

  describe("notScorable", () => {
    it("stops the pipeline, skips the judge, and carries no score", async () => {
      const { model, getCallCount } = createJudgeModel(['{"score": 1}']);
      const scorer = base(model)
        .preprocess(({ run }) =>
          run.output.text.includes("refund") ? { ok: true } : notScorable("no refund handled"),
        )
        .generateScore({ description: "score", createPrompt: () => "score" });
      const result = await scorer.run(scoringInput);
      expect(result.notScorable).toEqual({ step: "preprocess", reason: "no refund handled" });
      expect(result).not.toHaveProperty("score");
      expect(getCallCount()).toBe(0);
    });
  });
});

describe("extractJudgeJson", () => {
  it("reads bare, fenced, and chatty JSON replies", () => {
    expect(extractJudgeJson('{"score": 1}')).toEqual({ score: 1 });
    expect(extractJudgeJson('```json\n{"score": 0.4}\n```')).toEqual({ score: 0.4 });
    expect(extractJudgeJson('Sure! {"verdicts": [{"verdict": "yes"}]} Done.')).toEqual({
      verdicts: [{ verdict: "yes" }],
    });
    expect(() => extractJudgeJson("no json here")).toThrow("judge reply did not contain valid JSON");
  });
});
