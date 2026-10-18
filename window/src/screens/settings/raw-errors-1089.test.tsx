// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): Settings › Your card, Who uses Branch and Updates showed
// "Couldn’t read: unknown method: logbook.status", and Chat apps showed the engine's raw error above Try again.
// The shared bad Status box and the Chat apps failure line now read plain at Regular; Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Status } from "../../places/settings/kit";
import { Alert } from "../chatapps/parts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const RAW = /unknown method|logbook\.status|ECONNREFUSED|127\.0\.0\.1|EACCES|\/home\/|\/opt\/|[A-Z][a-z]+Error\b|:\d+:\d+/;
let root: Root; let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
const show = async (node: React.ReactNode) => { await act(async () => root.render(<>{node}</>)); return host.textContent ?? ""; };

describe("Settings never shows a raw engine error at Regular (Private #1089)", () => {
  it.each([
    "unknown method: logbook.status",
    "connect ECONNREFUSED 127.0.0.1:18789",
    "EACCES: permission denied, mkdir '/opt/branch/plugins'",
    "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
  ])("Couldn’t read: %j", async (raw) => {
    const text = await show(<Status tone="bad" title={`Couldn’t read: ${raw}`} />);
    expect(text).not.toMatch(RAW);
    expect(text.startsWith("Couldn’t read.")).toBe(true);
  });

  it("the gateway box keeps its own plain sentence beside the engine's words", async () => {
    const text = await show(<Status tone="bad" title="The gateway isn’t answering">{"connect ECONNREFUSED 127.0.0.1:18789"} Branch keeps trying.</Status>);
    expect(text).not.toMatch(RAW);
    expect(text).toContain("Branch keeps trying.");
  });

  it("Chat apps' failure line", async () => {
    expect(await show(<Alert text={'unknown agent id "main"'} />)).toBe("That Trunk isn’t on this computer. Choose another Trunk.");
    expect(await show(<Alert text="connect ECONNREFUSED 127.0.0.1:18789" />)).not.toMatch(RAW);
  });

  it("an ok status and plain words are untouched", async () => {
    expect(await show(<Status title="Saved at 12:30" />)).toBe("Saved at 12:30");
    expect(await show(<Status tone="bad" title="Couldn’t save. Try again." />)).toBe("Couldn’t save. Try again.");
  });

  it.each(["advanced", "technical"])("%s keeps the exact words", async (level) => {
    localStorage.setItem("branch.level", level);
    expect(await show(<Status tone="bad" title="Couldn’t read: unknown method: logbook.status" />)).toBe("Couldn’t read: unknown method: logbook.status");
    expect(await show(<Alert text="connect ECONNREFUSED 127.0.0.1:18789" />)).toBe("connect ECONNREFUSED 127.0.0.1:18789");
  });
});
