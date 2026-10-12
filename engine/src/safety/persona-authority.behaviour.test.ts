// Behaviour tests for atlas SAFETY-0196 (G-1739, G-1719): personas propose, they never grant.
import { describe, expect, it } from "vitest";
import {
  decidePersonaWrite,
  refuseSetupOnlyMarkerEdit,
  resolveOwnerReachPersona,
  stripSetupOnlyMarkers,
} from "./persona-authority.js";

describe("G-1739 persona changes", () => {
  it("G-1739: a persona may only propose changes to its own personality and instruction files", () => {
    expect(decidePersonaWrite({ writerAgentId: "ash", targetAgentId: "ash", file: "workspace/SOUL.md" })).toEqual({
      kind: "propose",
      agentId: "ash",
      file: "SOUL.md",
    });
    expect(decidePersonaWrite({ writerAgentId: "ash", targetAgentId: "oak", file: "SOUL.md" })).toEqual({
      kind: "refuse",
      reason: "other-agent",
    });
    expect(decidePersonaWrite({ writerAgentId: "ash", targetAgentId: "ash", file: "config.json" })).toEqual({
      kind: "refuse",
      reason: "not-persona-file",
    });
  });

  it("G-1739: nothing applies automatically and standing instructions carry no permissions", () => {
    const decision = decidePersonaWrite({ writerAgentId: "ash", targetAgentId: "ash", file: "AGENTS.md" });
    expect(decision.kind).not.toBe("apply");
    expect(Object.keys(decision).sort()).toEqual(["agentId", "file", "kind"]);
  });
});

describe("G-1719 default persona with owner reach", () => {
  const personas = [
    { id: "hand-made", name: "My helper" },
    { id: "default", name: "Assistant" },
  ];

  it("G-1719: owner reach needs an explicit persisted designation; no persona is promoted implicitly", () => {
    expect(resolveOwnerReachPersona({ designatedPersonaId: undefined, personas })).toBeUndefined();
    expect(resolveOwnerReachPersona({ designatedPersonaId: " ", personas })).toBeUndefined();
    expect(resolveOwnerReachPersona({ designatedPersonaId: "default", personas })?.id).toBe("default");
  });

  it("G-1719: setup-only markers cannot be set through edit routes and are stripped on restore", () => {
    expect(refuseSetupOnlyMarkerEdit({ name: "x", ownerReachDefault: true })).toEqual(["ownerReachDefault"]);
    expect(refuseSetupOnlyMarkerEdit({ name: "x" })).toEqual([]);
    expect(stripSetupOnlyMarkers({ id: "p", ownerReachDefault: true, setupCreated: true, name: "n" })).toEqual({
      id: "p",
      name: "n",
    });
  });
});
