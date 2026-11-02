import { describe, expect, it } from "vitest";
import { HISTORY_RETRY_TIMEOUT_MS, HISTORY_STARTING_LABEL, HISTORY_UNAVAILABLE_LABEL, isHistoryTemporarilyUnavailable, isPreparationPending, PreparationRetry } from "./preparation-status";
import { friendlyError } from "./friendly-error";

describe("isPreparationPending", () => {
  it("treats engine startup gates as preparation, so the window retries and says the Trunk is getting ready", () => {
    expect(isPreparationPending(new Error("models.list unavailable during gateway startup"))).toBe(true);
    expect(isPreparationPending(new Error("chat.send unavailable during gateway startup"))).toBe(true);
    expect(isPreparationPending("Model catalog is not ready yet; retry shortly")).toBe(true);
    expect(isPreparationPending(new Error("agent main has not completed startup inspection and preparation"))).toBe(true);
    expect(isPreparationPending(HISTORY_STARTING_LABEL)).toBe(true);
    expect(isPreparationPending(new Error("Session access facts are unavailable; retry after session storage is ready."))).toBe(true);
    expect(isPreparationPending(HISTORY_UNAVAILABLE_LABEL)).toBe(false);
  });

  it("leaves real failures as errors", () => {
    expect(isPreparationPending(new Error("PluginInstanceUnavailableError: Plugin openai was reloaded or disabled; use its current tools."))).toBe(false);
    expect(isPreparationPending(new Error("unknown method: models.lists"))).toBe(false);
    expect(isPreparationPending(new Error("model not found"))).toBe(false);
    expect(isPreparationPending(null)).toBe(false);
  });
});

describe("isHistoryTemporarilyUnavailable", () => {
  it("reads the engine's chat.history UNAVAILABLE and the session-storage words", () => {
    expect(isHistoryTemporarilyUnavailable(Object.assign(new Error("Session access facts are unavailable; retry after session storage is ready."), {
      code: "UNAVAILABLE", gatewayCode: "UNAVAILABLE", retryable: true, details: { method: "chat.history" },
    }))).toBe(true);
    expect(isHistoryTemporarilyUnavailable(new Error("Session access facts are unavailable; retry after session storage is ready."))).toBe(true);
    expect(isHistoryTemporarilyUnavailable(HISTORY_STARTING_LABEL)).toBe(true);
    expect(isHistoryTemporarilyUnavailable(HISTORY_UNAVAILABLE_LABEL)).toBe(false);
  });

  it("leaves a finished startup refusal and other failures alone", () => {
    expect(isHistoryTemporarilyUnavailable(Object.assign(new Error("Agent database inspection failed."), {
      code: "UNAVAILABLE", gatewayCode: "UNAVAILABLE", retryable: false, details: { code: "agent-database-inspection-failed" },
    }))).toBe(false);
    expect(isHistoryTemporarilyUnavailable(Object.assign(new Error("Agent main has not completed startup inspection and preparation."), {
      code: "UNAVAILABLE", gatewayCode: "UNAVAILABLE", retryable: true, details: { code: "agent-database-inspection-pending" },
    }))).toBe(false);
    expect(isHistoryTemporarilyUnavailable(new Error("permission denied"))).toBe(false);
  });
});

describe("history UNAVAILABLE retry cap", () => {
  it("gives up after about a minute and keeps a plain next step", () => {
    expect(HISTORY_RETRY_TIMEOUT_MS).toBe(60_000);
    expect(HISTORY_UNAVAILABLE_LABEL).toBe(friendlyError(HISTORY_UNAVAILABLE_LABEL));
    expect(HISTORY_UNAVAILABLE_LABEL).toMatch(/history/i);
    expect(HISTORY_UNAVAILABLE_LABEL).toBe("Branch couldn't load this chat's history. Restart Branch. If this keeps happening, reinstall it.");
    const retry = new PreparationRetry(HISTORY_RETRY_TIMEOUT_MS);
    const start = 1_000_000;
    expect(retry.nextDelay(start)).toBe(500);
    expect(retry.nextDelay(start + 59_000)).not.toBeNull();
    expect(retry.nextDelay(start + HISTORY_RETRY_TIMEOUT_MS)).toBeNull();
    expect(retry.nextDelay(start + 90_000)).toBeNull();
  });
});

