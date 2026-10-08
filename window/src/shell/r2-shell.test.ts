// Round 2 frame and chat pieces: the row's engine facts, People / Person / Folder in Filter and sort, child rows,
// the select-several menu, the action-shaped approval words, spoken answers, panes, replay and problem banners.
import { describe, expect, it, vi } from "vitest";
import { projectConversation, type Conversation } from "../connect/conversations";
import { actionFields, actionWords } from "../thread/ApprovalCard";
import { spokenAnswer } from "../composer/VoiceParts";
import { readCatalogs } from "./AppSections";
import { batchMenuItems, MOVE_MANY_OFF } from "./batch-menu";
import type { Actions } from "./conversation-actions";
import { badgeList } from "./ConversationRow";
import { buildSections, childrenOf, clearFilters, DEFAULT_PREFS, filterRows, filterSummary, filtersDiffer, shownChildren, type ListPeople } from "./list-model";
import type { MenuItem } from "./Menu";
import { connectedApps } from "./problem-banners";
import { replayLines } from "./Replay";
import { customIcon } from "./row-look";
import { kindWords } from "./RowCard";
import { paneColumns } from "./SplitPanes";
import { vitalsTip } from "./StatusExtras";
import { stateWords } from "./TopBar";

const base: Conversation = {
  key: "k", title: "", isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null, createdAt: 0, updatedAt: 0,
  preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, agentId: "dev",
};
const row = (patch: Partial<Conversation>): Conversation => ({ ...base, ...patch });
const NOW = 1_000_000;
const people: ListPeople = { selfId: "p1", names: new Map([["p1", "Robin"], ["p2", "Dana"]]) };

describe("projectConversation reads the row's marks from the engine row", () => {
  it("run status, owner, folder, headline, repository, parent, icon and colour", () => {
    const c = projectConversation({
      key: "agent:dev:a", status: "killed", lastRunError: "the mail sign-in ended", parentSessionKey: "agent:dev:p", icon: "book", color: "cyan",
      owner: { actor: { type: "human", id: "p2", label: "Dana" } }, workspaceDir: "C:\\Code\\site", observerDigest: { headline: "Finding the invoice" },
      repository: { url: "https://example.org/site.git", branch: "fix" }, execNode: "laptop", participants: [{ identity: { type: "profile", id: "p1" } }],
    }, null);
    expect(c).toMatchObject({ runMark: "stopped", runError: "the mail sign-in ended", parentKey: "agent:dev:p", icon: "book", color: "cyan", ownerId: "p2", ownerName: "Dana", folder: "C:\\Code\\site", headline: "Finding the invoice", repoBranch: "site ⎇ fix", execNode: "laptop", participantIds: ["p1"] });
  });
  it("a finished run leaves no mark", () => {
    expect(projectConversation({ key: "agent:dev:a", status: "done" }, null).runMark).toBeUndefined();
  });
});

describe("Filter and sort: People, Group by Person and Folder, Hide empty groups, Clear filters", () => {
  const rows = [row({ key: "a", ownerId: "p1" }), row({ key: "b", ownerId: "p2", folder: "/w/site" }), row({ key: "c", ownerId: "p2", participantIds: ["p1"] }), row({ key: "d", ownerId: "p1", hiddenFromMe: true })];
  const keys = (p = DEFAULT_PREFS) => filterRows(rows, p, NOW, null, people).map((r) => r.key);
  it("Involving me: mine or one I'm in, not one I hid", () => {
    expect(keys({ ...DEFAULT_PREFS, people: "me" })).toEqual(["a", "c"]);
  });
  it("one person's", () => {
    expect(keys({ ...DEFAULT_PREFS, people: "p:p2" })).toEqual(["b", "c"]);
  });
  it("the People filter counts as a filter, and Clear filters keeps the display choices", () => {
    const p = { ...DEFAULT_PREFS, people: "me", status: "archived" as const, groupBy: "none" as const };
    expect(filtersDiffer(p)).toBe(true);
    expect(clearFilters(p)).toEqual({ ...DEFAULT_PREFS, groupBy: "none" });
    expect(filterSummary({ ...DEFAULT_PREFS, people: "p:p2" }, () => "", (id) => people.names.get(id) ?? id)).toBe("Dana");
    expect(filterSummary({ ...DEFAULT_PREFS, people: "me" }, () => "")).toBe("Involving me");
  });
  it("Group by Person: a label per owner with the count; empty people only under Never", () => {
    const s = buildSections(rows, { ...DEFAULT_PREFS, groupBy: "person" }, NOW, null, people);
    expect(s.map((x) => [x.id, x.label])).toEqual([["recent", "Recent"], ["person:p1", "Robin · 2"], ["person:p2", "Dana · 2"]]);
    const one = buildSections([rows[0]], { ...DEFAULT_PREFS, groupBy: "person", hideEmpty: "never" }, NOW, null, people);
    expect(one.map((x) => x.label)).toEqual(["Recent", "Robin · 1", "Dana · 0"]);
  });
  it("Group by Folder: the folder's own name, then No folder", () => {
    const s = buildSections(rows, { ...DEFAULT_PREFS, groupBy: "folder" }, NOW, null, people);
    expect(s.map((x) => x.label)).toEqual(["Recent", "site", "No folder"]);
    expect(s[1].folder).toBe("/w/site");
  });
  it("Pinned shows empty only when Hide empty groups is Never", () => {
    expect(buildSections(rows, { ...DEFAULT_PREFS, hideEmpty: "never" }, NOW, null).map((x) => x.id)).toEqual(["pinned", "recent"]);
  });
});

