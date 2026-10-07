// The desktop app swaps the engine underneath an open window and then says so (`branch:engine-ready`);
// the window must reconnect at once instead of waiting out the reconnect backoff (up to 15 s).
import { describe, expect, it, vi } from "vitest";

type ClientOptions = { onHello: (hello: unknown) => void; onClose: (context: unknown, decision: { retry: boolean }) => void };

const fake = vi.hoisted(() => ({ client: null as null | { options: ClientOptions; starts: number; stops: number } }));

vi.mock("@branch/gateway-client/browser", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    GatewayBrowserDeviceAuthLifecycle: class {},
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
