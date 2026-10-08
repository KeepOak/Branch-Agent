// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Checkins, lastCheckinWords } from "./Checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SPAWN = {
  name: "sessions_spawn",
  arguments: {
    visible: true,
    title: "model-smoke-test-2",
    sessionKey: "agent:<id>:model-smoke-test-2",
    message: "Starting new session for model smoke test",
  },
};
const SPAWN_JSON = JSON.stringify(SPAWN);
const HASH = "a".repeat(64);
const FX: Record<string, unknown> = {
  "config.get": { hash: "cfg", valid: true, config: { agents: { defaults: { heartbeat: { every: "30m" } } } } },
  "agents.list": { defaultId: "main", agents: [{ id: "main", identity: { name: "Scout" } }] },
  "agents.files.get": { agentId: "main", workspace: "/w", file: { name: "HEARTBEAT.md", path: "/w/HEARTBEAT.md", missing: false, hash: HASH, content: "# Checks\n- New mail\n" } },
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(last: Record<string, unknown>) {
  const request = vi.fn(async (method: string) => (method === "last-heartbeat" ? last : FX[method] ?? {}));
  const engine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as WindowEngine;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Checkins engine={engine} level="regular" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host;
}

describe("lastCheckinWords", () => {
  it("shows a whole-reply tool-call JSON as the preview step words, never as JSON", () => {
    expect(lastCheckinWords({ ts: 1, preview: SPAWN_JSON })).toBe("Started a helper · model-smoke-test-2");
    expect(lastCheckinWords({ ts: 1, preview: SPAWN_JSON })).not.toContain('"name"');
    expect(lastCheckinWords({ ts: 1, status: "sent", message: SPAWN_JSON })).toBe("Started a helper · model-smoke-test-2");
    expect(lastCheckinWords({ ts: 1, preview: `\`\`\`json\n${SPAWN_JSON}\n\`\`\`` })).toBe("Started a helper · model-smoke-test-2");
  });

  it("leaves normal text and JSON inside prose exactly as before", () => {
    expect(lastCheckinWords({ ts: 1, status: "ok-empty" })).toBe("Nothing new.");
    expect(lastCheckinWords({ ts: 1, preview: "Dana replied about the August report." })).toBe("Dana replied about the August report.");
    const prose = `Here is the call: ${SPAWN_JSON}`;
    expect(lastCheckinWords({ ts: 1, preview: prose })).toBe(prose);
    expect(lastCheckinWords({ ts: 1, preview: `Use this:\n\n\`\`\`json\n${SPAWN_JSON}\n\`\`\`\n` })).toContain(SPAWN_JSON);
  });
});

describe("Check-ins › Last check-ins", () => {
  it("renders tool-call preview as plain words and leaves a normal last check-in unchanged", async () => {
    await mount({ ts: Date.now() - 60_000, preview: SPAWN_JSON });
    expect(host.textContent).toContain("Started a helper · model-smoke-test-2");
    expect(host.textContent).not.toContain('"sessions_spawn"');
    expect(host.textContent).not.toContain(SPAWN_JSON);
    await act(async () => root!.unmount());
    root = null;
    await mount({ ts: Date.now() - 60_000, status: "ok-empty" });
    expect(host.textContent).toContain("Nothing new.");
    expect(host.textContent).not.toContain("Started a helper");
  });
});
