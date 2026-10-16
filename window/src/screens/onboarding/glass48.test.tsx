// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Onboarding } from "./Onboarding";

/* Preview v17 (tinted liquid glass): setup is its own window. Its layer and card are tinted glass over the app, its text sits
   straight on the card with no pill, and its controls keep their chips. A dialog it opens (Add an account, Where Branch runs)
   is a tinted card over its scrim with the same rule for its text. The menus, toasts, walkthrough and side panels stay clear. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const css = readFileSync("src/screens/onboarding/onboarding.css", "utf8");
const glass = readFileSync("src/glass/glass.css", "utf8");
const ALL = ["branch.setup.detect", "branch.setup.verify", "branch.setup.activate", "models.authStatus", "config.get", "config.patch", "trunks.template.list", "trunks.template.create", "agents.list", "chat.send"];
const DETECT = { candidates: [{ kind: "claude-cli", modelRef: "anthropic/claude-opus", label: "Claude", detail: "Max", credentials: true }] };
const ANSWERS: Record<string, unknown> = {
  "branch.setup.detect": DETECT,
  "models.authStatus": { providers: [], providerCapabilities: [{ provider: "openai", apiKeySupported: true, loginOptions: [{ id: "openai-codex", kind: "oauth", groupLabel: "ChatGPT" }] }] },
  "trunks.template.list": { templates: [{ id: "spend-saver", name: "Spend Saver", description: "" }] },
  "agents.list": { defaultId: "sapling", mainKey: "main", agents: [{ id: "sapling", identity: { name: "Sapling" } }] },
  "config.get": { hash: "h", valid: true, config: {} },
};
function engineOf() {
  const request = vi.fn(async (method: string) => ANSWERS[method] ?? {});
  return { request, onEvent: () => () => {}, sessionKey: null, agentId: "main", scopes: ["operator.admin"], features: { methods: ALL, events: [] } } as unknown as WindowEngine;
}
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
async function show(startAt: number) {
  const engine = engineOf();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}><Onboarding engine={engine} startAt={startAt} onLater={() => {}} /></CapabilityProvider>));
  await flush();
  return host;
}
/** Text that sits on a pill (a .g-label or .g-frost). The setup window's text must not. */
const pillsIn = (scope: Element) => [...scope.querySelectorAll(".g-label, .g-frost")].map((el) => el.tagName.toLowerCase() + "." + el.className);

describe("onboarding window follows preview v17", () => {
  it("draws every step and the Where sheet on the tinted window, with no pill on its text", async () => {
    expect(css).not.toMatch(/var\(--g[cfk]-/);
    for (const step of [0, 1, 2, 3]) {
      const host = await show(step);
      expect(host.querySelector(".r1-ob-card"), `step ${step}`).not.toBeNull();
      expect(pillsIn(host), `step ${step}`).toEqual([]);
      if (step === 0) {
        await act(async () => button(host, "Change").click());
        const sheet = host.querySelector(".r1-ob-sheet")!;
        expect(sheet).not.toBeNull();
        expect(pillsIn(sheet)).toEqual([]);
      }
      await act(async () => root!.unmount()); root = undefined; host.remove();
    }
  });

  it("opens Add an account from Your models as a tinted dialog over its scrim, with its text off any pill", async () => {
    const host = await show(1);
    await act(async () => button(host, "Add another").click());
    await flush();
    const dlg = document.querySelector('[data-testid="add-account"]')!;
    expect(dlg).not.toBeNull();
    expect(dlg.classList).toContain("g-clear");
    expect(host.contains(dlg), "draws over the whole window, not inside the card's faded body").toBe(false);
    expect(css.replace(/\s+/g, " ")).toContain("body:has(> .r1-ob-dlg) .r1-ob > .r1-ob-card { visibility: hidden; }");
    expect(dlg.querySelector(".dlg-h h2")!.classList).toContain("g-label");
    expect(dlg.textContent).toContain("Which service is the new account with?");
    const primaries = [...dlg.querySelectorAll("button.pri, button.primary")];
    expect(primaries.map((b) => b.textContent)).toContain("Test and use");
    for (const b of primaries) expect(b.hasAttribute("data-solid"), b.textContent!).toBe(true);
    await act(async () => [...dlg.querySelectorAll<HTMLButtonElement>("button.prov")].find((b) => b.textContent?.includes("ChatGPT") && !b.textContent.includes("key"))!.click());
    await flush();
    expect(dlg.textContent).toContain("own sign-in page");
  });

  it("tints a clear dialog's card like preview v17 and drops its text lines' pills, while controls keep theirs", () => {
    const flat = glass.replace(/\s+/g, " ");
    expect(flat).toContain(".scrim > .dlg.g-clear:not(#g48) { background: color-mix(in srgb, var(--bg) 74%, transparent);");
    expect(flat).toContain(".scrim > .dlg.g-clear :is(.g-label, .g-label[data-lines]):not(#g48) { width: auto; max-width: none; padding: 0; border-radius: 0; background: none; box-shadow: none;");
    expect(flat).toContain(":root[data-transparency=\"reduce\"] .scrim > .dlg.g-clear:not(#g48#g48)");
  });
});
