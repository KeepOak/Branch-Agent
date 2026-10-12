// Commander registration for experimental Groves inspection and add previews.
import type { Command } from "commander";
import { isExperimentalGrovesEnabled } from "../groves/experimental.js";
import { collectOption } from "./program/helpers.js";
import { applyParentDefaultHelpAction } from "./program/parent-default-help.js";

export type GrovesInspectOptions = {
  json?: boolean;
};

export type GrovesCreateOptions = GrovesInspectOptions & {
  name?: string;
  agentId?: string;
};
export type GrovesValidateOptions = { json?: boolean };
export type GrovesBuildOptions = { out: string; json?: boolean };
export type GrovesDevOptions = { agentId?: string; workspace?: string; json?: boolean };

export type GrovesAddOptions = GrovesDevOptions & {
  dryRun?: boolean;
  yes?: boolean;
  planIntegrity?: string;
};
export type GrovesMigrateOptions = {
  dryRun?: boolean;
  yes?: boolean;
  planIntegrity?: string;
  json?: boolean;
};

export type GrovesStatusOptions = { json?: boolean };
export type GrovesUpdateOptions = Omit<GrovesAddOptions, "agentId" | "workspace"> & {
  from?: string;
};
export type GrovesRemoveOptions = Omit<GrovesAddOptions, "agentId" | "workspace"> & {
  removeUnused?: boolean;
  removeReferenced?: string[];
  forceReferenced?: boolean;
};
export type GrovesExportOptions = { out: string; bootstrap?: string; json?: boolean };

