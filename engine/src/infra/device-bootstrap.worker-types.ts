import { MAX_NODE_BOOTSTRAP_TIMEOUT_MS } from "../gateway/worker-environments/bootstrap-timeouts.js";
import type { DeviceBootstrapProfile } from "../shared/device-bootstrap-profile.js";
import type { DeviceBootstrapTokenRecord, PairedDevice } from "./device-pairing.types.js";

export const DEVICE_BOOTSTRAP_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Shortest lifetime a caller may ask for; anything longer than the default is refused back to the default. */
export const DEVICE_BOOTSTRAP_TOKEN_MIN_TTL_MS = 30 * 1000;

/**
 * A caller-requested shorter lifetime (#1932), clamped to [30 s, the default]. Undefined, non-finite or longer
 * requests keep the default, so existing callers are unchanged.
 */
export function clampDeviceBootstrapTokenTtlMs(ttlMs: number | undefined): number | undefined {
  if (ttlMs === undefined || !Number.isFinite(ttlMs) || ttlMs >= DEVICE_BOOTSTRAP_TOKEN_TTL_MS) {
    return undefined;
  }
  return Math.max(DEVICE_BOOTSTRAP_TOKEN_MIN_TTL_MS, Math.floor(ttlMs));
}

export function resolveDeviceBootstrapTokenExpiresAtMs(
  record: Pick<DeviceBootstrapTokenRecord, "issuedAtMs" | "setupId" | "profile">,
): number {
  const ttlMs =
    record.setupId && record.profile?.purpose === "cloud-worker"
      ? MAX_NODE_BOOTSTRAP_TIMEOUT_MS
      : DEVICE_BOOTSTRAP_TOKEN_TTL_MS;
  return record.issuedAtMs + ttlMs;
}

export type BoundDeviceBootstrapContext = {
  profile: DeviceBootstrapProfile;
  setupId?: string;
};

export type DeviceBootstrapBoundContextInput = {
  token: string;
  deviceId: string;
  publicKey: string;
  nowMs: number;
};

export type CloudWorkerSetupMutationAdmission = {
  environmentId: string;
  setupId: string;
  credentialDigest: string;
  provisionOperationId: string;
  ownerEpoch: number;
};

export type DeviceBootstrapMutationAdmission =
  | { kind: "bootstrap.consume"; pairedDevice: PairedDevice | null; expiresAtMs: number }
  | { kind: "bootstrap.token"; expiresAtMs: number }
  | ({ kind: "bootstrap.cloudWorkerSetup" } & CloudWorkerSetupMutationAdmission);
