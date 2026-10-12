import { describe, expect, it } from "vitest";
import { formatSize, pastedTitle, preparingLine, sizeProblem, toChatAttachments, type DraftFile } from "./attachments";
import { caretOnEdge, step, userTexts } from "./drafts";
import { replaceToken, skillTokenAt, tokenAt } from "./mention";
import { blockedReason, FULL_ACCESS_BLOCKED, MODE_ROWS, nextMode } from "./mode";
import { chipLabel, composerChipLabel, currentModelRef, currentThinking, groupModels, readModels } from "./model";
import { chipWords, enqueue, moveUp, nextToSend, mark, remove, reword, type QueueItem } from "./queue";
import { buildExtras, firstSendEcho, planSend, sendTooltip, shouldKeepFirstSendEcho } from "./sending";
import { argQuery, filterCommands, readCommands, slashQuery } from "./slash";
import { changedCount, patchValue, readConnectors, readSkills, setWebSearch, toggle } from "./tools";

describe("permission modes", () => {
  it("keeps the spec's order and keys 1–5 with the engine ids", () => {
    expect(MODE_ROWS.map((r) => r.name)).toEqual(["Auto", "Ask first", "Plan first", "Read only", "Full access"]);
    expect(MODE_ROWS.map((r) => r.engine)).toEqual(["workspace", "guarded", null, "read-only", "full"]);
  });
  it("says Full access does not include seeing the screen", () => {
    expect(MODE_ROWS[4].line).toMatch(/Does anything on this computer without asking: files, commands, the internet/);
    expect(MODE_ROWS[4].line).toMatch(/separate switch in Settings › Computer & browser/);
    expect(MODE_ROWS[4].line).not.toMatch(/Computer Control/);
  });
  it("blocks Full access for anyone but the owner, and Plan first as an engine gap", () => {
    expect(blockedReason(MODE_ROWS[4], false)).toBe(FULL_ACCESS_BLOCKED);
    expect(blockedReason(MODE_ROWS[4], true)).toBeNull();
    expect(blockedReason(MODE_ROWS[2], true)).toMatch(/Plan first isn't available/);
  });
  it("Shift+Tab never lands on a blocked mode", () => {
    expect(nextMode("guarded", true)).toBe("read-only");
    expect(nextMode("read-only", false)).toBe("workspace");
    expect(nextMode("read-only", true)).toBe("full");
    expect(nextMode(null, true)).toBe("workspace");
  });
});

describe("model chip", () => {
  const result = { models: [
    { id: "qwen3:14b", name: "qwen3:14b", provider: "ollama", thinkingLevels: [{ id: "off", label: "off" }, { id: "low", label: "low" }], local: true },
    { id: "x", name: "Hidden", provider: "p", manualSelectionAllowed: false },
  ] };
  it("reads the pickable models only", () => {
    const models = readModels(result);
    expect(models.map((m) => m.ref)).toEqual(["ollama/qwen3:14b"]);
    expect(models[0].levels.map((l) => l.id)).toEqual(["off", "low"]);
  });
  it("labels the chip with the model and its thinking level in lower case", () => {
    expect(chipLabel("GPT-6.1 Sol", "Medium")).toBe("GPT-6.1 Sol · medium");
    expect(chipLabel("", "low")).toBe("");
  });
  it("does not name a configured default that is not a usable models.list row", () => {
    const connected = readModels({ models: [{ id: "gpt-6-astra", name: "gpt-6-astra", provider: "openai", available: true }] })[0];
    expect(composerChipLabel(connected, "medium", true)).toBe("GPT-6 Astra · medium");
    expect(composerChipLabel(undefined, "medium", true)).toBe("No model");
    expect(composerChipLabel(undefined, "medium", false)).toBe("");
    expect(composerChipLabel({ ...connected, available: false }, "medium", true)).toBe("No model");
  });
  it("uses the session's model, else the engine's default; never an invented one", () => {
    expect(currentModelRef({ model: "m", modelProvider: "p" }, {})).toBe("p/m");
    expect(currentModelRef({}, { model: "d", modelProvider: "q" })).toBe("q/d");
    expect(currentModelRef({}, {})).toBe("");
    expect(currentThinking({ thinkingLevel: "high" }, { thinkingDefault: "off" })).toBe("high");
    expect(currentThinking({}, { thinkingDefault: "off" })).toBe("off");
  });
  it("groups by service and filters by search", () => {
    const models = readModels(result);
    expect(groupModels(models, "").map((g) => g.service)).toEqual(["On this computer"]);
    expect(groupModels(models, "nothing")).toEqual([]);
  });
});

describe("slash drawer", () => {
  const commands = readCommands({ commands: [
    { name: "help", textAliases: ["/help"], description: "Show available commands.", source: "native" },
    { name: "think", textAliases: ["/think", "/t"], source: "native", args: [{ name: "level", dynamic: true }] },
    { name: "usage", textAliases: ["/usage"], source: "native", args: [{ name: "mode", choices: [{ value: "off", label: "off" }, { value: "tokens", label: "tokens" }] }] },
    { name: "whoami", textAliases: ["/whoami"], source: "native" },
    { name: "help", source: "plugin", pluginId: "acme", description: "Plugin help" },
  ] });
  it("uses Branch's words for named commands and keeps built-ins first", () => {
    expect(commands[0]).toMatchObject({ name: "help", description: "every command you can use here" });
    expect(commands.at(-1)).toMatchObject({ name: "acme:help", owner: "acme", builtIn: false });
  });
  it("opens only while the box starts with / and holds no space", () => {
    expect(slashQuery("/th")).toBe("th");
    expect(slashQuery("/think ")).toBeNull();
    expect(slashQuery("hello /x")).toBeNull();
  });
  it("hides less-used commands until typed", () => {
    expect(filterCommands(commands, "").some((c) => c.name === "whoami")).toBe(false);
    expect(filterCommands(commands, "who").map((c) => c.name)).toEqual(["whoami"]);
    expect(filterCommands(commands, "t").map((c) => c.name)).toEqual(["think"]);
  });
  it("offers a command's choices after a space", () => {
    expect(argQuery("/usage to", commands)).toMatchObject({ prefix: "to" });
    expect(argQuery("/think ", commands)?.command.dynamic).toBe(true);
    expect(argQuery("/help ", commands)).toBeNull();
  });
});

describe("mentions", () => {
  it("finds an @ word at the start or after a space", () => {
    expect(tokenAt("hi @sa", 6, "@")).toEqual({ start: 3, end: 6, query: "sa" });
    expect(tokenAt("mail@x", 6, "@")).toBeNull();
    expect(skillTokenAt("/think", 6)).toBeNull();
    expect(skillTokenAt("do /su", 6)).toMatchObject({ query: "su" });
  });
  it("replaces the partial word with the name and a space", () => {
    expect(replaceToken("hi @sa there", { start: 3, end: 6, query: "sa" }, "@Sapling")).toEqual({ text: "hi @Sapling there", caret: 12 });
  });
});

describe("attachments", () => {
  it("uses the engine's own limits and says which file is too large", () => {
    expect(sizeProblem("a.png", "image/png", 10, { maxImageBytes: 5, maxBytes: 100 })).toBe("Too large to send: a.png");
    expect(sizeProblem("a.txt", "text/plain", 10, { maxImageBytes: 5, maxBytes: 100 })).toBeUndefined();
    expect(sizeProblem("a.txt", "text/plain", 10, undefined)).toBeUndefined();
  });
  it("formats sizes and the preparing line", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(preparingLine(1)).toBe("Preparing 1 attachment");
    expect(preparingLine(3)).toBe("Preparing 3 attachments…");
    expect(pastedTitle("**Hello** world")).toBe("Hello world");
  });
  it("sends only ready chips, in chat.send's shape", () => {
    const files: DraftFile[] = [
      { id: "1", kind: "file", fileName: "a.png", mimeType: "image/png", sizeBytes: 3, content: "AAA", origin: "paste" },
      { id: "2", kind: "file", fileName: "b", mimeType: "text/plain", sizeBytes: 3, origin: "file", problem: "Too large to send: b" },
    ];
    expect(toChatAttachments(files)).toEqual([{ type: "image", mimeType: "image/png", fileName: "a.png", origin: "paste", content: "AAA" }]);
  });
});

