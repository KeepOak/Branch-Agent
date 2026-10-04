// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/evals/src/scorers/llm/
// faithfulness, hallucination, answer-relevancy, toxicity and tool-call-accuracy index.test.ts. Upstream
// replays recorded model traffic; here a scripted judge returns the verdicts, so the scoring math,
// context hooks and prompts are what is checked.
import { describe, expect, it, vi } from "vitest";
import {
  createAnswerRelevancyScorer,
  createFaithfulnessScorer,
  createHallucinationScorer,
  createToolCallAccuracyScorerLLM,
  createToxicityScorer,
  type GetContextFn,
  type GetContextParams,
} from "./llm-scorers.js";
import type { ScorerJudgeModel, ScorerJudgeRequest, ScorerStepName } from "./scorer.js";
import { createAgentTestRun, createTestMessage, createToolInvocation } from "./scorer-utils.js";

type Script = Partial<Record<ScorerStepName, unknown>>;

function scriptedJudge(script: Script) {
  const requests: ScorerJudgeRequest[] = [];
  const model: ScorerJudgeModel = {
    modelId: "judge",
    generate: async (request) => {
      requests.push(request);
      const reply = script[request.step];
      return typeof reply === "string" ? reply : JSON.stringify(reply ?? {});
    },
  };
  return { model, requests };
}

function run(input: string, output: string) {
  return createAgentTestRun({
    inputMessages: [createTestMessage({ role: "user", content: input, id: "test-input" })],
    output: [createTestMessage({ role: "assistant", content: output, id: "test-output" })],
  });
}

const verdicts = (...values: string[]) => ({
  verdicts: values.map((verdict, index) => ({ statement: `claim ${index}`, verdict, reason: `r${index}` })),
});

const companyContext = [
  "The company was founded in 1995 by John Smith.",
  "It has 500 employees and is headquartered in London.",
];

describe("createFaithfulnessScorer", () => {
  it.each([
    ["perfect faithfulness", ["c1", "c2", "c3", "c4"], ["yes", "yes", "yes", "yes"], 1],
    ["mixed faithfulness with contradictions", ["c1", "c2", "c3", "c4"], ["yes", "no", "no", "yes"], 0.5],
    ["claims with speculative language", ["c1", "c2", "c3"], ["yes", "unsure", "unsure"], 0.33],
    ["empty output", [], [], 0],
    ["verdicts the judge omitted", ["c1", "c2", "c3", "c4"], ["yes", "yes"], 0.5],
  ])("should handle %s", async (_label, claims, values, expected) => {
    const { model } = scriptedJudge({
      preprocess: { claims },
      analyze: verdicts(...values),
      generateReason: "reason",
    });
    const scorer = createFaithfulnessScorer({ model, options: { context: companyContext } });
    const result = await scorer.run(run("What can you tell me about the company?", "Founded in 1995."));
    expect(result.score).toBeCloseTo(expected, 2);
    expect(result.reason).toBe("reason");
  });

  it("uses the run's tool results as context when none is given", async () => {
    const { model, requests } = scriptedJudge({
      preprocess: { claims: ["It is 20C"] },
      analyze: verdicts("yes"),
      generateReason: "supported",
    });
    const scorer = createFaithfulnessScorer({ model });
    const result = await scorer.run(
      createAgentTestRun({
        inputMessages: [createTestMessage({ role: "user", content: "Weather?", id: "i1" })],
        output: [
          createTestMessage({
            role: "assistant",
            content: "It is 20C.",
            id: "o1",
            toolInvocations: [
              createToolInvocation({
                toolCallId: "c1",
                toolName: "weather",
                args: {},
                result: { temperature: "20C" },
                state: "result",
              }),
            ],
          }),
        ],
      }),
    );
    expect(result.score).toBe(1);
    expect(requests.find((request) => request.step === "analyze")?.prompt).toContain('"temperature":"20C"');
  });
});

