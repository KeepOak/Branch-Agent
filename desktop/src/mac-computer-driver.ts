// The macOS CUA daemon must be spawned by Electron, the process that owns TCC grants.
// Loading the pinned SDK from the selected engine also keeps app and engine updates in sync.
// Release builds no longer bundle the driver (#983): the engine downloads it the first time computer use is on,
// into <state dir>/tools/computer-use/<version>-darwin-<arch>/. The app checks that copy against the engine's own
// pins (its cua-computer package.json) before it loads the SDK or runs the driver, and refuses anything else.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection, createServer, type Server } from "node:net";
import { dirname, join } from "node:path";

/** The SDK's typed errors carry the reason (e.g. the rejected environment name) in `inner`; String() keeps only the variant. */
export function describeDriverError(error: unknown): string {
  const reason = (error as { inner?: { reason?: unknown } } | undefined)?.inner?.reason;
  return typeof reason === "string" && reason ? reason : String(error);
}

type PermissionStatus = { accessibility: boolean; screenRecording: boolean };
export function macScreenControlEnabled(configPath: string): boolean {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as
      { plugins?: { entries?: { "cua-computer"?: { enabled?: unknown } } } };
    return config.plugins?.entries?.["cua-computer"]?.enabled === true;
  } catch { return false; }
}
type Connection = { socketPath: string; generation: string | number };
type EmbeddedHost = {
  start(): Promise<Connection>;
  stop(): Promise<void>;
  /** Synchronous; one of EmbeddedDriverHostState. */
  state(): number;
  uniffiDestroy(): void;
};
type MacSdk = {
  currentMacOsPermissionStatus(): PermissionStatus;
  requestMacOSPermissions(): PermissionStatus;
  hasRequiredMacOSPermissions(status: PermissionStatus): boolean;
  EmbeddedPermissionMode: { Standard: number };
  EmbeddedDriverHostState: { Ready: number };
  EmbeddedCuaDriverHost: {
    withOptions(options: {
      binaryPath: string;
      hostBundleId: string;
      permissionMode: number;
      approveCapabilityManifest: boolean;
      approveSessionPolicy: boolean;
      dangerouslyBypassApprovals: boolean;
      environment: Array<{ name: string; value: string }>;
      inheritStderr: boolean;
    }): EmbeddedHost;
  };
};

function loadSdk(engineDir: string): MacSdk {
  const packageDir = [
    join(engineDir, "extensions", "cua-computer", "node_modules", "@trycua", "cua-driver"),
    join(engineDir, "node_modules", "@trycua", "cua-driver"),
  ].find((dir) => existsSync(join(dir, "dist", "embedded.js")));
  if (!packageDir) throw new Error("The Mac computer driver SDK is missing from this engine");
  const permissions = require(join(packageDir, "dist", "electron.js")) as Pick<MacSdk, "requestMacOSPermissions" | "hasRequiredMacOSPermissions">;
  const native = require(join(packageDir, "dist", "native", "index.js")) as Pick<MacSdk, "currentMacOsPermissionStatus">;
  const embedded = require(join(packageDir, "dist", "embedded.js")) as Pick<MacSdk, "EmbeddedCuaDriverHost" | "EmbeddedPermissionMode" | "EmbeddedDriverHostState">;
  return { ...permissions, ...native, ...embedded };
}

type Pins = { version: string; driver: string; native: Record<string, string> };

