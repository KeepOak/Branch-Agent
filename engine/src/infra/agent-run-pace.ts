import { normalizeAgentPlanSteps } from "../channels/streaming.js";

/** Registration-owned history: never shared between runs or inferred by a model. */
export type AgentRunPaceHistory = {
  steps: string[];
  done: boolean[];
  startedAt: number;
  lastCompletionAt: number;
  observedSteps: number;
  intervals: number[];
};
export type AgentRunPace = {
  runId: string;
  completed: number;
  total: number;
  observedSteps: number;
  stepsPerMinute?: number;
  etaMinMs?: number;
  etaMaxMs?: number;
  reason?: "no-plan" | "collecting" | "overdue" | "plan-complete";
};

export function observeAgentRunPlan(
  previous: AgentRunPaceHistory | undefined,
  value: unknown,
  at: number,
): AgentRunPaceHistory | undefined {
  const plan = normalizeAgentPlanSteps(value);
  if (!plan || !Number.isFinite(at)) {
    return previous;
  }
  // Bound retained history and reject incomplete normalization rather than invent a total.
  if (!Array.isArray(value) || plan.length !== value.length || plan.length > 50) {
    return undefined;
  }
  const steps = plan.map((s) => s.step),
    done = plan.map((s) => s.status === "completed");
  if (
    !previous ||
    steps.length !== previous.steps.length ||
    steps.some((s, i) => s !== previous.steps[i]) ||
    done.some((d, i) => !d && previous.done[i]) ||
    at < previous.lastCompletionAt
  ) {
    return { steps, done, startedAt: at, lastCompletionAt: at, observedSteps: 0, intervals: [] };
  }
  const newlyDone = done.filter((d, i) => d && !previous.done[i]).length;
  if (!newlyDone) {
    return previous;
  }
  const duration = at - previous.lastCompletionAt;
  // A batch gives a rate, but not independent step-duration samples for a range.
  return {
    ...previous,
    done,
    lastCompletionAt: at,
    observedSteps: previous.observedSteps + newlyDone,
    intervals:
      newlyDone === 1 && duration > 0 ? [...previous.intervals, duration] : previous.intervals,
  };
}

export function projectAgentRunPace(
  runId: string,
  history: AgentRunPaceHistory | undefined,
  now: number,
): AgentRunPace {
  const base: AgentRunPace = {
    runId,
    completed: history?.done.filter(Boolean).length ?? 0,
    total: history?.steps.length ?? 0,
    observedSteps: history?.observedSteps ?? 0,
  };
  if (!history || !base.total) {
    return { ...base, reason: "no-plan" };
  }
  const elapsed = now - history.startedAt;
  if (elapsed > 0 && base.observedSteps) {
    base.stepsPerMinute = (base.observedSteps * 60000) / elapsed;
  }
  const remaining = base.total - base.completed;
  if (!remaining) {
    return { ...base, reason: "plan-complete" };
  }
  if (history.intervals.length < 3) {
    return { ...base, reason: "collecting" };
  }
  const low = Math.min(...history.intervals),
    high = Math.max(...history.intervals);
  const since = Math.max(0, now - history.lastCompletionAt);
  if (since > high) {
    return { ...base, reason: "overdue" };
  }
  // Empirical fastest/slowest observed step envelope, not a confidence interval or promise.
  return {
    ...base,
    etaMinMs: Math.max(0, remaining * low - since),
    etaMaxMs: Math.max(0, remaining * high - since),
  };
}
