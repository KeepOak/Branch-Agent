// Memory Wiki CLI commands for knowledge sources: pinned reference pages and data connectors.
import type { Command } from "commander";
import type { BranchConfig } from "../api.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import type { RepoPlatform } from "./connectors/repo-types.js";
import {
  readConnectorSources,
  resyncConnectorSources,
  runConnectorImport,
  setConnectorSourceWatch,
  type ConnectorResyncResult,
  type ConnectorRunResult,
  type ConnectorSourceRecord,
  type ConnectorSpec,
} from "./connectors/sources.js";
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

  registerWikiConnectorCommands(wiki, deps);
}

type ConnectorCommandOptions = {
  json?: boolean;
  watch?: boolean;
  platform?: RepoPlatform;
  branch?: string;
  ignore?: string[];
  issues?: boolean;
  wikis?: boolean;
  tokenEnv?: string;
  patEnv?: string;
  baseUrl?: string;
  spaceKey?: string;
  spaceIds?: string;
  username?: string;
  selfHosted?: boolean;
  all?: boolean;
  source?: string;
};

const DEFAULT_TOKEN_ENV: Record<RepoPlatform, string> = {
  github: "GITHUB_TOKEN",
  gitlab: "GITLAB_TOKEN",
  gitea: "GITEA_TOKEN",
};

function inferRepoPlatform(repoUrl: string, explicit?: RepoPlatform): RepoPlatform {
  if (explicit) {
    return explicit;
  }
  try {
    return new URL(repoUrl).hostname.includes("gitlab") ? "gitlab" : "github";
  } catch {
    return "github";
  }
}

function formatConnectorRun(result: ConnectorRunResult): string {
  if (!result.success) {
    return `Connector import failed: ${result.reason}`;
  }
  return `Imported ${result.sourceId}: ${result.importedCount} new, ${result.updatedCount} updated, ${result.skippedCount} unchanged, ${result.removedCount} removed${result.watched ? " (watched)" : ""}.`;
}

function formatResync(result: ConnectorResyncResult): string {
  const lines = [`Checked ${result.checked} connector source${result.checked === 1 ? "" : "s"}.`];
  for (const synced of result.synced) {
    lines.push(
      `- ${synced.sourceId}: ${synced.importedCount} new, ${synced.updatedCount} updated, ${synced.removedCount} removed`,
    );
  }
  for (const failed of result.failed) {
    lines.push(`- ${failed.sourceId}: failed (${failed.reason}), attempt ${failed.attempt}`);
  }
  for (const sourceId of result.unwatched) {
    lines.push(`- ${sourceId}: failed too many times and is no longer watched`);
  }
  return lines.join("\n");
}

function formatSourceList(sources: ConnectorSourceRecord[]): string {
  if (sources.length === 0) {
    return "No connector sources imported.";
  }
  return sources
    .map((source) =>
      source.watched && source.nextSyncAt
        ? `- ${source.sourceId} (watched, next sync ${new Date(source.nextSyncAt).toISOString()})`
        : `- ${source.sourceId}`,
    )
    .join("\n");
}

function addConnectorCommonOptions(command: Command): Command {
  return command
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .option("--watch", "Re-sync this source with `wiki connector resync`", false)
    .option("--json", "Print JSON");
}