describe("waiting line", () => {
  const a: QueueItem[] = enqueue(enqueue([], { id: "a", text: "one", files: [] }), { id: "b", text: "two", files: [] });
  it("rewords, moves and removes", () => {
    expect(reword(a, "a", "uno")[0].text).toBe("uno");
    expect(moveUp(a, "b").map((i) => i.id)).toEqual(["b", "a"]);
    expect(moveUp(a, "a").map((i) => i.id)).toEqual(["a", "b"]);
    expect(remove(a, "a").map((i) => i.id)).toEqual(["b"]);
  });
  it("sends one at a time and pauses behind a failed one", () => {
    expect(nextToSend(a)?.id).toBe("a");
    expect(nextToSend(mark(a, "a", "failed"))).toBeUndefined();
    expect(chipWords(2, false)).toBe("2 waiting");
    expect(chipWords(2, true)).toBe("2 waiting · Offline");
  });
});

describe("sending", () => {
  it("steers by default while it works, and Ctrl Enter waits in line", () => {
    expect(planSend("x", false, true, "steer", false)).toEqual({ kind: "send", queueMode: "steer" });
    expect(planSend("x", false, true, "steer", true)).toEqual({ kind: "wait" });
    expect(planSend("x", false, true, "followup", false)).toEqual({ kind: "wait" });
    expect(planSend("x", false, true, "interrupt", true)).toEqual({ kind: "send", queueMode: "interrupt" });
    expect(planSend("x", false, false, "steer", false)).toEqual({ kind: "send" });
  });
  it("runs commands in the engine, /stop as Stop, /bg in the background", () => {
    expect(planSend("/status", false, true, "steer", false)).toEqual({ kind: "command", text: "/status" });
    expect(planSend("/stop", false, true, "steer", false)).toEqual({ kind: "stop" });
    expect(planSend("/bg tidy up", false, false, "", false)).toEqual({ kind: "background", text: "tidy up" });
    expect(planSend("  ", false, false, "", false)).toEqual({ kind: "nothing" });
  });
  it("names both actions in the Send tooltip", () => {
    expect(sendTooltip("steer")).toBe("Enter: steer it now · Ctrl Enter: wait in line");
    expect(sendTooltip("followup")).toBe("Enter: wait in line · Ctrl Enter: steer it now");
  });
  it("keeps a first-send echo until history holds the message, and drops a blank", () => {
    expect(firstSendEcho("  What is 2+3?  ")).toBe("What is 2+3?");
    expect(firstSendEcho(" \n ")).toBeNull();
    expect(shouldKeepFirstSendEcho(false, false)).toBe(true);
    expect(shouldKeepFirstSendEcho(true, false)).toBe(false);
    expect(shouldKeepFirstSendEcho(false, true)).toBe(false);
  });
  it("adds mentions where the names sit, and the reply target", () => {
    const extras = buildExtras("hi @Ana", [], [{ profileId: "p1", name: "Ana" }], "steer", { entryId: "e1", name: "x", text: "y" });
    expect(extras).toEqual({ mentions: [{ profileId: "p1", start: 3, end: 7 }], queueMode: "steer", replyToId: "e1" });
  });
});

