// Memory Wiki CLI commands for knowledge sources: pinned reference pages.
import type { Command } from "commander";
import type { BranchConfig } from "../api.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { setMemoryWikiPagePin, type SetWikiPagePinResult } from "./pinning.js";

export type WikiKnowledgeCliDeps = {
  requireCommandContext: () => {
    agentId?: string;
    appConfig?: BranchConfig;
    config: ResolvedMemoryWikiConfig;
  };
  printWikiResult: <T>(result: T, json: boolean | undefined, render: (result: T) => string) => T;
};

type WikiPinCommandOptions = {
  json?: boolean;
  session?: string[];
  agentWide?: boolean;
};

function collectOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function formatPinSummary(result: SetWikiPagePinResult): string {
  const { agent, sessionKeys } = result.targets;
  const scopes = [...(agent ? ["every chat"] : []), ...sessionKeys];
  const state = scopes.length > 0 ? `pinned for ${scopes.join(", ")}` : "unpinned";
  return `${result.changed ? "Updated" : "Unchanged"} ${result.pagePath}: ${state}.`;
}

export function registerWikiKnowledgeCommands(wiki: Command, deps: WikiKnowledgeCliDeps): void {
  wiki
    .command("pin")
    .description("Pin a wiki page so it is always included in full in the agent's context")
    .argument("<lookup>", "Page path, id, or title")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .option("--session <key>", "Pin only for this chat session key (repeatable)", collectOption)
    .option("--agent-wide", "Also pin for every chat when --session is given", false)
    .option("--json", "Print JSON")
    .action(async (lookup: string, opts: WikiPinCommandOptions) => {
      const { config } = deps.requireCommandContext();
      const sessionKeys = opts.session ?? [];
      deps.printWikiResult(
        await setMemoryWikiPagePin({
          config,
          lookup,
          targets: { agent: sessionKeys.length === 0 || opts.agentWide === true, sessionKeys },
        }),
        opts.json,
        formatPinSummary,
      );
    });

  wiki
    .command("unpin")
    .description("Remove a wiki page pin")
    .argument("<lookup>", "Page path, id, or title")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .option("--json", "Print JSON")
    .action(async (lookup: string, opts: WikiPinCommandOptions) => {
      const { config } = deps.requireCommandContext();
      deps.printWikiResult(
        await setMemoryWikiPagePin({ config, lookup, targets: { agent: false, sessionKeys: [] } }),
        opts.json,
        formatPinSummary,
      );
    });
}
