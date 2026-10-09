import { describe, expect, it } from "vitest";
import { resolveSessionRunError } from "./session-run-error.js";

const plain =
  "This Trunk was still getting ready and couldn't start your request; please send it again.";

describe("runtime preparation races shown to the user", () => {
  it.each([
    "Error: prepared model runtime publication was superseded for C:\\Users\\someone\\.branch\\agents\\ash\\agent",
    "Error: prepared model runtime plugin generation was superseded for /home/someone/.branch/agents/birch/agent",
    "Error: Worker placement inventory changed",
  ])("reads as one plain sentence for %s", (error) => {
    const shown = resolveSessionRunError({ error }, "failed");
    expect(shown).toBe(plain);
    expect(shown).not.toMatch(/publication|placement|[\\/]agents[\\/]/i);
  });

  it("leaves other failures as they were", () => {
    expect(resolveSessionRunError({ error: "Error: provider refused the request" }, "failed")).toBe(
      "Error: provider refused the request",
    );
  });
});
