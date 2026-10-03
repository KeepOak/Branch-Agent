import { describe, expect, it } from "vitest";
import {
  CORE_TOOL_GROUPS,
  isKnownCoreToolId,
  listCoreToolSections,
  resolveCoreToolProfiles,
  resolveCoreToolProfilePolicy,
} from "../tool-catalog.js";
describe("harvested tool registration metadata", () => {
  it.each(["sequentialthinking", "get_weather", "calculate"])(
    "registers %s through existing groups and profile defaults",
    (id) => {
      expect(isKnownCoreToolId(id)).toBe(true);
      expect(
        listCoreToolSections()
          .flatMap((section) => section.tools)
          .filter((tool) => tool.id === id),
      ).toHaveLength(1);
      expect(resolveCoreToolProfiles(id)).toEqual(["coding", "messaging"]);
      expect(resolveCoreToolProfilePolicy("coding")?.allow).toContain(id);
      expect(CORE_TOOL_GROUPS["group:branch"]).toContain(id);
    },
  );
});