/** The engine's computer-use pins: the cua-computer package.json it ships (built or source layout). */
export function readEnginePins(engineDir: string, arch: string = process.arch): Pins | undefined {
  for (const manifest of [join(engineDir, "dist", "extensions", "cua-computer", "package.json"), join(engineDir, "extensions", "cua-computer", "package.json")]) {
    try {
      const value = JSON.parse(readFileSync(manifest, "utf8")) as {
        dependencies?: Record<string, string>;
        cuaDriverArtifacts?: Record<string, { files?: Record<string, string> }>;
      };
      const version = value.dependencies?.["@trycua/cua-driver"];
      const driver = value.cuaDriverArtifacts?.["darwin-universal-binary"]?.files?.["cua-driver"];
      const native = value.cuaDriverArtifacts?.[`darwin-${arch}`]?.files;
      const sha = (digest: unknown) => typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest);
      if (typeof version === "string" && sha(driver) && native && Object.keys(native).length && Object.values(native).every(sha)) {
        return { version, driver: driver!, native };
      }
    } catch { /* the next layout */ }
  }
  return undefined;
}

/** Where the driver comes from: the engine (older and source builds) or the verified per-user download. */
export type MacDriverLocation =
  | { state: "bundled" | "downloaded"; binary: string; sdkRoot: string }
  | { state: "not-downloaded" | "refused"; reason: string };

/** The per-user download folder for these pins. */
export function macDriverStore(stateDir: string, version: string, arch: string = process.arch): string {
  return join(stateDir, "tools", "computer-use", `${version}-darwin-${arch}`);
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function hostBundleId(): string {
  if (process.platform !== "darwin") return "ai.branch.mac";
  const plist = join(dirname(dirname(process.execPath)), "Info.plist");
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist], {
    encoding: "utf8", windowsHide: true,
  }).trim();
}

/** The computer pane's Coming reason line; the Gateway gets the current one with its environment.
 * Copy is the design preview's own: its permission ask says "macOS asks you to allow this once, in System Settings."
 * The preview has no line for a missing driver or a driver that fails to start, so those reasons are empty and the pane
 * shows the preview's bare "Coming" alone. A start failure's SDK reason goes only to desktop.log (bootEngine logs it). */
export const DRIVER_NOT_PACKAGED = "";
export const DRIVER_NEEDS_PERMISSION = "macOS asks you to allow this once, in System Settings.";
export const DRIVER_START_FAILED = "";

export class MacComputerDriver {
  /** Why the last start gave no endpoint; cleared once the driver is ready. */
  reason?: string;
  /** A verified download, keyed by the files' size and change time so a changed file is checked again. */
  private verified?: { key: string; location: MacDriverLocation };
  private host?: EmbeddedHost;
  private endpoint?: string;
  private selectedEngine?: string;
  private starting?: Promise<string | undefined>;
  private proxy?: Server;
  private exitWatch?: ReturnType<typeof setInterval>;

  /** Only a location already checked (bundled, or verified this run): never loads unchecked native code. */
  permissionsGranted(engineDir: string): boolean {
    const location = this.knownLocation(engineDir);
    if (!location || "reason" in location) return false;
    try {
      const sdk = this.sdk(location.sdkRoot);
      return sdk.hasRequiredMacOSPermissions(sdk.currentMacOsPermissionStatus());
    } catch { return false; }
  }

  constructor(
    private readonly log: (line: string) => void,
    private readonly sdk: (root: string) => MacSdk = loadSdk,
    private readonly bundleId: () => string = hostBundleId,
    /** The Branch Agent state dir, where the engine keeps the downloaded driver. */
    private readonly stateDir: () => string | undefined = () => undefined,
    private readonly arch: string = process.arch,
    private readonly exitPollMs = 2_000,
  ) {}

  /** Cheap: whether a driver is there to start (bundled, or a finished download), without checking digests. */
  installed(engineDir: string): boolean {
    if (existsSync(join(engineDir, "cua-driver"))) return true;
    const pins = readEnginePins(engineDir, this.arch);
    const stateDir = this.stateDir();
    return Boolean(pins && stateDir && existsSync(join(macDriverStore(stateDir, pins.version, this.arch), "computer-use-install.json")));
  }

  private storeKey(root: string, files: string[]): string {
    return [root, ...files.map(file => { try { const s = statSync(file); return `${s.size}:${s.mtimeMs}:${s.ino}`; } catch { return "missing"; } })].join("|");
  }

