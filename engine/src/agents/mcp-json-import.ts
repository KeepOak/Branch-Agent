// Claude-style MCP JSON files dropped into `.branch/mcpServers/` folders.
// Harvested from continuedev/continue@5522c6f44ca0ac3528b37244818fbfa39b5af470:
// packages/config-yaml/src/schemas/mcp/json.ts (accepted shapes),
// packages/config-yaml/src/schemas/mcp/convertJson.ts (per-server conversion) and
// core/context/mcp/json/loadJsonMcpConfigs.ts (folders, file walk, parsing, de-duplication).
import path from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import { resolveStateDir } from "../config/state-dir.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { BundleMcpDiagnostic, BundleMcpServerConfig } from "../plugins/bundle-mcp.js";
import { mcpWorkspaceFiles } from "./project-mcp-config.js";

// This is the schema for an entry in e.g. Claude Desktop, Claude code mcp config
const httpOrSseMcpJsonSchema = z.object({
  type: z.union([z.literal("sse"), z.literal("http")]).optional(),
  url: z.string(), // .url() fails with e.g. IP addresses
  headers: z.record(z.string(), z.string()).optional(),
});
export type HttpMcpJsonConfig = z.infer<typeof httpOrSseMcpJsonSchema>;
export type SseMcpJsonConfig = z.infer<typeof httpOrSseMcpJsonSchema>;

const stdioMcpJsonSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().optional(),
});
export type StdioMcpJsonConfig = z.infer<typeof stdioMcpJsonSchema>;

export const mcpServersJsonSchema = z.union([httpOrSseMcpJsonSchema, stdioMcpJsonSchema]);
export type McpJsonConfig = z.infer<typeof mcpServersJsonSchema>;

export const mcpServersRecordSchema = z.record(z.string(), mcpServersJsonSchema);

export const claudeDesktopLikeConfigFileSchema = z.object({
  mcpServers: mcpServersRecordSchema,
});

export const claudeCodeLikeConfigFileSchema = z.object({
  mcpServers: mcpServersRecordSchema.optional(),
  projects: z.record(z.string(), z.object({ mcpServers: mcpServersRecordSchema.optional() })),
});

/** Folder (inside a workspace or the state directory) holding dropped-in MCP JSON files. */
export const MCP_JSON_FOLDER = path.join(".branch", "mcpServers");

/**
 * Resolves `${VAR}` references in JSON env/header values from the process
 * environment (Continue maps them to `${{ secrets.VAR }}` for its own resolver).
 */
export function resolveJsonEnvReferences(
  values: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value.replace(/\$\{([^}]+)\}/g, (match, name: string) => env[name] ?? match),
    ]),
  );
}

/** Convert from the JSON schema (used in Claude Desktop) to a Branch MCP server entry. */
export function convertJsonMcpConfigToBranchServer(
  name: string,
  jsonConfig: McpJsonConfig,
  env: NodeJS.ProcessEnv = process.env,
): { server: BundleMcpServerConfig; warnings: string[] } {
  const warnings: string[] = [];

  // STDIO
  if ("command" in jsonConfig) {
    if (jsonConfig.envFile) {
      warnings.push(
        `envFile is not supported in Branch MCP configuration (server "${name}"). Environment variables from file will not be used.`,
      );
    }
    const resolvedEnv = resolveJsonEnvReferences(jsonConfig.env, env);
    return {
      warnings,
      server: {
        command: jsonConfig.command,
        ...(jsonConfig.args ? { args: jsonConfig.args } : {}),
        ...(resolvedEnv ? { env: resolvedEnv } : {}),
      },
    };
  }

  // SSE/HTTP
  if ("url" in jsonConfig) {
    const headers = resolveJsonEnvReferences(jsonConfig.headers, env);
    return {
      warnings,
      server: {
        url: jsonConfig.url,
        ...(jsonConfig.type
          ? { transport: jsonConfig.type === "http" ? "streamable-http" : "sse" }
          : {}),
        ...(headers ? { headers } : {}),
      },
    };
  }

  throw new Error(`Invalid MCP server configuration`);
}

