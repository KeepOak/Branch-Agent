import {
  buildEmptyToolTelemetry,
  createProjector,
  expect,
  forCurrentTurn,
  it,
  registerCodexEventProjectorTestLifecycle,
  turnCompleted,
} from "./event-projector.test-harness.js";

registerCodexEventProjectorTestLifecycle();

type Projector = Awaited<ReturnType<typeof createProjector>>;

function recordStep(
  projector: Projector,
  success = false,
  reason = "Connection refused",
  id = "step-1",
) {
  projector.recordDynamicToolCall({ callId: id, tool: "browser", arguments: { action: "open" } });
  projector.recordDynamicToolResult({
    callId: id,
    tool: "browser",
    success,
    contentItems: [{ type: "inputText", text: reason }],
  });
}

async function finish(projector: Projector, text = "Done") {
  await projector.handleNotification(
    forCurrentTurn("item/completed", {
      item: { id: "answer", type: "agentMessage", phase: "final_answer", text },
    }),
  );
  await projector.handleNotification(turnCompleted());
  return projector.buildResult(buildEmptyToolTelemetry());
}

it("keeps a short redacted failure reason on the transcript step", async () => {
  const projector = await createProjector();
  recordStep(projector, false, "Authorization failed: token=super-secret-token-value\nStack trace");
  const result = await finish(projector);
  const step = result.messagesSnapshot.find((message) => message.role === "toolResult");
  expect(step).toMatchObject({
    isError: true,
    details: { failureReason: expect.stringContaining("Authorization failed") },
  });
  if (step?.role !== "toolResult") {
    throw new Error("Missing tool result");
  }
  expect(JSON.stringify(step.details)).not.toContain("super-secret-token-value");
  expect(JSON.stringify(step.details)).not.toContain("Stack trace");
  expect(result.assistantTexts.join("\n")).not.toContain("super-secret-token-value");
});

it("lists an unmentioned failed step in the final reply and transcript", async () => {
  const projector = await createProjector();
  recordStep(projector);
  const result = await finish(projector);
  const expected = "Done\n\n1 step failed: browser — Connection refused";
  expect(result.assistantTexts).toEqual([expected]);
  expect(result.lastAssistant?.content).toEqual([{ type: "text", text: expected }]);
  expect(result.currentAttemptAssistant?.content).toEqual([{ type: "text", text: expected }]);
  expect(result.messagesSnapshot.at(-1)?.content).toEqual([{ type: "text", text: expected }]);
  expect(projector.buildResult(buildEmptyToolTelemetry()).assistantTexts).toEqual([expected]);
});

it("leaves a run with no failed steps unchanged", async () => {
  const projector = await createProjector();
  recordStep(projector, true, "Opened");
  const result = await finish(projector);
  expect(result.assistantTexts).toEqual(["Done"]);
  expect(result.lastAssistant?.content).toEqual([{ type: "text", text: "Done" }]);
});

it("does not repeat a failure already mentioned in the reply", async () => {
  const projector = await createProjector();
  recordStep(projector);
  const text = "Browser could not open the page: connection refused.";
  expect((await finish(projector, text)).assistantTexts).toEqual([text]);
});

it("recognizes a paraphrased failure but not a bare tool name", async () => {
  const projector = await createProjector();
  recordStep(projector);
  const text = "The browser failed to connect, so I used the cached page.";
  expect((await finish(projector, text)).assistantTexts).toEqual([text]);
  const unmentioned = await createProjector();
  recordStep(unmentioned);
  expect((await finish(unmentioned, "I used browser for the page.")).assistantTexts[0]).toContain(
    "1 step failed:",
  );
});

it("only lists unmentioned failures when multiple steps failed", async () => {
  const projector = await createProjector();
  recordStep(projector);
  recordStep(projector, false, "Page not found", "step-2");
  const text = "Browser failed on the first page: connection refused.";
  expect((await finish(projector, text)).assistantTexts).toEqual([
    `${text}\n\n1 step failed: browser — Page not found`,
  ]);
});

