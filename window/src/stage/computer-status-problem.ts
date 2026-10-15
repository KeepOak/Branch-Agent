/** What the computer pane's status call says is blocking this Mac, in plain words. */
export type ComputerStatus = { available?: boolean; configured?: boolean; reason?: string; error?: string };

export type StatusProblem =
  | { kind: "coming"; reason: string }
  | { kind: "error"; message: string; retry: boolean };

const DRIVER_NOT_RUNNING = "This Mac's computer driver isn't running. Quit Branch Agent and open it again.";
const CONTROL_OFF = "Computer control is off. Turn it on in Settings to see this Mac's screen.";
const GENERIC = "Couldn't show this computer's screen. Try again.";

/** Maps one status reply to the pane state it should show. Undefined means the screen is available. */
export function computerStatusProblem(status: ComputerStatus): StatusProblem | undefined {
  if (status.available) return undefined;
  if (typeof status.reason === "string") return { kind: "coming", reason: status.reason };
  if (status.configured === false) return { kind: "error", message: CONTROL_OFF, retry: false };
  const code = (status.error ?? "").split(":")[0]?.trim();
  if (code === "COMPUTER_DRIVER_UNAVAILABLE") return { kind: "error", message: DRIVER_NOT_RUNNING, retry: false };
  return { kind: "error", message: GENERIC, retry: true };
}
