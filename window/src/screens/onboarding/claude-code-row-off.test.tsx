// @vitest-environment jsdom
// The first-run Your models step reads each row's own switch. A Claude Code row the person switches off says it can be
// turned on, not "On because ...", which would sit next to an off switch.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Models } from "./Models";
import type { Hello } from "./model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const METHODS = ["models.authStatus", "models.list", "branch.setup.detect", "branch.setup.verify", "branch.setup.activate", "agents.list", "trunks.template.starters"];
const ON = "On because Claude Code is connected on this computer.";
const OFF = "Claude Code is connected on this computer. Turn it on to use its models.";

/** Claude Code found on this computer, with its models listed for chats. */
function engine() {
  const claude = { kind: "claude-cli", modelRef: "claude-cli/claude-opus-5-5", label: "Claude Code", detail: "installed; login status unverified" };
  const models = [{ id: "claude-opus-5-5", provider: "claude-cli", name: "Claude Opus 5.5", local: false, available: true, input: ["text"] }];
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "branch.setup.detect") return { candidates: [claude], unavailableCandidates: [] };
    if (method === "models.list") return { models };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Main" }] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
function Step({ engine }: { engine: WindowEngine }) {
  const [hello, setHello] = useState<Hello>(null);
  const [off, setOff] = useState<string[]>([]);
  return <Models engine={engine} off={off} onOff={setOff} hello={hello} onHello={setHello} />;
}
const row = (): HTMLElement => {
  const r = [...host.querySelectorAll<HTMLElement>(".r1-ob-row")].find((x) => x.textContent?.includes("Claude Code"));
  expect(r).toBeDefined();
  return r!;
};

describe("first-run Your models step: a switched-off Claude Code row", () => {
  it("reads On while the switch is on, and offers to turn it on once switched off", async () => {
    const e = engine();
    await act(async () => root.render(<CapabilityProvider engine={e}><Step engine={e} /></CapabilityProvider>));
    await settle();
    const sw = row().querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(row().textContent).toContain(ON);

    await act(async () => sw.click());
    await settle();
    expect(row().querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(row().textContent).toContain(OFF);
    expect(row().textContent).not.toContain(ON);

    await act(async () => row().querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await settle();
    expect(row().textContent).toContain(ON);
  });
});