describe("drafts and earlier messages", () => {
  it("reads your own earlier messages, newest first, without repeats", () => {
    const msgs = [{ role: "user", content: "a" }, { role: "assistant", content: "x" }, { role: "user", content: [{ type: "text", text: "b" }] }, { role: "user", content: "a" }];
    expect(userTexts(msgs)).toEqual(["a", "b"]);
  });
  it("walks up and back down to what you were writing", () => {
    const up = step({ items: ["new", "old"], index: -1, saved: "draft" }, "up");
    expect(up?.text).toBe("new");
    const down = step(up!.walk, "down");
    expect(down?.text).toBe("draft");
    expect(caretOnEdge("a\nb", 1, "up")).toBe(true);
    expect(caretOnEdge("a\nb", 3, "up")).toBe(false);
  });
});

describe("the plug", () => {
  it("reads connectors from config and skills that can run", () => {
    expect(readConnectors({ config: { mcp: { servers: { gh: { url: "https://x" }, fs: { command: "npx", enabled: false } } } } })).toEqual([
      { name: "gh", enabled: true, line: "Remote server" },
      { name: "fs", enabled: false, line: "Local command · npx" },
    ]);
    const skills = readSkills({ skills: [
      { name: "b", skillKey: "b", missing: { env: ["KEY"] } },
      { name: "a", skillKey: "a", missing: { bins: [] } },
      { name: "hidden", blockedByAllowlist: true },
    ] });
    expect(skills.map((s) => [s.name, s.problem])).toEqual([["A", undefined], ["B", "Needs a key"]]);
  });
  it("keeps only what differs from the Trunk's own settings", () => {
    const off = toggle({}, "skills", "a", false, true);
    expect(off).toEqual({ skills: { a: false } });
    expect(toggle(off, "skills", "a", true, true)).toEqual({});
    expect(changedCount(setWebSearch(off, false, true))).toBe(2);
    expect(patchValue({})).toBeNull();
  });
});
