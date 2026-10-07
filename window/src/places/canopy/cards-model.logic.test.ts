import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../automations/runtime";
import {
  NO_CARD_FILTERS,
  STATUSES,
  badges,
  blocksCount,
  boardIdFor,
  boardName,
  convState,
  dispatchLine,
  prioName,
  statusName,
  visibleCards,
  type CardFilters,
} from "./cards-model";

// Preview helpers: stNamePD18 / WB_ST_PD18, convStatePD18, blocksPD18, badgesPD18,
// wbVisiblePD18, and the Start Trunks result line in ACTS.wbgoPD18 (design/spec-v23).
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** engine/packages/canopy-contract CANOPY_BOARD_ID_PATTERN */
const ENGINE_BOARD_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

afterEach(() => {
  vi.useRealTimers();
});

function card(over: Row = {}): Row {
  return { id: "c1", title: "Card", status: "todo", ...over };
}

function filters(over: Partial<CardFilters> = {}): CardFilters {
  return { ...NO_CARD_FILTERS, ...over };
}

function onBoard(id: string, boardId: string, over: Row = {}): Row {
  const extra = over.metadata && typeof over.metadata === "object" ? over.metadata as Row : {};
  return card({ ...over, id, metadata: { automation: { boardId }, ...extra } });
}

describe("statusName", () => {
  it("names every one of the nine statuses with the preview words", () => {
    expect(STATUSES).toEqual([
      ["triage", "Triage"],
      ["backlog", "Backlog"],
      ["todo", "To do"],
      ["scheduled", "Scheduled"],
      ["ready", "Ready"],
      ["running", "Running"],
      ["review", "Review"],
      ["blocked", "Blocked"],
      ["done", "Done"],
    ]);
    for (const [key, name] of STATUSES) expect(statusName(key)).toBe(name);
  });

  it("returns an unknown key unchanged", () => {
    expect(statusName("somewhere")).toBe("somewhere");
  });
});

describe("prioName", () => {
  it("uses the preview priority words and Normal when the card has none", () => {
    expect(["low", "normal", "high", "urgent"].map(prioName)).toEqual(["Low", "Normal", "High", "Urgent"]);
    expect(prioName(undefined)).toBe("Normal");
    expect(prioName("")).toBe("Normal");
  });
});

describe("convState", () => {
  it("gives the right line and tooltip for working, waiting and finished linked conversations", () => {
    const running = { key: "agent:a:main", hasActiveRun: true };
    const idle = { key: "agent:a:main" };
    expect(convState({ status: "todo", sessionKey: "agent:a:main" }, [running], NOW)).toEqual(["Running", ""]);
    expect(convState({ status: "running", sessionKey: "agent:a:main" }, [idle], NOW)).toEqual(["Running", ""]);
    // Linked but not running: preview convStatePD18 falls through to State unknown.
    expect(convState({ status: "todo", sessionKey: "agent:a:main" }, [idle], NOW)).toEqual(["State unknown", ""]);
    expect(convState({ status: "done", sessionKey: "agent:a:main" }, [idle], NOW)).toEqual(["Done", ""]);
    expect(convState({ status: "review", sessionKey: "agent:a:main" }, [idle], NOW)).toEqual(["Done", ""]);
  });

  it("uses the preview words when there is no conversation or the link is unclear", () => {
    expect(convState({ status: "todo" }, [], NOW)).toEqual(["No conversation", "Start or link one"]);
    expect(convState({ status: "running", metadata: { attempts: [{ status: "running" }] } }, [], NOW)).toEqual([
      "Link unclear",
      "Edit the card to pick the exact conversation",
    ]);
    expect(convState({ status: "running" }, [], NOW)).toEqual(["No conversation", "Start or link one"]);
    expect(convState({ status: "todo", sessionKey: "gone" }, [], NOW)).toEqual(["Not available", ""]);
  });

  it("words a stale linked conversation from the recorded quiet time", () => {
    vi.setSystemTime(NOW);
    const twoHours = NOW - 2 * HOUR;
    expect(convState({
      status: "running",
      sessionKey: "agent:a:main",
      metadata: { stale: { detectedAt: twoHours } },
    }, [{ key: "agent:a:main", hasActiveRun: true }], NOW)).toEqual(["Stale · 2 h", "No activity for 2 h"]);
    expect(convState({
      status: "running",
      sessionKey: "agent:a:main",
      metadata: { stale: { detectedAt: NOW - DAY, lastSessionUpdatedAt: NOW - 30 * 60 * 1000 } },
    }, [{ key: "agent:a:main" }], NOW)).toEqual(["Stale · 30 min", "No activity for 30 min"]);
  });

  it("names stopped, timed-out and failed attempts with the preview tooltip on Failed", () => {
    const session = { key: "agent:a:main" };
    expect(convState({ status: "todo", sessionKey: "agent:a:main", metadata: { attempts: [{ status: "stopped" }] } }, [session], NOW)).toEqual(["Stopped", ""]);
    expect(convState({ status: "todo", sessionKey: "agent:a:main", metadata: { attempts: [{ error: "timed out" }] } }, [session], NOW)).toEqual(["Timed out", ""]);
    expect(convState({ status: "todo", sessionKey: "agent:a:main", metadata: { attempts: [{ error: "timeout" }] } }, [session], NOW)).toEqual(["Timed out", ""]);
    expect(convState({ status: "todo", sessionKey: "agent:a:main", metadata: { attempts: [{ status: "failed", error: "Tests failed" }] } }, [session], NOW)).toEqual([
      "Failed",
      "Open the conversation to see why",
    ]);
    expect(convState({ status: "blocked", sessionKey: "agent:a:main", metadata: { failureCount: 2 } }, [session], NOW)).toEqual([
      "Failed",
      "Open the conversation to see why",
    ]);
  });
});

