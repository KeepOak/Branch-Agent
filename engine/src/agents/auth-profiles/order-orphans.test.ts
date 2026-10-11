import { describe, expect, it } from "vitest";
import {
  formatAuthOrderMissingProfilesWarning,
  listAuthOrderProfilesMissingFromStore,
} from "./order-orphans.js";
import type { AuthProfileStore } from "./types.js";

const oauth = (provider: string) => ({ type: "oauth" as const, provider, access: "tok" });

describe("auth order rows naming profiles absent from the store", () => {
  it("reports each provider row's absent ids and keeps rows the store can serve", () => {
    // builder-oak on the Legion: four anthropic profiles, an openai row naming profiles it lacks.
    const store = {
      version: 1,
      profiles: { "anthropic:a": oauth("anthropic"), "anthropic:b": oauth("anthropic") },
      order: {
        openai: ["openai:x", "openai:y", "openai:x"],
        anthropic: ["anthropic:b", "anthropic:gone", "anthropic:a"],
      },
    } as unknown as AuthProfileStore;
    expect(listAuthOrderProfilesMissingFromStore(store)).toEqual([
      { provider: "anthropic", profileIds: ["anthropic:gone"] },
      { provider: "openai", profileIds: ["openai:x", "openai:y"] },
    ]);
  });

  it("counts profiles the effective store inherits from its auth owner as present", () => {
    // An inheritor whose own store lacks openai profiles; its effective store holds tk's.
    const effective = {
      version: 1,
      profiles: { "anthropic:a": oauth("anthropic"), "openai:tk-1": oauth("openai") },
      order: { openai: ["openai:tk-1"], anthropic: ["anthropic:a"] },
    } as unknown as AuthProfileStore;
    expect(listAuthOrderProfilesMissingFromStore(effective)).toEqual([]);
    expect(listAuthOrderProfilesMissingFromStore(undefined)).toEqual([]);
    expect(
      listAuthOrderProfilesMissingFromStore({ profiles: {} } as unknown as AuthProfileStore),
    ).toEqual([]);
  });

  it("names the agent, provider and ids in the warning", () => {
    expect(
      formatAuthOrderMissingProfilesWarning("builder-oak", [
        { provider: "openai", profileIds: ["openai:x", "openai:y"] },
      ]),
    ).toBe(
      "agent builder-oak auth order names profiles absent from its auth store; model selection skips them: openai=[openai:x, openai:y]. Fix with branch models auth order set|clear --agent builder-oak --provider <provider>.",
    );
  });
});
