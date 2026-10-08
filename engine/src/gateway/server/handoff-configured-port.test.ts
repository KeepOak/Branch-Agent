import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFreePort } from "../../test-utils/ports.js";
import { DESKTOP_GATEWAY_PORT } from "../../mcp/desktop-gateway.js";
import {
  attachGatewayPortAlias,
  isLoopbackPortFree,
  reclaimConfiguredGatewayPort,
  resolveConfiguredDesktopGatewayPort,
  scheduleConfiguredPortReclaim,
} from "./handoff-configured-port.js";

const logs = { info: vi.fn(), warn: vi.fn() };

function createReadyzServer(status = 200): HttpServer {
  return createServer((request, response) => {
    const readyz = request.url === "/readyz" || request.url?.startsWith("/readyz?");
    response.writeHead(readyz ? status : 404, { "content-type": "application/json" });
    response.end(readyz ? JSON.stringify({ ready: status === 200 }) : "");
  });
}

async function listen(server: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function closeServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function probeReadyz(port: number): Promise<number | "down"> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
      signal: AbortSignal.timeout(2_000),
    });
    await response.arrayBuffer().catch(() => undefined);
    return response.status;
  } catch {
    return "down";
  }
}

const servers: HttpServer[] = [];

afterEach(async () => {
  const closing = servers.splice(0);
  await Promise.all(closing.map((server) => closeServer(server)));
  logs.info.mockReset();
  logs.warn.mockReset();
});

describe("resolveConfiguredDesktopGatewayPort", () => {
  it("prefers BRANCH_GATEWAY_PREFERRED_PORT over desktop.json", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "branch-configured-port-"));
    await writeFile(join(dataDir, "desktop.json"), JSON.stringify({ gatewayPort: 19031 }));
    expect(
      resolveConfiguredDesktopGatewayPort({
        BRANCH_GATEWAY_PREFERRED_PORT: "40123",
        BRANCH_DESKTOP_DATA: dataDir,
      }),
    ).toBe(40123);
  });

  it("reads desktop.json and defaults a missing gatewayPort to 19031", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "branch-configured-port-"));
    await writeFile(join(dataDir, "desktop.json"), JSON.stringify({}));
    expect(
      resolveConfiguredDesktopGatewayPort({
        BRANCH_GATEWAY_STANDBY: "1",
        BRANCH_DESKTOP_DATA: dataDir,
      }),
    ).toBe(DESKTOP_GATEWAY_PORT);
    await writeFile(join(dataDir, "desktop.json"), JSON.stringify({ gatewayPort: 40124 }));
    expect(
      resolveConfiguredDesktopGatewayPort({
        BRANCH_GATEWAY_STANDBY: "1",
        BRANCH_DESKTOP_DATA: dataDir,
      }),
    ).toBe(40124);
    expect(resolveConfiguredDesktopGatewayPort({ BRANCH_DESKTOP_DATA: dataDir })).toBeUndefined();
  });

  it("defaults a missing desktop.json to 19031 for a standby", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "branch-configured-port-"));
    expect(
      resolveConfiguredDesktopGatewayPort({
        BRANCH_GATEWAY_STANDBY: "1",
        BRANCH_DESKTOP_DATA: dataDir,
      }),
    ).toBe(DESKTOP_GATEWAY_PORT);
  });

  it("is undefined when this process is not a desktop engine", async () => {
    const home = await mkdtemp(join(tmpdir(), "branch-configured-port-home-"));
    expect(
      resolveConfiguredDesktopGatewayPort({
        HOME: home,
        USERPROFILE: home,
        LOCALAPPDATA: join(home, "AppData", "Local"),
        XDG_DATA_HOME: join(home, ".local", "share"),
      }),
    ).toBeUndefined();
  });
});

