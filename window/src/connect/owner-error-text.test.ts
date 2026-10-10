import { describe, expect, it } from "vitest";
import { ownerErrorText } from "./preparation-status";

// The refusal text the owner saw on 2026-10-10, as the engine sends it to the window.
const liveRefusal = new Error(
  'Agent mobile (/Users/owner/.branch/agents/mobile/agent.sqlite): Agent mobile has not completed startup inspection and preparation.\n' +
    'Sessions remain unavailable until background inspection and preparation finish. If they cannot complete, stop the Gateway, run "branch doctor --fix", and restart.',
);
const banned = /branch doctor|gateway listener|admission|stop the gateway/i;

describe("ownerErrorText", () => {
  it("turns a starting agent's refusal into one plain line with no repair steps", () => {
    const text = ownerErrorText(liveRefusal);
    expect(text).toBe("Mobile is still starting up");
    expect(text).not.toMatch(banned);
  });

  it("keeps ordinary engine messages and drops only the final period", () => {
    expect(ownerErrorText(new Error("Unknown contact."))).toBe("Unknown contact");
    expect(ownerErrorText("Mobile is still starting up.")).toBe("Mobile is still starting up");
  });
});
