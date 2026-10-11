import { afterEach, describe, expect, it, vi } from "vitest";
import {
  caretOnEdge,
  hasUnsavedDraftFiles,
  INPUT_HISTORY_LIMIT,
  loadDraft,
  safeStorage,
  saveDraft,
  step,
  trackDraftFiles,
  userTexts,
  type HistoryWalk,
} from "./drafts";

const owners: symbol[] = [];
const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

afterEach(() => {
  for (const owner of owners) trackDraftFiles(owner, 0);
  owners.length = 0;
  if (localStorageDescriptor) Object.defineProperty(window, "localStorage", localStorageDescriptor);
  else delete (window as { localStorage?: Storage }).localStorage;
  vi.restoreAllMocks();
  localStorage.clear();
});

function refuseLocalStorage(): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

function own(): symbol {
  const owner = Symbol("draft files");
  owners.push(owner);
  return owner;
}

function walk(items: string[], index = -1, saved = "what I was writing"): HistoryWalk {
  return { items, index, saved };
}

describe("drafts kept per conversation", () => {
  it("saveDraft and loadDraft keep a draft per conversation and clear on empty", () => {
    const storage = safeStorage();
    expect(storage).toBe(localStorage);
    saveDraft(storage, "agent:oak:desk", "Plan the week");
    saveDraft(storage, "agent:elm:desk", "Find a flight");
    expect(loadDraft(storage, "agent:oak:desk")).toBe("Plan the week");
    expect(loadDraft(storage, "agent:elm:desk")).toBe("Find a flight");
    expect(localStorage.getItem("branch.composer.draft:agent:oak:desk")).toBe("Plan the week");
    saveDraft(storage, "agent:oak:desk", "");
    expect(loadDraft(storage, "agent:oak:desk")).toBe("");
    expect(localStorage.getItem("branch.composer.draft:agent:oak:desk")).toBeNull();
    expect(loadDraft(storage, "agent:elm:desk")).toBe("Find a flight");
    expect(loadDraft(storage, "agent:oak:missing")).toBe("");
  });

  it("safeStorage returns undefined when storage throws, and the draft helpers do not crash", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    refuseLocalStorage();
    expect(safeStorage()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Drafts stay in memory only: this browser refused local storage.",
      expect.any(DOMException),
    );
    expect(loadDraft(undefined, "agent:oak:desk")).toBe("");
    expect(() => saveDraft(undefined, "agent:oak:desk", "kept only in this box")).not.toThrow();
    expect(loadDraft(undefined, "agent:oak:desk")).toBe("");
  });
});

describe("earlier messages with Up and Down", () => {
  it("userTexts returns your own messages newest first without repeats, capped at INPUT_HISTORY_LIMIT", () => {
    expect(INPUT_HISTORY_LIMIT).toBe(100);
    const msgs = [
      { role: "user", content: "a" },
      { role: "assistant", content: "x" },
      { role: "user", content: [{ type: "text", text: "b" }] },
      { role: "user", content: "   " },
      { role: "user", content: [{ type: "image" }, { type: "text", text: "c" }] },
      { role: "tool", content: "skip" },
      { role: "user", content: "a" },
      null,
      { role: "user", content: { text: "object" } },
    ];
    expect(userTexts(msgs)).toEqual(["a", "c", "b"]);

    const many = Array.from({ length: INPUT_HISTORY_LIMIT + 5 }, (_, i) => ({
      role: "user" as const,
      content: `ask ${i}`,
    }));
    const texts = userTexts(many);
    expect(texts).toHaveLength(INPUT_HISTORY_LIMIT);
    expect(texts[0]).toBe("ask 104");
    expect(texts[99]).toBe("ask 5");
    expect(texts).not.toContain("ask 4");
  });

  it("step walks Up and Down and returns null at the ends", () => {
    const start = walk(["new", "old"]);
    expect(step(start, "down")).toBeNull();
    const first = step(start, "up");
    expect(first).toEqual({ walk: { items: ["new", "old"], index: 0, saved: "what I was writing" }, text: "new" });
    const second = step(first!.walk, "up");
    expect(second?.text).toBe("old");
    expect(step(second!.walk, "up")).toBeNull();
    const back = step(second!.walk, "down");
    expect(back?.text).toBe("new");
    const draft = step(back!.walk, "down");
    expect(draft?.text).toBe("what I was writing");
    expect(draft?.walk.index).toBe(-1);
    expect(step(draft!.walk, "down")).toBeNull();
    expect(step(walk([]), "up")).toBeNull();
  });

  it("caretOnEdge allows Up only on the first line and Down only on the last", () => {
    expect(caretOnEdge("a\nb", 1, "up")).toBe(true);
    expect(caretOnEdge("a\nb", 3, "up")).toBe(false);
    expect(caretOnEdge("a\nb", 1, "down")).toBe(false);
    expect(caretOnEdge("a\nb", 3, "down")).toBe(true);
    expect(caretOnEdge("hello", 2, "up")).toBe(true);
    expect(caretOnEdge("hello", 2, "down")).toBe(true);
    expect(caretOnEdge("", 0, "up")).toBe(true);
    expect(caretOnEdge("", 0, "down")).toBe(true);
  });
});

describe("file chips across an update", () => {
  it("trackDraftFiles and hasUnsavedDraftFiles keep file chips across an update", () => {
    const a = own();
    const b = own();
    expect(hasUnsavedDraftFiles()).toBe(false);
    trackDraftFiles(a, 1);
    expect(hasUnsavedDraftFiles()).toBe(true);
    trackDraftFiles(a, 3);
    expect(hasUnsavedDraftFiles()).toBe(true);
    trackDraftFiles(b, 2);
    trackDraftFiles(a, 0);
    expect(hasUnsavedDraftFiles()).toBe(true);
    trackDraftFiles(b, 0);
    expect(hasUnsavedDraftFiles()).toBe(false);
  });
});
