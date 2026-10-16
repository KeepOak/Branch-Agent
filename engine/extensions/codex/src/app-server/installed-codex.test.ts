// Codex is the one installed on this computer: PATH (at the minimum version), else the bundled
// package in a source checkout, else the desktop app. With none of those, the registered
// first-use download (on-demand.ts) runs; with it unregistered, nothing is fetched.
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAppServerStartOptions } from "./config-contracts.js";
import {
  CODEX_NOT_INSTALLED_MESSAGE,
  CodexNotInstalledError,
  createInstalledCodex,
  parseCodexVersion,
} from "./installed-codex.js";
import {
  resolveManagedCodexAppServerStartOptions,
  setManagedCodexInstalled,
  setManagedCodexOnDemand,
  setManagedCodexPluginRoot,
} from "./managed-binary.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function startOptions(): CodexAppServerStartOptions {
  return {
    transport: "stdio",
    command: "codex",
    commandSource: "managed",
    args: ["app-server", "--listen", "stdio://"],
    headers: {},
  };
}

async function writeExecutable(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "#!/bin/sh\n");
  await chmod(file, 0o755);
}

describe("Codex installed on this computer", () => {
  let root: string;
  let pluginRoot: string;
  let emptyBin: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "branch-codex-installed-")));
    pluginRoot = path.join(root, "plugin");
    emptyBin = path.join(root, "empty-bin");
    await mkdir(emptyBin, { recursive: true });
    // A release build: the small launcher ships, its platform package does not.
    const packageRoot = path.join(pluginRoot, "node_modules", "@openai", "codex");
    await mkdir(path.join(packageRoot, "bin"), { recursive: true });
    await writeFile(
      path.join(pluginRoot, "package.json"),
      JSON.stringify({ name: "@branch/codex" }),
    );
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "@openai/codex", type: "module", bin: { codex: "bin/codex.js" } }),
    );
    await writeExecutable(path.join(packageRoot, "bin", "codex.js"));
  });

  afterEach(async () => {
    setManagedCodexInstalled(undefined);
    setManagedCodexOnDemand(undefined);
    setManagedCodexPluginRoot(undefined);
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("fetches nothing when the first-use download is not registered", async () => {
    // The downloader is the existing on-demand module. With it unregistered, a
    // missing Codex still fails with the Settings sentence and nothing is fetched.
    expect(existsSync(path.join(here, "on-demand.ts"))).toBe(true);
    const fetch = vi.spyOn(globalThis, "fetch");
    setManagedCodexOnDemand(undefined);
    setManagedCodexInstalled(createInstalledCodex({ platform: "linux", env: { PATH: emptyBin } }));
    await expect(
      resolveManagedCodexAppServerStartOptions(startOptions(), { platform: "linux", pluginRoot }),
    ).rejects.toBeInstanceOf(CodexNotInstalledError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts the registered first-use download when nothing is installed", async () => {
    const downloaded = path.join(root, "downloaded", "codex.js");
    await writeExecutable(downloaded);
    const ensureLauncher = vi.fn(async () => downloaded);
    setManagedCodexOnDemand({
      findPathCommand: async () => undefined,
      installedLauncher: async () => undefined,
      ensureLauncher,
      status: async () => ({
        state: "download",
        reason: "not-downloaded",
        version: "0.160.0",
        bytes: 1,
        message: "Codex downloads the first time you use it.",
      }),
    });
    setManagedCodexInstalled(createInstalledCodex({ platform: "linux", env: { PATH: emptyBin } }));
    await expect(
      resolveManagedCodexAppServerStartOptions(startOptions(), {
        platform: "linux",
        pluginRoot,
        bundledReady: () => false,
      }),
    ).resolves.toMatchObject({ command: downloaded, commandSource: "resolved-managed" });
    expect(ensureLauncher).toHaveBeenCalledTimes(1);
  });

  it("a Codex turn with no installed codex fails with the Settings sentence", async () => {
    // What every turn does: the plugin registered its root and the PATH lookup at load.
    setManagedCodexPluginRoot(pluginRoot);
    setManagedCodexInstalled(createInstalledCodex({ platform: "linux", env: { PATH: emptyBin } }));
    const error = await resolveManagedCodexAppServerStartOptions(startOptions(), {
      platform: "linux",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodexNotInstalledError);
    expect((error as Error).message).toBe(
      "Install and sign in to Codex on this computer, then check again.",
    );
    expect(CODEX_NOT_INSTALLED_MESSAGE).toBe(
      "Install and sign in to Codex on this computer, then check again.",
    );
  });

  it("uses a codex on PATH that meets the minimum version and skips an older one", async () => {
    // Real folders on this host, so PATH uses the host's separator and codex name.
    const platform = process.platform;
    const name = platform === "win32" ? "codex.exe" : "codex";
    const oldBin = path.join(root, "old-bin");
    const bin = path.join(root, "bin");
    await writeExecutable(path.join(oldBin, name));
    await writeExecutable(path.join(bin, name));
    const installed = createInstalledCodex({
      platform,
      env: { PATH: [oldBin, bin].join(path.delimiter) },
      readVersion: async (command) =>
        command.startsWith(oldBin) ? "codex-cli 0.120.0" : "codex-cli 0.161.2",
    });
    await expect(
      resolveManagedCodexAppServerStartOptions(startOptions(), {
        platform,
        pluginRoot,
        installed,
        // A desktop Codex app on the test machine is not part of this check.
        pathExists: async (candidate) =>
          !candidate.startsWith("/Applications/") && existsSync(candidate),
      }),
    ).resolves.toMatchObject({
      command: path.join(bin, name),
      commandSource: "resolved-managed",
    });
    await expect(installed.findPathCommand()).resolves.toEqual({
      command: path.join(bin, name),
      version: "0.161.2",
    });
  });

  it("keeps the bundled platform package in a source checkout", async () => {
    const launcher = path.join(pluginRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
    await expect(
      resolveManagedCodexAppServerStartOptions(startOptions(), {
        platform: "linux",
        pluginRoot,
        installed: createInstalledCodex({ platform: "linux", env: { PATH: emptyBin } }),
        bundledReady: () => true,
      }),
    ).resolves.toMatchObject({ command: launcher, commandSource: "resolved-managed" });
  });

  it("reads codex versions as codex --version prints them", () => {
    expect(parseCodexVersion("codex-cli 0.160.0\n")).toBe("0.160.0");
    expect(parseCodexVersion("0.161.0-alpha.2")).toBe("0.161.0-alpha.2");
    expect(parseCodexVersion("")).toBeUndefined();
  });
});