export function registerGrovesCli(program: Command) {
  if (!isExperimentalGrovesEnabled()) {
    return;
  }
  const groves = program.command("groves").description("Manage experimental Branch Agent Groves");

  groves
    .command("create")
    .description("Create a minimal local Grove project")
    .argument("[path]", "New project directory", ".")
    .option("--name <name>", "Set the package name")
    .option("--agent-id <id>", "Set the portable agent id")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: GrovesCreateOptions) => {
      const { runGrovesCreateCommand } = await import("./groves-cli.project.js");
      await runGrovesCreateCommand(path, opts);
    });

  groves
    .command("validate")
    .description("Validate a local Grove project")
    .argument("[path]", "Project directory", ".")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: GrovesValidateOptions) => {
      const { runGrovesValidateCommand } = await import("./groves-cli.project.js");
      await runGrovesValidateCommand(path, opts);
    });

  groves
    .command("dev")
    .description("Build and preview a local Grove without network or mutation")
    .argument("[path]", "Project directory", ".")
    .option("--agent-id <id>", "Preview with an unused local agent id")
    .option("--workspace <path>", "Preview with a new workspace path")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: GrovesDevOptions) => {
      const { runGrovesDevCommand } = await import("./groves-cli.project.js");
      await runGrovesDevCommand(path, opts);
    });

  groves
    .command("build")
    .description("Build a deterministic Grove package artifact")
    .argument("[path]", "Project directory", ".")
    .requiredOption("--out <artifact>", "New .tgz artifact to create")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: GrovesBuildOptions) => {
      const { runGrovesBuildCommand } = await import("./groves-cli.project.js");
      await runGrovesBuildCommand(path, opts);
    });

  groves
    .command("inspect")
    .description("Validate a Grove package or local development manifest")
    .argument("<source>", "Path to a Grove package directory or grouped manifest")
    .option("--json", "Print JSON", false)
    .action(async (source: string, opts: GrovesInspectOptions) => {
      const { runGrovesInspectCommand } = await import("./groves-cli.runtime.js");
      await runGrovesInspectCommand(source, opts);
    });

  groves
    .command("add")
    .description("Preview adding one new agent and workspace from a Grove")
    .argument("<source>", "Path to a Grove package directory or grouped manifest")
    .option("--dry-run", "Preview all actions without mutating state", false)
    .option("--yes", "Confirm creation of the new agent and workspace", false)
    .option("--plan-integrity <digest>", "Bind consent to an exact dry-run plan")
    .option("--agent-id <id>", "Override the requested id with an unused local agent id")
    .option("--workspace <path>", "Override the derived new workspace path")
    .option("--json", "Print JSON", false)
    .action(async (source: string, opts: GrovesAddOptions) => {
      const { runGrovesAddCommand } = await import("./groves-cli.runtime.js");
      await runGrovesAddCommand(source, opts);
    });

  groves
    .command("status")
    .description("Show installed Grove agents and managed-state drift")
    .argument("[grove-or-agent]", "Installed package name or final agent id")
    .option("--json", "Print JSON", false)
    .action(async (target: string | undefined, opts: GrovesStatusOptions) => {
      const { runGrovesStatusCommand } = await import("./groves-cli.runtime.js");
      await runGrovesStatusCommand(target, opts);
    });

  groves
    .command("migrate")
    .description("Enroll one existing local agent as a Grove without replacing its workspace")
    .argument("<agent-id>", "Existing configured agent id")
    .option("--dry-run", "Preview migration without creating a package or ownership record", false)
    .option("--yes", "Apply after confirming the exact migration plan", false)
    .option("--plan-integrity <digest>", "Bind automation consent to an exact dry-run plan")
    .option("--json", "Print JSON", false)
    .action(async (agentId: string, opts: GrovesMigrateOptions) => {
      const { runGrovesMigrateCommand } = await import("./groves-migrate-cli.runtime.js");
      await runGrovesMigrateCommand(agentId, opts);
    });

  groves
    .command("update")
    .description("Plan changes to one installed Grove agent")
    .argument("<grove-or-agent>", "Installed package name or final agent id")
    .option("--from <source>", "Override the target source recorded at Grove add time")
    .option("--dry-run", "Preview update actions without mutating state", false)
    .option("--yes", "Confirm the exact supported update plan", false)
    .option("--plan-integrity <digest>", "Bind consent to an exact update plan")
    .option("--json", "Print JSON", false)
    .action(async (target: string, opts: GrovesUpdateOptions) => {
      const { runGrovesUpdateCommand } = await import("./groves-update-cli.runtime.js");
      await runGrovesUpdateCommand(target, opts);
    });

  groves
    .command("remove")
    .description("Plan or remove one Grove-created agent and owned state")
    .argument("<grove-or-agent>", "Installed package name or final agent id")
    .option("--dry-run", "Preview removal without mutating state", false)
    .option("--yes", "Confirm removal", false)
    .option("--plan-integrity <digest>", "Bind consent to an exact removal plan")
    .option(
      "--remove-unused",
      "Remove unchanged Grove-introduced references with no other current owner",
      false,
    )
    .option(
      "--remove-referenced <resource>",
      "Remove an exact referenced resource (repeatable)",
      collectOption,
      [],
    )
    .option(
      "--force-referenced",
      "Allow selected cleanup despite other dependents, owners, or pre-existing origin",
      false,
    )
    .option("--json", "Print JSON", false)
    .action(async (target: string, opts: GrovesRemoveOptions) => {
      const { runGrovesRemoveCommand } = await import("./groves-cli.runtime.js");
      await runGrovesRemoveCommand(target, opts);
    });

  groves
    .command("export")
    .description("Export portable state for one installed Grove agent")
    .argument("<agent>", "Final id of the installed Grove agent")
    .requiredOption("--out <path>", "New package directory to create")
    .option("--bootstrap <path>", "Reviewed Markdown file to export as package BOOTSTRAP.md")
    .option("--json", "Print JSON", false)
    .action(async (agent: string, opts: GrovesExportOptions) => {
      const { runGrovesExportCommand } = await import("./groves-cli.runtime.js");
      await runGrovesExportCommand(agent, opts);
    });

  applyParentDefaultHelpAction(groves);
}
