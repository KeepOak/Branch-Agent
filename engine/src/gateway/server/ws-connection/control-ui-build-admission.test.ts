import { describe, expect, it } from "vitest";
import { GATEWAY_CLIENT_IDS } from "../../../../packages/gateway-protocol/src/client-info.js";
import { resolveControlUiBuildMismatch } from "./control-ui-build-admission.js";

const bundled = {
  clientId: GATEWAY_CLIENT_IDS.CONTROL_UI,
  gatewayBuildId: "gateway-build",
  requestHost: "grove.example",
  requestOrigin: "https://grove.example",
};
const mismatch = { gatewayBuildId: "gateway-build", clientBuildId: "older-build" };

describe("resolveControlUiBuildMismatch", () => {
  it.each([
    ["exact bundled build", { ...bundled, clientBuildId: "gateway-build" }, null],
    ["stale bundled build", { ...bundled, clientBuildId: "older-build" }, mismatch],
    [
      "normalized same host",
      {
        ...bundled,
        requestHost: "GROVE.EXAMPLE",
        requestOrigin: "https://grove.example/",
        clientBuildId: "older-build",
      },
      mismatch,
    ],
    [
      "matching explicit port",
      {
        ...bundled,
        requestHost: "grove.example:18789",
        requestOrigin: "https://grove.example:18789",
        clientBuildId: "older-build",
      },
      mismatch,
    ],
    [
      "same host with differing port",
      {
        ...bundled,
        requestHost: "127.0.0.1:18789",
        requestOrigin: "http://127.0.0.1:5173",
        clientBuildId: "older-build",
      },
      null,
    ],
    [
      "missing origin",
      { ...bundled, requestOrigin: undefined, clientBuildId: "older-build" },
      null,
    ],
    ["legacy bundled build", bundled, { gatewayBuildId: "gateway-build", clientBuildId: null }],
    ["configured root", { ...bundled, configuredControlUiRoot: "/srv/ui" }, null],
    ["separately hosted UI", { ...bundled, requestOrigin: "https://ui.example" }, null],
    ["local dev UI", { ...bundled, clientBuildId: "dev" }, null],
    ["absent Gateway build", { ...bundled, gatewayBuildId: null }, null],
    ["non-Control UI", { ...bundled, clientId: "test-client" }, null],
  ])("classifies $0", (_name, input, expected) => {
    expect(resolveControlUiBuildMismatch(input)).toEqual(expected);
  });
});
