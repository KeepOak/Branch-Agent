// Port of hermes-agent gateway/relay/auth.py v1 upgrade token bytes.
import { createHmac } from "node:crypto";

export function makeRelayUpgradeToken(gatewayId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const signed = `${gatewayId}:${nowSeconds + 300}`;
  const signature = createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  return Buffer.from(`${signed}:${signature}`, "utf8").toString("base64url");
}
