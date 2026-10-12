import { spawnSync } from "node:child_process";
import fs, { lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resolveRuntimeWorkerArgv, resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { withEnvAsync } from "../test-utils/env.js";
import { buildGroveProject } from "./project-build.js";
import { groveProjectBuildEntrypoint } from "./project-runtime.test-support.js";
import { GroveProjectError, createGroveProject, validateGroveProject } from "./project.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const GOLDEN_ARTIFACT_INTEGRITY =
  "sha256:10b8890c5e5b062c94ff79b1d424859c6a5572548535eec6e31ee0c6d7c08a3b";

async function writeRichProject(root: string): Promise<void> {
  await mkdir(join(root, "workspace"), { recursive: true });
  await mkdir(join(root, "profiles"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "demo-grove",
      version: "1.2.3",
      branch: { grove: "GROVE.md" },
    })}\n`,
  );
  await writeFile(
    join(root, "GROVE.md"),
    [
      "---",
      "schemaVersion: 1",
      "agent:",
      "  id: demo-grove",
      "workspace:",
      "  files:",
      "    - source: workspace/reference.md",
      "      path: reference.md",
      "---",
      "You are the demo Grove.",
      "",
    ].join("\n"),
  );
  await writeFile(join(root, "workspace", "reference.md"), "# Reference\n");
  await writeFile(join(root, "BOOTSTRAP.md"), "Interview the user before starting.\n");
  await writeFile(join(root, "profiles", "branch.yml"), "schemaVersion: 1\nagent: {}\n");
  await writeFile(join(root, "not-packed.txt"), "local scratch\n");
}

describe("Grove projects", () => {
  it("matches the cross-platform golden artifact digest", async () => {
    const output = join(tempDirs.make("branch-grove-golden-"), "golden.tgz");
    const result = await buildGroveProject(
      join(process.cwd(), "test", "fixtures", "groves", "project-v1"),
      output,
    );

    expect(result.integrity).toBe(GOLDEN_ARTIFACT_INTEGRITY);
  });

  it("matches the golden artifact digest under a restrictive umask", () => {
    const output = join(tempDirs.make("branch-grove-umask-"), "golden.tgz");
    const project = join(process.cwd(), "test", "fixtures", "groves", "project-v1");
    const projectBuildUrl = resolveRuntimeWorkerUrl(groveProjectBuildEntrypoint);
    const script = [
      "process.umask(0o077);",
      `const { buildGroveProject } = await import(${JSON.stringify(projectBuildUrl.href)});`,
      `const result = await buildGroveProject(${JSON.stringify(project)}, ${JSON.stringify(output)});`,
      "process.stdout.write(result.integrity);",
    ].join("\n");

    const result = spawnSync(
      process.execPath,
      [
        ...resolveRuntimeWorkerArgv(projectBuildUrl).slice(0, -1),
        "--input-type=module",
        "--eval",
        script,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_DISABLE_COMPILE_CACHE: "1",
          NODE_OPTIONS: undefined,
          VITEST: undefined,
          VITEST_POOL_ID: undefined,
          VITEST_WORKER_ID: undefined,
        },
        timeout: 60_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(GOLDEN_ARTIFACT_INTEGRITY);
  });

  it("refuses to publish and removes staging when a completed file fails to close", async () => {
    const outputDirectory = tempDirs.make("branch-grove-close-failure-");
    const output = join(outputDirectory, "grove.tgz");
    const closeError = Object.assign(new Error("staged file close failed"), { code: "EIO" });
    const open = fs.open;
    let closeAttempts = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (
        String(args[0]).startsWith(`${outputDirectory}${sep}`) &&
        (await handle.stat()).isFile()
      ) {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, "close").mockImplementation(async () => {
          await close();
          closeAttempts += 1;
          throw closeError;
        });
      }
      return handle;
    });
    try {
      await withEnvAsync({ FS_SAFE_NATIVE_MODE: "off" }, async () => {
        await expect(
          buildGroveProject(join(process.cwd(), "test", "fixtures", "groves", "project-v1"), output),
        ).rejects.toBe(closeError);
      });
      expect(closeAttempts).toBe(1);
      await expect(readdir(outputDirectory)).resolves.toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("creates a minimal project that validates through the canonical reader", async () => {
    const root = join(tempDirs.make("branch-grove-create-"), "research-assistant");

    const created = await createGroveProject(root);
    const validated = await validateGroveProject(root);

    expect(created.packageJson).toEqual({
      name: "research-assistant",
      version: "0.1.0",
      branch: { grove: "GROVE.md" },
    });
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.grove.manifest.agent.id).toBe("research-assistant");
      expect(validated.grove.groveMarkdownBody?.toString()).toContain("purpose-built Branch Agent agent");
    }
  });

  it("keeps one concurrent creator's completed project", async () => {
    const root = join(tempDirs.make("branch-grove-create-race-"), "shared");
    await mkdir(root);

    const results = await Promise.allSettled([createGroveProject(root), createGroveProject(root)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(validateGroveProject(root)).resolves.toMatchObject({ ok: true });
  });

  it("refuses occupied targets and package lifecycle scripts", async () => {
    const occupied = tempDirs.make("branch-grove-occupied-");
    await writeFile(join(occupied, "keep.txt"), "keep\n");
    await expect(createGroveProject(occupied)).rejects.toMatchObject({
      code: "project_target_not_empty",
    } satisfies Partial<GroveProjectError>);

    const project = tempDirs.make("branch-grove-scripts-");
    await writeRichProject(project);
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        name: "demo-grove",
        version: "1.2.3",
        scripts: { postinstall: "echo unsafe" },
        branch: { grove: "GROVE.md" },
      }),
    );
    const result = await validateGroveProject(project);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((item) => item.code)).toContain("project_scripts_forbidden");
    }
  });

  it("rejects package.json as a managed workspace source", async () => {
    const project = tempDirs.make("branch-grove-package-source-");
    const output = join(tempDirs.make("branch-grove-package-source-output-"), "grove.tgz");
    await writeRichProject(project);
    const manifest = await readFile(join(project, "GROVE.md"), "utf8");
    await writeFile(
      join(project, "GROVE.md"),
      manifest.replace(
        "    - source: workspace/reference.md\n      path: reference.md",
        "    - source: package.json\n      path: metadata.json",
      ),
    );

    await expect(validateGroveProject(project)).resolves.toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "project_invalid" })],
    });
    await expect(buildGroveProject(project, output)).rejects.toMatchObject({
      code: "project_invalid",
    } satisfies Partial<GroveProjectError>);
  });

  it("builds byte-identical artifacts containing only declared project inputs", async () => {
    const project = tempDirs.make("branch-grove-build-");
    const output = tempDirs.make("branch-grove-output-");
    await writeRichProject(project);
    const firstPath = join(output, "first.tgz");
    const secondPath = join(output, "second.tgz");

    const first = await buildGroveProject(project, firstPath);
    const second = await buildGroveProject(project, secondPath);
    const validation = await validateGroveProject(join(project, "workspace", "reference.md"));
    const entries: string[] = [];
    await tar.t({ file: firstPath, onentry: (entry) => entries.push(entry.path) });

    expect(await readFile(firstPath)).toEqual(await readFile(secondPath));
    expect(first.integrity).toBe(second.integrity);
    expect(first.excludedPaths).toEqual(["not-packed.txt"]);
    expect(validation).toMatchObject({ ok: true, excludedPaths: ["not-packed.txt"] });
    expect(entries).toEqual([
      "package/BOOTSTRAP.md",
      "package/GROVE.md",
      "package/package.json",
      "package/profiles/branch.yml",
      "package/workspace/reference.md",
    ]);
    expect(entries).not.toContain("package/not-packed.txt");
  });

  it("preserves the canonical metadata-selected Branch Agent profile path", async () => {
    const project = tempDirs.make("branch-grove-custom-profile-");
    const output = join(tempDirs.make("branch-grove-custom-profile-output-"), "grove.tgz");
    await writeRichProject(project);
    await rename(
      join(project, "profiles", "branch.yml"),
      join(project, "profiles", "custom.yaml"),
    );
    const manifest = await readFile(join(project, "GROVE.md"), "utf8");
    await writeFile(
      join(project, "GROVE.md"),
      manifest.replace(
        "agent:\n  id: demo-grove",
        "agent:\n  id: demo-grove\nmetadata:\n  branch.config: profiles/custom.yaml",
      ),
    );

    const validation = await validateGroveProject(project);
    const result = await buildGroveProject(project, output);
    const entries: string[] = [];
    await tar.t({ file: output, onentry: (entry) => entries.push(entry.path) });

    expect(validation).toMatchObject({ ok: true });
    if (validation.ok) {
      expect(validation.grove.snapshot.branchProfile?.sourcePath).toBe("profiles/custom.yaml");
      expect(validation.excludedPaths).not.toContain("profiles/custom.yaml");
    }
    expect(result.files).toContain("profiles/custom.yaml");
    expect(entries).toContain("package/profiles/custom.yaml");
    expect(entries).not.toContain("package/profiles/branch.yml");
  });

  it("packages a leading-at workspace source as an ordinary file", async () => {
    const project = tempDirs.make("branch-grove-leading-at-");
    const output = join(tempDirs.make("branch-grove-leading-at-output-"), "grove.tgz");
    await writeRichProject(project);
    const manifest = await readFile(join(project, "GROVE.md"), "utf8");
    await writeFile(
      join(project, "GROVE.md"),
      manifest.replace("workspace/reference.md", '"@notes.md"'),
    );
    await writeFile(join(project, "@notes.md"), "# Notes\n");

    const result = await buildGroveProject(project, output);
    const entries: string[] = [];
    await tar.t({ file: output, onentry: (entry) => entries.push(entry.path) });

    expect(result.files).toContain("@notes.md");
    expect(entries).toContain("package/@notes.md");
  });

  it("packages a valid source whose filename begins with two dots", async () => {
    const project = tempDirs.make("branch-grove-leading-dots-");
    const output = join(tempDirs.make("branch-grove-leading-dots-output-"), "grove.tgz");
    await writeRichProject(project);
    const manifest = await readFile(join(project, "GROVE.md"), "utf8");
    await writeFile(
      join(project, "GROVE.md"),
      manifest.replace("workspace/reference.md", "..notes.md"),
    );
    await writeFile(join(project, "..notes.md"), "# Notes\n");

    const result = await buildGroveProject(project, output);
    const entries: string[] = [];
    await tar.t({ file: output, onentry: (entry) => entries.push(entry.path) });

    expect(result.files).toContain("..notes.md");
    expect(entries).toContain("package/..notes.md");
  });

  it("normalizes accepted backslash source separators in the built package", async () => {
    const project = tempDirs.make("branch-grove-backslash-source-");
    const output = join(tempDirs.make("branch-grove-backslash-source-output-"), "grove.tgz");
    await writeRichProject(project);
    const manifest = await readFile(join(project, "GROVE.md"), "utf8");
    await writeFile(
      join(project, "GROVE.md"),
      manifest.replace(
        "    - source: workspace/reference.md",
        String.raw`    - source: 'workspace\reference.md'`,
      ),
    );

    const validation = await validateGroveProject(project);
    const result = await buildGroveProject(project, output);
    const entries: string[] = [];
    await tar.t({ file: output, onentry: (entry) => entries.push(entry.path) });

    expect(validation).toMatchObject({ ok: true });
    expect(result.files).toContain("workspace/reference.md");
    expect(entries).toContain("package/workspace/reference.md");
  });

  it("preserves long workspace source paths deterministically", async () => {
    const project = tempDirs.make("branch-grove-long-path-");
    const output = tempDirs.make("branch-grove-long-path-output-");
    await writeRichProject(project);
    const longName = `${"a".repeat(140)}.md`;
    const longSource = `workspace/${longName}`;
    const manifest = await readFile(join(project, "GROVE.md"), "utf8");
    await writeFile(
      join(project, "GROVE.md"),
      manifest.replace("workspace/reference.md", longSource),
    );
    await writeFile(join(project, longSource), "# Long path\n");

    const firstPath = join(output, "first.tgz");
    const secondPath = join(output, "second.tgz");
    const first = await buildGroveProject(project, firstPath);
    const second = await buildGroveProject(project, secondPath);
    const entries: string[] = [];
    await tar.t({ file: firstPath, onentry: (entry) => entries.push(entry.path) });

    expect(await readFile(firstPath)).toEqual(await readFile(secondPath));
    expect(first.integrity).toBe(second.integrity);
    expect(first.files).toContain(longSource);
    expect(entries).toContain(`package/${longSource}`);
  });

  it.runIf(process.platform === "win32")(
    "does not report a differently cased selected file as excluded",
    async () => {
      const project = tempDirs.make("branch-grove-selected-case-");
      await writeRichProject(project);
      const temporaryManifest = join(project, "manifest.tmp");
      await rename(join(project, "GROVE.md"), temporaryManifest);
      await rename(temporaryManifest, join(project, "grove.md"));

      const result = await validateGroveProject(project);

      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        expect(result.excludedPaths).not.toContain("grove.md");
      }
    },
  );

  it("dereferences only a confined GROVE.md symlink into the artifact", async () => {
    const project = tempDirs.make("branch-grove-manifest-link-");
    const output = join(tempDirs.make("branch-grove-manifest-link-output-"), "linked.tgz");
    const unpacked = tempDirs.make("branch-grove-manifest-link-unpacked-");
    await writeRichProject(project);
    await mkdir(join(project, "manifest"));
    await rename(join(project, "GROVE.md"), join(project, "manifest", "source.md"));
    await symlink("manifest/source.md", join(project, "GROVE.md"), "file");

    await expect(validateGroveProject(project)).resolves.toMatchObject({ ok: true });
    await buildGroveProject(project, output);
    await tar.x({ cwd: unpacked, file: output, strict: true });

    expect((await lstat(join(unpacked, "package", "GROVE.md"))).isFile()).toBe(true);
    expect(await readFile(join(unpacked, "package", "GROVE.md"), "utf8")).toContain(
      "You are the demo Grove.",
    );
  });

  it.each([".git/GROVE.md", "node_modules/example/GROVE.md"])(
    "rejects a GROVE.md symlink into excluded tree %s",
    async (targetPath) => {
      const project = tempDirs.make("branch-grove-manifest-excluded-link-");
      await writeRichProject(project);
      await mkdir(dirname(join(project, targetPath)), { recursive: true });
      await rename(join(project, "GROVE.md"), join(project, targetPath));
      await symlink(targetPath, join(project, "GROVE.md"), "file");

      await expect(validateGroveProject(project)).resolves.toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: "project_not_found" })],
      });
    },
  );

  it("rejects a GROVE.md symlink that escapes the project", async () => {
    const project = tempDirs.make("branch-grove-manifest-escape-");
    const outside = tempDirs.make("branch-grove-manifest-outside-");
    await writeRichProject(project);
    await rename(join(project, "GROVE.md"), join(outside, "GROVE.md"));
    await symlink(join(outside, "GROVE.md"), join(project, "GROVE.md"), "file");

    await expect(validateGroveProject(project)).resolves.toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "project_not_found" })],
    });
  });

  it.each([".git/config", "workspace/node_modules/example/secret.md"])(
    "rejects an explicitly selected source from %s",
    async (sourcePath) => {
      const project = tempDirs.make("branch-grove-excluded-source-");
      const output = join(tempDirs.make("branch-grove-excluded-source-output-"), "grove.tgz");
      await writeRichProject(project);
      await mkdir(dirname(join(project, sourcePath)), { recursive: true });
      await writeFile(join(project, sourcePath), "sensitive local state\n");
      const manifest = await readFile(join(project, "GROVE.md"), "utf8");
      await writeFile(
        join(project, "GROVE.md"),
        manifest.replace("workspace/reference.md", sourcePath),
      );

      await expect(validateGroveProject(project)).resolves.toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: "project_excluded_source" })],
      });
      await expect(buildGroveProject(project, output)).rejects.toMatchObject({
        code: "project_invalid",
      } satisfies Partial<GroveProjectError>);
    },
  );

  it("rejects a custom profile selected from an excluded tree", async () => {
    const project = tempDirs.make("branch-grove-excluded-profile-");
    await writeRichProject(project);
    await rename(
      join(project, "profiles", "branch.yml"),
      join(project, "profiles", "unused.yml"),
    );
    await mkdir(join(project, ".git"), { recursive: true });
    await writeFile(join(project, ".git", "profile.yaml"), "schemaVersion: 1\nagent: {}\n");
    const manifest = await readFile(join(project, "GROVE.md"), "utf8");
    await writeFile(
      join(project, "GROVE.md"),
      manifest.replace(
        "agent:\n  id: demo-grove",
        "agent:\n  id: demo-grove\nmetadata:\n  branch.config: .git/profile.yaml",
      ),
    );

    await expect(validateGroveProject(project)).resolves.toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "project_excluded_source" })],
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects a workspace source that portably collides with GROVE.md",
    async () => {
      const project = tempDirs.make("branch-grove-manifest-case-collision-");
      await writeRichProject(project);
      const manifest = await readFile(join(project, "GROVE.md"), "utf8");
      await writeFile(join(project, "grove.md"), "# Conflicting source\n");
      await writeFile(
        join(project, "GROVE.md"),
        manifest.replace("workspace/reference.md", "grove.md"),
      );

      await expect(validateGroveProject(project)).resolves.toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: "project_path_collision" })],
      });
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects a workspace source that portably collides with a custom profile",
    async () => {
      const project = tempDirs.make("branch-grove-profile-case-collision-");
      await writeRichProject(project);
      await rename(
        join(project, "profiles", "branch.yml"),
        join(project, "profiles", "custom.yaml"),
      );
      await writeFile(join(project, "profiles", "CUSTOM.yaml"), "schemaVersion: 1\nagent: {}\n");
      const manifest = await readFile(join(project, "GROVE.md"), "utf8");
      await writeFile(
        join(project, "GROVE.md"),
        manifest
          .replace(
            "agent:\n  id: demo-grove",
            "agent:\n  id: demo-grove\nmetadata:\n  branch.config: profiles/custom.yaml",
          )
          .replace("workspace/reference.md", "profiles/CUSTOM.yaml"),
      );

      await expect(validateGroveProject(project)).resolves.toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: "project_path_collision" })],
      });
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects Unicode-normalization collisions between workspace sources",
    async () => {
      const project = tempDirs.make("branch-grove-unicode-collision-");
      await writeRichProject(project);
      const composed = "workspace/caf\u00e9.md";
      const decomposed = "workspace/cafe\u0301.md";
      const manifest = await readFile(join(project, "GROVE.md"), "utf8");
      await writeFile(
        join(project, "GROVE.md"),
        manifest.replace(
          "    - source: workspace/reference.md\n      path: reference.md",
          [
            `    - source: ${JSON.stringify(composed)}`,
            "      path: composed.md",
            `    - source: ${JSON.stringify(decomposed)}`,
            "      path: decomposed.md",
          ].join("\n"),
        ),
      );
      await writeFile(join(project, composed), "# Composed\n");
      await writeFile(join(project, decomposed), "# Decomposed\n");

      await expect(validateGroveProject(project)).resolves.toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: "project_path_collision" })],
      });
    },
  );

  it("preserves an existing build destination", async () => {
    const project = tempDirs.make("branch-grove-build-existing-");
    const output = join(tempDirs.make("branch-grove-output-existing-"), "existing.tgz");
    await writeRichProject(project);
    await writeFile(output, "keep this artifact\n");

    await expect(buildGroveProject(project, output)).rejects.toMatchObject({
      code: "artifact_exists",
    } satisfies Partial<GroveProjectError>);
    expect(await readFile(output, "utf8")).toBe("keep this artifact\n");
  });

  it("rejects ambiguous nested project discovery", async () => {
    const outer = tempDirs.make("branch-grove-nested-");
    const inner = join(outer, "examples", "nested");
    await writeRichProject(outer);
    await writeRichProject(inner);

    const result = await validateGroveProject(join(inner, "GROVE.md"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((item) => item.code)).toContain("ambiguous_project_root");
    }
  });

  it("changes the artifact digest when a declared input changes", async () => {
    const project = tempDirs.make("branch-grove-build-change-");
    const output = tempDirs.make("branch-grove-output-change-");
    await writeRichProject(project);

    const first = await buildGroveProject(project, join(output, "first.tgz"));
    await writeFile(join(project, "workspace", "reference.md"), "# Changed reference\n");
    const second = await buildGroveProject(project, join(output, "second.tgz"));

    expect(first.integrity).not.toBe(second.integrity);
  });
});
