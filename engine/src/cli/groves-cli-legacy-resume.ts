import { readGroveInstallRecord, type PersistedGroveInstall } from "../groves/provenance.js";
import type { GroveManifest, GroveSourceIdentity } from "../groves/types.js";
import type { GrovesAddOptions } from "./groves-cli.js";

export function authorizeLegacyV1Resume(params: {
  manifest: GroveManifest;
  source: Pick<GroveSourceIdentity, "kind" | "name" | "version" | "packageRoot" | "manifestPath">;
  opts: GrovesAddOptions;
}): PersistedGroveInstall | undefined {
  const finalAgentId = params.opts.agentId?.trim() || params.manifest.agent?.id?.trim();
  const consentPlanIntegrity = params.opts.planIntegrity?.trim();
  if (!finalAgentId || !consentPlanIntegrity) {
    return undefined;
  }
  const record = readGroveInstallRecord(finalAgentId);
  if (
    !record ||
    record.schemaVersion !== "branch.groveInstallRecord.v1" ||
    record.status === "complete" ||
    record.planIntegrity !== consentPlanIntegrity ||
    record.grove.kind !== params.source.kind ||
    record.grove.name !== params.source.name ||
    record.grove.version !== params.source.version ||
    record.grove.packageRoot !== params.source.packageRoot ||
    record.grove.manifestPath !== params.source.manifestPath
  ) {
    return undefined;
  }
  return record;
}