describe("child rows", () => {
  const rows = [row({ key: "p" }), ...[1, 2, 3, 4, 5, 6].map((n) => row({ key: `k${n}`, parentKey: "p", createdAt: n })), row({ key: "k0", parentKey: "p", createdAt: 0, runMark: "failed" })];
  it("leave the top level and list under their parent, newest first", () => {
    expect(filterRows(rows, DEFAULT_PREFS, NOW, null).map((r) => r.key)).toEqual(["p"]);
    expect(childrenOf(rows, "p").map((r) => r.key)).toEqual(["k6", "k5", "k4", "k3", "k2", "k1", "k0"]);
  });
  it("the first four show, and a failed one always shows", () => {
    expect(shownChildren(childrenOf(rows, "p"), false, () => false).map((r) => r.key)).toEqual(["k6", "k5", "k4", "k3", "k0"]);
    expect(shownChildren(childrenOf(rows, "p"), true, () => false)).toHaveLength(7);
  });
});

describe("row marks and the hover card", () => {
  const x = { draft: true, waitingToSend: 0, advanced: true, headlines: true, liveInList: true, nameOf: () => "Plan" };
  it("badges in the preview's order, with their words", () => {
    expect(badgeList(row({ archived: true, repoBranch: "site ⎇ fix", automation: true, forkOf: "z", execNode: "laptop" }), x).map((b) => b.words))
      .toEqual(["Archived", "Unsent draft", "Runs on laptop", "site ⎇ fix", "Automation attached", "Copied from Plan"]);
    expect(badgeList(row({ repoBranch: "r" }), { ...x, advanced: false, draft: false })).toEqual([]);
  });
  it("the card's kind", () => {
    expect(kindWords(row({ kind: "group" }))).toBe("Group chat");
    expect(kindWords(row({ parentKey: "p" }))).toBe("Thread");
    expect(kindWords(row({}))).toBe("Direct chat");
  });
  it("a custom icon is one emoji or an SVG", () => {
    expect(customIcon("🔥")).toEqual({ value: "🔥" });
    expect(customIcon("ab")).toEqual({ error: "Use one emoji." });
    expect(customIcon("<svg></svg>")).toEqual({ value: `data:image/svg+xml,${encodeURIComponent("<svg></svg>")}` });
  });
});

describe("select several", () => {
  const patchMany = vi.fn(async () => undefined);
  const actions = { patchMany } as unknown as Actions;
  const label = (i: MenuItem) => (i.kind === "sep" ? "---" : i.kind === "custom" ? "" : `${"disabled" in i && i.disabled ? "[off] " : ""}${i.label}`);
  it("the batch menu, as the preview's", () => {
    const items = batchMenuItems([row({ key: "a", unread: true }), row({ key: "b" })], actions, () => undefined, () => undefined);
    expect(items.map(label)).toEqual(["2 selected", "Mark 2 as unread", "[off] Move 2 to project", "Archive 2", "---", "Delete 2…"]);
    expect(items.some((i) => "disabled" in i && i.disabled === MOVE_MANY_OFF)).toBe(true);
  });
  it("Archive 2 patches both at once", () => {
    const items = batchMenuItems([row({ key: "a" }), row({ key: "b" })], actions, () => undefined, () => undefined);
    const archive = items.find((i) => i.kind === undefined && i.label === "Archive 2");
    if (archive && archive.kind === undefined) archive.run();
    expect(patchMany).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ key: "a" })]), { archived: true, snoozedUntil: null, pinned: false }, "Archived 2 conversations.", { archived: false });
  });
});

