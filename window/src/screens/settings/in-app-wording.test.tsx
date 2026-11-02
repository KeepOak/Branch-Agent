// @vitest-environment jsdom
// Inside the Branch desktop app, Settings never tells the person to go to the Branch app: Updates drops "Runs in the
// Branch app on your computer." and its kin, and desktop rows say "Not checked yet · Check now" / "Checking..." /
// "Saved earlier · Check again" instead of "Check with the app". In a browser, Updates keeps the old lines.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopControlsBridge, DesktopControlsState } from "../../connect/desktop-controls";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { UpdatesBlock, UpdatesPage } from "../../places/settings/set2/updates";
import { writeOwnDesktopState } from "./desktop-own-state";
import { startingUpRows } from "./pages/general";
import { RowView } from "./RowView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEND_TO_APP = /in the Branch app|from the Branch app|Branch app on your computer|Check with the app|Checking with the app|Last seen by Branch/;
const off: DesktopControlsState = { keepWorking: false, keepAwake: false, trayUsage: false, autoApplyUpdates: false, startWithWindows: false, branchOnPath: false };

let host: HTMLDivElement;
let root: Root;

function engineAt(gatewayUrl: string): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    return {};
  });
  return { gatewayUrl, request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin", "operator.write"] } as unknown as WindowEngine;
}
function setDesktop(gatewayUrl: string, get: () => Promise<DesktopControlsState>) {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl, controls: { get, set: vi.fn(async () => off) } as unknown as DesktopControlsBridge };
}
async function flush() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
/** Every word a person can meet on the page: its text and its tooltips. */
function words(): string {
  const titles = [...host.querySelectorAll("[title]")].map((el) => el.getAttribute("title") ?? "");
  return [host.textContent ?? "", ...titles].join("\n");
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
  forgetLookStore();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  forgetLookStore();
  localStorage.clear();
});

describe("Settings > Updates inside the Branch app", () => {
  it("never says the page runs in the Branch app on your computer", async () => {
    const engine = engineAt("ws://127.0.0.1:18789/");
    setDesktop("ws://127.0.0.1:18789/", async () => off);
    await act(async () => root.render(<>
      {(["devices", "about", "remove"] as const).map((part) => <UpdatesBlock key={part} page="updates" title="Updates" level="advanced" engine={engine} part={part} />)}
    </>));
    await flush();
    expect(host.textContent).toContain("Branch on your other devices");
    expect(words()).not.toMatch(SEND_TO_APP);
  });

  it("connected to another computer's engine, Help and updates names where Repair runs without sending you to the app", async () => {
    const engine = engineAt("ws://10.0.0.5:18789/");
    setDesktop("ws://127.0.0.1:18789/", async () => off);
    await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="advanced" engine={engine} />));
    await flush();
    expect(host.textContent).toContain("The engine");
    expect(words()).not.toMatch(SEND_TO_APP);
  });

  it("in a browser, the page still says these run in the Branch app on your computer", async () => {
    const engine = engineAt("ws://10.0.0.5:18789/");
    await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="advanced" engine={engine} />));
    await flush();
    expect(words()).toContain("Runs in the Branch app on your computer.");
  });
});

describe("Settings desktop rows inside the Branch app", () => {
  const rows = startingUpRows("macOS").filter((row) => row.level === 0);

  it("say Not checked yet with a Check now link, then Checking..., never Check with the app", async () => {
    let finish!: () => void;
    const get = vi.fn(() => new Promise<DesktopControlsState>((done) => { finish = () => done(off); }));
    setDesktop("ws://127.0.0.1:18789/", get);
    await act(async () => root.render(<>{rows.map((row) => <RowView key={row.id} engine={engineAt("ws://127.0.0.1:18789/")} row={row} />)}</>));
    await flush();
    const el = document.getElementById("row-general.start.with-computer")!;
    expect(el.textContent).toContain("Not checked yet");
    expect(words()).not.toMatch(SEND_TO_APP);
    const check = [...el.querySelectorAll("button")].find((b) => b.textContent === "Check now")!;
    expect(check).toBeTruthy();
    await act(async () => { check.click(); });
    expect(el.textContent).toContain("Checking...");
    expect(words()).not.toMatch(SEND_TO_APP);
    await act(async () => { finish(); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(el.textContent).not.toContain("Not checked yet");
  });

  it("say Saved earlier with a Check again link for a stored value, never Last seen by Branch", async () => {
    writeOwnDesktopState({ ...off, startWithWindows: true });
    const get = vi.fn(async () => off);
    setDesktop("ws://127.0.0.1:18789/", get);
    await act(async () => root.render(<>{rows.map((row) => <RowView key={row.id} engine={engineAt("ws://127.0.0.1:18789/")} row={row} />)}</>));
    await flush();
    const el = document.getElementById("row-general.start.with-computer")!;
    expect(el.textContent).toContain("Saved earlier");
    expect(words()).not.toMatch(SEND_TO_APP);
    const again = [...el.querySelectorAll("button")].find((b) => b.textContent === "Check again")!;
    expect(again.className).toBe("r1s-link");
    await act(async () => { again.click(); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(el.textContent).not.toContain("Saved earlier");
  });
});
