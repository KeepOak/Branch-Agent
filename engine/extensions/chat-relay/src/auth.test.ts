import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { makeRelayUpgradeToken } from "./auth.js";

it("matches Hermes relay v1 upgrade token bytes and uses a 300-second expiry", () => {
  const token = makeRelayUpgradeToken("gateway-1", "secret-2", 1_700_000_000);
  const signed = "gateway-1:1700000300";
  const signature = createHmac("sha256", "secret-2").update(signed).digest("hex");
  expect(Buffer.from(token, "base64url").toString("utf8")).toBe(`${signed}:${signature}`);
});
