import { describe, expect, it } from "vitest";
import { SqliteReadOnlyWorkerBusyError } from "../infra/sqlite-readonly-worker-session.js";
import {
  classifySystemAgentInferenceFailure,
  describeSystemAgentInferenceFailureForChat,
  SystemAgentInferenceUnavailableError,
} from "./inference-error.js";

const alreadyOpen = new Error(
  "Branch Agent agent database /state/agents/branch/branch-agent.sqlite is already open for agent builder-ash; requested agent branch.",
);

describe("Branch Agent inference errors in chat (#1928)", () => {
  it("maps the agent database 'already open' failure to one plain sentence with a retry", () => {
    const error = new SystemAgentInferenceUnavailableError("agent-turn", [alreadyOpen]);
    expect(error.reason).toBe("agent-database-busy");
    expect(error.action).toBe("retry");
    expect(error.userMessage).toBe(
      "Branch is busy finishing other work. Try again in a moment.",
    );
    for (const raw of ["sqlite", "already open", "builder-ash", "branch onboard", "/state/"]) {
      expect(error.userMessage).not.toContain(raw);
    }
    // Operator detail stays available to logs and the CLI.
    expect(error.message).toContain("is already open for agent builder-ash");
  });

  it("finds the database conflict in a nested cause", () => {
    const wrapped = new Error("turn failed", { cause: alreadyOpen });
    expect(classifySystemAgentInferenceFailure([wrapped])).toBe("agent-database-busy");
    expect(classifySystemAgentInferenceFailure([new Error("SQLITE_BUSY: database is locked")])).toBe(
      "agent-database-busy",
    );
  });

  it("maps a full SQLite session pool to the same plain busy sentence", () => {
    const error = new SystemAgentInferenceUnavailableError("agent-turn", [
      new Error("turn failed", { cause: new SqliteReadOnlyWorkerBusyError() }),
    ]);
    expect(error.reason).toBe("agent-database-busy");
    expect(error.action).toBe("retry");
    expect(error.userMessage).toBe("Branch is busy finishing other work. Try again in a moment.");
    expect(describeSystemAgentInferenceFailureForChat(new SqliteReadOnlyWorkerBusyError())).toMatchObject({
      message: "Branch is busy finishing other work. Try again in a moment.",
      action: "retry",
    });
  });

  it("maps other inference failures to a reconnect sentence with an Accounts action", () => {
    const error = new SystemAgentInferenceUnavailableError("agent-turn", [
      new Error("401 Unauthorized from provider"),
    ]);
    expect(error.reason).toBe("inference-unavailable");
    expect(error.action).toBe("open-accounts");
    expect(error.userMessage).toBe(
      "Branch can't reach your AI account right now. Reconnect it in Accounts, then try again.",
    );
    expect(error.userMessage).not.toContain("401");
    expect(error.userMessage).not.toContain("branch onboard");
  });

  it("describes an error with no failures and a foreign error the same plain way", () => {
    expect(describeSystemAgentInferenceFailureForChat(new SystemAgentInferenceUnavailableError("planner"))).toEqual({
      message: "Branch can't reach your AI account right now. Reconnect it in Accounts, then try again.",
      reason: "inference-unavailable",
      action: "open-accounts",
    });
    expect(describeSystemAgentInferenceFailureForChat(alreadyOpen)).toMatchObject({
      reason: "agent-database-busy",
      action: "retry",
    });
  });
});