function registerConnectorImportCommands(
  connector: Command,
  run: (spec: ConnectorSpec, opts: ConnectorCommandOptions) => Promise<void>,
): void {
  addConnectorCommonOptions(
    connector
      .command("repo")
      .description("Import a GitHub, GitLab or Gitea repository")
      .argument("<url>", "Repository URL")
      .option("--platform <platform>", "github, gitlab or gitea (default: from the URL)")
      .option("--branch <branch>", "Branch (default: the repository default)")
      .option("--ignore <pattern>", "gitignore-style path to skip (repeatable)", collectOption)
      .option("--issues", "GitLab: also import issues", false)
      .option("--wikis", "GitLab: also import wiki pages", false)
      .option("--token-env <name>", "Environment variable holding the access token"),
  ).action(async (url: string, opts: ConnectorCommandOptions) => {
    const platform = inferRepoPlatform(url, opts.platform);
    await run(
      {
        kind: platform,
        repo: url,
        ...(opts.branch ? { branch: opts.branch } : {}),
        ignorePaths: opts.ignore ?? [],
        fetchIssues: opts.issues === true,
        fetchWikis: opts.wikis === true,
        tokenEnv: opts.tokenEnv ?? DEFAULT_TOKEN_ENV[platform],
      },
      opts,
    );
  });

  addConnectorCommonOptions(
    connector.command("link").description("Import a web page").argument("<url>", "Page URL"),
  ).action(async (url: string, opts: ConnectorCommandOptions) => {
    await run({ kind: "link", url }, opts);
  });

  connector
    .command("obsidian")
    .description("Import the notes of an Obsidian vault folder")
    .argument("<vault>", "Vault folder")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .option("--json", "Print JSON")
    .action(async (vault: string, opts: ConnectorCommandOptions) => {
      await run({ kind: "obsidian", path: vault }, opts);
    });

  addConnectorCommonOptions(
    connector
      .command("confluence")
      .description("Import every page of a Confluence space")
      .requiredOption("--base-url <url>", "Confluence base URL")
      .requiredOption("--space-key <key>", "Space key")
      .option("--self-hosted", "Server/Data Center instance (no /wiki prefix)", false)
      .option("--username <name>", "Username for the API token")
      .option(
        "--token-env <name>",
        "Environment variable holding the API token",
        "CONFLUENCE_API_TOKEN",
      )
      .option("--pat-env <name>", "Environment variable holding a personal access token"),
  ).action(async (opts: ConnectorCommandOptions) => {
    await run(
      {
        kind: "confluence",
        baseUrl: opts.baseUrl ?? "",
        spaceKey: opts.spaceKey ?? "",
        cloud: opts.selfHosted !== true,
        ...(opts.username ? { username: opts.username } : {}),
        ...(opts.tokenEnv ? { tokenEnv: opts.tokenEnv } : {}),
        ...(opts.patEnv ? { personalAccessTokenEnv: opts.patEnv } : {}),
      },
      opts,
    );
  });

  addConnectorCommonOptions(
    connector
      .command("paperless")
      .description("Import the documents of a Paperless-ngx instance")
      .requiredOption("--base-url <url>", "Paperless-ngx base URL")
      .option(
        "--token-env <name>",
        "Environment variable holding the API token",
        "PAPERLESS_API_TOKEN",
      ),
  ).action(async (opts: ConnectorCommandOptions) => {
    await run(
      {
        kind: "paperless",
        baseUrl: opts.baseUrl ?? "",
        ...(opts.tokenEnv ? { tokenEnv: opts.tokenEnv } : {}),
      },
      opts,
    );
  });

  addConnectorCommonOptions(
    connector
      .command("drupalwiki")
      .description("Import the pages of DrupalWiki spaces")
      .requiredOption("--base-url <url>", "DrupalWiki base URL")
      .requiredOption("--space-ids <ids>", "Comma-separated space ids, like 21,56,67")
      .option(
        "--token-env <name>",
        "Environment variable holding the REST API token",
        "DRUPALWIKI_API_TOKEN",
      ),
  ).action(async (opts: ConnectorCommandOptions) => {
    await run(
      {
        kind: "drupalwiki",
        baseUrl: opts.baseUrl ?? "",
        spaceIds: opts.spaceIds ?? "",
        ...(opts.tokenEnv ? { tokenEnv: opts.tokenEnv } : {}),
      },
      opts,
    );
  });
}

function registerConnectorSyncCommands(connector: Command, deps: WikiKnowledgeCliDeps): void {
  connector
    .command("list")
    .description("List imported connector sources")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .option("--json", "Print JSON")
    .action(async (opts: ConnectorCommandOptions) => {
      const { config } = deps.requireCommandContext();
      deps.printWikiResult(await readConnectorSources(config), opts.json, formatSourceList);
    });

  for (const [name, watched] of [
    ["watch", true],
    ["unwatch", false],
  ] as const) {
    connector
      .command(name)
      .description(watched ? "Re-sync a source when it goes stale" : "Stop re-syncing a source")
      .argument("<source-id>", "Source id from `wiki connector list`")
      .option("--agent <id>", "Agent id (default: configured default agent)")
      .option("--json", "Print JSON")
      .action(async (sourceId: string, opts: ConnectorCommandOptions) => {
        const { config } = deps.requireCommandContext();
        deps.printWikiResult(
          await setConnectorSourceWatch({ config, sourceId, watched }),
          opts.json,
          (record) => `${record.sourceId} is ${record.watched ? "watched" : "not watched"}.`,
        );
      });
  }

  connector
    .command("resync")
    .description("Re-sync watched sources that are due (or all of them)")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .option("--all", "Re-sync every watched source now", false)
    .option("--source <id>", "Re-sync one recorded source now")
    .option("--json", "Print JSON")
    .action(async (opts: ConnectorCommandOptions) => {
      const { config } = deps.requireCommandContext();
      deps.printWikiResult(
        await resyncConnectorSources({
          config,
          ...(opts.all ? { force: true } : {}),
          ...(opts.source ? { sourceId: opts.source } : {}),
        }),
        opts.json,
        formatResync,
      );
    });
}

function registerWikiConnectorCommands(wiki: Command, deps: WikiKnowledgeCliDeps): void {
  const connector = wiki
    .command("connector")
    .description("Import external knowledge sources into wiki source pages");
  registerConnectorImportCommands(connector, async (spec, opts) => {
    const { config } = deps.requireCommandContext();
    const result = deps.printWikiResult(
      await runConnectorImport({ config, spec, ...(opts.watch ? { watch: true } : {}) }),
      opts.json,
      formatConnectorRun,
    );
    if (!result.success) {
      process.exitCode = 1;
    }
  });
  registerConnectorSyncCommands(connector, deps);
}
