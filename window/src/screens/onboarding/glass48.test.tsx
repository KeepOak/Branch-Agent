// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Onboarding } from "./Onboarding";

/* README item 48 (owner, final): only the left sidebar is frosted. Onboarding's layer, card and Where sheet are clear, and the
   Add an account dialog it opens from Your models is a clear dialog too. Every heading, line of text and control on them sits
   on a small frosted pill with a 1px outline: onboarding.css's own frosted-pill rule, the shared .g-label / .g-frost, a control
   inside .g-clear, or the one solid primary button. No earlier frosted fill (--gc, --gf, --gk) is left in onboarding.css. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const css = readFileSync("src/screens/onboarding/onboarding.css", "utf8");
const FROST = css.match(/\/\* The frost[^*]*\*\/\s*([^{]+)\{/)![1].replace(/\s+/g, " ").trim().replace(/^:is\(/, "").replace(/\)\s*$/, "").split(/,(?![^(]*\))/).map((s) => s.trim());
const PILL = [".g-label", ".g-frost", "[data-solid]", ".r1-ob-pri", ...FROST].join(", ");
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
/** Text that sits straight on a clear surface instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of scope.querySelectorAll("*")) {
    if (el.closest("svg, script, style, [aria-hidden=true]")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    const pill = el.closest(PILL);
    const control = el.closest("button, a[href], select, textarea, input");
    if (!pill && !(control && control.closest(".g-clear"))) bare.push("<" + el.tagName.toLowerCase() + ' class="' + el.className + '"> ' + el.textContent!.trim().slice(0, 48));
  }
  return bare;
}

describe("onboarding follows the item 48 glass model", () => {
  it("draws every step and the Where sheet from the shared pill only: every line on a pill, no earlier frosted fill", async () => {
    // The dots and the model switches drew the earlier control glass (--gk-track, --gk-sh-thumb, --gf-edge).
    expect(css).not.toMatch(/var\(--g[cfk]-/);
    for (const step of [0, 1, 2, 3]) {
      const host = await show(step);
      expect(host.querySelector(".r1-ob-card"), `step ${step}`).not.toBeNull();
      expect(bareText(host), `step ${step}`).toEqual([]);
      if (step === 0) {
        await act(async () => button(host, "Change").click());
        const sheet = host.querySelector(".r1-ob-sheet")!;
        expect(sheet).not.toBeNull();
        expect(bareText(sheet)).toEqual([]);
      }
      await act(async () => root!.unmount()); root = undefined; host.remove();
    }
  });

  it("opens Add an account from Your models as a clear dialog with its words on pills", async () => {
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
    expect(bareText(dlg)).toEqual([]);
    const primaries = [...dlg.querySelectorAll("button.pri, button.primary")];
    expect(primaries.map((b) => b.textContent)).toContain("Test and use");
    for (const b of primaries) expect(b.hasAttribute("data-solid"), b.textContent!).toBe(true);
    await act(async () => [...dlg.querySelectorAll<HTMLButtonElement>("button.prov")].find((b) => b.textContent?.includes("ChatGPT") && !b.textContent.includes("key"))!.click());
    await flush();
    expect(dlg.textContent).toContain("own sign-in page");
    expect(bareText(dlg)).toEqual([]);
  });
});
