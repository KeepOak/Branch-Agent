// #2100: the host gets a new DHCP address. The link finds it again by its mDNS name and saves the new address,
// with no new setup code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findGraftHostAddresses, learnGraftHostName, movedGraftUrl } from "./graft-host-lookup.js";
import {
  readGraftLinks,
  replaceGraftLink,
  resolveGraftLink,
  saveGraftLink,
  type GraftLink,
} from "./graft-join.js";
import { GraftLinkResults } from "./graft-link-results.js";
import {
  GraftLinkRunner,
  GraftLinkSupervisor,
  type LinkClient,
  type LinkHandlers,
} from "./graft-link.js";

const OLD = "ws://192.168.1.20:41010";
const NEW = "ws://192.168.1.37:41010";
const studio = {
  instanceName: "studio (Branch Agent)",
  host: "studio.local.",
  port: 41010,
  gatewayPort: 41010,
  lanHost: "studio.local",
};

type Made = { url: string; handlers: LinkHandlers; started: number; stopped: number };
function clients() {
  const made: Made[] = [];
  const create = (handlers: LinkHandlers, url: string): LinkClient => {
    const entry: Made = { url, handlers, started: 0, stopped: 0 };
    made.push(entry);
    return {
      start: () => void entry.started++,
      stop: () => void entry.stopped++,
      request: async () => ({}),
    };
  };
  return { made, create };
}
const flush = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
const unreachable = () => new Error("connect EHOSTUNREACH 192.168.1.20:41010");

