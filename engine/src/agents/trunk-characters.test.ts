import { describe, expect, it } from "vitest";
import { createAgent } from "./agent-create.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { Value } from "typebox/value";
import { AgentsCreateParamsSchema, AgentsUpdateParamsSchema, AgentSummarySchema } from "../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import type { BranchConfig } from "../config/types.branch.js";
import { assignExistingTrunkCharacters, characterId, pickTrunkCharacter, TRUNK_CHARACTERS } from "./trunk-characters.js";

describe("Trunk characters", () => {
  it("persists a free character on create and keeps the first default classic", async () => {
    const state = await createBranchTestState({ layout: "state-only", scenario: "empty", label: "trunk-characters" });
    try {
      await state.writeConfig({ gateway: { mode: "local" }, agents: { defaultId: "tk", entries: { tk: { identity: { name: "TK" } }, ember: { identity: { avatar: "branch:ember" } } } } });
      const created = await createAgent({ name: "Ash", workspace: state.path("ash") });
      expect(created.status).toBe("created");
      if (created.status !== "created") return;
      expect(created.config.agents?.entries?.ash?.identity?.avatar).toMatch(/^branch:/);
      expect(created.config.agents?.entries?.ash?.identity?.avatar).not.toBe("branch:ember");
      expect(created.config.agents?.entries?.tk?.identity?.avatar).toBeUndefined();
    } finally { closeBranchStateDatabaseForTest(); await state.cleanup(); }
  });
  it("leaves a first-run default Trunk on the classic pebble", async () => {
    const state = await createBranchTestState({ layout: "state-only", scenario: "empty", label: "first-trunk-character" });
    try {
      await state.writeConfig({ gateway: { mode: "local" } });
      const created = await createAgent({ name: "Sapling", workspace: state.path("sapling"), bootstrapFirstAgent: true });
      expect(created.status).toBe("created");
      if (created.status !== "created") return;
      expect(created.config.agents?.entries?.sapling?.identity?.avatar).toBeUndefined();
    } finally { closeBranchStateDatabaseForTest(); await state.cleanup(); }
  });
  it("keeps the first contact classic when a bootstrap agent exists but no default is selected", async () => {
    const state = await createBranchTestState({ layout: "state-only", scenario: "empty", label: "first-contact-character" });
    try {
      await state.writeConfig({ gateway: { mode: "local" }, agents: { entries: { dev: { identity: { name: "Bootstrap" } } } } });
      const created = await createAgent({ name: "Sapling", workspace: state.path("sapling") });
      expect(created.status).toBe("created");
      if (created.status !== "created") return;
      expect(created.config.agents?.entries?.sapling?.identity?.avatar).toBeUndefined();
    } finally { closeBranchStateDatabaseForTest(); await state.cleanup(); }
  });
  it("validates pebble fields on create and update and includes them in the list contract", () => {
    const look = { colour: "#2F8C86", shape: "Stone", eyes: "Wide" };
    expect(Value.Check(AgentsCreateParamsSchema, { name: "Ash", ...look })).toBe(true);
    expect(Value.Check(AgentsUpdateParamsSchema, { agentId: "ash", ...look })).toBe(true);
    expect(Value.Check(AgentSummarySchema, { id: "ash", identity: look })).toBe(true);
    for (const field of Object.keys(look)) {
      expect(Value.Check(AgentsUpdateParamsSchema, { agentId: "ash", ...look, [field]: "invalid" })).toBe(false);
    }
  });
  it("chooses an unused character and falls back to any character when all are worn", () => {
    expect(pickTrunkCharacter(["branch:bolt", "branch:ember"], () => 0)).toBe("juniper");
    expect(pickTrunkCharacter(TRUNK_CHARACTERS.map((id) => `branch:${id}`), () => 3)).toBe("kite");
    expect(characterId("/assets/art17/agents/nib/still.webp")).toBe("nib");
  });

  it("assigns distinct characters once without changing the default or existing characters", () => {
    const cfg = { agents: { defaultId: "tk", entries: {
      tk: { identity: { name: "TK" } },
      ash: { identity: { name: "Ash" } },
      elm: { identity: { name: "Elm", emoji: "🌿" } },
      oak: { identity: { name: "Oak", avatar: "classic" } },
      researcher: { identity: { name: "Researcher", avatar: "branch:ember", emoji: "🦉" } },
    } } } as BranchConfig;
    const assigned = assignExistingTrunkCharacters(cfg, () => 0);
    const entries = assigned.agents?.entries ?? {};
    expect(entries.tk.identity).toEqual({ name: "TK" });
    expect(["ash", "elm", "oak"].map((id) => entries[id].identity?.avatar)).toEqual(["branch:bolt", "branch:juniper", "branch:kite"]);
    expect(entries.elm.identity?.emoji).toBeUndefined();
    expect(entries.researcher.identity).toEqual({ name: "Researcher", avatar: "branch:ember", emoji: "🦉" });
    expect(assigned.agents?.characterAssignmentVersion).toBe(1);
    expect(assignExistingTrunkCharacters(assigned)).toBe(assigned);
  });
});
