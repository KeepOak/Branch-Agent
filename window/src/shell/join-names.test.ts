import { describe, expect, it } from "vitest";
import { joinNames, uniqueNames } from "./join-names";

describe("joinNames", () => {
  it("writes each name once, so a repeated device name never stutters", () => {
    expect(joinNames(["Branch", "Branch", "Branch", "Branch Agent MCP", "Branch"], 2)).toBe("Branch and Branch Agent MCP");
  });

  it("names up to the shown count and counts the rest", () => {
    expect(joinNames(["Alpha", "Beta", "Gamma", "Delta"])).toBe("Alpha, Beta and 2 more");
    expect(joinNames(["Alpha", "Beta", "Gamma"], 2)).toBe("Alpha, Beta and 1 more");
  });

  it("joins short lists with commas and a final and", () => {
    expect(joinNames(["Mac"])).toBe("Mac");
    expect(joinNames(["Mac", "Legion"])).toBe("Mac and Legion");
    expect(joinNames(["Mac", "Legion", "NAS"], 3)).toBe("Mac, Legion and NAS");
  });

  it("drops blanks and returns nothing for an empty list", () => {
    expect(joinNames(["", "  ", undefined, null])).toBe("");
    expect(uniqueNames([" Mac ", "Mac", ""])).toEqual(["Mac"]);
  });
});