let dir: string;
let oldStateDir: string | undefined;
beforeEach(() => {
  oldStateDir = process.env.BRANCH_STATE_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "graft-host-moved-"));
  process.env.BRANCH_STATE_DIR = dir;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  if (oldStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = oldStateDir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function runnerFor(link: GraftLink, hostAt: () => string[]) {
  const { made, create } = clients();
  const lines: string[] = [];
  const findHost = vi.fn(async (hostName: string, port: number) =>
    hostName === "studio.local" && port === 41010 ? hostAt() : [],
  );
  const runner = new GraftLinkRunner({
    link,
    trunks: async () => [],
    createClient: create,
    forget: vi.fn(),
    log: (line) => lines.push(line),
    findHost,
    learnHostName: async (url) => (url === OLD ? "studio.local" : undefined),
    save: (fromUrl, next) => replaceGraftLink(fromUrl, next),
  });
  return { runner, made, lines, findHost };
}

describe("a graft link whose host got a new DHCP address (#2100)", () => {
  it("finds the host by its name, moves to the new address and saves it, with no new setup code", async () => {
    const joined: GraftLink = { url: OLD, name: "Branch B", joinedAt: 1 };
    saveGraftLink(joined);
    let hostIp = "192.168.1.20";
    const { runner, made, lines } = runnerFor(joined, () => [hostIp]);
    runner.start();
    made[0]!.handlers.onHello();
    await flush();
    // Connected at the joined address: the link learned the host's mDNS name and saved it.
    expect(readGraftLinks()).toEqual([{ ...joined, hostName: "studio.local" }]);

    // The router hands the host a new address; the old one stops answering.
    hostIp = "192.168.1.37";
    made[0]!.handlers.onClose();
    made[0]!.handlers.onConnectError?.(unreachable());
    await flush();

    expect(made.map((client) => client.url)).toEqual([OLD, NEW]);
    expect(made[0]!.stopped).toBe(1);
    expect(made[1]!.started).toBe(1);
    expect(runner.url).toBe(NEW);
    expect(readGraftLinks()).toEqual([
      { ...joined, url: NEW, hostName: "studio.local", joinedUrl: OLD },
    ]);
    expect(lines.join("\n")).toContain("studio.local moved to " + NEW);
    expect(lines.join("\n")).not.toContain("rejoin");

    made[1]!.handlers.onHello();
    await flush();
    expect(runner.state).toBe("connected");
    runner.stop();
  });

  it("keeps retrying the saved address while the host is still there, and looks it up at most every 30 seconds", async () => {
    const link: GraftLink = { url: OLD, name: "Branch B", joinedAt: 1, hostName: "studio.local" };
    const { runner, made, findHost } = runnerFor(link, () => ["192.168.1.20"]);
    runner.start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      made[0]!.handlers.onConnectError?.(unreachable());
      await flush();
    }
    expect(findHost).toHaveBeenCalledTimes(1);
    expect(made.map((client) => client.url)).toEqual([OLD]);
    vi.advanceTimersByTime(30_000);
    made[0]!.handlers.onConnectError?.(unreachable());
    await flush();
    expect(findHost).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("stays put when the host's name can't be found on the network", async () => {
    const link: GraftLink = { url: OLD, name: "Branch B", joinedAt: 1, hostName: "studio.local" };
    const { runner, made, lines } = runnerFor(link, () => []);
    runner.start();
    made[0]!.handlers.onConnectError?.(unreachable());
    await flush();
    expect(made.map((client) => client.url)).toEqual([OLD]);
    expect(runner.state).toBe("connecting");
    expect(lines[0]).toContain("looking for studio.local on the network");
    runner.stop();
  });

  it("keeps the same running link after it moved, and lists its state at the new address", async () => {
    let saved: GraftLink[] = [
      { url: OLD, name: "Branch B", joinedAt: 1, hostName: "studio.local" },
    ];
    const created: { url: string; state: string; start: () => void; stop: () => void }[] = [];
    const supervisor = new GraftLinkSupervisor({
      links: () => saved,
      createRunner: (link) => {
        const runner = { url: link.url, state: "connected", start: vi.fn(), stop: vi.fn() };
        created.push(runner);
        return runner as never;
      },
    });
    supervisor.sync();
    saved = [{ ...saved[0]!, url: NEW, joinedUrl: OLD }];
    created[0]!.url = NEW;
    supervisor.sync();
    expect(created).toHaveLength(1);
    expect(created[0]!.stop).not.toHaveBeenCalled();
    expect(supervisor.states()).toEqual({ [NEW]: "connected" });
    supervisor.stop();
  });

  it("still finds the moved link by the address it was joined with, and keeps its saved results", () => {
    const joined: GraftLink = { url: OLD, name: "Branch B", joinedAt: 7 };
    saveGraftLink(joined);
    new GraftLinkResults(joined).save("job-1", { reply: "done before the move" });
    const moved = { ...joined, url: NEW, hostName: "studio.local", joinedUrl: OLD };
    replaceGraftLink(OLD, moved);
    expect(resolveGraftLink(OLD)).toEqual(moved);
    expect(resolveGraftLink("studio.local")).toEqual(moved);
    expect(new GraftLinkResults(moved).pending()).toEqual({
      id: "job-1",
      result: { reply: "done before the move" },
    });
  });

  it("never brings back a host that was forgotten while the link was moving", () => {
    replaceGraftLink(OLD, { url: NEW, name: "Branch B", joinedAt: 1, joinedUrl: OLD });
    expect(readGraftLinks()).toEqual([]);
  });
});

describe("looking a graft host up by name", () => {
  it("learns the host's mDNS name from the beacon at the link's address and port", async () => {
    const other = { ...studio, lanHost: "attic.local", host: "attic.local." };
    const resolve = async (name: string) =>
      name === "studio.local" ? ["192.168.1.20"] : ["192.168.1.99"];
    await expect(
      learnGraftHostName(OLD, { discover: async () => [other, studio], resolve }),
    ).resolves.toBe("studio.local");
    await expect(
      learnGraftHostName("ws://192.168.1.20:41011", { discover: async () => [studio], resolve }),
    ).resolves.toBeUndefined();
    // A tailnet name does not change with the router: nothing to learn.
    await expect(
      learnGraftHostName("wss://studio.tail1234.ts.net", {
        discover: async () => [studio],
        resolve,
      }),
    ).resolves.toBeUndefined();
  });

  it("finds the host's addresses through the system resolver, else its own beacon", async () => {
    await expect(
      findGraftHostAddresses("studio.local", 41010, { resolve: async () => ["192.168.1.37"] }),
    ).resolves.toEqual(["192.168.1.37"]);
    const windowsBeacon = { ...studio, host: "192.168.1.37" };
    await expect(
      findGraftHostAddresses("studio.local", 41010, {
        resolve: async () => {
          throw new Error("ENOTFOUND studio.local");
        },
        discover: async () => [
          windowsBeacon,
          { ...windowsBeacon, gatewayPort: 41011, host: "192.168.1.50" },
        ],
      }),
    ).resolves.toEqual(["192.168.1.37"]);
  });

  it("moves only the address, keeping the scheme and port", () => {
    expect(movedGraftUrl(OLD, ["192.168.1.37"])).toBe(NEW);
    expect(movedGraftUrl("wss://192.168.1.20:41010", ["192.168.1.37"])).toBe(
      "wss://192.168.1.37:41010",
    );
    expect(movedGraftUrl(OLD, ["192.168.1.37", "192.168.1.20"])).toBeUndefined();
    expect(movedGraftUrl(OLD, [])).toBeUndefined();
  });
});
