import { describe, expect, it } from "vitest";
import { listCoreToolFactoryDescriptors } from "./core-tool-factory-descriptors.js";
import { listCoreToolSections, resolveCoreToolProfilePolicy } from "./tool-catalog.js";
import { filterToolsByPolicy } from "./tool-policy-match.js";
import {
  ALWAYS_ON_TOOL_IDS,
  listToolsetIds,
  resolveDisabledToolsetTools,
  TOOLSETS,
} from "./tool-toolsets.js";

const builtInToolIds = [
  ...new Set([
    ...listCoreToolSections({ swarmEnabled: true, personalInstructionsEnabled: true }).flatMap(
      (section) => section.tools.map((tool) => tool.id),
    ),
    ...listCoreToolFactoryDescriptors().map((descriptor) => descriptor.name),
  ]),
];
const allToolsetsOn = Object.fromEntries(listToolsetIds().map((id) => [id, true]));

describe("tool-toolsets", () => {
  it("places every built-in tool in exactly one toolset or the always-on list", () => {
    const owners = new Map<string, string[]>();
    for (const toolset of TOOLSETS) {
      for (const tool of toolset.tools) {
        owners.set(tool, [...(owners.get(tool) ?? []), toolset.id]);
      }
    }
    for (const id of ALWAYS_ON_TOOL_IDS) {
      owners.set(id, [...(owners.get(id) ?? []), "always-on"]);
    }
    expect([...owners].filter(([, names]) => names.length > 1)).toEqual([]);
    expect(builtInToolIds.filter((id) => !owners.has(id))).toEqual([]);
    expect([...owners.keys()].filter((id) => !builtInToolIds.includes(id))).toEqual([]);
  });

  it("uses unique lowercase toolset ids with a label and a description", () => {
    const ids = listToolsetIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const toolset of TOOLSETS) {
      expect(toolset.id).toMatch(/^[a-z][a-z0-9]*$/);
      expect(toolset.label.length).toBeGreaterThan(0);
      expect(toolset.description.length).toBeGreaterThan(0);
    }
  });

  it("returns no denies when toolsets are unset or all on", () => {
    expect(resolveDisabledToolsetTools(undefined)).toEqual([]);
    expect(resolveDisabledToolsetTools({})).toEqual([]);
    expect(resolveDisabledToolsetTools(allToolsetsOn)).toEqual([]);
  });

  it("denies exactly the tools of each switched-off toolset", () => {
    expect(resolveDisabledToolsetTools({ browser: false })).toEqual(["browser"]);
    expect(resolveDisabledToolsetTools({ browser: false, files: true })).toEqual(["browser"]);
    const denied = resolveDisabledToolsetTools({ files: false });
    expect(denied.toSorted()).toEqual(["apply_patch", "edit", "glob", "ls", "read", "write"]);
  });

  it("ignores unknown names and always-on tools instead of widening anything", () => {
    expect(resolveDisabledToolsetTools({ nope: false, message: false })).toEqual([]);
  });

  it("hides a switched-off toolset's tools from the offered list", () => {
    const tools = builtInToolIds.map((name) => ({ name }));
    const denied = resolveDisabledToolsetTools({ messaging: false });
    const visible = filterToolsByPolicy(tools, { deny: denied }).map((tool) => tool.name);
    expect(visible).not.toContain("conversations_send");
    expect(visible).not.toContain("room_post");
    expect(visible).toContain("message");
    expect(visible).toContain("read");
  });

  it.each(["minimal", "coding", "messaging", "full"] as const)(
    "keeps the %s profile's tool list unchanged when every toolset is on",
    (profile) => {
      const tools = builtInToolIds.map((name) => ({ name }));
      const policy = resolveCoreToolProfilePolicy(profile);
      const withToolsets = {
        ...policy,
        deny: resolveDisabledToolsetTools(allToolsetsOn),
      };
      expect(filterToolsByPolicy(tools, withToolsets)).toEqual(
        filterToolsByPolicy(tools, policy),
      );
    },
  );
});
