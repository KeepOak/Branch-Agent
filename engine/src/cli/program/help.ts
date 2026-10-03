import type { Command } from "commander";
import { formatDocsLink } from "../../../packages/terminal-core/src/links.js";
import { isRich, theme } from "../../../packages/terminal-core/src/theme.js";
import { resolveCommitHash } from "../../infra/git-commit.js";
import { formatConsoleDiagnosticBlock } from "../../logging/json-console-line.js";
import { escapeRegExp } from "../../utils.js";
import { isRootVersionInvocation } from "../argv.js";
import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";
import { CLI_NAME } from "../cli-name.js";
import { formatHelpExamples } from "../help-format.js";
import { CLI_LOG_LEVEL_VALUES, parseCliLogLevelOption } from "../log-level-option.js";
import {
  getCommanderErrorCommandNames,
  getCommanderErrorCommandPath,
} from "./commander-parse-facts.js";
import { getCoreCliCommandsWithSubcommands } from "./core-command-descriptors.js";
import { formatCliParseErrorOutput } from "./error-output.js";
import { getSubCliCommandsWithSubcommands } from "./subcli-descriptors.js";

const CLI_NAME_PATTERN = escapeRegExp(CLI_NAME);
const ROOT_COMMANDS_WITH_SUBCOMMANDS = new Set([
  ...getCoreCliCommandsWithSubcommands(),
  ...getSubCliCommandsWithSubcommands(),
]);
const ROOT_COMMANDS_HINT =
  "Hint: commands suffixed with * have subcommands. Run <command> --help for details.";

const EXAMPLES = [
  ["branch onboard", "Run guided setup for a local Gateway, workspace, auth, and channels."],
  ["branch setup --baseline", "Create the baseline config, workspace, and session folders."],
  ["branch configure", "Change models, Gateway, channels, plugins, skills, and health checks."],
  ["branch status", "Check Gateway, channel, model, and recent-session status."],
  ["branch doctor --fix", "Repair common config, service, plugin, and channel problems."],
  ["branch channels add", "Add or update a chat channel account with guided prompts."],
  ["branch channels status", "See connected messaging accounts and login state."],
  ["branch --dev gateway", "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001."],
  ["branch gateway run --force", "Start the Gateway and replace anything bound to its port."],
  ["branch models status", "Show model/provider auth health before running agents."],
  ["branch plugins list", "Inspect enabled, disabled, and installed plugins."],
  [
    'branch agent --to +15555550123 --message "Run summary" --deliver',
    "Run one agent turn through the Gateway and optionally deliver the reply.",
  ],
  [
    'branch message send --channel telegram --target @mychat --message "Hi"',
    "Send via your Telegram bot.",
  ],
] as const;

export function formatProgramHelpOutput(str: string): string {
  // Commander emits plain section labels; decorate them after command-specific help renders.
  let output = str;
  const isRootHelp = new RegExp(
    `^Usage:\\s+${CLI_NAME_PATTERN}\\s+\\[options\\]\\s+\\[command\\]\\s*$`,
    "m",
  ).test(output);
  if (isRootHelp && /^Commands:/m.test(output)) {
    output = output.replace(/^Commands:/m, `Commands:\n  ${theme.muted(ROOT_COMMANDS_HINT)}`);
  }

  return output
    .replace(/^Usage:/gm, theme.heading("Usage:"))
    .replace(/^Options:/gm, theme.heading("Options:"))
    .replace(/^Commands:/gm, theme.heading("Commands:"));
}

export function configureProgramHelp(
  program: Command,
  ctx: { programVersion: string },
  options?: { commandsWithSubcommands?: ReadonlySet<string> },
) {
  const commandsWithSubcommands = new Set([
    ...ROOT_COMMANDS_WITH_SUBCOMMANDS,
    ...(options?.commandsWithSubcommands ?? []),
  ]);

  program
    .name(CLI_NAME)
    .description("")
    .version(ctx.programVersion)
    .option(
      "--container <name>",
      "Run the CLI inside a running Podman/Docker container named <name> (default: env BRANCH_CONTAINER)",
    )
    .option(
      "--dev",
      "Dev profile: isolate state under ~/.branch-dev, default gateway port 19001, and shift derived ports (browser/canvas)",
    )
    .option(
      "--profile <name>",
      "Use a named profile (isolates BRANCH_STATE_DIR/BRANCH_CONFIG_PATH under ~/.branch-<name>)",
    )
    .option(
      "--log-level <level>",
      `Global log level override for file + console (${CLI_LOG_LEVEL_VALUES})`,
      parseCliLogLevelOption,
    );

  program.option("--no-color", "Disable ANSI colors", false);
  program.helpOption("-h, --help", "Display help for command");
  program.helpCommand("help [command]", "Display help for command");

  program.configureHelp({
    sortSubcommands: true,
    sortOptions: true,
    optionTerm: (option) => theme.option(option.flags),
    subcommandTerm: (cmd) => {
      const isRootCommand = cmd.parent === program;
      const hasSubcommands = isRootCommand && commandsWithSubcommands.has(cmd.name());
      return theme.command(hasSubcommands ? `${cmd.name()} *` : cmd.name());
    },
  });

  program.configureOutput({
    writeOut: (str) => {
      process.stdout.write(formatProgramHelpOutput(str));
    },
    writeErr: (str) => {
      const message = formatProgramHelpOutput(str);
      process.stderr.write(formatConsoleDiagnosticBlock({ level: "error", message }));
    },
    outputError: (str, write) => {
      write(
        formatCliParseErrorOutput(str, {
          argv: process.argv,
          commandPath: getCommanderErrorCommandPath(program),
          commandNames: getCommanderErrorCommandNames(program),
        }),
      );
    },
  });

  if (isRootVersionInvocation(process.argv)) {
    const commit = resolveCommitHash({ moduleUrl: import.meta.url });
    console.log(
      commit ? `Branch Agent ${ctx.programVersion} (${commit})` : `Branch Agent ${ctx.programVersion}`,
    );
    process.exit(0);
  }

  program.addHelpText("beforeAll", () => {
    if (hasEmittedCliBanner() || process.env.BRANCH_SUPPRESS_HELP_BANNER === "1") {
      return "";
    }
    const rich = isRich();
    const line = formatCliBannerLine(ctx.programVersion, { richTty: rich, mode: "default" });
    return `\n${line}\n`;
  });

  const fmtExamples = formatHelpExamples(EXAMPLES);

  program.addHelpText("afterAll", ({ command }) => {
    if (command !== program) {
      return "";
    }
    const docs = formatDocsLink("/cli", "docs.openclaw.ai/cli");
    return `\n${theme.heading("Examples:")}\n${fmtExamples}\n\n${theme.muted("Docs:")} ${docs}\n`;
  });
}
