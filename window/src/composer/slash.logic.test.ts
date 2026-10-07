import { describe, expect, it } from "vitest";
import {
  argQuery,
  commandRest,
  commandWord,
  filterChoices,
  filterCommands,
  LESS_USED,
  readCommands,
  slashQuery,
  type Choice,
} from "./slash";

// Preview helpers this file copies wording from (design/spec-v23/index.html):
//   drawSlash / slashItems — drawer open only while the box starts with "/" and has no space
//   CMDS_PK18 / SLASH — Branch's words for the named commands
//   slashItems + metaPK18.less — hide less-used until letters are typed
//   argModePK18 / choicesPK18 — /think (and other) choices after a space
//   slashRun — command word and the rest after it

const THINK_CHOICES: Choice[] = [
  { value: "off", label: "no thinking" },
  { value: "low", label: "thinks at low" },
  { value: "medium", label: "thinks at medium" },
  { value: "high", label: "thinks at high" },
  { value: "default", label: "what the Trunk uses" },
];

describe("slash drawer logic", () => {
  const commands = readCommands({
    commands: [
      { name: "help", textAliases: ["/help"], description: "Show available commands.", source: "native" },
      { name: "new", textAliases: ["/new"], description: "Start a new conversation.", source: "native" },
      { name: "think", textAliases: ["/think", "/t"], source: "native", args: [{ name: "level", dynamic: true }] },
      {
        name: "usage",
        textAliases: ["/usage"],
        source: "native",
        args: [{ name: "mode", choices: [{ value: "off", label: "off" }, { value: "tokens", label: "tokens" }, { value: "full", label: "full" }] }],
      },
      { name: "model", textAliases: ["/model", "/m"], description: "Switch the model.", source: "native", args: [{ name: "name" }] },
      { name: "goal", textAliases: ["/goal"], description: "Set a goal.", source: "native" },
      { name: "whoami", textAliases: ["/whoami"], source: "native" },
      { name: "commands", textAliases: ["/commands"], source: "native" },
      { name: "exec", textAliases: ["/exec"], source: "native" },
      { name: "clear", textAliases: ["/clear"], description: "clear this conversation and start over", source: "native" },
      { name: "help", source: "plugin", pluginId: "acme", description: "Plugin help" },
    ],
  });

  describe("readCommands", () => {
    it("replaces the engine's line with Branch's words for the commands the spec names", () => {
      const byName = Object.fromEntries(commands.map((c) => [c.name, c]));
      expect(byName.help.description).toBe("every command you can use here");
      expect(byName.new.description).toBe("start a fresh conversation");
      expect(byName.think.description).toBe("how hard it thinks here");
      expect(byName.think.hint).toBe("<level>");
      expect(byName.usage.description).toBe("what each account has left");
      expect(byName.usage.hint).toBe("[off, tokens, full or cost]");
      expect(byName.model.description).toBe("which model answers");
      expect(byName.model.hint).toBe("[name] [here, trunk or everywhere]");
      expect(byName.goal.description).toBe("keep working until a goal is met");
      expect(byName.whoami.description).toBe("who you are here and what you may do");
      expect(byName.commands.description).toBe("list every command");
    });

    it("keeps the engine's line for a command the spec does not name", () => {
      expect(commands.find((c) => c.name === "clear")?.description).toBe("clear this conversation and start over");
    });

    it("puts built-ins first and prefixes a colliding plugin command", () => {
      expect(commands[0].builtIn).toBe(true);
      expect(commands.at(-1)).toMatchObject({ name: "acme:help", owner: "acme", builtIn: false, description: "Plugin help" });
    });

    it("strips a leading slash from aliases and reads set choices", () => {
      const think = commands.find((c) => c.name === "think");
      expect(think?.aliases).toEqual(["think", "t"]);
      expect(think?.dynamic).toBe(true);
      expect(commands.find((c) => c.name === "usage")?.choices).toEqual([
        { value: "off", label: "off" },
        { value: "tokens", label: "tokens" },
        { value: "full", label: "full" },
      ]);
    });
  });

  describe("slashQuery", () => {
    it("opens only while the box starts with / and has no space (drawSlash)", () => {
      expect(slashQuery("/")).toBe("");
      expect(slashQuery("/th")).toBe("th");
      expect(slashQuery("/think")).toBe("think");
      expect(slashQuery("/MODEL")).toBe("model");
      expect(slashQuery("/think ")).toBeNull();
      expect(slashQuery("/model gpt")).toBeNull();
      expect(slashQuery("hello /x")).toBeNull();
      expect(slashQuery(" /help")).toBeNull();
      expect(slashQuery("")).toBeNull();
      expect(slashQuery("hello")).toBeNull();
    });
  });

  describe("filterCommands", () => {
    it("puts built-ins first and hides LESS_USED until their first letters are typed", () => {
      const empty = filterCommands(commands, "");
      expect(empty.some((c) => c.name === "help")).toBe(true);
      expect(empty.some((c) => c.name === "new")).toBe(true);
      expect(empty.map((c) => c.name)).not.toContain("whoami");
      expect(empty.map((c) => c.name)).not.toContain("commands");
      expect(empty.map((c) => c.name)).not.toContain("exec");
      expect(empty.findIndex((c) => c.builtIn)).toBeLessThan(empty.findIndex((c) => !c.builtIn));
      expect(filterCommands(commands, "who").map((c) => c.name)).toEqual(["whoami"]);
      expect(filterCommands(commands, "comm").map((c) => c.name)).toEqual(["commands"]);
      expect(filterCommands(commands, "exe").map((c) => c.name)).toEqual(["exec"]);
    });

    it("matches the typed start of a name or alias (slashItems)", () => {
      expect(filterCommands(commands, "th").map((c) => c.name)).toEqual(["think"]);
      expect(filterCommands(commands, "t").map((c) => c.name)).toEqual(["think"]);
      expect(filterCommands(commands, slashQuery("/HEL")!).map((c) => c.name)).toContain("help");
    });
  });

  describe("argQuery and filterChoices", () => {
    it("offers /think choices after a space (argModePK18 / choicesPK18)", () => {
      const open = argQuery("/think ", commands);
      expect(open).toMatchObject({ prefix: "", command: { name: "think", dynamic: true } });
      expect(filterChoices(THINK_CHOICES, open!.prefix).map((c) => c.value)).toEqual(["off", "low", "medium", "high", "default"]);

      const typed = argQuery("/think lo", commands);
      expect(typed?.prefix).toBe("lo");
      expect(filterChoices(THINK_CHOICES, typed!.prefix)).toEqual([{ value: "low", label: "thinks at low" }]);

      const alias = argQuery("/t high", commands);
      expect(alias).toMatchObject({ command: { name: "think" }, prefix: "high" });
      expect(filterChoices(THINK_CHOICES, alias!.prefix)).toEqual([{ value: "high", label: "thinks at high" }]);

      expect(filterChoices(THINK_CHOICES, "thinks").map((c) => c.value)).toEqual(["low", "medium", "high"]);
    });

    it("offers a command's set choices and stays closed when there are none", () => {
      expect(argQuery("/usage to", commands)).toMatchObject({ command: { name: "usage" }, prefix: "to" });
      expect(filterChoices(commands.find((c) => c.name === "usage")!.choices, "to")).toEqual([{ value: "tokens", label: "tokens" }]);
      expect(argQuery("/USAGE TOKENS", commands)?.prefix).toBe("tokens");
      expect(argQuery("/help anything", commands)).toBeNull();
      expect(argQuery("/think", commands)).toBeNull();
      expect(argQuery("/unknown arg", commands)).toBeNull();
      expect(argQuery("usage off", commands)).toBeNull();
    });
  });

  describe("commandWord and commandRest", () => {
    it("splits /model gpt the way slashRun does", () => {
      expect(commandWord("/model gpt")).toBe("model");
      expect(commandRest("/model gpt")).toBe("gpt");
      expect(commandWord("/MODEL GPT-4")).toBe("model");
      expect(commandRest("/MODEL GPT-4")).toBe("GPT-4");
      expect(commandWord("/think high")).toBe("think");
      expect(commandRest("/think high")).toBe("high");
    });

    it("returns the bare command, or nothing, when there is no rest", () => {
      expect(commandWord("/help")).toBe("help");
      expect(commandRest("/help")).toBe("");
      expect(commandWord("  /Help  ")).toBe("help");
      expect(commandRest("  /model gpt  ")).toBe("gpt");
      expect(commandWord("hello")).toBe("");
      expect(commandWord("hello /help")).toBe("");
      expect(commandRest("hello /help")).toBe("hello /help");
    });
  });

  describe("LESS_USED", () => {
    it("is the /commands-row set from the spec", () => {
      expect([...LESS_USED].sort()).toEqual(["commands", "elevated", "exec", "queue", "redirect", "whoami"]);
    });
  });
});
