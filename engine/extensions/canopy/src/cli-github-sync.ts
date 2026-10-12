import type { CanopyCard } from "@branch/canopy-contract";
import { addGatewayClientOptions } from "branch/plugin-sdk/gateway-runtime";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type { Command } from "commander";
import {
  createGitHubIssuesClient,
  parseGitHubRepo,
  queueJobsFromGateway,
  runCanopyGitHubSync,
  type CanopyGitHubSyncPorts,
} from "./github-issues-sync.js";

type GitHubSyncOptions = {
  repo: string;
  board?: string;
  tokenEnv?: string;
  dryRun?: boolean;
  json?: boolean;
  url?: string;
  token?: string;
  timeout?: string;
};

export type CanopyCliGatewayCall = (
  method: string,
  options: GitHubSyncOptions,
  params?: unknown,
) => Promise<unknown>;

function readGitHubToken(tokenEnv: string | undefined): string {
  const names = tokenEnv ? [tokenEnv] : ["GH_TOKEN", "GITHUB_TOKEN"];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(
    "Set " +
      names.join(" or ") +
      " to a GitHub token that can read and edit the repository's issues.",
  );
}

function cardsFromList(value: unknown): CanopyCard[] {
  return isRecord(value) && Array.isArray(value.cards) ? (value.cards as CanopyCard[]) : [];
}

/** Gateway-backed ports: cards and queue come from this Gateway, issues from GitHub. */
export function createCanopyGitHubSyncPorts(params: {
  repo: string;
  token: string;
  boardId?: string;
  callGateway: (method: string, params?: unknown) => Promise<unknown>;
  fetchImpl?: typeof fetch;
}): CanopyGitHubSyncPorts {
  const github = createGitHubIssuesClient({
    repo: params.repo,
    token: params.token,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });
  const board = params.boardId ? { boardId: params.boardId } : {};
  return {
    listIssues: github.listIssues,
    patchIssue: github.patchIssue,
    listCards: async () => cardsFromList(await params.callGateway("canopy.cards.list", board)),
    listQueueJobs: async () =>
      queueJobsFromGateway(await params.callGateway("trunks.queue.list", {})),
    createCard: async (input) => {
      await params.callGateway("canopy.cards.create", { ...input, ...board });
    },
    updateCard: async (update) => {
      await params.callGateway("canopy.cards.update", {
        id: update.id,
        patch: update.patch,
        expectedUpdatedAt: update.expectedUpdatedAt,
      });
    },
  };
}

export function registerCanopyGitHubSyncCli(params: {
  canopy: Command;
  callGateway: CanopyCliGatewayCall;
  fetchImpl?: typeof fetch;
}): void {
  addGatewayClientOptions(
    params.canopy
      .command("github-sync")
      .description(
        "Two-way sync a Canopy board with a GitHub repository's issues (Board's Bring in issues)",
      )
      .requiredOption("--repo <owner/name>", "GitHub repository whose issues fill the board")
      .option("--board <id>", "Board id")
      .option("--token-env <name>", "Environment variable holding the GitHub token")
      .option("--dry-run", "Print the plan without writing", false)
      .option("--json", "Print JSON", false),
  ).action(async (options: GitHubSyncOptions) => {
    const repo = parseGitHubRepo(options.repo);
    const ports = createCanopyGitHubSyncPorts({
      repo,
      token: readGitHubToken(options.tokenEnv),
      boardId: options.board,
      callGateway: (method, request) => params.callGateway(method, options, request),
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });
    const result = await runCanopyGitHubSync({ repo, ports, dryRun: options.dryRun });
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      const { plan } = result;
      process.stdout.write(
        (options.dryRun
          ? "github-sync plan: create=" +
            plan.createCards.length +
            " update=" +
            plan.updateCards.length +
            " push=" +
            plan.patchIssues.length
          : "github-sync complete: created=" +
            result.created +
            " updated=" +
            result.updated +
            " pushed=" +
            result.pushed +
            " failures=" +
            result.failures.length) + "\n",
      );
      for (const failure of result.failures) {
        process.stdout.write("  " + failure + "\n");
      }
    }
    if (result.failures.length > 0) {
      process.exitCode = 1;
    }
  });
}
