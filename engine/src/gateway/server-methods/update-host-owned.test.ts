import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import * as ocmUpdate from "../../infra/ocm-update-client.js";
import * as packageRoot from "../../infra/branch-root.js";
import * as updateLedger from "../../infra/update-run-ledger.js";
import {
  adoptUpdateCampaignMock,
  invokeUpdateRun,
  resolveUpdateInstallSurfaceMock,
  scheduleGatewayRestartMock,
  sentinelState,
  startManagedServiceUpdateHandoffMock,
} from "./update.test-harness.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => vi.restoreAllMocks());

it("refuses an app-owned Gateway update before delegation, history, or restart effects", async () => {
  const root = tempDirs.make("branch-app-update-");
  const installOwner = {
    schemaVersion: 1,
    owner: "macos-app",
    displayName: "Branch.app",
    updateHint: "Update Branch.app to update this Gateway.",
  };
  await fs.writeFile(path.join(root, "branch-install-owner.json"), JSON.stringify(installOwner));
  vi.spyOn(packageRoot, "resolveBranchPackageRoot").mockResolvedValue(root);
  const resolveManager = vi.spyOn(ocmUpdate, "resolveOcmUpdateManager");
  const createRun = vi.spyOn(updateLedger, "createUpdateRun");
  const respond = vi.fn();

  await invokeUpdateRun({}, respond);

  expect(respond).toHaveBeenCalledExactlyOnceWith(false, undefined, {
    code: "UNAVAILABLE",
    message: "Managed by Branch.app. Update Branch.app to update this Gateway.",
    details: { reason: "host-owned-install", installOwner },
    retryable: false,
  });
  expect(resolveManager).not.toHaveBeenCalled();
  expect(createRun).not.toHaveBeenCalled();
  expect(resolveUpdateInstallSurfaceMock).not.toHaveBeenCalled();
  expect(adoptUpdateCampaignMock).not.toHaveBeenCalled();
  expect(startManagedServiceUpdateHandoffMock).not.toHaveBeenCalled();
  expect(scheduleGatewayRestartMock).not.toHaveBeenCalled();
  expect(sentinelState.capturedPayload).toBeUndefined();
});
