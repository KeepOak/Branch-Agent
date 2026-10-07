// The desktop app swaps the engine underneath an open window and then says so (`branch:engine-ready`);
// the window must reconnect at once instead of waiting out the reconnect backoff (up to 15 s).
import { describe, expect, it, vi } from "vitest";

type ClientOptions = { onHello: (hello: unknown) => void; onClose: (context: unknown, decision: { retry: boolean }) => void; buildConnectPlan: (input: { nonce: string; challengeTs: number }) => Promise<unknown> };

const fake = vi.hoisted(() => ({ client: null as null | { options: ClientOptions; starts: number; stops: number }, planParams: null as unknown }));

vi.mock("@branch/gateway-client/browser", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    GatewayBrowserDeviceAuthLifecycle: class { async buildPlan(params: unknown) { fake.planParams = params; return {}; } },
    GatewayProtocolClient: class {
      options: ClientOptions;
      starts = 0;
      stops = 0;
      constructor(options: ClientOptions) {
        this.options = options;
        fake.client = this;
      }
      start(): void { this.starts += 1; }
      stop(): void { this.stops += 1; }
    },
  };
});
vi.mock("./device-identity", () => ({ loadBrowserDeviceIdentity: vi.fn() }));
vi.mock("./device-token-store", () => ({ createDeviceTokenStore: vi.fn() }));

describe("reconnect after an in-place engine update", () => {
  it("restarts the connection at once while disconnected and leaves a live connection alone", async () => {
    const { BranchGateway } = await import("./gateway");
    const statuses: string[] = [];
    const gateway = new BranchGateway({ url: "ws://127.0.0.1:1", onStatus: (s) => statuses.push(s.phase), onEvent: () => {} });
    gateway.start();
    const client = fake.client!;
    client.options.onHello({});
    gateway.reconnectNow();
    expect(client.stops).toBe(0);
    client.options.onClose({ code: 1006 }, { retry: true });
    gateway.reconnectNow();
    expect(client.stops).toBe(1);
    expect(client.starts).toBe(2);
    expect(statuses.at(-1)).toBe("connecting");
  });
});

describe("remote limited setup", () => {
  it("uses bootstrap auth and bounded scopes, not the code as a shared gateway token", async () => {
    const { BranchGateway, LIMITED_OPERATOR_SCOPES } = await import("./gateway");
    const url = "wss://nas.example.ts.net:8443";
    const code = btoa(JSON.stringify({ url, bootstrapToken: "bounded-token", expiresAtMs: Date.now() + 60_000 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    new BranchGateway({ url, sharedToken: code, onStatus: () => {}, onEvent: () => {} });
    await fake.client!.options.buildConnectPlan({ nonce: "challenge", challengeTs: Date.now() });
    expect(fake.planParams).toMatchObject({ bootstrapToken: "bounded-token", bootstrapScopes: LIMITED_OPERATOR_SCOPES });
    expect(fake.planParams).not.toHaveProperty("token", code);
  });
});
