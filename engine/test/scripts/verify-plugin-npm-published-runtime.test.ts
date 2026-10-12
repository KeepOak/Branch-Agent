// Verify Plugin Npm Published Runtime tests cover verify plugin npm published runtime script behavior.
import { describe, expect, it } from "vitest";
import {
  collectPluginNpmPublishedRuntimeErrors,
  findPackedPackageReadmePath,
  parseVerifyPublishedPluginRuntimeArgs,
  parseNpmReadmeMetadata,
  readPluginNpmCommandOptions,
  resolveNpmPackFilename,
  runPluginNpmCommand,
  usage,
} from "../../scripts/verify-plugin-npm-published-runtime.mts";

describe("plugin npm publish verifier args", () => {
  it("parses help and package specs before npm calls", () => {
    expect(parseVerifyPublishedPluginRuntimeArgs(["--help"])).toEqual({ help: true, spec: "" });
    expect(parseVerifyPublishedPluginRuntimeArgs(["--", "@branch/discord@2026.5.2"])).toEqual({
      help: false,
      spec: "@branch/discord@2026.5.2",
    });
  });

  it("rejects unknown and extra args before npm calls", () => {
    expect(() => parseVerifyPublishedPluginRuntimeArgs([])).toThrow(usage());
    expect(() => parseVerifyPublishedPluginRuntimeArgs(["--wat"])).toThrow(
      "Unknown plugin npm verifier option: --wat",
    );
    expect(() =>
      parseVerifyPublishedPluginRuntimeArgs(["@branch/discord@2026.5.2", "extra"]),
    ).toThrow("Unexpected plugin npm verifier argument: extra");
  });
});

describe("plugin npm publish verifier command limits", () => {
  it("bounds npm command runtime and captured output by default", () => {
    expect(readPluginNpmCommandOptions({})).toStrictEqual({
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5 * 60 * 1000,
    });
  });

  it("rejects loose npm command timeout and buffer overrides", () => {
    for (const value of ["60s", "1e3", "0"]) {
      expect(() =>
        readPluginNpmCommandOptions({ BRANCH_PLUGIN_NPM_COMMAND_TIMEOUT_MS: value }),
      ).toThrow(`invalid BRANCH_PLUGIN_NPM_COMMAND_TIMEOUT_MS: ${value}`);
    }
    expect(() =>
      readPluginNpmCommandOptions({
        BRANCH_PLUGIN_NPM_COMMAND_MAX_BUFFER_BYTES: "16mb",
      }),
    ).toThrow("invalid BRANCH_PLUGIN_NPM_COMMAND_MAX_BUFFER_BYTES: 16mb");
  });

  it("runs npm metadata commands with bounded exec options", () => {
    const calls: unknown[] = [];
    const output = runPluginNpmCommand(["view", "@branch/discord", "readme"], {
      env: {
        BRANCH_PLUGIN_NPM_COMMAND_MAX_BUFFER_BYTES: "1024",
        BRANCH_PLUGIN_NPM_COMMAND_TIMEOUT_MS: "2500",
      },
      execFileSyncImpl(command: string, args: string[], options: unknown) {
        calls.push({ args, command, options });
        return JSON.stringify("# Discord");
      },
    });

    expect(output).toBe(JSON.stringify("# Discord"));
    expect(calls).toStrictEqual([
      {
        args: ["view", "@branch/discord", "readme"],
        command: "npm",
        options: {
          encoding: "utf8",
          killSignal: "SIGKILL",
          maxBuffer: 1024,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 2500,
        },
      },
    ]);
  });
});

