// Migrate Hermes provider module implements model/runtime integration.
import fs from "node:fs/promises";
import path from "node:path";
import type { MigrationProviderContext } from "branch/plugin-sdk/plugin-entry";
import type { BranchConfig } from "branch/plugin-sdk/provider-auth";

function noop() {}

const logger: MigrationProviderContext["logger"] = {
  debug: noop,
  error: noop,
  info: noop,
  warn: noop,
};

export function makeHermesPaths(root: string, sourceName = "hermes") {
  const stateDir = path.join(root, "state");
  return {
    root,
    source: path.join(root, sourceName),
    workspaceDir: path.join(root, "workspace"),
    stateDir,
    reportDir: path.join(root, "report"),
    agentDir: path.join(stateDir, "agents", "main", "agent"),
  };
}

export async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export function makeConfigRuntime(
  config: BranchConfig,
  onWrite?: (next: BranchConfig) => void,
): NonNullable<MigrationProviderContext["runtime"]> {
  const commitConfig = (next: BranchConfig) => {
    (Object.keys(config) as Array<keyof BranchConfig>).forEach((key) => delete config[key]);
    Object.assign(config, next);
    onWrite?.(next);
  };

  return {
    config: {
      current: () => config,
      mutateConfigFile: async ({
        afterWrite,
        mutate,
      }: {
        afterWrite?: unknown;
        mutate: (draft: BranchConfig, context: unknown) => Promise<unknown> | void;
      }) => {
        const next = structuredClone(config);
        const result = await mutate(next, {
          previousHash: null,
          persistedHash: null,
          snapshot: { config, raw: "", hash: null },
        });
        commitConfig(next);
        return {
          afterWrite,
          followUp: { mode: "auto", requiresRestart: false },
          nextConfig: next,
          result,
        };
      },
      replaceConfigFile: async ({
        afterWrite,
        nextConfig,
      }: {
        afterWrite?: unknown;
        nextConfig: BranchConfig;
      }) => {
        commitConfig(nextConfig);
        return { afterWrite, followUp: { mode: "auto", requiresRestart: false }, nextConfig };
      },
    },
  } as NonNullable<MigrationProviderContext["runtime"]>;
}

export function makeContext(params: {
  source: string;
  stateDir: string;
  workspaceDir: string;
  config?: BranchConfig;
  includeSecrets?: boolean;
  overwrite?: boolean;
  itemKinds?: string[];
  targetAgentId?: string;
  model?: NonNullable<NonNullable<BranchConfig["agents"]>["defaults"]>["model"];
  reportDir?: string;
  runtime?: MigrationProviderContext["runtime"];
}): MigrationProviderContext {
  const config =
    params.config ??
    ({
      agents: {
        defaults: {
          workspace: params.workspaceDir,
          ...(params.model !== undefined ? { model: params.model } : {}),
        },
      },
    } as BranchConfig);
  return {
    config,
    stateDir: params.stateDir,
    source: params.source,
    includeSecrets: params.includeSecrets,
    overwrite: params.overwrite,
    itemKinds: params.itemKinds,
    targetAgentId: params.targetAgentId,
    reportDir: params.reportDir,
    runtime: params.runtime,
    logger,
  };
}
