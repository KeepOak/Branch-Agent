import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureHarness, runTool } from "./capture-registration.test-support.js";
import {
  getMemoryInboxRoot,
  listMemoryInbox,
  normalizeInboxProposalPath,
  validateInboxProposalFile,
} from "./memory-inbox.js";

// The CI runner uses worker threads, where the shared-state lock store is unavailable.
vi.mock("./memory-workspace-lock.js", () => ({
  withMemoryWorkspaceLock: async <T>(_workspaceDir: string, task: () => Promise<T>) => await task(),
}));

let root: string;
let workspaceDir: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "memory-inbox-")));
  workspaceDir = path.join(root, "workspace");
  await fs.mkdir(workspaceDir);
  vi.stubEnv("BRANCH_STATE_DIR", path.join(root, "state"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

const review = { memoryReview: { requireApproval: true } };

async function readMemory(): Promise<string> {
  return await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf8").catch(() => "");
}

describe("memory review inbox (MEMORY-0068)", () => {
  it("normalizes inbox paths like gemini's patch inbox", () => {
    expect(normalizeInboxProposalPath("a.json")).toBe("a.json");
    expect(normalizeInboxProposalPath("nested/../b.json")).toBe("b.json");
    expect(normalizeInboxProposalPath("../escape.json")).toBeUndefined();
    expect(normalizeInboxProposalPath("/abs.json")).toBeUndefined();
    expect(normalizeInboxProposalPath("win\\path.json")).toBeUndefined();
    expect(normalizeInboxProposalPath("note.patch")).toBeUndefined();
  });

  it("writes memory directly while review is off (the shipped default)", async () => {
    const harness = createCaptureHarness({ workspaceDir });
    await runTool(harness.tool("memory_write"), { action: "add", content: "Likes tea" });
    expect(await readMemory()).toBe("- Likes tea\n");
    expect(await listMemoryInbox("main")).toEqual([]);
  });

  it("parks proposals that survive a restart, then accepts exactly what was proposed", async () => {
    const harness = createCaptureHarness({ workspaceDir, pluginConfig: review });
    const staged = await runTool(harness.tool("memory_write"), {
      action: "add",
      content: "Ships on Fridays",
      section: "Work",
      path: "memory/work.md",
    });
    expect(staged).toMatchObject({ status: "pending_review", path: "memory/work.md" });
    expect(String(staged.diff)).toContain("+ Ships on Fridays");
    expect(await fs.readFile(path.join(workspaceDir, "memory", "work.md"), "utf8").catch(() => "")).toBe("");

    const restarted = createCaptureHarness({ workspaceDir, pluginConfig: review });
    const listed = await restarted.command("memory-inbox")({ args: "", senderIsOwner: true, agentId: "main" });
    expect(listed.text).toContain(`[${String(staged.id)}] add (memory_write`);
    const [proposal] = await listMemoryInbox("main");
    expect(proposal?.operation).toEqual({
      action: "add",
      path: "memory/work.md",
      content: "Ships on Fridays",
      section: "Work",
    });
    const accepted = await restarted.command("memory-inbox")({
      args: `accept ${String(staged.id)}`,
      senderIsOwner: true,
      agentId: "main",
    });
    expect(accepted.text).toBe(`Accepted ${String(staged.id)}: added in memory/work.md.`);
    expect(await fs.readFile(path.join(workspaceDir, "memory", "work.md"), "utf8")).toBe(
      "## Work\n\n- Ships on Fridays\n",
    );
    expect(await listMemoryInbox("main")).toEqual([]);
  });

  it("rejects proposals through the gateway and keeps duplicates out of the inbox", async () => {
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "- Likes tea\n");
    const harness = createCaptureHarness({ workspaceDir, pluginConfig: review });
    const tool = harness.tool("memory_write");
    expect(await runTool(tool, { action: "add", content: "likes TEA" })).toMatchObject({
      status: "duplicate",
    });
    const staged = await runTool(tool, {
      action: "remove",
      match: "Likes tea",
      reason: "switched to coffee",
    });
    expect(String(staged.diff)).toContain("- Likes tea");
    const listed = await harness.gateway("memory.inbox.list", { agentId: "main" });
    expect((listed.payload as { proposals: unknown[] }).proposals).toHaveLength(1);
    expect(await harness.gateway("memory.inbox.reject", { agentId: "main", id: staged.id })).toMatchObject({
      ok: true,
      payload: { rejected: true },
    });
    expect(await readMemory()).toBe("- Likes tea\n");
    expect((await harness.gateway("memory.inbox.accept", { id: staged.id })).ok).toBe(false);
  });

  it("only lets the owner accept or reject from chat", async () => {
    const harness = createCaptureHarness({ workspaceDir, pluginConfig: review });
    const staged = await runTool(harness.tool("memory_write"), { action: "add", content: "x" });
    const denied = await harness.command("memory-inbox")({
      args: `accept ${String(staged.id)}`,
      senderIsOwner: false,
      agentId: "main",
    });
    expect(denied.text).toContain("requires owner status");
    expect(await listMemoryInbox("main")).toHaveLength(1);
  });

  it("skips invalid proposal files instead of surfacing them", async () => {
    const inboxRoot = getMemoryInboxRoot("main");
    await fs.mkdir(inboxRoot, { recursive: true });
    await fs.writeFile(path.join(inboxRoot, "broken.json"), "{");
    await fs.writeFile(
      path.join(inboxRoot, "outside.json"),
      JSON.stringify({ id: "outside", operation: { action: "add", path: "../SOUL.md", content: "x" } }),
    );
    expect(await validateInboxProposalFile(path.join(inboxRoot, "broken.json"))).toMatchObject({
      valid: false,
    });
    expect(await validateInboxProposalFile(path.join(inboxRoot, "outside.json"))).toEqual({
      valid: false,
      reason: "target file is outside memory files: ../SOUL.md",
    });
    expect(await listMemoryInbox("main")).toEqual([]);
  });
});
