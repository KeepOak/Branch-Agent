import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tempWorkspace } from "@openclaw/fs-safe/temp";
import * as tar from "tar";
import { root as fsSafeRoot } from "../infra/fs-safe.js";
import { resolvePreferredBranchTmpDir } from "../infra/tmp-branch-dir.js";
import {
  GROVE_PROJECT_RESULT_SCHEMA_VERSION,
  GroveProjectError,
  validateGroveProject,
} from "./project.js";
import { readGroveManifestFile } from "./reader.js";
import { MAX_MANAGED_FILE_BYTES } from "./source-limits.js";

export const GROVE_BUILD_RESULT_SCHEMA_VERSION = "branch.groveBuild.v1" as const;

// zlib's public numeric API defines Z_FILTERED as strategy 1.
const ZLIB_FILTERED_STRATEGY = 1;

type GroveBuildResult = {
  schemaVersion: typeof GROVE_BUILD_RESULT_SCHEMA_VERSION;
  projectSchemaVersion: typeof GROVE_PROJECT_RESULT_SCHEMA_VERSION;
  artifact: string;
  integrity: string;
  byteLength: number;
  files: string[];
  excludedPaths: string[];
  grove: { name: string; version: string };
};

async function readSelectedProjectFile(projectRoot: string, path: string): Promise<Buffer> {
  const sourceRoot = await fsSafeRoot(projectRoot);
  const read = await sourceRoot.read(path, {
    hardlinks: "reject",
    maxBytes: MAX_MANAGED_FILE_BYTES,
    nonBlockingRead: true,
    symlinks: path === "GROVE.md" ? "follow-within-root" : "reject",
  });
  return read.buffer;
}

function assertValidatedBytes(
  path: string,
  bytes: Buffer,
  expected: { byteLength: number; digest: string },
): void {
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== expected.byteLength || digest !== expected.digest) {
    throw new GroveProjectError(
      "project_changed_during_build",
      `Grove project input ${JSON.stringify(path)} changed after validation; retry the build from a stable snapshot.`,
    );
  }
}

export async function extractBuiltGroveArtifact(
  artifact: string,
): Promise<AsyncDisposable & { packageRoot: string }> {
  const workspace = await tempWorkspace({
    rootDir: resolvePreferredBranchTmpDir(),
    prefix: "branch-grove-artifact-",
  });
  try {
    await tar.x({ cwd: workspace.dir, file: resolve(artifact), strict: true });
    const packageRoot = workspace.path("package");
    const packageStat = await lstat(packageRoot);
    if (!packageStat.isDirectory()) {
      throw new Error("artifact does not contain a package directory");
    }
    return { packageRoot, [Symbol.asyncDispose]: workspace[Symbol.asyncDispose] };
  } catch (error) {
    await workspace[Symbol.asyncDispose]();
    throw new GroveProjectError(
      "artifact_verification_failed",
      `Could not extract built Grove artifact: ${(error as Error).message}`,
    );
  }
}

