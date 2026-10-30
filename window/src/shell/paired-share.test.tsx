// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../connect/capabilities";
import type { WindowEngine } from "../connect/engine";
import { ShareDialog } from "./ShareDialog";
import {
  PAIRED_SHARE_ENABLED_PATH,
  PAIRED_SHARE_GROUPS_PATH,
  pairedShareBlock,
  pairedShareHint,
  pairedSharePublished,
  pairedShareWrites,
  readPairedSession,
  shareGroupsOf,
  type PairedSession,
} from "./paired-share";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (patch: Partial<PairedSession> = {}): PairedSession => ({
  category: "", visibility: "read-only", incognito: false, createdVia: "", spawnedBy: "", ...patch,
});

describe("session-share group writes", () => {
  it("reads groups from a config.get payload and from the config object", () => {
    const config = { plugins: { entries: { "session-share": { enabled: true, config: { share: { groups: ["Team", "", 4] }, nodes: { desk: { owner: "profile:ada" } } } } } } };
    expect(shareGroupsOf({ hash: "h1", valid: true, config })).toEqual(["Team"]);
    expect(shareGroupsOf(config)).toEqual(["Team"]);
    expect(shareGroupsOf({})).toEqual([]);
  });

  it("keeps session-share as one settings key", () => {
    expect(PAIRED_SHARE_GROUPS_PATH).toEqual(["plugins", "entries", "session-share", "config", "share", "groups"]);
    expect(PAIRED_SHARE_ENABLED_PATH).toEqual(["plugins", "entries", "session-share", "enabled"]);
  });

  it("adds a group and turns the plugin on, and removes one group without turning the plugin off", () => {
    const snap = { hash: "h", config: { plugins: { entries: { "session-share": { enabled: true, config: { share: { groups: ["Team"] } } } } } } };
    expect(pairedShareWrites(snap, "Shared", true)).toEqual({ enabled: true, groups: ["Team", "Shared"] });
    expect(pairedShareWrites(snap, "Team", false)).toEqual({ groups: [], enabled: false });
    const both = { hash: "h", config: { plugins: { entries: { "session-share": { enabled: true, config: { share: { groups: ["Team", "Shared"] } } } } } } };
    expect(pairedShareWrites(both, "Team", false)).toEqual({ groups: ["Shared"] });
    expect(pairedShareWrites(snap, "Team", true)).toEqual({ enabled: true, groups: ["Team"] });
  });

  it("refuses the conversations the plugin never publishes, and a draft still can be published", () => {
    expect(pairedShareBlock("agent:main:topic", session({ incognito: true }))).toMatch(/incognito/i);
    expect(pairedShareBlock("agent:main:subagent:run", session())).toMatch(/helper/i);
    expect(pairedShareBlock("subagent:run", session())).toMatch(/helper/i);
    expect(pairedShareBlock("agent:main:topic", session({ createdVia: "spawn" }))).toMatch(/Trunk started/i);
    expect(pairedShareBlock("agent:main:topic", session({ spawnedBy: "agent:main:main" }))).toMatch(/Trunk started/i);
    expect(pairedShareBlock("agent:main:catalog:other", session())).toMatch(/another catalog/i);
    expect(pairedShareBlock("agent:main:topic", session({ visibility: "draft" }))).toBeNull();
    expect(readPairedSession({ session: { category: " Team ", visibility: "draft", incognito: true, createdVia: "spawn", spawnedBy: " x " } })).toEqual({
      category: "Team", visibility: "draft", incognito: true, createdVia: "spawn", spawnedBy: " x ",
    });
  });

  it("says when a draft will also be published for everyone else on this Branch", () => {
    expect(pairedSharePublished(session({ category: "Team" }), ["Team"], true)).toBe(true);
    expect(pairedSharePublished(session({ category: "Team", visibility: "draft" }), ["Team"], true)).toBe(false);
    expect(pairedSharePublished(session({ category: "Team" }), ["Team"], false)).toBe(false);
    expect(pairedShareHint(session(), false)).toContain("Shared");
    expect(pairedShareHint(session({ visibility: "draft" }), false)).toContain("everyone else on this Branch");
    expect(pairedShareHint(session({ category: "Team" }), true)).toContain("every conversation in Team");
  });
});

const ALL = ["shared", "read-only", "suggest", "draft"];
const NODES = { desk: { owner: "profile:ada", linkGitHubIdentities: false } };

function merge(base: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = { ...(base && typeof base === "object" && !Array.isArray(base) ? base as Record<string, unknown> : {}) };
  for (const [key, value] of Object.entries(patch)) out[key] = merge(out[key], value);
  return out;
}

