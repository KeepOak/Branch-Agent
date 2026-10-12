// Written by Branch for AUTOMATION-0073 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/hooks/bundled/command-logger/handler.ts and HOOK.md; verifies the current safe audit writer.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInternalHookEvent } from "../../internal-hooks.js";
import handler from "./handler.js";

describe("command audit-log hook", () => {
  let stateDir: string;
  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-command-audit-"));
    vi.stubEnv("BRANCH_STATE_DIR", stateDir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("appends command events as JSON lines without overwriting prior records", async () => {
    const first = createInternalHookEvent("command", "new", "agent:main:main", {
      senderId: "alice",
      commandSource: "telegram",
    });
    first.timestamp = new Date("2026-01-16T14:30:00.000Z");
    const second = createInternalHookEvent("command", "stop", "agent:other:main", {});
    second.timestamp = new Date("2026-01-16T15:45:22.000Z");
    await handler(first);
    await handler(second);
    const text = await fs.readFile(path.join(stateDir, "logs", "commands.log"), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(
      text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        timestamp: first.timestamp.toISOString(),
        action: "new",
        sessionKey: first.sessionKey,
        senderId: "alice",
        source: "telegram",
      },
      {
        timestamp: second.timestamp.toISOString(),
        action: "stop",
        sessionKey: second.sessionKey,
        senderId: "unknown",
        source: "unknown",
      },
    ]);
    expect(first.messages).toEqual([]);
    expect(second.messages).toEqual([]);
  });

  it("ignores non-command events without creating the audit directory", async () => {
    await handler(createInternalHookEvent("session", "compact:before", "agent:main:main", {}));
    await expect(fs.stat(path.join(stateDir, "logs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("handles write errors silently without disrupting the command", async () => {
    await fs.writeFile(path.join(stateDir, "logs"), "not a directory");
    const event = createInternalHookEvent("command", "reset", "agent:main:main", {});
    await expect(handler(event)).resolves.toBeUndefined();
    expect(event.messages).toEqual([]);
    expect(await fs.readFile(path.join(stateDir, "logs"), "utf8")).toBe("not a directory");
  });

  it("refuses to append through a symlink to a file outside the audit log", async () => {
    const target = path.join(stateDir, "outside.log");
    await fs.writeFile(target, "preserve this\n");
    await fs.mkdir(path.join(stateDir, "logs"));
    await fs.symlink(target, path.join(stateDir, "logs", "commands.log"));
    await expect(
      handler(createInternalHookEvent("command", "stop", "agent:main:main", {})),
    ).resolves.toBeUndefined();
    expect(await fs.readFile(target, "utf8")).toBe("preserve this\n");
  });
});
