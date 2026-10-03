import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writePersistedInstalledPluginIndex } from "./installed-plugin-index-store-write.js";
import { loadInstalledPluginIndex } from "./installed-plugin-index.js";
import { clearPluginMetadataLifecycleCaches } from "./plugin-metadata-lifecycle.js";
import { loadPluginRegistrySnapshotWithMetadata } from "./plugin-registry-snapshot.js";
import { writeRegistryPackagePlugin } from "./test-helpers/plugin-registry-snapshot.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => clearPluginMetadataLifecycleCaches());

it("keeps persisted package plugins when file hashes match", async () => {
  const tempRoot = tempDirs.make("branch-plugin-registry-receipts-");
  const rootDir = path.join(tempRoot, "workspace");
  const stateDir = path.join(tempRoot, "state");
  const env = {
    BRANCH_BUNDLED_PLUGINS_DIR: path.join(tempRoot, "bundled"),
    BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
    BRANCH_STATE_DIR: stateDir,
    BRANCH_VERSION: "2026.4.26",
    VITEST: "true",
  };
  const config = {
    plugins: {
      load: { paths: [rootDir] },
    },
  };
  writeRegistryPackagePlugin(rootDir);
  const index = loadInstalledPluginIndex({ config, env });
  const [record] = index.plugins;
  if (!record?.packageJson?.fileSignature || !record.manifestFile) {
    throw new Error("expected package plugin index record with file signatures");
  }
  expect(record.manifestFile.size).toBe(
    fs.statSync(path.join(rootDir, "branch.plugin.json")).size,
  );
  expect(record.packageJson.fileSignature.size).toBe(
    fs.statSync(path.join(rootDir, "package.json")).size,
  );
  record.sourceAdmissions = {
    [`${rootDir}\0`]: {
      signature: "unchanged-source-inputs",
      sourceDigest: "a".repeat(64),
      nativeArtifacts: {},
      nativeNamespaces: {},
    },
  };
  await writePersistedInstalledPluginIndex(index, { stateDir });

  const result = loadPluginRegistrySnapshotWithMetadata({
    config,
    env,
    stateDir,
  });

  expect(result.source).toBe("persisted");
  expect(result.diagnostics).toStrictEqual([]);
  expect(result.snapshot.plugins[0]?.sourceAdmissions).toEqual(record.sourceAdmissions);
});