describe("collectPluginNpmPublishedRuntimeErrors", () => {
  it("rejects test and fixture files from the publication artifact", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "runtime-entry-fixture",
          branch: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
          },
        },
        files: [
          "package.json",
          "branch.plugin.json",
          "dist/index.js",
          "dist/runtime.test-harness.js",
          "skills/example/src/index.ts",
          "src/index.ts",
          "src/__fixtures__/plugin.ts",
          "src/test-support/helper.ts",
          "test/pack.test.ts",
          "root.test.ts",
        ],
      }),
    ).toEqual([
      "runtime-entry-fixture plugin npm package must not include test or fixture files: root.test.ts, src/__fixtures__/plugin.ts, src/test-support/helper.ts, test/pack.test.ts",
    ]);
  });

  it.each(
    [".js", ".mjs", ".cjs"].flatMap((extension) => [
      { extension, present: false },
      { extension, present: true },
    ]),
  )("checks declared $extension runtime presence (present=$present)", ({ extension, present }) => {
    const entry = `./lib/index${extension}`;
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "runtime-entry-fixture",
          branch: { extensions: [entry] },
        },
        files: ["package.json", "branch.plugin.json", ...(present ? [entry.slice(2)] : [])],
      }),
    ).toEqual(present ? [] : [`runtime-entry-fixture runtime extension entry not found: ${entry}`]);
  });

  it("reports a missing later JavaScript entry alongside valid JavaScript and TypeScript entries", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "runtime-entry-fixture",
          branch: { extensions: ["./first.js", "./second.mjs", "./third.cts"] },
        },
        files: ["package.json", "branch.plugin.json", "first.js", "dist/third.cjs"],
      }),
    ).toEqual(["runtime-entry-fixture runtime extension entry not found: ./second.mjs"]);
  });

  it.each([
    {
      name: "uses a valid override without the declared source",
      sourcePresent: false,
      runtimePresent: true,
    },
    {
      name: "rejects a missing override despite the declared source",
      sourcePresent: true,
      runtimePresent: false,
    },
  ])("$name for JavaScript entries", ({ sourcePresent, runtimePresent }) => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "runtime-entry-fixture",
          branch: {
            extensions: ["./index.js"],
            runtimeExtensions: ["./dist/runtime.cjs"],
          },
        },
        files: [
          "package.json",
          "branch.plugin.json",
          ...(sourcePresent ? ["index.js"] : []),
          ...(runtimePresent ? ["dist/runtime.cjs"] : []),
        ],
      }),
    ).toEqual(
      runtimePresent
        ? []
        : ["runtime-entry-fixture runtime extension entry not found: ./dist/runtime.cjs"],
    );
  });

  it.each([".ts", ".tsx", ".mts", ".cts"])(
    "rejects source-only %s runtime and setup entries",
    (extension) => {
      const errors = collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "entry-fixture",
          branch: {
            extensions: [`./src/index${extension}`],
            setupEntry: `./src/setup${extension}`,
          },
        },
        files: ["branch.plugin.json", `src/index${extension}`, `src/setup${extension}`],
      });
      expect(errors).toEqual([
        expect.stringContaining(
          `compiled runtime output for TypeScript entry ./src/index${extension}`,
        ),
        expect.stringContaining(
          `compiled runtime output for TypeScript entry ./src/setup${extension}`,
        ),
      ]);
    },
  );

  it.each([
    [".ts", ".js"],
    [".tsx", ".js"],
    [".mts", ".mjs"],
    [".cts", ".cjs"],
  ])("accepts nested compiler output for %s entries without source", (source, output) => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "entry-fixture",
          branch: {
            extensions: [`./src/index${source}`],
            setupEntry: `./src/setup${source}`,
          },
        },
        files: ["branch.plugin.json", `dist/src/index${output}`, `dist/src/setup${output}`],
      }),
    ).toEqual([]);
  });

  it("flags published plugin packages with TypeScript entries and no compiled runtime output", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        spec: "@branch/discord@2026.5.2",
        packageJson: {
          name: "@branch/discord",
          version: "2026.5.2",
          branch: {
            extensions: ["./index.ts"],
          },
        },
        files: ["package.json", "branch.plugin.json", "index.ts"],
      }),
    ).toEqual([
      "@branch/discord@2026.5.2 requires compiled runtime output for TypeScript entry ./index.ts: expected ./dist/index.js, ./dist/index.mjs, ./dist/index.cjs, ./index.js, ./index.mjs, ./index.cjs",
    ]);
  });

  it("flags reservation packages before they can pass plugin runtime verification", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/tavily-plugin",
          version: "0.0.0",
          description: "Bootstrap reservation",
        },
        files: ["package.json", "README.md"],
      }),
    ).toEqual([
      "@branch/tavily-plugin@0.0.0 plugin npm package must include branch.plugin.json",
    ]);
  });

  it("flags missing explicit runtimeExtensions outputs", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/line",
          version: "2026.5.3",
          branch: {
            extensions: ["./src/index.ts"],
            runtimeExtensions: ["./dist/index.js"],
          },
        },
        files: ["package.json", "branch.plugin.json", "src/index.ts"],
      }),
    ).toEqual(["@branch/line@2026.5.3 runtime extension entry not found: ./dist/index.js"]);
  });

  it("flags runtimeExtensions length mismatches", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/acpx",
          version: "2026.5.3",
          branch: {
            extensions: ["./index.ts", "./tools.ts"],
            runtimeExtensions: ["./dist/index.js"],
          },
        },
        files: ["package.json", "branch.plugin.json", "dist/index.js"],
      }),
    ).toEqual([
      "@branch/acpx@2026.5.3 package.json branch.runtimeExtensions length (1) must match branch.extensions length (2)",
    ]);
  });

  it("flags blank runtimeExtensions entries instead of falling back to inferred outputs", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/whatsapp",
          version: "2026.5.3",
          branch: {
            extensions: ["./src/index.ts"],
            runtimeExtensions: [" "],
          },
        },
        files: ["package.json", "branch.plugin.json", "src/index.ts", "dist/index.js"],
      }),
    ).toEqual([
      "@branch/whatsapp@2026.5.3 package.json branch.runtimeExtensions[0] must be a non-empty string",
    ]);
  });

  it("flags published plugin packages with TypeScript setup entries and no compiled setup runtime", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/line",
          version: "2026.5.3",
          branch: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            setupEntry: "./setup-entry.ts",
          },
        },
        files: [
          "package.json",
          "branch.plugin.json",
          "index.ts",
          "dist/index.js",
          "setup-entry.ts",
        ],
      }),
    ).toEqual([
      "@branch/line@2026.5.3 requires compiled runtime output for TypeScript entry ./setup-entry.ts: expected ./dist/setup-entry.js, ./dist/setup-entry.mjs, ./dist/setup-entry.cjs, ./setup-entry.js, ./setup-entry.mjs, ./setup-entry.cjs",
    ]);
  });

  it("accepts published plugin packages with explicit runtimeSetupEntry", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/example-channel",
          version: "2026.5.3",
          branch: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            setupEntry: "./setup-entry.ts",
            runtimeSetupEntry: "./dist/setup-entry.js",
          },
        },
        files: ["package.json", "branch.plugin.json", "dist/index.js", "dist/setup-entry.js"],
      }),
    ).toStrictEqual([]);
  });

  it("flags missing explicit runtimeSetupEntry outputs", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/matrix",
          version: "2026.5.3",
          branch: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            setupEntry: "./setup-entry.ts",
            runtimeSetupEntry: "./dist/setup-entry.js",
          },
        },
        files: ["package.json", "branch.plugin.json", "dist/index.js"],
      }),
    ).toEqual(["@branch/matrix@2026.5.3 runtime setup entry not found: ./dist/setup-entry.js"]);
  });

  it("flags runtimeSetupEntry without setupEntry", () => {
    expect(
      collectPluginNpmPublishedRuntimeErrors({
        packageJson: {
          name: "@branch/twitch",
          version: "2026.5.3",
          branch: {
            extensions: ["./index.ts"],
            runtimeExtensions: ["./dist/index.js"],
            runtimeSetupEntry: "./dist/setup-entry.js",
          },
        },
        files: ["package.json", "branch.plugin.json", "dist/index.js", "dist/setup-entry.js"],
      }),
    ).toEqual([
      "@branch/twitch@2026.5.3 package.json branch.runtimeSetupEntry requires branch.setupEntry",
    ]);
  });
});

