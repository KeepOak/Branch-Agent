import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureHarness, runTool } from "./capture-registration.test-support.js";
import {
  findEquivalentMemoryEntry,
  listMemoryEntryLines,
  normalizeFactTextKey,
} from "./fact-write-dedupe.js";
import { collectTranscriptWrites } from "./memory-forget-curated-writes.js";
import { normalizeMemoryWritePath, planMemoryWrite } from "./memory-write.js";

// The CI runner uses worker threads, where the shared-state lock store is
// unavailable; keep the lock's serialization with an in-process queue so the
// file rewrite path and its ordering stay real.
vi.mock("./memory-workspace-lock.js", () => {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    withMemoryWorkspaceLock: async <T>(_workspaceDir: string, task: () => Promise<T>) => {
      const run = tail.then(task, task);
      tail = run.catch(() => undefined);
      return await run;
    },
  };
});

describe("fact write dedupe (MEMORY-0063)", () => {
  it("normalizes case, punctuation and whitespace, unicode-aware", () => {
    expect(normalizeFactTextKey("  The Launch-Code is VIOLET!  ")).toBe("the launch code is violet");
    expect(normalizeFactTextKey("Café  au   lait")).toBe("café au lait");
    expect(normalizeFactTextKey("!!! ...")).toBe("");
  });

  it("finds an equivalent entry in the same file and never matches empty keys", () => {
    const content = "# Memory\n\n- Prefers tea over coffee.\n- Lives in Atlanta\n";
    expect(findEquivalentMemoryEntry(content, "prefers TEA over coffee")?.text).toBe(
      "Prefers tea over coffee.",
    );
    expect(findEquivalentMemoryEntry(content, "Prefers coffee")).toBeNull();
    expect(findEquivalentMemoryEntry(content, "...")).toBeNull();
  });

  it("ignores headings, comments and fenced code when listing entries", () => {
    const entries = listMemoryEntryLines(
      "# Title\n<!-- marker -->\n```\n- code\n```\n* one\n1. two\nplain line\n",
    );
    expect(entries.map((entry) => entry.text)).toEqual(["one", "two", "plain line"]);
  });
});

describe("planMemoryWrite (MEMORY-0019)", () => {
  it("adds under an existing or new section and skips duplicates", () => {
    const base = "# Memory\n\n## Preferences\n\n- Likes tea\n\n## People\n\n- Ana is a friend\n";
    const added = planMemoryWrite(base, {
      action: "add",
      path: "MEMORY.md",
      content: "Dislikes emojis",
      section: "Preferences",
    });
    expect(added.status).toBe("added");
    expect("nextContent" in added && added.nextContent).toContain(
      "- Likes tea\n- Dislikes emojis\n\n## People",
    );
    const fresh = planMemoryWrite(base, {
      action: "add",
      path: "MEMORY.md",
      content: "Ships on Fridays",
      section: "Work",
    });
    expect("nextContent" in fresh && fresh.nextContent.endsWith("## Work\n\n- Ships on Fridays\n")).toBe(true);
    expect(
      planMemoryWrite(base, { action: "add", path: "MEMORY.md", content: "likes TEA." }),
    ).toEqual({ status: "duplicate", existing: "Likes tea" });
  });

  it("updates and removes one matching entry, reporting missing or ambiguous matches", () => {
    const base = "- Lives in Atlanta\n- Works at Acme\n- Works at Acme Labs\n";
    const updated = planMemoryWrite(base, {
      action: "update",
      path: "MEMORY.md",
      match: "lives in atlanta",
      content: "Lives in Decatur",
    });
    expect(updated).toMatchObject({ status: "updated", previous: "Lives in Atlanta" });
    expect("nextContent" in updated && updated.nextContent).toBe(
      "- Lives in Decatur\n- Works at Acme\n- Works at Acme Labs\n",
    );
    expect(
      planMemoryWrite(base, { action: "remove", path: "MEMORY.md", match: "Acme", reason: "left" }),
    ).toMatchObject({ status: "ambiguous" });
    expect(
      planMemoryWrite(base, { action: "remove", path: "MEMORY.md", match: "Paris", reason: "x" }),
    ).toEqual({ status: "not_found", match: "Paris" });
    expect(() =>
      planMemoryWrite(base, { action: "remove", path: "MEMORY.md", match: "Works at Acme" }),
    ).toThrow("reason is required");
    const removed = planMemoryWrite(base, {
      action: "remove",
      path: "MEMORY.md",
      match: "Works at Acme",
      reason: "obsolete",
    });
    expect("nextContent" in removed && removed.nextContent).toBe(
      "- Lives in Atlanta\n- Works at Acme Labs\n",
    );
  });

  it("only allows MEMORY.md, USER.md and memory/*.md inside the workspace", () => {
    expect(normalizeMemoryWritePath(undefined)).toBe("MEMORY.md");
    expect(normalizeMemoryWritePath("memory/people.md")).toBe("memory/people.md");
    expect(() => normalizeMemoryWritePath("../MEMORY.md")).toThrow();
    expect(() => normalizeMemoryWritePath("/etc/passwd")).toThrow();
    expect(() => normalizeMemoryWritePath("SOUL.md")).toThrow();
    expect(() => normalizeMemoryWritePath("memory/notes.txt")).toThrow();
  });
});