describe("createHallucinationScorer", () => {
  const output = "The company was founded in 1995 by John Smith and has 500 employees in London.";
  const script = {
    preprocess: { claims: ["founded 1995", "500 employees", "London"] },
    analyze: verdicts("no", "no", "no"),
    generateReason: "aligned",
  };

  it.each([
    ["perfect alignment", ["no", "no", "no"], 0],
    ["complete hallucination", ["yes", "yes", "yes"], 1],
    ["partial hallucination", ["yes", "no", "no"], 0.33],
  ])("should handle %s", async (_label, values, expected) => {
    const { model } = scriptedJudge({ ...script, analyze: verdicts(...values) });
    const scorer = createHallucinationScorer({ model, options: { context: companyContext } });
    const result = await scorer.run(run("Tell me about the company", output));
    expect(result.score).toBeCloseTo(expected, 2);
  });

  it("should handle empty output", async () => {
    const { model } = scriptedJudge({ preprocess: { claims: [] }, analyze: { verdicts: [] } });
    const scorer = createHallucinationScorer({ model, options: { context: companyContext } });
    const result = await scorer.run(run("Tell me about the company", ""));
    expect(result.score).toBe(0);
  });

  describe("getContext hook", () => {
    it("should call getContext hook when provided", async () => {
      const getContextMock = vi.fn<GetContextFn>().mockReturnValue(companyContext);
      const { model } = scriptedJudge(script);
      const scorer = createHallucinationScorer({ model, options: { getContext: getContextMock } });
      await scorer.run(run("Tell me about the company", output));
      // Once in analyze and once in generateReason.
      expect(getContextMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(getContextMock.mock.calls.map(([params]) => params.step)).toEqual(["analyze", "generateReason"]);
    });

    it("should pass correct params to getContext", async () => {
      let capturedParams: GetContextParams | undefined;
      const getContext: GetContextFn = (params) => {
        capturedParams = params;
        return companyContext;
      };
      const { model } = scriptedJudge(script);
      const scorer = createHallucinationScorer({ model, options: { getContext } });
      await scorer.run(run("Tell me about the company", output));
      expect(capturedParams?.run.output).toBeDefined();
      expect(capturedParams?.results).toBeDefined();
      expect(capturedParams?.score).toBe(0);
    });

    it("should use getContext result over static context", async () => {
      const { model, requests } = scriptedJudge(script);
      const scorer = createHallucinationScorer({
        model,
        options: { context: companyContext, getContext: () => ["Dynamic context from hook"] },
      });
      await scorer.run(run("Tell me about the company", output));
      const analyzePrompt = requests.find((request) => request.step === "analyze")?.prompt ?? "";
      expect(analyzePrompt).toContain("Dynamic context from hook");
      expect(analyzePrompt).not.toContain("It has 500 employees and is headquartered in London.");
    });

    it("should fall back to static context and support async getContext", async () => {
      const { model, requests } = scriptedJudge(script);
      await createHallucinationScorer({ model, options: { context: companyContext } }).run(
        run("Tell me about the company", output),
      );
      expect(requests[1]?.prompt).toContain("headquartered in London");

      const asyncJudge = scriptedJudge(script);
      const result = await createHallucinationScorer({
        model: asyncJudge.model,
        options: { getContext: async () => companyContext },
      }).run(run("Tell me about the company", output));
      expect(result.score).toBe(0);
    });
  });
});

describe("createAnswerRelevancyScorer", () => {
  it("weights yes, unsure and no verdicts", async () => {
    const { model } = scriptedJudge({
      preprocess: { statements: ["a", "b", "c"] },
      analyze: {
        results: [
          { result: "yes", reason: "" },
          { result: "unsure", reason: "" },
          { result: "no", reason: "" },
        ],
      },
      generateReason: "partly relevant",
    });
    const result = await createAnswerRelevancyScorer({ model }).run(run("What is the capital?", "Paris."));
    expect(result.score).toBe(0.43);
    expect(result.reason).toBe("partly relevant");
  });

  it("scores 0 when nothing was analysed", async () => {
    const { model } = scriptedJudge({ preprocess: { statements: [] }, analyze: { results: [] } });
    const result = await createAnswerRelevancyScorer({ model }).run(run("What is the capital?", ""));
    expect(result.score).toBe(0);
  });
});

describe("createToxicityScorer", () => {
  it("scores the share of toxic verdicts", async () => {
    const { model, requests } = scriptedJudge({
      analyze: { verdicts: [{ verdict: "yes", reason: "insult" }, { verdict: "no", reason: "" }] },
      generateReason: "one insult",
    });
    const result = await createToxicityScorer({ model }).run(run("Review my code", "You are clueless."));
    expect(result.score).toBe(0.5);
    expect(requests.map((request) => request.step)).toEqual(["analyze", "generateReason"]);
  });

  it("scores 1 when the judge returns no verdicts, as upstream does", async () => {
    const { model } = scriptedJudge({ analyze: { verdicts: [] } });
    const result = await createToxicityScorer({ model }).run(run("Hi", "Hello!"));
    expect(result.score).toBe(1);
  });
});

describe("createToolCallAccuracyScorerLLM", () => {
  const toolRun = () =>
    createAgentTestRun({
      inputMessages: [createTestMessage({ role: "user", content: "Weather in Paris?", id: "i1" })],
      output: [
        createTestMessage({
          role: "assistant",
          content: "It is sunny.",
          id: "o1",
          toolInvocations: [
            createToolInvocation({ toolCallId: "c1", toolName: "weather", args: {}, result: {}, state: "result" }),
            createToolInvocation({ toolCallId: "c2", toolName: "search", args: {}, result: {}, state: "result" }),
          ],
        }),
      ],
    });

  it("scores the share of appropriate tool calls", async () => {
    const { model, requests } = scriptedJudge({
      analyze: {
        evaluations: [
          { toolCalled: "weather", wasAppropriate: true, reasoning: "asked for weather" },
          { toolCalled: "search", wasAppropriate: false, reasoning: "not needed" },
        ],
      },
      generateReason: "one extra tool",
    });
    const scorer = createToolCallAccuracyScorerLLM({
      model,
      availableTools: [{ id: "weather", description: "Get the weather" }],
    });
    const result = await scorer.run(toolRun());
    expect(result.score).toBe(0.5);
    expect(result.preprocessStepResult?.actualTools).toEqual(["weather", "search"]);
    expect(requests[0]?.prompt).toContain("weather: Get the weather");
    expect(requests[0]?.prompt).toContain("TOOLS THE AGENT ACTUALLY CALLED: weather, search");
  });

  it("reads tool definitions recorded with a stored run", async () => {
    const { model, requests } = scriptedJudge({ analyze: { evaluations: [], missingTools: [] } });
    const result = await createToolCallAccuracyScorerLLM({ model }).run({
      ...toolRun(),
      requestContext: { availableTools: [{ name: "read", description: "Read a file" }] },
    });
    expect(result.score).toBe(1);
    expect(requests[0]?.prompt).toContain("read: Read a file");
  });

  it("scores 0 when no tool was evaluated but tools were missing", async () => {
    const { model } = scriptedJudge({ analyze: { evaluations: [], missingTools: ["weather"] } });
    const result = await createToolCallAccuracyScorerLLM({ model, availableTools: [] }).run(toolRun());
    expect(result.score).toBe(0);
  });

  it("rejects runs without input or output", async () => {
    const { model } = scriptedJudge({});
    await expect(
      createToolCallAccuracyScorerLLM({ model }).run(createAgentTestRun({ output: [] })),
    ).rejects.toThrow("Input and output messages cannot be null or empty");
  });
});
