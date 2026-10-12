import { stableStringify } from "@branch/normalization-core";
import { redactConfigObject } from "../../config/redact-snapshot.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { sha256Hex } from "../../infra/crypto-digest.js";

let configFingerprints = new WeakMap<BranchConfig, string>();

export function fingerprintSkillSnapshotConfig(config: BranchConfig): string {
  const cached = configFingerprints.get(config);
  if (cached) {
    return cached;
  }
  const fingerprint = sha256Hex(stableStringify(redactConfigObject(config)));
  configFingerprints.set(config, fingerprint);
  return fingerprint;
}

export function resetSkillSnapshotConfigFingerprintCache(): void {
  configFingerprints = new WeakMap();
}
