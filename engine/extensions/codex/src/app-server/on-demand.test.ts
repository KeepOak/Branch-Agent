// Codex on demand: PATH first, then a pinned, digest-verified first-use download.
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAppServerStartOptions } from "./config-contracts.js";
import { resolveManagedCodexAppServerStartOptions } from "./managed-binary.js";
import {
  CODEX_DOWNLOAD_ASSETS,
  codexDownloadPinsMatchVersion,
  type CodexDownloadAsset,
} from "./on-demand-assets.js";
import {
  CodexRuntimeUnavailableError,
  createCodexOnDemand,
  extractPackageTarball,
  parseCodexVersion,
  type CodexOnDemandDeps,
} from "./on-demand.js";
import { CODEX_APP_SERVER_VERSION } from "./version.js";

const TRIPLE = "aarch64-apple-darwin";

function tarEntry(name: string, data: Buffer, mode: number, type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(mode.toString(8).padStart(7, "0") + "\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.write("        ", 148, "ascii");
  header.write(type, 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

function fixtureTarball(entries: Array<[string, string, number]>): Buffer {
  return gzipSync(
    Buffer.concat([
      ...entries.map(([name, text, mode]) => tarEntry(name, Buffer.from(text), mode)),
      Buffer.alloc(1024),
    ]),
  );
}

/** A tiny stand-in for the platform package: same layout, no real binaries. */
function codexFixture(): Buffer {
  return fixtureTarball([
    [
      "package/package.json",
      JSON.stringify({ name: "@openai/codex", version: "0.160.0-darwin-arm64" }),
      0o644,
    ],
    [`package/vendor/${TRIPLE}/bin/codex`, "#!/bin/sh\necho codex-cli 0.160.0\n", 0o755],
    [`package/vendor/${TRIPLE}/codex-path/rg`, "#!/bin/sh\n", 0o755],
    [`package/vendor/${TRIPLE}/codex-package.json`, "{}", 0o644],
  ]);
}

function fixtureAsset(bytes: Buffer): CodexDownloadAsset {
  return {
    ...CODEX_DOWNLOAD_ASSETS["darwin-arm64"],
    url: "https://registry.example.invalid/codex-0.160.0-darwin-arm64.tgz",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function okFetch(bytes: Buffer) {
  return vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }));
}

function startOptions(): CodexAppServerStartOptions {
  return {
    transport: "stdio",
    command: "codex",
    commandSource: "managed",
    args: ["app-server", "--listen", "stdio://"],
    headers: {},
  };
}

/** This test machine's /Applications must not stand in for the managed Codex. */
async function noDesktopApps(file: string): Promise<boolean> {
  return !file.startsWith("/Applications/") && (await exists(file));
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

describe("Codex on demand", () => {
  let root: string;
  let pluginRoot: string;
  let stateDir: string;
  let launcher: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "branch-codex-on-demand-")));
    pluginRoot = path.join(root, "plugin");
    stateDir = path.join(root, "state");
    // A release build: the launcher ships, its platform package does not.
    const packageRoot = path.join(pluginRoot, "node_modules", "@openai", "codex");
    launcher = path.join(packageRoot, "bin", "codex.js");
    await mkdir(path.dirname(launcher), { recursive: true });
    await writeFile(
      path.join(pluginRoot, "package.json"),
      JSON.stringify({ name: "@branch/codex" }),
    );
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@openai/codex",
        version: "0.160.0",
        type: "module",
        bin: { codex: "bin/codex.js" },
      }),
    );
    await writeFile(launcher, "#!/usr/bin/env node\n");
    await chmod(launcher, 0o755);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function deps(overrides: Partial<CodexOnDemandDeps>): CodexOnDemandDeps {
    return {
      platform: "darwin",
      arch: "arm64",
      env: { PATH: "" },
      stateDir: () => stateDir,
      launcherEntrypoint: () => launcher,
      bundledReady: () => false,
      readVersion: async () => undefined,
      ...overrides,
    };
  }

  it("prefers a codex on PATH that meets the minimum version, without downloading", async () => {
    const bin = path.join(root, "bin");
    const oldBin = path.join(root, "old-bin");
    for (const dir of [oldBin, bin]) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "codex"), "#!/bin/sh\n");
      await chmod(path.join(dir, "codex"), 0o755);
    }
    const fetch = vi.fn();
    const onDemand = createCodexOnDemand(
      deps({
        env: { PATH: [oldBin, bin].join(":") },
        fetch: fetch as unknown as typeof globalThis.fetch,
        // The first codex on PATH is too old for the app-server protocol; the next one is used.
        readVersion: async (command) =>
          command.startsWith(oldBin) ? "codex-cli 0.120.0" : "codex-cli 0.161.2",
      }),
    );

    const resolved = await resolveManagedCodexAppServerStartOptions(startOptions(), {
      platform: "darwin",
      pluginRoot,
      onDemand,
      pathExists: noDesktopApps,
    });

    expect(resolved).toMatchObject({
      command: path.join(bin, "codex"),
      commandSource: "resolved-managed",
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(onDemand.status()).resolves.toMatchObject({
      state: "ready",
      source: "path",
      version: "0.161.2",
    });
  });

  it("downloads the pinned Codex on first use, verifies it, stores it per user and reuses it", async () => {
    const tarball = codexFixture();
    const asset = fixtureAsset(tarball);
    const fetch = okFetch(tarball);
    const chmodCalls: string[] = [];
    const onDemand = createCodexOnDemand(
      deps({
        asset,
        fetch: fetch as unknown as typeof globalThis.fetch,
        chmod: async (file, mode) => {
          chmodCalls.push(path.relative(stateDir, file));
          await chmod(file, mode);
        },
      }),
    );
    await expect(onDemand.status()).resolves.toMatchObject({
      state: "download",
      reason: "not-downloaded",
      bytes: tarball.length,
    });

    const resolved = await resolveManagedCodexAppServerStartOptions(startOptions(), {
      platform: "darwin",
      pluginRoot,
      onDemand,
      pathExists: noDesktopApps,
    });

    const store = path.join(stateDir, "tools", "codex", "0.160.0-darwin-arm64");
    expect(resolved.command).toBe(
      path.join(store, "node_modules", "@openai", "codex", "bin", "codex.js"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(asset.url);
    const native = path.join(
      store,
      "node_modules",
      "@openai",
      "codex-darwin-arm64",
      "vendor",
      TRIPLE,
      "bin",
      "codex",
    );
    expect((await stat(native)).mode & 0o111).not.toBe(0);
    // Exactly the entries the package marks executable, and only after verification.
    expect(chmodCalls.map((file) => file.split(path.sep).slice(-2).join("/")).toSorted()).toEqual([
      "bin/codex",
      "codex-path/rg",
    ]);
    expect(
      JSON.parse(await readFile(path.join(store, "codex-install.json"), "utf8")),
    ).toMatchObject({
      version: "0.160.0",
      sha256: asset.sha256,
    });
    await expect(onDemand.status()).resolves.toMatchObject({
      state: "ready",
      source: "downloaded",
    });

    // Later turns, and a later engine, reuse the verified copy.
    await resolveManagedCodexAppServerStartOptions(startOptions(), {
      platform: "darwin",
      pluginRoot,
      onDemand,
      pathExists: noDesktopApps,
    });
    const nextEngine = createCodexOnDemand(
      deps({ asset, fetch: fetch as unknown as typeof globalThis.fetch }),
    );
    await expect(nextEngine.ensureLauncher()).resolves.toBe(resolved.command);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await readdir(path.join(stateDir, "tools", "codex"))).toSorted()).toEqual([
      "0.160.0-darwin-arm64",
      "current.json",
    ]);
    // The ACP adapter finds the same verified copy through current.json.
    expect(
      JSON.parse(await readFile(path.join(stateDir, "tools", "codex", "current.json"), "utf8")),
    ).toMatchObject({ version: "0.160.0", launcher: resolved.command, native });
  });

  it("refuses a download whose SHA-256 does not match the pin, before unpacking, chmod or exec", async () => {
    const tarball = codexFixture();
    const asset = fixtureAsset(tarball);
    const tampered = codexFixture();
    tampered[tampered.length - 9] ^= 0xff;
    const chmodSpy = vi.fn();
    const onDemand = createCodexOnDemand(
      deps({
        asset: { ...asset, bytes: tampered.length },
        fetch: okFetch(tampered) as unknown as typeof globalThis.fetch,
        chmod: chmodSpy,
      }),
    );

    const attempt = resolveManagedCodexAppServerStartOptions(startOptions(), {
      platform: "darwin",
      pluginRoot,
      onDemand,
      pathExists: noDesktopApps,
    });

    await expect(attempt).rejects.toBeInstanceOf(CodexRuntimeUnavailableError);
    await expect(attempt).rejects.toMatchObject({ reason: "digest-mismatch" });
    await expect(attempt).rejects.toThrow(/does not match the digest pinned for darwin-arm64/u);
    // No start options came back, so nothing could be spawned; nothing was unpacked or chmodded.
    expect(chmodSpy).not.toHaveBeenCalled();
    expect(await readdir(path.join(stateDir, "tools", "codex"))).toEqual([]);
    await expect(onDemand.installedLauncher()).resolves.toBeUndefined();
    await expect(onDemand.status()).resolves.toMatchObject({
      state: "unavailable",
      reason: "digest-mismatch",
    });
  });

  it("names the offline state instead of failing silently", async () => {
    const asset = fixtureAsset(codexFixture());
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND registry.npmjs.org"), {
          code: "ENOTFOUND",
        }),
      });
    });
    const onDemand = createCodexOnDemand(
      deps({ asset, fetch: fetch as unknown as typeof globalThis.fetch }),
    );

    await expect(
      resolveManagedCodexAppServerStartOptions(startOptions(), {
        platform: "darwin",
        pluginRoot,
        onDemand,
        pathExists: noDesktopApps,
      }),
    ).rejects.toMatchObject({ name: "CodexRuntimeUnavailableError", reason: "offline" });
    const status = await onDemand.status();
    expect(status).toMatchObject({ state: "unavailable", reason: "offline" });
    expect(status.state === "unavailable" ? status.message : "").toMatch(
      /looks offline \(ENOTFOUND\).*Connect to the internet and try again/u,
    );
  });

  it("does not download for status reads or sign-in checks", async () => {
    const fetch = vi.fn();
    const onDemand = createCodexOnDemand(
      deps({
        asset: fixtureAsset(codexFixture()),
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    );
    await expect(
      resolveManagedCodexAppServerStartOptions(startOptions(), {
        platform: "darwin",
        pluginRoot,
        onDemand,
        pathExists: noDesktopApps,
        download: false,
      }),
    ).rejects.toMatchObject({ reason: "not-downloaded" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the bundled platform package when a build still ships it", async () => {
    const fetch = vi.fn();
    const onDemand = createCodexOnDemand(
      deps({ fetch: fetch as unknown as typeof globalThis.fetch, bundledReady: () => true }),
    );
    const resolved = await resolveManagedCodexAppServerStartOptions(startOptions(), {
      platform: "darwin",
      pluginRoot,
      onDemand,
      pathExists: noDesktopApps,
      bundledReady: () => true,
    });
    expect(resolved.command).toBe(launcher);
    expect(fetch).not.toHaveBeenCalled();
    await expect(onDemand.status()).resolves.toMatchObject({ state: "ready", source: "bundled" });
  });

  it("names platforms Codex publishes no download for", async () => {
    const onDemand = createCodexOnDemand(deps({ platform: "freebsd", arch: "x64" }));
    await expect(onDemand.status()).resolves.toMatchObject({
      state: "unavailable",
      reason: "unsupported-platform",
    });
    await expect(onDemand.ensureLauncher()).rejects.toMatchObject({
      reason: "unsupported-platform",
    });
  });

  it("refuses tar entries outside the package", async () => {
    const tarball = path.join(root, "evil.tgz");
    await writeFile(tarball, fixtureTarball([["package/../../evil", "x", 0o755]]));
    await expect(extractPackageTarball(tarball, path.join(root, "out"))).rejects.toThrow(
      /outside the package/u,
    );
    expect(await exists(path.join(root, "evil"))).toBe(false);
  });

  it("pins every platform to the Codex version Branch Agent runs and to the lockfile", async () => {
    expect(codexDownloadPinsMatchVersion()).toBe(true);
    const lockfile = await readFile(
      fileURLToPath(new URL("../../../../pnpm-lock.yaml", import.meta.url)),
      "utf8",
    );
    for (const asset of Object.values(CODEX_DOWNLOAD_ASSETS)) {
      expect(asset.version).toBe(CODEX_APP_SERVER_VERSION);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
      const entry = new RegExp(
        `'@openai/codex@${asset.version}-${asset.target}':\\n\\s+resolution: \\{integrity: ([^}]+)\\}`,
        "u",
      ).exec(lockfile);
      expect(entry?.[1], asset.target).toBe(asset.integrity);
    }
    expect(parseCodexVersion("codex-cli 0.160.0\n")).toBe("0.160.0");
  });
});