describe("blocksCount", () => {
  it("counts only not-done cards waiting on this one", () => {
    const blocker = card({ id: "ready" });
    const waiting = card({
      id: "docs",
      status: "todo",
      metadata: { links: [{ type: "blocked_by", targetCardId: "ready" }] },
    });
    const parentWait = card({
      id: "tests",
      status: "review",
      metadata: { links: [{ type: "parent", targetCardId: "ready" }] },
    });
    const doneWait = card({
      id: "old",
      status: "done",
      metadata: { links: [{ type: "blocked_by", targetCardId: "ready" }] },
    });
    const archivedWait = card({
      id: "arch",
      status: "todo",
      metadata: { archivedAt: NOW - DAY, links: [{ type: "blocked_by", targetCardId: "ready" }] },
    });
    const other = card({
      id: "else",
      status: "todo",
      metadata: { links: [{ type: "blocked_by", targetCardId: "other" }] },
    });
    const cards = [blocker, waiting, parentWait, doneWait, archivedWait, other];
    expect(blocksCount(blocker, cards)).toBe(2);
    expect(blocksCount(card({ id: "nobody" }), cards)).toBe(0);
  });
});

describe("badges", () => {
  it("lists the preview badge words only when the count is above zero", () => {
    const waiting = card({
      id: "docs",
      status: "todo",
      metadata: { links: [{ type: "blocked_by", targetCardId: "ready" }] },
    });
    const busy = card({
      id: "ready",
      labels: ["ui", "site", "bug"],
      metadata: {
        attempts: [{ status: "failed" }, { status: "running" }],
        comments: [{}],
        links: [{ type: "relates_to", targetCardId: "x" }],
        proof: [{}],
        artifacts: [{}],
        attachments: [{}],
        diagnostics: [{}],
      },
    });
    expect(badges(busy, [busy, waiting])).toEqual([
      "2 attempts",
      "1 failed",
      "1 notes",
      "1 links",
      "1 proof",
      "1 made",
      "1 attachments",
      "1 more labels",
      "1 warnings",
      "1 blocked",
    ]);
    expect(badges(card({ labels: ["one", "two"] }), [])).toEqual([]);
  });
});

