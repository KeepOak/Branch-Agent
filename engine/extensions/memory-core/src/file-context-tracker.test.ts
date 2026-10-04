// Adapted from cline/cline@0809928ab28783c0d2b41c1e56edaf0951dadcab apps/vscode/src/core/context/context-tracking/FileContextTracker.test.ts.
// Unit cases mirror Cline's; the wiring cases drive memory-core's registered tool and prompt hooks.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type { BranchPluginApi } from "branch/plugin-sdk/core";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { createPluginRuntimeMock } from "branch/plugin-sdk/plugin-test-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileContextTracker, formatRecentlyModifiedFilesNotice } from "./file-context-tracker.js";

vi.mock("./runtime-provider.js", () => ({
  createMemoryRuntime: vi.fn(() => ({
    authorizeSearchHits: vi.fn(async ({ hits }: { hits: unknown[] }) => hits),
    closeAllMemorySearchManagers: vi.fn(async () => {}),
    closeMemorySearchManager: vi.fn(async () => {}),
    getMemorySearchManager: vi.fn(async () => null),
  })),
  memoryRuntime: {
    closeAllMemorySearchManagers: vi.fn(async () => {}),
    closeMemorySearchManager: vi.fn(async () => {}),
    getMemorySearchManager: vi.fn(async () => null),
  },
}));

import plugin from "../index.js";

describe("FileContextTracker", () => {
  const filePath = "src/test-file.ts";
  let snapshot: { mtimeMs: number; size: number } | null;
  let tracker: FileContextTracker;

  beforeEach(() => {
    snapshot = { mtimeMs: 1, size: 10 };
    tracker = new FileContextTracker("agent:main:main", {
      resolvePath: (file) => path.resolve("/mock/workspace", file),
      statFile: async () => (snapshot ? { ...snapshot } : null),
    });
  });

  it("should add a record when a file is read by a tool", async () => {
    await tracker.trackFileContext(filePath, "read_tool");
    expect(tracker.filesInContext).toHaveLength(1);
    const fileEntry = tracker.filesInContext[0]!;
    expect(fileEntry.path).toBe(filePath);
    expect(fileEntry.record_state).toBe("active");
    expect(fileEntry.record_source).toBe("read_tool");
    expect(typeof fileEntry.agent_read_date).toBe("number");
    expect(fileEntry.agent_edit_date).toBeNull();
  });

  it("should add a record when a file is edited by the agent", async () => {
    await tracker.trackFileContext(filePath, "agent_edited");
    const activeEntry = tracker.filesInContext.find(
      (entry) => entry.path === filePath && entry.record_state === "active",
    );
    expect(activeEntry?.record_source).toBe("agent_edited");
    expect(typeof activeEntry?.agent_read_date).toBe("number");
    expect(typeof activeEntry?.agent_edit_date).toBe("number");
  });

  it("should add a record when a file is mentioned", async () => {
    await tracker.trackFileContext(filePath, "file_mentioned");
    const fileEntry = tracker.filesInContext[0]!;
    expect(fileEntry.record_source).toBe("file_mentioned");
    expect(typeof fileEntry.agent_read_date).toBe("number");
    expect(fileEntry.agent_edit_date).toBeNull();
  });

  it("should add a record when a file is edited by the user", async () => {
    await tracker.trackFileContext(filePath, "user_edited");
    const fileEntry = tracker.filesInContext[0]!;
    expect(fileEntry.record_source).toBe("user_edited");
    expect(typeof fileEntry.user_edit_date).toBe("number");
    expect(tracker.getAndClearRecentlyModifiedFiles()).toContain(filePath);
  });

  it("should mark existing entries as stale when adding a new entry for the same file", async () => {
    await tracker.trackFileContext(filePath, "read_tool");
    await tracker.trackFileContext(filePath, "agent_edited");
    expect(tracker.filesInContext).toHaveLength(2);
    expect(tracker.filesInContext[0]?.record_state).toBe("stale");
    expect(tracker.filesInContext[1]?.record_state).toBe("active");
    expect(tracker.filesInContext[1]?.record_source).toBe("agent_edited");
  });

  it("should track user edits when the file changes after it was tracked", async () => {
    await tracker.trackFileContext(filePath, "read_tool");
    snapshot = { mtimeMs: 2, size: 12 };
    await tracker.detectExternalChanges();
    expect(tracker.filesInContext.at(-1)?.record_source).toBe("user_edited");
    expect(tracker.getAndClearRecentlyModifiedFiles()).toContain(filePath);
  });

  it("should not track agent edits as user edits", async () => {
    await tracker.trackFileContext(filePath, "read_tool");
    snapshot = { mtimeMs: 2, size: 12 };
    await tracker.trackFileContext(filePath, "agent_edited");
    await tracker.detectExternalChanges();
    expect(tracker.getAndClearRecentlyModifiedFiles()).not.toContain(filePath);
  });

  it("returns and clears the recently modified set", async () => {
    await tracker.trackFileContext(filePath, "user_edited");
    expect(tracker.getAndClearRecentlyModifiedFiles()).toEqual([filePath]);
    expect(tracker.getAndClearRecentlyModifiedFiles()).toEqual([]);
  });

  it("formats Cline's recently modified files notice", () => {
    expect(formatRecentlyModifiedFilesNotice([])).toBeUndefined();
    expect(formatRecentlyModifiedFilesNotice(["a.ts"])).toContain(
      "These files have been modified since you last accessed them",
    );
  });
});

