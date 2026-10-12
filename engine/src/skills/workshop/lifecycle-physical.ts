import fs from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { root } from "../../infra/fs-safe.js";
import { assertInsideSkillsRoot } from "../lifecycle/workspace-skill-write.js";
import {
  validatePhysicalLifecycleManifest,
  physicalLifecycleManifestSha256,
  lifecyclePhysicalPaths,
} from "./lifecycle-physical-model.js";
import type {
  PhysicalLifecycleManifest,
  PhysicalLifecycleExecution,
} from "./lifecycle-physical-model.js";
import {
  readSkillProposalTreeSnapshot,
  readSkillProposalTargetTreeSha256,
} from "./proposal-bundle.js";

export type PhysicalLifecycleHost = {
  agentId: string;
  assertCurrent: () => Promise<void>;
  assertProtection: (action: "archive" | "restore") => Promise<void>;
  read: () => Promise<PhysicalLifecycleExecution | null>;
  prepare: (manifest: PhysicalLifecycleManifest) => Promise<PhysicalLifecycleExecution>;
  archiveComplete: (observedTreeSha256: string) => Promise<PhysicalLifecycleExecution>;
  restorePrepare: (
    restoreId: string,
    expectedRevision: number,
  ) => Promise<PhysicalLifecycleExecution>;
  restoreComplete: (observedTreeSha256: string) => Promise<PhysicalLifecycleExecution>;
};
type ArchiveRequest = Omit<
  PhysicalLifecycleManifest,
  "schema" | "rootIdentity" | "treeSha256" | "snapshots"
