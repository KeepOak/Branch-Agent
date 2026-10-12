// Completion CLI tests cover shell completion command generation and install output.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command, Option } from "commander";
import { afterAll, describe, expect, it } from "vitest";
import { getCompletionScript } from "./completion-cli.js";
import {
  createAliasedCompletionProgram,
  createCompletionProgram,
  createDocumentedCompletionProgram,
  itWithFish,
  itWithPowerShell,
  PowerShellCompletionRunner,
  runGeneratedBashCompletion,
  runGeneratedFishCompletion,
} from "./completion-cli.test-support.js";
import { registerModelsCli } from "./models-cli.js";

const powerShellCompletion = new PowerShellCompletionRunner();

afterAll(async () => {
  await powerShellCompletion.close();
});

function createOptionalChoiceCompletionProgram(): Command {
  const program = new Command().name("branch");
  program.addOption(new Option("--mode [mode]", "Mode").choices(["auto", "manual", "-legacy"]));
  program.option("--json", "JSON output");
  return program;
}

describe("completion-cli", () => {
  it("generates zsh functions for nested subcommands", () => {
    const script = getCompletionScript("zsh", createCompletionProgram());

    expect(script).toContain("_branch_gateway()");
    expect(script).toContain("(status) _branch_gateway_status ;;");
    expect(script).toContain("(restart) _branch_gateway_restart ;;");
    expect(script).toContain("--force[Force the action]");
    expect(script).toContain("\\`models status --json\\`");
    expect(script).toContain("\\$BRANCH_STATE_DIR");
  });

  it("escapes zsh option descriptions for double-quoted arguments specs", () => {
    const program = new Command()
      .name("branch")
      .option("--literal", "Use $BRANCH_STATE_DIR with `model/list` and John's profile");

    const script = getCompletionScript("zsh", program);

    expect(script).toContain(
      "--literal[Use \\$BRANCH_STATE_DIR with \\`model/list\\` and John's profile]",
    );
    expect(script).not.toContain("John'\\''s");
  });

  it.skipIf(process.platform === "win32").each(["built-in", "root", "nested"] as const)(
    "keeps %s command descriptions literal through real zsh parsing",
    (scope) => {
      const program = new Command().name("branch");
      let describedCommand: Command;
      let completionFunction: string;
      if (scope === "built-in") {
        registerModelsCli(program);
        const auth = program.commands
          .find((command) => command.name() === "models")
          ?.commands.find((command) => command.name() === "auth");
        const logout = auth?.commands.find((command) => command.name() === "logout");
        if (!logout) {
          throw new Error("Models auth logout command is unavailable");
        }
        describedCommand = logout;
        completionFunction = "_branch_models_auth";
      } else {
        const parent = scope === "nested" ? program.command("parent") : program;
        describedCommand = parent
          .command("inspect")
          .alias("review")
          .description(
            'Show John\'s "literal" $BRANCH_COMPLETION_LITERAL with `models auth list`',
          );
        completionFunction = scope === "nested" ? "_branch_parent" : "_branch_root_completion";
      }

      const result = spawnSync(
        "zsh",
        [
          "-fc",
          `${getCompletionScript("zsh", program)}
BRANCH_COMPLETION_LITERAL=expanded-value
models() { printf '%s\\n' "BRANCH_COMPLETION_DESCRIPTION_EVALUATED:$*" >&2; }
_arguments() {
  local spec
  for spec in "$@"; do
    if [[ "$spec" == "1: :"* ]]; then
      local -a action
      eval "action=( \${spec#1: :} )"
      printf '%s\\0' "\${action[@]}"
    fi
  done
}
${completionFunction}
`,
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      if (result.error) {
        if ("code" in result.error && result.error.code === "ENOENT") {
          return;
        }
        throw result.error;
      }

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const action = result.stdout.split("\0").filter(Boolean);
      expect(action.slice(0, 2)).toEqual(["_values", "command"]);
      for (const name of [describedCommand.name(), ...describedCommand.aliases()]) {
        expect(action).toContain(`${name}[${describedCommand.description()}]`);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps zsh completion choices literal and preserves candidate boundaries",
    () => {
      const program = new Command().name("branch");
      program.addOption(
        new Option("--value <value>", "Value").choices([
          "two words",
          'say "hello"',
          "it's literal",
          "literal $(printf BRANCH_COMPLETION_VALUE_EXECUTED >&2)",
          "literal `printf BRANCH_COMPLETION_VALUE_EXECUTED >&2`",
        ]),
      );

      const result = spawnSync(
        "zsh",
        [
          "-fc",
          `${getCompletionScript("zsh", program)}
_arguments() { printf '%s\\n' "$@"; }
_branch_root_completion
`,
        ],
        { encoding: "utf8" },
      );
      if (result.error) {
        if ("code" in result.error && result.error.code === "ENOENT") {
          return;
        }
        throw result.error;
      }

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("two\\ words");
      expect(result.stdout).toContain('say\\ \\"hello\\"');
      expect(result.stdout).toContain("BRANCH_COMPLETION_VALUE_EXECUTED");
    },
  );

  it("defers zsh registration until compinit is available", async () => {
    if (process.platform === "win32") {
      return;
    }

    const probe = spawnSync("zsh", ["-fc", "exit 0"], { encoding: "utf8" });
    if (probe.error) {
      if (
        "code" in probe.error &&
        (probe.error.code === "ENOENT" || probe.error.code === "EACCES")
      ) {
        return;
      }
      throw probe.error;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-zsh-completion-"));
    try {
      const scriptPath = path.join(tempDir, "branch.zsh");
      await fs.writeFile(scriptPath, getCompletionScript("zsh", createCompletionProgram()), "utf8");

      const result = spawnSync(
        "zsh",
        [
          "-fc",
          `
            source ${JSON.stringify(scriptPath)}
            [[ -z "\${_comps[branch]-}" ]] || exit 10
            [[ "\${precmd_functions[(r)_branch_register_completion]}" = "_branch_register_completion" ]] || exit 11
            autoload -Uz compinit
            compinit -C
            _branch_register_completion
            [[ -z "\${precmd_functions[(r)_branch_register_completion]}" ]] || exit 12
            [[ "\${_comps[branch]-}" = "_branch_root_completion" ]]
          `,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: tempDir,
            ZDOTDIR: tempDir,
          },
        },
      );

      expect(result.stderr).not.toContain("command not found: compdef");
      expect(result.status).toBe(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("generates PowerShell command paths without the executable prefix", () => {
    const script = getCompletionScript("powershell", createCompletionProgram());

    expect(script).toContain("if ($commandPath -eq 'gateway') {");
    expect(script).toContain("if ($commandPath -eq 'gateway status') {");
    expect(script).not.toContain("if ($commandPath -eq 'branch gateway') {");
    expect(script).toContain("$completions = @('status','restart','--force','-t','--token')");
    expect(script).not.toContain("'-t,'");
  });

  it("generates valid PowerShell root arrays when commands or options are empty", () => {
    const commandsOnly = new Command().name("branch");
    commandsOnly.command("status");
    const optionsOnly = new Command().name("branch").option("--json", "JSON output");
    const empty = new Command().name("branch");

    expect(getCompletionScript("powershell", commandsOnly)).toContain("$completions = @('status')");
    expect(getCompletionScript("powershell", optionsOnly)).toContain("$completions = @('--json')");
    expect(getCompletionScript("powershell", empty)).toContain("$completions = @()");
  });

  itWithPowerShell.each([
    ["a long shell flag", "branch completion --shell f"],
    ["a short shell flag", "branch completion -s f"],
  ])("completes validated values in real PowerShell after %s", async (_name, commandLine) => {
    expect(
      await powerShellCompletion.complete(createDocumentedCompletionProgram(), commandLine),
    ).toEqual(["fish"]);
  });

  itWithPowerShell.each([
    {
      name: "an option after a shell value",
      prefix: "branch completion --shell f",
      suffix: " --yes",
      expected: ["fish"],
    },
    {
      name: "a shared command name after the root command",
      prefix: "branch g",
      suffix: " status --json",
      expected: ["gateway"],
    },
  ])(
    "ignores real PowerShell words after the cursor: $name",
    async ({ prefix, suffix, expected }) => {
      const program = createDocumentedCompletionProgram();
      program.command("status").description("Root status").option("--json", "JSON output");

      expect(
        await powerShellCompletion.complete(program, `${prefix}${suffix}`, prefix.length),
      ).toEqual(expected);
    },
  );

  itWithPowerShell.each([
    {
      name: "an omitted optional value",
      commandLine: "branch --mode --j",
      expected: ["--json"],
    },
    {
      name: "an inline optional value",
      commandLine: "branch --mode=a",
      expected: ["--mode=auto"],
    },
    {
      name: "a hyphen-prefixed optional choice",
      commandLine: "branch --mode -l",
      expected: ["-legacy"],
    },
  ])("preserves real PowerShell completion after $name", async ({ commandLine, expected }) => {
    expect(
      await powerShellCompletion.complete(createOptionalChoiceCompletionProgram(), commandLine),
    ).toEqual(expected);
  });

  itWithPowerShell.each([
    ["a literal opening bracket", "branch --value a[", ["'a[bracket]'"]],
    ["a case-insensitive literal asterisk", "branch --value A*", ["'a*literal'"]],
    ["an inline literal asterisk", "branch --value=a*", ["--value='a*literal'"]],
  ])("matches real PowerShell choices with %s", async (_name, commandLine, expected) => {
    const program = new Command().name("branch");
    program.addOption(
      new Option("--value <value>", "Value").choices(["alpha", "a*literal", "a[bracket]"]),
    );

    expect(await powerShellCompletion.complete(program, commandLine)).toEqual(expected);
  });

  itWithPowerShell.each([
    ["ordinary choices", "alpha", "al"],
    ["whitespace", "two words", "tw"],
    ["apostrophes", "Jane's", "Ja"],
    [
      "literal command substitution",
      "literal $(Write-Error BRANCH_COMPLETION_VALUE_EXECUTED)",
      "literal",
    ],
    [
      "literal backtick metacharacters",
      "literal `$(Write-Error BRANCH_COMPLETION_VALUE_EXECUTED)",
      "literal",
    ],
    [
      "literal statement separators",
      "literal; Write-Error BRANCH_COMPLETION_VALUE_EXECUTED",
      "literal",
    ],
  ])("inserts PowerShell %s as one safe argument", async (_name, value, prefix) => {
    const program = new Command().name("branch");
    program.addOption(new Option("--value <value>", "Value").choices([value]));
    const safeValue = /^[A-Za-z0-9_./:+-]+$/.test(value)
      ? value
      : `'${value.replaceAll("'", "''")}'`;

    expect(await powerShellCompletion.complete(program, `branch --value ${prefix}`)).toEqual([
      safeValue,
    ]);
    expect(await powerShellCompletion.complete(program, `branch --value=${prefix}`)).toEqual([
      `--value=${safeValue}`,
    ]);
  });

  itWithPowerShell("completes root short and long flags in real PowerShell", async () => {
    const completions = await powerShellCompletion.complete(
      createDocumentedCompletionProgram(),
      "branch -",
    );

    expect(completions).toEqual(expect.arrayContaining(["-v", "--verbose", "--status-json"]));
  });

  itWithPowerShell(
    "completes documented nested short and long flags in real PowerShell",
    async () => {
      const completions = await powerShellCompletion.complete(
        createDocumentedCompletionProgram(),
        "branch completion -",
      );

      expect(completions).toEqual(
        expect.arrayContaining([
          "-s",
          "--shell",
          "-i",
          "--install",
          "-y",
          "--yes",
          "--write-state",
        ]),
      );
    },
  );

  itWithPowerShell.each([
    ["a long flag", "branch gateway --token secret st"],
    ["a short flag", "branch gateway -t secret st"],
    ["an inline long value", "branch gateway --token=secret st"],
    ["an inline short value", "branch gateway -t=secret st"],
    ["a preceding boolean flag", "branch gateway --force --token secret st"],
  ])("keeps real PowerShell nested completions after %s", async (_name, commandLine) => {
    expect(await powerShellCompletion.complete(createCompletionProgram(), commandLine)).toEqual([
      "status",
    ]);
  });

  itWithPowerShell.each([
    ["-v", ["-v"]],
    ["--v", ["--verbose"]],
  ])("filters real PowerShell root flag aliases for %s", async (prefix, expected) => {
    expect(
      await powerShellCompletion.complete(
        createDocumentedCompletionProgram(),
        `branch ${prefix}`,
      ),
    ).toEqual(expected);
  });

  itWithFish.each([
    ["a separate long root option", "branch --profile work g"],
    ["an inline long root option", "branch --profile=work g"],
    ["a separate short root option", "branch -p work g"],
    ["an inline short root option", "branch -p=work g"],
    ["an attached short root option", "branch -pwork g"],
    [
      "mixed value-taking root options",
      "branch --profile work --log-level debug --container local g",
    ],
  ])("completes root commands in real Fish after %s", (_name, commandLine) => {
    const program = createCompletionProgram()
      .option("-p, --profile <name>", "Profile")
      .option("--log-level <level>", "Log level")
      .option("--container <name>", "Container");

    expect(runGeneratedFishCompletion(program, commandLine)).toContain("gateway");
  });

  itWithFish.each([
    ["a separate long root option", "branch --profile work --p"],
    ["an inline long root option", "branch --profile=work --p"],
  ])("completes root options in real Fish after %s", (_name, commandLine) => {
    const program = createCompletionProgram().option("-p, --profile <name>", "Profile");

    expect(runGeneratedFishCompletion(program, commandLine)).toContain("--profile");
  });

  itWithFish.each([
    ["the exact nested command", "branch gateway status -"],
    ["an inline short option value", "branch gateway -t=secret status -"],
  ])("keeps real Fish completions scoped after %s", (_name, commandLine) => {
    expect(runGeneratedFishCompletion(createCompletionProgram(), commandLine)).toEqual(["--json"]);
  });

  itWithFish.each([
    ["multiple positional arguments", "branch gateway status first second -"],
    ["a positional argument named like a sibling", "branch gateway status restart -"],
  ])("keeps real Fish leaf options after %s", (_name, commandLine) => {
    const program = createCompletionProgram();
    const gateway = program.commands.find((command) => command.name() === "gateway");
    const status = gateway?.commands.find((command) => command.name() === "status");
    if (!status) {
      throw new Error("Gateway status command is unavailable");
    }
    status.argument("[query...]", "Search query");

    expect(runGeneratedFishCompletion(program, commandLine)).toEqual(["--json"]);
  });

  itWithFish("preserves documented short and long completion flags in real Fish", () => {
    expect(
      runGeneratedFishCompletion(createDocumentedCompletionProgram(), "branch completion -"),
    ).toEqual(
      expect.arrayContaining(["-s", "--shell", "-i", "--install", "-y", "--yes", "--write-state"]),
    );
  });

  itWithFish.each([
    ["a separated long optional value", "branch --color a", "always"],
    ["a separated short optional value", "branch -c n", "never"],
    ["an attached long optional value", "branch --color=a", "--color=always"],
  ])("completes real Fish Commander choices after %s", (_name, commandLine, expected) => {
    const program = new Command()
      .name("branch")
      .addOption(new Option("-c, --color [when]").choices(["always", "never"]));

    expect(runGeneratedFishCompletion(program, commandLine)).toContain(expected);
  });

  itWithFish.each([
    ["a long shell flag", "branch completion --shell f"],
    ["a short shell flag", "branch completion -s f"],
  ])("completes validated values in real Fish after %s", (_name, commandLine) => {
    expect(runGeneratedFishCompletion(createDocumentedCompletionProgram(), commandLine)).toEqual([
      "fish",
    ]);
  });

  itWithFish.each([
    ["whitespace", "two words", "tw"],
    ["double quotes", 'say "hello"', "sa"],
    ["apostrophes", "it's literal", "it"],
    [
      "literal command substitution",
      "literal $(printf BRANCH_COMPLETION_VALUE_EXECUTED >&2)",
      "literal",
    ],
    [
      "literal backtick substitution",
      "literal `printf BRANCH_COMPLETION_VALUE_EXECUTED >&2`",
      "literal",
    ],
  ])("preserves Fish choice %s as one inert candidate", (_name, value, prefix) => {
    const program = new Command().name("branch");
    program.addOption(new Option("--value <value>", "Value").choices([value]));

    expect(runGeneratedFishCompletion(program, `branch --value ${prefix}`)).toEqual([value]);
  });

  it("does not require optional Fish option choices", () => {
    const program = new Command().name("branch");
    program.addOption(new Option("--mode [mode]", "Mode").choices(["auto", "manual"]));

    const optionLine = getCompletionScript("fish", program)
      .split("\n")
      .find((line) => line.includes(" -l mode "));

    expect(optionLine).toContain(" -f -a ");
    expect(optionLine).not.toContain(" -r ");
    expect(optionLine).toContain("'auto' 'manual'");
  });

  it("scopes fish value-taking option skips to the active command path", () => {
    const script = getCompletionScript("fish", createCompletionProgram());

    expect(script).toContain("case 'agent'\n        set value_options '--verbose'");
    expect(script).toContain("__branch_command_path_matches sessions cleanup");
    expect(script).not.toContain("case 'sessions cleanup'\n        set value_options '--verbose'");
    expect(script).toContain(
      "complete -c branch -n \"__branch_command_path_matches sessions cleanup\" -l dry-run -d 'Preview cleanup'",
    );
  });

  it("uses Commander's parsed flags instead of value placeholder syntax", () => {
    const program = new Command()
      .name("branch")
      .option("--trigger-script <path|->", "Condition script file, or - for stdin")
      .option("--ws, --workspace <name>", "Workspace");

    const fishScript = getCompletionScript("fish", program);

    expect(fishScript).toContain(
      "complete -c branch -n \"__branch_command_path_matches\" -l trigger-script -r -d 'Condition script file, or - for stdin'",
    );
    expect(fishScript).not.toContain(" -s > ");
    expect(fishScript).toContain(" -l ws -l workspace -r -d 'Workspace'");
    expect(getCompletionScript("bash", program)).not.toContain("--trigger-script ->");
    expect(getCompletionScript("zsh", program)).not.toContain("{--trigger-script,->}");
  });

  it.skipIf(process.platform === "win32")(
    "completes both root short flags and their long aliases in real Bash",
    () => {
      const completions = runGeneratedBashCompletion(createDocumentedCompletionProgram(), [
        "branch",
        "-",
      ]);

      expect(completions).toEqual(expect.arrayContaining(["-v", "--verbose", "--status-json"]));
      expect(completions.some((flag) => flag.endsWith(","))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "completes every documented completion short flag in real Bash",
    () => {
      const completions = runGeneratedBashCompletion(createDocumentedCompletionProgram(), [
        "branch",
        "completion",
        "-",
      ]);

      expect(completions).toEqual(
        expect.arrayContaining([
          "-s",
          "--shell",
          "-i",
          "--install",
          "-y",
          "--yes",
          "--write-state",
        ]),
      );
      expect(completions.some((flag) => flag.endsWith(","))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "completes both nested value-taking flag aliases in real Bash",
    () => {
      const completions = runGeneratedBashCompletion(createDocumentedCompletionProgram(), [
        "branch",
        "gateway",
        "-",
      ]);

      expect(completions).toEqual(expect.arrayContaining(["-t", "--token", "--force"]));
      expect(completions.some((flag) => flag.endsWith(","))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "filters short and long aliases independently in real Bash",
    () => {
      const program = createDocumentedCompletionProgram();

      expect(runGeneratedBashCompletion(program, ["branch", "completion", "-s"])).toEqual(["-s"]);
      expect(runGeneratedBashCompletion(program, ["branch", "completion", "--s"])).toEqual([
        "--shell",
      ]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects an equals prefix in a Bash short option value",
    () => {
      expect(
        runGeneratedBashCompletion(createDocumentedCompletionProgram(), [
          "branch",
          "completion",
          "-s=f",
        ]),
      ).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32").each([
    ["an omitted optional value", ["branch", "--mode", "--j"], ["--json"]],
    ["a separate optional value", ["branch", "--mode", "a"], ["auto"]],
    ["an inline optional value", ["branch", "--mode=a"], ["--mode=auto"]],
    ["a hyphen-prefixed optional choice", ["branch", "--mode", "-l"], ["-legacy"]],
  ])("preserves real Bash completion after %s", (_name, words, expected) => {
    expect(runGeneratedBashCompletion(createOptionalChoiceCompletionProgram(), words)).toEqual(
      expected,
    );
  });

  it.skipIf(process.platform === "win32").each([
    ["whitespace", "two words", "two "],
    ["double quotes", 'say "hello"', 'say "'],
    ["apostrophes", "it's literal", "it\\'s"],
    ["literal command substitution", "$(printf BRANCH_COMPLETION_VALUE_EXECUTED >&2)", "$("],
    ["literal backtick substitution", "`printf BRANCH_COMPLETION_VALUE_EXECUTED >&2`", "`"],
  ])("keeps Bash choice %s literal without executing it", (_name, value, prefix) => {
    const program = new Command().name("branch");
    program.addOption(new Option("--value <value>", "Value").choices([value]));

    expect(runGeneratedBashCompletion(program, ["branch", "--value", prefix])).toEqual([value]);
    expect(runGeneratedBashCompletion(program, ["branch", `--value=${prefix}`])).toEqual([
      `--value=${value}`,
    ]);
  });

  it.skipIf(process.platform === "win32").each([
    ["a root option", ["branch", "--channel", "b"], ["beta"]],
    ["an inherited parent option", ["branch", "cron", "create", "--channel", "pre"], ["preview"]],
    [
      "an inline inherited parent option",
      ["branch", "cron", "create", "--channel=pre"],
      ["--channel=preview"],
    ],
  ])("uses the nearest validated Bash choices for %s", (_name, words, expected) => {
    const program = createAliasedCompletionProgram();
    program.addOption(
      new Option("--channel <channel>", "Update channel").choices(["stable", "beta"]),
    );
    const cron = program.commands.find((command) => command.name() === "cron");
    if (!cron) {
      throw new Error("Cron command is unavailable");
    }
    cron.addOption(
      new Option("--channel <channel>", "Cron channel").choices(["production", "preview"]),
    );

    expect(runGeneratedBashCompletion(program, words)).toEqual(expected);
  });

  it("preserves documented short and long completion flags in Fish and Zsh", () => {
    const program = createDocumentedCompletionProgram();
    const fishScript = getCompletionScript("fish", program);
    const zshScript = getCompletionScript("zsh", program);

    expect(fishScript).toContain(" -s s -l shell ");
    expect(fishScript).toContain(" -s i -l install ");
    expect(fishScript).toContain(" -s y -l yes ");
    expect(zshScript).toContain("{--shell,-s}");
    expect(zshScript).toContain("{--install,-i}");
    expect(zshScript).toContain("{--yes,-y}");
  });

  it("preserves required shell values and their Commander choices in Fish and Zsh", () => {
    const program = createDocumentedCompletionProgram();
    const fishScript = getCompletionScript("fish", program);
    const zshScript = getCompletionScript("zsh", program);

    expect(fishScript).toContain(" -s s -l shell -r -f -a ");
    expect(fishScript).toContain(`"'zsh' 'bash' 'powershell' 'fish'"`);
    expect(zshScript).toContain(
      `{--shell,-s}"[Shell to generate completion for (default: detected)]:shell:(zsh bash powershell fish)"`,
    );
    expect(zshScript).toContain('{--token,-t}"[Gateway token]:token:"');
  });

  it.skipIf(process.platform === "win32")(
    "completes Commander option choices instead of commands in real Bash",
    () => {
      const program = createDocumentedCompletionProgram();

      expect(
        runGeneratedBashCompletion(program, ["branch", "completion", "--shell", ""]),
      ).toEqual(["zsh", "bash", "powershell", "fish"]);
      expect(runGeneratedBashCompletion(program, ["branch", "completion", "-s", "f"])).toEqual([
        "fish",
      ]);
      expect(runGeneratedBashCompletion(program, ["branch", "completion", "--shell=f"])).toEqual([
        "--shell=fish",
      ]);
      expect(
        runGeneratedBashCompletion(program, ["branch", "completion", "--shell", "=", "f"], {
          line: "branch completion --shell=f",
        }),
      ).toEqual(["fish"]);
      expect(runGeneratedBashCompletion(program, ["branch", "completion", "-sf"])).toEqual([
        "-sfish",
      ]);
      expect(runGeneratedBashCompletion(program, ["branch", "completion", "-ysf"])).toEqual([
        "-ysfish",
      ]);
      expect(runGeneratedBashCompletion(program, ["branch", "completion", "-ys", "f"])).toEqual([
        "fish",
      ]);
      expect(runGeneratedBashCompletion(program, ["branch", "completion", "-ys"])).toEqual([
        "-yszsh",
        "-ysbash",
        "-yspowershell",
        "-ysfish",
      ]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves pending short-cluster choices that start with a hyphen in real Bash",
    () => {
      const program = new Command()
        .name("branch")
        .option("-v, --verbose", "Verbose output")
        .addOption(new Option("-m, --mode <mode>").choices(["-legacy"]))
        .exitOverride();

      program.parse(["-vm", "-legacy"], { from: "user" });
      expect(program.opts()).toEqual({ verbose: true, mode: "-legacy" });
      expect(runGeneratedBashCompletion(program, ["branch", "-vm", "-le"])).toEqual(["-legacy"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps optional choice values from consuming the following option in real Bash",
    () => {
      const program = new Command()
        .name("branch")
        .addOption(new Option("-c, --color [when]").choices(["always", "never"]))
        .option("-v, --verbose", "Verbose output");

      expect(runGeneratedBashCompletion(program, ["branch", "--color", "a"])).toEqual(["always"]);
      expect(runGeneratedBashCompletion(program, ["branch", "--color", "--v"])).toEqual([
        "--verbose",
      ]);
      expect(runGeneratedBashCompletion(program, ["branch", "-ca"])).toEqual(["-calways"]);
      expect(runGeneratedBashCompletion(program, ["branch", "-vca"])).toEqual(["-vcalways"]);
    },
  );

  it("omits empty PowerShell command-path switches for root-only programs", () => {
    const program = new Command()
      .name("branch")
      .addOption(new Option("--theme <theme>").choices(["light", "dark"]));

    expect(getCompletionScript("powershell", program)).not.toContain("switch ($candidatePath)");
  });

  itWithPowerShell.each([
    ["an attached option value", "branch completion --shell=f", "--shell=fish"],
    ["an attached short option value", "branch completion -sf", "-sfish"],
    ["a short-option cluster value", "branch completion -ysf", "-ysfish"],
    ["a separated short-option cluster value", "branch completion -ys f", "fish"],
  ])("completes PowerShell Commander choices after %s", async (_name, commandLine, expected) => {
    expect(
      await powerShellCompletion.complete(createDocumentedCompletionProgram(), commandLine),
    ).toEqual([expected]);
  });

  itWithPowerShell("completes an empty attached short-option cluster value", async () => {
    expect(
      await powerShellCompletion.complete(
        createDocumentedCompletionProgram(),
        "branch completion -ys",
      ),
    ).toEqual(["-yszsh", "-ysbash", "-yspowershell", "-ysfish"]);
  });

  itWithPowerShell(
    "keeps optional choice values from consuming the following PowerShell option",
    async () => {
      const program = new Command()
        .name("branch")
        .addOption(new Option("-c, --color [when]").choices(["always", "never"]))
        .option("-v, --verbose", "Verbose output");

      expect(await powerShellCompletion.complete(program, "branch --color a")).toEqual([
        "always",
      ]);
      expect(await powerShellCompletion.complete(program, "branch --color --v")).toEqual([
        "--verbose",
      ]);
    },
  );

  it("generates valid Bash completion without subcommands", () => {
    if (process.platform === "win32") {
      return;
    }

    const script = getCompletionScript("bash", new Command().name("branch"));
    const result = spawnSync("bash", ["--noprofile", "--norc", "-n"], {
      encoding: "utf8",
      input: script,
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