/** Every server entry one JSON file declares (Claude Code, Claude Desktop or single-server shape). */
export function parseMcpJsonFile(
  filePath: string,
  content: string,
): { entries: Array<{ name: string; mcpJson: McpJsonConfig }>; error?: string } {
  let json: unknown;
  try {
    json = JSON5.parse(content);
  } catch (e) {
    return {
      entries: [],
      error: `Error parsing MCP JSON file at ${filePath}: ${formatErrorMessage(e)}`,
    };
  }
  // Try parsing as a file with mcpServers and multiple servers (claude code/desktop-esque format)
  const claudeCodeFileParsed = claudeCodeLikeConfigFileSchema.safeParse(json);
  if (claudeCodeFileParsed.success) {
    const entries = Object.entries(claudeCodeFileParsed.data.mcpServers ?? {}).map(
      ([name, mcpJson]) => ({ name, mcpJson }),
    );
    for (const project of Object.values(claudeCodeFileParsed.data.projects)) {
      entries.push(
        ...Object.entries(project.mcpServers ?? {}).map(([name, mcpJson]) => ({ name, mcpJson })),
      );
    }
    return { entries };
  }
  const claudeDesktopFileParsed = claudeDesktopLikeConfigFileSchema.safeParse(json);
  if (claudeDesktopFileParsed.success) {
    return {
      entries: Object.entries(claudeDesktopFileParsed.data.mcpServers).map(([name, mcpJson]) => ({
        name,
        mcpJson,
      })),
    };
  }
  // Try parsing as single JSON file
  const singleConfigParsed = mcpServersJsonSchema.safeParse(json);
  if (singleConfigParsed.success) {
    return {
      entries: [
        { name: path.basename(filePath).replace(".json", ""), mcpJson: singleConfigParsed.data },
      ],
    };
  }
  return {
    entries: [],
    error: `MCP JSON file at ${filePath} doesn't match a supported MCP JSON configuration format`,
  };
}

const IGNORED_DIRS = new Set(["node_modules", ".git"]);

function listJsonFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of mcpWorkspaceFiles.readDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...listJsonFiles(full));
      }
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
  return files.toSorted();
}

/**
 * Loads MCP configs from JSON files in `<workspace>/.branch/mcpServers` and
 * `<state dir>/mcpServers`; the first definition of a server name wins.
 */
export function loadJsonMcpConfigs(params: {
  workspaceDir: string;
  includeGlobal: boolean;
  env?: NodeJS.ProcessEnv;
}): { mcpServers: Record<string, BundleMcpServerConfig>; diagnostics: BundleMcpDiagnostic[] } {
  const env = params.env ?? process.env;
  const diagnostics: BundleMcpDiagnostic[] = [];
  const report = (message: string) => diagnostics.push({ pluginId: "mcp-json", message });
  const mcpDirs = [path.join(params.workspaceDir, MCP_JSON_FOLDER)];
  if (params.includeGlobal) {
    mcpDirs.push(path.join(resolveStateDir(env), "mcpServers"));
  }
  const mcpServers: Record<string, BundleMcpServerConfig> = {};
  for (const dir of mcpDirs) {
    if (!mcpWorkspaceFiles.exists(dir)) {
      continue;
    }
    let files: string[];
    try {
      files = listJsonFiles(dir);
    } catch (e) {
      report(`Failed to check for MCP JSON files in ${dir}: ${formatErrorMessage(e)}`);
      continue;
    }
    for (const filePath of files) {
      let content: string;
      try {
        content = mcpWorkspaceFiles.readText(filePath);
      } catch (e) {
        report(`Failed to read MCP server JSON file at ${filePath}: ${formatErrorMessage(e)}`);
        continue;
      }
      const parsed = parseMcpJsonFile(filePath, content);
      if (parsed.error) {
        report(parsed.error);
      }
      for (const { name, mcpJson } of parsed.entries) {
        // De-duplicate: the first file to define a name keeps it.
        if (Object.hasOwn(mcpServers, name)) {
          continue;
        }
        const { server, warnings } = convertJsonMcpConfigToBranchServer(name, mcpJson, env);
        warnings.forEach((warning) => report(`${warning} (${filePath})`));
        mcpServers[name] = server;
      }
    }
  }
  return { mcpServers, diagnostics };
}
