// Always-ask floor on interactive input (security review of PR #1278, finding 1). The sessions here
// are fixtures with a recording stdin: no process exists and nothing written is ever run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSession } from "./bash-process-registry.js";
import { createProcessSessionFixture } from "./bash-process-registry.test-helpers.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.test-support.js";
import { createProcessTool } from "./bash-tools.process.js";
import { callGatewayTool } from "./tools/gateway.js";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(),
  readGatewayCallOptions: vi.fn(() => ({})),
}));

const APPROVAL_CALLS = ["exec.approval.request", "exec.approval.waitDecision"];

function mockApprovalGateway(decision: "allow-once" | "deny" | null): string[] {
  const calls: string[] = [];
  vi.mocked(callGatewayTool).mockImplementation(async (method) => {
    calls.push(method);
    if (method === "exec.approval.request") {
      return { status: "accepted", id: "approval-id" };
    }
    if (method === "exec.approval.waitDecision") {
      return { decision };
    }
    return { ok: true };
  });
  return calls;
}

function ptyShellFixture() {
  const session = createProcessSessionFixture({
    id: "pty-shell",
    command: "sh",
    backgrounded: true,
  });
  const written: string[] = [];
  session.stdin = {
    write: vi.fn((data: string | Buffer, callback?: (err?: Error | null) => void) => {
      written.push(typeof data === "string" ? data : data.toString("utf8"));
      callback?.();
    }),
    end: vi.fn(),
  } as unknown as NonNullable<typeof session.stdin>;
  addSession(session);
  return { session, written, tool: createProcessTool() };
}

describe("process input always-ask floor", () => {
  beforeEach(() => {
    resetProcessRegistryForTests();
    vi.mocked(callGatewayTool).mockReset();
  });

  afterEach(() => {
    resetProcessRegistryForTests();
  });

  it("asks before a floor command written to a pty shell and sends nothing on deny", async () => {
    const calls = mockApprovalGateway("deny");
    const { tool, written } = ptyShellFixture();

    const result = await tool.execute("write-floor", {
      action: "write",
      sessionId: "pty-shell",
      data: "rm -rf /etc/\n",
    });

    expect(calls).toEqual(APPROVAL_CALLS);
    expect(written).toEqual([]);
    expect(result.details).toMatchObject({ status: "failed" });
  });

  it("requests the input approval with ask always and no allow-always", async () => {
    mockApprovalGateway("deny");
    const { tool } = ptyShellFixture();

    await tool.execute("write-floor-ask", {
      action: "write",
      sessionId: "pty-shell",
      data: "/bin/rm -rf /\n",
    });

    const request = vi
      .mocked(callGatewayTool)
      .mock.calls.find(([method]) => method === "exec.approval.request");
    expect(request?.[2]).toMatchObject({
      ask: "always",
      unavailableDecisions: ["allow-always"],
      command: "/bin/rm -rf /",
    });
  });

  it("writes the input only after an allow-once", async () => {
    const calls = mockApprovalGateway("allow-once");
    const { tool, written } = ptyShellFixture();

    await tool.execute("write-floor-allowed", {
      action: "write",
      sessionId: "pty-shell",
      data: "rm -rf /etc/\n",
    });

    expect(calls).toEqual(APPROVAL_CALLS);
    expect(written).toEqual(["rm -rf /etc/\n"]);
  });

  it("checks a line built across writes when submit completes it", async () => {
    const calls = mockApprovalGateway("deny");
    const { tool, written } = ptyShellFixture();

    await tool.execute("part-1", { action: "write", sessionId: "pty-shell", data: "rm -rf /et" });
    await tool.execute("part-2", { action: "write", sessionId: "pty-shell", data: "c/" });
    const result = await tool.execute("submit", { action: "submit", sessionId: "pty-shell" });

    expect(calls).toEqual(APPROVAL_CALLS);
    expect(written).toEqual(["rm -rf /et", "c/"]);
    expect(result.details).toMatchObject({ status: "failed" });
  });

  it("asks before a pasted floor command", async () => {
    const calls = mockApprovalGateway("deny");
    const { tool, written } = ptyShellFixture();

    await tool.execute("paste-floor", {
      action: "paste",
      sessionId: "pty-shell",
      text: "rm -rf /Users\n",
    });

    expect(calls).toEqual(APPROVAL_CALLS);
    expect(written).toEqual([]);
  });

  it("asks before send-keys types and enters a floor command", async () => {
    const calls = mockApprovalGateway("deny");
    const { tool, written } = ptyShellFixture();

    const result = await tool.execute("keys-floor", {
      action: "send-keys",
      sessionId: "pty-shell",
      literal: "diskutil eraseDisk JHFS+ X /dev/disk2",
      keys: ["Enter"],
    });

    expect(calls).toEqual(APPROVAL_CALLS);
    expect(written).toEqual([]);
    expect(result.details).toMatchObject({ status: "failed" });
  });

  it("applies backspace editing before checking the line", async () => {
    const calls = mockApprovalGateway("deny");
    const { tool, written } = ptyShellFixture();

    await tool.execute("edit-floor", {
      action: "write",
      sessionId: "pty-shell",
      data: "rm -rf /etcX\x7f\n",
    });

    expect(calls).toEqual(APPROVAL_CALLS);
    expect(written).toEqual([]);
  });

  it("joins a backslash-continued line before checking it", async () => {
    const calls = mockApprovalGateway("deny");
    const { tool, written } = ptyShellFixture();

    await tool.execute("cont-1", { action: "write", sessionId: "pty-shell", data: "rm -rf \\\n" });
    await tool.execute("cont-2", { action: "write", sessionId: "pty-shell", data: "/etc\n" });

    expect(calls).toEqual(APPROVAL_CALLS);
    expect(written).toEqual(["rm -rf \\\n"]);
  });

  it("writes ordinary input without asking", async () => {
    mockApprovalGateway("deny");
    const { tool, written } = ptyShellFixture();

    await tool.execute("plain", { action: "write", sessionId: "pty-shell", data: "ls -la\n" });

    expect(callGatewayTool).not.toHaveBeenCalled();
    expect(written).toEqual(["ls -la\n"]);
  });
});
