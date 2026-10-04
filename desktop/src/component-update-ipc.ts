import type { DesktopConfig } from "./config";
import { componentReleaseRejected, readComponentManifest, readComponentUpdateStatus, refreshComponentUpdate } from "./component-update";

export interface ComponentUpdateStatus {
  phase: "unchecked" | "checking" | "available" | "current" | "staging" | "staged" | "error";
  currentVersion: string | null;
  latestVersion: string | null;
  pendingVersion: string | null;
  checkedAt: number | null;
  error: string | null;
}
export interface ComponentUpdateController {
  status(): Promise<ComponentUpdateStatus>;
  check(): Promise<ComponentUpdateStatus>;
  stage(): Promise<ComponentUpdateStatus>;
}

/** No renderer URL, channel, filesystem path or retry policy enters the component updater. */
export function createComponentUpdateController(cfg: DesktopConfig, options: {
  request?: typeof fetch;
  stage?: () => Promise<boolean>;
} = {}): ComponentUpdateController {
  let state: ComponentUpdateStatus = { phase: "unchecked", currentVersion: null, latestVersion: null, pendingVersion: null, checkedAt: null, error: null };
  let flight: Promise<ComponentUpdateStatus> | undefined;
  let activeKind: "checking" | "staging" | undefined;
  let reading: Promise<ComponentUpdateStatus> | undefined;
  const status = (): Promise<ComponentUpdateStatus> => {
    reading ??= readComponentUpdateStatus(cfg).then(value => {
      const phase = value.pendingVersion ? "staged" : state.phase === "staged"
        ? state.latestVersion === value.currentVersion ? "current" : "unchecked" : state.phase;
      state = { ...state, ...value, phase, ...(value.pendingVersion ? { latestVersion: value.pendingVersion } : {}) };
      return { ...state };
    }).finally(() => { reading = undefined; });
    return reading;
  };
  const run = (kind: "checking" | "staging", work: () => Promise<void>): Promise<ComponentUpdateStatus> => {
    if (flight) return activeKind === kind ? flight : flight.then(() => run(kind, work));
    activeKind = kind;
    state = { ...state, phase: kind, error: null };
    flight = work().then(status, error => {
      state = { ...state, phase: "error", error: error instanceof Error ? error.message : String(error) };
      return { ...state };
    }).finally(() => { flight = undefined; activeKind = undefined; });
    return flight;
  };
  return { status, check: () => run("checking", async () => {
    const release = await readComponentManifest(options.request);
    const installed = await readComponentUpdateStatus(cfg);
    if (!installed.pendingVersion && installed.currentVersion !== release.version && await componentReleaseRejected(cfg, release)) {
      throw new Error("The latest release failed readiness; the desktop retained its previous components");
    }
    state = { ...state, ...installed, phase: installed.pendingVersion ? "staged" : installed.currentVersion === release.version ? "current" : "available",
      latestVersion: release.version, checkedAt: Date.now() };
  }), stage: () => run("staging", async () => {
    const staged = await (options.stage ?? (() => refreshComponentUpdate(cfg, options.request)))();
    const installed = await readComponentUpdateStatus(cfg);
    if (!staged && !installed.pendingVersion && state.latestVersion && installed.currentVersion !== state.latestVersion) {
      throw new Error("The release was not staged; the desktop retained its current components");
    }
    state = { ...state, phase: state.latestVersion && installed.currentVersion === state.latestVersion ? "current" : "unchecked" };
  }) };
}

interface Sender { getURL(): string; mainFrame: { url: string } }
interface InvokeEvent { sender: Sender; senderFrame: Sender["mainFrame"] | null }
interface Ipc { handle(channel: string, listener: (event: InvokeEvent, ...args: unknown[]) => Promise<ComponentUpdateStatus>): void }

export function isOwnedComponentWindow(event: InvokeEvent, sender: Sender | undefined, servedUrl: string): boolean {
  return Boolean(sender && event.sender === sender && event.senderFrame === sender.mainFrame
    && sender.getURL().startsWith(servedUrl) && event.senderFrame?.url.startsWith(servedUrl));
}

/** Both the owning webContents and its served main frame are mandatory. */
export function registerComponentUpdateIpc(ipc: Ipc, owner: () => Sender | undefined, servedUrl: string, controller: ComponentUpdateController): void {
  for (const method of ["status", "check", "stage"] as const) {
    ipc.handle(`branch-desktop:component-update:${method}`, async (event, ...args) => {
      if (!isOwnedComponentWindow(event, owner(), servedUrl)) throw new Error("Component updates require the owned served window");
      if (args.length) throw new Error("Component update calls accept no arguments");
      return controller[method]();
    });
  }
}
