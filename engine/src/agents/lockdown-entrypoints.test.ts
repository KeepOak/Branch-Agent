// A fresh or restarted engine that finds Lockdown in its config file refuses every run and every send,
// before it has committed any runtime config of its own.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockdownError, testing } from "../config/lockdown.js";
import { clearRuntimeConfigSnapshot } from "../config/runtime-snapshot.js";
import { deliverOutboundPayloadsCore } from "../infra/outbound/deliver-core.js";
import { runCliAgent } from "./cli-runner.js";
import { runEmbeddedAgent } from "./embedded-agent-runner/run-orchestrator.js";

describe("run and send entry points under Lockdown from the config file", () => {
  let dir: string;
  const previous = process.env.BRANCH_CONFIG_PATH;
  beforeEach(() => {
    clearRuntimeConfigSnapshot();
    testing.resetFileCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockdown-entry-"));
    process.env.BRANCH_CONFIG_PATH = path.join(dir, "branch.json");
    fs.writeFileSync(process.env.BRANCH_CONFIG_PATH, JSON.stringify({ security: { lockdown: true } }));
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.BRANCH_CONFIG_PATH;
    else process.env.BRANCH_CONFIG_PATH = previous;
    testing.resetFileCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The params are never read: a refusal must come first, as a rejected promise rather than a synchronous throw.
  const unread = new Proxy({}, { get: () => { throw new Error("params were read"); } });

  it("refuses an embedded run (chat, channel inbound, cron, hooks, subagents)", async () => {
    const run = runEmbeddedAgent(unread as never);
    await expect(run).rejects.toBeInstanceOf(LockdownError);
  });

  it("refuses a CLI run", async () => {
    await expect(runCliAgent(unread as never)).rejects.toBeInstanceOf(LockdownError);
  });

  it("refuses outbound delivery", async () => {
    await expect(deliverOutboundPayloadsCore(unread as never)).rejects.toBeInstanceOf(LockdownError);
  });
});
