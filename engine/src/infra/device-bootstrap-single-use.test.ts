import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  issueDevicePairSetupBootstrapToken,
  consumeDeviceBootstrapTokenWithSetupCompletion,
} from "./device-bootstrap.js";
import { NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE } from "../shared/device-bootstrap-profile.js";

const tempDirs = createTrackedTempDirs();
const createTempDir = () => tempDirs.make("bootstrap-single-use-test-");

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("bootstrap token single-use enforcement", () => {
  it("rejects reuse of a consumed setup token", async () => {
    const baseDir = await createTempDir();
    
    // Issue a setup token
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    expect(issued.token).toBeTruthy();
    expect(issued.setupId).toBeTruthy();

    // Consume it once (successful pairing)
    const firstConsume = await consumeDeviceBootstrapTokenWithSetupCompletion({
      baseDir,
      token: issued.token,
      deviceId: "device-123",
      completedAtMs: Date.now(),
    });

    expect(firstConsume).not.toBeNull();
    expect(firstConsume?.record.token).toBe(issued.token);

    // Try to consume the same token again (should fail - single use)
    const secondConsume = await consumeDeviceBootstrapTokenWithSetupCompletion({
      baseDir,
      token: issued.token,
      deviceId: "device-456", // different device
      completedAtMs: Date.now(),
    });

    expect(secondConsume).toBeNull();
  });

  it("rejects reuse with the same device ID", async () => {
    const baseDir = await createTempDir();
    
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    // Consume it once
    const firstConsume = await consumeDeviceBootstrapTokenWithSetupCompletion({
      baseDir,
      token: issued.token,
      deviceId: "device-123",
      completedAtMs: Date.now(),
    });

    expect(firstConsume).not.toBeNull();

    // Try to consume again with the same device (should still fail)
    const secondConsume = await consumeDeviceBootstrapTokenWithSetupCompletion({
      baseDir,
      token: issued.token,
      deviceId: "device-123", // same device
      completedAtMs: Date.now() + 1000,
    });

    expect(secondConsume).toBeNull();
  });
});

describe("bootstrap token TTL enforcement", () => {
  it("rejects expired setup token", async () => {
    const baseDir = await createTempDir();
    
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    expect(issued.expiresAtMs).toBeTruthy();
    expect(issued.expiresAtMs).toBeGreaterThan(Date.now());

    // Try to consume after expiry
    const consumeResult = await consumeDeviceBootstrapTokenWithSetupCompletion({
      baseDir,
      token: issued.token,
      deviceId: "device-123",
      completedAtMs: issued.expiresAtMs + 1000,
      nowMs: issued.expiresAtMs + 1000,
    });

    expect(consumeResult).toBeNull();
  });

  it("accepts token before expiry", async () => {
    const baseDir = await createTempDir();
    
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    // Consume before expiry
    const consumeResult = await consumeDeviceBootstrapTokenWithSetupCompletion({
      baseDir,
      token: issued.token,
      deviceId: "device-123",
      completedAtMs: issued.expiresAtMs - 1000,
      nowMs: issued.expiresAtMs - 1000,
    });

    expect(consumeResult).not.toBeNull();
    expect(consumeResult?.record.token).toBe(issued.token);
  });

  it("has a 10-minute TTL", async () => {
    const baseDir = await createTempDir();
    
    const issued = await issueDevicePairSetupBootstrapToken({
      baseDir,
      profile: NODE_PAIRING_SETUP_BOOTSTRAP_PROFILE,
    });

    const ttlMs = issued.expiresAtMs - Date.now();
    
    // Should be approximately 10 minutes (600,000 ms), allowing for test execution time
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000); // At least 9 minutes
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000); // At most 10 minutes
  });
});
