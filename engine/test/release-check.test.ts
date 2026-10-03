// Release check tests cover release validation script behavior.
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath, win32 } from "node:path";
import { bundledDistPluginFile } from "branch/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { collectBundledExtensionManifestErrors } from "../scripts/lib/bundled-extension-manifest.ts";
import { listBundledPluginPackArtifacts } from "../scripts/lib/bundled-plugin-build-entries.mjs";
import { resolveNpmJsonEntries } from "../scripts/lib/npm-json-output.mts";
import { collectPackUnpackedSizeFindings } from "../scripts/lib/npm-pack-budget.mts";
import { PACKAGE_DIST_INVENTORY_RELATIVE_PATH } from "../scripts/lib/package-dist-inventory-contract.mts";
import { createWorkspaceBootstrapSmokeEnv } from "../scripts/lib/workspace-bootstrap-smoke.mts";
import { collectInstalledBundledRuntimeSidecarPaths } from "../scripts/branch-npm-postpublish-verify.ts";
import {
  allowsLegacyGeneratedOwnershipForSourceRoot,
  collectAppcastSparkleVersionErrors,
  collectCriticalPluginSdkEntrypointSizeFindings,
  collectForbiddenPackContentPaths,
  collectForbiddenPackPaths,
  collectSkillShellScriptExecutableErrors,
  collectPackedInstalledPackageVerificationErrors,
  createPackedPluginSdkTypescriptSmokeProject,
  createPackedCompletionSmokeEnv,
  createPackedCliSmokeEnv,
  MAX_CRITICAL_PLUGIN_SDK_ENTRYPOINT_BYTES,
  PACKED_BUNDLED_RUNTIME_DEPS_REPAIR_ARGS,
  PACKED_CLI_SMOKE_COMMANDS,
  PACKED_COMPLETION_SMOKE_ARGS,
  resolvePackedTarballPath,
  resolveReleaseNpmCommand,
  runReleaseCheckCommand,
} from "../scripts/release-check.ts";
import { COMPLETION_SKIP_PLUGIN_COMMANDS_ENV } from "../src/cli/completion-runtime.ts";
import { resolveNpmJsonEntries as resolveRuntimeNpmJsonEntries } from "../src/infra/npm-registry-spec.js";
import { withEnv } from "../src/test-utils/env.js";
import { useAutoCleanupTempDirTracker } from "./helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function makeItem(shortVersion: string, sparkleVersion: string, channel?: string): string {
  const channelElement = channel ? `<sparkle:channel>${channel}</sparkle:channel>` : "";
  return `<item><title>${shortVersion}</title><sparkle:shortVersionString>${shortVersion}</sparkle:shortVersionString><sparkle:version>${sparkleVersion}</sparkle:version>${channelElement}</item>`;
}

function makePackResult(filename: string, unpackedSize: number) {
  return { filename, unpackedSize };
}

function withProcessEnv<T>(env: Record<string, string>, callback: () => T): T {
  return withEnv(env, callback);
}

const requiredBundledPluginPackPaths = listBundledPluginPackArtifacts();

// Prepare the public SDK graph through the test runner before the consumer test deadline.
await import("branch/plugin-sdk/channel-outbound");

