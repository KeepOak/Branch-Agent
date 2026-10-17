// @vitest-environment jsdom
// #1767: after onboarding recommends (or the person picks) Ask first, the composer and Settings must start on that
// access, including Set up later on a fresh profile and a reload. Full access is never the first-run default.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Composer } from "../composer/Composer";
import { KitProvider, type SaveReport } from "../../places/settings/kit";
import { PermissionsPage } from "../../places/settings/set1/permissions";
import { execOf, FIRST_RUN_ACCESS, saveOnboardingAccess } from "./access";
import { Onboarding } from "./Onboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

const APPROVALS = {
  path: "/x/exec-approvals.json",
  exists: true,
  hash: "e1",
  file: { version: 1, agents: {} },
  resolvedDefaults: { security: "full", ask: "off", askFallback: "deny", autoAllowSkills: false },
};

const SESSION_OF: Record<string, string> = { ask: "guarded", auto: "workspace", deny: "read-only", full: "full" };

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const cur = out[key];
    out[key] = value && typeof value === "object" && !Array.isArray(value) && cur && typeof cur === "object" && !Array.isArray(cur)
      ? merge(cur as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out;
}

/** A fresh profile: no tools.exec.mode yet, so the engine still resolves Full access until setup writes Ask first. */
function freshProfile(start: Record<string, unknown> = {}) {
  let config: Record<string, unknown> = structuredClone(start);
  let hash = "h1";
  const execMode = () => {
    const exec = config.tools && typeof config.tools === "object" ? (config.tools as { exec?: { mode?: unknown } }).exec : undefined;
    return typeof exec?.mode === "string" ? exec.mode : undefined;
  };
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "config.get") return { hash, valid: true, config };
    if (method === "config.patch") {
      config = merge(config, JSON.parse(String(params?.raw ?? "{}")));
      hash = `h${Number(hash.slice(1)) + 1}`;
      return { ok: true, hash, config };
    }
    if (method === "agents.list") {
      const mode = SESSION_OF[execMode() ?? "full"] ?? "full";
      return { defaultId: "main", mainKey: "main", agents: [{ id: "main", identity: { name: "Oak" }, defaultPermissionMode: mode }] };
    }
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") {
      return { models: [{ id: "test", provider: "openai", name: "Test Model", available: true, thinkingLevels: [{ id: "medium", label: "medium" }] }] };
    }
    if (method === "exec.approvals.get") return APPROVALS;
    if (method === "node.list") return { nodes: [] };
    if (method === "trunks.template.list") return { templates: [] };
    if (method === "chat.send") return { runId: "r1" };
    return {};
  });
  const engine = {
    request,
    onEvent: () => () => undefined,
    sessionKey: "agent:main:main",
    agentId: "main",
    scopes: ["operator.admin"],
    features: { methods: ["config.get", "config.patch", "agents.list", "sessions.describe", "sessions.list", "models.list", "exec.approvals.get", "node.list", "trunks.template.list", "chat.send"], events: [] },
  } as unknown as WindowEngine;
  return {
    engine,
    request,
    execMode,
    snapshot: () => structuredClone(config),
  };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => {
  const label = b.textContent?.trim() ?? "";
  return label === text || label.startsWith(text);
}) as HTMLButtonElement;
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

async function showOnboarding(engine: WindowEngine, startAt = 0) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const onLater = vi.fn(), onDone = vi.fn();
  await act(async () => root?.render(
    <CapabilityProvider engine={engine}>
      <Onboarding engine={engine} startAt={startAt} onLater={onLater} onDone={onDone} />
    </CapabilityProvider>,
  ));
  await flush();
  return { host, onLater, onDone };
}

async function showComposer(engine: WindowEngine) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(
    <Composer
      name="Oak"
      engine={engine}
      working={false}
      offline={false}
      onSend={() => undefined}
      onStop={() => undefined}
      onToast={() => undefined}
      onOpen={() => undefined}
      onOpenConversation={() => undefined}
      limits={null}
      row={{ key: "agent:main:main", title: "Main", isMain: true } as never}
      topics={[]}
      running={[]}
    />,
  ));
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  return host;
}

async function showSettings(engine: WindowEngine) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(
    <KitProvider level={0} report={report} scope={null}>
      <PermissionsPage page="permissions" title="Permissions" level="regular" engine={engine} />
    </KitProvider>,
  ));
  await flush();
  return host;
}

