// Always on (Private #454, part C): closing the window only hides it; the tray / menu-bar icon says what the engine is
// doing and offers Open Branch, Pause all work and Stop Branch completely. Nothing here imports Electron: main.ts
// gives it the engine calls the app already makes (the engine's /readyz, the window's approval and session lists).

/**
 * What the tray shows. `running` false means no engine answers. `degraded` (Private #454 D, honest health) is the
 * engine's own reason from /health while an agent can't answer, for example an agent database that isn't admitting.
 */
export interface EngineLiveState { running: boolean; workingTrunks: number; waitingOnYou: number; degraded?: string }

/** The engine's /health answer: whether it answered at all, and its reason when it says degraded. */
export interface EngineHealth { answered: boolean; degraded?: string }

/** What the window reports from its own engine calls (the same probe automatic updates use). */
export interface WindowWork { pendingApprovals: number; streaming: boolean; workingTrunks?: number }

export interface LiveStateSources {
  /** The engine answers: the service engine's /readyz, or the owned child engine is serving. */
  engineUp(): Promise<boolean>;
  /** The window's approval lists and live sessions; rejects or resolves undefined when no window answers. */
  window(): Promise<WindowWork | undefined>;
  /** The owned child engine's own run count (child mode only); the window's count wins when it has one. */
  engineRuns?(): Promise<number | undefined>;
  /** The engine's /health. An engine that answers it is running even while /readyz says not ready. */
  health?(): Promise<EngineHealth>;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The one line the tray shows, for example "2 Trunks working", "Waiting on you (1)" or "Stopped". */
export function trayLabel(state: EngineLiveState | undefined): string {
  if (!state) return "Starting";
  if (!state.running) return "Stopped";
  // Never "Ready" while an agent can't answer.
  if (state.degraded) return `Needs attention: ${state.degraded}`;
  if (state.waitingOnYou > 0) return `Waiting on you (${state.waitingOnYou})`;
  if (state.workingTrunks > 0) return `${plural(state.workingTrunks, "Trunk")} working`;
  return "Ready";
}

/** Reads the live state from the engine calls the app already has. Never throws: a silent engine is "Stopped". */
export async function readEngineLiveState(sources: LiveStateSources): Promise<EngineLiveState> {
  const [up, health] = await Promise.all([
    sources.engineUp().catch(() => false),
    sources.health ? sources.health().catch((): EngineHealth => ({ answered: false })) : Promise.resolve(undefined),
  ]);
  if (!up && !health?.answered) return { running: false, workingTrunks: 0, waitingOnYou: 0 };
  const degraded = health?.degraded ? { degraded: health.degraded } : {};
  const [window, runs] = await Promise.all([
    sources.window().catch(() => undefined),
    sources.engineRuns ? sources.engineRuns().catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const workingTrunks = window?.workingTrunks ?? runs ?? (window?.streaming ? 1 : 0);
  return { running: true, workingTrunks: Math.max(0, workingTrunks), waitingOnYou: Math.max(0, window?.pendingApprovals ?? 0), ...degraded };
}

/** One OS notification: something waits on you, or a Trunk finished. */
export interface WorkNotice { kind: "approval" | "done"; title: string; body: string }

/** What changed between two tray reads that is worth a notification. */
export function workNotices(before: EngineLiveState | undefined, after: EngineLiveState): WorkNotice[] {
  if (!before?.running || !after.running) return [];
  const notices: WorkNotice[] = [];
  if (after.waitingOnYou > before.waitingOnYou) {
    notices.push({ kind: "approval", title: "Waiting on you",
      body: after.waitingOnYou === 1 ? "A Trunk needs your answer before it can go on." : `${after.waitingOnYou} requests need your answer.` });
  }
  if (after.workingTrunks < before.workingTrunks) {
    const done = before.workingTrunks - after.workingTrunks;
    notices.push({ kind: "done", title: "Done", body: done === 1 ? "A Trunk finished its work." : `${done} Trunks finished their work.` });
  }
  return notices;
}

export interface ClosedWindowNotifierDeps {
  /** True while the window is on screen; notifications are only for when it is closed (hidden) or minimised. */
  windowShown(): boolean;
  /** The OS notification, raised from the tray. */
  show(notice: WorkNotice): void;
  /**
   * The paired phone (existing push service). Approvals already reach a paired phone from the engine itself
   * (engine/src/gateway/exec-approval-ios-push.ts), so only "done" is sent here.
   */
  phone?(notice: WorkNotice): void;
}

/** Reach you with the window closed (Private #454 D): approvals and "done" from the tray's live state. */
export function createClosedWindowNotifier(deps: ClosedWindowNotifierDeps): { observe(state: EngineLiveState): WorkNotice[] } {
  let last: EngineLiveState | undefined;
  return {
    observe: (state) => {
      const notices = workNotices(last, state);
      last = state;
      if (deps.windowShown()) return [];
      for (const notice of notices) {
        deps.show(notice);
        if (notice.kind === "done") deps.phone?.(notice);
      }
      return notices;
    },
  };
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
