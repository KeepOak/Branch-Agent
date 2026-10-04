// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// plugins/plugin-assistant/src/features/working-memory/taskClipboardService.test.ts,
// plugins/plugin-assistant/src/features/working-memory/taskClipboardService.concurrency.test.ts.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureHarness, runTool } from "./capture-registration.test-support.js";
import {
  type AddTaskClipboardItemInput,
  createTaskClipboardService,
  TaskClipboardService,
} from "./task-clipboard.js";

const taskKey = "agent:main:main";
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(path.join(tmpdir(), "branch-task-clipboard-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
});

describe("taskClipboardService", () => {
  it("creates task clipboard service instance", () => {
    const service = createTaskClipboardService({ basePath: "/tmp/test" });
    expect(service).toBeDefined();
    expect(typeof service.addItem).toBe("function");
    expect(typeof service.getItem).toBe("function");
    expect(typeof service.removeItem).toBe("function");
  });
});

describe("TaskClipboardService concurrent store mutations", () => {
  it("persists every item when two adds for one task overlap", async () => {
    const service = new TaskClipboardService({ basePath });
    const results = await Promise.all([
      service.addItem({ content: "alpha", sourceType: "manual" }, taskKey),
      service.addItem({ content: "bravo", sourceType: "manual" }, taskKey),
    ]);
    const persisted = await service.listItems(taskKey);
    expect(persisted.map((item) => item.content).toSorted()).toEqual(["alpha", "bravo"]);
    for (const { item } of results) {
      expect(await service.getItem(item.id, taskKey)).not.toBeNull();
    }
  });

  it("persists every item when the store is filled concurrently", async () => {
    const service = new TaskClipboardService({ basePath });
    const contents = ["one", "two", "three", "four", "five"];
    await Promise.all(
      contents.map((content) => service.addItem({ content, sourceType: "manual" }, taskKey)),
    );
    const persisted = await service.listItems(taskKey);
    expect(persisted.map((item) => item.content).toSorted()).toEqual([...contents].toSorted());
  });

  it("keeps a removal durable against an overlapping add", async () => {
    const service = new TaskClipboardService({ basePath });
    const doomed = await service.addItem({ content: "doomed", sourceType: "manual" }, taskKey);
    await Promise.all([
      service.removeItem(doomed.item.id, taskKey),
      service.addItem({ content: "fresh", sourceType: "manual" }, taskKey),
    ]);
    const persisted = await service.listItems(taskKey);
    expect(persisted.map((item) => item.id)).not.toContain(doomed.item.id);
    expect(persisted.map((item) => item.content)).toContain("fresh");
  });

  it("keeps sequential behaviour unchanged", async () => {
    const service = new TaskClipboardService({ basePath });
    const first = await service.addItem(
      { content: "alpha", sourceType: "command", sourceId: "cmd-1" },
      taskKey,
    );
    const replaced = await service.addItem(
      { content: "alpha-2", sourceType: "command", sourceId: "cmd-1" },
      taskKey,
    );
    expect(replaced.replaced).toBe(true);
    expect(replaced.item.id).toBe(first.item.id);
    const removed = await service.removeItem(first.item.id, taskKey);
    expect(removed.removed).toBe(true);
    expect(removed.snapshot.items).toHaveLength(0);
    const missing = await service.removeItem(first.item.id, taskKey);
    expect(missing.removed).toBe(false);
  });

  it("continues the mutation chain after a rejected operation", async () => {
    const service = new TaskClipboardService({ basePath });
    const rejectedInput: AddTaskClipboardItemInput = {
      content: "rejected",
      get sourceType(): undefined {
        throw new Error("injected mutation failure");
      },
    };
    const rejected = service.addItem(rejectedInput, taskKey);
    const successor = service.addItem({ content: "successor", sourceType: "manual" }, taskKey);
    await expect(rejected).rejects.toThrow("injected mutation failure");
    await expect(successor).resolves.toMatchObject({ item: { content: "successor" } });
    expect((await service.listItems(taskKey)).map((item) => item.content)).toEqual(["successor"]);
  });
});

describe("task_clipboard tool", () => {
  it("keeps items per session under the Branch state dir", async () => {
    vi.stubEnv("BRANCH_STATE_DIR", basePath);
    const harness = createCaptureHarness({ workspaceDir: basePath });
    const first = harness.tool("task_clipboard", { sessionKey: "agent:main:task-1" });
    const other = harness.tool("task_clipboard", { sessionKey: "agent:main:task-2" });
    const added = await runTool(first, {
      action: "add",
      content: "npm test output: 12 passed",
      sourceType: "command",
      sourceId: "npm test",
    });
    const id = (added.item as { id: string }).id;
    expect(await runTool(first, { action: "get", id })).toMatchObject({
      item: { title: "npm test", content: "npm test output: 12 passed" },
    });
    expect(await runTool(other, { action: "list" })).toEqual({ items: [] });
    expect(await runTool(first, { action: "remove", id })).toMatchObject({ removed: true });
    expect(harness.tool("task_clipboard", { sessionKey: undefined })).toBeNull();
  });
});
