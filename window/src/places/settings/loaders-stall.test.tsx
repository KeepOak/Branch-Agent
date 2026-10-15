// @vitest-environment jsdom
// Every Settings loader that reads the engine must stop waiting when the engine never answers: the read says so after
// STALL_MS, and nothing above it stays on "Looking…", "Loading…", "Counting…" or "Checking…".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { useMemoryFiles } from "../library/memory-data";
import { useResource as useLibraryResource } from "../library/data";
import { GitHubConnection } from "./github-connection";
import { LocalBlock } from "./set1/local";
import { ConfigStore } from "./config-store";
import { UsagePage } from "./set2/usage";
import { STALL_MS, STALL_TEXT } from "./stall";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** An engine whose named methods never answer; every other method answers `{}`. */
function engineWithSilent(silent: string[], replies: Record<string, unknown> = {}): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (silent.includes(method)) return new Promise<never>(() => undefined);
    return replies[method] ?? {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const textNow = () => host.textContent ?? "";

describe("config.get that never answers", () => {
  it("stops the settings store loading and shows the stall line", async () => {
    const store = new ConfigStore(engineWithSilent(["config.get"]));
    void store.load();
    expect(store.error).toBeUndefined();
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    expect(store.error).toBe(STALL_TEXT);
  });

  it("a late answer clears the stall line and keeps the settings", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const engine = { request: vi.fn(() => new Promise((resolve) => { answer = resolve; })), onEvent: () => () => undefined, scopes: [] } as unknown as WindowEngine;
    const store = new ConfigStore(engine);
    void store.load();
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    expect(store.error).toBe(STALL_TEXT);
    await act(async () => { answer({ hash: "h1", valid: true, config: { a: 1 } }); });
    expect(store.error).toBeUndefined();
    expect(store.snap?.hash).toBe("h1");
  });
});

function LibraryProbe({ engine }: { engine: WindowEngine }) {
  const read = useLibraryResource<unknown>(engine, "agents.files.get", { agentId: "a", name: "USER.md" });
  return <p>{read.loading ? "Loading…" : read.error ?? "answered"}</p>;
}

describe("Library reads that never answer", () => {
  it("About you stops loading and says so", async () => {
    await act(async () => root.render(<LibraryProbe engine={engineWithSilent(["agents.files.get"])} />));
    expect(textNow()).toContain("Loading…");
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    expect(textNow()).toBe(STALL_TEXT);
  });

  it("one Trunk's MEMORY.md that never answers does not hold up the other Trunks", async () => {
    const engine = {
      request: vi.fn(async (method: string, params: { agentId?: string } = {}) => {
        if (method !== "agents.files.get") return {};
        if (params.agentId === "stuck") return new Promise<never>(() => undefined);
        return { file: { name: "MEMORY.md", path: "MEMORY.md", content: "- Likes tea", missing: false } };
      }),
      onEvent: () => () => undefined, scopes: [],
    } as unknown as WindowEngine;
    function Probe() {
      const { files } = useMemoryFiles(engine, [{ id: "ok", name: "Ready one" }, { id: "stuck", name: "Stuck one" }]);
      return <p>{files === null ? "Loading…" : files.map((f) => `${f.agentId}:${f.error ?? f.facts.length}`).join(" ")}</p>;
    }
    await act(async () => root.render(<Probe />));
    await flush();
    expect(textNow()).toContain("Loading…");
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    await flush();
    expect(textNow()).toBe(`ok:1 stuck:${STALL_TEXT}`);
  });
});

describe("Devices and local runtimes that never answer", () => {
  const props = { page: "local", title: "On this computer", level: "regular" as const };

  it("the Runtime tile says it could not check, not that none were found", async () => {
    const engine = engineWithSilent(["branch.setup.detect"], { "system.info": {}, "models.list": { models: [] }, "config.get": { hash: "h", valid: true, config: {} } });
    await act(async () => root.render(<LocalBlock {...props} engine={engine} part="hardware" />));
    await flush();
    expect(textNow()).toContain("Looking…");
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    await flush();
    expect(textNow()).toContain("Couldn’t check");
    expect(textNow()).not.toContain("None found");
    expect(textNow()).not.toContain("Looking…");
  });

  it("Recommended for you stops looking and offers Try again", async () => {
    const engine = engineWithSilent(["branch.setup.detect"], { "models.list": { models: [] }, "config.get": { hash: "h", valid: true, config: {} } });
    await act(async () => root.render(<LocalBlock {...props} engine={engine} part="recommended" />));
    await flush();
    expect(textNow()).toContain("Looking for what this computer can run…");
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    await flush();
    expect(textNow()).not.toContain("Looking for what this computer can run…");
    expect(textNow()).toContain(STALL_TEXT);
  });
});

describe("GitHub status that never answers", () => {
  it("leaves the Checking state with the stall line", async () => {
    const connection = new GitHubConnection(engineWithSilent(["tools.github.status"]), "main", "agent", () => undefined);
    void connection.refresh();
    expect(connection.view.phase).toBe("loading");
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    expect(connection.view.phase).toBe("ready");
    expect(connection.view.error).toBe(STALL_TEXT);
  });
});

describe("Usage report that never counts", () => {
  it("shows the stall line and keeps Export off while it counts", async () => {
    const engine = engineWithSilent(["sessions.usage"], { "config.get": { hash: "h", valid: true, config: {} } });
    await act(async () => root.render(<UsagePage page="usage" title="Data & usage" level="regular" engine={engine} />));
    await flush();
    const open = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Open the report");
    expect(open).toBeTruthy();
    await act(async () => { open?.click(); });
    await flush();
    expect(textNow()).toContain("Counting…");
    const exportButton = () => [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent?.trim() === "Export") as HTMLButtonElement | undefined;
    expect(exportButton()?.disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(STALL_MS); });
    await flush();
    expect(document.body.textContent).not.toContain("Counting…");
    expect(document.body.textContent).toContain(STALL_TEXT);
    expect(exportButton()?.disabled).toBe(true);
  });
});
