import { describe, expect, it } from "vitest";
import {
  describeDryRun,
  explainToolCall,
  loadToolContract,
  ToolContractExampleError,
  type ToolContract,
} from "./tool-contract-dry-run.js";

const contract: ToolContract = {
  name: "research Trunk",
  layers: [
    { label: "agent rules", policy: { allow: ["read", "web_*", "message"] } },
    { label: "group chat rules", policy: { deny: ["message"] } },
  ],
  examples: [
    { tool: "read", expect: "allowed" },
    { tool: "web_fetch", expect: "allowed" },
    { tool: "message", expect: "refused" },
    { tool: "exec", expect: "refused" },
  ],
};

describe("tool contract dry-run (AGENT-LOOP-0332)", () => {
  it("R-1559: explains why a tool call would be allowed", () => {
    const explanation = explainToolCall(contract, "web_fetch");
    expect(explanation.allowed).toBe(true);
    expect(describeDryRun(explanation)).toBe("web_fetch would be allowed: every rule allows it.");
  });

  it("R-1559: explains which layer refuses a call and why", () => {
    expect(describeDryRun(explainToolCall(contract, "message"))).toBe(
      "message would be refused by group chat rules (denied by name).",
    );
    expect(describeDryRun(explainToolCall(contract, "exec"))).toBe(
      "exec would be refused by agent rules (not on the allow list).",
    );
  });

  it("R-1559: examples are checked when the contract loads", () => {
    expect(loadToolContract(contract)).toBe(contract);
    const wrong: ToolContract = { ...contract, examples: [{ tool: "message", expect: "allowed" }] };
    expect(() => loadToolContract(wrong)).toThrow(ToolContractExampleError);
    expect(() => loadToolContract(wrong)).toThrow(/message expected allowed, got refused/);
  });
});
