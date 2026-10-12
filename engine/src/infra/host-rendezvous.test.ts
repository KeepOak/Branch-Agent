import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGatewayLockProcessStartTime } from "./gateway-lock-process.js";
import {
  HOST_PROTOCOL_VERSION,
  hostRecordPath,
  parseHostRecord,
  prepareHostRendezvous,
  probeHostOwner,
  readHostRecord,
  resolveHostStateDir,
  type HostRecord,
} from "./host-rendezvous.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function isolatedEnv(): Promise<NodeJS.ProcessEnv> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-host-rendezvous-"));
  dirs.push(dir);
  return { ...process.env, BRANCH_GATEWAY_HOST_LOCK_DIR: dir };
}

function record(overrides: Partial<HostRecord> = {}): HostRecord {
  return {
    role: "gateway",
    pid: process.pid,
    createTime: null,
    host: "127.0.0.1",
    port: 32123,
    gatewayPort: 32124,
    protocolVersion: HOST_PROTOCOL_VERSION,
    tokenFingerprint: createHash("sha256").update("token").digest("hex").slice(0, 16),
    profiles: ["default"],
    updatedAt: new Date().toISOString(),
    home: os.homedir(),
    ...overrides,
  };
}

describe("Hermes host rendezvous", () => {
  it("uses one host lock directory across profiles of a user and isolates other tenants", () => {
    const base = { BRANCH_HOME: path.join(os.homedir(), "tenant") };
    expect(resolveHostStateDir({ ...base, BRANCH_PROFILE: "work" })).toBe(
      resolveHostStateDir({ ...base, BRANCH_PROFILE: "default" }),
    );
    expect(resolveHostStateDir(base)).not.toBe(
      resolveHostStateDir({ BRANCH_HOME: path.join(os.homedir(), "another-tenant") }),
    );
  });

  it("never attaches to a record without a live authenticated owner", async () => {
    const env = await isolatedEnv();
    const candidate = record();
    await fs.writeFile(hostRecordPath(env), JSON.stringify(candidate), { mode: 0o600 });
    expect(await readHostRecord(env)).toMatchObject({ pid: process.pid });
    expect(await probeHostOwner(candidate, env)).toBeUndefined();
  });

  it("ignores incompatible protocol and PID-recycled records", async () => {
    const env = await isolatedEnv();
    await fs.writeFile(hostRecordPath(env), JSON.stringify(record({ protocolVersion: 2 })), {
      mode: 0o600,
    });
    expect(await readHostRecord(env)).toBeUndefined();
    expect(parseHostRecord(record({ profiles: ["default"] }))).toBeDefined();
    await fs.writeFile(hostRecordPath(env), JSON.stringify(record({ pid: 999_999_999 })), {
      mode: 0o600,
    });
    expect(await readHostRecord(env)).toBeUndefined();
    await fs.writeFile(hostRecordPath(env), JSON.stringify(record({ createTime: -1 })), {
      mode: 0o600,
    });
    if (readGatewayLockProcessStartTime(process.pid, process.platform, 1_000) !== null) {
      expect(await readHostRecord(env)).toBeUndefined();
    }
  });

  it("publishes a private authenticated owner and retracts it on close", async () => {
    const env = await isolatedEnv();
    const rendezvous = await prepareHostRendezvous({
      env,
      profile: "default",
      home: os.homedir(),
      gatewayPort: 32124,
      allowInTests: true,
    });
    try {
      expect(rendezvous.decision.outcome).toBe("start");
      const published = await readHostRecord(env);
      expect(published).toMatchObject({ gatewayPort: 32124, profiles: [] });
      expect(await probeHostOwner(published!, env)).toMatchObject({
        servedKnown: false,
        profiles: [],
      });
      await rendezvous.markReady?.();
      expect(await probeHostOwner((await readHostRecord(env))!, env)).toMatchObject({
        servedKnown: true,
        profiles: ["default"],
      });
      if (process.platform !== "win32") {
        expect((await fs.stat(hostRecordPath(env))).mode & 0o077).toBe(0);
      }
    } finally {
      await rendezvous.close?.();
    }
    expect(await readHostRecord(env)).toBeUndefined();
  });

  it("attaches a second launch to the ready owner without claiming another host", async () => {
    const env = await isolatedEnv();
    const first = await prepareHostRendezvous({
      env,
      profile: "default",
      home: os.homedir(),
      gatewayPort: 32124,
      allowInTests: true,
    });
    try {
      await first.markReady?.();
      const second = await prepareHostRendezvous({
        env,
        profile: "default",
        home: os.homedir(),
        gatewayPort: 32125,
        allowInTests: true,
      });
      expect(second.decision).toMatchObject({
        outcome: "attach",
        owner: { port: 32124, profiles: ["default"] },
      });
      expect(second.markReady).toBeUndefined();
      expect((await readHostRecord(env))?.gatewayPort).toBe(32124);
    } finally {
      await first.close?.();
    }
  });

  it("keeps another standalone profile on its own state owner", async () => {
    const env = await isolatedEnv();
    const first = await prepareHostRendezvous({
      env,
      profile: "default",
      home: os.homedir(),
      gatewayPort: 32124,
      allowInTests: true,
    });
    try {
      await first.markReady?.();
      const second = await prepareHostRendezvous({
        env,
        profile: "work",
        home: os.homedir(),
        gatewayPort: 32125,
        replace: true,
        allowInTests: true,
      });
      expect(second.decision.outcome).toBe("start");
      expect(second.markReady).toBeUndefined();
      expect((await readHostRecord(env))?.gatewayPort).toBe(32124);
    } finally {
      await first.close?.();
    }
  });
});
