import { expect, it } from "vitest";
import { BranchSchema } from "./zod-schema.js";

it("rejects legacy channel-local ACP bindings", () => {
  const result = BranchSchema.safeParse({
    channels: {
      discord: {
        guilds: {
          guild: { channels: { channel: { bindings: { acp: { agentId: "coding" } } } } },
        },
      },
    },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["channels", "discord", "guilds", "guild", "channels", "channel", "bindings", "acp"],
      }),
    );
  }
});

it("rejects ACP bindings without a concrete peer conversation", () => {
  const result = BranchSchema.safeParse({
    bindings: [{ type: "acp", agentId: "coding", match: { channel: "chat-a" } }],
  });
  expect(result.success).toBe(false);
});
