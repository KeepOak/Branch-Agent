// Branch-written behaviour tests for plan mode (atlas AGENT-LOOP-0222). The
// upstream Jan tests for the run-mode type live in plan-mode.test.ts.
import { describe, expect, it } from "vitest";
import { resolveConversationCapabilityProfile } from "./conversation-capability-profile.js";
import {
  isConversationToolAllowed,
  projectConversationToolNames,
} from "./conversation-tool-policy-pipeline.js";
import {
  appendPlanModeSystemPrompt,
  assertPlanModeSupported,
  PLAN_MODE_PROMPT_ADDENDUM,
  planModeToolPolicy,
} from "./plan-mode.js";

const CATALOG = [
  "read",
  "ls",
  "glob",
  "web_search",
  "memory_search",
  "write",
  "edit",
  "apply_patch",
  "exec",
  "process",
  "sessions_spawn",
  "message",
  "mcp__server__tool",
];

function projectFor(runMode: "normal" | "plan", extra: Record<string, unknown> = {}): string[] {
  const capabilityProfile = resolveConversationCapabilityProfile({ runMode, ...extra });
  return projectConversationToolNames({
    capabilityProfile,
    toolNames: CATALOG,
    warn: () => undefined,
  });
}

describe("plan mode tool policy", () => {
  it("keeps read-only tools and withholds every mutation-capable tool", () => {
    const visible = projectFor("plan");
    expect(visible).toEqual(expect.arrayContaining(["read", "ls", "glob", "web_search"]));
    for (const blocked of [
      "write",
      "edit",
      "apply_patch",
      "exec",
      "process",
      "sessions_spawn",
      "message",
      "mcp__server__tool",
    ]) {
      expect(visible).not.toContain(blocked);
    }
  });

  it("leaves normal runs unrestricted", () => {
    expect(projectFor("normal")).toEqual(expect.arrayContaining(["write", "exec", "message"]));
    expect(planModeToolPolicy("normal")).toBeUndefined();
  });

  it("cannot be widened by a runtime allowlist that names a blocked tool", () => {
    const visible = projectFor("plan", { runtimeToolAllowlist: ["write", "read"] });
    expect(visible).toContain("read");
    expect(visible).not.toContain("write");
  });

  it("rejects blocked tools at call time, the same check the caller uses", () => {
    const capabilityProfile = resolveConversationCapabilityProfile({ runMode: "plan" });
    expect(isConversationToolAllowed(capabilityProfile, "read")).toBe(true);
    expect(isConversationToolAllowed(capabilityProfile, "exec")).toBe(false);
  });
});

describe("plan mode prompt and safety gate", () => {
  it("passes the extra system prompt through unchanged in normal mode", () => {
    expect(appendPlanModeSystemPrompt({ runMode: "normal", extraSystemPrompt: "x" })).toBe("x");
    expect(appendPlanModeSystemPrompt({ runMode: "normal" })).toBeUndefined();
  });

  it("appends the plan addendum after any existing extra prompt", () => {
    expect(appendPlanModeSystemPrompt({ runMode: "plan", extraSystemPrompt: "base" })).toBe(
      `base\n\n${PLAN_MODE_PROMPT_ADDENDUM}`,
    );
    expect(appendPlanModeSystemPrompt({ runMode: "plan" })).toBe(PLAN_MODE_PROMPT_ADDENDUM);
  });

  it("refuses a plan run on a runtime that cannot enforce the policy", () => {
    expect(() => assertPlanModeSupported({ runMode: "plan", nativeRuntime: false })).toThrow(
      "plan mode is only supported on the native Branch runtime",
    );
    expect(() => assertPlanModeSupported({ runMode: "plan", nativeRuntime: true })).not.toThrow();
    expect(() =>
      assertPlanModeSupported({ runMode: "normal", nativeRuntime: false }),
    ).not.toThrow();
  });
});
