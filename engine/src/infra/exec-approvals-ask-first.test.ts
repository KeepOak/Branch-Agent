import { describe, expect, it } from "vitest";
import { validateExecApprovalsSetParams } from "../../packages/gateway-protocol/src/index.js";
import { matchExecAskFirstRules, resolveExecAskWithAskFirst } from "./exec-approvals-ask-first.js";
import {
  requiresExecApproval,
  resolveExecApprovalAllowedDecisions,
} from "./exec-approvals-policy.js";
import { normalizeExecApprovals, resolveExecApprovalsFromFile } from "./exec-approvals.js";
import type { ExecCommandSegment } from "./exec-command-analysis-types.js";

function segment(argv: string[], resolvedPath = "/usr/bin/" + argv[0]): ExecCommandSegment {
  const executable = {
    kind: "executable" as const,
    rawExecutable: argv[0] ?? "",
    resolvedPath,
    executableName: argv[0] ?? "",
  };
  return {
    raw: argv.join(" "),
    argv,
    resolution: { kind: "command", execution: executable, policy: executable },
  };
}

const GIT_PUSH_ASK_FIRST = [{ pattern: "git", argPattern: "^push( |$)" }];

describe("exec ask-first rules", () => {
  it("lets an always-allow rule skip the prompt for later commands in its scope", () => {
    const match = matchExecAskFirstRules({
      rules: GIT_PUSH_ASK_FIRST,
      analysisOk: true,
      segments: [segment(["git", "status"])],
    });
    expect(match).toEqual({ matched: false });
    const ask = resolveExecAskWithAskFirst("on-miss", match);
    expect(
      requiresExecApproval({
        ask,
        security: "allowlist",
        analysisOk: true,
        allowlistSatisfied: true,
        durableApprovalSatisfied: true,
      }),
    ).toBe(false);
  });

  it("still prompts for an ask-first command that an always-allow rule also covers", () => {
    const match = matchExecAskFirstRules({
      rules: GIT_PUSH_ASK_FIRST,
      analysisOk: true,
      segments: [segment(["git", "push", "origin", "main"])],
    });
    expect(match).toEqual({ matched: true, reason: "rule", rule: GIT_PUSH_ASK_FIRST[0] });
    const ask = resolveExecAskWithAskFirst("off", match);
    expect(ask).toBe("always");
    expect(
      requiresExecApproval({
        ask,
        security: "allowlist",
        analysisOk: true,
        allowlistSatisfied: true,
        durableApprovalSatisfied: true,
      }),
    ).toBe(true);
    // Full access still asks first, and the prompt cannot turn into a new always-allow.
    expect(
      requiresExecApproval({ ask, security: "full", analysisOk: true, allowlistSatisfied: false }),
    ).toBe(true);
    expect(resolveExecApprovalAllowedDecisions({ ask })).toEqual(["allow-once", "deny"]);
    expect(
      requiresExecApproval({
        ask: "off",
        security: "full",
        analysisOk: true,
        allowlistSatisfied: true,
        durableApprovalSatisfied: true,
        askFirstMatched: true,
      }),
    ).toBe(true);
  });

  it("matches ask-first rules in any chained segment", () => {
    expect(
      matchExecAskFirstRules({
        rules: GIT_PUSH_ASK_FIRST,
        analysisOk: true,
        segments: [segment(["git", "add", "."]), segment(["git", "push"])],
      }).matched,
    ).toBe(true);
  });

  it("fails closed for unparsed commands and opaque shell wrappers", () => {
    expect(
      matchExecAskFirstRules({ rules: GIT_PUSH_ASK_FIRST, analysisOk: false, segments: [] }),
    ).toEqual({ matched: true, reason: "unparsed" });
    expect(
      matchExecAskFirstRules({
        rules: GIT_PUSH_ASK_FIRST,
        analysisOk: true,
        segments: [segment(["bash", "-c", "git push"], "/bin/bash")],
      }),
    ).toEqual({ matched: true, reason: "shell-wrapper" });
  });

  it("stores ask-first rules per agent and merges the wildcard agent's rules", () => {
    const file = normalizeExecApprovals({
      version: 1,
      agents: {
        "*": { askFirst: [{ pattern: "rm" }] },
        main: { allowlist: [{ pattern: "git" }], askFirst: GIT_PUSH_ASK_FIRST },
      },
    });
    expect(validateExecApprovalsSetParams({ file })).toBe(true);
    expect(resolveExecApprovalsFromFile({ file, agentId: "main" }).askFirst).toEqual([
      { pattern: "rm" },
      ...GIT_PUSH_ASK_FIRST,
    ]);
    expect(resolveExecApprovalsFromFile({ file, agentId: "other" }).askFirst).toEqual([
      { pattern: "rm" },
    ]);
  });

  it("changes nothing when no ask-first rule exists", () => {
    const match = matchExecAskFirstRules({
      rules: [],
      analysisOk: false,
      segments: [segment(["bash", "-c", "git push"], "/bin/bash")],
    });
    expect(match).toEqual({ matched: false });
    expect(resolveExecAskWithAskFirst("off", match)).toBe("off");
  });
});
