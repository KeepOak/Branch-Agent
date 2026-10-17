import { START_IN_TRAY } from "./desktop-os";

/**
 * The arguments the relaunched app starts with after a staged desktop shell is applied at an idle gap (Private #1054
 * M5). The window comes back as it was: a window the owner had open opens again, and an app that sat in the tray
 * (started with Windows, or closed to the tray) comes back quietly in the tray. Only Windows reads START_IN_TRAY, so
 * elsewhere the arguments are kept as they are.
 */
export function relaunchArgs(argv: readonly string[], windowShown: boolean, platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return [...argv];
  const rest = argv.filter(arg => arg !== START_IN_TRAY);
  return windowShown ? rest : [...rest, START_IN_TRAY];
}

/**
 * Quit and relaunch onto a staged desktop shell, once: the update helper is handed the swap and the relaunch, then
 * this app quits through its normal quit (which hands the engine over or stops it cleanly). A second call while the
 * first is under way does nothing, so one idle gap never schedules two relaunches.
 */
export function createShellRelaunch(options: {
  /** Hands the staged shell to the update helper with these relaunch arguments; false when nothing is staged. */
  handOff(args: string[]): Promise<boolean>;
  quit(): void;
  argv: readonly string[];
  windowShown(): boolean;
  platform?: NodeJS.Platform;
  log(line: string): void;
}) {
  let relaunching = false;
  return async function relaunch(): Promise<void> {
    if (relaunching) return;
    relaunching = true;
    const shown = options.windowShown();
    try {
      const handed = await options.handOff(relaunchArgs(options.argv, shown, options.platform));
      if (!handed) throw new Error("the staged desktop update could not be handed to the update helper");
    } catch (error) {
      relaunching = false;
      throw error;
    }
    options.log(`desktop update staged; handing off to the update helper at an idle gap and quitting (${shown ? "window open" : "tray only"})`);
    options.quit();
  };
}
