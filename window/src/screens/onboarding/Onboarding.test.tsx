// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { undeclaredControls } from "../../glass/coming-registry";
import { readDetected } from "../../setup/setup-model";
import { readFileSync } from "node:fs";
import { answeredBy, canSayHello, freshState, MODES, picked, primary, STEPS, suggest, togglePick } from "./model";
import { Onboarding } from "./Onboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const ALL = ["branch.setup.detect", "branch.setup.verify", "branch.setup.activate", "models.authStatus", "config.get", "config.patch", "trunks.template.list", "trunks.template.create", "agents.list", "chat.send"];
type Answers = Record<string, unknown | ((params: unknown) => unknown)>;
function fakeEngine(answers: Answers, methods = ALL) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    return typeof a === "function" ? (a as (p: unknown) => unknown)(params) : a;
  });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, agentId: "main", scopes: [], features: { methods, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
async function show(engine: WindowEngine, props: Partial<Parameters<typeof Onboarding>[0]> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const onLater = vi.fn(), onAnswered = vi.fn(), onDone = vi.fn();
  await act(async () => root!.render(<CapabilityProvider engine={engine}><Onboarding engine={engine} onLater={onLater} onAnswered={onAnswered} onDone={onDone} {...props} /></CapabilityProvider>));
  await flush();
  return { host, onLater, onAnswered, onDone };
}
const DETECT = { candidates: [{ kind: "claude-cli", modelRef: "anthropic/claude-opus", label: "Claude", detail: "Max", credentials: true }, { kind: "codex-cli", modelRef: "openai/gpt", label: "ChatGPT", detail: "Plus", credentials: true }] };

describe("onboarding model", () => {
  it("has the four approved steps and the four modes, Ask first recommended and no Full access", () => {
    expect(STEPS.map((s) => s.name)).toEqual(["Welcome", "Your models", "How much it may do", "Your first Trunk"]);
    expect(MODES.map((m) => [m.name, m.exec, m.recommended])).toEqual([["Ask first", "ask", true], ["Auto", "auto", false], ["Plan first", null, false], ["Read only", "deny", false]]);
    expect(MODES.every((m) => m.line.length > 0)).toBe(true);
    expect(freshState().mode).toBe("ask");
  });
  it("holds Continue on Your models until a hello worked", () => {
    expect(primary({ ...freshState(1) })).toMatchObject({ ok: false, why: "Say hello first." });
    expect(primary({ ...freshState(1), hello: "busy" }).ok).toBe(false);
    expect(primary({ ...freshState(1), hello: { ok: false, error: "x" } }).ok).toBe(false);
    expect(primary({ ...freshState(1), hello: { ok: true, seconds: "1.4", modelRef: "m" } }).ok).toBe(true);
    expect(primary(freshState(0)).label).toBe("Get started");
  });
  it("names the model that answered from the detected rows", () => {
    const d = readDetected(DETECT);
    expect(answeredBy(d, "anthropic/claude-opus")).toBe("Claude");
    expect(answeredBy(d, "x/y")).toBe("x/y");
    expect(canSayHello(d, [])).toBe(true);
    expect(canSayHello(d, d.candidates.map((c) => c.key))).toBe(false);
    expect(canSayHello(null, [])).toBe(false);
  });
});

describe("Onboarding", () => {
  it("opens at Welcome with the promise, no tick box, and Esc is Set up later", async () => {
    const { engine } = fakeEngine({});
    const { host, onLater } = await show(engine);
    expect(host.querySelector("h1")?.textContent).toBe("Hi, I’m Branch.");
    expect(host.textContent).toContain("It asks before it sends, deletes, spends or installs anything.");
    expect(host.querySelector("input[type=checkbox]")).toBeNull();
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("1");
    expect(button(host, "Set up by talking").getAttribute("aria-disabled")).toBe("true");
    await act(async () => void host.querySelector(".r1-ob")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onLater).toHaveBeenCalledOnce();
  });

  it("offers only this computer in Where Branch runs; the others are Coming", async () => {
    const { engine } = fakeEngine({});
    const { host } = await show(engine);
    await act(async () => button(host, "Change").click());
    const radios = [...host.querySelectorAll(".r1-ob-sheet [role=radio]")] as HTMLButtonElement[];
    expect(radios.map((r) => r.getAttribute("aria-disabled"))).toEqual([null, "true", "true"]);
    await act(async () => radios[1].click());
    expect(host.querySelector(".r1-ob-sheet")).not.toBeNull();
    await act(async () => button(host, "Done").click());
    expect(host.textContent).toContain("Runs on this computer");
  });

  it("says hello with a real model call and only then lets you continue", async () => {
    const { engine, request } = fakeEngine({ "branch.setup.detect": DETECT, "branch.setup.activate": { ok: true, modelRef: "anthropic/claude-opus", latencyMs: 1400 } });
    const { host } = await show(engine);
    await act(async () => button(host, "Get started").click());
    await flush();
    expect(calls(request, "branch.setup.detect")).toEqual([{ agentId: "main" }]);
    expect([...host.querySelectorAll(".r1-ob-row b")].map((b) => b.textContent)).toEqual(["Claude", "ChatGPT"]);
    expect(button(host, "Continue").getAttribute("aria-disabled")).toBe("true");
    await act(async () => button(host, "Continue").click());
    expect(host.querySelector("h1")?.textContent).toBe("Your models");
    await act(async () => button(host, "Say hello").click());
    await flush();
    expect(calls(request, "branch.setup.activate")).toEqual([{ agentId: "main", kind: "claude-cli", modelRef: "anthropic/claude-opus" }]);
    expect(host.querySelector(".r1-ob-hello")?.textContent).toContain("Claude answered in 1.4 s");
    expect(button(host, "Continue").getAttribute("aria-disabled")).toBeNull();
    await act(async () => button(host, "Continue").click());
    expect(host.querySelector("h1")?.textContent).toBe("How much may it do?");
  });

  it("shows the real failure with Try again and Use another model, and keeps Continue held", async () => {
    const { engine } = fakeEngine({ "branch.setup.detect": DETECT, "branch.setup.activate": { ok: false, error: "401 unauthorized token" } });
    const { host } = await show(engine, { startAt: 1 });
    await act(async () => button(host, "Say hello").click());
    await flush();
    expect(host.querySelector(".r1-ob-hello")?.textContent).toContain("Sign in to the model account again.");
    expect(button(host, "Try again")).toBeTruthy();
    expect(button(host, "Use another model")).toBeTruthy();
    expect(button(host, "Continue").getAttribute("aria-disabled")).toBe("true");
  });

  it("says when no model is on this computer and offers Add one; examples are Coming", async () => {
    const { engine } = fakeEngine({ "branch.setup.detect": { candidates: [] } });
    const { host } = await show(engine, { startAt: 1 });
    expect(host.textContent).toContain("No models on this computer yet.");
    expect(button(host, "Add one")).toBeTruthy();
    expect(button(host, "Say hello")).toBeUndefined();
    expect(button(host, "Try it with examples").getAttribute("aria-disabled")).toBe("true");
  });

  it("saves Ask first as tools.exec.mode and never offers Full access; Plan first is Coming", async () => {
    const { engine, request } = fakeEngine({ "config.get": { hash: "h1", valid: true, config: {} }, "config.patch": { ok: true } });
    const { host, onAnswered } = await show(engine, { startAt: 2 });
    const radios = [...host.querySelectorAll("[role=radio]")] as HTMLButtonElement[];
    expect(radios.map((r) => r.textContent)).toEqual(["Ask firstRecommended" + MODES[0].line, "Auto" + MODES[1].line, "Plan first" + MODES[2].line, "Read only" + MODES[3].line]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector(".r1-ob-hint")?.textContent).toBe("Change it any time in Settings › Permissions. Full access lives there too, one click away.");
    expect(radios.some((r) => r.textContent?.startsWith("Full access"))).toBe(false);
    expect(radios[2].getAttribute("aria-disabled")).toBe("true");
    await act(async () => button(host, "Continue").click());
    await flush();
    expect(calls(request, "config.patch")).toEqual([{ raw: JSON.stringify({ tools: { exec: { mode: "ask", security: null, ask: null } } }), baseHash: "h1" }]);
    expect(onAnswered).toHaveBeenCalledWith(expect.objectContaining({ mode: "ask" }));
  });

  it("stays on the step with the engine's words when the mode doesn't save", async () => {
    const { engine } = fakeEngine({ "config.get": { hash: "h1", valid: true, config: {} }, "config.patch": new Error("config locked") });
    const { host, onAnswered } = await show(engine, { startAt: 2 });
    await act(async () => button(host, "Continue").click());
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("config locked");
    expect(onAnswered).not.toHaveBeenCalled();
  });

  it("declares every control: wired through the engine, local, or Coming", async () => {
    const { engine } = fakeEngine({ "branch.setup.detect": DETECT, "config.get": { hash: "h", config: {} } }, []);
    for (const step of [0, 1, 2, 3]) {
      const { host } = await show(engine, { startAt: step });
      expect(undeclaredControls(host).map((e) => e.textContent)).toEqual([]);
      await act(async () => root!.unmount()); root = undefined; host.remove();
    }
  });
});

const LISTED = { templates: [{ id: "trunk-doctor", name: "Trunk Doctor", description: "" }, { id: "mention-monitor", name: "Mentions Watch", description: "" }, { id: "spend-saver", name: "Spend Saver", description: "" }, { id: "home-desk", name: "Home Desk", description: "" }] };
const AGENTS = { defaultId: "sapling", mainKey: "main", agents: [{ id: "sapling", identity: { name: "Sapling" } }] };
const textarea = (host: HTMLElement) => host.querySelector("textarea.r1-ob-text") as HTMLTextAreaElement;
async function type(host: HTMLElement, value: string) {
  const box = textarea(host);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setter.call(box, value); box.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Your first Trunk (step 4)", () => {
  it("suggests 1–3 day-one templates from a sentence, in the templates' order", () => {
    expect(suggest("")).toEqual([]);
    expect(suggest("I chase receipts and invoices, and my inbox is a mess").map((x) => x.template.name)).toEqual(["Spend Saver"]);
    expect(suggest("my kids' school, our household bills and a product launch").map((x) => x.template.name)).toEqual(["Home Desk", "Project Lead", "Spend Saver"]);
    const s = { text: "receipts", pick: [] as string[], tpl: [] as string[] };
    const a = togglePick(s, "spend-saver");
    expect(a).toEqual({ pick: ["spend-saver"], tpl: [] });
    const b = togglePick({ ...s, ...a }, "home-desk");
    expect(picked(b)).toEqual(["spend-saver", "home-desk"]);
    expect(togglePick({ ...s, ...b }, "spend-saver")).toEqual({ pick: [], tpl: ["home-desk"] });
    expect(primary({ ...freshState(3) }, "Sapling").label).toBe("Start with Sapling");
    expect(primary({ ...freshState(3), tpl: ["home-desk"] }, "Sapling").label).toBe("Meet them");
  });

  it("opens after How much it may do saves, with the eight templates; ones this engine lacks are Coming", async () => {
    const { engine } = fakeEngine({ "config.get": { hash: "h1", valid: true, config: {} }, "config.patch": { ok: true }, "trunks.template.list": LISTED, "agents.list": AGENTS });
    const { host } = await show(engine, { startAt: 2 });
    await act(async () => button(host, "Continue").click());
    await flush();
    expect(host.querySelector("h1")?.textContent).toBe("Your first Trunk");
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("4");
    const chips = [...host.querySelectorAll(".r1-ob-chip")] as HTMLButtonElement[];
    expect(chips.map((b) => b.textContent)).toEqual(["Trunk Doctor", "Mentions Watch", "Home Desk", "Project Lead", "Prospect Finder", "Search Brief Desk", "Spend Saver", "Hiring Desk"]);
    expect(chips.map((b) => b.getAttribute("aria-disabled"))).toEqual([null, null, null, "true", "true", "true", null, "true"]);
    expect(chips[3].title).toBe("Project Lead arrives in a later update.");
    expect(host.querySelector(".r1-ob-sap")?.textContent).toBe("Sapling stays your default Trunk, with the leaf.");
    expect(button(host, "Start with Sapling")).toBeTruthy();
    expect(host.querySelector(".r1-ob-sug")?.textContent).toBe("Type a sentence and Branch suggests 1–3 Trunks.");
  });

  it("Meet them creates the picked Trunks with the first-run contract, records setup and greets in the first one", async () => {
    const { engine, request } = fakeEngine({
      "trunks.template.list": LISTED, "agents.list": AGENTS, "config.get": { hash: "h1", valid: true, config: {} }, "config.patch": { ok: true }, "chat.send": { runId: "r1" },
      "trunks.template.create": (params: unknown) => ({ agentId: (params as { templateId: string }).templateId + "-1", name: "Made" }),
    });
    const { host, onDone } = await show(engine, { startAt: 3 });
    await type(host, "I chase receipts and invoices");
    expect([...host.querySelectorAll(".r1-ob-pick b")].map((b) => b.textContent)).toEqual(["Spend Saver"]);
    await act(async () => (host.querySelector(".r1-ob-pick") as HTMLButtonElement).click());
    await act(async () => button(host, "Home Desk").click());
    expect(host.querySelector(".r1-ob-pick")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button(host, "Meet them").click());
    await flush();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(calls(request, "trunks.template.create")).toEqual([{ templateId: "spend-saver", timezone: zone }, { templateId: "home-desk", timezone: zone }]);
    const patch = JSON.parse((calls(request, "config.patch")[0] as { raw: string }).raw);
    expect(patch.wizard.lastRunAt).toEqual(expect.any(String));
    expect(calls(request, "chat.send")).toEqual([expect.objectContaining({ sessionKey: "agent:spend-saver-1:main", message: expect.stringContaining("ask what to call me") })]);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: "agent:spend-saver-1:main", made: [expect.objectContaining({ agentId: "spend-saver-1" }), expect.objectContaining({ agentId: "home-desk-1" })] }));
  });

  it("stays on step 4 with the engine's words when a Trunk can't be made, and never makes one twice", async () => {
    let fail = true;
    const { engine, request } = fakeEngine({
      "trunks.template.list": LISTED, "agents.list": AGENTS, "config.get": { hash: "h1", valid: true, config: {} }, "config.patch": { ok: true }, "chat.send": {},
      "trunks.template.create": (params: unknown) => { const id = (params as { templateId: string }).templateId; if (id === "home-desk" && fail) throw new Error("disk full"); return { agentId: id + "-1" }; },
    });
    const { host, onDone } = await show(engine, { startAt: 3 });
    await act(async () => button(host, "Spend Saver").click());
    await act(async () => button(host, "Home Desk").click());
    await act(async () => button(host, "Meet them").click());
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toBe("Couldn’t make Home Desk. disk full");
    expect(host.querySelector("h1")?.textContent).toBe("Your first Trunk");
    expect(onDone).not.toHaveBeenCalled();
    expect(calls(request, "chat.send")).toEqual([]);
    fail = false;
    await act(async () => button(host, "Meet them").click());
    await flush();
    expect(calls(request, "trunks.template.create").map((p) => (p as { templateId: string }).templateId)).toEqual(["spend-saver", "home-desk", "home-desk"]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("Start with the default Trunk makes nothing and greets in its main conversation", async () => {
    const { engine, request } = fakeEngine({ "trunks.template.list": LISTED, "agents.list": AGENTS, "config.get": { hash: "h1", valid: true, config: {} }, "config.patch": { ok: true }, "chat.send": {} });
    const { host, onDone } = await show(engine, { startAt: 3 });
    await act(async () => button(host, "Start with Sapling").click());
    await flush();
    expect(calls(request, "trunks.template.create")).toEqual([]);
    expect(calls(request, "chat.send")).toEqual([expect.objectContaining({ sessionKey: "agent:sapling:main" })]);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: "agent:sapling:main", made: [] }));
  });
});

describe("onboarding glass model (README item 48)", () => {
  const css = readFileSync("src/screens/onboarding/onboarding.css", "utf8");
  const rule = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
  it("keeps the layer and the card clear, puts text and controls on 1px-outlined frosted pills, and hides the card under a sheet", () => {
    expect(rule(".r1-ob {")).toContain("background: transparent");
    expect(rule(".r1-ob {")).not.toContain("backdrop-filter");
    expect(rule("  background: transparent; box-shadow: none;")).not.toContain("backdrop-filter");
    expect(css).toContain("background: var(--gp-fill); -webkit-backdrop-filter: var(--gp-blur); backdrop-filter: var(--gp-blur); box-shadow: inset 0 0 0 1px var(--gp-edge)");
    for (const piece of [".r1-ob-body h1", ".r1-ob-lede", ".r1-ob-hint", ".r1-ob-pick", ".r1-ob-chip", ".r1-ob-text", ".r1-ob-row", ".r1-ob-mode"]) expect(css.slice(0, css.indexOf("background: var(--gp-fill)"))).toContain(piece);
    expect(css).toContain(".r1-ob[data-sheet] > .r1-ob-card { visibility: hidden; }");
    expect(css).not.toMatch(/border-(top|bottom):\s*1px/);
  });
});