describe("collectAppcastSparkleVersionErrors", () => {
  it("accepts legacy 9-digit calver builds before lane-floor cutover", () => {
    const xml = `<rss><channel>${makeItem("2026.2.26", "202602260")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toStrictEqual([]);
  });

  it("requires lane-floor builds on and after lane-floor cutover", () => {
    const xml = `<rss><channel>${makeItem("2026.3.1", "202603010")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toEqual([
      "appcast item '2026.3.1' has sparkle:version 202603010 below lane floor 2026030190.",
    ]);
  });

  it("accepts canonical stable lane builds on and after lane-floor cutover", () => {
    const xml = `<rss><channel>${makeItem("2026.3.1", "2026030190")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toStrictEqual([]);
  });

  it("accepts canonical beta lane builds", () => {
    const xml = `<rss><channel>${makeItem("2026.6.5-beta.2", "2606000502", "beta")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toStrictEqual([]);
  });

  it("rejects beta builds on the default channel", () => {
    const xml = `<rss><channel>${makeItem("2026.6.5-beta.2", "2606000502")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toEqual([
      "appcast item '2026.6.5-beta.2' must set sparkle:channel to 'beta'.",
    ]);
  });

  it("rejects appcast entries with invalid prerelease lanes", () => {
    const xml = `<rss><channel>${makeItem("2026.6.5-beta.0", "2606000500", "beta")}</channel></rss>`;

    expect(collectAppcastSparkleVersionErrors(xml)).toEqual([
      "appcast item '2026.6.5-beta.0' has invalid sparkle:shortVersionString '2026.6.5-beta.0'.",
    ]);
  });
});

describe("packed CLI smoke", () => {
  it("keeps generated dynamic imports opaque to tsx's source lexer", () => {
    expect(readFileSync("scripts/release-check.ts", "utf8")).not.toContain("import(");
  });

  it("keeps the expected packaged CLI smoke command list", () => {
    expect(PACKED_CLI_SMOKE_COMMANDS).toEqual([
      ["--help"],
      ["onboard", "--help"],
      ["doctor", "--help"],
      ["status", "--json", "--timeout", "1"],
      ["config", "schema"],
      ["models", "list", "--provider", "openai"],
    ]);
  });

  it("repairs bundled runtime deps before the read-only plugin doctor smoke", () => {
    expect(PACKED_BUNDLED_RUNTIME_DEPS_REPAIR_ARGS).toEqual([
      "doctor",
      "--fix",
      "--non-interactive",
    ]);
  });

  it("keeps packed completion smoke scoped to one shell cache", () => {
    expect(PACKED_COMPLETION_SMOKE_ARGS).toEqual(["completion", "--write-state", "--shell", "zsh"]);
  });

  it("builds a packed CLI smoke env with packaged-install guardrails", () => {
    expect(
      createPackedCliSmokeEnv(
        {
          PATH: "/usr/bin",
          HOME: "/tmp/original-home",
          USERPROFILE: "/tmp/original-profile",
          TMPDIR: "/tmp/original-tmp",
          SystemRoot: "C:\\Windows",
          GITHUB_TOKEN: "redacted",
          OPENAI_API_KEY: "real-secret",
          BRANCH_CONFIG_PATH: "/tmp/leaky-config.json",
        },
        { HOME: "/tmp/smoke-home", BRANCH_STATE_DIR: "/tmp/smoke-state" },
      ),
    ).toEqual({
      PATH:
        process.platform === "win32"
          ? `${dirname(process.execPath)};C:\\Windows\\System32;C:\\Windows`
          : `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: "/tmp/smoke-home",
      USERPROFILE: "/tmp/smoke-home",
      ComSpec: join("C:\\Windows", "System32", "cmd.exe"),
      APPDATA: join("/tmp/smoke-home", "AppData", "Roaming"),
      LOCALAPPDATA: join("/tmp/smoke-home", "AppData", "Local"),
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_SHARED_CREDENTIALS_FILE: join("/tmp/smoke-home", ".aws", "credentials"),
      AWS_CONFIG_FILE: join("/tmp/smoke-home", ".aws", "config"),
      TMPDIR: "/tmp/original-tmp",
      SystemRoot: "C:\\Windows",
      BRANCH_DISABLE_BUNDLED_ENTRY_SOURCE_FALLBACK: "1",
      BRANCH_NO_ONBOARD: "1",
      BRANCH_SERVICE_REPAIR_POLICY: "external",
      BRANCH_SUPPRESS_NOTES: "1",
      BRANCH_STATE_DIR: "/tmp/smoke-state",
    });
  });

  it("does not inherit provider credentials from the base environment", () => {
    const env = createPackedCliSmokeEnv({
      HOME: "/tmp/original-home",
      OPENAI_API_KEY: "base-openai-secret",
    });

    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("does not admit provider credentials through smoke overrides", () => {
    const env = createPackedCliSmokeEnv(
      { HOME: "/tmp/original-home" },
      {
        HOME: "/tmp/smoke-home",
        BRANCH_STATE_DIR: "/tmp/smoke-state",
        OPENAI_API_KEY: "override-openai-secret",
      },
    );

    expect(env).toMatchObject({
      HOME: "/tmp/smoke-home",
      BRANCH_STATE_DIR: "/tmp/smoke-state",
    });
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("skips plugin command discovery during packed completion cache smoke", () => {
    expect(
      createPackedCompletionSmokeEnv(
        {
          PATH: "/usr/bin",
          BRANCH_COMPLETION_SKIP_PLUGIN_COMMANDS: "0",
        },
        {
          HOME: "/tmp/smoke-home",
          BRANCH_STATE_DIR: "/tmp/smoke-state",
        },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/smoke-home",
      BRANCH_STATE_DIR: "/tmp/smoke-state",
      BRANCH_SUPPRESS_NOTES: "1",
      BRANCH_DISABLE_BUNDLED_ENTRY_SOURCE_FALLBACK: "1",
      [COMPLETION_SKIP_PLUGIN_COMMANDS_ENV]: "1",
    });
  });
});

describe("runReleaseCheckCommand", () => {
  it("returns captured command output", () => {
    expect(
      runReleaseCheckCommand(
        { command: process.execPath, args: ["--eval", "process.stdout.write('ok')"] },
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    ).toBe("ok");
  });

  it("bounds commands that ignore termination", () => {
    const startedAt = Date.now();

    expect(() =>
      runReleaseCheckCommand(
        {
          command: process.execPath,
          args: ["--eval", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
        },
        { stdio: ["ignore", "pipe", "pipe"], timeoutMs: 100 },
      ),
    ).toThrow();
    expect(Date.now() - startedAt).toBeLessThan(2500);
  });

  it("bounds captured command output", () => {
    expect(() =>
      runReleaseCheckCommand(
        { command: process.execPath, args: ["--eval", "process.stdout.write('x'.repeat(4096))"] },
        { maxBuffer: 1024, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ).toThrow();
  });

  it("rejects malformed command limit environment values", () => {
    withProcessEnv({ BRANCH_RELEASE_CHECK_COMMAND_TIMEOUT_MS: "1e3" }, () => {
      expect(() =>
        runReleaseCheckCommand(
          { command: process.execPath, args: ["--eval", "process.stdout.write('ok')"] },
          { stdio: ["ignore", "pipe", "pipe"] },
        ),
      ).toThrow("invalid BRANCH_RELEASE_CHECK_COMMAND_TIMEOUT_MS: 1e3");
    });

    withProcessEnv({ BRANCH_RELEASE_CHECK_COMMAND_MAX_BUFFER_BYTES: "16mb" }, () => {
      expect(() =>
        runReleaseCheckCommand(
          { command: process.execPath, args: ["--eval", "process.stdout.write('ok')"] },
          { stdio: ["ignore", "pipe", "pipe"] },
        ),
      ).toThrow("invalid BRANCH_RELEASE_CHECK_COMMAND_MAX_BUFFER_BYTES: 16mb");
    });
  });
});

describe("resolveReleaseNpmCommand", () => {
  it("wraps Windows npm.cmd release checks through cmd.exe without shell mode", () => {
    const nodeDir = "C:\\Program Files\\nodejs";
    const npmCmdPath = win32.resolve(nodeDir, "npm.cmd");

    expect(
      resolveReleaseNpmCommand(["pack", "--dry-run", "--json"], {
        comSpec: "C:\\Windows\\System32\\cmd.exe",
        env: { PATH: "C:\\bin" },
        execPath: win32.join(nodeDir, "node.exe"),
        existsSync: (candidate) => candidate === npmCmdPath,
        platform: "win32",
      }),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '""C:\\Program Files\\nodejs\\npm.cmd" pack --dry-run --json"'],
      shell: false,
      windowsVerbatimArguments: true,
    });
  });

  it("rejects bare npm fallback on Windows release checks", () => {
    expect(() =>
      resolveReleaseNpmCommand(["pack"], {
        execPath: "C:\\Program Files\\nodejs\\node.exe",
        existsSync: () => false,
        platform: "win32",
      }),
    ).toThrow("Branch Agent refuses to shell out to bare npm on Windows");
  });
});

describe("workspace bootstrap smoke", () => {
  it("runs with a sterile env instead of maintainer provider credentials", () => {
    expect(
      createWorkspaceBootstrapSmokeEnv(
        {
          PATH: "/usr/bin",
          HOME: "/tmp/original-home",
          TMPDIR: "/tmp/original-tmp",
          OPENAI_API_KEY: "real-secret",
          ANTHROPIC_API_KEY: "real-secret",
          BRANCH_CONFIG_PATH: "/tmp/leaky-config.json",
        },
        "/tmp/bootstrap-home",
      ),
    ).toEqual({
      PATH:
        process.platform === "win32"
          ? `${dirname(process.execPath)};C:\\Windows\\System32;C:\\Windows`
          : `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: "/tmp/bootstrap-home",
      USERPROFILE: "/tmp/bootstrap-home",
      BRANCH_HOME: "/tmp/bootstrap-home",
      TMPDIR: "/tmp/original-tmp",
      BRANCH_NO_ONBOARD: "1",
      BRANCH_SUPPRESS_NOTES: "1",
      BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
      BRANCH_DISABLE_BUNDLED_ENTRY_SOURCE_FALLBACK: "1",
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_SHARED_CREDENTIALS_FILE: join("/tmp/bootstrap-home", ".aws", "credentials"),
      AWS_CONFIG_FILE: join("/tmp/bootstrap-home", ".aws", "config"),
    });
  });
});

describe("collectBundledExtensionManifestErrors", () => {
  it("flags invalid bundled extension install metadata", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "broken",
          packageJson: {
            branch: {
              install: { npmSpec: "   " },
            },
          },
        },
      ]),
    ).toEqual([
      "bundled extension 'broken' manifest invalid | branch.install.npmSpec must be a non-empty string",
    ]);
  });

  it("flags invalid bundled extension minHostVersion metadata", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "broken",
          packageJson: {
            branch: {
              install: { npmSpec: "@branch/broken", minHostVersion: "2026.3.14" },
            },
          },
        },
      ]),
    ).toEqual([
      "bundled extension 'broken' manifest invalid | branch.install.minHostVersion must use a semver floor in the form \">=x.y.z[-prerelease][+build]\"",
    ]);
  });

  it("allows install metadata without npmSpec when only non-publish metadata is present", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "irc",
          packageJson: {
            branch: {
              install: { minHostVersion: ">=2026.3.14" },
            },
          },
        },
      ]),
    ).toStrictEqual([]);
  });

  it("flags non-object install metadata instead of throwing", () => {
    expect(
      collectBundledExtensionManifestErrors([
        {
          id: "broken",
          packageJson: {
            branch: {
              install: 123,
            },
          },
        },
      ]),
    ).toEqual(["bundled extension 'broken' manifest invalid | branch.install must be an object"]);
  });
});

// This suite exists both as regression coverage and as an intentional CI touchpoint for executable-bit fixes.
// Windows doesn't support Unix permission bits; chmod 0o755 is a no-op and
// statSync().mode never reports execute bits, so these tests are meaningless there.
describe.skipIf(process.platform === "win32")("collectSkillShellScriptExecutableErrors", () => {
  it("flags non-executable shell scripts under skills/*/scripts", () => {
    const root = mkdtempSync(join(tmpdir(), "branch-release-check-"));
    const scriptPath = join(root, "skills", "openai-whisper-api", "scripts", "transcribe.sh");
    mkdirSync(join(root, "skills", "openai-whisper-api", "scripts"), { recursive: true });
    writeFileSync(scriptPath, "#!/usr/bin/env bash\necho test\n", "utf8");
    chmodSync(scriptPath, 0o644);

    try {
      expect(collectSkillShellScriptExecutableErrors(root)).toEqual([
        "skill shell script is not executable: skills/openai-whisper-api/scripts/transcribe.sh",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts executable shell scripts", () => {
    const root = mkdtempSync(join(tmpdir(), "branch-release-check-"));
    const scriptPath = join(root, "skills", "openai-whisper-api", "scripts", "transcribe.sh");
    mkdirSync(join(root, "skills", "openai-whisper-api", "scripts"), { recursive: true });
    writeFileSync(scriptPath, "#!/usr/bin/env bash\necho test\n", "utf8");
    chmodSync(scriptPath, 0o755);

    try {
      expect(collectSkillShellScriptExecutableErrors(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("collectForbiddenPackPaths", () => {
  it("leaves npm-selected bundled dependency paths to the canonical tarball verifier", () => {
    expect(
      collectForbiddenPackPaths([
        "dist/index.js",
        bundledDistPluginFile("discord", "node_modules/@discordjs/voice/index.js"),
        "node_modules/.bin/branch",
      ]),
    ).toEqual([]);
  });

  it("blocks legacy runtime dependency stamps from npm pack output", () => {
    expect(
      collectForbiddenPackPaths([
        "dist/index.js",
        "dist/extensions/browser/.Branch-Install-Stage/package.json",
        "dist/extensions/codex/.branch-runtime-deps-backup-node_modules-old/zod/index.js",
        "dist/extensions/discord/.branch-runtime-deps-stamp.json",
      ]),
    ).toEqual([
      "dist/extensions/browser/.Branch-Install-Stage/package.json",
      "dist/extensions/codex/.branch-runtime-deps-backup-node_modules-old/zod/index.js",
      "dist/extensions/discord/.branch-runtime-deps-stamp.json",
    ]);
  });

  it("blocks root dist chunks that still reference private qa lab sources", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "branch-release-private-qa-"));

    try {
      mkdirSync(join(tempRoot, "dist"), { recursive: true });
      writeFileSync(
        join(tempRoot, "dist", "entry.js"),
        "//#region extensions/qa-lab/src/runtime-api.ts\n",
        "utf8",
      );
      writeFileSync(join(tempRoot, "CHANGELOG.md"), "local QA notes mention extensions/qa-lab/\n");

      expect(collectForbiddenPackContentPaths(["dist/entry.js", "CHANGELOG.md"], tempRoot)).toEqual(
        ["dist/entry.js"],
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks private QA paths in the generated dist inventory", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "branch-release-inventory-"));

    try {
      mkdirSync(join(tempRoot, "dist"), { recursive: true });
      writeFileSync(
        join(tempRoot, PACKAGE_DIST_INVENTORY_RELATIVE_PATH),
        JSON.stringify(["dist/extensions/qa-lab/runtime-api.js"]),
        "utf8",
      );

      expect(
        collectForbiddenPackContentPaths([PACKAGE_DIST_INVENTORY_RELATIVE_PATH], tempRoot),
      ).toEqual([PACKAGE_DIST_INVENTORY_RELATIVE_PATH]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks root plugin SDK declarations that still reference private test helpers", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "branch-release-private-sdk-"));

    try {
      mkdirSync(join(tempRoot, "dist", "plugin-sdk"), { recursive: true });
      writeFileSync(
        join(tempRoot, "dist", "plugin-sdk", "channel-test-helpers.d.ts"),
        "//#region src/plugin-sdk/test-helpers/session.ts\n",
        "utf8",
      );

      expect(
        collectForbiddenPackContentPaths(["dist/plugin-sdk/channel-test-helpers.d.ts"], tempRoot),
      ).toEqual(["dist/plugin-sdk/channel-test-helpers.d.ts"]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("packed install verification", () => {
  it("disables legacy ownership when the historical metadata producer exists", () => {
    const sourceRoot = tempDirs.make("release-check-ownership-producer-");
    expect(allowsLegacyGeneratedOwnershipForSourceRoot(sourceRoot)).toBe(true);

    const producerPath = join(
      sourceRoot,
      "scripts/lib/runtime-dependency-ownership-build-plugin.mts",
    );
    mkdirSync(dirname(producerPath), { recursive: true });
    writeFileSync(producerPath, "export {};\n", "utf8");

    expect(allowsLegacyGeneratedOwnershipForSourceRoot(sourceRoot)).toBe(false);
  });

  it("runs postpublish package integrity checks against the packed install before publish", () => {
    const root = mkdtempSync(join(tmpdir(), "release-check-packed-install-"));
    try {
      const packageRoot = join(root, "branch");
      const distDir = join(packageRoot, "dist");
      mkdirSync(distDir, { recursive: true });
      for (const relativePath of [
        "facade-activation-check.runtime.js",
        "extensions/image-generation-core/runtime-api.js",
      ]) {
        const filePath = join(distDir, relativePath);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, "export {};\n");
      }
      for (const relativePath of requiredBundledPluginPackPaths) {
        const artifactPath = join(packageRoot, relativePath);
        mkdirSync(dirname(artifactPath), { recursive: true });
        writeFileSync(artifactPath, relativePath.endsWith(".json") ? "{}\n" : "export {};\n");
      }
      writeFileSync(
        join(packageRoot, PACKAGE_DIST_INVENTORY_RELATIVE_PATH),
        JSON.stringify(requiredBundledPluginPackPaths),
      );
      for (const relativePath of collectInstalledBundledRuntimeSidecarPaths(packageRoot)) {
        const sidecarPath = join(packageRoot, relativePath);
        mkdirSync(dirname(sidecarPath), { recursive: true });
        writeFileSync(sidecarPath, "export {};\n");
      }
      writeFileSync(
        join(packageRoot, "package.json"),
        `${JSON.stringify({ name: "branch", version: "2026.5.14-beta.3", dependencies: {} })}\n`,
      );
      writeFileSync(join(distDir, "typescript-compiler.js"), "x".repeat(6 * 1024 * 1024 + 1));

      expect(
        collectPackedInstalledPackageVerificationErrors({
          expectedVersion: "2026.5.14-beta.3",
          installedBinaryVersion: "branch 2026.5.14-beta.3",
          packageRoot,
        }),
      ).toEqual([
        "installed package root dist file 'typescript-compiler.js' is invalid or exceeds 6291456 bytes.",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires bundled plugin runtime sidecars that dynamic plugin boundaries resolve at runtime", () => {
    expect(requiredBundledPluginPackPaths).not.toContain(
      bundledDistPluginFile("slack", "runtime-api.js"),
    );
    expect(requiredBundledPluginPackPaths).toContain(
      bundledDistPluginFile("telegram", "runtime-api.js"),
    );
  });
});

describe("createPackedPluginSdkTypescriptSmokeProject", () => {
  it("preserves the unchanged released progress consumer behavior", async () => {
    await import("../scripts/fixtures/packed-plugin-sdk-progress-consumer.js");
  });

  it("creates a focused strict-declaration progress consumer without source aliases", () => {
    const consumerDir = mkdtempSync(join(tmpdir(), "release-check-progress-consumer-"));
    try {
      createPackedPluginSdkTypescriptSmokeProject({
        consumerDir,
        packageSpec: "2026.9.4",
        progressConsumerOnly: true,
      });
      expect(JSON.parse(readFileSync(join(consumerDir, "tsconfig.json"), "utf8"))).toEqual({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          types: ["node"],
          target: "ES2022",
        },
        include: ["src/packed-plugin-sdk-progress-consumer.ts"],
      });
      expect(
        readFileSync(join(consumerDir, "src/packed-plugin-sdk-progress-consumer.ts"), "utf8"),
      ).toBe(readFileSync("scripts/fixtures/packed-plugin-sdk-progress-consumer.ts", "utf8"));
    } finally {
      rmSync(consumerDir, { recursive: true, force: true });
    }
  });

  it("limits setupSurface omission to the recorded frozen targets", async () => {
    const { packedPluginSdkMayOmitSetupSurface } = await import("../scripts/release-check.js");
    expect(packedPluginSdkMayOmitSetupSurface("2026.7.33")).toBe(true);
    expect(packedPluginSdkMayOmitSetupSurface("2026.7.34")).toBe(true);
    expect(packedPluginSdkMayOmitSetupSurface("2026.7.35")).toBe(true);
    expect(packedPluginSdkMayOmitSetupSurface("2026.7.36")).toBe(false);
    expect(packedPluginSdkMayOmitSetupSurface("2026.7.35-beta.1")).toBe(false);
    expect(packedPluginSdkMayOmitSetupSurface("2026.9.4")).toBe(false);
    expect(packedPluginSdkMayOmitSetupSurface("2026.10.1")).toBe(false);
  });

  it("writes a consumer project that imports representative public SDK subpaths", () => {
    const root = mkdtempSync(join(tmpdir(), "release-check-plugin-sdk-types-"));
    try {
      const consumerDir = join(root, "consumer");
      const packageRoot = join(root, "branch");
      createPackedPluginSdkTypescriptSmokeProject({
        consumerDir,
        packageSpec: `file:${packageRoot}`,
        aiPackageSpec: "file:/tmp/branch-ai.tgz",
      });

      const packageJson = JSON.parse(readFileSync(join(consumerDir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const tsconfig = JSON.parse(readFileSync(join(consumerDir, "tsconfig.json"), "utf8")) as {
        compilerOptions?: Record<string, unknown>;
      };
      const source = readFileSync(join(consumerDir, "src", "index.ts"), "utf8");
      const fixtureSource = readFileSync(
        "scripts/fixtures/packed-plugin-sdk-type-smoke.ts",
        "utf8",
      );

      expect(packageJson.dependencies?.branch).toBe(`file:${packageRoot}`);
      expect(packageJson.dependencies?.["@types/ws"]).toBe("8.18.1");
      expect(packageJson.dependencies?.typescript).toBe("7.0.2");
      expect(packageJson.dependencies?.["@branch/ai"]).toBe("file:/tmp/branch-ai.tgz");
      expect(tsconfig.compilerOptions?.skipLibCheck).toBe(false);
      expect(source).toBe(fixtureSource);
      expect(source).toContain('"branch/plugin-sdk/core"');
      expect(source).toContain('"branch/plugin-sdk/plugin-entry"');
      expect(source).toContain('"branch/plugin-sdk/channel-entry-contract"');
      expect(source).toContain('"branch/plugin-sdk/config-contracts"');
      expect(source).toContain('"branch/plugin-sdk/runtime-env"');
      expect(source).toContain('"branch/plugin-sdk/tool-plugin"');
      expect(source).toContain("defineToolPlugin");
      expect(source).toContain("type PublicPluginSdkModules = [");
      expect(source).not.toContain("TelegramAccountConfig");
      expect(source).not.toContain("branch/plugin-sdk/channel-contract-testing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("collectPackUnpackedSizeFindings", () => {
  it("accepts pack results at the exact budget", () => {
    expect(
      collectPackUnpackedSizeFindings([makePackResult("candidate.tgz", 320 * 1024 * 1024)]),
    ).toStrictEqual({ errors: [], violations: [] });
  });

  it("accepts npm 12 name-keyed pack results", () => {
    expect(
      collectPackUnpackedSizeFindings({
        branch: makePackResult("branch-2026.3.14.tgz", 120_354_302),
      }),
    ).toStrictEqual({ errors: [], violations: [] });
  });

  it("rejects pack results one byte above the unpacked size budget", () => {
    expect(
      collectPackUnpackedSizeFindings([makePackResult("candidate.tgz", 320 * 1024 * 1024 + 1)]),
    ).toEqual({
      errors: [],
      violations: [
        {
          file: "package.json",
          title: "npm package unpacked size budget",
          message:
            "candidate.tgz unpackedSize 335544321 bytes (320.0 MiB) exceeds budget 335544320 bytes (320.0 MiB). Investigate duplicate channel shims, copied extension trees, or other accidental pack bloat before release.",
        },
      ],
    });
  });

  it("honors an explicit lower unpacked size budget", () => {
    expect(
      collectPackUnpackedSizeFindings([makePackResult("candidate.tgz", 101)], { budgetBytes: 100 }),
    ).toEqual({
      errors: [],
      violations: [
        expect.objectContaining({
          message: expect.stringContaining(
            "unpackedSize 101 bytes (0.0 MiB) exceeds budget 100 bytes",
          ),
        }),
      ],
    });
  });

  it("fails closed when npm pack output omits unpackedSize for every result", () => {
    expect(
      collectPackUnpackedSizeFindings([
        { filename: "branch-2026.3.14.tgz" },
        { filename: "branch-extra.tgz", unpackedSize: Number.NaN },
      ]),
    ).toEqual({
      errors: [
        "npm pack --dry-run produced no unpackedSize data; pack size budget was not verified.",
      ],
      violations: [],
    });
  });
});

describe("resolveNpmJsonEntries", () => {
  it("normalizes npm <=11 arrays and npm 12 name-keyed objects", () => {
    const entry = makePackResult("branch-2026.7.2.tgz", 120_354_302);

    expect(resolveNpmJsonEntries([entry])).toEqual([entry]);
    expect(resolveNpmJsonEntries(entry)).toEqual([entry]);
    expect(resolveNpmJsonEntries({ branch: entry })).toEqual([entry]);
    expect(resolveNpmJsonEntries({ "@branch/demo": entry })).toEqual([entry]);
    expect(resolveNpmJsonEntries({ branch: entry })).toEqual(
      resolveRuntimeNpmJsonEntries({ branch: entry }),
    );
  });
});

describe("resolvePackedTarballPath", () => {
  it("resolves one local npm pack tarball filename inside the pack destination", () => {
    expect(
      resolvePackedTarballPath("/tmp/branch-pack", [{ filename: "branch-2026.6.17.tgz" }]),
    ).toBe(resolvePath("/tmp/branch-pack", "branch-2026.6.17.tgz"));
    expect(
      resolvePackedTarballPath("/tmp/branch-pack", [
        { filename: "/tmp/branch-pack/branch-2026.6.17.tgz" },
      ]),
    ).toBe(resolvePath("/tmp/branch-pack", "branch-2026.6.17.tgz"));
  });

  it("rejects path-like npm pack tarball filenames", () => {
    const unsafeFilenames = [
      "../branch.tgz",
      "nested/branch.tgz",
      "nested\\branch.tgz",
      "/tmp/branch.tgz",
      "C:\\temp\\branch.tgz",
      "branch\u0000.tgz",
      "branch.tar.gz",
    ];

    for (const filename of unsafeFilenames) {
      expect(() => resolvePackedTarballPath("/tmp/branch-pack", [{ filename }])).toThrow(
        "release-check: npm pack reported unsafe tarball filename",
      );
    }
  });
});

describe("collectCriticalPluginSdkEntrypointSizeFindings", () => {
  it("flags oversized public plugin SDK entrypoints before publish", () => {
    const root = mkdtempSync(join(tmpdir(), "release-check-critical-sdk-"));
    try {
      const pluginSdkDir = join(root, "dist", "plugin-sdk");
      mkdirSync(pluginSdkDir, { recursive: true });
      writeFileSync(join(pluginSdkDir, "core.js"), "export {};\n");
      writeFileSync(
        join(pluginSdkDir, "provider-entry.js"),
        "x".repeat(MAX_CRITICAL_PLUGIN_SDK_ENTRYPOINT_BYTES + 1),
      );

      expect(collectCriticalPluginSdkEntrypointSizeFindings(root)).toEqual({
        errors: ["dist/plugin-sdk/runtime.js is missing."],
        violations: [
          {
            file: "src/plugin-sdk/provider-entry.ts",
            title: "Plugin SDK entrypoint size budget",
            message: `dist/plugin-sdk/provider-entry.js is ${
              MAX_CRITICAL_PLUGIN_SDK_ENTRYPOINT_BYTES + 1
            } bytes, exceeding ${MAX_CRITICAL_PLUGIN_SDK_ENTRYPOINT_BYTES} bytes. Keep public SDK package entrypoints lazy and avoid bundling compiler/runtime internals.`,
          },
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
