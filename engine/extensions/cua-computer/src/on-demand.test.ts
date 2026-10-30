// Computer use on demand: the pinned, digest-verified first-use download of the CUA Driver.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pluginManifest from "../package.json" with { type: "json" };
import { registerComputerUseRuntime } from "./computer-runtime.js";
import { setComputerUseOnDemand } from "./driver-artifacts.js";
import {
  COMPUTER_USE_TARGETS,
  computerUseDownload,
  npmTarballUrl,
  resolveComputerUseTarget,
  type ComputerUseDownload,
  type ComputerUseDownloadPart,
} from "./on-demand-assets.js";
import { extractTarball } from "./on-demand-tar.js";
import {
  COMPUTER_USE_RECEIPT,
  computerUseDownloadProgress,
  createComputerUseOnDemand,
  storePackageDir,
  type ComputerUseOnDemandDeps,
} from "./on-demand.js";

const here = path.dirname(fileURLToPath(import.meta.url));

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

function tarball(entries: Array<[string, string, number, string?]>): Buffer {
  return gzipSync(
    Buffer.concat([
      ...entries.map(([name, text, mode, type]) => tarEntry(name, Buffer.from(text), mode, type)),
      Buffer.alloc(1024),
    ]),
  );
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const DRIVER = "#!/bin/sh\necho cua-driver 0.28.2\n";

/** Tiny stand-ins for the five npm packages and the macOS release archive: same layout, no real binaries. */
function fixtureArchives(target = "darwin-arm64") {
  const pkg = (name: string, files: Array<[string, string, number]> = []) =>
    tarball([
      ["package/package.json", JSON.stringify({ name, version: name.startsWith("@ubjs") ? "0.31.0-3" : "0.28.2" }), 0o644],
      ...files.map(([file, text, mode]): [string, string, number] => [`package/${file}`, text, mode]),
    ]);
  return {
    "@trycua/cua-driver": pkg("@trycua/cua-driver", [["dist/index.js", "export const sdk = 1;\n", 0o644]]),
    "@ubjs/core": pkg("@ubjs/core"),
    "@ubjs/node": pkg("@ubjs/node"),
    [`@trycua/cua-driver-${target}`]: pkg(`@trycua/cua-driver-${target}`, [
      ["libcua_driver_sdk.dylib", "native", 0o755],
      ["cua_driver_node_runtime.node", "runtime", 0o755],
    ]),
    [`@ubjs/node-${target}`]: pkg(`@ubjs/node-${target}`),
    "cua-driver": tarball([
      ["cua-driver", DRIVER, 0o755],
      ["libcua_driver_sdk.dylib", "native", 0o755],
      ["../escape", "no", 0o644],
    ]),
  } as Record<string, Buffer>;
}

/** The real download for darwin-arm64, with each pin replaced by its fixture's digest and size. */
function fixtureDownload(archives: Record<string, Buffer>, target: "darwin-arm64" | "linux-x64-gnu" = "darwin-arm64"): ComputerUseDownload {
  const parts = computerUseDownload(target).parts.map((part): ComputerUseDownloadPart => {
    const bytes = archives[part.name]!;
    return part.kind === "npm-package"
      ? { ...part, url: `https://registry.example.invalid/${part.name}.tgz`, sha256: sha256(bytes), bytes: bytes.length }
      : { ...part, url: "https://releases.example.invalid/cua-driver.tar.gz", sha256: sha256(bytes), bytes: bytes.length, fileSha256: sha256(DRIVER) };
  });
  return { version: "0.28.2", target, parts, bytes: parts.reduce((sum, part) => sum + part.bytes, 0) };
}

function servingFetch(download: ComputerUseDownload, archives: Record<string, Buffer>, override: Record<string, Buffer> = {}) {
  const byUrl = new Map(download.parts.map((part) => [part.url, override[part.name] ?? archives[part.name]!]));
  return vi.fn(async (url: string | URL | Request) => {
    const bytes = byUrl.get(String(url));
    return bytes ? new Response(new Uint8Array(bytes), { status: 200 }) : new Response("missing", { status: 404 });
  });
}

/** The first archive arrives in part, then the body waits for release() or the request's abort. */
function gatedFetch(download: ComputerUseDownload, archives: Record<string, Buffer>) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const byUrl = new Map(download.parts.map((part) => [part.url, archives[part.name]!]));
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const bytes = byUrl.get(String(url))!;
    const signal = init?.signal ?? undefined;
    let step = 0;
    const cut = Math.floor(bytes.length / 2);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (step === 0) {
          step = 1;
          controller.enqueue(new Uint8Array(bytes.subarray(0, cut)));
          return;
        }
        if (step === 1) {
          step = 2;
          await Promise.race([
            gate,
            new Promise<void>((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
          ]);
          controller.enqueue(new Uint8Array(bytes.subarray(cut)));
          return;
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  });
  return { fetch, release: () => release() };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

type Handler = (opts: { respond: (ok: boolean, payload?: unknown) => void }) => Promise<void>;

function gatewayMethods(overrides: Partial<ComputerUseOnDemandDeps>) {
  const methods = new Map<string, { handler: Handler; scope?: string }>();
  const onDemand = registerComputerUseRuntime(
    {
      registerGatewayMethod: ((method: string, handler: Handler, opts?: { scope?: string }) => {
        methods.set(method, { handler, scope: opts?.scope });
      }) as never,
    },
    // A release build: this source checkout's bundled SDK must not stand in for the download.
    { bundledReady: () => false, ...overrides },
  );
  const call = async (method: string) => {
    let answer: unknown;
    await methods.get(method)!.handler({ respond: (_ok, payload) => (answer = payload) });
    return answer as Record<string, unknown>;
  };
  return { onDemand, methods, call };
}

describe("computer use on demand", () => {
  let root: string;
  let stateDir: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "branch-computer-use-on-demand-")));
    stateDir = path.join(root, "state");
  });

  afterEach(async () => {
    setComputerUseOnDemand(undefined);
    await rm(root, { recursive: true, force: true });
  });

  it("pins every target's archives, and each npm pin is the lockfile's exact tarball", async () => {
    const lock = await readFile(path.join(here, "..", "..", "..", "pnpm-lock.yaml"), "utf8");
    for (const target of COMPUTER_USE_TARGETS) {
      const download = computerUseDownload(target);
      expect(download.version).toBe(pluginManifest.dependencies["@trycua/cua-driver"]);
      for (const part of download.parts) {
        expect(part.sha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(part.bytes).toBeGreaterThan(0);
        if (part.kind === "npm-package") {
          expect(part.url).toBe(npmTarballUrl(part.name, part.version));
          expect(lock).toContain(`  '${part.name}@${part.version}':
    resolution: {integrity: ${part.integrity}}`);
        } else {
          expect(part.sha256).toBe(pluginManifest.cuaDriverArtifacts["darwin-universal-binary"].archiveSha256);
          expect(part.url).toBe(
            "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.28.2/cua-driver-rs-0.28.2-darwin-universal-binary.tar.gz",
          );
        }
      }
      expect(download.parts.some((part) => part.kind === "driver-archive")).toBe(target.startsWith("darwin-"));
    }
    // macOS arm64: the native package (18.3 MB) and the driver archive (43.6 MB), plus the small SDK packages.
    expect(computerUseDownload("darwin-arm64").bytes).toBe(62_343_458);
    expect(resolveComputerUseTarget("linux", "x64", "musl")).toBeUndefined();
    expect(resolveComputerUseTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(resolveComputerUseTarget("win32", "x64")).toBe("win32-x64-msvc");
  });

  it("downloads, verifies, unpacks and reuses the pinned driver per user", async () => {
    const archives = fixtureArchives();
    const download = fixtureDownload(archives);
    const fetch = servingFetch(download, archives);
    const chmod = vi.fn(async () => undefined);
    const onDemand = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch, chmod, download });

    await expect(onDemand.status()).resolves.toMatchObject({ state: "download", reason: "not-downloaded", bytes: download.bytes });
    const progress: number[] = [];
    const installed = await onDemand.ensureInstalled({ onProgress: (shown) => progress.push(shown.percent) });

    expect(installed).toBe(path.join(stateDir, "tools", "computer-use", "0.28.2-darwin-arm64"));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(progress.at(-1)).toBe(99);
    expect(await readFile(path.join(installed, "cua-driver"), "utf8")).toBe(DRIVER);
    // Only the driver is kept from the release archive; its traversal entry was refused, not written.
    expect(await exists(path.join(installed, "libcua_driver_sdk.dylib"))).toBe(false);
    expect(await exists(path.join(installed, "..", "escape"))).toBe(false);
    expect(await readFile(path.join(storePackageDir(installed, "@trycua/cua-driver"), "dist", "index.js"), "utf8")).toContain("sdk");
    expect(await exists(path.join(storePackageDir(installed, "@trycua/cua-driver-darwin-arm64"), "libcua_driver_sdk.dylib"))).toBe(true);
    // Made executable only after it was verified, while still in the staging folder.
    expect(chmod).toHaveBeenCalledWith(expect.stringMatching(/[/\\]stage[/\\]cua-driver$/u), 0o755);
    const receipt = JSON.parse(await readFile(path.join(installed, COMPUTER_USE_RECEIPT), "utf8"));
    expect(receipt.parts).toEqual(download.parts.map((part) => part.sha256));
    const current = JSON.parse(await readFile(path.join(stateDir, "tools", "computer-use", "current.json"), "utf8"));
    expect(current).toMatchObject({ version: "0.28.2", target: "darwin-arm64", root: installed, driver: path.join(installed, "cua-driver") });
    await expect(onDemand.status()).resolves.toMatchObject({ state: "ready", source: "downloaded", root: installed });

    // A later engine (an update) reuses the per-user copy without downloading.
    const later = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch, chmod, download });
    await expect(later.ensureInstalled()).resolves.toBe(installed);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect((await readdir(path.dirname(installed))).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("refuses an archive whose digest does not match before anything is unpacked or run", async () => {
    const archives = fixtureArchives();
    const download = fixtureDownload(archives);
    const tampered = tarball([["cua-driver", "#!/bin/sh\necho evil\n", 0o755]]);
    const fetch = servingFetch(download, archives, { "cua-driver": tampered });
    const chmod = vi.fn(async () => undefined);
    const onDemand = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch, chmod, download });

    const failure = await onDemand.ensureInstalled().catch((error: unknown) => error as Error & { reason?: string });
    expect(failure).toMatchObject({ reason: "digest-mismatch" });
    expect(failure.message).toContain("Nothing was installed or run");
    expect(chmod).not.toHaveBeenCalled();
    expect(await exists(path.join(stateDir, "tools", "computer-use", "0.28.2-darwin-arm64"))).toBe(false);
    expect(await readdir(path.join(stateDir, "tools", "computer-use"))).toEqual([]);
    await expect(onDemand.status()).resolves.toMatchObject({ state: "unavailable", reason: "digest-mismatch" });

    // The next use does not fetch a refused archive again; an explicit retry does.
    const calls = fetch.mock.calls.length;
    await expect(onDemand.ensureInstalled()).rejects.toMatchObject({ reason: "digest-mismatch" });
    expect(fetch.mock.calls.length).toBe(calls);
    await expect(onDemand.ensureInstalled({ retry: true })).rejects.toMatchObject({ reason: "digest-mismatch" });
    expect(fetch.mock.calls.length).toBeGreaterThan(calls);
  });

  it("refuses a driver that differs from its pinned file digest inside a verified archive", async () => {
    const archives = fixtureArchives();
    const download = fixtureDownload(archives);
    const driver = download.parts.find((part) => part.kind === "driver-archive")!;
    if (driver.kind === "driver-archive") {
      driver.fileSha256 = "0".repeat(64);
    }
    const chmod = vi.fn(async () => undefined);
    const onDemand = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch: servingFetch(download, archives), chmod, download });

    await expect(onDemand.ensureInstalled()).rejects.toMatchObject({ reason: "digest-mismatch" });
    expect(chmod).not.toHaveBeenCalledWith(expect.stringMatching(/cua-driver$/u), 0o755);
    expect(await exists(path.join(stateDir, "tools", "computer-use", "0.28.2-darwin-arm64"))).toBe(false);
  });

  it("says plainly when this computer is offline, and keeps nothing", async () => {
    const archives = fixtureArchives();
    const download = fixtureDownload(archives);
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND registry.npmjs.org"), { code: "ENOTFOUND" }) });
    });
    const onDemand = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch, download });

    await expect(onDemand.ensureInstalled()).rejects.toMatchObject({ reason: "offline" });
    const status = await onDemand.status();
    expect(status).toMatchObject({ state: "unavailable", reason: "offline", bytes: download.bytes });
    expect(status.state === "unavailable" && status.message).toMatch(/looks offline \(ENOTFOUND\).*Connect to the internet: it tries again the next time computer use is used/u);
    expect(await readdir(path.join(stateDir, "tools", "computer-use"))).toEqual([]);
  });

  it("names the platform it has no download for", async () => {
    const onDemand = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "linux", arch: "x64", linuxLibc: "musl" });
    await expect(onDemand.status()).resolves.toMatchObject({ state: "unavailable", reason: "unsupported-platform" });
    await expect(onDemand.ensureInstalled()).rejects.toThrow(/no download for linux-x64-musl/u);
  });

  it("uses the bundled driver where an engine still ships it", async () => {
    const onDemand = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", bundledReady: () => true });
    await expect(onDemand.status()).resolves.toMatchObject({ state: "ready", source: "bundled" });
  });

  it("shows downloading N%, and Cancel stops it and deletes the partial files", async () => {
    const archives = fixtureArchives();
    const download = fixtureDownload(archives);
    const gated = gatedFetch(download, archives);
    const { call, methods } = gatewayMethods({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch: gated.fetch, download });
    expect(methods.get("computer.runtime")?.scope).toBe("operator.read");
    expect(methods.get("computer.runtime.download")?.scope).toBe("operator.admin");

    await expect(call("computer.runtime")).resolves.toMatchObject({ state: "download" });
    await call("computer.runtime.download");
    await vi.waitFor(async () => expect((await call("computer.runtime")).state).toBe("downloading"));
    const shown = await call("computer.runtime");
    expect(shown.message).toBe(computerUseDownloadProgress(download, Number(shown.received)).message);
    expect(String(shown.message)).toMatch(/^Getting computer use ready \(\d+ MB\)… \d+%$/u);

    await expect(call("computer.runtime.cancel")).resolves.toMatchObject({ cancelled: true, state: "download" });
    expect(await readdir(path.join(stateDir, "tools", "computer-use"))).toEqual([]);
    gated.release();
  });

  it("the next use after an offline failure downloads again and becomes ready", async () => {
    const archives = fixtureArchives();
    const download = fixtureDownload(archives);
    let offline = true;
    const serve = servingFetch(download, archives);
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (offline) {
        throw new TypeError("fetch failed", { cause: { code: "EAI_AGAIN" } });
      }
      return serve(url);
    });
    const onDemand = createComputerUseOnDemand({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch, chmod: async () => undefined, download });
    await expect(onDemand.ensureInstalled()).rejects.toMatchObject({ reason: "offline" });
    offline = false;
    await expect(onDemand.ensureInstalled()).resolves.toBe(onDemand.storeDir());
    await expect(onDemand.status()).resolves.toMatchObject({ state: "ready", source: "downloaded" });
  });

  it("an explicit retry after a failure downloads again and becomes ready", async () => {
    const archives = fixtureArchives();
    const download = fixtureDownload(archives);
    let offline = true;
    const serve = servingFetch(download, archives);
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (offline) {
        throw new TypeError("fetch failed", { cause: { code: "EAI_AGAIN" } });
      }
      return serve(url);
    });
    const { call, onDemand } = gatewayMethods({ stateDir: () => stateDir, platform: "darwin", arch: "arm64", fetch, chmod: async () => undefined, download });
    await onDemand.ensureInstalled().catch(() => undefined);
    await expect(call("computer.runtime")).resolves.toMatchObject({ state: "unavailable", reason: "offline" });
    offline = false;
    await call("computer.runtime.download");
    await vi.waitFor(async () => expect((await call("computer.runtime")).state).toBe("ready"));
  });

  it("refuses links and paths outside the package when unpacking", async () => {
    const out = path.join(root, "out");
    await expect(extractTarball(path.join(root, "x.tgz"), out, { kind: "npm-package" })).rejects.toThrow();
    const write = async (name: string, bytes: Buffer) => {
      const file = path.join(root, name);
      await (await import("node:fs/promises")).writeFile(file, bytes);
      return file;
    };
    const traversal = await write("t.tgz", tarball([["package/../../evil", "x", 0o644]]));
    await expect(extractTarball(traversal, out, { kind: "npm-package" })).rejects.toThrow(/outside the package/u);
    const link = await write("l.tgz", tarball([["package/link", "", 0o777, "2"]]));
    await expect(extractTarball(link, out, { kind: "npm-package" })).rejects.toThrow(/refusing tar entry/u);
    expect(await exists(path.join(root, "evil"))).toBe(false);
  });
});