describe("the conversation header and cards", () => {
  it("header state words as the preview's statusLine", () => {
    expect(stateWords({ state: "idle", isDefaultTrunk: true, trunkName: "Sapling" })).toBe("Your Trunk on this computer · ready");
    expect(stateWords({ state: "idle", isDefaultTrunk: false, trunkName: "Fern", role: "Research" })).toBe("Research · ready");
    for (const [state, words] of [
      ["think", "Thinking it over"],
      ["work", "Working on it"],
      ["search", "Searching"],
      ["read", "Reading"],
    ] as const) {
      expect(stateWords({ state, isDefaultTrunk: false, trunkName: "Fern" })).toBe(words);
      expect(stateWords({ state, paused: true, isDefaultTrunk: false, trunkName: "Fern" })).toBe("Paused · won’t start anything new");
      expect(stateWords({ state, isDefaultTrunk: false, trunkName: "Fern", room: { faces: () => null, line: "Project · take turns" } })).toBe("Project · take turns");
    }
    expect(stateWords({ state: "wait", isDefaultTrunk: false, trunkName: "Fern" })).toBe("Waiting for you");
    expect(stateWords({ state: "sleep", paused: true, isDefaultTrunk: false, trunkName: "Fern" })).toBe("Paused · won’t start anything new");
    for (const state of ["idle", "talk", "yay", "oops", "sleep"] as const) {
      expect(stateWords({ state, isDefaultTrunk: false, trunkName: "Fern", role: "Research" })).toBe("Research · ready");
    }
  });
  it("an action's verbs and rows", () => {
    expect(actionWords("Send this email to Dana?")).toMatchObject({ yes: "Send it", no: "Don’t send" });
    expect(actionWords("Delete 4 files?")).toMatchObject({ yes: "Allow", no: "Deny" });
    expect(actionFields("To: Dana\nSubject: September\n\nHi Dana, here it is.")).toEqual({ fields: [["To", "Dana"], ["Subject", "September"]], body: "Hi Dana, here it is." });
  });
  it("yes or no said in a call", () => {
    expect(spokenAnswer("Yes, go ahead")).toBe("allow-once");
    expect(spokenAnswer("no thanks")).toBe("deny");
    expect(spokenAnswer("what is it?")).toBeNull();
  });
  it("replay lines", () => {
    expect(replayLines([{ kind: "user", key: "1", text: "hi" }, { kind: "notice", key: "2", text: "x" }, { kind: "text", key: "3", text: "hello", streaming: false }], "Fern"))
      .toEqual([{ who: "You", text: "hi" }, { who: "Fern", text: "hello" }]);
  });
  it("panes group into columns", () => {
    expect(paneColumns([{ key: "a", dir: "right" }, { key: "b", dir: "down" }, { key: null, dir: "right" }]).map((c) => c.map(([p]) => p.key))).toEqual([["a", "b"], [null]]);
  });
});

describe("status bar and banners", () => {
  it("the readout's tooltip grows with the level", () => {
    const v = { memUsed: 1, memTotal: 2, cpus: 16, load: [1.2, 0.9, 0.8], diskFree: 2 * 1024 ** 3, diskTotal: 4 * 1024 ** 3, upMs: 3_720_000, node: "v24.1.0", pid: 42 };
    expect(vitalsTip(v, "regular")).toBe("This computer’s graphics card and memory");
    expect(vitalsTip(v, "technical")).toBe("This computer’s graphics card and memory · load 1.2 / 0.9 / 0.8 on 16 cores · Disk 2 GB free of 4 GB · Up 1 h 2 min · Runtime Node 24.1.0 · process 42");
  });
  it("connected chat apps, for 'just disconnected'", () => {
    expect([...connectedApps({ channelLabels: { tg: "Telegram" }, channelAccounts: { tg: [{ connected: true }], sl: [{ connected: false }] } })]).toEqual([["tg", "Telegram"]]);
  });
  it("other apps' conversations", () => {
    const c = readCatalogs({ catalogs: [{ id: "codex", label: "Codex", hosts: [{ hostId: "h", sessions: [{ threadId: "t1", name: "Add CSV export", archived: false, canArchive: true, canContinue: true, updatedAt: 5 }, { threadId: "t2", archived: true }] }] }] });
    expect(c).toEqual([{ id: "codex", label: "Codex", threads: [{ catalogId: "codex", hostId: "h", threadId: "t1", name: "Add CSV export", at: 5, canArchive: true, canContinue: true }] }]);
  });
});