describe("memory_write tool", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "memory-write-")));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("is offered only to the owner outside a sandbox", () => {
    const harness = createCaptureHarness({ workspaceDir });
    expect(harness.tool("memory_write")?.name).toBe("memory_write");
    expect(harness.tool("memory_write", { senderIsOwner: false })).toBeNull();
    expect(harness.tool("memory_write", { sandboxed: true })).toBeNull();
  });

  it("adds, dedupes, updates and removes entries in workspace memory files", async () => {
    const harness = createCaptureHarness({ workspaceDir });
    const tool = harness.tool("memory_write");
    expect(await runTool(tool, { action: "add", content: "Prefers short replies" })).toEqual({
      status: "added",
      entry: "Prefers short replies",
      path: "MEMORY.md",
    });
    expect(await runTool(tool, { action: "add", content: "prefers SHORT replies." })).toEqual({
      status: "duplicate",
      existing: "Prefers short replies",
      path: "MEMORY.md",
    });
    await runTool(tool, {
      action: "update",
      match: "Prefers short replies",
      content: "Prefers short replies without emojis",
    });
    await runTool(tool, {
      action: "add",
      path: "memory/people.md",
      section: "People",
      content: "Ana runs the Thursday standup",
    });
    expect(await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf8")).toBe(
      "- Prefers short replies without emojis\n",
    );
    expect(await fs.readFile(path.join(workspaceDir, "memory", "people.md"), "utf8")).toBe(
      "## People\n\n- Ana runs the Thursday standup\n",
    );
    expect(
      await runTool(tool, {
        action: "remove",
        path: "memory/people.md",
        match: "Ana runs the Thursday standup",
        reason: "Ana left the team",
      }),
    ).toMatchObject({ status: "removed", path: "memory/people.md" });
    expect(await fs.readFile(path.join(workspaceDir, "memory", "people.md"), "utf8")).toBe(
      "## People\n\n",
    );
  });

  it("keeps concurrent adds from losing entries", async () => {
    const tool = createCaptureHarness({ workspaceDir }).tool("memory_write");
    await Promise.all(
      ["one", "two", "three"].map((content) => runTool(tool, { action: "add", content })),
    );
    const lines = (await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf8")).trim().split("\n");
    expect(lines.toSorted()).toEqual(["- one", "- three", "- two"]);
  });

  it("is attributed to its session by forget provenance", () => {
    const writes = new Map<string, { relativePath: string; observedAt: number }>();
    collectTranscriptWrites({
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "memory_write", arguments: { action: "add", content: "x" } },
          {
            type: "toolCall",
            name: "memory_write",
            arguments: { action: "add", content: "y", path: "memory/people.md" },
          },
        ],
      },
      observedAt: 5,
      workspaceDir,
      writes,
    });
    expect([...writes.keys()].toSorted()).toEqual(["MEMORY.md", "memory/people.md"]);
  });
});
