// Always on (Private #454, part C): closing the window only hides it; the tray / menu-bar icon says what the engine is
// doing and offers Open Branch, Pause all work and Stop Branch completely. Nothing here imports Electron: main.ts
// gives it the engine calls the app already makes (the engine's /readyz, the window's approval and session lists).

/** What the tray shows. `running` false means no engine answers. */
export interface EngineLiveState { running: boolean; workingTrunks: number; waitingOnYou: number }

/** What the window reports from its own engine calls (the same probe automatic updates use). */
export interface WindowWork { pendingApprovals: number; streaming: boolean; workingTrunks?: number }

export interface LiveStateSources {
  /** The engine answers: the service engine's /readyz, or the owned child engine is serving. */
  engineUp(): Promise<boolean>;
  /** The window's approval lists and live sessions; rejects or resolves undefined when no window answers. */
  window(): Promise<WindowWork | undefined>;
  /** The owned child engine's own run count (child mode only); the window's count wins when it has one. */
  engineRuns?(): Promise<number | undefined>;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The one line the tray shows, for example "2 Trunks working", "Waiting on you (1)" or "Stopped". */
export function trayLabel(state: EngineLiveState | undefined): string {
  if (!state) return "Starting";
  if (!state.running) return "Stopped";
  if (state.waitingOnYou > 0) return `Waiting on you (${state.waitingOnYou})`;
  if (state.workingTrunks > 0) return `${plural(state.workingTrunks, "Trunk")} working`;
  return "Ready";
}

/** Reads the live state from the engine calls the app already has. Never throws: a silent engine is "Stopped". */
export async function readEngineLiveState(sources: LiveStateSources): Promise<EngineLiveState> {
  if (!await sources.engineUp().catch(() => false)) return { running: false, workingTrunks: 0, waitingOnYou: 0 };
  const [window, runs] = await Promise.all([
    sources.window().catch(() => undefined),
    sources.engineRuns ? sources.engineRuns().catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const workingTrunks = window?.workingTrunks ?? runs ?? (window?.streaming ? 1 : 0);
  return { running: true, workingTrunks: Math.max(0, workingTrunks), waitingOnYou: Math.max(0, window?.pendingApprovals ?? 0) };
}

export interface TrayActions {
  open(): void;
  pauseAll?(): void;
  /** Quits the app only: with the engine service, the engine keeps working. */
  quit(): void;
  stopCompletely?(): void;
}

export type TrayMenuItem = { label?: string; type?: "separator"; enabled?: boolean; click?: () => void };

/** The tray menu: the live line, Open Branch, Pause all work, Quit Branch and Stop Branch completely. */
export function trayMenu(state: EngineLiveState | undefined, actions: TrayActions): TrayMenuItem[] {
  const items: TrayMenuItem[] = [];
  if (state) items.push({ label: trayLabel(state), enabled: false }, { type: "separator" });
  items.push({ label: "Open Branch", click: actions.open });
  if (actions.pauseAll) items.push({ label: "Pause all work", enabled: Boolean(state?.running && state.workingTrunks > 0), click: actions.pauseAll });
  items.push({ type: "separator" }, { label: "Quit Branch", click: actions.quit });
  if (actions.stopCompletely) items.push({ label: "Stop Branch completely", click: actions.stopCompletely });
  return items;
}

export interface StopCompletelySteps {
  state(): Promise<EngineLiveState>;
  /** Asked only when work is running (or the state cannot be read); resolves true to stop anyway. */
  confirm(message: string, detail: string): Promise<boolean>;
  /**
   * Stops the engine service through the engine's own `branch gateway stop` (engine/src/daemon). The service manager
   * starts it again at the next sign-in, and the app starts it at its next launch. Absent when the engine runs inside
   * the app: quitting stops that one.
   */
  stopService?(): Promise<void>;
  quit(): void;
  log(line: string): void;
}

/** "Stop Branch completely": warns first when work is running, then stops the service and quits the app. */
export async function stopBranchCompletely(steps: StopCompletelySteps): Promise<"stopped" | "cancelled"> {
  const state = await steps.state().catch(() => undefined);
  const working = state?.workingTrunks ?? 0, waiting = state?.waitingOnYou ?? 0;
  if (!state || working > 0 || waiting > 0) {
    const message = !state ? "Branch may still be working."
      : working > 0 ? `${plural(working, "Trunk")} ${working === 1 ? "is" : "are"} still working.`
      : `${plural(waiting, "request")} ${waiting === 1 ? "is" : "are"} waiting on you.`;
    const detail = "Stopping now ends their runs. Branch starts again the next time you sign in or open it.";
    if (!await steps.confirm(message, detail)) {
      steps.log("stop completely: cancelled at the warning");
      return "cancelled";
    }
  }
  if (steps.stopService) {
    await steps.stopService();
    steps.log("stop completely: the engine service is stopped until the next sign-in or app launch");
  }
  steps.quit();
  return "stopped";
}
