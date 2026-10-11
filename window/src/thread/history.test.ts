import { describe, expect, it } from "vitest";
import { historyToBlocks, readApprovalRecords } from "./history";

// Shapes recorded from the engine's chat.history and approval.history on 2026-10-02 (trimmed).
const cmd = "node -e \"require('fs').writeFileSync('hello.txt','hi from Sapling')\"";
const del = "node -e \"require('fs').unlinkSync('hello.txt')\"";
const messages = [
  { role: "user", content: "write it", timestamp: 1000 },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "c1", name: "exec", arguments: { command: cmd } }],
    stopReason: "toolUse",
    timestamp: 2000,
    __branch: { runId: "r1" },
  },
  {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "exec",
    content: [{ type: "text", text: "(no output)" }],
    isError: false,
    timestamp: 3000,
    __branch: { runId: "r1" },
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "It says hi from Sapling" }],
    stopReason: "stop",
    timestamp: 4000,
    __branch: { runId: "r1" },
  },
  { role: "user", content: "delete it", timestamp: 5000 },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "c2", name: "exec", arguments: { command: del } }],
    stopReason: "toolUse",
    timestamp: 6000,
    __branch: { runId: "r2" },
  },
  {
    role: "toolResult",
    toolCallId: "c2",
    toolName: "exec",
    content: [
      {
        type: "text",
        text: `Exec denied (gateway id=8a627ff8-6090-4c1c-80fa-80c82f9267e3, user-denied): ${del}`,
      },
    ],
    isError: true,
    timestamp: 7000,
    __branch: { runId: "r2" },
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "It was not allowed." }],
    stopReason: "stop",
    timestamp: 8000,
    __branch: { runId: "r2" },
  },
];
const ledger = {
  items: [
    {
      id: "a1",
      status: "allowed",
      presentation: { commandText: cmd },
      source: { sessionKey: "agent:dev:main" },
      createdAtMs: 2500,
    },
  ],
};

describe("historyToBlocks", () => {
  it("projects the stored tool result time and leaves missing times unknown", () => {
    const blocks = historyToBlocks(messages, [], "agent:dev:main", null);
    expect(blocks.find((b) => b.key === "c1")).toMatchObject({ at: 3000 });
    const missing = historyToBlocks(
      [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "missing", name: "read", arguments: {} }],
          stopReason: "toolUse",
        },
        { role: "toolResult", toolCallId: "missing", content: [], timestamp: 0 },
      ],
      [],
      "agent:dev:main",
      null,
    );
    expect(missing.find((b) => b.key === "missing")).not.toHaveProperty("at");
  });
  it("brings back steps, both approval outcomes and every Done line", () => {
    const blocks = historyToBlocks(messages, readApprovalRecords(ledger), "agent:dev:main", null);
    expect(blocks.map((b) => b.kind)).toEqual([
      "user",
      "step",
      "approval",
      "text",
      "done",
      "user",
      "step",
      "approval",
      "text",
      "done",
    ]);
    const approvals = blocks.filter((b) => b.kind === "approval");
    expect(
      approvals.map((b) => (b.kind === "approval" ? [b.approval.id, b.approval.state] : [])),
    ).toEqual([
      ["a1", "allowed"],
      ["8a627ff8-6090-4c1c-80fa-80c82f9267e3", "denied"],
    ]);
    expect(blocks[6]).toMatchObject({ kind: "step", tool: "exec", status: "denied" });
  });

  it("gives no Done line to a run that is still going", () => {
    const blocks = historyToBlocks(messages.slice(0, 4), [], "agent:dev:main", "r1");
    expect(blocks.some((b) => b.kind === "done")).toBe(false);
  });
});

