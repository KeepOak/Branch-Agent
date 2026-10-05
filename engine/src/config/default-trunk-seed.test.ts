import { expect, it } from "vitest";
import { applyImplicitAgentRosterDefaults } from "./implicit-agent-roster.js";
import { AgentsSchema } from "./zod-schema.agents.js";

it("names only a fresh implicit default Branch Agent and preserves an existing TK", () => {
  expect(applyImplicitAgentRosterDefaults({})).toMatchObject({
    agents: { entries: { main: { name: "Branch Agent", identity: { name: "Branch Agent" } } } },
  });
  const existing = { agents: { defaultId: "main", entries: { main: { name: "TK", identity: { name: "TK" } } } } };
  expect(applyImplicitAgentRosterDefaults(existing)).toBe(existing);
});

it("accepts hidden and colour on a configured default without changing routing ownership", () => {
  const parsed = AgentsSchema.parse({ defaultId: "tk", entries: { tk: { name: "TK", hidden: true, identity: { color: "#56616B" } } } });
  expect(parsed?.defaultId).toBe("tk");
  expect(parsed?.entries?.tk?.hidden).toBe(true);
  expect(parsed?.entries?.tk?.identity?.color).toBe("#56616B");
});
