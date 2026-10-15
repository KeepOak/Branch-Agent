// @vitest-environment jsdom
// UI audit SH2: a conversation this window starts is "May read it" for everyone else on this Branch, not
// "May write in it". Every sessions.create the window sends goes through SaplingSession.request.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({ options: null as Options | null, creates: [] as Record<string, unknown>[] }));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      if (method === "sessions.create") {
        fake.creates.push({ ...params });
        return { key: "agent:main:topic-1" };
      }
      if (method === "agents.list") return { agents: [{ id: "main", name: "Juniper" }], defaultId: "main" };
      if (method === "chat.history") return { sessionId: "s1", messages: [] };
      if (method === "exec.approval.list") return [];
      if (method === "approval.history") return { items: [] };
      return {};
    }
  },
}));

import { SaplingSession } from "./session";
import { publishedVisibility, withSafeVisibility } from "./safe-visibility";
import { createTopic } from "../shell/new-menu";
import { ShareDialog } from "../shell/ShareDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "agent:main:main";
const ALL = ["shared", "read-only", "suggest", "draft"];
const helloWith = (allowedSessionVisibilities?: string[]) => ({
  snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] },
  policy: allowedSessionVisibilities ? { allowedSessionVisibilities } : {},
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connected(allowed?: string[]): Promise<SaplingSession> {
  const session = new SaplingSession("ws://fake", undefined);
  session.start();
  fake.options?.onStatus({ phase: "connected", hello: helloWith(allowed) } as unknown as GatewayStatus);
  await settle();
  await settle();
  return session;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  Object.assign(fake, { options: null, creates: [] });
});

describe("a new conversation's default for everyone else on this Branch", () => {
  it("starts a new conversation as May read it, not May write in it", async () => {
    const session = await connected(ALL);
    await createTopic((m, p) => session.request(m, p), "main", "main", "First job");
    expect(fake.creates).toHaveLength(1);
    expect(fake.creates[0]).toMatchObject({ agentId: "main", visibility: "read-only" });
  });

  it("leaves the visibility out when the engine turned May read it off", async () => {
    const session = await connected(["shared", "draft"]);
    await session.request("sessions.create", { agentId: "main" });
    expect(fake.creates[0]).not.toHaveProperty("visibility");
  });

  it("keeps a visibility the caller chose and never touches an existing key or other methods", () => {
    const hello = helloWith(ALL) as never;
    expect(withSafeVisibility("sessions.create", { agentId: "main", visibility: "draft" }, hello)).toEqual({ agentId: "main", visibility: "draft" });
    expect(withSafeVisibility("sessions.create", { key: KEY }, hello)).toEqual({ key: KEY });
    expect(withSafeVisibility("sessions.patch", { key: KEY }, hello)).toEqual({ key: KEY });
    expect(withSafeVisibility("sessions.create", { agentId: "main" }, null)).toEqual({ agentId: "main" });
  });

  it("publishes a draft as May read it, and as May write in it only when that is all the engine allows", () => {
    expect(publishedVisibility(["shared", "read-only", "suggest", "draft"])).toBe("read-only");
    expect(publishedVisibility(["shared", "draft"])).toBe("shared");
  });

  it("Share…: turning Keep it a draft off opens it as May read it", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "session.members.list") return { allowedVisibilities: ALL, role: "owner", members: [], identities: [] };
      if (method === "sessions.describe") return { session: { visibility: "draft" } };
      return {};
    });
    const engine = { request, onEvent: () => () => {}, sessionKey: KEY, scopes: [] } as unknown as WindowEngine;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<ShareDialog engine={engine} sessionKey={KEY} title="Plans" publicLink={(t) => t} onCopy={() => {}} onClose={() => {}} />); });
    await act(async () => { await settle(); });
    const draft = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Keep it a draft"]');
    expect(draft?.getAttribute("aria-checked")).toBe("true");
    const levels = document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Everyone else on this Branch"]')!;
    expect(levels.classList.contains("share-none")).toBe(true);
    await act(async () => { draft!.click(); await settle(); });
    expect(request).toHaveBeenCalledWith("session.visibility.set", { sessionKey: KEY, visibility: "read-only" });
    await act(async () => { root.unmount(); });
  });

  it("Share…: the raised pill sits under the chosen level, not always under the first", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "session.members.list") return { allowedVisibilities: ALL, role: "owner", members: [], identities: [] };
      if (method === "sessions.describe") return { session: { visibility: "shared" } };
      return {};
    });
    const engine = { request, onEvent: () => () => {}, sessionKey: KEY, scopes: [] } as unknown as WindowEngine;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<ShareDialog engine={engine} sessionKey={KEY} title="Plans" publicLink={(t) => t} onCopy={() => {}} onClose={() => {}} />); });
    await act(async () => { await settle(); });
    const levels = document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Everyone else on this Branch"]')!;
    expect(levels.querySelector('[aria-checked="true"]')?.textContent).toBe("May write in it");
    expect(levels.style.getPropertyValue("--i")).toBe("2");
    expect(levels.classList.contains("share-none")).toBe(false);
    await act(async () => root.unmount());
  });
});
