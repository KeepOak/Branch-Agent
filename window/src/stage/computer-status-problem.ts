/** What the computer pane's status call says is blocking this computer, in plain words. */
export type ComputerStatus = { available?: boolean; configured?: boolean; reason?: string; error?: string };

/** One centered line, an optional Try again, and the technical detail kept behind "Technical details". */
export type StatusProblem = { line: string; retry: boolean; technical?: string };

const CANT_SEE = "Branch can't see this computer's screen right now. Quit Branch Agent and open it again.";
const CONTROL_OFF = "Computer control is off. Turn it on in Settings to see this Mac's screen.";
const COULDNT_SHOW = "Couldn't show this computer's screen.";

/** Maps one status reply to the pane state it should show. Undefined means the screen is available. */
export function computerStatusProblem(status: ComputerStatus): StatusProblem | undefined {
  if (status.available) return undefined;
  const technical = status.error?.trim() || undefined;
  // The desktop's own sentence wins; an empty one still means the driver is not up, so the plain line applies.
  if (typeof status.reason === "string") return { line: status.reason.trim() || CANT_SEE, retry: false, technical };
  if (status.configured === false) return { line: CONTROL_OFF, retry: false };
  if (technical?.startsWith("COMPUTER_DRIVER_UNAVAILABLE:")) return { line: CANT_SEE, retry: false, technical };
  return { line: COULDNT_SHOW, retry: true, technical };
}