describe("visibleCards", () => {
  const weekOld = NOW - 9 * DAY;
  const recent = NOW - 2 * DAY;
  const deck: Row[] = [
    onBoard("triage", "def", { title: "gym membership", status: "triage" }),
    onBoard("ready", "def", { title: "Release notes", status: "ready", priority: "high", agentId: "branch", notes: "What ships" }),
    onBoard("review", "web", { title: "Fix broken links", status: "review", labels: ["ui", "site"], agentId: "scout" }),
    onBoard("blocked", "def", { title: "Plugin week", status: "blocked", agentId: "ledger", metadata: { diagnostics: [{ code: "missing_proof" }] } }),
    onBoard("quiet", "def", { title: "Pull request review", status: "running", metadata: { stale: { detectedAt: NOW - 2 * HOUR } } }),
    onBoard("bare-done", "def", { title: "Book the trip", status: "done", completedAt: recent }),
    onBoard("old-done", "def", { title: "Lisbon trip", status: "done", completedAt: weekOld, updatedAt: weekOld }),
    onBoard("proved", "def", { title: "Tax checklist", status: "done", completedAt: recent, metadata: { proof: [{ what: "filed" }] } }),
    onBoard("archived", "def", { title: "Old receipts", status: "todo", metadata: { archivedAt: weekOld } }),
    onBoard("on-conv", "conv", { title: "A conversation tile", status: "todo" }),
  ];

  it("shows every live card on a board when the filters are NO_CARD_FILTERS", () => {
    const shown = visibleCards(deck, "def", new Set(["conv"]), NO_CARD_FILTERS, [], NOW);
    expect(shown.map(c => c.id)).toEqual(["triage", "ready", "blocked", "quiet", "bare-done", "old-done", "proved"]);
  });

  it("applies each CardFilters field and the All-boards session-board skip", () => {
    const ids = (F: Partial<CardFilters>, board = "def", trunks: string[] = []) =>
      visibleCards(deck, board, new Set(["conv"]), filters(F), trunks, NOW).map(c => c.id);

    expect(ids({ q: "release" })).toEqual(["ready"]);
    expect(ids({ q: "  SHIPS  " })).toEqual(["ready"]);
    expect(ids({ q: "site" })).toEqual([]);
    expect(ids({ q: "site" }, "web")).toEqual(["review"]);

    expect(ids({ needs: true })).toEqual(["blocked"]);
    expect(ids({ needs: true }, "web")).toEqual(["review"]);
    expect(ids({ quiet: true })).toEqual(["quiet"]);
    expect(ids({ noproof: true })).toEqual(["bare-done", "old-done"]);
    expect(ids({ done: "week" })).toEqual(["triage", "ready", "blocked", "quiet", "bare-done", "proved"]);
    expect(ids({ prio: ["high"] })).toEqual(["ready"]);
    expect(ids({ prio: ["normal"] })).toEqual(["triage", "blocked", "quiet", "bare-done", "old-done", "proved"]);
    expect(ids({ status: ["ready", "blocked"] })).toEqual(["ready", "blocked"]);
    expect(ids({ arch: true })).toEqual(["triage", "ready", "blocked", "quiet", "bare-done", "old-done", "proved", "archived"]);

    expect(ids({}, "all")).toEqual(["triage", "ready", "review", "blocked", "quiet", "bare-done", "old-done", "proved"]);
    expect(ids({}, "web")).toEqual(["review"]);
    expect(ids({}, "def", ["branch", "ledger"])).toEqual(["ready", "blocked"]);
  });
});

describe("dispatchLine", () => {
  it("matches the preview words for 0, 1 and many started", () => {
    expect(dispatchLine({})).toBe("No cards were started.");
    expect(dispatchLine({ started: [], promoted: [], blocked: [], reclaimed: [], orchestrated: [], startFailures: [] }))
      .toBe("No cards were started.");
    expect(dispatchLine({ started: [{}], promoted: [], blocked: [], reclaimed: [], orchestrated: [], startFailures: [] }))
      .toBe("Started 1. Made ready 0, blocked 0, released 0, organised 0. Couldn’t start 0.");
    expect(dispatchLine({
      started: [{}, {}, {}],
      promoted: [{}, {}],
      blocked: [{}],
      reclaimed: [{}],
      orchestrated: [{}, {}, {}, {}],
      startFailures: [{}, {}],
    })).toBe("Started 3. Made ready 2, blocked 1, released 1, organised 4. Couldn’t start 2.");
  });

  it("still uses the count line when nothing started but other counts moved", () => {
    expect(dispatchLine({ started: [], promoted: [{}], blocked: [], reclaimed: [], orchestrated: [], startFailures: [] }))
      .toBe("Started 0. Made ready 1, blocked 0, released 0, organised 0. Couldn’t start 0.");
  });
});

describe("boardIdFor", () => {
  it("returns ids the engine pattern accepts and stays unique among the boards", () => {
    expect(boardIdFor("Website!", [])).toBe("website");
    expect(boardIdFor("Website!", [{ id: "website" }])).toBe("website-2");
    expect(boardIdFor("Website!", [{ id: "website" }, { id: "website-2" }])).toBe("website-3");
    expect(boardIdFor("  ---  ", [])).toBe("board");
    expect(boardIdFor("My Board.v2_ok", [])).toBe("my-board.v2_ok");
    const names = ["Website!", "Website!", "  ---  ", "._Notes", "A".repeat(90), "Site 2"];
    const boards: Row[] = [];
    const ids = names.map(name => {
      const id = boardIdFor(name, boards);
      boards.push({ id });
      return id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ENGINE_BOARD_ID);
  });
});

describe("boardName", () => {
  it("uses the board's name, or Default board for the default id", () => {
    expect(boardName(undefined)).toBe("");
    expect(boardName({ id: "default" })).toBe("Default board");
    expect(boardName({ id: "default", name: "Home" })).toBe("Home");
    expect(boardName({ id: "web", name: "Website" })).toBe("Website");
    expect(boardName({ id: "web" })).toBe("web");
  });
});
