import { afterEach, describe, expect, it, vi } from "vitest";

function firstIssueMessage(result: {
  success: boolean;
  error?: { issues: Array<{ message: string }> };
}): string {
  if (result.success) {
    throw new Error("expected parse failure");
  }
  return result.error?.issues[0]?.message ?? "";
}

describe("zod default locale", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("uses real issue messages when the default locale starts unset", async () => {
    vi.resetModules();
    const { z } = await import("zod");
    const previousLocaleError = z.config().localeError;

    try {
      // Zod 4.5 registers its default during schema construction, including in bundles.
      z.config({ localeError: undefined });
      const { BranchSchema } = await import("./zod-schema.js");
      const restored = BranchSchema.safeParse({
        agents: { defaults: { session: { pruneAfter: "1d" } } },
      });
      expect(firstIssueMessage(restored)).toBe('Unrecognized key: "session"');
      const typeError = BranchSchema.safeParse({ gateway: { port: "not-a-number" } });
      expect(firstIssueMessage(typeError)).toBe("Invalid input: expected number, received string");
    } finally {
      z.config({ localeError: previousLocaleError });
    }
  });
});