  private storeFiles(root: string, pins: Pins): Array<[string, string]> {
    const nativeDir = join(root, "node_modules", "@trycua", `cua-driver-darwin-${this.arch}`);
    return [[join(root, "cua-driver"), pins.driver], ...Object.entries(pins.native).map(([name, digest]): [string, string] => [join(nativeDir, name), digest])];
  }

  private knownLocation(engineDir: string): MacDriverLocation | undefined {
    const binary = join(engineDir, "cua-driver");
    if (existsSync(binary)) return { state: "bundled", binary, sdkRoot: engineDir };
    const pins = readEnginePins(engineDir, this.arch);
    const stateDir = this.stateDir();
    if (!pins || !stateDir) return undefined;
    const root = macDriverStore(stateDir, pins.version, this.arch);
    const key = this.storeKey(root, this.storeFiles(root, pins).map(([file]) => file));
    return this.verified?.key === key ? this.verified.location : undefined;
  }

  /**
   * The driver to start. A download is hashed against the engine's pins first; a mismatch is refused before the
   * SDK's native library is loaded or the driver runs.
   */
  async locate(engineDir: string): Promise<MacDriverLocation> {
    const binary = join(engineDir, "cua-driver");
    if (existsSync(binary)) return { state: "bundled", binary, sdkRoot: engineDir };
    const pins = readEnginePins(engineDir, this.arch);
    const stateDir = this.stateDir();
    if (!pins || !stateDir) return { state: "not-downloaded", reason: `Mac computer driver is not packaged in ${engineDir}` };
    const root = macDriverStore(stateDir, pins.version, this.arch);
    if (!existsSync(join(root, "computer-use-install.json"))) {
      return { state: "not-downloaded", reason: `Mac computer driver ${pins.version} is not downloaded yet; the engine downloads it the first time computer use is on` };
    }
    const files = this.storeFiles(root, pins);
    const key = this.storeKey(root, files.map(([file]) => file));
    if (this.verified?.key === key) return this.verified.location;
    let location: MacDriverLocation = { state: "downloaded", binary: join(root, "cua-driver"), sdkRoot: root };
    for (const [file, digest] of files) {
      const actual = await sha256File(file).catch(() => "missing");
      if (actual !== digest) {
        location = { state: "refused", reason: `Mac computer driver refused: ${file} does not match the SHA-256 this engine pins (${actual === "missing" ? "missing" : actual}); it was not loaded or run` };
        break;
      }
    }
    this.verified = { key, location };
    return location;
  }

