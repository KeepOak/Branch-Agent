import { describe, expect, it } from "vitest";
import { historyToBlocks } from "../thread/history";
import { layout, type Item } from "../thread/layout";
import type { Block } from "../thread/model";
import { foldTalks, talkSummary, type TalkItem } from "./fold";

// Engine-shaped history matches rooms.test.ts (chat-display-projection.forwarded.test.ts) and the preview's
// a2aCard sample (design/spec-v23/index.html:12039, helper a2aCard at :12049).
const forwarded = (agentId: string, text: string) => ({
  role: "assistant",
  content: text,
  senderLabel: `Forwarded from ${agentId}`,
  senderSession: { sessionKey: `agent:${agentId}:main`, agentId },
});
const reply = (text: string, runId: string, extra: Record<string, unknown>[] = []) => ({
  role: "assistant",
  content: [...extra, { type: "text", text }],
  stopReason: "stop",
  timestamp: 1_700_000_000_000,
  __branch: { runId },
});
const mine = {
  role: "user",
  content: "Yes, go ahead.",
  timestamp: 1_700_000_000_100,
  __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me", senderName: "Me", senderIsOwner: true },
};

function fromHistory(history: unknown[], ownAgentId = "ledger") {
  return foldTalks(layout(historyToBlocks(history, [], `agent:${ownAgentId}:grp`, null)), ownAgentId);
}

function talksOf(items: ReturnType<typeof foldTalks>): TalkItem[] {
  return items.filter((i): i is TalkItem => i.type === "talk");
}

function blockItem(block: Block, index = 0): Item {
  return { type: "block", block, index, firstReply: false, face: false };
}

function trunkLine(key: string, agentId: string, text: string): Block {
  return { kind: "text", key, text, streaming: false, meta: { sender: { kind: "trunk", agentId } } };
}

function ownLine(key: string, text: string): Block {
  return { kind: "text", key, text, streaming: false };
}

describe("foldTalks", () => {
  it("folds a forwarded message from another Trunk plus this Trunk's answers into one fold with the right count", () => {
    const out = fromHistory([
      forwarded("scout", "@Ledger want me to pull the two missing receipts from Outlook?"),
      reply("Yes please. Delta Sep 5 and Oakfield Sep 2.", "r1"),
      forwarded("scout", "Found both. Filed under Travel and Supplies."),
    ]);
    const [talk] = talksOf(out);
    expect(talk.from).toBe("scout");
    expect(talk.lines.map((l) => [l.agentId, l.text])).toEqual([
      ["scout", "@Ledger want me to pull the two missing receipts from Outlook?"],
      [null, "Yes please. Delta Sep 5 and Oakfield Sep 2."],
      ["scout", "Found both. Filed under Travel and Supplies."],
    ]);
    expect(talk.lines).toHaveLength(3);
    expect(talkSummary("Scout", "Ledger", talk.lines.length)).toBe("Scout and Ledger talked it through · 3 messages");
  });

  it("keeps Thinking and Done lines inside the fold", () => {
    const out = fromHistory([
      forwarded("scout", "@Ledger want me to pull the two missing receipts from Outlook?"),
      reply("Yes please. Delta Sep 5 and Oakfield Sep 2.", "r1", [{ type: "thinking", thinking: "Checking September." }]),
    ]);
    const [talk] = talksOf(out);
    expect(talk.lines.map((l) => l.text)).toEqual([
      "@Ledger want me to pull the two missing receipts from Outlook?",
      "Yes please. Delta Sep 5 and Oakfield Sep 2.",
    ]);
    expect(out.some((i) => i.type === "block" && (i.block.kind === "thinking" || i.block.kind === "done"))).toBe(false);
  });

  it("ends the fold on a step so the work stays visible", () => {
    const out = foldTalks(
      [
        blockItem(trunkLine("t1", "scout", "Starting the pull.")),
        blockItem(ownLine("t2", "On it.")),
        { type: "steps", key: "steps:s1", steps: [{ kind: "step", key: "s1", tool: "exec", title: "Look up receipts", detail: "", status: "ok" }], face: false },
      ],
      "ledger",
    );
    const [talk] = talksOf(out);
    expect(talk.lines).toHaveLength(2);
    expect(out[1]).toMatchObject({ type: "steps", key: "steps:s1" });
  });

  it("ends the fold on an approval so nothing that needs the person is hidden", () => {
    const approval: Extract<Block, { kind: "approval" }> = {
      kind: "approval",
      key: "a1",
      approval: { id: "a1", command: "psql -U ledger", state: "pending" },
    };
    const out = foldTalks(
      [blockItem(trunkLine("t1", "scout", "Need the ledger database.")), blockItem(ownLine("t2", "Opening it.")), blockItem(approval)],
      "ledger",
    );
    expect(talksOf(out)[0].lines).toHaveLength(2);
    expect(out.some((i) => i.type === "block" && i.block.kind === "approval")).toBe(true);
  });

  it("ends the fold on an error so the failure stays visible", () => {
    const out = foldTalks(
      [
        blockItem(trunkLine("t1", "scout", "Running the sync.")),
        blockItem(ownLine("t2", "Standing by.")),
        blockItem({ kind: "error", key: "e1", runId: "r1", message: "Connection timeout" }),
      ],
      "ledger",
    );
    expect(talksOf(out)[0].lines).toHaveLength(2);
    expect(out.some((i) => i.type === "block" && i.block.kind === "error")).toBe(true);
  });

  it("ends the fold on the person's own message", () => {
    const out = fromHistory([
      forwarded("scout", "@Ledger want me to pull the two missing receipts from Outlook?"),
      reply("Yes please. Delta Sep 5 and Oakfield Sep 2.", "r1"),
      mine,
    ]);
    expect(talksOf(out)).toHaveLength(1);
    expect(talksOf(out)[0].lines).toHaveLength(2);
    expect(out.some((i) => i.type === "block" && i.block.kind === "user")).toBe(true);
  });

  it("makes two folds for two separate exchanges", () => {
    const out = fromHistory([
      forwarded("scout", "First question."),
      reply("First answer.", "r1"),
      mine,
      forwarded("scout", "Second question."),
      reply("Second answer.", "r2"),
    ]);
    const talks = talksOf(out);
    expect(talks).toHaveLength(2);
    expect(talks[0].lines.map((l) => l.text)).toEqual(["First question.", "First answer."]);
    expect(talks[1].lines.map((l) => l.text)).toEqual(["Second question.", "Second answer."]);
  });

  it("never folds the Trunk's own forwarded messages", () => {
    const out = fromHistory([forwarded("ledger", "note to self")], "ledger");
    expect(talksOf(out)).toEqual([]);
  });

  it("omits blank lines from the fold count the person sees", () => {
    const out = foldTalks(
      [blockItem(trunkLine("t1", "scout", "  ")), blockItem(trunkLine("t2", "scout", "Found both.")), blockItem(ownLine("t3", ""))],
      "ledger",
    );
    expect(talksOf(out)[0].lines.map((l) => l.text)).toEqual(["Found both."]);
  });
});

describe("talkSummary", () => {
  // Preview helper a2aCard (design/spec-v23/index.html:12049): "<A> and <B> talked it through · <n> messages".
  it("gives the preview's talked-it-through wording", () => {
    expect(talkSummary("Scout", "Ledger", 3)).toBe("Scout and Ledger talked it through · 3 messages");
    expect(talkSummary("Scout", "Ledger", 1)).toBe("Scout and Ledger talked it through · 1 message");
  });
});
