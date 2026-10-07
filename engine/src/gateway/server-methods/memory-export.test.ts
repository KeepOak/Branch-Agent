import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ workspace: "" }));
vi.mock("../../agents/agent-scope.js", async (original) => ({
  ...await original<typeof import("../../agents/agent-scope.js")>(),
  listAgentIds: () => ["main"],
  resolveAgentWorkspaceDir: () => scope.workspace,
}));

import { memorySearchHandlers } from "./memory-search.js";

afterEach(async () => {
  if (!scope.workspace) return;
  if (path.dirname(scope.workspace) !== path.resolve(os.tmpdir()) || !path.basename(scope.workspace).startsWith("branch-memory-export-")) throw new Error("Unexpected test cleanup path");
  await fs.rm(scope.workspace, { recursive: true, force: true });
  scope.workspace = "";
});

it("memory.export returns sorted Markdown files with relative paths and ignores other files", async () => {
  scope.workspace = await fs.mkdtemp(path.join(os.tmpdir(), "branch-memory-export-"));
  await fs.mkdir(path.join(scope.workspace, "memory"));
  await fs.writeFile(path.join(scope.workspace, "MEMORY.md"), "# Main\n");
  await fs.writeFile(path.join(scope.workspace, "memory", "2026-10-01.md"), "# Daily\n");
  await fs.writeFile(path.join(scope.workspace, "memory", "notes.txt"), "Not memory");
  const respond = vi.fn();
  await memorySearchHandlers["memory.export"]({
    req: { method: "memory.export" },
    params: { agentId: "main" },
    respond,
    context: { getRuntimeConfig: () => ({ agents: { entries: { main: {} } } }) },
  } as never);
  expect(respond).toHaveBeenCalledWith(true, {
    agentId: "main",
    files: [
      { path: "MEMORY.md", content: "# Main\n" },
      { path: "memory/2026-10-01.md", content: "# Daily\n" },
    ],
  }, undefined);
});
