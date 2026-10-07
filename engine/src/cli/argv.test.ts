// Argv tests cover CLI argument parsing helpers and platform-specific normalization.
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPositionalsWithRootOptions,
  getCommandPathWithRootOptions,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasFlag,
  isHelpOrVersionInvocation,
  isRootHelpInvocation,
  isRootVersionInvocation,
  isSimpleCommandHelpInvocation,
  normalizeGeneratedHelpCommandArgv,
  normalizeRootHelpTargetArgv,
  normalizeRootLogLevelArgv,
  normalizeRootNoColorArgv,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    [
      "known command group help command help flag",
      ["node", "branch", "backup", "help", "--help"],
      ["node", "branch", "backup", "help"],
    ],
    [
      "known command group help command short help flag",
      ["node", "branch", "--profile", "work", "backup", "help", "-h"],
      ["node", "branch", "--profile", "work", "backup", "help"],
    ],
    [
      "leaf positional help remains untouched",
      ["node", "branch", "docs", "help", "--help"],
      ["node", "branch", "docs", "help", "--help"],
    ],
    [
      "known command group help target",
      ["node", "branch", "plugins", "help", "list"],
      ["node", "branch", "plugins", "list", "--help"],
    ],
    [
      "known command group help target help flag",
      ["node", "branch", "plugins", "help", "list", "--help"],
      ["node", "branch", "plugins", "list", "--help"],
    ],
    [
      "unknown plugin command group help target",
      ["node", "branch", "external-plugin", "help", "inspect"],
      ["node", "branch", "external-plugin", "inspect", "--help"],
    ],
    [
      "generated help target with trailing root option",
      ["node", "branch", "memory", "help", "status", "--no-color"],
      ["node", "branch", "--no-color", "memory", "status", "--help"],
    ],
    [
      "extra help positionals remain untouched",
      ["node", "branch", "backup", "help", "missing", "extra", "--help"],
      ["node", "branch", "backup", "help", "missing", "extra", "--help"],
    ],
    [
      "terminator help flag remains untouched",
      ["node", "branch", "backup", "help", "--", "--help"],
      ["node", "branch", "backup", "help", "--", "--help"],
    ],
  ])("normalizes generated help commands: %s", (_name, argv, expected) => {
    expect(normalizeGeneratedHelpCommandArgv(argv)).toEqual(expected);
  });

  it.each([
    [
      "root help target",
      ["node", "branch", "help", "plugins"],
      ["node", "branch", "plugins", "--help"],
    ],
    [
      "root option before help target",
      ["node", "branch", "--profile", "work", "help", "memory"],
      ["node", "branch", "--profile", "work", "memory", "--help"],
    ],
    [
      "bare root help remains untouched",
      ["node", "branch", "help"],
      ["node", "branch", "help"],
    ],
    [
      "root help self-help remains untouched",
      ["node", "branch", "help", "--help"],
      ["node", "branch", "help", "--help"],
    ],
    [
      "nested root help target with help flag",
      ["node", "branch", "help", "plugins", "list", "--help"],
      ["node", "branch", "plugins", "list", "--help"],
    ],
    [
      "nested root help target with trailing root option",
      ["node", "branch", "help", "memory", "status", "--no-color"],
      ["node", "branch", "--no-color", "memory", "status", "--help"],
    ],
  ])("normalizes root help targets: %s", (_name, argv, expected) => {
    expect(normalizeRootHelpTargetArgv(argv)).toEqual(expected);
  });

  it.each([
    [
      "subcommand trailing no-color",
      ["node", "branch", "doctor", "--no-color", "--post-upgrade", "--json"],
      ["node", "branch", "--no-color", "doctor", "--post-upgrade", "--json"],
    ],
    [
      "keeps existing root options first",
      ["node", "branch", "--profile", "work", "doctor", "--no-color", "--lint", "--json"],
      ["node", "branch", "--profile", "work", "--no-color", "doctor", "--lint", "--json"],
    ],
    [
      "keeps no-color after possible command option value",
      ["node", "branch", "doctor", "--lint", "--json", "--no-color"],
      ["node", "branch", "doctor", "--lint", "--json", "--no-color"],
    ],
    [
      "flag terminator leaves no-color positional",
      ["node", "branch", "doctor", "--", "--no-color"],
      ["node", "branch", "doctor", "--", "--no-color"],
    ],
    [
      "command option value remains literal",
      ["node", "branch", "agent", "--message", "--no-color"],
      ["node", "branch", "agent", "--message", "--no-color"],
    ],
    [
      "assigned command option value does not block no-color",
      ["node", "branch", "agent", "--message=hello", "--no-color"],
      ["node", "branch", "--no-color", "agent", "--message=hello"],
    ],
  ])("normalizes root --no-color before command parsing: %s", (_name, argv, expected) => {
    expect(normalizeRootNoColorArgv(argv)).toEqual(expected);
  });

  it("allows final command metadata to lift no-color after boolean command flags", () => {
    const argv = ["node", "branch", "doctor", "--lint", "--json", "--no-color"];

    expect(
      normalizeRootNoColorArgv(argv, {
        shouldPreserveNoColor: ({ remainingArgs, noColorIndex }) =>
          remainingArgs[noColorIndex - 1] === "--message",
      }),
    ).toEqual(["node", "branch", "--no-color", "doctor", "--lint", "--json"]);
  });

  it.each([
    [
      "subcommand trailing log-level",
      ["node", "branch", "doctor", "--log-level", "debug", "--json"],
      ["node", "branch", "--log-level", "debug", "doctor", "--json"],
    ],
    [
      "subcommand trailing log-level equals form",
      ["node", "branch", "doctor", "--log-level=trace", "--json"],
      ["node", "branch", "--log-level=trace", "doctor", "--json"],
    ],
    [
      "keeps existing root options first",
      ["node", "branch", "--profile", "work", "doctor", "--log-level", "debug"],
      ["node", "branch", "--profile", "work", "--log-level", "debug", "doctor"],
    ],
    [
      "keeps log-level after possible command option value",
      ["node", "branch", "agent", "--message", "--log-level", "debug"],
      ["node", "branch", "agent", "--message", "--log-level", "debug"],
    ],
    [
      "flag terminator leaves log-level positional",
      ["node", "branch", "nodes", "run", "--", "--log-level", "debug"],
      ["node", "branch", "nodes", "run", "--", "--log-level", "debug"],
    ],
    [
      "missing value remains command scoped",
      ["node", "branch", "doctor", "--log-level", "--json"],
      ["node", "branch", "doctor", "--log-level", "--json"],
    ],
  ])("normalizes root --log-level before command parsing: %s", (_name, argv, expected) => {
    expect(normalizeRootLogLevelArgv(argv)).toEqual(expected);
  });

  it("allows final command metadata to lift log-level after boolean command flags", () => {
    const argv = ["node", "branch", "doctor", "--lint", "--json", "--log-level", "debug"];

    expect(
      normalizeRootLogLevelArgv(argv, {
        shouldPreserveLogLevel: ({ remainingArgs, logLevelIndex }) =>
          remainingArgs[logLevelIndex - 1] === "--message",
      }),
    ).toEqual(["node", "branch", "--log-level", "debug", "doctor", "--lint", "--json"]);
  });

  it("preserves log-level when final command metadata owns the option", () => {
    const argv = ["node", "branch", "plugin-cmd", "--log-level", "debug"];

    expect(
      normalizeRootLogLevelArgv(argv, {
        shouldPreserveLogLevel: ({ remainingArgs, logLevelIndex }) =>
          remainingArgs[logLevelIndex] === "--log-level",
      }),
    ).toEqual(argv);
  });

  it.each([
    ["root help command", ["node", "branch", "help"], true],
    ["nested help command", ["node", "branch", "matrix", "encryption", "help"], true],
    ["known subcommand root help command", ["node", "branch", "config", "help"], true],
    ["known leaf command positional help", ["node", "branch", "docs", "help"], false],
    [
      "known subcommand leaf positional help",
      ["node", "branch", "config", "set", "some.path", "help"],
      false,
    ],
    ["unknown plugin command help", ["node", "branch", "external-plugin", "tools", "help"], true],
    ["help flag", ["node", "branch", "matrix", "encryption", "--help"], true],
    ["help as option value", ["node", "branch", "agent", "--message", "help"], false],
    ["help after terminator", ["node", "branch", "nodes", "invoke", "--", "help"], false],
    [
      "implicit root help command after terminator",
      ["node", "branch", "--", "help", "config"],
      true,
    ],
    [
      "implicit parent help command after terminator",
      ["node", "branch", "config", "--", "help"],
      true,
    ],
    ["literal root help-looking command", ["node", "branch", "--", "--help"], false],
    ["literal parent help-looking command", ["node", "branch", "--", "config", "--help"], false],
    ["help flag after terminator", ["node", "branch", "nodes", "invoke", "--", "--help"], false],
    [
      "version flag after terminator",
      ["node", "branch", "nodes", "invoke", "--", "--version"],
      false,
    ],
    ["root version flag", ["node", "branch", "--version"], true],
    [
      "version-pinned skill install",
      ["node", "branch", "skills", "install", "@owner/weather", "--version", "1.2.3"],
      false,
    ],
    [
      "equals-form version-pinned skill install",
      ["node", "branch", "skills", "install", "@owner/weather", "--version=1.2.3"],
      false,
    ],
    [
      "help for a version-pinned skill command",
      ["node", "branch", "skills", "verify", "@owner/weather", "--version", "1.2.3", "--help"],
      true,
    ],
    [
      "unknown root option does not turn version into root help",
      ["node", "branch", "--unknown", "--version"],
      false,
    ],
  ])("detects help/version invocations: %s", (_name, argv, expected) => {
    expect(isHelpOrVersionInvocation(argv)).toBe(expected);
  });

  it.each([
    { path: ["skills", "verify"], option: "tag" },
    { path: ["agent"], option: "message" },
  ])("keeps actual help after a root-looking $option value on $path", async ({ path, option }) => {
    const program = new Command()
      .name("branch")
      .enablePositionalOptions()
      .option("--log-level <level>")
      .exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    const leaf = path.reduce((parent, name) => parent.command(name), program);
    leaf.option(`--${option} <value>`);
    const argv = ["node", "branch", ...path, `--${option}`, "--log-level", "--help"];

    await expect(program.parseAsync(argv)).rejects.toMatchObject({
      code: "commander.helpDisplayed",
      exitCode: 0,
    });
    expect(leaf.opts()[option]).toBe("--log-level");
    expect(isHelpOrVersionInvocation(argv)).toBe(true);
  });

  it.each([
    ["root --version", ["node", "branch", "--version"], true],
    ["root -V", ["node", "branch", "-V"], true],
    ["root -v alias with profile", ["node", "branch", "--profile", "work", "-v"], true],
    ["subcommand version flag", ["node", "branch", "status", "--version"], false],
    ["unknown root flag with version", ["node", "branch", "--unknown", "--version"], false],
  ])("detects root-only version invocations: %s", (_name, argv, expected) => {
    expect(isRootVersionInvocation(argv)).toBe(expected);
  });

  it.each([
    ["root --help", ["node", "branch", "--help"], true],
    ["root -h", ["node", "branch", "-h"], true],
    ["root --help with profile", ["node", "branch", "--profile", "work", "--help"], true],
    ["subcommand --help", ["node", "branch", "status", "--help"], false],
    ["help before subcommand token", ["node", "branch", "--help", "status"], false],
    [
      "help after -- terminator",
      ["node", "branch", "nodes", "invoke", "--", "device.status", "--help"],
      false,
    ],
    ["unknown root flag before help", ["node", "branch", "--unknown", "--help"], false],
    ["unknown root flag after help", ["node", "branch", "--help", "--unknown"], false],
  ])("detects root-only help invocations: %s", (_name, argv, expected) => {
    expect(isRootHelpInvocation(argv)).toBe(expected);
  });

  it.each([
    ["single command with trailing flag", ["node", "branch", "status", "--json"], ["status"]],
    ["two-part command", ["node", "branch", "agents", "list"], ["agents", "list"]],
    ["terminator cuts parsing", ["node", "branch", "status", "--", "ignored"], ["status"]],
  ])("extracts command path: %s", (_name, argv, expected) => {
    expect(getCommandPathWithRootOptions(argv, 2)).toEqual(expected);
  });

  it("extracts command path while skipping known root option values", () => {
    expect(
      getCommandPathWithRootOptions(
        [
          "node",
          "branch",
          "--profile",
          "work",
          "--container",
          "demo",
          "--no-color",
          "config",
          "validate",
        ],
        2,
      ),
    ).toEqual(["config", "validate"]);
  });

  it("limits simple help fast paths to root options, a command, and help", () => {
    const commands = new Set(["setup"]);
    expect(
      isSimpleCommandHelpInvocation(
        ["node", "branch", "--profile", "work", "setup", "--help"],
        commands,
      ),
    ).toBe(true);
    expect(
      isSimpleCommandHelpInvocation(
        ["node", "branch", "setup", "--workspace", "--help"],
        commands,
      ),
    ).toBe(false);
    expect(
      isSimpleCommandHelpInvocation(
        ["node", "branch", "setup", "--profile", "work", "--help"],
        commands,
      ),
    ).toBe(false);
    expect(isSimpleCommandHelpInvocation(["node", "branch", "--help", "setup"], commands)).toBe(
      false,
    );
  });

  it("extracts routed config get positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "branch", "config", "get", "--log-level", "debug", "update.channel", "--json"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("extracts routed config unset positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "branch", "config", "unset", "--profile", "work", "update.channel"],
        {
          commandPath: ["config", "unset"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("returns null when routed command sees unknown options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "branch", "config", "get", "--mystery", "value", "update.channel"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toBeNull();
  });

  it.each([
    ["returns first command token", ["node", "branch", "agents", "list"], "agents"],
    ["returns null when no command exists", ["node", "branch"], null],
    [
      "skips known root option values",
      ["node", "branch", "--log-level", "debug", "status"],
      "status",
    ],
  ])("returns primary command: %s", (_name, argv, expected) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    ["detects flag before terminator", ["node", "branch", "status", "--json"], "--json", true],
    ["ignores flag after terminator", ["node", "branch", "--", "--json"], "--json", false],
  ])("parses boolean flags: %s", (_name, argv, flag, expected) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    ["value in next token", ["node", "branch", "status", "--timeout", "5000"], "5000"],
    ["value in equals form", ["node", "branch", "status", "--timeout=2500"], "2500"],
    ["missing value", ["node", "branch", "status", "--timeout"], null],
    ["next token is another flag", ["node", "branch", "status", "--timeout", "--json"], null],
    ["flag appears after terminator", ["node", "branch", "--", "--timeout=99"], undefined],
    [
      "repeated flag uses final value",
      ["node", "branch", "status", "--timeout", "100", "--timeout=200"],
      "200",
    ],
    [
      "missing repeated value remains invalid",
      ["node", "branch", "status", "--timeout", "--timeout", "200"],
      null,
    ],
  ])("extracts flag values: %s", (_name, argv, expected) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "branch", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "branch", "status", "--debug"])).toBe(true);
  });

  it.each([
    ["missing flag", ["node", "branch", "status"], undefined],
    ["missing value", ["node", "branch", "status", "--timeout"], null],
    ["valid positive integer", ["node", "branch", "status", "--timeout", "5000"], 5000],
    ["partial integer", ["node", "branch", "status", "--timeout", "5s"], null],
    ["zero", ["node", "branch", "status", "--timeout", "0"], null],
    [
      "repeated value uses final valid integer",
      ["node", "branch", "status", "--timeout", "nope", "--timeout", "5000"],
      5000,
    ],
    [
      "repeated value rejects final invalid integer",
      ["node", "branch", "status", "--timeout", "5000", "--timeout", "nope"],
      null,
    ],
  ])("parses positive integer flag values: %s", (_name, argv, expected) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it.each([
    ["keeps plain node argv", ["node", "branch", "status"], ["node", "branch", "status"]],
    [
      "keeps windows versioned node exe",
      ["node-22.2.0.exe", "branch", "status"],
      ["node-22.2.0.exe", "branch", "status"],
    ],
    [
      "prefixes fallback when first arg is not a node launcher",
      ["node-dev", "branch", "status"],
      ["node", "branch", "node-dev", "branch", "status"],
    ],
    [
      "prefixes fallback when raw args start at program name",
      ["branch", "status"],
      ["node", "branch", "status"],
    ],
    [
      "keeps bun execution argv",
      ["bun", "src/entry.ts", "status"],
      ["bun", "src/entry.ts", "status"],
    ],
  ] as const)("builds parse argv from raw args: %s", (_name, rawArgs, expected) => {
    const parsed = buildParseArgv([...rawArgs]);
    expect(parsed).toEqual([...expected]);
  });
});
