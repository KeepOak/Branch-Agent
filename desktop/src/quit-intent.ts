// Quit means stop (Private #1095, walkthrough B-102 to B-104). Closing the window keeps Branch in the tray; Quit, from
// the tray, the Branch menu or Ctrl/Cmd Q, stops the app, its engine and every process the engine started, so nothing
// is left running. Crashes, update hand-offs and other quits the app makes on its own keep their old behaviour.
// Nothing here imports Electron.

let fullStop = false;

/** The person chose Quit: the engine stops with the app, including a fallback engine that would otherwise stay. */
export function requestFullStop(): void { fullStop = true; }

/** True once the person chose Quit in this app session. */
export function fullStopRequested(): boolean { return fullStop; }

/** A new app session (the resident window is set up again) starts with no Quit chosen. */
export function resetQuitIntent(): void { fullStop = false; }

interface SignalSource { once(signal: NodeJS.Signals, listener: () => void): unknown }

/**
 * A terminal's Ctrl C, a closed terminal and `kill` quit the same way as Quit, so the engine and its workers are not
 * left behind. A second signal falls through to the system default.
 */
export function quitOnSignals(source: SignalSource, quit: (signal: NodeJS.Signals) => void): void {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) source.once(signal, () => quit(signal));
}
