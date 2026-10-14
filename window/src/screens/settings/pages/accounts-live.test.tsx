// @vitest-environment jsdom
// Settings › Accounts in R1 (#976): the page draws every working Classic Accounts control, so the R1 window can open it
// instead of the Classic page. Each control the page draws itself is live against an engine that offers its calls,
// is declared (no undeclared control), and sends the same engine call Classic sends.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "models.authStatus", "models.authOrderSet", "models.probe",
  "models.authLogout", "models.authLogin", "models.authSetApiKey", "models.list", "branch.setup.detect", "usage.status", "users.listModelAccounts", "users.selectModelAccount",
  "users.unlinkAuthProfile", "agents.list", "gateway.identity.get", "tools.github.status", "tools.github.authorize.start", "tools.github.authorize.poll",
  "tools.github.authorize.cancel", "tools.github.configure"];
const STATUS = {
  providers: [{ provider: "openai", displayName: "OpenAI", status: "ok", profileOrder: ["openai:work", "openai:home"], profiles: [
    { profileId: "openai:work", type: "oauth", status: "ok", displayName: "Work", logoutSupported: true },
    { profileId: "openai:home", type: "oauth", status: "cooldown", displayName: "Home", logoutSupported: true },
  ] }],
  providerCapabilities: [{ provider: "google", loginOptions: [{ id: "oauth", featured: true }] }],
};
function engineOf(scopes: string[] = ["operator.admin"]) {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { defaults: { model: { fallbacks: [] } } }, plugins: { entries: { codex: { enabled: false } } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "models.authStatus") return STATUS;
    if (method === "models.list") return { models: [{ provider: "ollama", id: "llama", name: "Llama", local: true }] };
    if (method === "branch.setup.detect") return { candidates: [{ kind: "codex-cli", credentials: true }], unavailableCandidates: [] };
    if (method === "usage.status") return { providers: [] };
    if (method === "users.listModelAccounts") return { profileId: "me", accounts: [{ authProfileId: "openai:work", provider: "openai", label: "Work", selected: true }, { authProfileId: "openai:home", provider: "openai", label: "Home", selected: false }] };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Main" }] };
    if (method === "gateway.identity.get") return { deviceId: "abcdef0123456789abcdef0123456789" };
    if (method === "tools.github.status") return { selected: { configured: false, identity: null }, effective: null };
    if (method === "tools.github.authorize.start") return { requestId: "r1", userCode: "ABCD-1234", expiresInMs: 600_000, pollAfterMs: 600_000 };
    if (method === "tools.github.authorize.cancel") return { cancelled: true };
    return { ok: true, status: "ok" };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes, features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const pick = async (el: HTMLSelectElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
};
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
const button = (scope: ParentNode | null, text: string) => [...(scope ?? document).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text);
const calls = (request: ReturnType<typeof engineOf>["request"], method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);

async function mount(onPage = vi.fn(), env = engineOf()) {
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="accounts" pages={R1_PAGES} onPage={onPage} />));
  await settle();
  await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Technical"));
  return { ...env, onPage };
}

const SLOT_ROWS = Object.keys(R1_PAGES.accounts?.controls ?? {});

