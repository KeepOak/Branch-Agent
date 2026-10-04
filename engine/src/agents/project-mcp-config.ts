// Project-level MCP servers read from `<workspace>/.branch/mcp.json`.
// Harvested from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16:
// src/utils/config.ts (injectEnv/injectVariables) and src/services/mcp/McpHub.ts
// (project file location, `{ mcpServers }` shape, `${env:*}`/`${workspaceFolder}`
// injection, project servers winning over global ones, removal when the file goes).
import fs from "node:fs";
import path from "node:path";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { canonicalizeConfiguredMcpServer } from "../config/mcp-config-normalize.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { BundleMcpDiagnostic, BundleMcpServerConfig } from "../plugins/bundle-mcp.js";
import {
  pluginCacheExistsSync,
  readPluginCacheDirectory,
  readPluginCacheRegularFile,
} from "../plugins/plugin-cache-files.js";
import { getScopedPluginCache } from "../plugins/plugin-cache.js";

/**
 * Workspace MCP files share one operation's plugin file facts (like plugin
 * bundle `.mcp.json` files); outside an operation scope each load reads disk,
 * so edits apply on the next turn.
 */
export const mcpWorkspaceFiles = {
  exists(filePath: string): boolean {
    return getScopedPluginCache() ? pluginCacheExistsSync(filePath) : fs.existsSync(filePath);
  },
  readText(filePath: string): string {
    if (!getScopedPluginCache()) {
      return fs.readFileSync(filePath, "utf8");
    }
    const entry = readPluginCacheRegularFile({ filePath });
    if (!entry.ok) {
      throw (
        entry.failure.error ?? Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" })
      );
    }
    return entry.contents.toString("utf8");
  },
  readDir(dir: string): fs.Dirent[] {
    return getScopedPluginCache()
      ? readPluginCacheDirectory(dir)
      : fs.readdirSync(dir, { withFileTypes: true });
  },
};

export const PROJECT_MCP_CONFIG_PATH = path.join(".branch", "mcp.json");
const PROJECT_MCP_DIAGNOSTIC_OWNER = "project-mcp";

export type InjectableConfigType =
  | string
  | {
      [key: string]:
        | undefined
        | null
        | boolean
        | number
        | InjectableConfigType
        | Array<undefined | null | boolean | number | InjectableConfigType>;
    };

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deeply injects variables into a configuration object/string/json
 *
 * Uses VSCode's variables reference pattern: https://code.visualstudio.com/docs/reference/variables-reference#_environment-variables
 *
 * Does not mutate original object
 *
 * There is a special handling for a nested (record-type) variables, where it is replaced by `propNotFoundValue` (if available) if the root key exists but the nested key does not.
 *
 * Matched keys that have `null` | `undefined` values are treated as not found.
 */
export function injectVariables<C extends InjectableConfigType>(
  config: C,
  variables: Record<string, undefined | null | string | Record<string, undefined | null | string>>,
  propNotFoundValue?: unknown,
): C {
  const isObject = typeof config === "object";
  let configString: string = isObject ? JSON.stringify(config) : (config as string);

  for (const [key, value] of Object.entries(variables)) {
    if (value == null) {
      continue;
    }

    if (typeof value === "string") {
      // Normalize paths to forward slashes for cross-platform compatibility
      configString = configString.replace(new RegExp(`\\$\\{${escapeRegExp(key)}\\}`, "g"), () =>
        toPosix(value),
      );
    } else {
      // Handle nested variables (e.g., ${env:VAR_NAME})
      configString = configString.replace(
        new RegExp(`\\$\\{${escapeRegExp(key)}:([\\w]+)\\}`, "g"),
        (match, name: string) => {
          const nestedValue = value[name];

          if (nestedValue == null) {
            console.warn(
              `[injectVariables] variable "${name}" referenced but not found in "${key}"`,
            );
            return (propNotFoundValue ?? match) as string;
          }

          // Normalize paths for string values
          return toPosix(nestedValue);
        },
      );
    }
  }

  return (isObject ? JSON.parse(configString) : configString) as C;
}

/**
 * Deeply injects environment variables into a configuration object/string/json
 *
 * Uses VSCode env:name pattern: https://code.visualstudio.com/docs/reference/variables-reference#_environment-variables
 *
 * Does not mutate original object
 */
export function injectEnv<C extends InjectableConfigType>(
  config: C,
  notFoundValue: unknown = "",
): C {
  return injectVariables(config, { env: process.env }, notFoundValue);
}

/** Maps a project server entry (Roo/Claude-style keys) onto Branch's canonical server keys. */
function toBranchServerConfig(
  server: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (server.disabled === true) {
    return undefined;
  }
  const next = canonicalizeConfiguredMcpServer(server);
  delete next.disabled;
  // Roo's `timeout` is seconds per request.
  if (typeof next.timeout === "number" && next.requestTimeoutMs === undefined) {
    next.requestTimeoutMs = next.timeout * 1000;
  }
  delete next.timeout;
  if (Array.isArray(next.disabledTools) && next.disabledTools.length > 0 && !next.toolFilter) {
    next.toolFilter = { exclude: next.disabledTools.filter((name) => typeof name === "string") };
  }
  delete next.disabledTools;
  delete next.alwaysAllow;
  delete next.watchPaths;
  return next;
}

/** Reads project MCP servers; a missing file means no project servers. */
export function loadProjectMcpServers(workspaceDir: string): {
  mcpServers: Record<string, BundleMcpServerConfig>;
  diagnostics: BundleMcpDiagnostic[];
} {
  const filePath = path.join(workspaceDir, PROJECT_MCP_CONFIG_PATH);
  if (!mcpWorkspaceFiles.exists(filePath)) {
    return { mcpServers: {}, diagnostics: [] };
  }
  let content: string;
  try {
    content = mcpWorkspaceFiles.readText(filePath);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { mcpServers: {}, diagnostics: [] };
    }
    return {
      mcpServers: {},
      diagnostics: [
        {
          pluginId: PROJECT_MCP_DIAGNOSTIC_OWNER,
          message: `unable to read ${filePath}: ${formatErrorMessage(error)}`,
        },
      ],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      mcpServers: {},
      diagnostics: [
        {
          pluginId: PROJECT_MCP_DIAGNOSTIC_OWNER,
          message: `invalid JSON in ${filePath}: ${formatErrorMessage(error)}`,
        },
      ],
    };
  }
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    return {
      mcpServers: {},
      diagnostics: [
        {
          pluginId: PROJECT_MCP_DIAGNOSTIC_OWNER,
          message: `${filePath} must contain an "mcpServers" object`,
        },
      ],
    };
  }
  const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const injected = injectVariables(servers as InjectableConfigType, {
    env: process.env,
    workspaceFolder: workspaceDir,
  }) as Record<string, unknown>;
  const mcpServers: Record<string, BundleMcpServerConfig> = {};
  for (const [name, server] of Object.entries(injected)) {
    if (!isRecord(server)) {
      continue;
    }
    const converted = toBranchServerConfig(server);
    if (converted) {
      mcpServers[name] = converted as BundleMcpServerConfig;
    }
  }
  return { mcpServers, diagnostics: [] };
}