type HookHandler = (event: unknown, ctx: unknown) => unknown;

describe("memory-core stale file context hooks", () => {
  let workspace: string;
  let hooks: Map<string, HookHandler[]>;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "branch-file-context-"));
    const config = {
      agents: { defaults: { workspace } },
    } as unknown as BranchConfig;
    hooks = new Map();
    plugin.register(
      createTestPluginApi({
        config,
        runtime: createPluginRuntimeMock({
          llm: { acquireLocalService: async () => undefined },
          state: {
            openKeyedStore: vi.fn(() => ({
              lookup: vi.fn(),
              register: vi.fn(),
              delete: vi.fn(),
              list: vi.fn(),
            })),
          },
          config: { current: () => config },
        } as unknown as BranchPluginApi["runtime"]),
        on(hookName: string, handler: HookHandler) {
          hooks.set(hookName, [...(hooks.get(hookName) ?? []), handler]);
        },
      } as never),
    );
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function fire(hookName: string, event: unknown, ctx: unknown): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const handler of hooks.get(hookName) ?? []) {
      results.push(await handler(event, ctx));
    }
    return results;
  }

  async function promptContext(sessionKey: string): Promise<string | undefined> {
    const results = await fire(
      "before_prompt_build",
      { prompt: "next", messages: [] },
      { sessionKey, agentId: "main", trigger: "user" },
    );
    return results
      .map((result) => (result as { prependContext?: string } | undefined)?.prependContext)
      .find((text) => text?.includes("Recently Modified Files"));
  }

  it("tells the agent about a file the user changed after the agent read it", async () => {
    const sessionKey = "agent:main:main";
    await fs.writeFile(path.join(workspace, "notes.md"), "one\n");
    await fire(
      "after_tool_call",
      { toolName: "read", params: { path: "notes.md" } },
      { sessionKey, agentId: "main", toolName: "read" },
    );
    expect(await promptContext(sessionKey)).toBeUndefined();

    await fs.writeFile(path.join(workspace, "notes.md"), "one\ntwo changed by the user\n");
    const notice = await promptContext(sessionKey);
    expect(notice).toContain("# Recently Modified Files");
    expect(notice).toContain("notes.md");
    expect(await promptContext(sessionKey)).toBeUndefined();
  });

  it("does not report the agent's own edits and forgets the session on reset", async () => {
    const sessionKey = "agent:main:other";
    const file = path.join(workspace, "plan.md");
    await fs.writeFile(file, "draft\n");
    await fire(
      "after_tool_call",
      { toolName: "read", params: { file_path: file } },
      { sessionKey, agentId: "main", toolName: "read" },
    );
    await fs.writeFile(file, "draft edited by the agent\n");
    await fire(
      "after_tool_call",
      { toolName: "edit", params: { path: file } },
      { sessionKey, agentId: "main", toolName: "edit" },
    );
    expect(await promptContext(sessionKey)).toBeUndefined();

    await fire("before_reset", {}, { sessionKey, agentId: "main" });
    await fs.writeFile(file, "changed after reset\n");
    expect(await promptContext(sessionKey)).toBeUndefined();
  });
});