describe("reclaimConfiguredGatewayPort", () => {
  it("answers /readyz on the configured port after the predecessor exits", async () => {
    const configuredPort = await getFreePort();
    const livePort = await getFreePort();
    const predecessor = createReadyzServer(200);
    const successor = createReadyzServer(200);
    servers.push(predecessor, successor);
    await listen(predecessor, configuredPort);
    await listen(successor, livePort);
    expect(await probeReadyz(configuredPort)).toBe(200);
    expect(await probeReadyz(livePort)).toBe(200);

    const reclaim = reclaimConfiguredGatewayPort({
      httpServer: successor,
      currentPort: livePort,
      configuredPort,
      log: logs,
      deps: { pollMs: 20, giveUpMs: 5_000 },
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(await probeReadyz(configuredPort)).toBe(200);
    await closeServer(predecessor);

    await expect(reclaim).resolves.toBe("bound");
    expect(await probeReadyz(configuredPort)).toBe(200);
    expect(await probeReadyz(livePort)).toBe(200);
    expect(logs.info).toHaveBeenCalledWith(
      expect.stringContaining(`also listening on the configured port ${configuredPort}`),
    );
  });

  it("does not steal a configured port another process still holds", async () => {
    const configuredPort = await getFreePort();
    const livePort = await getFreePort();
    const other = createServer((_request, response) => {
      response.writeHead(418, { "content-type": "text/plain" });
      response.end("other");
    });
    const successor = createReadyzServer(200);
    servers.push(other, successor);
    await listen(other, configuredPort);
    await listen(successor, livePort);

    await expect(
      reclaimConfiguredGatewayPort({
        httpServer: successor,
        currentPort: livePort,
        configuredPort,
        log: logs,
        deps: { pollMs: 20, giveUpMs: 80 },
      }),
    ).resolves.toBe("busy");

    expect(await probeReadyz(livePort)).toBe(200);
    const held = await fetch(`http://127.0.0.1:${configuredPort}/`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(held.status).toBe(418);
    expect(await held.text()).toBe("other");
    expect(logs.warn).toHaveBeenCalledWith(
      expect.stringContaining(`configured port ${configuredPort} is held by another process`),
    );
  });

  it("is a no-op when already serving on the configured port", async () => {
    const port = await getFreePort();
    const server = createReadyzServer(200);
    servers.push(server);
    await listen(server, port);
    await expect(
      reclaimConfiguredGatewayPort({
        httpServer: server,
        currentPort: port,
        configuredPort: port,
        log: logs,
      }),
    ).resolves.toBe("already");
    expect(logs.info).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it("schedules reclaim from desktop.json and stops when the server closes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "branch-configured-port-"));
    const configuredPort = await getFreePort();
    const holder = createReadyzServer(200);
    servers.push(holder);
    await listen(holder, configuredPort);
    await writeFile(join(dataDir, "desktop.json"), JSON.stringify({ gatewayPort: configuredPort }));
    const livePort = await getFreePort();
    const successor = createReadyzServer(200);
    servers.push(successor);
    await listen(successor, livePort);
    const scheduled = scheduleConfiguredPortReclaim({
      httpServer: successor,
      currentPort: livePort,
      env: { BRANCH_GATEWAY_STANDBY: "1", BRANCH_DESKTOP_DATA: dataDir },
      log: logs,
      deps: { pollMs: 20, giveUpMs: 5_000 },
    });
    await closeServer(successor);
    await expect(scheduled.done).resolves.toBe("stopped");
  });

  it("schedules reclaim of 19031 when desktop.json is missing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "branch-configured-port-"));
    const livePort = await getFreePort();
    const successor = createReadyzServer(200);
    servers.push(successor);
    await listen(successor, livePort);
    const attach = vi.fn().mockResolvedValue({ close() {} });
    const isPortFree = vi.fn().mockResolvedValue(true);
    const scheduled = scheduleConfiguredPortReclaim({
      httpServer: successor,
      currentPort: livePort,
      env: { BRANCH_GATEWAY_STANDBY: "1", BRANCH_DESKTOP_DATA: dataDir },
      log: logs,
      deps: { pollMs: 20, giveUpMs: 5_000, isPortFree, attach },
    });
    await expect(scheduled.done).resolves.toBe("bound");
    expect(isPortFree).toHaveBeenCalledWith(DESKTOP_GATEWAY_PORT);
    expect(attach).toHaveBeenCalledWith(successor, DESKTOP_GATEWAY_PORT);
    expect(logs.info).toHaveBeenCalledWith(
      expect.stringContaining(`also listening on the configured port ${DESKTOP_GATEWAY_PORT}`),
    );
  });
});

describe("attachGatewayPortAlias", () => {
  it("serves the same /readyz handler on the extra port", async () => {
    const livePort = await getFreePort();
    const extraPort = await getFreePort();
    const server = createReadyzServer(200);
    servers.push(server);
    await listen(server, livePort);
    const extra = await attachGatewayPortAlias(server, extraPort);
    try {
      expect(await probeReadyz(livePort)).toBe(200);
      expect(await probeReadyz(extraPort)).toBe(200);
      expect(await isLoopbackPortFree(extraPort)).toBe(false);
    } finally {
      extra.close();
    }
  });
});
