import { expect, it } from "vitest";
import { projectNormalizedToolItem } from "./event-projector-events.js";
import type { CodexThreadItem } from "./protocol.js";

it("includes captured native command output in the live tool result", () => {
  const item = {
    id: "command-1", type: "commandExecution", status: "completed", command: "pnpm -C window typecheck",
    exitCode: 0, aggregatedOutput: "window strict type check passed",
  } as CodexThreadItem;
  const projected = projectNormalizedToolItem({ phase: "result", item });
  expect(projected?.event?.data).toMatchObject({
    phase: "result", name: "bash", toolCallId: "command-1",
    result: { exitCode: 0, output: "window strict type check passed" },
  });
});
