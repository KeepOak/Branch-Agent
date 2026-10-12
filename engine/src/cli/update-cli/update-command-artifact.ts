import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { assertDirectoryIdentitySync, readDirectoryIdentity } from "@openclaw/fs-safe/advanced";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { valid as validSemver } from "semver";
import { GATEWAY_CONFIG_SELECTION_ENV_KEYS } from "../../config/gateway-env-selection.js";
import { GATEWAY_SERVICE_SELECTOR_ENV_KEYS } from "../../daemon/constants.js";
import { removePathWithinRoot } from "../../infra/fs-safe-remove.js";
import { createPrivateSqliteTempDirectory } from "../../infra/sqlite-private-directory.js";
import { SUPERVISOR_HINT_ENV_VARS } from "../../infra/supervisor-markers.js";
import { resolvePreferredBranchTmpDir } from "../../infra/tmp-branch-dir.js";
import { compareSemverStrings } from "../../infra/update-check.js";
import { createUpdatePreflightFailure } from "../../infra/update-preflight-details.js";
import { hasCommandProcessCleanupError } from "../../process/exec-result.js";
import { parseBranchSchemaVersions } from "../../state/branch-schema-versions.js";
import { createUpdateProgress } from "./progress.js";
import type { InitializedUpdate } from "./update-command-initialization.js";
import { withUpdateInitializationCleanup } from "./update-command-initialization.js";
import { stagePackageInstallUpdate } from "./update-command-package.js";

type StageParams = Parameters<typeof stagePackageInstallUpdate>[0];
type ArtifactInitialization = Pick<InitializedUpdate, "stagedPackage"> & {
  target: Pick<
    NonNullable<InitializedUpdate["target"]>,
    | "currentVersion"
    | "targetVersion"
    | "packageTargetSchemaVersions"
    | "packageRuntimeTarget"
    | "downgradeRisk"
    | "packageAlreadyCurrent"
    | "refuseUpdate"
  >;
};

/** Candidate hooks may initialize their own profile, never the profile awaiting admission. */
export async function withPrivateStagedPackageInstall<T>(
  params: StageParams,
  use: (candidate: {
    stage: Awaited<ReturnType<typeof stagePackageInstallUpdate>>;
    manifest: unknown;
  }) => Promise<T>,
): Promise<T> {
  const rootIdentity = await readDirectoryIdentity(resolvePreferredBranchTmpDir());
  const root = rootIdentity.realPath;
  const assertRoot = () => assertDirectoryIdentitySync(root, rootIdentity);
  assertRoot();
  const home = await createPrivateSqliteTempDirectory(root, "branch-update-artifact-");
  assertRoot();
  const homeIdentity = await readDirectoryIdentity(home);
  const assertWorkspace = () => {
    assertRoot();
    assertDirectoryIdentitySync(home, homeIdentity);
  };
  assertWorkspace();
  let retainWorkspace = false;
  return await withUpdateInitializationCleanup(
    async () => {
      try {
        const state = path.join(home, "state");
        const tmp = path.join(home, "tmp");
        await fs.mkdir(tmp);
        assertWorkspace();
        const env = { ...params.installEnv };
        // Child env overlays process.env. Tombstones must survive until spawn.
        for (const key of [
          ...[...GATEWAY_CONFIG_SELECTION_ENV_KEYS].filter(
            (selector) => selector.startsWith("BRANCH_") || selector === "PI_CODING_AGENT_DIR",
          ),
          ...GATEWAY_SERVICE_SELECTOR_ENV_KEYS,
          ...SUPERVISOR_HINT_ENV_VARS,
          "STATE_DIRECTORY",
          "NODE_COMPILE_CACHE",
          "BRANCH_GATEWAY_SERVICE_PID",
          "BRANCH_SERVICE_MARKER",
          "BRANCH_SERVICE_KIND",
          "BRANCH_UPDATE_RUN_ID",
          "BRANCH_UPDATE_RUN_HANDOFF",
          "BRANCH_CONTROL_PLANE_UPDATE_SENTINEL_META",
          "BRANCH_UPDATE_POST_CORE",
          "BRANCH_UPDATE_POST_CORE_CHANNEL",
          "BRANCH_UPDATE_POST_CORE_RESULT_PATH",
          "BRANCH_UPDATE_POST_CORE_INSTALL_RECORDS_PATH",
          "BRANCH_UPDATE_POST_CORE_STARTED_AT_MS",
          "BRANCH_UPDATE_POST_CORE_REQUESTED_CHANNEL",
          "BRANCH_UPDATE_POST_CORE_SOURCE_CONFIG_PATH",
          "BRANCH_DIAGNOSTICS_TIMELINE_PATH",
        ]) {
          env[key] = undefined;
        }
        Object.assign(env, {
          BRANCH_HOME: home,
          BRANCH_STATE_DIR: state,
          BRANCH_CONFIG_PATH: path.join(state, "branch.json"),
          TMPDIR: tmp,
          TMP: tmp,
          TEMP: tmp,
          NODE_DISABLE_COMPILE_CACHE: "1",
        });
        const stage = await stagePackageInstallUpdate({ ...params, installEnv: env });
        return await withUpdateInitializationCleanup(
          async () => {
            assertWorkspace();
            const manifest: unknown = JSON.parse(
              await fs.readFile(path.join(stage.root, "package.json"), "utf8"),
            );
            assertWorkspace();
            return await use({ stage, manifest });
          },
          () => stage.close(),
        );
      } catch (error) {
        retainWorkspace = hasCommandProcessCleanupError(error);
        throw error;
      }
    },
    async () => {
      // Accepted children may still use HOME/state/tmp after the updater exits.
      if (retainWorkspace) {
        return;
      }
      await removePathWithinRoot({
        rootDir: root,
        relativePath: path.basename(home),
        recursive: true,
        symlinks: "unlink",
        assertBeforeMutation: () => {
          assertRoot();
          if (fsSync.lstatSync(home, { bigint: true, throwIfNoEntry: false })) {
            assertDirectoryIdentitySync(home, homeIdentity);
          }
        },
      });
    },
  );
}

