// Verifies native plugin SDK resolver behavior and import aliases.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clearPluginMetadataLifecycleCaches } from "./plugin-metadata-lifecycle.js";
import {
  installBranchInternalCorePackageNativeResolver,
  installBranchPluginSdkNativeResolver,
} from "./plugin-sdk-native-resolver.js";

type NativeEsmLazyImportProbe = {
  status: number | null;
  stderr: string;
  stdout: string;
};
let nativeEsmLazyImportProbe: NativeEsmLazyImportProbe;

function writeJsonFile(targetPath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFakeBranchPackage(root: string): { distRoot: string; loaderModulePath: string } {
  writeJsonFile(path.join(root, "package.json"), {
    name: "branch",
    type: "module",
    bin: {
      branch: "./branch.mjs",
    },
    exports: {
      "./cli-entry": "./dist/cli-entry.js",
      "./plugin-sdk/agent-runtime": "./dist/plugin-sdk/agent-runtime.js",
      "./plugin-sdk/channel-inbound": "./dist/plugin-sdk/channel-inbound.js",
      "./plugin-sdk/channel-outbound": "./dist/plugin-sdk/channel-outbound.js",
      "./plugin-sdk/source-only": "./dist/plugin-sdk/source-only.js",
    },
  });
  fs.writeFileSync(path.join(root, "branch.mjs"), "#!/usr/bin/env node\n", "utf8");
  const distRoot = path.join(root, "dist");
  const pluginSdkDir = path.join(distRoot, "plugin-sdk");
  fs.mkdirSync(pluginSdkDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginSdkDir, "agent-runtime.js"),
    "export const agentRuntimeSource = import.meta.url;\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(pluginSdkDir, "channel-inbound.js"),
    ['export * from "./channel-outbound.js";', ""].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(pluginSdkDir, "channel-outbound.js"),
    ['export const defineChannelMessageAdapter = () => "adapter";', ""].join("\n"),
    "utf8",
  );
  const loaderModulePath = path.join(distRoot, "plugins", "loader.js");
  fs.mkdirSync(path.dirname(loaderModulePath), { recursive: true });
  fs.writeFileSync(loaderModulePath, "export default {};\n", "utf8");
  return { distRoot, loaderModulePath };
}

function writeExternalPluginEntry(root: string): string {
  writeJsonFile(path.join(root, "package.json"), {
    name: "external-plugin",
    type: "module",
  });
  const entry = path.join(root, "dist", "runtime-api.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "export default {};\n", "utf8");
  return entry;
}

function writeInternalCorePackageSource(
  root: string,
  packageDir: string,
  sourceFile: string,
): string {
  const sourcePath = path.join(root, "packages", packageDir, "src", sourceFile);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "export {};\n", "utf8");
  return sourcePath;
}

function writeInternalCorePackageExports(
  root: string,
  packageDir: string,
  subpaths: readonly string[],
): void {
  writeJsonFile(path.join(root, "packages", packageDir, "package.json"), {
    name: `@branch/${packageDir}`,
    exports: Object.fromEntries(
      subpaths.map((subpath) => {
        const exportKey = subpath ? `./${subpath}` : ".";
        const distFile = `./dist/${subpath || "index"}.mjs`;
        return [exportKey, { import: distFile, default: distFile }];
      }),
    ),
  });
}

function addFakePluginSdkDistExport(root: string, subpath: string): string {
  const packageJsonPath = path.join(root, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    exports: Record<string, string>;
  };
  const distPath = path.join(root, "dist", "plugin-sdk", `${subpath}.js`);
  packageJson.exports[`./plugin-sdk/${subpath}`] = `./dist/plugin-sdk/${subpath}.js`;
  writeJsonFile(packageJsonPath, packageJson);
  fs.writeFileSync(distPath, `export const ${subpath.replaceAll("-", "_")} = true;\n`, "utf8");
  return distPath;
}

