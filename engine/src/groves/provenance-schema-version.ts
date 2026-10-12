import { GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION } from "./provenance-agent-origin.js";

const LEGACY_GROVE_INSTALL_RECORD_SCHEMA_VERSION = "branch.groveInstallRecord.v1" as const;
export const GROVE_INSTALL_RECORD_SCHEMA_VERSION = "branch.groveInstallRecord.v2" as const;
export type GroveInstallRecordSchemaVersion =
  | typeof LEGACY_GROVE_INSTALL_RECORD_SCHEMA_VERSION
  | typeof GROVE_INSTALL_RECORD_SCHEMA_VERSION
  | typeof GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION;

export function parseGroveInstallRecordSchemaVersion(value: string): GroveInstallRecordSchemaVersion {
  if (
    value === LEGACY_GROVE_INSTALL_RECORD_SCHEMA_VERSION ||
    value === GROVE_INSTALL_RECORD_SCHEMA_VERSION ||
    value === GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION
  ) {
    return value;
  }
  throw new Error(`Unsupported Grove install record schema ${JSON.stringify(value)}.`);
}
