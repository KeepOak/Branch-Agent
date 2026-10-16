import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerAgentWorkspaceAccess, type AgentWorkspaceAccess } from "../../agents/workspace-access.js";
import { agentsDocumentsHandlers } from "./agents-documents.js";

let workspace: string;
const releases: Array<() => void> = [];
const scope = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../agents/agent-scope.js", async (original) => ({
  ...await original<typeof import("../../agents/agent-scope.js")>(),
  listAgentIds: () => ["main"],
  resolveAgentWorkspaceDir: () => scope.directory,
}));
beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "branch-documents-test-"));
  scope.directory = workspace;
});
afterEach(async () => {
  releases.splice(0).forEach(release => release());
  if (path.dirname(workspace) !== path.resolve(os.tmpdir()) || !path.basename(workspace).startsWith("branch-documents-test-")) throw new Error("Unexpected test cleanup path");
  await fs.rm(workspace, { recursive: true, force: true });
});
async function create(overrides: Record<string, unknown> = {}) {
  const respond = vi.fn();
  await agentsDocumentsHandlers["agents.documents.create"]({
    params: { agentId: "main", name: "Conversation.md", content: "# persisted\n\nUnicode: ☀", ...overrides },
    respond,
    context: { getRuntimeConfig: () => ({}) },
  } as never);
  return respond.mock.calls[0];
}
function remote(createFileExclusive?: AgentWorkspaceAccess["bridge"]["createFileExclusive"]) {
  const bridge = { readFile: vi.fn(), writeFile: vi.fn(), stat: vi.fn(), createFileExclusive };
  releases.push(registerAgentWorkspaceAccess(workspace, { bridge }));
  return bridge;
}
it("creates persisted UTF-8 bytes and returns a Library path", async () => {
  const [ok, result] = await create();
  expect(ok).toBe(true);
  expect(result.file.path).toBe("Documents/Conversation.md");
  const bytes = await fs.readFile(path.join(workspace, result.file.path));
  expect(bytes.toString("utf8")).toBe("# persisted\n\nUnicode: ☀");
  expect(result.file.size).toBe(bytes.length);
  expect(result.file.hash).toMatch(/^[a-f0-9]{64}$/);
});
it("never overwrites during concurrent creates", async () => {
  const results = await Promise.all([create({ content: "first" }), create({ content: "second" })]);
  expect(results.map(r => r[0])).toEqual([true, false]);
  expect(results[1][2].details.type).toBe("document_conflict");
  expect(await fs.readFile(path.join(workspace, "Documents/Conversation.md"), "utf8")).toBe("first");
});
it.each(["../escape.md", "C:\\escape.md", "nested/file.md", "NUL.md", "x.", "x ", ".", "\u0000.md"])("rejects nonportable name %j", async name => {
  expect((await create({ name }))[0]).toBe(false);
  expect(await fs.readdir(workspace)).toEqual([]);
});
it("rejects an unknown Trunk and additional wire parameters", async () => {
  expect((await create({ agentId: "other" }))[0]).toBe(false);
  expect((await create({ destination: "elsewhere" }))[0]).toBe(false);
});
it("rejects a linked Documents directory", async () => {
  const target = path.join(workspace, "outside");
  await fs.mkdir(target);
  await fs.symlink(target, path.join(workspace, "Documents"), process.platform === "win32" ? "junction" : "dir");
  expect((await create())[0]).toBe(false);
  expect(await fs.readdir(target)).toEqual([]);
});
it("uses remote exclusive creation and refuses a collision", async () => {
  const exclusive = vi.fn().mockResolvedValueOnce("created").mockResolvedValueOnce("exists");
  const bridge = remote(exclusive);
  expect((await create())[0]).toBe(true);
  expect(exclusive).toHaveBeenCalledWith({ filePath: "Documents/Conversation.md", data: "# persisted\n\nUnicode: ☀", mkdir: true });
  expect((await create())[0]).toBe(false);
  expect(bridge.writeFile).not.toHaveBeenCalled();
  expect(await fs.readdir(workspace)).toEqual([]);
});
it("refuses a provider without exclusive creation without a local fallback", async () => {
  const bridge = remote();
  expect((await create())[2].message).toContain("cannot safely create");
  expect(bridge.writeFile).not.toHaveBeenCalled();
  expect(await fs.readdir(workspace)).toEqual([]);
});
it("does not report success after provider ownership ends during a write", async () => {
  remote(async () => { releases[0](); return "created"; });
  expect((await create())[0]).toBe(false);
  expect(await fs.readdir(workspace)).toEqual([]);
});

// Card #1095, walkthrough B-073: "Write a new document" opens a document you can type in, so its text can be saved.
async function save(overrides: Record<string, unknown> = {}) {
  const respond = vi.fn();
  await agentsDocumentsHandlers["agents.documents.set"]({
    params: { agentId: "main", name: "Conversation.md", content: "Shopping: eggs", expectedHash: EMPTY, ...overrides },
    respond,
    context: { getRuntimeConfig: () => ({}) },
  } as never);
  return respond.mock.calls[0];
}
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
it("saves typed text into a new blank document and returns its new hash", async () => {
  expect((await create({ content: "" }))[0]).toBe(true);
  const [ok, result] = await save();
  expect(ok).toBe(true);
  expect(result.file).toMatchObject({ name: "Conversation.md", path: "Documents/Conversation.md", size: 14 });
  expect(await fs.readFile(path.join(workspace, "Documents/Conversation.md"), "utf8")).toBe("Shopping: eggs");
  const [again] = await save({ content: "Shopping: eggs, milk", expectedHash: result.file.hash });
  expect(again).toBe(true);
  expect(await fs.readFile(path.join(workspace, "Documents/Conversation.md"), "utf8")).toBe("Shopping: eggs, milk");
});
it("never overwrites a document that changed since it was opened, and never creates one", async () => {
  expect((await create({ content: "changed by a Trunk" }))[0]).toBe(true);
  const changed = await save();
  expect(changed[0]).toBe(false);
  expect(changed[2].details.type).toBe("document_changed");
  expect(await fs.readFile(path.join(workspace, "Documents/Conversation.md"), "utf8")).toBe("changed by a Trunk");
  const missing = await save({ name: "Gone.md" });
  expect(missing[2].details.type).toBe("document_missing");
  await expect(fs.stat(path.join(workspace, "Documents/Gone.md"))).rejects.toThrow();
});
it("saves only a portable name in Documents, through a remote workspace when there is one", async () => {
  expect((await save({ name: "../escape.md" }))[0]).toBe(false);
  expect((await save({ destination: "elsewhere" }))[0]).toBe(false);
  const bridge = remote();
  bridge.stat.mockResolvedValue({ size: 0 });
  bridge.readFile.mockResolvedValue(Buffer.alloc(0));
  expect((await save())[0]).toBe(true);
  expect(bridge.writeFile).toHaveBeenCalledWith({ filePath: "Documents/Conversation.md", data: "Shopping: eggs", mkdir: false });
});