describe("R1 Settings › Accounts draws every working Classic control", () => {
  it("draws each working Classic control itself, live, with every control declared", async () => {
    await mount();
    expect(SLOT_ROWS.length).toBeGreaterThan(20);
    for (const id of SLOT_ROWS) {
      const r = row(id);
      expect(r, id).not.toBeNull();
      expect(r!.hasAttribute("data-slot"), id).toBe(true);
      expect(r!.getAttribute("aria-disabled"), id).toBeNull();
      expect(r!.querySelector("[data-coming]"), id).toBeNull();
    }
    // What Classic greys stays Coming: Rename, Pause, keepoak.com.
    for (const id of ["accounts.order.rename", "accounts.order.pause", "accounts.keepoak.connect"]) expect(row(id)?.getAttribute("aria-disabled"), id).toBe("true");
    expect(undeclaredControls(host).map((el) => el.getAttribute("aria-label") || el.textContent)).toEqual([]);
  });

  it("shows the status line and the accounts in order, and Move up saves the order with models.authOrderSet", async () => {
    const { request } = await mount();
    const list = row("accounts.order.list")!;
    expect(list.textContent).toContain("2 accounts signed in");
    expect(list.textContent).toContain("Work");
    await click(button(list, "Move up OpenAI · Home") ?? [...list.querySelectorAll<HTMLButtonElement>("button[aria-label^='Move up']")].find((b) => b.getAttribute("aria-label")?.includes("Home")));
    expect(calls(request, "models.authOrderSet")).toContainEqual({ provider: "openai", profileIds: ["openai:home", "openai:work"], agentId: "main" });
  });

  it("the ⋯ menu tests an account, puts it first and signs it out", async () => {
    const { request } = await mount();
    const more = () => [...row("accounts.order.list")!.querySelectorAll<HTMLButtonElement>("button[aria-label^='More for']")].find((b) => b.getAttribute("aria-label")?.includes("Home"));
    await click(more());
    await click(button(document.querySelector('[role="menu"]'), "Test it"));
    expect(calls(request, "models.probe")).toContainEqual({ provider: "openai", profileId: "openai:home", agentId: "main" });
    await click(more());
    await click(button(document.querySelector('[role="menu"]'), "Answer first"));
    expect(calls(request, "models.authOrderSet")).toContainEqual({ provider: "openai", profileIds: ["openai:home", "openai:work"], agentId: "main" });
    await click(more());
    await click(button(document.querySelector('[role="menu"]'), "Sign out"));
    expect(calls(request, "models.authLogout")).toContainEqual({ provider: "openai", profileIds: ["openai:home"], agentId: "main" });
  });

  it("Test it, Answer first and Sign out also have their own rows", async () => {
    const { request } = await mount();
    await pick(row("accounts.order.test")!.querySelector("select")!, "openai/openai:home");
    await click(button(row("accounts.order.test"), "Test it"));
    expect(calls(request, "models.probe")).toContainEqual({ provider: "openai", profileId: "openai:home", agentId: "main" });
    await pick(row("accounts.order.answer-first")!.querySelector("select")!, "openai/openai:home");
    await click(button(row("accounts.order.answer-first"), "Answer first"));
    expect(calls(request, "models.authOrderSet")).toContainEqual({ provider: "openai", profileIds: ["openai:home", "openai:work"], agentId: "main" });
    await click(button(row("accounts.order.sign-out"), "Sign out"));
    expect(calls(request, "models.authLogout")).toContainEqual({ provider: "openai", profileIds: ["openai:work"], agentId: "main" });
  });

  it("Select accounts moves the ticked ones to the top and signs out of them", async () => {
    const { request } = await mount();
    const sel = () => row("accounts.order.select")!;
    await click(button(sel(), "Select accounts"));
    await click(sel().querySelector('input[aria-label$="Home"]'));
    await click(button(sel(), "Move to the top"));
    expect(calls(request, "models.authOrderSet")).toContainEqual({ provider: "openai", profileIds: ["openai:home", "openai:work"], agentId: "main" });
    await click(button(sel(), "Select accounts"));
    await click(sel().querySelector('input[aria-label$="Work"]'));
    await click(button(sel(), "Sign out"));
    expect(calls(request, "models.authLogout")).toContainEqual({ provider: "openai", profileIds: ["openai:work"], agentId: "main" });
  });

  it("Add an account, Another X account and Sign in to X open Classic's dialog, as the composer's settings/accounts/add does", async () => {
    await mount();
    const add = row("accounts.order.add")!;
    expect([...add.querySelectorAll("button")].some((b) => /^Another .+ account$/.test(b.textContent ?? ""))).toBe(true);
    expect([...add.querySelectorAll("button")].some((b) => b.textContent?.startsWith("Sign in to "))).toBe(true);
    await click(button(add, "Add an account"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root.render(<></>));
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    sessionStorage.setItem("branch.openAddAccount", "1");
    await act(async () => { window.dispatchEvent(new Event("branch:open-add-account")); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(sessionStorage.getItem("branch.openAddAccount")).toBeNull();
  });

  it("Fall back to this computer adds this computer's model to agents.defaults.model.fallbacks", async () => {
    const { request } = await mount();
    await click(row("accounts.out.this-computer")!.querySelector('[role="switch"]'));
    expect(JSON.stringify(calls(request, "config.patch"))).toContain("ollama/llama");
  });

  it("Which account goes next takes turns by clearing the order (models.authOrderSet)", async () => {
    const { request } = await mount();
    await click(button(row("accounts.next.mode"), "Take turns"));
    expect(calls(request, "models.authOrderSet")).toContainEqual({ provider: "openai", agentId: "main" });
  });

  it("your own accounts: Stop using (users.unlinkAuthProfile) and Add your own account (users.selectModelAccount)", async () => {
    const { request } = await mount();
    await click(button(row("accounts.own.list"), "Stop using"));
    expect(calls(request, "users.unlinkAuthProfile")).toContainEqual({ profileId: "me", authProfileId: "openai:work" });
    await click(button(row("accounts.own.add"), "Add your own account"));
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button.aa-pick')].find((b) => b.textContent?.includes("Home")));
    expect(calls(request, "users.selectModelAccount")).toContainEqual({ authProfileId: "openai:home" });
  });

  it("coding apps show what this computer has, Codex's switch saves its key and Check again looks again", async () => {
    const { request } = await mount();
    expect(row("accounts.apps.codex")!.textContent).toContain("Models ready");
    expect(row("accounts.apps.gemini")!.textContent).toContain("Not found");
    await click(row("accounts.apps.codex")!.querySelector('[role="switch"]'));
    expect(JSON.stringify(calls(request, "config.patch"))).toContain("codex");
    const before = calls(request, "branch.setup.detect").length;
    await click(button(row("accounts.apps.check"), "Check again"));
    expect(calls(request, "branch.setup.detect").length).toBeGreaterThan(before);
  });

  it("Codex not installed: the row reads Not found with the preview's line and Check again, and offers no download", async () => {
    const env = engineOf();
    const answer = env.request.getMockImplementation()!;
    let detect: Record<string, unknown> = { candidates: [], unavailableCandidates: [{ id: "codex-cli", reason: "codex: command not found" }] };
    env.request.mockImplementation((async (method: string, params?: unknown) => {
      if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { defaults: { model: { fallbacks: [] } } }, plugins: { entries: { codex: { enabled: true } } } } };
      if (method === "branch.setup.detect") return detect;
      // An engine from the first-use download design still answers these; the row must not use them.
      if (method === "codex.runtime") return { state: "download", reason: "not-downloaded", version: "0.160.0", bytes: 134_311_083, message: "Codex 0.160.0 downloads the first time you use it (134 MB)." };
      if (method === "codex.runtime.download") return { state: "downloading", received: 0, bytes: 134_311_083, message: "Downloading Codex 0.160.0 (134 MB): 0%." };
      return answer(method, params);
    }) as typeof answer);
    (env.engine as unknown as { features: { methods: string[] } }).features.methods = [...METHODS, "codex.runtime", "codex.runtime.download"];
    const { request } = await mount(vi.fn(), env);
    const codex = row("accounts.apps.codex")!;
    // Preview §4.7.8: CODE_PILL_PE18.none = Not found; "Install and sign in to ${c.name} on ${comp}, then check again."
    expect(codex.querySelector(".r1s-item-t b")!.textContent).toBe("Not found");
    expect(codex.querySelector(".r1s-item-t small")!.textContent).toBe("Install and sign in to Codex on this computer, then check again.");
    expect(codex.textContent).not.toMatch(/download/i);
    for (const gone of ["Download now", "Try again", "Cancel"]) expect(button(codex, gone)).toBeUndefined();
    expect(calls(request, "codex.runtime")).toHaveLength(0);
    expect(calls(request, "codex.runtime.download")).toHaveLength(0);
    // Check again looks again; once Codex is installed and signed in, the row is ready.
    detect = { candidates: [{ kind: "codex-cli", credentials: true }], unavailableCandidates: [] };
    await click(button(row("accounts.apps.check"), "Check again"));
    expect(row("accounts.apps.codex")!.querySelector(".r1s-item-t b")!.textContent).toBe("Models ready");
  });

  it("has no Codex download in the window: no download line, no download calls", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const src = resolve(__dirname, "../../..");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const full = join(dir, name); return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []; });
    const files = walk(src);
    expect(files.some((file) => file.endsWith("codex-line.tsx"))).toBe(false);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const banned of ["codex.runtime", "codex_download", "Getting Codex ready"]) {
        expect(text.includes(banned), file + " mentions " + banned).toBe(false);
      }
    }
  });

  it("connects GitHub (tools.github.authorize.start) and refreshes it (tools.github.status)", async () => {
    const { request } = await mount();
    const before = calls(request, "tools.github.status").length;
    await click(button(row("accounts.github.connection"), "Refresh"));
    expect(calls(request, "tools.github.status").length).toBeGreaterThan(before);
    await click(button(row("accounts.github.connection"), "Connect GitHub"));
    expect(calls(request, "tools.github.authorize.start")).toContainEqual({ agentId: "main", scope: "system" });
    expect(row("accounts.github.connection")!.textContent).toContain("ABCD-1234");
  });

  it("the Advanced and Technical rows: each Trunk's account, fallback keys, resting, sources and identity", async () => {
    const { request, onPage } = await mount();
    await pick(row("accounts.more.each-trunk")!.querySelector("select")!, "openai|openai:home");
    expect(calls(request, "models.authOrderSet")).toContainEqual({ provider: "openai", profileIds: ["openai:home", "openai:work"], agentId: "main" });
    expect(row("accounts.more.resting")!.textContent).toContain("Home");
    expect(row("accounts.sources.each")!.textContent).toContain("Browser sign-ins: 2");
    expect(row("accounts.tech.identity")!.textContent).toContain("abcdef0123456789…");
    await click(button(row("accounts.more.fallback-keys"), "Add a key"));
    expect(onPage).toHaveBeenCalledWith("signins");
  });

  it("on a read-only connection the account changes are greyed with why, and nothing is sent", async () => {
    const { engine, request } = engineOf(["operator.read"]);
    await act(async () => root.render(<SettingsFrame engine={engine} page="accounts" pages={R1_PAGES} />));
    await settle();
    await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Technical"));
    const list = row("accounts.order.list")!;
    for (const b of list.querySelectorAll<HTMLButtonElement>("button[aria-label^='Move up']")) expect(b.disabled).toBe(true);
    expect(list.textContent).toContain("Only someone who may change Branch’s setup can change accounts.");
    await click(list.querySelector("button[aria-label^='More for']"));
    for (const label of ["Test it", "Answer first", "Sign out"]) expect(button(document.querySelector('[role="menu"]'), label)?.disabled, label).toBe(true);
    for (const [id, label] of [["accounts.order.add", "Add an account"], ["accounts.order.test", "Test it"], ["accounts.apps.check", "Check again"], ["accounts.own.add", "Add your own account"]]) {
      expect(button(row(id), label)?.disabled, id).toBe(true);
    }
    expect(row("accounts.out.this-computer")!.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
    expect(row("accounts.more.each-trunk")!.querySelector("select")!.disabled).toBe(true);
    for (const m of ["models.authOrderSet", "models.probe", "models.authLogout", "config.patch", "users.selectModelAccount"]) expect(calls(request, m), m).toEqual([]);
  });

  it("without the page's controls the same rows are Coming, never live and silent", async () => {
    const { engine } = engineOf();
    await act(async () => root.render(<SettingsFrame engine={engine} page="accounts" />));
    await settle();
    expect(row("accounts.order.list")!.getAttribute("aria-disabled")).toBe("true");
    expect(undeclaredControls(host)).toEqual([]);
  });
});
