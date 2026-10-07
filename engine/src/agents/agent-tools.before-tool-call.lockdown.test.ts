/**
 * Lockdown at the last tool boundary: a run that slipped past the runner check (or was already running)
 * cannot act, whatever the tool.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/runtime-snapshot.js";
import { wrapToolWithBeforeToolCallHook } from "./agent-tools.before-tool-call.js";
import type { AnyAgentTool } from "./agent-tools.types.js";

function wrapped(name: string) {
  const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
  const tool = wrapToolWithBeforeToolCallHook({ name, execute } as unknown as AnyAgentTool, {
    runId: "lockdown-run",
    agentId: "main",
    sessionKey: "agent:main:main",
  });
  const run = (params: unknown) =>
    tool.execute("call-1", params, undefined, {} as Parameters<typeof tool.execute>[3]);
  return { execute, run };
}

describe("tool calls under Lockdown", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  it.each(["browser", "web_fetch", "cron", "sessions_spawn", "message"])("blocks %s without running it", async (name) => {
    const { execute, run } = wrapped(name);
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
    const result = await run({});
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain("Lockdown is on: Trunks cannot run or send anything.");
  });

  it("runs the tool once Lockdown is off", async () => {
    const { execute, run } = wrapped("web_fetch");
    await run({});
    expect(execute).toHaveBeenCalledOnce();
  });
});
