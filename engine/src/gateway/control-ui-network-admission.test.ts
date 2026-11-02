// Control UI network admission tests: network listeners require auth, loopback stays open.
import { describe, expect, it } from "vitest";
import { controlUiRequestRequiresNetworkAuth } from "./control-ui-network-admission.js";

const TOKEN = { mode: "token" as const };

describe("controlUiRequestRequiresNetworkAuth", () => {
  it.each([
    { name: "IPv4 loopback listener", localAddress: "127.0.0.1" },
    { name: "IPv6 loopback listener", localAddress: "::1" },
    { name: "IPv4-mapped loopback listener", localAddress: "::ffff:127.0.0.1" },
  ])("does not require auth on the $name", ({ localAddress }) => {
    expect(
      controlUiRequestRequiresNetworkAuth({
        socket: { localAddress },
        auth: TOKEN,
        isStaticAsset: false,
      }),
    ).toBe(false);
  });

  it.each([
    { name: "a private-range IPv4 listener", localAddress: "10.0.0.5" },
    { name: "a wildcard-accepted IPv4 connection", localAddress: "203.0.113.7" },
    { name: "a link-local IPv6 listener", localAddress: "fe80::1" },
  ])("requires auth for the document on $name", ({ localAddress }) => {
    expect(
      controlUiRequestRequiresNetworkAuth({
        socket: { localAddress },
        auth: TOKEN,
        isStaticAsset: false,
      }),
    ).toBe(true);
  });

  it("requires auth for password and trusted-proxy modes on a network listener", () => {
    for (const mode of ["password", "trusted-proxy"] as const) {
      expect(
        controlUiRequestRequiresNetworkAuth({
          socket: { localAddress: "10.0.0.5" },
          auth: { mode },
          isStaticAsset: false,
        }),
      ).toBe(true);
    }
  });

  it("fails closed when the listener address is unknown", () => {
    expect(
      controlUiRequestRequiresNetworkAuth({ socket: {}, auth: TOKEN, isStaticAsset: false }),
    ).toBe(true);
    expect(
      controlUiRequestRequiresNetworkAuth({ socket: undefined, auth: TOKEN, isStaticAsset: false }),
    ).toBe(true);
  });

  it("leaves fingerprinted static assets public", () => {
    expect(
      controlUiRequestRequiresNetworkAuth({
        socket: { localAddress: "10.0.0.5" },
        auth: TOKEN,
        isStaticAsset: true,
      }),
    ).toBe(false);
  });

  it("defers to startup refusal when auth is none or absent", () => {
    expect(
      controlUiRequestRequiresNetworkAuth({
        socket: { localAddress: "10.0.0.5" },
        auth: { mode: "none" },
        isStaticAsset: false,
      }),
    ).toBe(false);
    expect(
      controlUiRequestRequiresNetworkAuth({
        socket: { localAddress: "10.0.0.5" },
        auth: undefined,
        isStaticAsset: false,
      }),
    ).toBe(false);
  });
});