describe("resolveNpmPackFilename", () => {
  it("uses the final tarball filename from plain npm pack output", () => {
    const noisyOutput = [
      "npm notice",
      "npm notice package: @branch/msteams@2026.5.24-beta.1",
      "branch-msteams-2026.5.24-beta.1.tgz",
      "",
    ].join("\n");

    expect(resolveNpmPackFilename(noisyOutput)).toBe("branch-msteams-2026.5.24-beta.1.tgz");
  });

  it("rejects path-like tarball output instead of reading outside the pack directory", () => {
    const unsafeOutputs = [
      "../branch-msteams.tgz",
      "nested/branch-msteams.tgz",
      "nested\\branch-msteams.tgz",
      "/tmp/branch-msteams.tgz",
      "C:\\temp\\branch-msteams.tgz",
      "branch-msteams\u0000.tgz",
    ];

    for (const output of unsafeOutputs) {
      expect(() => resolveNpmPackFilename(output)).toThrow(
        "npm pack did not report a tarball filename",
      );
    }
  });
});

describe("findPackedPackageReadmePath", () => {
  it("finds a root package README without accepting nested documentation files", () => {
    expect(
      findPackedPackageReadmePath(["package.json", "docs/README.md", "README.md", "dist/index.js"]),
    ).toBe("README.md");
    expect(findPackedPackageReadmePath(["package.json", "docs/README.md"])).toBe("");
  });
});

describe("parseNpmReadmeMetadata", () => {
  it.each([
    { npm: "<=11", payload: "# Plugin\n\nInstall it." },
    { npm: "12", payload: ["# Plugin\n\nInstall it."] },
  ])("accepts non-empty npm $npm readme metadata", ({ payload }) => {
    expect(parseNpmReadmeMetadata(JSON.stringify(payload))).toBe("# Plugin\n\nInstall it.");
  });

  it("rejects empty or unsupported npm readme metadata", () => {
    expect(parseNpmReadmeMetadata(JSON.stringify(""))).toBe("");
    expect(parseNpmReadmeMetadata(JSON.stringify(null))).toBe("");
    expect(parseNpmReadmeMetadata(JSON.stringify([]))).toBe("");
    expect(parseNpmReadmeMetadata(JSON.stringify(["# One", "# Two"]))).toBe("");
    expect(parseNpmReadmeMetadata("{")).toBe("");
  });
});
