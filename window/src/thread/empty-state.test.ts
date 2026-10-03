import { describe, expect, it } from "vitest";
import { startersFor } from "./EmptyState";

describe("empty conversation starters", () => {
  it("picks four by what the Trunk is for, and the everyday four for the default Trunk", () => {
    expect(startersFor("Money & receipts", false)[0]).toBe("Match this month’s receipts to my card statement");
    expect(startersFor("Plans trips", false)).toHaveLength(4);
    expect(startersFor("Research", true)[0]).toBe("Tidy my Downloads folder");
    expect(startersFor("", false)[0]).toBe("Tidy my Downloads folder");
    expect(startersFor("Gardening", false)[0]).toBe("Tidy my Downloads folder");
  });
});