it.each([
  "I used browser to gather docs before the deployment failed.",
  "I used browser to gather docs, but deployment failed.",
  "The deployment failed before I used browser to gather docs.",
  "The browserless deployment failed.",
])("keeps the browser failure when only another operation failed: %s", async (text) => {
  const projector = await createProjector();
  recordStep(projector);
  expect((await finish(projector, text)).assistantTexts).toEqual([
    `${text}\n\n1 step failed: browser — Connection refused`,
  ]);
});

it.each([
  "The browser could not connect, so I used cached docs.",
  "I was unable to use browser, so I used cached docs.",
  "The browser connection failed, so I used cached docs.",
])("preserves genuine tool failure paraphrases: %s", async (text) => {
  const projector = await createProjector();
  recordStep(projector);
  expect((await finish(projector, text)).assistantTexts).toEqual([text]);
});

it("preserves a silent token and keeps the failure reason on the step", async () => {
  const projector = await createProjector();
  recordStep(projector);
  const result = await finish(projector, "NO_REPLY");
  expect(result.assistantTexts).toEqual(["NO_REPLY"]);
  expect(result.currentAttemptAssistant?.content).toEqual([{ type: "text", text: "NO_REPLY" }]);
  expect(result.lastAssistant?.content).toEqual([{ type: "text", text: "NO_REPLY" }]);
  expect(result.messagesSnapshot.at(-1)?.content).toEqual([{ type: "text", text: "NO_REPLY" }]);
  expect(result.messagesSnapshot.find((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
    details: { failureReason: "Connection refused" },
  });
});

it("lists at most three of five distinct failures", async () => {
  const projector = await createProjector();
  for (let index = 1; index <= 5; index++) {
    recordStep(projector, false, `Failure ${index}`, `step-${index}`);
  }
  expect((await finish(projector)).assistantTexts).toEqual([
    "Done\n\n5 steps failed: browser — Failure 1; browser — Failure 2; browser — Failure 3; and 2 more",
  ]);
});

it("collapses repeated tool and reason pairs before counting and capping", async () => {
  const projector = await createProjector();
  for (let index = 1; index <= 5; index++) {
    recordStep(projector, false, "Connection refused", `step-${index}`);
  }
  expect((await finish(projector)).assistantTexts).toEqual([
    "Done\n\n1 step failed: browser — Connection refused",
  ]);
  const mixed = await createProjector();
  for (let index = 1; index <= 5; index++) {
    recordStep(mixed, false, `Failure ${index}`, `step-${index}`);
  }
  recordStep(mixed, false, "Failure 1", "repeat");
  expect((await finish(mixed)).assistantTexts).toEqual([
    "Done\n\n5 steps failed: browser — Failure 1; browser — Failure 2; browser — Failure 3; and 2 more",
  ]);
});

it.each(["failed", "blocked"])("omits a generic native tool %s reason", async (status) => {
  const projector = await createProjector();
  recordStep(projector, false, `codex native tool ${status}`);
  const result = await finish(projector);
  expect(result.assistantTexts).toEqual(["Done"]);
  expect(result.messagesSnapshot.find((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
    details: { failureReason: `codex native tool ${status}` },
  });
});

it("does not summarize an empty-output native command exiting with code 1", async () => {
  const projector = await createProjector();
  await projector.handleNotification(
    forCurrentTurn("item/completed", {
      item: {
        id: "command",
        type: "commandExecution",
        command: "rg missing file.txt",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        commandActions: [],
        status: "failed",
        aggregatedOutput: "",
        exitCode: 1,
        durationMs: 1,
      },
    }),
  );
  const result = await finish(projector);
  expect(result.assistantTexts).toEqual(["Done"]);
  expect(result.messagesSnapshot.find((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
  });
});

it.each([true, false])(
  "only a successful progress card can acknowledge a failed step (%s)",
  async (success) => {
    const projector = await createProjector();
    recordStep(projector);
    projector.recordDynamicToolCall({
      callId: "card",
      tool: "progress_card",
      arguments: { markdown: "Browser: Connection refused" },
    });
    projector.recordDynamicToolResult({
      callId: "card",
      tool: "progress_card",
      success,
      contentItems: [{ type: "inputText", text: success ? "Saved" : "Card rejected" }],
    });
    const result = await finish(projector);
    expect(result.assistantTexts).toEqual([
      success
        ? "Done"
        : "Done\n\n2 steps failed: browser — Connection refused; progress_card — Card rejected",
    ]);
  },
);

it("extracts a plain reason from a structured MCP error", async () => {
  const projector = await createProjector();
  await projector.handleNotification(
    forCurrentTurn("item/completed", {
      item: {
        id: "mcp",
        type: "mcpToolCall",
        server: "example",
        tool: "lookup",
        arguments: {},
        status: "failed",
        error: { message: "Lookup denied" },
        result: null,
        durationMs: 1,
      },
    }),
  );
  const result = await finish(projector);
  expect(result.assistantTexts.join("\n")).toContain("— Lookup denied");
  expect(result.messagesSnapshot.find((message) => message.role === "toolResult")).toMatchObject({
    content: [{ type: "text", text: "Lookup denied" }],
    details: { failureReason: "Lookup denied" },
  });
});

it("carries a native search error message into readable step text", async () => {
  const projector = await createProjector();
  await projector.handleNotification(
    forCurrentTurn("item/completed", {
      item: {
        id: "search",
        type: "webSearch",
        query: "news",
        status: "failed",
        error: { message: "Web search is not configured" },
      },
    }),
  );
  const result = await finish(projector);
  expect(result.messagesSnapshot.find((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "Web search is not configured" }],
    details: { failureReason: "Web search is not configured" },
  });
  expect(result.assistantTexts.join("\n")).toContain("— Web search is not configured");
});

it("recognizes a failed native tool mentioned by its plain-language name", async () => {
  const projector = await createProjector();
  await projector.handleNotification(
    forCurrentTurn("item/completed", {
      item: {
        id: "search",
        type: "webSearch",
        query: "news",
        status: "failed",
        error: { message: "Web search is not configured" },
      },
    }),
  );
  const text = "Web search failed, so I fetched the news page directly.";
  expect((await finish(projector, text)).assistantTexts).toEqual([text]);
});

it("does not turn a missing native result into a failed-step summary", async () => {
  const projector = await createProjector();
  projector.recordDynamicToolCall({ callId: "missing", tool: "browser", arguments: {} });
  expect((await finish(projector)).assistantTexts).toEqual(["Done"]);
});

it("preserves the execution reason when the native response includes output headers", async () => {
  const projector = await createProjector();
  await projector.handleNotification(
    forCurrentTurn("item/completed", {
      item: {
        id: "command",
        type: "commandExecution",
        command: "exit 1",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        commandActions: [],
        status: "failed",
        aggregatedOutput: "Permission denied",
        exitCode: 1,
        durationMs: 1,
      },
    }),
  );
  await projector.handleNotification(
    forCurrentTurn("rawResponseItem/completed", {
      item: {
        type: "function_call_output",
        call_id: "command",
        output: "Chunk ID: example\nWall time: 0.1 seconds\nOutput:\nPermission denied",
      },
    }),
  );
  const result = await finish(projector);
  expect(result.assistantTexts.join("\n")).toContain("— Permission denied");
  expect(result.assistantTexts.join("\n")).not.toContain("Chunk ID");
});

it("does not add a terminal summary to a yielded run", async () => {
  const projector = await createProjector();
  recordStep(projector);
  await finish(projector);
  const result = projector.buildResult(buildEmptyToolTelemetry(), { yieldDetected: true });
  expect(result.assistantTexts).toEqual(["Done"]);
});
