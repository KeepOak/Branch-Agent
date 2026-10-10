import { describe, expect, it, vi } from "vitest";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  PreparedModelRuntimeOwnerNotPublishedError,
  PreparedModelRuntimePluginGenerationRetiredError,
  PreparedModelRuntimePublicationSupersededError,
} from "../../agents/prepared-model-runtime.errors.js";
import type { BranchConfig } from "../../config/types.branch.js";
import {
  attachErrorDiagnostic,
  formatErrorMessageForDisplay,
} from "../../infra/error-diagnostics.js";
import { SessionMutationAuthorizationChangedError } from "../session-mutation-authorization-error.js";
import {
  createAgentRunAdmissionRevalidator,
  resolveAgentRunAdmissionError,
} from "./agent-run-admission-revalidation.js";
import type { AgentTurnContext } from "./types.js";

const plain =
  "This Trunk was still getting ready and couldn't start your request; please send it again.";

const runtimeRaces = [
  new PreparedModelRuntimePublicationSupersededError(
    "prepared model runtime publication was superseded for /scratch/agents/example",
  ),
  new PreparedModelRuntimeOwnerNotPublishedError(
    "prepared model runtime plugin generation was superseded for C:\\Users\\someone\\.branch\\agents\\ash\\agent",
  ),
  new PreparedModelRuntimeOwnerNotPublishedError(
    "prepared model runtime lease admission made no publication progress for /scratch/agents/example; retry the request",
  ),
  new PreparedModelRuntimePluginGenerationRetiredError("Prepared plugin generation has retired"),
];

describe("pre-accept refusal after a runtime race", () => {
  it.each(runtimeRaces.map((error) => [error.message, error] as const))(
    "refuses %s with the plain sentence",
    (_message, error) => {
      const shape = resolveAgentRunAdmissionError(ErrorCodes.UNAVAILABLE, error);
      expect(shape.code).toBe(ErrorCodes.UNAVAILABLE);
      expect(shape.message).toBe(plain);
      expect(shape.message).not.toMatch(/prepared|publication|[\\/]agents[\\/]/i);
    },
  );

  it("keeps the diagnostic attached to the refused race", () => {
    const error = attachErrorDiagnostic(
      new PreparedModelRuntimePublicationSupersededError(
        "prepared model runtime publication was superseded for /scratch/agents/example",
      ),
      "lease waited 600000ms",
    );
    const shape = resolveAgentRunAdmissionError(ErrorCodes.UNAVAILABLE, error);
    expect(formatErrorMessageForDisplay(shape, shape.message)).toBe(
      `${plain}\nlease waited 600000ms`,
    );
  });

  it("keeps typed policy refusals and other failures as they were", () => {
    const policy = errorShape(ErrorCodes.INVALID_REQUEST, "session access changed", {
      details: { reason: "revoked" },
    });
    expect(
      resolveAgentRunAdmissionError(
        ErrorCodes.UNAVAILABLE,
        new SessionMutationAuthorizationChangedError(policy),
      ),
    ).toBe(policy);
    expect(
      resolveAgentRunAdmissionError(
        ErrorCodes.UNAVAILABLE,
        new Error("provider refused the request"),
      ).message,
    ).toBe("provider refused the request");
  });

  it("refuses a race seen during revalidation with the plain sentence", async () => {
    const rejectPreaccept = vi.fn(async () => undefined);
    const revalidate = createAgentRunAdmissionRevalidator({
      source: {
        context: { dedupe: new Map() } as unknown as AgentTurnContext,
        getOwnedAgentDedupeKeys: () => [],
        admissionAgentId: () => "ash",
        runId: "run-1",
        assertGatewayWorkAdmissionAllowed: () => {
          throw runtimeRaces[0];
        },
        client: null,
        cfg: {} as BranchConfig,
        getAdmittedSessionId: () => "session-1",
        hasGatewayAdmissionOutcome: () => false,
        respondToGatewayAdmissionOutcome: () => false,
      },
      activeRunAbort: { controller: new AbortController() } as Parameters<
        typeof createAgentRunAdmissionRevalidator
      >[0]["activeRunAbort"],
      parentResume: undefined,
      rejectPreaccept,
      cleanupPreaccept: async () => {},
    });
    await revalidate();
    expect(rejectPreaccept).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST, message: plain }),
    );
  });
});