describe("historyToBlocks: errors, notes, meta and attachments", () => {
  it("shows a run that failed before replying as the error block, and the engine's notes", () => {
    const blocks = historyToBlocks(
      [
        { role: "user", content: "hi", timestamp: 1, __branch: { id: "e1" } },
        {
          role: "custom",
          customType: "run-failed-before-reply",
          display: true,
          content: "boom.",
          timestamp: 2,
        },
        {
          role: "custom",
          customType: "notice",
          display: true,
          content: "The Gateway restarted.",
          timestamp: 3,
        },
        { role: "custom", customType: "hidden", content: "secret", timestamp: 4 },
      ],
      [],
      "k",
      null,
    );
    expect(blocks.map((b) => b.kind)).toEqual(["user", "error", "notice"]);
    expect(blocks[0]).toMatchObject({ meta: { entryId: "e1", timestamp: 1 } });
  });

  it("keeps the model, usage and pictures of a message", () => {
    const blocks = historyToBlocks(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", data: "AAAA", mimeType: "image/png" },
          ],
          timestamp: 1,
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "ok" },
          ],
          model: "qwen3:14b",
          usage: { totalTokens: 9, cost: { total: 0 } },
          stopReason: "stop",
          timestamp: 2,
          __branch: { id: "e2", runId: "r" },
        },
      ],
      [],
      "k",
      null,
    );
    expect(blocks[0]).toMatchObject({
      kind: "user",
      text: "look",
      attachments: [{ kind: "image", src: "data:image/png;base64,AAAA", kept: true }],
    });
    expect(blocks.map((b) => b.kind)).toEqual(["user", "thinking", "text", "done"]);
    expect(blocks[2]).toMatchObject({
      meta: { entryId: "e2", model: "qwen3:14b", usage: { total: 9, cost: 0 } },
    });
  });
});

describe("historyToBlocks: text-channel tool calls", () => {
  const spawn = {
    name: "sessions_spawn",
    arguments: {
      visible: true,
      title: "model-smoke-test-2",
      sessionKey: "agent:<id>:model-smoke-test-2",
      message: "Starting new session for model smoke test",
    },
  };

  it("projects a whole-reply tool-call JSON as a step, not as text", () => {
    const blocks = historyToBlocks(
      [
        { role: "user", content: "new conversation", timestamp: 1 },
        {
          role: "assistant",
          content: [{ type: "text", text: JSON.stringify(spawn) }],
          stopReason: "stop",
          timestamp: 2,
          __branch: { runId: "r" },
        },
      ],
      [],
      "k",
      null,
    );
    expect(blocks.map((b) => b.kind)).toEqual(["user", "step", "done"]);
    expect(blocks[1]).toMatchObject({
      kind: "step",
      tool: "sessions_spawn",
      title: "model-smoke-test-2",
      status: "ok",
    });
    expect(JSON.stringify(blocks)).not.toContain('"name": "sessions_spawn"');
  });

  it("projects a fenced tool-call JSON the same way, and leaves JSON inside prose as text", () => {
    const fenced = historyToBlocks(
      [
        {
          role: "assistant",
          content: `\`\`\`json\n${JSON.stringify(spawn)}\n\`\`\``,
          stopReason: "stop",
          timestamp: 2,
          __branch: { runId: "r" },
        },
      ],
      [],
      "k",
      null,
    );
    expect(fenced[0]).toMatchObject({
      kind: "step",
      tool: "sessions_spawn",
      title: "model-smoke-test-2",
    });
    const prose = historyToBlocks(
      [
        {
          role: "assistant",
          content: [{ type: "text", text: `Here is the call: ${JSON.stringify(spawn)}` }],
          stopReason: "stop",
        },
      ],
      [],
      "k",
      null,
    );
    expect(prose[0]).toMatchObject({
      kind: "text",
      text: `Here is the call: ${JSON.stringify(spawn)}`,
    });
  });
});

describe("historyToBlocks: a drafted team", () => {
  it("keeps the team card when the thread is reopened", () => {
    const team = {
      proposal: {
        teamId: "2d60428e",
        goal: "Ship it",
        hash: "h1",
        roomId: "team-2d60428e",
        members: [
          {
            name: "Builder Researcher",
            role: "Researcher",
            job: "Find topics.",
            machine: "this",
            model: "anthropic/claude-sonnet",
          },
        ],
      },
      choices: { models: ["anthropic/claude-sonnet"], machines: ["this"] },
    };
    const replay = [
      { role: "user", content: "ship it", timestamp: 1000 },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t1", name: "team_propose", arguments: { goal: "Ship it" } },
        ],
        stopReason: "toolUse",
        timestamp: 2000,
        __branch: { runId: "r1" },
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "team_propose",
        content: [{ type: "text", text: JSON.stringify(team) }],
        isError: false,
        timestamp: 3000,
        __branch: { runId: "r1" },
      },
    ];
    const blocks = historyToBlocks(replay, [], "agent:main:main", null);
    expect(blocks.find((b) => b.kind === "team")).toMatchObject({
      kind: "team",
      key: "t1:team",
      result: { proposal: { teamId: "2d60428e" } },
    });
  });
});
