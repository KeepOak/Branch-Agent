import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { untilInitialized } from "./channel-server.js";
import { desktopDataForEnvToken, liveDesktopGatewayUrl } from "./desktop-gateway.js";
import { planGraftFast } from "./graft-fast.js";

const dirs: string[] = [];
function tokenFile(value: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-graft-fast-"));
  dirs.push(dir);
  const file = path.join(dir, "token");
  fs.writeFileSync(file, `${value}\r\n`);
  return file;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const noDesktop = () => undefined;
const desktop = () => ({
  url: "ws://127.0.0.1:19031",
  token: "desktop-token",
  dataDir: "/desktop-data",
});
/** A desktop data directory with its token file and the live port an update moved the engine to. */
function desktopData(token: string, livePort?: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-graft-desktop-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "gateway-token"), `${token}\n`);
  if (livePort) {
    fs.writeFileSync(path.join(dir, "gateway-port"), String(livePort));
  }
  return dir;
}
const argv = (...args: string[]) => ["node", "branch.mjs", ...args];

describe("Graft fast start", () => {
  it("starts on the desktop's gateway for branch graft and branch mcp serve", () => {
    for (const command of [["graft"], ["mcp", "serve"]]) {
      expect(planGraftFast(argv(...command), {}, desktop)).toEqual({
        gatewayUrl: "ws://127.0.0.1:19031",
        gatewayToken: "desktop-token",
        claudeChannelMode: "auto",
        verbose: false,
        followDesktopPort: { dataDir: "/desktop-data" },
      });
    }
  });

  it("uses the gateway the branch command names (token and port in its environment)", () => {
    expect(
      planGraftFast(
        argv("graft", "-v"),
        { BRANCH_GATEWAY_TOKEN: "t", BRANCH_GATEWAY_PORT: "19031" },
        noDesktop,
        () => undefined,
      ),
    ).toEqual({
      gatewayUrl: "ws://127.0.0.1:19031",
      gatewayToken: "t",
      claudeChannelMode: "auto",
      verbose: true,
    });
  });

  it("follows the desktop's live port when the branch command names the desktop's own token", () => {
    // The desktop's branch shim exports its token, its data folder and the port that was live when it ran.
    const dataDir = desktopData("desktop-token", 40123);
    const env = {
      BRANCH_GATEWAY_TOKEN: "desktop-token",
      BRANCH_GATEWAY_PORT: "19031",
      BRANCH_DATA: dataDir,
    };
    const plan = planGraftFast(argv("mcp", "serve"), env, noDesktop);
    expect(plan).toEqual({
      gatewayUrl: "ws://127.0.0.1:19031",
      gatewayToken: "desktop-token",
      claudeChannelMode: "auto",
      verbose: false,
      followDesktopPort: { dataDir },
    });
    // Every reconnect re-reads the live port; the launch-time env port no longer pins it.
    expect(liveDesktopGatewayUrl(plan!.followDesktopPort!.dataDir)).toBe("ws://127.0.0.1:40123");
    fs.writeFileSync(path.join(dataDir, "gateway-port"), "40124");
    expect(liveDesktopGatewayUrl(dataDir)).toBe("ws://127.0.0.1:40124");
  });

  it("finds the desktop through its default data folder for branch shims that did not export it", () => {
    const dataDir = desktopData("desktop-token");
    expect(
      desktopDataForEnvToken({
        BRANCH_GATEWAY_TOKEN: "desktop-token",
        BRANCH_DESKTOP_DATA: dataDir,
      }),
    ).toBe(dataDir);
  });

  it("never follows a desktop port for a token that is not the desktop's", () => {
    const dataDir = desktopData("desktop-token", 40123);
    const env = {
      BRANCH_GATEWAY_TOKEN: "other",
      BRANCH_GATEWAY_PORT: "18789",
      BRANCH_DATA: dataDir,
      BRANCH_DESKTOP_DATA: dataDir,
    };
    expect(desktopDataForEnvToken(env)).toBeUndefined();
    expect(planGraftFast(argv("graft"), env, noDesktop)?.followDesktopPort).toBeUndefined();
  });

  it("uses --url with a token file, and keeps the channel mode", () => {
    const file = tokenFile("secret");
    expect(
      planGraftFast(
        argv(
          "mcp",
          "serve",
          "--url",
          "ws://10.0.0.2:18789",
          `--token-file=${file}`,
          "--claude-channel-mode",
          "off",
        ),
        {},
        desktop,
      ),
    ).toEqual({
      gatewayUrl: "ws://10.0.0.2:18789",
      gatewayToken: "secret",
      claudeChannelMode: "off",
      verbose: false,
    });
  });

  it("leaves everything else to the full CLI", () => {
    const full = [
      argv("graft", "--help"),
      argv("graft", "--token", "inline-secret"),
      argv("graft", "--url", "ws://10.0.0.2:18789"),
      argv("graft", "--unknown"),
      argv("graft", "--claude-channel-mode", "loud"),
      argv("mcp", "list"),
      argv("gateway"),
    ];
    for (const args of full) expect(planGraftFast(args, {}, desktop)).toBeUndefined();
    expect(planGraftFast(argv("graft"), {}, noDesktop)).toBeUndefined();
    expect(planGraftFast(argv("graft"), { BRANCH_GRAFT_FULL_CLI: "1" }, desktop)).toBeUndefined();
    expect(planGraftFast(argv("graft"), { BRANCH_GATEWAY_TOKEN: "t" }, desktop)).toBeUndefined();
  });
});

describe("the Gateway client loads after the MCP handshake", () => {
  type Server = Parameters<typeof untilInitialized>[0];
  it("waits for the client's initialized notice and keeps the existing handler", async () => {
    const calls: string[] = [];
    const server = { server: { oninitialized: () => calls.push("presence") } } as unknown as Server;
    const waiting = untilInitialized(server, 60_000).then(() => calls.push("start"));
    server.server.oninitialized?.();
    await waiting;
    expect(calls).toEqual(["presence", "start"]);
    server.server.oninitialized?.();
    expect(calls).toEqual(["presence", "start", "presence"]);
  });

  it("starts anyway when a client never sends initialized", async () => {
    const server = { server: {} } as unknown as Server;
    const started = Date.now();
    await untilInitialized(server, 50);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
