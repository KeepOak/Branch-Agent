// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// plugins/plugin-assistant/src/features/advanced-capabilities/evaluators/__tests__/task-completion.test.ts,
// plus the judge-backed task-completion scorer over a stored run.
import { describe, expect, it } from "vitest";
import type { ScorerJudgeModel, ScorerJudgeRequest } from "./scorer.js";
import { createAgentTestRun, createTestMessage, createToolInvocation } from "./scorer-utils.js";
import {
  createTaskCompletionScorer,
  formatTaskCompletionStatus,
  getTaskCompletionCacheKey,
  type TaskCompletionAssessment,
} from "./task-completion.js";

const assessment: TaskCompletionAssessment = {
  assessed: true,
  completed: true,
  reason: "goal reached",
  source: "reflection",
  evaluatedAt: 123,
  messageId: "m1",
};

describe("getTaskCompletionCacheKey", () => {
  it("builds the namespaced key", () => {
    expect(getTaskCompletionCacheKey("m1")).toBe("reflection-task-completion:m1");
  });
});

describe("formatTaskCompletionStatus", () => {
  it("formats an assessment", () => {
    const out = formatTaskCompletionStatus(assessment);
    expect(out).toContain("# Reflection Task Completion");
    expect(out).toContain("assessed: true");
    expect(out).toContain("task_completed: true");
    expect(out).toContain("task_completion_reason: goal reached");
  });

  it("handles nullish input", () => {
    expect(formatTaskCompletionStatus(null)).toContain("No task completion reflection");
    expect(formatTaskCompletionStatus(undefined)).toContain("No task completion reflection");
  });
});

describe("createTaskCompletionScorer", () => {
  function judge(reply: string) {
    const requests: ScorerJudgeRequest[] = [];
    const model: ScorerJudgeModel = {
      modelId: "judge",
      generate: async (request) => {
        requests.push(request);
        return reply;
      },
    };
    return { model, requests };
  }

  const run = createAgentTestRun({
    runId: "run-1",
    inputMessages: [createTestMessage({ role: "user", content: "Save the report", id: "user-0" })],
    output: [
      createTestMessage({
        role: "assistant",
        content: "I tried to save it.",
        id: "assistant-1",
        parts: [
          { type: "text", text: "I tried to save it." },
          {
            type: "tool-invocation",
            toolInvocation: createToolInvocation({
              toolCallId: "c1",
              toolName: "write",
              args: { path: "report.md" },
              state: "output-error",
              errorText: "EACCES",
            }),
          },
        ],
      }),
    ],
  });

  it("scores 0 and reports the judge's reason when the task is not complete", async () => {
    const { model, requests } = judge('{"completed": false, "reason": "The write failed."}');
    const result = await createTaskCompletionScorer({ model, now: () => 7 }).run(run);
    expect(result.score).toBe(0);
    expect(result.reason).toBe(
      [
        "# Reflection Task Completion",
        "assessed: true",
        "task_completed: false",
        "task_completion_reason: The write failed.",
      ].join("\n"),
    );
    const prompt = requests[0]?.prompt ?? "";
    expect(prompt).toContain("Did respond: true");
    expect(prompt).toContain("user: Save the report\nassistant: I tried to save it.");
    expect(prompt).toContain("- write (failed): EACCES");
  });

  it("scores 1 when the judge says the task is complete, filling an empty reason", async () => {
    const { model } = judge('{"completed": true, "reason": "  "}');
    const result = await createTaskCompletionScorer({ model }).run(run);
    expect(result.score).toBe(1);
    expect(result.reason).toContain("task_completion_reason: The task is complete.");
  });
});
