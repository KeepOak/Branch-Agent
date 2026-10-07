// The macOS CUA daemon must be spawned by Electron, the process that owns TCC grants.
// Loading the pinned SDK from the selected engine also keeps app and engine updates in sync.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

type PermissionStatus = { accessibility: boolean; screenRecording: boolean };
type Connection = { socketPath: string; generation: string | number };
type EmbeddedHost = {
  start(): Promise<Connection>;
  stop(): Promise<void>;
  waitForExit(generation: Connection["generation"]): Promise<unknown>;
  uniffiDestroy(): void;
};
type MacSdk = {
  requestMacOSPermissions(): PermissionStatus;
  hasRequiredMacOSPermissions(status: PermissionStatus): boolean;
  EmbeddedPermissionMode: { Unrestricted: number };
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
  const embedded = require(join(packageDir, "dist", "embedded.js")) as Pick<MacSdk, "EmbeddedCuaDriverHost" | "EmbeddedPermissionMode">;
  return { ...permissions, ...embedded };
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
    const permissions = sdk.requestMacOSPermissions();
    if (!sdk.hasRequiredMacOSPermissions(permissions)) {
      this.log("Mac computer driver is waiting for Accessibility and Screen Recording permission");
      return undefined;
    }
    // Gateway policy is the authorization ceiling. The daemon must accept
    // windows discovered after launch, which a bounded startup manifest cannot.
    const host = sdk.EmbeddedCuaDriverHost.withOptions({
      binaryPath: binary,
      hostBundleId: this.bundleId(),
      permissionMode: sdk.EmbeddedPermissionMode.Unrestricted,
      approveCapabilityManifest: false,
      approveSessionPolicy: false,
      dangerouslyBypassApprovals: true,
      environment: [
        { name: "CUA_DRIVER_RS_TELEMETRY_ENABLED", value: "false" },
        { name: "CUA_DRIVER_RS_UPDATE_CHECK", value: "false" },
      ],
      inheritStderr: false,
    });
    try {
      const connection = await host.start(); // Resolves only after the private socket accepts connections.
      this.host = host;
      this.selectedEngine = engineDir;
      this.endpoint = JSON.stringify({ v: 1, socketPath: connection.socketPath, binaryPath: binary });
      void host.waitForExit(connection.generation).then(() => {
        if (this.host === host) {
          this.endpoint = undefined;
          this.log("Mac computer driver exited; restart Branch Agent to reconnect computer control");
        }
      }).catch(error => this.log(`Mac computer driver exit watch: ${String(error)}`));
      return this.endpoint;
    } catch (error) {
      await host.stop();
      host.uniffiDestroy();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const host = this.host;
    this.host = undefined;
    this.endpoint = undefined;
    this.selectedEngine = undefined;
    if (host) {
      await host.stop();
      host.uniffiDestroy();
    }
  }
}
