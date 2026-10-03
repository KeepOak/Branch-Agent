import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBranchRoot } from "./src/crabbox-worker-profile.js";
import {
  CRABBOX_CLOUD_WORKER_PROFILE_CHECK_ID,
  type CrabboxDoctorRegistrationHost,
  registerCrabboxWorkerProviderDoctorChecks as registerChecks,
} from "./src/doctor.js";

const CRABBOX_PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url));

export { CRABBOX_CLOUD_WORKER_PROFILE_CHECK_ID };

export function registerWorkerProviderDoctorChecks(
  host: Omit<CrabboxDoctorRegistrationHost, "branchRoot">,
): void {
  registerChecks({
    ...host,
    branchRoot: resolveBranchRoot(CRABBOX_PLUGIN_ROOT),
  });
}
