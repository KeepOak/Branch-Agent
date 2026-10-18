// The macOS CUA daemon must be spawned by Electron, the process that owns TCC grants.
// Loading the pinned SDK from the selected engine also keeps app and engine updates in sync.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:net";
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

/** The driver's own MCP front: the engine speaks MCP JSON-RPC, while the embedded daemon's private socket speaks the
 *  driver's internal protocol (it answers `initialize` with {"ok":false,"error":"Unknown method: initialize"}). Each
 *  admitted engine connection gets one `cua-driver mcp --embedded --socket <daemon>` proxy, like Windows and Linux. */
export function mcpProxyArgs(socketPath: string): string[] {
  return ["mcp", "--embedded", "--socket", socketPath];
}

/** The proxy's environment: this app's, without driver overrides, with telemetry and update checks off. */
export function mcpProxyEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("CUA_DRIVER_") || key === "CUA_TELEMETRY_ENABLED" || key.startsWith("BRANCH_CUA_")) continue;
    out[key] = value;
  }
  return { ...out, CUA_DRIVER_RS_TELEMETRY_ENABLED: "false", CUA_DRIVER_RS_UPDATE_CHECK: "false" };
}

export class MacComputerDriver {
  /** Why the last start gave no endpoint; cleared once the driver is ready. */
  reason?: string;
  private host?: EmbeddedHost;
  private endpoint?: string;
  private selectedEngine?: string;
  private starting?: Promise<string | undefined>;
  private proxy?: Server;
  private exitWatch?: ReturnType<typeof setInterval>;

  permissionsGranted(engineDir: string): boolean {
    try {
      const sdk = this.sdk(engineDir);
      return sdk.hasRequiredMacOSPermissions(sdk.currentMacOsPermissionStatus());
    } catch { return false; }
  }

  constructor(
    private readonly log: (line: string) => void,
    private readonly sdk: (engineDir: string) => MacSdk = loadSdk,
    private readonly bundleId: () => string = hostBundleId,
    private readonly exitPollMs = 2_000,
    private readonly spawnProxy: typeof spawn = spawn,
  ) {}

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
    const binary = join(engineDir, "cua-driver");
    if (!existsSync(binary)) {
      this.log(`Mac computer driver is not packaged in ${engineDir}`);
      this.reason = DRIVER_NOT_PACKAGED;
      return undefined;
    }
    const sdk = this.sdk(engineDir);
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
        const reject = (): void => { client.destroy(); };
        client.setTimeout(5_000, reject);
        const authenticate = (chunk: Buffer): void => {
          pending = Buffer.concat([pending, chunk]);
          const newline = pending.indexOf(10);
          if (newline > 4_096 || newline < 0 && pending.length > 4_096) return reject();
          if (newline < 0) return;
          client.off("data", authenticate);
          const supplied = pending.subarray(0, newline);
          const expected = Buffer.from(secret);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reject();
          client.setTimeout(0);
          // Private #1103 item 5: piping the engine's MCP straight into the daemon socket failed every capture with
          // "CUA MCP proxy returned an invalid JSON-RPC version". The driver's MCP proxy translates for it.
          const mcp = this.spawnProxy(binary, mcpProxyArgs(connection.socketPath), {
            env: mcpProxyEnvironment(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
          });
          const stop = () => { if (mcp.exitCode === null && mcp.signalCode === null) mcp.kill(); };
          mcp.on("error", error => { this.log(`Mac computer driver MCP proxy: ${String(error)}`); reject(); });
          mcp.on("exit", () => client.destroy());
          mcp.stdin!.on("error", () => client.destroy());
          client.on("error", stop);
          client.on("close", stop);
          if (pending.length > newline + 1) mcp.stdin!.write(pending.subarray(newline + 1));
          client.pipe(mcp.stdin!);
          mcp.stdout!.pipe(client);
        };
        client.on("data", authenticate);
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
