import { describe, expect, it } from "vitest";
import { HISTORY_STARTING_LABEL, isHistoryTemporarilyUnavailable, isPreparationPending } from "./preparation-status";

describe("isPreparationPending", () => {
  it("treats engine startup gates as preparation, so the window retries and says the Trunk is getting ready", () => {
    expect(isPreparationPending(new Error("models.list unavailable during gateway startup"))).toBe(true);
    expect(isPreparationPending(new Error("chat.send unavailable during gateway startup"))).toBe(true);
    expect(isPreparationPending("Model catalog is not ready yet; retry shortly")).toBe(true);
    expect(isPreparationPending(new Error("agent main has not completed startup inspection and preparation"))).toBe(true);
    expect(isPreparationPending(HISTORY_STARTING_LABEL)).toBe(true);
    expect(isPreparationPending(new Error("Session access facts are unavailable; retry after session storage is ready."))).toBe(true);
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

