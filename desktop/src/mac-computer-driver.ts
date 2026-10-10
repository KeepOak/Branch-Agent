// The macOS CUA daemon must be spawned by Electron, the process that owns TCC grants.
// Loading the pinned SDK from the selected engine also keeps app and engine updates in sync.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
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
  waitForExit(generation: Connection["generation"]): Promise<unknown>;
  uniffiDestroy(): void;
};
type MacSdk = {
  currentMacOsPermissionStatus(): PermissionStatus;
  requestMacOSPermissions(): PermissionStatus;
  hasRequiredMacOSPermissions(status: PermissionStatus): boolean;
  EmbeddedPermissionMode: { Standard: number };
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
  const embedded = require(join(packageDir, "dist", "embedded.js")) as Pick<MacSdk, "EmbeddedCuaDriverHost" | "EmbeddedPermissionMode">;
  return { ...permissions, ...native, ...embedded };
}

function hostBundleId(): string {
  if (process.platform !== "darwin") return "ai.branch.mac";
  const plist = join(dirname(dirname(process.execPath)), "Info.plist");
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist], {
    encoding: "utf8", windowsHide: true,
  }).trim();
}

export class MacComputerDriver {
  private host?: EmbeddedHost;
  private endpoint?: string;
  private selectedEngine?: string;
  private starting?: Promise<string | undefined>;
  private proxy?: Server;

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
  ) {}

  async start(engineDir: string): Promise<string | undefined> {
    if (this.selectedEngine === engineDir && this.endpoint) return this.endpoint;
    if (this.starting) return this.starting;
    this.starting = this.startSelected(engineDir).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startSelected(engineDir: string): Promise<string | undefined> {
    await this.stop();
    const binary = join(engineDir, "cua-driver");
    if (!existsSync(binary)) {
      this.log(`Mac computer driver is not packaged in ${engineDir}`);
      return undefined;
    }
    const sdk = this.sdk(engineDir);
    const current = sdk.currentMacOsPermissionStatus();
    const permissions = sdk.hasRequiredMacOSPermissions(current) ? current : sdk.requestMacOSPermissions();
    if (!sdk.hasRequiredMacOSPermissions(permissions)) {
      this.log("Mac computer driver is waiting for Accessibility and Screen Recording permission");
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
      void host.waitForExit(connection.generation).then(() => {
        if (this.host === host) {
          this.endpoint = undefined;
          this.log("Mac computer driver exited; restart Branch Agent to reconnect computer control");
        }
      }).catch(error => this.log(`Mac computer driver exit watch: ${String(error)}`));
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

  async stop(): Promise<void> {
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
