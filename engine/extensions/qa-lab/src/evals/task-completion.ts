// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// plugins/plugin-assistant/src/features/advanced-capabilities/evaluators/task-completion.ts and the
// `success` evaluator in reflection-items.ts: after a run, a judge decides from the conversation and
// tool results whether the user's task is really complete.
import { z } from "zod";
import { createScorer, type ScorerJudgeModel } from "./scorer.js";
import {
  getTextContentFromMessage,
  mergeToolInvocations,
  type AgentScorerRun,
  type EvalMessage,
  type ScorerRunOutputForAgent,
} from "./scorer-utils.js";

export type TaskCompletionAssessment = {
  assessed: boolean;
  completed: boolean;
  reason: string;
  source: "reflection";
  evaluatedAt: number;
  messageId?: string;
};

export function getTaskCompletionCacheKey(messageId: string): string {
  return `reflection-task-completion:${messageId}`;
}

export function formatTaskCompletionStatus(
  assessment: TaskCompletionAssessment | null | undefined,
): string {
  if (!assessment) {
    return "No task completion reflection is available.";
  }
  return [
    "# Reflection Task Completion",
    `assessed: ${assessment.assessed ? "true" : "false"}`,
    `task_completed: ${assessment.completed ? "true" : "false"}`,
    `task_completion_reason: ${assessment.reason}`,
  ].join("\n");
}

export const SuccessOutputSchema = z.object({
  completed: z.boolean(),
  reason: z.string(),
  thought: z.string().optional(),
});

export type SuccessOutput = z.infer<typeof SuccessOutputSchema>;

export function normalizeTaskCompletion(
  task: SuccessOutput,
  messageId?: string,
  now: () => number = Date.now,
): TaskCompletionAssessment {
  const reason = task.reason.trim();
  return {
    assessed: true,
    completed: task.completed,
    reason: reason || (task.completed ? "The task is complete." : "The task is not complete yet."),
    source: "reflection",
    evaluatedAt: now(),
    ...(messageId ? { messageId } : {}),
  };
}

const TASK_COMPLETION_INSTRUCTIONS =
  "You evaluate whether an agent completed the user's task. Answer only from the conversation and action results.";

const MAX_RESULT_CHARS = 600;

/** Chronological index stored in stored-run message ids (`user-3`, `assistant-5`). */
function messageOrder(message: EvalMessage, fallback: number): number {
  const match = /-(\d+)$/u.exec(message.id);
  return match ? Number(match[1]) : fallback;
}

function renderRecentMessages(run: AgentScorerRun): string {
  const messages = [...run.input.inputMessages, ...run.output]
    .map((message, index) => ({ message, order: messageOrder(message, index) }))
    .toSorted((a, b) => a.order - b.order)
    .map(({ message }) => `${message.role}: ${getTextContentFromMessage(message) || "(no text)"}`);
  return `Recent messages:\n${messages.join("\n")}`;
}

function renderActionResults(output: ScorerRunOutputForAgent): string {
  const lines = output.flatMap((message) =>
    mergeToolInvocations(message).map((invocation) => {
      const failed =
        invocation.state === "output-error" || invocation.state === "error" || invocation.isError === true;
      const status = invocation.state === "call" ? "pending" : failed ? "failed" : "success";
      const raw = failed ? invocation.errorText : invocation.result;
      const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
      return `- ${invocation.toolName} (${status}): ${text.slice(0, MAX_RESULT_CHARS)}`;
    }),
  );
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

export function renderTaskCompletionPrompt(run: AgentScorerRun): string {
  const didRespond = run.output.some(
    (message) => message.role === "assistant" && getTextContentFromMessage(message).trim() !== "",
  );
  return `Evaluate if current user task is complete after agent response.

Rules:
- completed=true only if user needs no more action/follow-up this turn.
- Clarifying question, failed action, pending work, or partial handling -> completed=false.
- Ground the reason in the conversation and action results.

Did respond: ${didRespond ? "true" : "false"}

${renderRecentMessages(run)}

Action results:
${renderActionResults(run.output)}`;
}

/** Judge-backed task-completion scorer: 1 when the judge says the task is complete. */
export function createTaskCompletionScorer(params: { model: ScorerJudgeModel; now?: () => number }) {
  return createScorer<AgentScorerRun["input"], ScorerRunOutputForAgent>({
    id: "task-completion",
    name: "Task Completion",
    description: "Evaluates whether the user task is complete after the run.",
    judge: { model: params.model, instructions: TASK_COMPLETION_INSTRUCTIONS },
  })
    .analyze({
      description: "Decide whether the user's task is complete",
      outputSchema: SuccessOutputSchema,
      createPrompt: ({ run }) =>
        renderTaskCompletionPrompt({ input: run.input ?? emptyInput(), output: run.output }),
    })
    .generateScore(({ results }) => (results.analyzeStepResult.completed ? 1 : 0))
    .generateReason(({ run, results }) =>
      formatTaskCompletionStatus(
        normalizeTaskCompletion(results.analyzeStepResult, run.runId, params.now),
      ),
    );
}

function emptyInput(): AgentScorerRun["input"] {
  return { inputMessages: [], rememberedMessages: [], systemMessages: [], taggedSystemMessages: {} };
}
