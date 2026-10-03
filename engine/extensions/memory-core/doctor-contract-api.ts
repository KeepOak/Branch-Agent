import type { PluginDoctorStateMigration } from "branch/plugin-sdk/runtime-doctor-migrations";
import { ringsCronMigration } from "./src/migration/doctor-rings-cron.js";
import { ringsStateMigration } from "./src/migration/doctor-rings-state.js";
import { hostEventsStateMigration } from "./src/migration/doctor-host-events.js";
import {
  memorySidecarStateMigration,
  qmdLocksStateMigration,
  qmdWorkspaceStateMigration,
} from "./src/migration/doctor-memory-sidecar.js";

export const stateMigrations: PluginDoctorStateMigration[] = [
  hostEventsStateMigration,
  ringsStateMigration,
  ringsCronMigration,
  memorySidecarStateMigration,
  qmdWorkspaceStateMigration,
  qmdLocksStateMigration,
];