function harness(options: { key?: string; described?: Record<string, unknown>; role?: string; config?: Record<string, unknown> }) {
  let hash = "h1";
  let config: Record<string, unknown> = options.config ?? { plugins: { entries: { "session-share": { enabled: false, config: { nodes: NODES } } } } };
  let described = options.described ?? { visibility: "read-only" };
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "session.members.list") return { role: options.role ?? "owner", allowedVisibilities: ALL, members: [], identities: [], owner: { id: "me", displayName: "Sam" } };
    if (method === "sessions.describe") return { session: described };
    if (method === "config.get") return { hash, valid: true, config };
    if (method === "session.visibility.set") {
      described = { ...described, visibility: (params as { visibility: string }).visibility };
      return { ok: true };
    }
    if (method === "sessions.patch") {
      described = { ...described, category: (params as { category: string }).category };
      return { ok: true };
    }
    if (method === "config.patch") {
      const patch = JSON.parse((params as { raw: string }).raw) as unknown;
      config = merge(config, patch) as Record<string, unknown>;
      hash = `h${hash.length}`;
      return { ok: true, hash, config };
    }
    return {};
  });
  const engine = {
    request,
    onEvent: () => () => undefined,
    features: { methods: ["config.patch", "sessions.patch", "session.visibility.set", "session.members.list", "sessions.describe", "config.get"], events: [] },
  } as unknown as WindowEngine;
  return { engine, request, described: () => described, config: () => config };
}

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render(engine: WindowEngine, sessionKey = "agent:main:topic") {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <CapabilityProvider engine={engine}>
        <ShareDialog clear engine={engine} sessionKey={sessionKey} agentId="main" title="Plans" publicLink={(token) => token} onCopy={() => undefined} onClose={() => undefined} />
      </CapabilityProvider>,
    );
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const pairedSwitch = () => document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Let paired computers read it"]');
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([method]) => method === "config.patch").map(([, params]) => JSON.parse((params as { raw: string }).raw));

describe("Share… starts session-share for a paired computer", () => {
  it("puts a conversation in Shared and turns the plugin on without rewriting node attribution", async () => {
    const { engine, request, config } = harness({});
    await render(engine);
    const button = pairedSwitch();
    expect(button?.getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain("Puts this conversation in the Shared group");
    await act(async () => { button?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:main:topic", agentId: "main", category: "Shared" });
    expect(request).not.toHaveBeenCalledWith("session.visibility.set", expect.anything());
    const written = patches(request);
    expect(written).toContainEqual({ plugins: { entries: { "session-share": { config: { share: { groups: ["Shared"] } } } } } });
    expect(written).toContainEqual({ plugins: { entries: { "session-share": { enabled: true } } } });
    expect(JSON.stringify(written)).not.toContain("desk");
    expect(config()).toMatchObject({ plugins: { entries: { "session-share": { enabled: true, config: { share: { groups: ["Shared"] }, nodes: NODES } } } } });
    expect(pairedSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("publishes a draft with session.visibility.set, then shares its existing group", async () => {
    const { engine, request } = harness({
      described: { visibility: "draft", category: "Team" },
      config: { plugins: { entries: { "session-share": { enabled: true, config: { share: { groups: ["Team"] }, nodes: NODES } } } } },
    });
    await render(engine);
    expect(pairedSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain("everyone else on this Branch");
    await act(async () => { pairedSwitch()?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(request).toHaveBeenCalledWith("session.visibility.set", { sessionKey: "agent:main:topic", agentId: "main", visibility: "read-only" });
    expect(request.mock.calls.filter(([method]) => method === "sessions.patch")).toHaveLength(0);
    expect(pairedSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("stops publishing one group and leaves the other groups on", async () => {
    const { engine, request } = harness({
      described: { visibility: "read-only", category: "Team" },
      config: { plugins: { entries: { "session-share": { enabled: true, config: { share: { groups: ["Team", "Shared"] } } } } } },
    });
    await render(engine);
    expect(pairedSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("every conversation in Team");
    await act(async () => { pairedSwitch()?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(patches(request)).toContainEqual({ plugins: { entries: { "session-share": { config: { share: { groups: ["Shared"] } } } } } });
    expect(patches(request).some((patch) => JSON.stringify(patch).includes("enabled"))).toBe(false);
    expect(request.mock.calls.filter(([method]) => method === "sessions.patch")).toHaveLength(0);
    expect(pairedSwitch()?.getAttribute("aria-checked")).toBe("false");
  });

  it("tells why a helper conversation cannot be shared and does not offer the switch", async () => {
    const { engine, request } = harness({});
    await render(engine, "agent:main:subagent:run");
    expect(document.body.textContent).toContain("A helper conversation stays on this computer.");
    expect(pairedSwitch()).toBeNull();
    expect(request.mock.calls.filter(([method]) => method === "config.patch" || method === "sessions.patch")).toHaveLength(0);
  });
});