function createInternalCoreAliasFixture(prefix: string): {
  coreSourceParent: string;
  loaderModulePath: string;
  moduleUrl: string;
  root: string;
  sourcePath: string;
} {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const { loaderModulePath } = writeFakeBranchPackage(root);
  const sourcePath = writeInternalCorePackageSource(root, "markdown-core", "code-spans.ts");
  const coreSourceParent = path.join(root, "src", "host-probe.js");
  fs.mkdirSync(path.dirname(coreSourceParent), { recursive: true });
  fs.writeFileSync(coreSourceParent, "export default {};\n", "utf8");
  return {
    coreSourceParent,
    loaderModulePath,
    moduleUrl: pathToFileURL(loaderModulePath).href,
    root,
    sourcePath,
  };
}

describe("installBranchInternalCorePackageNativeResolver", () => {
  it("shares one internal core alias scan between resolver installers", () => {
    const fixture = createInternalCoreAliasFixture("branch-sdk-native-core-cache-");
    const externalPluginEntry = writeExternalPluginEntry(
      path.join(path.dirname(path.dirname(fixture.loaderModulePath)), "external-plugin"),
    );
    const existsSync = vi.spyOn(fs, "existsSync");

    try {
      installBranchPluginSdkNativeResolver({
        modulePath: fixture.loaderModulePath,
        pluginModulePath: externalPluginEntry,
      });
      expect(existsSync).toHaveBeenCalledWith(fixture.sourcePath);

      existsSync.mockClear();
      const aliases = installBranchInternalCorePackageNativeResolver({
        moduleUrl: fixture.moduleUrl,
      });

      expect(aliases).toContain("@branch/markdown-core/code-spans");
      expect(existsSync).not.toHaveBeenCalled();

      installBranchPluginSdkNativeResolver({
        modulePath: fixture.loaderModulePath,
        pluginModulePath: externalPluginEntry,
      });
      expect(existsSync).not.toHaveBeenCalled();
    } finally {
      existsSync.mockRestore();
    }
  });

  it("shares one internal core alias scan across importers from the same host package", () => {
    const fixture = createInternalCoreAliasFixture("branch-sdk-native-core-shared-host-");
    const secondModulePath = path.join(
      path.dirname(fixture.loaderModulePath),
      "provider-policy.js",
    );
    fs.writeFileSync(secondModulePath, "export default {};\n", "utf8");
    const existsSync = vi.spyOn(fs, "existsSync");
    const readFileSync = vi.spyOn(fs, "readFileSync");

    try {
      installBranchInternalCorePackageNativeResolver({ moduleUrl: fixture.moduleUrl });
      expect(existsSync).toHaveBeenCalledWith(fixture.sourcePath);

      existsSync.mockClear();
      readFileSync.mockClear();
      const secondModuleUrl = pathToFileURL(secondModulePath).href;
      const aliases = installBranchInternalCorePackageNativeResolver({
        moduleUrl: secondModuleUrl,
      });

      expect(aliases).toContain("@branch/markdown-core/code-spans");
      expect(existsSync).not.toHaveBeenCalledWith(fixture.sourcePath);
      expect(readFileSync).not.toHaveBeenCalled();

      existsSync.mockClear();
      readFileSync.mockClear();
      installBranchInternalCorePackageNativeResolver({ moduleUrl: secondModuleUrl });

      expect(existsSync).not.toHaveBeenCalled();
      expect(readFileSync).not.toHaveBeenCalled();
    } finally {
      readFileSync.mockRestore();
      existsSync.mockRestore();
    }
  });

  it("keeps internal core alias registration isolated between host modules", () => {
    const first = createInternalCoreAliasFixture("branch-sdk-native-core-host-a-");
    const second = createInternalCoreAliasFixture("branch-sdk-native-core-host-b-");
    const existsSync = vi.spyOn(fs, "existsSync");

    try {
      installBranchInternalCorePackageNativeResolver({ moduleUrl: first.moduleUrl });
      existsSync.mockClear();

      installBranchInternalCorePackageNativeResolver({ moduleUrl: second.moduleUrl });

      expect(existsSync).toHaveBeenCalledWith(second.sourcePath);
      expect(
        fs.realpathSync(
          createRequire(first.coreSourceParent).resolve("@branch/markdown-core/code-spans"),
        ),
      ).toBe(fs.realpathSync(first.sourcePath));
      expect(
        fs.realpathSync(
          createRequire(second.coreSourceParent).resolve("@branch/markdown-core/code-spans"),
        ),
      ).toBe(fs.realpathSync(second.sourcePath));
    } finally {
      existsSync.mockRestore();
    }
  });

  it("rescans internal core aliases after plugin metadata lifecycle invalidation", () => {
    const fixture = createInternalCoreAliasFixture("branch-sdk-native-core-invalidation-");
    const existsSync = vi.spyOn(fs, "existsSync");

    try {
      installBranchInternalCorePackageNativeResolver({ moduleUrl: fixture.moduleUrl });
      existsSync.mockClear();

      installBranchInternalCorePackageNativeResolver({ moduleUrl: fixture.moduleUrl });
      expect(existsSync).not.toHaveBeenCalled();

      clearPluginMetadataLifecycleCaches();
      existsSync.mockClear();
      installBranchInternalCorePackageNativeResolver({ moduleUrl: fixture.moduleUrl });

      expect(existsSync).toHaveBeenCalledWith(fixture.sourcePath);
    } finally {
      existsSync.mockRestore();
    }
  });
});