function accessChip(host: HTMLElement) {
  return host.querySelector(".r1c-row .r1c-quiet");
}

describe("first-run access", () => {
  it("maps the recommended choice to tools.exec.mode ask", () => {
    expect(FIRST_RUN_ACCESS).toBe("ask");
    expect(execOf("ask")).toBe("ask");
    expect(execOf("auto")).toBe("auto");
    expect(execOf("read")).toBe("deny");
    expect(execOf("plan")).toBeNull();
  });

  it("writes Ask first the way Settings › Permissions does", async () => {
    const { engine, request } = freshProfile();
    await saveOnboardingAccess(engine, "ask");
    const patch = request.mock.calls.find(([method]) => method === "config.patch") as [string, { raw: string }];
    expect(JSON.parse(patch[1].raw)).toEqual({ tools: { exec: { mode: "ask", security: null, ask: null } } });
  });

  it("Set up later on a fresh profile leaves Ask first in the composer and Settings, including after a reload", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const first = freshProfile();
    expect(first.execMode()).toBeUndefined();
    const { host, onLater } = await showOnboarding(first.engine);
    expect(host.textContent).toContain("It asks before it sends, deletes, spends or installs anything.");
    await act(async () => button(host, "Set up later").click());
    await flush();
    expect(onLater).toHaveBeenCalledOnce();
    expect(first.execMode()).toBe("ask");
    await act(async () => root?.unmount());
    root = undefined;

    const composer = await showComposer(first.engine);
    expect(accessChip(composer)?.textContent).toBe("Ask first");
    expect(accessChip(composer)?.getAttribute("data-tone")).not.toBe("bad");
    await act(async () => root?.unmount());
    root = undefined;

    const settings = await showSettings(first.engine);
    expect(settings.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Ask first");
    await act(async () => root?.unmount());
    root = undefined;

    const reloaded = freshProfile(first.snapshot());
    const composerAgain = await showComposer(reloaded.engine);
    expect(accessChip(composerAgain)?.textContent).toBe("Ask first");
    expect(accessChip(composerAgain)?.getAttribute("data-tone")).not.toBe("bad");
    await act(async () => root?.unmount());
    root = undefined;
    const settingsAgain = await showSettings(reloaded.engine);
    expect(settingsAgain.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Ask first");
    vi.unstubAllGlobals();
  });

  it("finishing on a fresh profile leaves Ask first in the composer and Settings, including after a reload", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const first = freshProfile();
    const { host, onDone } = await showOnboarding(first.engine, 3);
    expect(host.querySelector("h1")?.textContent).toBe("Your first Trunk");
    await act(async () => button(host, "Start with Oak").click());
    await flush();
    expect(onDone).toHaveBeenCalledOnce();
    expect(first.execMode()).toBe("ask");
    await act(async () => root?.unmount());
    root = undefined;

    const composer = await showComposer(first.engine);
    expect(accessChip(composer)?.textContent).toBe("Ask first");
    await act(async () => root?.unmount());
    root = undefined;

    const settings = await showSettings(first.engine);
    expect(settings.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Ask first");
    await act(async () => root?.unmount());
    root = undefined;

    const reloaded = freshProfile(first.snapshot());
    const composerAgain = await showComposer(reloaded.engine);
    expect(accessChip(composerAgain)?.textContent).toBe("Ask first");
    await act(async () => root?.unmount());
    root = undefined;
    const settingsAgain = await showSettings(reloaded.engine);
    expect(settingsAgain.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Ask first");
    vi.unstubAllGlobals();
  });

  it("Set up later keeps a mode the person picked, not Full access", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const first = freshProfile();
    const { host, onLater } = await showOnboarding(first.engine, 2);
    await act(async () => button(host, "Read only").click());
    await act(async () => button(host, "Set up later").click());
    await flush();
    expect(onLater).toHaveBeenCalledOnce();
    expect(first.execMode()).toBe("deny");
    await act(async () => root?.unmount());
    root = undefined;
    const composer = await showComposer(first.engine);
    expect(accessChip(composer)?.textContent).toBe("Read only");
    expect(accessChip(composer)?.getAttribute("data-tone")).not.toBe("bad");
    vi.unstubAllGlobals();
  });
});
