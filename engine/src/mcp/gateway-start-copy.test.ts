import { describe, expect, it } from "vitest";
import {
  isGatewayClosedBeforeReadyError,
  MCP_GATEWAY_UNREACHABLE,
  plainGatewayStartFailure,
} from "./gateway-start-copy.js";

describe("plainGatewayStartFailure", () => {
  it("replaces a close-before-ready dump with one plain sentence", () => {
    const raw = new Error("gateway closed before ready (1000): .");
    expect(isGatewayClosedBeforeReadyError(raw)).toBe(true);
    expect(plainGatewayStartFailure(raw)).toBe(MCP_GATEWAY_UNREACHABLE);
    expect(plainGatewayStartFailure(raw)).not.toMatch(/closed before ready|require-rpc|\(1000\)/);
  });

  it("keeps an unrelated start failure for the caller to wrap", () => {
    expect(plainGatewayStartFailure(new Error("gateway unavailable"))).toBeNull();
  });
});
