import { describe, expect, it } from "vitest";
import { gatewayRpcCatalogLabel } from "./request-diagnostics.js";

describe("gateway RPC catalog label", () => {
  it("keeps catalog-owned method names", () => {
    expect(gatewayRpcCatalogLabel("chat.history", undefined, {})).toBe("chat.history");
  });

  it("buckets a caller-chosen unknown method as other", () => {
    expect(gatewayRpcCatalogLabel("x.not-a-method.abc123", undefined, {})).toBe("other");
  });
});
