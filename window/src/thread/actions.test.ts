import { describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { askAgain, askedBy, branchFrom, editAndSend, nextAsk, readReactions, setReaction } from "./actions";
import type { Block } from "./model";

/** Records the requests an action makes; `answers` are what each method returns. */
function recorder(answers: Record<string, unknown>) {
  const calls: [string, unknown][] = [];
  const engine: WindowEngine = {
    request: async <T,>(method: string, params?: unknown): Promise<T> => {
      calls.push([method, params]);
      return answers[method] as T;
    },
    onEvent: () => () => undefined,
    sessionKey: "agent:main:main",
    agentId: "main",
    scopes: [],
  };
  return { engine, calls };
}

const blocks: Block[] = [
  { kind: "user", key: "u1", text: "a", meta: { entryId: "e1" } },
  { kind: "text", key: "t1", text: "x", streaming: false, meta: { entryId: "e2" } },
  { kind: "user", key: "u2", text: "b", meta: { entryId: "e3" } },
  { kind: "text", key: "t2", text: "y", streaming: false },
];

describe("message actions", () => {
  it("asks again: rewinds to the message the reply answered and sends its words", async () => {
    const { engine, calls } = recorder({ "sessions.rewind": { editorText: "a" }, "chat.send": { runId: "r" } });
    await askAgain(engine, "e1");
    expect(calls.map((c) => c[0])).toEqual(["sessions.rewind", "chat.send"]);
    expect(calls[0][1]).toEqual({ sessionKey: "agent:main:main", agentId: "main", entryId: "e1" });
    expect(calls[1][1]).toMatchObject({ message: "a" });
  });

  it("edits and sends again with the new words", async () => {
    const { engine, calls } = recorder({ "sessions.rewind": { editorText: "a" } });
    await editAndSend(engine, "e3", "better words");
    expect(calls[1][1]).toMatchObject({ message: "better words" });
  });

  it("branches with sessions.fork, then names the branch with sessions.patch", async () => {
    const { engine, calls } = recorder({ "sessions.fork": { sessionKey: "agent:main:dashboard:x", editorText: "b" } });
    const made = await branchFrom(engine, "e3", { label: "Other path", model: "" });
    expect(made.sessionKey).toBe("agent:main:dashboard:x");
    expect(calls[1]).toEqual(["sessions.patch", { key: "agent:main:dashboard:x", label: "Other path" }]);
  });

  it("finds the message a reply answered and the next one", () => {
    expect(askedBy(blocks, 1)?.meta?.entryId).toBe("e1");
    expect(nextAsk(blocks, 1)?.meta?.entryId).toBe("e3");
    expect(nextAsk(blocks, 3)).toBeNull();
  });

  it("reads reactions into chips, marking yours", async () => {
    const raw = { e2: [{ emoji: "👍", count: 2, identities: [{ id: "me", label: "Me" }, { id: "x" }] }] };
    expect(readReactions(raw, "me").get("e2")).toEqual([{ emoji: "👍", count: 2, mine: true, names: ["You", "x"] }]);
    const { engine, calls } = recorder({ "session.reactions.set": { messageId: "e2", reactions: [] } });
    await setReaction(engine, "e2", "👍", true);
    expect(calls[0][1]).toMatchObject({ messageId: "e2", emoji: "👍", remove: true });
  });
});
