import { describe, expect, it } from "vitest";
import { GATEWAY_FIELD_LABELS } from "./schema.gateway-labels.js";
import { RUNTIME_FIELD_HELP } from "./schema.help.runtime.js";
import { GatewayConfigSchema } from "./zod-schema.gateway.js";

describe("deprecated community invitation config", () => {
  it.each([true, false])("still accepts legacy value %s", (communityInvite) => {
    const config = GatewayConfigSchema.parse({ controlUi: { communityInvite } });
    expect(config?.controlUi?.communityInvite).toBe(communityInvite);
  });

  it("labels the setting deprecated and explains that it has no effect", () => {
    const key = "gateway.controlUi.communityInvite";
    expect(GATEWAY_FIELD_LABELS[key]).toContain("Deprecated");
    expect(RUNTIME_FIELD_HELP[key]).toContain("Deprecated");
    expect(RUNTIME_FIELD_HELP[key]).toContain("has no effect");
  });
});