describe("installBranchPluginSdkNativeResolver", () => {
  it("resolves installed plugin SDK imports to the dev source root", () => {
    const stableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-stable-"));
    const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-dev-source-"));
    const { loaderModulePath } = writeFakeBranchPackage(stableRoot);
    writeFakeBranchPackage(devRoot);
    fs.mkdirSync(path.join(devRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(devRoot, "extensions"), { recursive: true });
    const externalPluginEntry = writeExternalPluginEntry(path.join(stableRoot, "external-plugin"));
    const previousDevSourceRoot = process.env.BRANCH_DEV_SOURCE_ROOT;
    process.env.BRANCH_DEV_SOURCE_ROOT = devRoot;

    try {
      installBranchPluginSdkNativeResolver({
        modulePath: loaderModulePath,
        pluginModulePath: externalPluginEntry,
      });

      const requireFromPlugin = createRequire(externalPluginEntry);
      expect(fs.realpathSync(requireFromPlugin.resolve("branch/plugin-sdk/agent-runtime"))).toBe(
        fs.realpathSync(path.join(devRoot, "dist", "plugin-sdk", "agent-runtime.js")),
      );
    } finally {
      if (previousDevSourceRoot === undefined) {
        delete process.env.BRANCH_DEV_SOURCE_ROOT;
      } else {
        process.env.BRANCH_DEV_SOURCE_ROOT = previousDevSourceRoot;
      }
    }
  });

  it("updates native SDK aliases when the same plugin parent switches dev source roots", () => {
    const stableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-stable-"));
    const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-dev-source-"));
    const { loaderModulePath } = writeFakeBranchPackage(stableRoot);
    writeFakeBranchPackage(devRoot);
    fs.mkdirSync(path.join(devRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(devRoot, "extensions"), { recursive: true });
    const externalPluginEntry = writeExternalPluginEntry(path.join(stableRoot, "external-plugin"));
    const requireFromPlugin = createRequire(externalPluginEntry);

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
    });
    expect(fs.realpathSync(requireFromPlugin.resolve("branch/plugin-sdk/agent-runtime"))).toBe(
      fs.realpathSync(path.join(stableRoot, "dist", "plugin-sdk", "agent-runtime.js")),
    );

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
      devSourceRoot: devRoot,
    });

    expect(fs.realpathSync(requireFromPlugin.resolve("branch/plugin-sdk/agent-runtime"))).toBe(
      fs.realpathSync(path.join(devRoot, "dist", "plugin-sdk", "agent-runtime.js")),
    );
  });

  it("removes stale native SDK aliases when a later dev root omits a subpath", () => {
    const stableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-stable-"));
    const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-dev-source-"));
    const { loaderModulePath } = writeFakeBranchPackage(stableRoot);
    writeFakeBranchPackage(devRoot);
    const stableExtraPath = addFakePluginSdkDistExport(stableRoot, "stable-extra");
    fs.mkdirSync(path.join(devRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(devRoot, "extensions"), { recursive: true });
    const externalPluginEntry = writeExternalPluginEntry(path.join(stableRoot, "external-plugin"));
    const requireFromPlugin = createRequire(externalPluginEntry);

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
    });
    expect(fs.realpathSync(requireFromPlugin.resolve("branch/plugin-sdk/stable-extra"))).toBe(
      fs.realpathSync(stableExtraPath),
    );

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
      devSourceRoot: devRoot,
    });

    expect(() => requireFromPlugin.resolve("branch/plugin-sdk/stable-extra")).toThrow();
  });

  it("keeps overlapping parent precedence across first demand and reinstallation", () => {
    const broadHost = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-broad-host-"));
    const narrowHost = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-narrow-host-"));
    const broad = writeFakeBranchPackage(broadHost);
    const narrow = writeFakeBranchPackage(narrowHost);
    const broadEntry = writeExternalPluginEntry(path.join(broadHost, "external-plugin"));
    const narrowEntry = writeExternalPluginEntry(path.join(broadHost, "external-plugin", "nested"));
    const narrowOptions = {
      modulePath: narrow.loaderModulePath,
      pluginModulePath: narrowEntry,
      devSourceRoot: narrowHost,
    };
    const broadOptions = {
      modulePath: broad.loaderModulePath,
      pluginModulePath: broadEntry,
      devSourceRoot: broadHost,
    };
    installBranchPluginSdkNativeResolver(narrowOptions);
    installBranchPluginSdkNativeResolver(broadOptions);
    const fromBroad = createRequire(broadEntry);
    const fromNarrow = createRequire(narrowEntry);
    const expected = (host: string, subpath: string) =>
      fs.realpathSync(path.join(host, "dist", "plugin-sdk", `${subpath}.js`));

    // A demand outside the nested root gives the broad host precedence even
    // though it was installed second; the later path was not demanded yet.
    expect(fs.realpathSync(fromBroad.resolve("branch/plugin-sdk/agent-runtime"))).toBe(
      expected(broadHost, "agent-runtime"),
    );
    expect(fs.realpathSync(fromNarrow.resolve("branch/plugin-sdk/channel-outbound.js"))).toBe(
      expected(broadHost, "channel-outbound"),
    );

    installBranchPluginSdkNativeResolver(broadOptions);
    expect(fs.realpathSync(fromNarrow.resolve("branch/plugin-sdk/channel-inbound"))).toBe(
      expected(narrowHost, "channel-inbound"),
    );
    expect(fs.realpathSync(fromBroad.resolve("branch/plugin-sdk/channel-inbound"))).toBe(
      expected(broadHost, "channel-inbound"),
    );
  });

  it("honors the selected source SDK for native imports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-source-resolver-"));
    const { loaderModulePath } = writeFakeBranchPackage(root);
    const sourceChannelOutboundPath = path.join(root, "src", "plugin-sdk", "channel-outbound.ts");
    fs.mkdirSync(path.dirname(sourceChannelOutboundPath), { recursive: true });
    fs.writeFileSync(sourceChannelOutboundPath, "export const sourceOnly = true;\n", "utf8");
    const externalPluginEntry = writeExternalPluginEntry(path.join(root, "external-plugin"));

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
      pluginSdkResolution: "src",
    });

    const requireFromPlugin = createRequire(externalPluginEntry);
    expect(fs.realpathSync(requireFromPlugin.resolve("branch/plugin-sdk/channel-outbound"))).toBe(
      fs.realpathSync(sourceChannelOutboundPath),
    );
  });

  it("lets built external plugins resolve Branch Agent SDK subpaths with createRequire", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-resolver-"));
    const { distRoot, loaderModulePath } = writeFakeBranchPackage(root);
    const externalPluginEntry = writeExternalPluginEntry(path.join(root, "external-plugin"));

    const distMode = fs.statSync(distRoot).mode;
    if (process.platform !== "win32") {
      fs.chmodSync(distRoot, 0o555);
    }

    try {
      installBranchPluginSdkNativeResolver({
        modulePath: loaderModulePath,
        pluginModulePath: externalPluginEntry,
        pluginSdkResolution: "dist",
      });

      expect(fs.existsSync(path.join(distRoot, "extensions"))).toBe(false);
      const requireFromPlugin = createRequire(externalPluginEntry);
      expect(
        fs.realpathSync(requireFromPlugin.resolve("branch/plugin-sdk/channel-outbound")),
      ).toBe(fs.realpathSync(path.join(root, "dist", "plugin-sdk", "channel-outbound.js")));
      const sdk = requireFromPlugin("branch/plugin-sdk/channel-outbound") as {
        defineChannelMessageAdapter?: () => string;
      };

      expect(sdk.defineChannelMessageAdapter?.()).toBe("adapter");
      expect(() => requireFromPlugin.resolve("branch/not-plugin-sdk/channel-outbound")).toThrow();
    } finally {
      if (process.platform !== "win32") {
        fs.chmodSync(distRoot, distMode);
      }
    }
  });

  beforeAll(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-esm-resolver-"));
    const probePath = path.join(root, "probe.mjs");
    const resolverModuleUrl = pathToFileURL(
      path.join(process.cwd(), "src", "plugins", "plugin-sdk-native-resolver.ts"),
    ).href;
    fs.writeFileSync(
      probePath,
      [
        'import fs from "node:fs";',
        'import Module from "node:module";',
        'import path from "node:path";',
        'import { pathToFileURL } from "node:url";',
        `import { installBranchInternalCorePackageNativeResolver, installBranchPluginSdkNativeResolver } from ${JSON.stringify(resolverModuleUrl)};`,
        `const root = ${JSON.stringify(root)};`,
        "const writeJson = (targetPath, value) => {",
        "  fs.mkdirSync(path.dirname(targetPath), { recursive: true });",
        '  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\\n`, "utf8");',
        "};",
        'writeJson(path.join(root, "package.json"), {',
        '  name: "branch",',
        '  type: "module",',
        '  bin: { branch: "./branch.mjs" },',
        "  exports: {",
        '    "./plugin-sdk/channel-outbound": "./dist/plugin-sdk/channel-outbound.js",',
        '    "./plugin-sdk/late-entry": "./dist/plugin-sdk/late-entry.js",',
        "  },",
        "});",
        'fs.writeFileSync(path.join(root, "branch.mjs"), "#!/usr/bin/env node\\n", "utf8");',
        'fs.mkdirSync(path.join(root, "dist", "plugin-sdk"), { recursive: true });',
        'fs.writeFileSync(path.join(root, "dist", "plugin-sdk", "late-entry.js"), "export const late = \\"late-adapter\\";\\n", "utf8");',
        'fs.writeFileSync(path.join(root, "dist", "plugin-sdk", "channel-outbound.js"), "export const defineChannelMessageAdapter = () => \\"adapter\\";\\n", "utf8");',
        'const loaderModulePath = path.join(root, "dist", "plugins", "loader.js");',
        "fs.mkdirSync(path.dirname(loaderModulePath), { recursive: true });",
        'fs.writeFileSync(loaderModulePath, "export default {};\\n", "utf8");',
        // Internal alias scans are host snapshots; keep the alias-free host separate.
        'const aliasFreeRoot = path.join(root, "alias-free-host");',
        'writeJson(path.join(aliasFreeRoot, "package.json"), { name: "branch", type: "module" });',
        'const aliasFreeLoaderPath = path.join(aliasFreeRoot, "loader.js");',
        'fs.writeFileSync(aliasFreeLoaderPath, "export default {};\\n", "utf8");',
        "const originalResolver = Module._resolveFilename;",
        "installBranchInternalCorePackageNativeResolver({ moduleUrl: pathToFileURL(aliasFreeLoaderPath).href });",
        "installBranchPluginSdkNativeResolver({ modulePath: aliasFreeLoaderPath });",
        "const aliasFreeUnchanged = Module._resolveFilename === originalResolver;",
        'const aiToolSchemaPath = path.join(root, "packages", "ai", "src", "internal", "tool-schema.ts");',
        "fs.mkdirSync(path.dirname(aiToolSchemaPath), { recursive: true });",
        'fs.writeFileSync(aiToolSchemaPath, "export const schemaSource = import.meta.url;\\n", "utf8");',
        'const coreEntryPath = path.join(root, "src", "schema-probe.mjs");',
        "fs.mkdirSync(path.dirname(coreEntryPath), { recursive: true });",
        'fs.writeFileSync(coreEntryPath, \'export { schemaSource } from "@branch/ai/internal/tool-schema";\\n\', "utf8");',
        'const pluginRoot = path.join(root, "external-plugin");',
        'writeJson(path.join(pluginRoot, "package.json"), { name: "external-plugin", type: "module" });',
        'const entryPath = path.join(pluginRoot, "dist", "runtime-api.js");',
        'const lazyPath = path.join(pluginRoot, "dist", "lazy.js");',
        "fs.mkdirSync(path.dirname(entryPath), { recursive: true });",
        "fs.writeFileSync(",
        "  entryPath,",
        '  "import { defineChannelMessageAdapter } from \\"branch/plugin-sdk/channel-outbound\\"; export const eager = defineChannelMessageAdapter(); export const loadLazy = () => import(\\"./lazy.js\\");\\n",',
        '  "utf8",',
        ");",
        "fs.writeFileSync(",
        "  lazyPath,",
        '  "export { late as lazy } from \\"branch/plugin-sdk/late-entry.js\\";\\n",',
        '  "utf8",',
        ");",
        "installBranchPluginSdkNativeResolver({",
        "  modulePath: loaderModulePath,",
        "  pluginModulePath: entryPath,",
        '  pluginSdkResolution: "dist",',
        "});",
        "const module = await import(pathToFileURL(entryPath).href);",
        "const lazy = await module.loadLazy();",
        "const core = await import(pathToFileURL(coreEntryPath).href);",
        "if (core.schemaSource !== pathToFileURL(fs.realpathSync(aiToolSchemaPath)).href) {",
        '  throw new Error("Internal AI tool-schema alias did not resolve to host source");',
        "}",
        "console.log(JSON.stringify({ aliasFreeUnchanged, eager: module.eager, lazy: lazy.lazy }));",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(process.execPath, ["--import", "tsx", probePath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    fs.rmSync(root, { recursive: true, force: true });
    nativeEsmLazyImportProbe = {
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  });

  it("keeps SDK and internal schema aliases available for native ESM lazy imports", () => {
    expect(nativeEsmLazyImportProbe.stderr).toBe("");
    expect(nativeEsmLazyImportProbe.status).toBe(0);
    expect(JSON.parse(nativeEsmLazyImportProbe.stdout)).toMatchObject({
      eager: "adapter",
      lazy: "late-adapter",
    });
  });

  it("leaves native resolution untouched until aliases are registered", () => {
    expect(JSON.parse(nativeEsmLazyImportProbe.stdout).aliasFreeUnchanged).toBe(true);
  });

  it("does not resolve SDK aliases for parents outside registered plugin roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-guard-"));
    const { loaderModulePath } = writeFakeBranchPackage(root);
    const externalPluginEntry = writeExternalPluginEntry(path.join(root, "external-plugin"));
    const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-outside-"));
    const unrelatedEntry = path.join(unrelatedRoot, "runtime-api.js");
    fs.mkdirSync(path.dirname(unrelatedEntry), { recursive: true });
    fs.writeFileSync(unrelatedEntry, "export default {};\n", "utf8");

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
      pluginSdkResolution: "dist",
    });

    const requireFromPlugin = createRequire(externalPluginEntry);
    const requireFromOutside = createRequire(unrelatedEntry);
    expect(requireFromPlugin.resolve("branch/plugin-sdk/channel-outbound")).toBeTruthy();
    expect(() => requireFromOutside.resolve("branch/plugin-sdk/channel-outbound")).toThrow();
  });

  it("resolves internal core packages only for Branch-owned source parents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-core-internal-"));
    const { loaderModulePath } = writeFakeBranchPackage(root);
    const sources = (
      [
        ["normalization-core", "string-coerce.ts"],
        ["normalization-core", "boolean-coercion.ts"],
        ["normalization-core", "result.ts"],
        ["normalization-core", "agent-id.ts"],
        ["media-core", "mime.ts"],
        ["media-core", "attachment-classify.ts"],
        ["markdown-core", "code-spans.ts"],
        ["ai", "transports.ts"],
        ["ai", "internal/tool-schema.ts"],
        ["ai", "internal/runtime.ts"],
        ["ai", "internal/openai-responses-payload-policy.ts"],
        ["ai", "internal/google-model-family.ts"],
        ["ai", "internal/retry-after.ts"],
        ["acp-core", "runtime/types.ts"],
        ["llm-core", "index.ts"],
        ["llm-core", "model-contracts/anthropic.ts"],
      ] as const
    ).map(([packageDir, sourceFile]) => ({
      specifier: `@branch/${packageDir}${sourceFile === "index.ts" ? "" : `/${sourceFile.slice(0, -3)}`}`,
      sourcePath: writeInternalCorePackageSource(root, packageDir, sourceFile),
    }));
    writeInternalCorePackageExports(root, "normalization-core", [
      "agent-id",
      "boolean-coercion",
      "result",
      "string-coerce",
    ]);
    writeInternalCorePackageExports(root, "media-core", ["attachment-classify", "mime"]);
    writeInternalCorePackageExports(root, "acp-core", ["runtime/types"]);
    const externalPluginEntry = writeExternalPluginEntry(path.join(root, "external-plugin"));
    const coreSourceParent = path.join(root, "src", "config", "plugin-web-search-config.ts");
    fs.mkdirSync(path.dirname(coreSourceParent), { recursive: true });
    fs.writeFileSync(coreSourceParent, "export default {};\n", "utf8");

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
      pluginSdkResolution: "dist",
    });

    const requireFromCoreSource = createRequire(coreSourceParent);
    const requireFromPlugin = createRequire(externalPluginEntry);
    for (const { specifier, sourcePath } of sources) {
      expect(fs.realpathSync(requireFromCoreSource.resolve(specifier))).toBe(
        fs.realpathSync(sourcePath),
      );
      expect(() => requireFromPlugin.resolve(specifier)).toThrow();
    }
  });

  it("registers source-only SDK subpaths when the host selects source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-source-only-"));
    const { loaderModulePath } = writeFakeBranchPackage(root);
    const sourceOnlyPath = path.join(root, "src", "plugin-sdk", "source-only.ts");
    fs.mkdirSync(path.dirname(sourceOnlyPath), { recursive: true });
    fs.writeFileSync(sourceOnlyPath, "export const sourceOnly = true;\n", "utf8");
    const externalPluginEntry = writeExternalPluginEntry(path.join(root, "external-plugin"));

    installBranchPluginSdkNativeResolver({
      modulePath: loaderModulePath,
      pluginModulePath: externalPluginEntry,
      pluginSdkResolution: "src",
    });

    const requireFromPlugin = createRequire(externalPluginEntry);
    expect(fs.realpathSync(requireFromPlugin.resolve("branch/plugin-sdk/source-only"))).toBe(
      fs.realpathSync(sourceOnlyPath),
    );
  });

  it("scopes private SSRF SDK aliases to bundled local IPC native parents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-sdk-native-ssrf-"));
    const { loaderModulePath } = writeFakeBranchPackage(root);
    const internalPath = path.join(root, "dist", "plugin-sdk", "ssrf-runtime-internal.js");
    fs.writeFileSync(internalPath, "export const ssrfInternal = true;\n", "utf8");
    const owners = (
      [
        ["dist", "ollama"],
        ["dist-runtime", "ollama"],
        ["dist", "browser"],
        ["dist-runtime", "browser"],
        ["dist", "demo"],
      ] as const
    ).map(([dist, plugin]) => {
      const entry = path.join(root, dist, "extensions", plugin, "index.js");
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, "export default {};\n", "utf8");
      return { entry, allowed: plugin !== "demo" };
    });
    for (const { entry } of owners) {
      installBranchPluginSdkNativeResolver({
        modulePath: loaderModulePath,
        pluginModulePath: entry,
        pluginSdkResolution: "dist",
      });
    }
    for (const { entry, allowed } of owners) {
      const resolve = () =>
        createRequire(entry).resolve("branch/plugin-sdk/ssrf-runtime-internal");
      if (allowed) {
        expect(fs.realpathSync(resolve())).toBe(fs.realpathSync(internalPath));
      } else {
        expect(resolve).toThrow();
      }
    }
  });
});
