import { describe, expect, it } from "vitest";
import {
  buildSystemAgentInferenceUnavailableErrorDetails,
  buildSystemAgentSessionInvalidatedErrorDetails,
  readSystemAgentInferenceUnavailableErrorDetails,
  readSystemAgentSessionInvalidatedErrorDetails,
  SystemAgentErrorDetailCodes,
} from "./system-agent-error-details.js";

describe("system-agent error details", () => {
  it("round-trips an inference unavailable marker", () => {
    const details = buildSystemAgentInferenceUnavailableErrorDetails();

    expect(details).toEqual({ code: "system_agent_inference_unavailable" });
    expect(readSystemAgentInferenceUnavailableErrorDetails(details)).toEqual(details);
  });

  it("round-trips a session invalidation marker", () => {
    const details = buildSystemAgentSessionInvalidatedErrorDetails();

    expect(details).toEqual({ code: "system_agent_session_invalidated" });
    expect(readSystemAgentSessionInvalidatedErrorDetails(details)).toEqual(details);
  });

  it.each([undefined, null, [], {}, { code: "other" }])(
    "rejects an unrelated details payload: %j",
    (details) => {
      expect(readSystemAgentSessionInvalidatedErrorDetails(details)).toBeUndefined();
    },
  );

  it("carries a known fix action and drops unknown ones", () => {
    const details = buildSystemAgentSessionInvalidatedErrorDetails("retry");
    expect(details).toEqual({ code: "system_agent_session_invalidated", action: "retry" });
    expect(readSystemAgentSessionInvalidatedErrorDetails(details)).toEqual(details);
    expect(
      readSystemAgentInferenceUnavailableErrorDetails(
        buildSystemAgentInferenceUnavailableErrorDetails("open-accounts"),
      ),
    ).toEqual({ code: "system_agent_inference_unavailable", action: "open-accounts" });
    expect(
      readSystemAgentInferenceUnavailableErrorDetails({
        code: "system_agent_inference_unavailable",
        action: "rm -rf",
      }),
    ).toEqual({ code: "system_agent_inference_unavailable" });
  });

  it("exports the stable marker", () => {
    expect(SystemAgentErrorDetailCodes.INFERENCE_UNAVAILABLE).toBe(
      "system_agent_inference_unavailable",
    );
    expect(SystemAgentErrorDetailCodes.SESSION_INVALIDATED).toBe(
      "system_agent_session_invalidated",
    );
  });
});
