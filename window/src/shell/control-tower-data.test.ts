import { describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import { towerHealth, towerNeeds } from "./control-tower-data";
import { readLimits, usagePollResult } from "./status-data";


const NOW = new Date(2026, 9, 8, 12, 0).getTime();

function row(partial: Partial<Conversation> & Pick<Conversation, "key">): Conversation {
  return {
    title: partial.title ?? partial.key,
    isMain: false,
    pinned: false,
    archived: false,
    unread: false,
    snoozedUntil: null,
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    preview: "",
    working: false,
    kind: "chat",
    system: false,
    automation: false,
    totalTokens: 0,
    contextTokens: 0,
    ...partial,
  };
}

describe("tower health (towerHtmlT5)", () => {
  it("says checking until a real result, then fine, warn, lockdown, or a failed check", () => {
    expect(towerHealth(false, false, null)).toEqual({ tone: "", text: "Checking every account…" });
    expect(towerHealth(false, false, null, true)).toEqual({ tone: "warn", text: "Couldn’t check accounts right now. Branch will try again." });
    const ok = readLimits({
      updatedAt: NOW,
      providers: [{ provider: "openai-codex", displayName: "ChatGPT plan", windows: [{ label: "5h", usedPercent: 23 }] }],
    }, NOW);
    expect(towerHealth(false, false, ok)).toEqual({ tone: "ok", text: "Everything is running fine." });
    const low = readLimits({
      updatedAt: NOW,
      providers: [{ provider: "openai-codex", displayName: "ChatGPT plan", windows: [{ label: "5h", usedPercent: 88 }] }],
    }, NOW);
    expect(towerHealth(false, false, low)).toEqual({ tone: "warn", text: "One account is nearly used up. Everything else is fine." });
    expect(towerHealth(true, false, low)).toEqual({ tone: "bad", text: "Lockdown is on. Trunks can only read." });
    expect(towerHealth(false, true, low)).toEqual({ tone: "", text: "Checking every account…" });
    expect(towerHealth(false, false, ok, true)).toEqual({ tone: "warn", text: "Couldn’t check accounts right now. Branch will try again." });
  });

  it("never says everything is running fine when no accounts are connected", () => {
    const empty = readLimits({ updatedAt: NOW, providers: [] }, NOW);
    expect(empty.rows).toEqual([]);
    expect(towerHealth(false, false, empty)).toEqual({ tone: "", text: "No accounts connected yet." });
    expect(towerHealth(false, false, empty).text).not.toBe("Everything is running fine.");
    expect(usagePollResult(new CustomEvent("branch:usage-checked", { detail: empty }))).toEqual(empty);
    expect(usagePollResult(new Event("branch:usage-checked"))).toBeNull();
  });
});

describe("Needs you", () => {
  it("lists real approvals, pending questions and needsYou rows, and never invents extras", () => {
    const name = (id?: string) => (id === "ada" ? "Ada" : id === "ledger" ? "Ledger" : id ?? "");
    const items = towerNeeds(
      [
        row({ key: "agent:ada:wait", title: "Tidy the Downloads folder", agentId: "ada", needsYou: true, headline: "Which folder first?" }),
        row({ key: "agent:ledger:ask", title: "September expense report", agentId: "ledger", needsYou: true, preview: "Send Dana the report?" }),
        row({ key: "agent:ada:idle", title: "Idle", agentId: "ada" }),
      ],
      [{ id: "ex1", kind: "exec", request: { title: "Run tidy.sh", agentId: "ada", sessionKey: "agent:ada:wait", description: "exec" } }],
      [{ id: "q1", status: "pending", agentId: "ledger", sessionKey: "agent:ledger:ask", questions: [{ questionId: "send", question: "Send Dana the report?", header: "Email" }] }],
      name,
    );
    expect(items.map((item) => [item.kind, item.title, item.who])).toEqual([
      ["approval", "Run tidy.sh", "Ada"],
      ["question", "Send Dana the report?", "Ledger"],
    ]);
    expect(towerNeeds([row({ key: "agent:ada:wait", agentId: "ada", needsYou: true, headline: "Which folder first?" })], [], [], name)).toEqual([
      expect.objectContaining({ id: "waiting:agent:ada:wait", kind: "waiting", title: "Which folder first?", who: "Ada" }),
    ]);
    expect(towerNeeds([row({ key: "agent:ada:idle", agentId: "ada" })], [], [], name)).toEqual([]);
  });
});

