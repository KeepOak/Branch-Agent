import { afterEach, describe, expect, it } from "vitest";
import { readLimitedSetupCode, startKey } from "./start-key";

const URL_ = "ws://127.0.0.1:19031";
const bridge = { gatewayUrl: URL_, gatewayToken: "desktop-key" };

afterEach(() => localStorage.clear());

describe("startKey", () => {
  it("sends the desktop app's key for its own gateway even once paired, so old narrow scopes widen", () => {
    localStorage.setItem(`branch-device-token-v1:${URL_}:webchat-ui:dev:operator`, JSON.stringify({ token: "t", scopes: ["operator.read"] }));
    expect(startKey(URL_, null, bridge)).toBe("desktop-key");
  });

  it("uses the stored pairing alone for another gateway", () => {
    localStorage.setItem("branch-device-token-v1:ws://elsewhere:1:webchat-ui:dev:operator", JSON.stringify({ token: "t", scopes: [] }));
    expect(startKey("ws://elsewhere:1", null, bridge)).toBe("");
  });

  it("asks for a key when nothing is known, and a typed key always wins", () => {
    expect(startKey("ws://elsewhere:1", null, bridge)).toBeNull();
    expect(startKey(URL_, "typed", bridge)).toBe("typed");
  });
});

describe("limited setup code", () => {
  it("reads the engine's short-lived bootstrap credential without treating it as a gateway key", () => {
    const payload = { url: "wss://nas.example.ts.net:8443", bootstrapToken: "bounded-token", expiresAtMs: Date.now() + 60_000 };
    const code = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    expect(readLimitedSetupCode(code)).toEqual({ url: payload.url, bootstrapToken: payload.bootstrapToken });
    expect(readLimitedSetupCode(`oc-pair://${code}`)).toEqual({ url: payload.url, bootstrapToken: payload.bootstrapToken });
    expect(readLimitedSetupCode("ordinary-gateway-key")).toBeNull();
    expect(readLimitedSetupCode(btoa(JSON.stringify({ ...payload, expiresAtMs: Date.now() - 1 })))).toBeNull();
  });
});
