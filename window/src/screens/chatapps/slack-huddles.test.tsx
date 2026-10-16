// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { joinHuddlesEntry, joinHuddlesOn, SLACK_HUDDLES_CONFIG_ENABLED, SLACK_HUDDLES_ENABLED } from "../../places/settings/set1/slack-huddles";
import { ChatApps } from "./ChatApps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => localStorage.clear());
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const METHODS = ["channels.status", "config.get", "config.patch", "agents.list"];
const STATUS = {
  channelMeta: [{ id: "slack", label: "Slack", detailLabel: "Slack Bot" }],
  channelAccounts: { slack: [{ accountId: "main", running: true, configured: true }] },
  channels: { slack: { configured: true, running: true } },
};

async function render(config: Record<string, unknown> = {}) {
  localStorage.setItem("branch.level", "advanced");
  let live = structuredClone(config);
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.patch") {
      live = mergePatch(live, JSON.parse((params as { raw: string }).raw));
      return { ok: true, hash: "h2", config: live };
    }
    if (method === "channels.status") return STATUS;
    if (method === "config.get") return { config: live, hash: "h1", valid: true };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling" }] };
    return {};
  });
  const engine = { request, sessionKey: null, scopes: ["operator.admin"], onEvent: () => () => {}, features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ChatApps engine={engine} onSetup={() => undefined} onManage={() => undefined} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { host, request, saved: () => live };
}

const mergePatch = (into: Record<string, unknown>, patch: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete into[k];
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      const cur = into[k];
      into[k] = mergePatch(cur && typeof cur === "object" && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : {}, v as Record<string, unknown>);
    } else into[k] = v;
  }
  return into;
};
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));
const toggle = (host: ParentNode) => host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Join huddles"]');

it("keeps Join huddles off until it is saved, then the saved slack-huddles config stays on", async () => {
  expect(joinHuddlesOn(() => undefined)).toBe(false);
  expect(joinHuddlesOn((path) => path === SLACK_HUDDLES_ENABLED ? true : path === SLACK_HUDDLES_CONFIG_ENABLED ? false : undefined)).toBe(false);
  const first = await render();
  const off = toggle(first.host);
  expect(off).not.toBeNull();
  expect(off!.getAttribute("aria-checked")).toBe("false");
  expect(first.host.textContent).toContain("the transcript shows in Meetings");
  await act(async () => { off!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(patches(first.request).at(-1)).toEqual({ plugins: { entries: { "slack-huddles": joinHuddlesEntry(true) } } });
  expect(toggle(first.host)!.getAttribute("aria-checked")).toBe("true");
  const saved = first.saved();
  await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  const again = await render(saved);
  expect(toggle(again.host)!.getAttribute("aria-checked")).toBe("true");
  await act(async () => { toggle(again.host)!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(patches(again.request).at(-1)).toEqual({ plugins: { entries: { "slack-huddles": joinHuddlesEntry(false) } } });
  expect(toggle(again.host)!.getAttribute("aria-checked")).toBe("false");
});
