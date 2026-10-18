// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { color } from "../../glass/tokens";
import { ChatApps } from "./ChatApps";
import { Manage } from "./Manage";
import { SetupWizard } from "./SetupWizard";
import { WhatsAppSetup } from "./WhatsAppSetup";
import { CHAT_APPS } from "./catalogue";
vi.mock("../../theme/tokens.css?raw", async () => ({ default: (await import("node:fs")).readFileSync("src/theme/tokens.css", "utf8") }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/* README item 48 (owner, final): only the left sidebar is frosted. The Chat apps page, its panel, the setup wizard and the Manage
   dialog are clear glass (.g-clear); every piece of text and every control on them sits on a frosted pill with a 1px outline
   (.g-label, .g-frost, or a control inside .g-clear). The earlier frosted looks (g-chip, g-ctl, g-float and the --gc/--gf/--gk
   fills) never come back here. */
const FROSTED = ["g-chip", "g-ctl", "g-float"];
const telegram = CHAT_APPS.find(a => a.id === "telegram")!;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

function engineOf(methods: string[], extra: (method: string) => unknown = () => ({})) {
  const request = vi.fn(async (method: string) => {
    if (method === "channels.status") return { channelAccounts: { telegram: [{ accountId: "main", running: true, configured: true }] } };
    if (method === "channels.pairing.list") return { accounts: [], requests: [{ requestId: "r1", channel: "telegram", accountId: "main", senderLabel: "Ada", channelLabel: "Telegram" }], limits: { ttlMs: 3600000, pendingPerAccount: 3 } };
    if (method === "config.get") return { config: {}, hash: "fixture", valid: true };
    if (method === "agents.list") return { agents: [] };
    return extra(method);
  });
  return { request, sessionKey: null, scopes: ["operator.admin"], onEvent: () => () => {}, features: { methods, events: [] } } as unknown as WindowEngine;
}
async function mount(node: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
/** Text that sits straight on a surface instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of scope.querySelectorAll("*")) {
    if (el.closest("svg, script, style")) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    const pill = el.closest(".g-label, .g-frost, button, a[href], select");
    if (!pill || (!pill.matches(".g-label, .g-frost") && !pill.closest(".g-clear"))) bare.push(`<${el.tagName.toLowerCase()}> ${el.textContent!.trim().slice(0, 48)}`);
  }
  return bare;
}
function frostedClasses(scope: Element) { return FROSTED.flatMap(c => [...scope.querySelectorAll("." + c)].map(() => c)); }

describe("Chat apps follow the item 48 glass model", () => {
  it("draws the page and its panel as clear glass, with every card, heading and line of text on a frosted pill", async () => {
    const engine = engineOf(["channels.status", "channels.pairing.list", "channels.pairing.approve", "channels.pairing.dismiss", "wizard.start", "wizard.next", "wizard.cancel", "config.get", "config.patch"]);
    localStorage.setItem("branch.level", "technical"); // every catalogue card shows at Technical (Private #1093 item 4)
    const host = await mount(<ChatApps engine={engine} onSetup={() => {}} onManage={() => {}} renderAccess={() => <p className="g-label">Access</p>} />);
    expect(host.querySelector(".r1-chatapps")!.classList).toContain("g-clear");
    expect(host.querySelector(".r1-ca-surface")!.classList).toContain("g-clear");
    const cards = [...host.querySelectorAll(".r1-ca-card")];
    expect(cards).toHaveLength(74);
    for (const card of cards) expect(card.classList).toContain("g-frost");
    expect(host.querySelector(".r1-ca-search")!.classList).toContain("g-frost");
    expect(frostedClasses(host)).toEqual([]);
    expect(host.textContent).toContain("Ada");
    expect(bareText(host)).toEqual([]);
  });

  it("opens the setup wizard as a clear dialog: title, steps, text and controls on pills", async () => {
    const engine = engineOf(["channels.pairing.list", "wizard.start", "wizard.next", "wizard.cancel"], method => method === "wizard.start" ? { sessionId: "s", done: false, step: { id: "token", type: "text", title: "Bot token", message: "Paste the token BotFather gave you.", sensitive: true } } : {});
    const host = await mount(<SetupWizard engine={engine} app={telegram} onClose={() => {}} />);
    const dlg = host.querySelector(".dlg")!;
    expect(dlg.classList).toContain("g-clear");
    expect(dlg.querySelector(".dlg-h h2")!.classList).toContain("g-label");
    for (const li of host.querySelectorAll(".r1-cw-steps li")) expect(li.classList).toContain("g-frost");
    expect(frostedClasses(host)).toEqual([]);
    expect(bareText(host)).toEqual([]);
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "I have the details")!.click());
    expect(host.querySelector('input[aria-label="Bot token"]')).not.toBeNull();
    expect(bareText(host)).toEqual([]);
  });

  it("keeps the WhatsApp link step on the same clear dialog", async () => {
    const engine = engineOf(["web.login.start", "web.login.wait"], () => new Promise(() => {}));
    const host = await mount(<WhatsAppSetup engine={engine} app={CHAT_APPS.find(a => a.id === "whatsappweb")!} onClose={() => {}} />);
    expect(host.querySelector(".dlg")!.classList).toContain("g-clear");
    expect(frostedClasses(host)).toEqual([]);
    expect(bareText(host)).toEqual([]);
  });

  it("opens account management as a clear dialog with its rows, choices and actions on pills", async () => {
    const engine = engineOf(["channels.status", "channels.start", "channels.stop", "channels.logout", "config.get", "config.patch", "agents.list"]);
    const host = await mount(<Manage engine={engine} app={telegram} onClose={() => {}} onSetup={() => {}} />);
    expect(host.querySelector(".dlg")!.classList).toContain("g-clear");
    // Telegram is not a linked account, so the row has no Unlink (#1049); Disconnect asks first.
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Disconnect")!.click());
    expect(host.querySelector('[aria-label="Confirm disconnect"]')).not.toBeNull();
    expect(frostedClasses(host)).toEqual([]);
    expect(bareText(host)).toEqual([]);
  });

  it("styles the surfaces with the shared clear and pill classes, never a frosted fill of their own", () => {
    const glass = readFileSync("src/glass/glass.css", "utf8").replace(/\s+/g, " ");
    expect(glass).toContain(".g-clear:not(#g48) { background: transparent; background-image: none; backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none;");
    expect(glass).toMatch(/:is\(\.g-frost, \.g-label\):not\(#g48\), \.g-clear :is\(button, a\[href\], select[^{]*\{ background: var\(--gp-fill\); backdrop-filter: var\(--gp-blur\); -webkit-backdrop-filter: var\(--gp-blur\); box-shadow: inset 0 0 0 1px var\(--gp-edge\);/);
    expect(glass).toContain(':root[data-transparency="reduce"] .g-clear:not(#g48#g48) { background: var(--bg); }');
    const dir = "src/screens/chatapps/";
    for (const file of ["chatapps.css", "wizard.css"]) expect(readFileSync(dir + file, "utf8"), file).not.toMatch(/var\(--(gc|gf|gk)-/);
    for (const file of readdirSync(dir).filter(f => /\.tsx$/.test(f) && !/\.test\./.test(f))) for (const c of FROSTED) expect(readFileSync(dir + file, "utf8"), file).not.toContain(`"${c}"`);
  });

  it("keeps pill ink at 4.5:1 or better over pure white and pure black, light and dark", () => {
    const css = readFileSync("src/theme/tokens.css", "utf8");
    const block = css.slice(css.indexOf("--gp-fill: rgba(255,255,255,.76)"));
    const rgba = (s: string) => s.match(/[\d.]+/g)!.map(Number);
    const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const lin = (v: number) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const lum = (c: number[]) => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
    const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
    const over = (f: number[], base: number[]) => [0, 1, 2].map(k => f[k] * f[3] + base[k] * (1 - f[3]));
    const light = { fill: rgba(block.match(/--gp-fill: (rgba\([^)]+\))/)![1]), ink2: rgba(block.match(/--gp-ink-2: (rgb\([^)]+\))/)![1]), ink: hex(color.light.ink) };
    const darkLine = block.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)![1];
    const dark = { fill: rgba(darkLine.match(/--gp-fill: (rgba\([^)]+\))/)![1]), ink2: rgba(darkLine.match(/--gp-ink-2: (rgb\([^)]+\))/)![1]), ink: hex(color.dark.ink) };
    for (const mode of [light, dark]) for (const base of [[255, 255, 255], [0, 0, 0]]) for (const ink of [mode.ink, mode.ink2]) expect(ratio(ink, over(mode.fill, base))).toBeGreaterThanOrEqual(4.5);
  });
});
