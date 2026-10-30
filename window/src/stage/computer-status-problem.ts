import { isScreenPermissionError, SCREEN_PERMISSION_LINE } from "./screen-permission";

/** What the computer pane's status call says is blocking this computer, in plain words. */
export type ComputerStatus = { available?: boolean; configured?: boolean; reason?: string; error?: string };

/** One centered line, an optional Try again, and the technical detail kept behind "Technical details" (Technical only).
 * `permission`: macOS is holding the screen back; the pane offers Open System Settings and keeps trying by itself. */
export type StatusProblem = { line: string; retry: boolean; technical?: string; permission?: true };

/** The pane's state while macOS keeps the screen from Branch (Private #1103 item 5). */
export function screenPermissionProblem(technical?: string): StatusProblem {
  return { line: SCREEN_PERMISSION_LINE, retry: false, permission: true, ...(technical ? { technical } : {}) };
}

const CANT_SEE = "Branch can't see this computer's screen right now. Quit Branch Agent and open it again.";
const CONTROL_OFF = "Computer control is off. Turn it on in Settings to see this Mac's screen.";
const COULDNT_SHOW = "Couldn't show this computer's screen.";

/** Maps one status reply to the pane state it should show. Undefined means the screen is available. */
export function computerStatusProblem(status: ComputerStatus): StatusProblem | undefined {
  if (status.available) return undefined;
  const technical = status.error?.trim() || undefined;
  // Screen Recording is off (the desktop's permission reason, or a capture error that says so): ask for it plainly.
  if (isScreenPermissionError(status.reason) || isScreenPermissionError(technical)) return screenPermissionProblem(technical);
  // The desktop's own sentence wins; an empty one still means the driver is not up, so the plain line applies.
  if (typeof status.reason === "string") return { line: status.reason.trim() || CANT_SEE, retry: false, technical };
  if (status.configured === false) return { line: CONTROL_OFF, retry: false };
  if (technical?.startsWith("COMPUTER_DRIVER_UNAVAILABLE:")) return { line: CANT_SEE, retry: false, technical };
  return { line: COULDNT_SHOW, retry: true, technical };
}
