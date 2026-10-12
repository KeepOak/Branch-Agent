/** Persists hosted official plugin catalog snapshots through the shared-state worker. */
import { existsSync } from "node:fs";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { HostedCatalogSignedFeedMonotonicityError } from "./official-external-plugin-catalog-source.js";
import type {
  HostedOfficialExternalPluginCatalogSnapshot,
  HostedOfficialExternalPluginCatalogSnapshotStore,
} from "./official-external-plugin-catalog.types.js";

type HostedOfficialExternalPluginCatalogSnapshotStoreOptions = {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  stateDatabasePath?: string;
};

function resolveDatabaseOptions(options: HostedOfficialExternalPluginCatalogSnapshotStoreOptions) {
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  if (options.stateDir) {
    env.BRANCH_STATE_DIR = options.stateDir;
  }
  return {
    env,
    path: options.stateDatabasePath || resolveBranchStateSqlitePath(env),
  };
}

function captureSnapshot(
  snapshot: HostedOfficialExternalPluginCatalogSnapshot,
): HostedOfficialExternalPluginCatalogSnapshot {
  const { metadata, trust, monotonic } = snapshot;
  return {
    body: snapshot.body,
    metadata: {
      url: metadata.url,
      status: metadata.status,
      etag: metadata.etag,
      lastModified: metadata.lastModified,
      checksum: metadata.checksum,
    },
    savedAt: snapshot.savedAt,
    ...(trust
      ? {
          trust: {
            mode: trust.mode,
            signedBy: trust.signedBy,
            signatureCount: trust.signatureCount,
            threshold: trust.threshold,
            verifiedAt: trust.verifiedAt,
          },
        }
      : {}),
    ...(monotonic
      ? {
          monotonic: {
            mode: monotonic.mode,
            sequence: monotonic.sequence,
            generatedAt: monotonic.generatedAt,
          },
        }
      : {}),
  };
}

/** Creates a snapshot store backed by the shared `state/branch.sqlite` database. */
export function createSqliteHostedOfficialExternalPluginCatalogSnapshotStore(
  options: HostedOfficialExternalPluginCatalogSnapshotStoreOptions = {},
): HostedOfficialExternalPluginCatalogSnapshotStore {
  return {
    async read(url) {
      const databaseOptions = resolveDatabaseOptions(options);
      if (!existsSync(databaseOptions.path)) {
        return null;
      }
      const context = captureBranchStateWorkerContext(databaseOptions);
      const { runBranchStateWorkerOperation } =
        await import("../state/branch-state-worker-store.js");
      return (
        (await runBranchStateWorkerOperation(
          context,
          (scope) => scope.execute({ type: "plugins.catalogSnapshot.read", input: { url } }),
          { existingOnly: true },
        )) ?? null
      );
    },
    async write(snapshot) {
      const now = Date.now();
      const prepared = captureSnapshot(snapshot);
      const context = captureBranchStateWorkerContext(resolveDatabaseOptions(options));
      const { runBranchStateWorkerOperation } =
        await import("../state/branch-state-worker-store.js");
      const result = await runBranchStateWorkerOperation(context, (scope) =>
        scope.execute({
          type: "plugins.catalogSnapshot.write",
          input: { snapshot: prepared, now },
        }),
      );
      if (!result.ok) {
        throw new HostedCatalogSignedFeedMonotonicityError(result.message);
      }
    },
  };
}