export async function buildGroveProject(
  projectPath: string,
  outputPath: string,
): Promise<GroveBuildResult> {
  const project = await validateGroveProject(projectPath);
  if (!project.ok) {
    throw new GroveProjectError(
      "project_invalid",
      project.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
    );
  }

  const artifact = resolve(outputPath);
  if (!artifact.toLowerCase().endsWith(".tgz")) {
    throw new GroveProjectError("invalid_artifact_path", "Grove build output must end in .tgz.");
  }
  if (await lstat(artifact).catch(() => undefined)) {
    throw new GroveProjectError(
      "artifact_exists",
      `Refusing to overwrite existing artifact ${JSON.stringify(artifact)}.`,
    );
  }
  const outputParent = await stat(dirname(artifact)).catch(() => undefined);
  if (!outputParent?.isDirectory()) {
    throw new GroveProjectError(
      "artifact_parent_missing",
      `Artifact parent directory ${JSON.stringify(dirname(artifact))} does not exist.`,
    );
  }

  const temporaryDirectory = await mkdtemp(join(dirname(artifact), ".branch-grove-build-"));
  const stagingRoot = join(temporaryDirectory, "staging");
  const temporaryArtifact = join(temporaryDirectory, "grove.tgz");
  try {
    await mkdir(stagingRoot, { mode: 0o755 });
    const staging = await fsSafeRoot(stagingRoot, { mkdir: false, mode: 0o644, durable: false });
    const files = new Map<string, Buffer | string>();
    files.set("package.json", `${JSON.stringify(project.packageJson, null, 2)}\n`);
    const groveMarkdown = await readSelectedProjectFile(project.root, "GROVE.md");
    assertValidatedBytes("GROVE.md", groveMarkdown, project.grove.snapshot.manifest);
    files.set("GROVE.md", groveMarkdown);
    if (project.grove.packageBootstrap) {
      const bootstrap = await readSelectedProjectFile(project.root, "BOOTSTRAP.md");
      assertValidatedBytes("BOOTSTRAP.md", bootstrap, project.grove.packageBootstrap);
      files.set("BOOTSTRAP.md", bootstrap);
    }
    if (project.grove.branchProfile) {
      const profileSnapshot = project.grove.snapshot.branchProfile;
      if (!profileSnapshot) {
        throw new GroveProjectError(
          "project_invalid",
          "Validated Branch Agent profile is missing its source snapshot.",
        );
      }
      const profile = await readSelectedProjectFile(project.root, profileSnapshot.sourcePath);
      assertValidatedBytes(profileSnapshot.sourcePath, profile, profileSnapshot);
      files.set(profileSnapshot.sourcePath, profile);
    }
    for (const source of project.grove.snapshot.workspaceSources) {
      const bytes = await readSelectedProjectFile(project.root, source.sourcePath);
      assertValidatedBytes(source.sourcePath, bytes, source);
      files.set(source.sourcePath, bytes);
    }

    const fileNames = [...files.keys()].toSorted((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
    for (const fileName of fileNames) {
      await mkdir(join(stagingRoot, dirname(fileName)), { recursive: true, mode: 0o755 });
      await staging.create(fileName, files.get(fileName) as Buffer | string);
    }
    const tarInputNames = fileNames.map((fileName) =>
      fileName.startsWith("@") ? `./${fileName}` : fileName,
    );

    await tar.c(
      {
        cwd: stagingRoot,
        file: temporaryArtifact,
        // Stabilize supported zlib output without disabling normal match compression.
        gzip: { level: 9, portable: true, strategy: ZLIB_FILTERED_STRATEGY },
        mtime: new Date(0),
        portable: true,
        prefix: "package",
      },
      tarInputNames,
    );

    const archiveEntries: Array<{ path: string; type: string }> = [];
    await tar.t({
      file: temporaryArtifact,
      onentry: (entry) => archiveEntries.push({ path: entry.path, type: entry.type }),
    });
    const expectedEntries = fileNames.map((path) => ({ path: `package/${path}`, type: "File" }));
    if (JSON.stringify(archiveEntries) !== JSON.stringify(expectedEntries)) {
      throw new GroveProjectError(
        "artifact_contents_mismatch",
        "Built artifact contents differ from the validated project selection.",
      );
    }

    const packed = await readFile(temporaryArtifact);
    const integrity = `sha256:${createHash("sha256").update(packed).digest("hex")}`;
    {
      await using extracted = await extractBuiltGroveArtifact(temporaryArtifact);
      const reread = await readGroveManifestFile(extracted.packageRoot);
      if (!reread.ok) {
        throw new GroveProjectError(
          "artifact_verification_failed",
          reread.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
        );
      }
      if (
        reread.source.name !== project.packageJson.name ||
        reread.source.version !== project.packageJson.version
      ) {
        throw new GroveProjectError(
          "artifact_identity_mismatch",
          "Built artifact identity differs from the validated project.",
        );
      }
    }

    try {
      await link(temporaryArtifact, artifact);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        throw new GroveProjectError(
          "artifact_exists",
          `Refusing to overwrite existing artifact ${JSON.stringify(artifact)}.`,
        );
      }
      throw new GroveProjectError(
        "artifact_atomic_publish_failed",
        `Could not atomically publish artifact ${JSON.stringify(artifact)}: ${(error as Error).message}`,
      );
    }
    return {
      schemaVersion: GROVE_BUILD_RESULT_SCHEMA_VERSION,
      projectSchemaVersion: GROVE_PROJECT_RESULT_SCHEMA_VERSION,
      artifact,
      integrity,
      byteLength: packed.byteLength,
      files: fileNames,
      excludedPaths: project.excludedPaths,
      grove: { name: project.packageJson.name, version: project.packageJson.version },
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