> & { ownedSkillFiles: readonly string[] };
async function fresh(host: PhysicalLifecycleHost, action: "archive" | "restore") {
  await host.assertCurrent();
  await host.assertProtection(action);
  await host.assertCurrent();
}
async function statDirectory(filePath: string) {
  const value = await fs.lstat(filePath, { bigint: true }).catch((error: unknown) => {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  });
  if (value && (!value.isDirectory() || value.isSymbolicLink()))
    throw Error("Lifecycle path is not a plain directory.");
  return value;
}
async function rootIdentity(skillsRoot: string) {
  const stat = await statDirectory(skillsRoot);
  if (!stat) throw Error("Lifecycle root is missing.");
  return {
    realPath: await fs.realpath(skillsRoot),
    device: String(stat.dev),
    inode: String(stat.ino),
  };
}
async function assertRoot(manifest: PhysicalLifecycleManifest) {
  if (
    JSON.stringify(await rootIdentity(manifest.skillsRoot)) !==
    JSON.stringify(manifest.rootIdentity)
  )
    throw Error("Lifecycle root identity changed.");
  assertInsideSkillsRoot(manifest.skillsRoot, path.dirname(manifest.skillFile), "lifecycle source");
  assertInsideSkillsRoot(
    manifest.skillsRoot,
    lifecyclePhysicalPaths(manifest).archiveDir,
    "lifecycle archive",
  );
}
async function fullHash(dir: string) {
  return readSkillProposalTargetTreeSha256(dir, { includeRootMetadata: true });
}
async function writeExactFile(
  baseDir: string,
  relative: string,
  bytes: Buffer,
  boundaryRoot: string,
) {
  assertInsideSkillsRoot(boundaryRoot, path.join(baseDir, relative), "lifecycle retained file");
  const target = await root(baseDir);
  const prior = await target
    .read(relative, { hardlinks: "reject", symlinks: "reject", maxBytes: 1024 * 1024 })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === "not-found") return null;
      throw error;
    });
  if (prior) {
    if (sha256Hex(prior.buffer) !== sha256Hex(bytes))
      throw Error("Lifecycle retained-file collision.");
    return;
  }
  await target.write(relative, bytes, { mkdir: true, overwrite: false });
}
async function prepareSnapshot(
  request: ArchiveRequest,
  host: PhysicalLifecycleHost,
): Promise<PhysicalLifecycleManifest> {
  const snapshots: PhysicalLifecycleManifest["snapshots"] = [];
  const identity = await rootIdentity(request.skillsRoot);
  const keyManifest = {
    ...request,
    schema: "branch.skill-lifecycle-physical.v1" as const,
    rootIdentity: identity,
    treeSha256: "",
    snapshots,
  };
  const paths = lifecyclePhysicalPaths(keyManifest);
  assertInsideSkillsRoot(request.skillsRoot, paths.archiveDir, "lifecycle archive");
  await statDirectory(path.join(request.skillsRoot, ".archive"));
  const inventory = [...new Set(request.ownedSkillFiles)].toSorted();
  if (!inventory.includes(request.skillFile))
    throw Error("Lifecycle target is not in owned inventory.");
  const targetDir = path.dirname(request.skillFile);
  if (
    inventory.some(
      (file) =>
        file !== request.skillFile &&
        path.dirname(file) !== targetDir &&
        !path.relative(targetDir, path.dirname(file)).startsWith("..") &&
        !path.isAbsolute(path.relative(targetDir, path.dirname(file))),
    )
  )
    throw Error("Archive would include another owned skill.");
  const relative = path.relative(request.skillsRoot, targetDir),
    backupRelative = path.relative(request.skillsRoot, request.backupRoot);
  if (
    !path.isAbsolute(request.skillsRoot) ||
    !path.isAbsolute(request.backupRoot) ||
    !relative ||
    relative.startsWith("..") ||
    relative.split(path.sep)[0]?.startsWith(".") ||
    path.basename(request.skillFile) !== "SKILL.md" ||
    !backupRelative ||
    (!(backupRelative === ".." || backupRelative.startsWith(`..${path.sep}`)) &&
      !path.isAbsolute(backupRelative))
  )
    throw Error("Invalid lifecycle capture boundaries.");
  await statDirectory(request.backupRoot);
  await statDirectory(paths.backupDir);
  await statDirectory(path.join(paths.backupDir, "skills"));
  assertInsideSkillsRoot(
    request.backupRoot,
    path.join(paths.backupDir, "skills"),
    "lifecycle backup tree",
  );
  await fresh(host, "archive");
  await fs.mkdir(path.join(paths.backupDir, "skills"), { recursive: true });
  for (const file of inventory) {
    const dir = path.dirname(file);
    assertInsideSkillsRoot(request.skillsRoot, dir, "snapshot skill directory");
    if (!(await statDirectory(dir))) {
      if (file === request.skillFile) throw Error("Lifecycle target is missing.");
      continue;
    }
    await fresh(host, "archive");
    const snapshot = await readSkillProposalTreeSnapshot(dir);
    if (!snapshot.files.some((entry) => entry.path === path.basename(file)))
      throw Error("Owned snapshot has no skill activation marker.");
    if (
      file === request.skillFile &&
      snapshot.files.some(
        (entry) => entry.path !== path.basename(file) && entry.path.endsWith("/SKILL.md"),
      )
    )
      throw Error("Archive has an unclassified nested skill.");
    const relativeDir = path.relative(request.skillsRoot, dir);
    for (const entry of snapshot.files) {
      await fresh(host, "archive");
      await writeExactFile(
        path.join(paths.backupDir, "skills"),
        path.join(relativeDir, ...entry.path.split("/")),
        Buffer.from(entry.content, entry.encoding),
        request.backupRoot,
      );
    }
    if (
      (await fullHash(dir)) !== snapshot.treeSha256 ||
      (await fullHash(path.join(paths.backupDir, "skills", relativeDir))) !== snapshot.treeSha256
    )
      throw Error("Lifecycle original or backup changed during capture.");
    snapshots.push({ relativeDir, treeSha256: snapshot.treeSha256 });
  }
  const treeSha256 = snapshots.find(
    (entry) => entry.relativeDir === path.relative(request.skillsRoot, targetDir),
  )?.treeSha256;
  if (!treeSha256) throw Error("Lifecycle target snapshot is incomplete.");
  const { ownedSkillFiles: _, ...input } = request;
  const manifest = validatePhysicalLifecycleManifest({
    ...input,
    schema: "branch.skill-lifecycle-physical.v1",
    rootIdentity: identity,
    treeSha256,
    snapshots,
  });
  await fresh(host, "archive");
  await assertRoot(manifest);
  for (const entry of manifest.snapshots) {
    await fresh(host, "archive");
    if ((await fullHash(path.join(manifest.skillsRoot, entry.relativeDir))) !== entry.treeSha256)
      throw Error("Lifecycle collection changed during capture.");
  }
  await writeExactFile(
    paths.backupDir,
    "manifest.json",
    Buffer.from(JSON.stringify(manifest)),
    manifest.backupRoot,
  );
  return manifest;
}
async function verifySnapshot(
  manifest: PhysicalLifecycleManifest,
  host: PhysicalLifecycleHost,
  action: "archive" | "restore",
) {
  const { backupDir } = lifecyclePhysicalPaths(manifest);
  const snapshotRoot = await root(backupDir);
  const stored = await snapshotRoot.read("manifest.json", {
    hardlinks: "reject",
    symlinks: "reject",
    maxBytes: 1024 * 1024,
  });
  if (sha256Hex(stored.buffer) !== physicalLifecycleManifestSha256(manifest))
    throw Error("Lifecycle snapshot manifest changed.");
  for (const entry of manifest.snapshots) {
    await fresh(host, action);
    if ((await fullHash(path.join(backupDir, "skills", entry.relativeDir))) !== entry.treeSha256)
      throw Error("Lifecycle retained snapshot changed.");
  }
  await assertRoot(manifest);
}
async function reserveArchive(manifest: PhysicalLifecycleManifest, host: PhysicalLifecycleHost) {
  const paths = lifecyclePhysicalPaths(manifest);
  const sourceRoot = await root(manifest.skillsRoot);
  const marker = Buffer.from(
    JSON.stringify({ manifestSha256: physicalLifecycleManifestSha256(manifest) }),
  );
  const prior = await sourceRoot
    .read(paths.marker, { hardlinks: "reject", symlinks: "reject", maxBytes: 1024 * 1024 })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === "not-found") return null;
      throw error;
    });
  if (prior) {
    if (sha256Hex(prior.buffer) !== sha256Hex(marker))
      throw Error("Lifecycle archive reservation collision.");
  } else {
    if (await statDirectory(paths.container))
      throw Error("Lifecycle archive destination collision.");
    await fresh(host, "archive");
    await sourceRoot.write(paths.marker, marker, { mkdir: true, overwrite: false });
  }
  await fresh(host, "archive");
  assertInsideSkillsRoot(manifest.skillsRoot, paths.container, "archive reservation");
  await fs.mkdir(paths.container, { recursive: true });
  const entries = await fs.readdir(paths.container);
  if (entries.some((entry) => entry !== "skill"))
    throw Error("Lifecycle archive container contains unrelated entries.");
}
function assertExecution(
  execution: PhysicalLifecycleExecution,
  request: { agentId: string; runId: string },
) {
  validatePhysicalLifecycleManifest(execution.manifest);
  if (
    execution.manifest.agentId !== request.agentId ||
    execution.manifest.runId !== request.runId ||
    execution.manifestSha256 !== physicalLifecycleManifestSha256(execution.manifest)
  )
    throw Error("Physical lifecycle execution custody changed.");
}
export async function archivePlannedSkillDirectory(
  request: ArchiveRequest,
  host: PhysicalLifecycleHost,
) {
  const input = structuredClone(request);
  if (host.agentId !== input.agentId) throw Error("Physical lifecycle actor mismatch.");
  await fresh(host, "archive");
  let execution = await host.read();
  if (!execution) {
    const manifest = await prepareSnapshot(input, host);
    await fresh(host, "archive");
    execution = await host.prepare(manifest);
  }
  assertExecution(execution, input);
  const manifest = execution.manifest;
  if (
    manifest.skillFile !== input.skillFile ||
    manifest.expectedRevision !== input.expectedRevision ||
    manifest.skillsRoot !== input.skillsRoot ||
    manifest.backupRoot !== input.backupRoot ||
    manifest.proposalId !== input.proposalId ||
    manifest.proposalRevisionSha256 !== input.proposalRevisionSha256
  )
    throw Error("Archive request changed.");
  if (!["prepared", "archived"].includes(execution.phase))
    throw Error("Archive run is already restoring or restored.");
  await verifySnapshot(manifest, host, "archive");
  await reserveArchive(manifest, host);
  const paths = lifecyclePhysicalPaths(manifest),
    source = path.dirname(manifest.skillFile);
  const live = await statDirectory(source),
    saved = await statDirectory(paths.archiveDir);
  if (live && saved) throw Error("Archive source/destination collision; nothing overwritten.");
  if (!live && !saved) throw Error("Archive original is unavailable; retained backup preserved.");
  if (live) {
    if (execution.phase !== "prepared" || (await fullHash(source)) !== manifest.treeSha256)
      throw Error("Archive original changed.");
    await fresh(host, "archive");
    await assertRoot(manifest);
    if (await statDirectory(paths.archiveDir))
      throw Error("Archive destination appeared before move.");
    await fs.rename(source, paths.archiveDir);
  }
  await fresh(host, "archive");
  await assertRoot(manifest);
  if ((await statDirectory(source)) || (await fullHash(paths.archiveDir)) !== manifest.treeSha256)
    throw Error("Archive after-image changed; recovery custody retained.");
  return host.archiveComplete(manifest.treeSha256);
}
export async function restoreArchivedSkillDirectory(
  request: { agentId: string; runId: string; restoreId: string; expectedRevision: number },
  host: PhysicalLifecycleHost,
) {
  const input = structuredClone(request);
  if (host.agentId !== input.agentId) throw Error("Physical lifecycle actor mismatch.");
  await fresh(host, "restore");
  let execution = await host.read();
  if (!execution) throw Error("Owned physical archive is unavailable.");
  assertExecution(execution, input);
  if (execution.phase === "prepared")
    throw Error("Archive is not committed; recover archive before restore.");
  const manifest = execution.manifest;
  await verifySnapshot(manifest, host, "restore");
  const paths = lifecyclePhysicalPaths(manifest),
    source = path.dirname(manifest.skillFile);
  let live = await statDirectory(source),
    saved = await statDirectory(paths.archiveDir);
  if (live && saved) throw Error("Restore destination collision; existing skill preserved.");
  if (execution.phase === "archived" && live) throw Error("Restore destination already exists.");
  if (!live && !saved) throw Error("Archived original is missing; retained backup preserved.");
  if (saved && (await fullHash(paths.archiveDir)) !== manifest.treeSha256)
    throw Error("Archived original changed.");
  execution = await host.restorePrepare(input.restoreId, input.expectedRevision);
  await fresh(host, "restore");
  if (
    execution.restoreId !== input.restoreId ||
    execution.restoreRevision !== input.expectedRevision
  )
    throw Error("Restore request changed.");
  if (saved) {
    if (execution.phase !== "restore-prepared")
      throw Error("Completed restore has an unexpected archived copy.");
    await assertRoot(manifest);
    if (await statDirectory(source)) throw Error("Restore destination appeared before move.");
    await fs.rename(paths.archiveDir, source);
  }
  await fresh(host, "restore");
  await assertRoot(manifest);
  live = await statDirectory(source);
  saved = await statDirectory(paths.archiveDir);
  if (!live || saved || (await fullHash(source)) !== manifest.treeSha256)
    throw Error("Restore after-image changed; recovery custody retained.");
  return host.restoreComplete(manifest.treeSha256);
}
