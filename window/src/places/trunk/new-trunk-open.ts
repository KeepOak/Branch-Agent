// After + › New Trunk made the Trunk: its first conversation opens, or one plain message says it couldn't (#479).
// The sheet has closed by then: the Trunk exists, so a second Create could only fail. The message's Try again
// waits for the Trunk and opens its conversation again, without making another Trunk.
import { notify } from "../../shell/notify";

export type NewTrunkOpenSteps = {
  /** Resolves once the gateway lists the new Trunk. */
  ready: () => Promise<void>;
  /** Its first conversation's key, or null when it could not open. Says nothing itself. */
  open: () => Promise<string | null>;
  /** Shows the opened conversation. */
  show: (sessionKey: string) => void;
  /** Shows the new Trunk's own page when its conversation could not open, so the person lands on what they made. */
  showTrunk?: () => void;
};

/** What the person reads when the Trunk was made but its conversation did not open. */
export function newTrunkOpenFailedLine(name: string): string {
  const shown = name.trim() || "Your new Trunk";
  return (shown === "Your new Trunk" ? shown : "“" + shown + "”") + " is ready, but its conversation couldn’t open.";
}

/** Opens the new Trunk's first conversation. On failure: one message with Try again, never a second create. */
export async function openNewTrunkConversation(name: string, steps: NewTrunkOpenSteps): Promise<boolean> {
  let key: string | null = null;
  try {
    await steps.ready();
    key = await steps.open();
  } catch {
    key = null;
  }
  if (key) {
    steps.show(key);
    return true;
  }
  steps.showTrunk?.();
  notify(newTrunkOpenFailedLine(name), {
    tone: "bad",
    keep: true,
    line: steps.showTrunk ? "Its page is open. Try again to start its conversation." : "It’s in your Trunks list. Try again, or open it from there.",
    action: { label: "Try again", run: () => void openNewTrunkConversation(name, steps) },
  });
  return false;
}
