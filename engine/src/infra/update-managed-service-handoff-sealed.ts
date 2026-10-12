import "./sealed-runtime-bootstrap.js";

export { BRANCH_STATE_SCHEMA_SQL } from "../state/branch-state-schema.js";
export { assertBranchStateWriteAllowed } from "../state/branch-state-ownership.js";
export { resolveImmutableSqliteFileUri } from "./node-sqlite.js";
export {
  readRestartSentinelRowSync,
  writeRestartSentinelRowIfRevisionSync,
} from "./restart-sentinel-store.js";
export { extractSqliteTableSchema } from "./sqlite-schema-sql.js";
export { createManagedHandoffLeaseStore } from "./update-managed-service-handoff-lease.js";

export {
  resolveUpdateRestartNoticeMeta,
  shouldPublishUpdateRestartNotice,
} from "./update-restart-notice.js";
