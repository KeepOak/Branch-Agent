import { nativeCodexToolFailureText } from "./event-projector-tool-failure.js";
import { itemToolError, itemTranscriptResultText } from "./event-projector-tool-items.js";
import {
  buildEmptyToolTelemetry,
  createProjector,
  expect,
  forCurrentTurn,
  it,
  registerCodexEventProjectorTestLifecycle,
} from "./event-projector.test-harness.js";
import type { CodexThreadItem } from "./protocol.js";

registerCodexEventProjectorTestLifecycle();

function failedCommand(aggregatedOutput: string | null): CodexThreadItem {
  return {
    id: "command",
    type: "commandExecution",
    title: null,
    status: "failed",
    name: null,
    tool: null,
    server: null,
    command: "echo diagnostic >&2; exit 7",
    cwd: "/workspace",
    query: null,
    text: "",
    changes: [],
    aggregatedOutput,
    exitCode: 7,
  };
}

it.each(["stderr: permission denied", "", null])(
  "keeps stderr, exit code and execution phase in a failed command transcript (%s)",
  async (aggregatedOutput) => {
    const item = failedCommand(aggregatedOutput);
    const output = new Map([[item.id, "stderr: permission denied"]]);
    const expected = "Command execution failed (exit code 7):\nstderr: permission denied";
    expect(itemToolError(item, "failed", output)).toBe(expected);
    expect(itemTranscriptResultText(item, output)).toBe(expected);
    const projector = await createProjector();
    await projector.handleNotification(
      forCurrentTurn("item/commandExecution/outputDelta", {
        itemId: item.id,
        delta: "stderr: permission denied",
      }),
    );
    await projector.handleNotification(forCurrentTurn("item/completed", { item }));
    expect(
      projector
        .buildResult(buildEmptyToolTelemetry())
        .messagesSnapshot.find((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: true, content: [{ type: "text", text: expected }] });
  },
);

it("keeps the stderr tail of a long failed command within the existing transcript limit", () => {
  const item = failedCommand(`${"stdout line\n".repeat(2_000)}stderr: final diagnostic`);
  const error = itemToolError(item, "failed");
  expect(error).toContain("Command execution failed (exit code 7)");
  expect(error).toContain("stderr: final diagnostic");
  expect(error!.length).toBeLessThanOrEqual(10_000);
});

it.each(["", null, "   "])("uses the generic fallback only without output (%s)", (output) => {
  expect(itemToolError(failedCommand(output), "failed")).toBe("codex native tool failed");
});

it("does not invent an exit code or change successful and blocked command output", () => {
  const item = failedCommand("stderr: spawn failed");
  item.exitCode = null;
  expect(itemToolError(item, "failed")).toBe("Command execution failed:\nstderr: spawn failed");
  expect(itemToolError(item, "blocked")).toBe("codex native tool blocked");
  item.status = "completed";
  expect(itemToolError(item, "completed")).toBeUndefined();
  expect(itemTranscriptResultText(item)).toBe("stderr: spawn failed");
});

it("preserves the short failure reason introduced by PR 845", () => {
  expect(nativeCodexToolFailureText(failedCommand("Permission denied"), "failed")).toBe(
    "Permission denied",
  );
  expect(nativeCodexToolFailureText(failedCommand(null), "failed")).toBe(
    "codex native tool failed",
  );
});
