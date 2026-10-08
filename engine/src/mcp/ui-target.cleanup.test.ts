import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), launch: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("playwright-core", () => ({ chromium: { launchPersistentContext: mocks.launch } }));
vi.mock("./desktop-gateway.js", () => ({ desktopDataDirectory: () => "unused" }));
import { openTestInstance, startScratchEngine } from "./ui-target.js";

describe("scratch UI lifecycle (no real engine or browser)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let child: EventEmitter & {
    pid: number | undefined;
    exitCode: number | null;
    signalCode: string | null;
    kill: ReturnType<typeof vi.fn>;
  };
  let autoExit: boolean;
  let browserClose: ReturnType<typeof vi.fn>;
  const exit = () => {
    child.signalCode = "SIGTERM";
    child.emit("exit", null, "SIGTERM");
  };
  const leftovers = () => fs.readdirSync(root).filter((name) => name.startsWith("branch-ui-test-"));

  beforeEach(() => {
    vi.resetAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-ui-cleanup-test-"));
    fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
    env = { BRANCH_UI_TEST_ROOT: root, BRANCH_UI_ENGINE_DIR: root, BRANCH_UI_WINDOW_DIR: root };
    autoExit = true;
    child = Object.assign(new EventEmitter(), {
      pid: 12345 as number | undefined,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn(() => {
        if (autoExit) queueMicrotask(exit);
        return true;
      }),
    });
    mocks.spawn.mockReturnValue(child);
    // Guard the old implementation too: regression runs must never signal a real pid.
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (autoExit) queueMicrotask(exit);
      return true;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    browserClose = vi.fn().mockResolvedValue(undefined);
    mocks.launch.mockImplementation(async (profile: string) => {
      fs.mkdirSync(profile, { recursive: true });
      fs.writeFileSync(path.join(profile, "profile-data"), "test");
      return {
        close: browserClose,
        addInitScript: async () => undefined,
        pages: () => [{ goto: async () => undefined }],
      };
    });
  });

  afterEach(() => {
    exit();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("ui_close leaves no branch-ui-test-* folder across repeated cycles", async () => {
    for (let cycle = 0; cycle < 2; cycle++) {
      child.exitCode = null;
      child.signalCode = null;
      const target = await openTestInstance(env);
      expect(leftovers()).toHaveLength(1);
      await target.close();
      expect(leftovers()).toEqual([]);
    }
    expect(browserClose).toHaveBeenCalledTimes(2);
  });

  it("waits for engine exit before deleting state or resolving close", async () => {
    autoExit = false;
    const target = await openTestInstance(env);
    let closed = false;
    const closing = target.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith("SIGTERM"));
    expect(browserClose).toHaveBeenCalledOnce();
    expect(closed).toBe(false);
    expect(leftovers()).toHaveLength(1);
    exit();
    await closing;
    expect(leftovers()).toEqual([]);
  });

  it("keeps scratch state only with the explicit debug opt-out", async () => {
    const target = await openTestInstance({ ...env, BRANCH_UI_TEST_KEEP: "1" });
    await target.close();
    expect(child.signalCode).toBe("SIGTERM");
    expect(leftovers()).toHaveLength(1);
    expect(
      fs.existsSync(path.join(String(target.describe.scratch), "browser", "profile-data")),
    ).toBe(true);
  });

  it("does not treat BRANCH_UI_TEST_KEEP=0 as an opt-out", async () => {
    const target = await openTestInstance({ ...env, BRANCH_UI_TEST_KEEP: "0" });
    await target.close();
    expect(leftovers()).toEqual([]);
  });

  it("cleans up when opening the browser fails", async () => {
    mocks.launch.mockRejectedValue(new Error("browser failed"));
    await expect(openTestInstance(env)).rejects.toThrow("browser failed");
    expect(child.signalCode).toBe("SIGTERM");
    expect(leftovers()).toEqual([]);
  });

  it("cleans up when locating the window build fails", async () => {
    await expect(
      openTestInstance({ ...env, BRANCH_UI_WINDOW_DIR: path.join(root, "missing") }),
    ).rejects.toThrow("No Branch window build");
    expect(leftovers()).toEqual([]);
  });

  it("cleans up if spawn throws before startup completes", async () => {
    mocks.spawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    await expect(startScratchEngine(env)).rejects.toThrow("spawn failed");
    expect(leftovers()).toEqual([]);
  });

  it("cleans up an engine that exits before readiness", async () => {
    child.exitCode = 1;
    await expect(startScratchEngine(env)).rejects.toThrow("exited with code 1");
    expect(leftovers()).toEqual([]);
  });

  it("handles an asynchronous spawn failure without leaking scratch state", async () => {
    mocks.spawn.mockImplementation(() => {
      child.pid = undefined;
      queueMicrotask(() => child.emit("error", new Error("spawn failed")));
      return child;
    });
    await expect(startScratchEngine(env)).rejects.toThrow("The test Branch engine exited");
    expect(leftovers()).toEqual([]);
  });

  it("still cleans up if closing the browser rejects", async () => {
    const target = await openTestInstance(env);
    browserClose.mockRejectedValue(new Error("browser already gone"));
    await target.close();
    expect(leftovers()).toEqual([]);
  });

  it("honors debug preservation on startup failure", async () => {
    mocks.spawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    await expect(startScratchEngine({ ...env, BRANCH_UI_TEST_KEEP: "1" })).rejects.toThrow(
      "spawn failed",
    );
    expect(leftovers()).toHaveLength(1);
  });

  it("escalates a stuck engine and makes stop idempotent", async () => {
    const engine = await startScratchEngine(env);
    autoExit = false;
    vi.useFakeTimers();
    const stopping = engine.stop();
    const again = engine.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(leftovers()).toHaveLength(1);
    exit();
    await Promise.all([stopping, again]);
    await engine.stop();
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(leftovers()).toEqual([]);
  });
});