/** Explicit artifacts need their own declaration; a familiar version is not provenance. */
function readFreshUpdateArtifactMetadata(manifest: unknown) {
  if (
    !isRecord(manifest) ||
    typeof manifest.version !== "string" ||
    !validSemver(manifest.version)
  ) {
    return { failure: createUpdatePreflightFailure("target-version-resolution") };
  }
  const schemas = isRecord(manifest.branch)
    ? parseBranchSchemaVersions(manifest.branch.schemaVersions)
    : undefined;
  if (!schemas) {
    return { failure: createUpdatePreflightFailure("target-schema-metadata") };
  }
  return {
    version: manifest.version,
    schemaVersions: schemas,
    nodeEngine:
      isRecord(manifest.engines) && typeof manifest.engines.node === "string"
        ? manifest.engines.node
        : null,
  };
}

/** Bind the inspected artifact to the existing fresh-profile admission flow. */
export async function runFreshUpdateArtifact(
  params: {
    initialization: ArtifactInitialization;
    stageParams: (presentation: ReturnType<typeof createUpdateProgress>) => StageParams;
    json: boolean;
  },
  run: () => Promise<void>,
): Promise<void> {
  const presentation = createUpdateProgress(!params.json);
  const { initialization } = params;
  const { target } = initialization;
  try {
    return await withPrivateStagedPackageInstall(
      params.stageParams(presentation),
      async ({ stage, manifest }) => {
        initialization.stagedPackage = stage;
        const metadata = readFreshUpdateArtifactMetadata(manifest);
        if (metadata.failure) {
          return await target.refuseUpdate(
            "target-metadata-preflight",
            metadata.failure.message,
            metadata.failure.failureFacts,
          );
        }
        const comparison = compareSemverStrings(target.currentVersion, metadata.version);
        target.downgradeRisk = comparison !== null && comparison > 0;
        target.packageAlreadyCurrent = false;
        target.targetVersion = metadata.version;
        target.packageTargetSchemaVersions = metadata.schemaVersions;
        target.packageRuntimeTarget = {
          version: metadata.version,
          nodeEngine: metadata.nodeEngine,
        };
        return await run();
      },
    );
  } finally {
    presentation.dispose();
  }
}
