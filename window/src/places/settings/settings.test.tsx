// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { saveAgentFile, saveConfig, safeEntries, visible } from "./adapter";
import { useAction, useResource } from "./hooks";
import { SettingsPage } from "./index";

const engine = (request: ReturnType<typeof vi.fn>): WindowEngine => ({ request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "test", scopes: [] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("Settings engine contracts", () => {
  it("patches only changed fields with the loaded revision and reloads after success", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ hash: "new", config: {} });
    await saveConfig(engine(request), { hash: "old", valid: true }, { "agents.defaults.model.primary": "service/model", "messages.queue.mode": null });
    expect(request.mock.calls).toEqual([["config.patch", { baseHash: "old", raw: JSON.stringify({ agents: { defaults: { model: { primary: "service/model" } } }, messages: { queue: { mode: null } } }) }], ["config.get", {}]]);
  });
  it("keeps conflicts and invalid revisions from becoming successful saves", async () => {
    const request = vi.fn().mockRejectedValue(new Error("config changed; reload"));
    await expect(saveConfig(engine(request), { hash: "old" }, { "messages.queue.mode": "steer" })).rejects.toThrow("reload");
    expect(request).toHaveBeenCalledTimes(1);
    await expect(saveConfig(engine(request), {}, {})).rejects.toThrow("revision");
    await expect(saveConfig(engine(request), { hash: "old", valid: false }, {})).rejects.toThrow("invalid");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("uses document compare-and-save and exclusive creation for missing files", async () => {
    const request = vi.fn().mockResolvedValue({ file: { name: "SOUL.md", hash: "new", content: "New" } });
    await saveAgentFile(engine(request), "trunk", { name: "SOUL.md", hash: "old" }, "New");
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "trunk", name: "SOUL.md", expectedHash: "old", content: "New" });
    await saveAgentFile(engine(request), "trunk", { name: "SOUL.md", missing: true }, "New");
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "trunk", name: "SOUL.md", expectedMissing: true, content: "New" });
  });
  it("filters credential values from status rendering", () => { expect(safeEntries({ token: "hidden", apiKey: "hidden", secret: "hidden", password: "hidden", status: "connected" })).toEqual([["status", "connected"]]); });
  it("keeps numeric usage counts while hiding token strings", () => { expect(safeEntries({ totalTokens: 120, accessTokens: "hidden", refreshToken: "hidden", outputTokens: 40 })).toEqual([["totalTokens", 120], ["outputTokens", 40]]); });
  it("maps each exact engine identifier to its Branch name and leaves free text alone", () => {
    expect(visible("OpenClaw")).toBe("Branch");
    expect(visible("Dreaming")).toBe("Rings");
    expect(visible("ClawRouter")).toBe("Model router");
    expect(visible("Dreaming on")).toBe("Dreaming on");
    expect(visible("OpenAI Anthropic Google Amazon Bitwarden GitHub Telegram OpenShell")).toBe("OpenAI Anthropic Google Amazon Bitwarden GitHub Telegram OpenShell");
  });
  it("never reports a refused file save or config patch as successful", async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, error: "revision conflict" });
    await expect(saveConfig(engine(request), { hash: "old" }, { "messages.queue.mode": "steer" })).rejects.toThrow("revision conflict");
    await expect(saveAgentFile(engine(request), "trunk", { name: "SOUL.md", hash: "old" }, "content")).rejects.toThrow("revision conflict");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("Settings repeated and interrupted flows", () => {
  it("keeps password-manager sign-ins distinct from model subscriptions",async()=>{
    const request=vi.fn(async()=>({}));await act(async()=>root.render(<SettingsPage page="secrets" title="Saved sign-ins" level="regular" engine={engine(request)}/>));
    expect(host.textContent).toContain("No password manager is connected");expect(request).not.toHaveBeenCalledWith("models.authStatus",expect.anything());
  });
  it("updates appearance when the shell changes theme in the same window", async () => {
    const connection=engine(vi.fn().mockResolvedValue({}));
    await act(async()=>root.render(<SettingsPage page="appearance" title="Appearance" level="regular" engine={connection}/>));
    await act(async()=>window.dispatchEvent(new CustomEvent("branch:theme-change",{detail:"dark"})));
    expect(host.querySelector('.mirror[aria-pressed="true"]')?.textContent).toContain("Dark");
  });
  it("ignores an interrupted load and allows retry after a failed load", async () => {
    const first = deferred<string>(); const second = deferred<string>();
    const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockRejectedValueOnce(new Error("disconnected")).mockResolvedValueOnce("recovered");
    const connection = engine(request); let reload!: () => Promise<void>;
    function View({ method }: { method: string }) { const state = useResource<string>(connection, method); reload = state.reload; return <span>{state.loading ? "Loading" : state.error ?? state.data}</span>; }
    await act(async () => root.render(<View method="first" />));
    await act(async () => root.render(<View method="second" />));
    await act(async () => second.resolve("current")); expect(host.textContent).toBe("current");
    await act(async () => first.resolve("stale")); expect(host.textContent).toBe("current");
    await act(async () => reload()); expect(host.textContent).toBe("disconnected");
    await act(async () => reload()); expect(host.textContent).toBe("recovered");
  });
  it("serializes repeated clicks and recovers after a rejected mutation", async () => {
    const pending = deferred<void>(); const mutate = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    let run!: () => Promise<void>;
    function View() { const action = useAction(); run = () => action.run(mutate); return <span>{action.error ?? action.message ?? (action.busy ? "Saving" : "Ready")}</span>; }
    await act(async () => root.render(<View />));
    let first!: Promise<void>;
    await act(async () => { first = run(); await run(); }); expect(mutate).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error("conflict")); await first; }); expect(host.textContent).toBe("conflict");
    await act(async () => run()); expect(mutate).toHaveBeenCalledTimes(2); expect(host.textContent).toBe("Saved");
  });
  it("routes all21 Settings ids and reports engine failures without success data", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Engine offline"));
    const connection = engine(request);
    const ids = ["general", "people", "appearance", "notifications", "instructions", "models", "local", "accounts", "voice", "chatapps", "permissions", "computer", "secrets", "usage", "backups", "gateway", "self", "seasons", "updates", "achievements", "advanced", "developer"];
    for (const page of ids) { await act(async () => root.render(<SettingsPage page={page} title={page} level="regular" engine={connection} />)); expect(host.querySelector("h1")?.textContent).toBe(page); expect(host.querySelector(".bs-success")).toBeNull(); }
  });
});
