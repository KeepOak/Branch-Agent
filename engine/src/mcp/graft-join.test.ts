import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({}) }));
const runtimePort = vi.hoisted(() => vi.fn(async (): Promise<number | undefined> => undefined));
vi.mock("../infra/gateway-lock.js", () => ({ readActiveGatewayLockPort: runtimePort }));

import { graftInviteParams } from "../cli/graft-cli.js";
import {
  graftBranchIdentity,
  graftTrunkIdentity,
  isSelfGraftLink,
  joinHost,
  pendingPairingRequestId,
  readGraftLinks,
  resolveGraftLink,
  resolveGraftGatewayPort,
  saveGraftLink,
  type ConnectOutcome,
} from "./graft-join.js";

const dirs: string[] = [];
function scratchEnv(): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-graft-join-"));
  dirs.push(dir);
  return { ...process.env, BRANCH_STATE_DIR: dir };
}
afterEach(() => {
  runtimePort.mockReset();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const pending = (requestId: string): ConnectOutcome => ({
  ok: false,
  pendingRequestId: requestId,
  message: `pairing required (requestId: ${requestId})`,
});

describe("branch graft join", () => {
  it("joins at once when the host approves the setup code's device silently", async () => {
    const connect = vi.fn(async (): Promise<ConnectOutcome> => ({
      ok: true,
      deviceId: "dev-b",
      scopes: ["operator.read", "operator.write"],
    }));
    const onPending = vi.fn();
    await expect(joinHost({ connect, onPending, sleep: async () => undefined })).resolves.toEqual({
      deviceId: "dev-b",
      scopes: ["operator.read", "operator.write"],
    });
    expect(onPending).not.toHaveBeenCalled();
  });

  it("waits for the host's approval, naming the pending request once, then joins", async () => {
    const outcomes: ConnectOutcome[] = [
      pending("req-1"),
      pending("req-1"),
      { ok: true, deviceId: "dev-b", scopes: ["operator.read", "operator.write"] },
    ];
    const connect = vi.fn(async () => outcomes.shift()!);
    const onPending = vi.fn();
    const sleep = vi.fn(async () => undefined);
    const joined = await joinHost({ connect, onPending, sleep });
    expect(joined.deviceId).toBe("dev-b");
    expect(connect).toHaveBeenCalledTimes(3);
    expect(onPending).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenCalledWith("req-1");
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("stops on a refusal and when approval does not come before the code expires", async () => {
    await expect(
      joinHost({
        connect: async () => ({ ok: false, message: "device pairing rejected" }),
        onPending: () => undefined,
      }),
    ).rejects.toThrow("device pairing rejected");
    let now = 0;
    await expect(
      joinHost({
        connect: async () => pending("req-2"),
        onPending: () => undefined,
        sleep: async () => {
          now += 3_000;
        },
        now: () => now,
        waitMs: 6_000,
      }),
    ).rejects.toThrow("did not approve this Branch in time (request req-2)");
  });

  it("reads the pending request id from the host's details or close reason", () => {
    expect(
      pendingPairingRequestId({
        details: { code: "PAIRING_REQUIRED", requestId: "abc-123", reason: "not-paired" },
      }),
    ).toBe("abc-123");
    expect(pendingPairingRequestId(new Error("pairing required (requestId: r-9)"))).toBe("r-9");
    expect(pendingPairingRequestId(new Error("connect timeout"))).toBeUndefined();
  });

  it("names the Branch after itself and binds each Trunk to it", () => {
    const branch = graftBranchIdentity("Studio Laptop", "studio");
    expect(branch).toEqual({
      id: "branch-studio-laptop",
      name: "Studio Laptop",
      kind: "branch",
      where: "studio",
    });
    expect(graftTrunkIdentity(branch, { id: "scout", name: "Scout" })).toEqual({
      id: "branch-studio-laptop--scout",
      name: "Scout",
      kind: "trunk",
      via: "branch-studio-laptop",
      trunkId: "scout",
      where: "Studio Laptop",
    });
    expect(graftTrunkIdentity(branch, { id: "scout", name: "Scout", avatar: "branch:ember" }).avatar).toBe("branch:ember");
    expect(graftTrunkIdentity(branch, { id: "main" }).name).toBe("main");
    expect(graftBranchIdentity("Branch B").id).toBe("branch-b");
    expect(graftBranchIdentity("Branch").id).toBe("branch");
  });

  it("remembers the host and finds it again for branch graft --host", () => {
    const env = scratchEnv();
    expect(() => resolveGraftLink("", env)).toThrow("has not joined another Branch yet");
    saveGraftLink({ url: "ws://127.0.0.1:41001", name: "B", joinedAt: 1 }, env);
    saveGraftLink({ url: "ws://127.0.0.1:41001", name: "B2", joinedAt: 2 }, env);
    expect(readGraftLinks(env)).toEqual([{ url: "ws://127.0.0.1:41001", name: "B2", joinedAt: 2 }]);
    expect(resolveGraftLink("", env).name).toBe("B2");
    expect(resolveGraftLink("ws://127.0.0.1:41001", env).name).toBe("B2");
    expect(() => resolveGraftLink("ws://10.0.0.5:18789", env)).toThrow(
      "has not joined ws://10.0.0.5:18789",
    );
  });

  it("rejects its own gateway on loopback or a local interface but keeps other ports and hosts", () => {
    const interfaces = {
      ethernet: [{
        address: "192.0.2.10", family: "IPv4", internal: false,
        netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: "192.0.2.0/24",
      }],
    };
    const self = (url: string) => isSelfGraftLink({ url }, 41001, interfaces, "my-branch");
    expect(self("ws://localhost:41001")).toBe(true);
    expect(self("ws://127.0.0.1:41001")).toBe(true);
    expect(self("ws://192.0.2.10:41001")).toBe(true);
    expect(self(`ws://[${":".repeat(2)}ffff:${interfaces.ethernet[0].address}]:41001`)).toBe(true);
    expect(self("ws://my-branch:41001")).toBe(true);
    expect(self("ws://192.0.2.10:41002")).toBe(false);
    expect(self("ws://192.0.2.11:41001")).toBe(false);
    const env = { ...scratchEnv(), BRANCH_GATEWAY_PORT: "41001" };
    expect(() => saveGraftLink({ url: "ws://localhost:41001", name: "Self", joinedAt: 1 }, env))
      .toThrow("this Branch's own gateway");
    expect(readGraftLinks(env)).toEqual([]);
  });

  it("recognizes IPv6 loopback and IPv4-mapped IPv6 addresses", () => {
    const loopback = `${":".repeat(2)}1`;
    const mapped = `${":".repeat(2)}ffff:${[127, 0, 0, 1].join(".")}`;
    for (const host of [loopback, mapped]) {
      expect(isSelfGraftLink({ url: `ws://[${host}]:41001` }, 41001, {})).toBe(true);
      expect(isSelfGraftLink({ url: `ws://[${host}]:41002` }, 41001, {})).toBe(false);
    }
  });

  it.each(["ws", "http", "wss", "https"])(
    "recognizes explicit and implicit default ports for %s",
    (protocol) => {
      const port = protocol === "ws" || protocol === "http" ? 80 : 443;
      for (const url of [`${protocol}://localhost`, `${protocol}://localhost:${port}`]) {
        expect(isSelfGraftLink({ url }, port, {})).toBe(true);
        expect(isSelfGraftLink({ url }, port + 1, {})).toBe(false);
        const env = { ...scratchEnv(), BRANCH_GATEWAY_PORT: String(port) };
        expect(() => saveGraftLink({ url, name: "Self", joinedAt: 1 }, env)).toThrow(
          "this Branch's own gateway",
        );
        expect(readGraftLinks(env)).toEqual([]);
      }
    },
  );

  it("uses the verified listen port instead of the configured port for a --port override", async () => {
    const env = { ...scratchEnv(), BRANCH_GATEWAY_PORT: "41001" };
    runtimePort.mockResolvedValueOnce(41002);
    const port = await resolveGraftGatewayPort(env);
    expect(port).toBe(41002);
    expect(runtimePort).toHaveBeenCalledWith({ env });
    expect(() =>
      saveGraftLink({ url: "ws://localhost:41002", name: "Self", joinedAt: 1 }, env, port),
    ).toThrow("this Branch's own gateway");
    saveGraftLink({ url: "ws://localhost:41001", name: "Other", joinedAt: 1 }, env, port);
    expect(readGraftLinks(env)).toHaveLength(1);
    runtimePort.mockResolvedValueOnce(undefined);
    expect(await resolveGraftGatewayPort(env)).toBe(41001);
  });

  it("invites with a loopback address unless the owner opened the gateway to the network", () => {
    expect(graftInviteParams({} as never, 41002)).toEqual({
      includeQr: false,
      bootstrapProfile: "limited",
      publicUrl: "ws://127.0.0.1:41002",
    });
    expect(graftInviteParams({ gateway: { bind: "loopback" } } as never, 41002).publicUrl).toBe(
      "ws://127.0.0.1:41002",
    );
    expect(graftInviteParams({ gateway: { bind: "lan" } } as never, 41002)).toEqual({
      includeQr: false,
      bootstrapProfile: "limited",
    });
  });
});