  async start(engineDir: string): Promise<string | undefined> {
    if (this.selectedEngine === engineDir && this.endpoint) return this.endpoint;
    if (this.starting) return this.starting;
    this.starting = this.startSelected(engineDir).then(endpoint => {
      if (endpoint) this.reason = undefined;
      return endpoint;
    }, error => {
      this.reason = DRIVER_START_FAILED;
      throw error;
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startSelected(engineDir: string): Promise<string | undefined> {
    await this.stop();
    const location = await this.locate(engineDir);
    if ("reason" in location) {
      this.log(location.reason);
      // Not downloaded yet, or refused: the pane shows the preview's bare "Coming"; the why stays in desktop.log.
      this.reason = DRIVER_NOT_PACKAGED;
      return undefined;
    }
    const binary = location.binary;
    const sdk = this.sdk(location.sdkRoot);
    const current = sdk.currentMacOsPermissionStatus();
    const permissions = sdk.hasRequiredMacOSPermissions(current) ? current : sdk.requestMacOSPermissions();
    if (!sdk.hasRequiredMacOSPermissions(permissions)) {
      this.log("Mac computer driver is waiting for Accessibility and Screen Recording permission");
      this.reason = DRIVER_NEEDS_PERMISSION;
      return undefined;
    }
    // The native driver must enforce its own approval policy even if the Gateway
    // has admitted a computer action. A broker below authenticates its caller.
    const host = sdk.EmbeddedCuaDriverHost.withOptions({
      binaryPath: binary,
      hostBundleId: this.bundleId(),
      permissionMode: sdk.EmbeddedPermissionMode.Standard,
      approveCapabilityManifest: false,
      approveSessionPolicy: false,
      dangerouslyBypassApprovals: false,
      // Only names on the SDK's embedded safe allowlist: any other name makes withOptions throw Configuration.
      environment: [{ name: "CUA_DRIVER_RS_TELEMETRY_ENABLED", value: "false" }],
      inheritStderr: false,
    });
    try {
      const connection = await host.start(); // Resolves only after the private socket accepts connections.
      const secret = randomBytes(32).toString("hex");
      const proxy = createServer(client => {
        let pending = Buffer.alloc(0);
        const reject = () => client.destroy();
        client.setTimeout(5_000, reject);
        client.on("data", function authenticate(chunk) {
          pending = Buffer.concat([pending, chunk]);
          const newline = pending.indexOf(10);
          if (newline > 4_096 || newline < 0 && pending.length > 4_096) return reject();
          if (newline < 0) return;
          client.off("data", authenticate);
          const supplied = pending.subarray(0, newline);
          const expected = Buffer.from(secret);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reject();
          client.setTimeout(0);
          const driver = createConnection(connection.socketPath);
          driver.on("error", reject);
          client.on("error", () => driver.destroy());
          client.on("close", () => driver.destroy());
          if (pending.length > newline + 1) driver.write(pending.subarray(newline + 1));
          client.pipe(driver).pipe(client);
        });
      });
      await new Promise<void>((resolve, reject) => {
        proxy.once("error", reject);
        proxy.listen(0, "127.0.0.1", () => { proxy.off("error", reject); resolve(); });
      });
      const address = proxy.address();
      if (!address || typeof address === "string") throw new Error("Mac driver broker did not bind to loopback");
      this.host = host;
      this.proxy = proxy;
      this.selectedEngine = engineDir;
      this.endpoint = JSON.stringify({ v: 2, port: address.port, secret });
      this.watchExit(host, sdk.EmbeddedDriverHostState.Ready);
      return this.endpoint;
    } catch (error) {
      this.proxy?.close();
      this.proxy = undefined;
      this.host = undefined;
      await host.stop();
      host.uniffiDestroy();
      throw error;
    }
  }

  /** Notices the driver exiting. The SDK's waitForExit re-polls every 50 ms and its pinned Node binding leaks a libuv
   *  handle per poll (trycua/cua#4339), which spun the app's main loop near 100% CPU within hours. A synchronous state
   *  check every two seconds costs nothing and never leaves a native call pending. */
  private watchExit(host: EmbeddedHost, ready: number): void {
    this.clearExitWatch();
    const watch = setInterval(() => {
      let state: number;
      try { state = host.state(); } catch (error) {
        this.clearExitWatch();
        this.log(`Mac computer driver exit watch: ${String(error)}`);
        return;
      }
      if (state === ready) return;
      this.clearExitWatch();
      if (this.host === host) {
        this.endpoint = undefined;
        this.log("Mac computer driver exited; restart Branch Agent to reconnect computer control");
      }
    }, this.exitPollMs);
    watch.unref?.();
    this.exitWatch = watch;
  }

  private clearExitWatch(): void {
    if (this.exitWatch) clearInterval(this.exitWatch);
    this.exitWatch = undefined;
  }

  async stop(): Promise<void> {
    this.clearExitWatch();
    const host = this.host;
    const proxy = this.proxy;
    this.host = undefined;
    this.proxy = undefined;
    this.endpoint = undefined;
    this.selectedEngine = undefined;
    proxy?.close();
    if (host) {
      await host.stop();
      host.uniffiDestroy();
    }
  }
}
