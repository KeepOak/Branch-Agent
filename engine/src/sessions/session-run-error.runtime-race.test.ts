import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PreparedModelRuntimePluginGenerationRetiredError,
  PreparedModelRuntimePublicationSupersededError,
} from "../agents/prepared-model-runtime.errors.js";
import { recordGatewaySessionRunFailure, resolveSessionRunError } from "./session-run-error.js";

const reports = vi.hoisted(() => [] as Array<Record<string, unknown> | undefined>);

vi.mock("../config/sessions/session-accessor.js", () => ({
  appendSessionTranscriptReport: async (
    _target: unknown,
    request: { selectReport: (latest: undefined) => Record<string, unknown> | undefined },
  ) => {
    reports.push(request.selectReport(undefined));
    return { ok: true };
  },
}));
vi.mock("../config/sessions/transcript-write-context.js", () => ({
  withSessionTranscriptWriteAssertion: (_target: unknown, _assert: unknown, write: () => unknown) =>
    write(),
}));

const plain =
  "This Trunk was still getting ready and couldn't start your request; please send it again.";

// Every retirement message the preparation lifecycle emits, read from its source so a new or
// reworded one cannot slip past presentation unnoticed.
const emittedRetirementMessages = [
  ...readFileSync(
    new URL("../agents/prepared-model-runtime.plugin-lifetime.ts", import.meta.url),
    "utf8",
  ).matchAll(/new PreparedModelRuntimePluginGenerationRetiredError\(\s*"([^"]+)"/g),
].map((match) => match[1]);

describe("runtime preparation races shown to the user", () => {
  it.each([
    "Error: prepared model runtime publication was superseded for C:\\Users\\someone\\.branch\\agents\\ash\\agent",
    "Error: prepared model runtime plugin generation was superseded for /home/someone/.branch/agents/birch/agent",
    "Error: Worker placement inventory changed",
  ])("reads as one plain sentence for %s", (error) => {
    const shown = resolveSessionRunError({ error }, "failed");
    expect(shown).toBe(plain);
    expect(shown).not.toMatch(/publication|placement|[\\/]agents[\\/]/i);
  });

  it("covers every plugin generation retirement the setup retry rejoins", () => {
    expect(emittedRetirementMessages).toEqual(
      expect.arrayContaining([
        "Prepared plugin generation has retired",
        "Prepared plugin registry has retired",
        "Prepared plugin generation retired before publication",
        "Prepared model runtime plugin generation retired",
      ]),
    );
    for (const message of emittedRetirementMessages) {
      const error = new PreparedModelRuntimePluginGenerationRetiredError(message);
      expect(resolveSessionRunError({ error: String(error) }, "failed")).toBe(plain);
      expect(resolveSessionRunError({ error: String(error) }, "timeout")).toBe(plain);
    }
  });

  it("writes the plain sentence to the transcript for a retired generation", async () => {
    reports.length = 0;
    const target = { agentId: "ash", sessionKey: "agent:ash:main", sessionId: "session-1" };
    for (const message of emittedRetirementMessages) {
      await recordGatewaySessionRunFailure({
        target: target as Parameters<typeof recordGatewaySessionRunFailure>[0]["target"],
        runId: `run-${reports.length}`,
        error: new PreparedModelRuntimePluginGenerationRetiredError(message),
      });
    }
    await recordGatewaySessionRunFailure({
      target: target as Parameters<typeof recordGatewaySessionRunFailure>[0]["target"],
      runId: "run-superseded",
      error: new PreparedModelRuntimePublicationSupersededError(
        "prepared model runtime publication was superseded for /home/someone/.branch/agents/ash/agent",
      ),
    });
    expect(reports).toHaveLength(emittedRetirementMessages.length + 1);
    for (const report of reports) {
      expect(report?.content).toBe(plain);
      expect(JSON.stringify(report)).not.toMatch(/retired|publication|[\\/]agents[\\/]/i);
    }
  });

  it("leaves other failures as they were", () => {
    expect(resolveSessionRunError({ error: "Error: provider refused the request" }, "failed")).toBe(
      "Error: provider refused the request",
    );
    expect(
      resolveSessionRunError(
        { error: "Error: Plugin inventory has retired; begin a new plugin operation." },
        "failed",
      ),
    ).toBe("Error: Plugin inventory has retired; begin a new plugin operation.");
    expect(resolveSessionRunError({ error: "Error: This model has retired." }, "failed")).toBe(
      "Error: This model has retired.",
    );
  });
});
