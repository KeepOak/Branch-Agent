import { afterEach, describe, expect, it, vi } from "vitest";
import { NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE } from "../shared/device-bootstrap-profile.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  consumeDeviceBootstrapTokenWithSetupCompletion,
  issueDevicePairSetupBootstrapToken,
  verifyDeviceBootstrapToken,
} from "./device-bootstrap.js";

const tempDirs = createTrackedTempDirs();
const createTempDir = () => tempDirs.make("bootstrap-single-use-test-");

afterEach(async () => {
  vi.useRealTimers();
  await closeBranchStateDatabaseAsync();
  closeBranchStateDatabaseForTest();
  await tempDirs.cleanup();
});

async function bindToken(baseDir: string, token: string, deviceId = "device-123") {
  await expect(
    verifyDeviceBootstrapToken({
      token,
      deviceId,
      publicKey: "public-key-123",
      role: "node",
      scopes: [],
      baseDir,
    }),
  ).resolves.toEqual({ ok: true });
}

function consumeToken(
  baseDir: string,
  token: string,
  deviceId = "device-123",
  completedAtMs = Date.now(),
) {
  return consumeDeviceBootstrapTokenWithSetupCompletion({
    baseDir,
    token,
    deviceId,
    completedAtMs,
  });
}

describe("bootstrap token single-use enforcement", () => {
  it("rejects reuse of a consumed setup token", async () => {
    const baseDir = await createTempDir();
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    await bindToken(baseDir, issued.token);
    await expect(consumeToken(baseDir, issued.token)).resolves.toMatchObject({
      record: { token: issued.token },
    });
    await expect(
      consumeToken(baseDir, issued.token, "device-456"),
    ).resolves.toBeNull();
  });

  it("rejects reuse with the same device ID", async () => {
    const baseDir = await createTempDir();
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    await bindToken(baseDir, issued.token);
    await expect(consumeToken(baseDir, issued.token)).resolves.not.toBeNull();
    await expect(consumeToken(baseDir, issued.token)).resolves.toBeNull();
  });
});

describe("bootstrap token TTL enforcement", () => {
  it("rejects expired setup token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00Z"));
    const baseDir = await createTempDir();
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    expect(issued.expiresAtMs).toBe(Date.now() + 10 * 60 * 1000);
    await bindToken(baseDir, issued.token);
    vi.setSystemTime(issued.expiresAtMs + 1);
    await expect(consumeToken(baseDir, issued.token, "device-123", Date.now())).resolves.toBeNull();
  });

  it("accepts token before expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00Z"));
    const baseDir = await createTempDir();
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    await bindToken(baseDir, issued.token);
    vi.setSystemTime(issued.expiresAtMs - 1);
    await expect(consumeToken(baseDir, issued.token, "device-123", Date.now())).resolves.toMatchObject(
      {
        record: { token: issued.token },
      },
    );
  });

  it("has a 10-minute TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00Z"));
    const baseDir = await createTempDir();
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });
    expect(issued.expiresAtMs - Date.now()).toBe(10 * 60 * 1000);
  });
});
