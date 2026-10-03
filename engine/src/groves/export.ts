import { createHash } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import { stringify as stringifyYaml } from "yaml";
import { listAgentEntries, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { prepareLocalAgentAvatarFile } from "../agents/identity-avatar-file.js";
import { MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES } from "../agents/workspace-bootstrap-read.js";
import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import type { AgentConfig } from "../config/types.agents.js";
import type { BranchConfig } from "../config/types.branch.js";
import { FsSafeError, root as fsSafeRoot } from "../infra/fs-safe.js";
import { isAvatarDataUrl, isAvatarHttpUrl } from "../shared/avatar-policy.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { resolveUserPath } from "../utils.js";
import { readGroveStatus } from "./lifecycle-state.js";
import type { PackageRemovalDeps } from "./package-remove.js";
import { readGroveManifestFile } from "./reader.js";
import { isPortableGroveAvatar } from "./schema-portability.js";
import { parseGroveManifest, parseGroveBranchProfile } from "./schema.js";
import { MAX_GROVE_MANIFEST_BYTES, MAX_MANAGED_WORKSPACE_BYTES } from "./source-limits.js";
import { materializeGroveToolProfile } from "./tool-profile-consent.js";
import {
  GROVE_BOOTSTRAP_FILE_NAMES,
  GROVE_OUTPUT_STABILITY,
  GROVE_SCHEMA_VERSION,
  type GroveManifest,
  type GroveMcpServer,
  type GroveBranchExtension,
  type GroveBranchProfile,
  type ClawPackagePreflight,
} from "./types.js";

export const GROVE_EXPORT_RESULT_SCHEMA_VERSION = "branch.groveExportResult.v1" as const;
const MAX_EXPORT_FILE_BYTES = 1024 * 1024;

type GroveBootstrapFileName = (typeof GROVE_BOOTSTRAP_FILE_NAMES)[number];

function decodeUtf8(content: Buffer): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

type GroveExportResult = {
  schemaVersion: typeof GROVE_EXPORT_RESULT_SCHEMA_VERSION;
  stability: typeof GROVE_OUTPUT_STABILITY;
  agentId: string;
  outputDirectory: string;
  manifest: GroveManifest;
  branchProfile?: GroveBranchProfile;
  filesWritten: string[];
};

const DRIFTED_BOOTSTRAP_STATES = new Set<string>(["modified", "unsafe", "unknown"]);

export class GroveExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GroveExportError";
  }
}

export function portableAgent(
  agent: AgentConfig,
  avatar: string | undefined,
): GroveManifest["agent"] {
  const identity = {
    ...(agent.identity?.name ? { name: agent.identity.name } : {}),
    ...(agent.identity?.theme ? { theme: agent.identity.theme } : {}),
    ...(agent.identity?.emoji ? { emoji: agent.identity.emoji } : {}),
    ...(avatar ? { avatar } : {}),
  };
  return {
    id: agent.id,
    ...(agent.name ? { name: agent.name } : {}),
    ...(agent.description ? { description: agent.description } : {}),
    ...(Object.keys(identity).length > 0 ? { identity } : {}),
  };
}

export function portableBranchProfile(
  agent: AgentConfig,
  extensions: GroveBranchExtension[],
): GroveBranchProfile | undefined {
  const configuredTools = {
    ...(agent.tools?.profile ? { profile: agent.tools.profile } : {}),
    ...(agent.tools?.allow?.length ? { allow: agent.tools.allow } : {}),
    ...(agent.tools?.alsoAllow?.length ? { alsoAllow: agent.tools.alsoAllow } : {}),
    ...(agent.tools?.deny?.length ? { deny: agent.tools.deny } : {}),
    ...(agent.tools?.fs?.workspaceOnly === true ? { fs: { workspaceOnly: true as const } } : {}),
  };
  let tools: NonNullable<GroveBranchProfile["agent"]["tools"]> = configuredTools;
  if (configuredTools.profile || configuredTools.allow?.length) {
    try {
      tools = materializeGroveToolProfile({ tools: configuredTools }).tools ?? {};
    } catch (error) {
      throw new GroveExportError(
        "tool_profile_consent_required",
        `Could not freeze the exported tool profile: ${(error as Error).message}`,
      );
    }
  }
  const settings = {
    ...(agent.model !== undefined
      ? { model: typeof agent.model === "string" ? { primary: agent.model } : agent.model }
      : {}),
    ...(agent.subagents
      ? {
          subagents: {
            ...(agent.subagents.allowAgents !== undefined
              ? { allowAgents: agent.subagents.allowAgents }
              : {}),
            ...(agent.subagents.delegationMode !== undefined
              ? { delegationMode: agent.subagents.delegationMode }
              : {}),
          },
        }
      : {}),
    ...(agent.groupChat?.mentionPatterns?.length
      ? { groupChat: { mentionPatterns: agent.groupChat.mentionPatterns } }
      : {}),
    ...(agent.sandbox
      ? {
          sandbox: {
            ...(agent.sandbox.mode ? { mode: agent.sandbox.mode } : {}),
            ...(agent.sandbox.scope ? { scope: agent.sandbox.scope } : {}),
            ...(agent.sandbox.workspaceAccess
              ? { workspaceAccess: agent.sandbox.workspaceAccess }
              : {}),
          },
        }
      : {}),
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
    ...(agent.memory?.search
      ? {
          memory: {
            search: {
              ...(agent.memory.search.enabled !== undefined
                ? { enabled: agent.memory.search.enabled }
                : {}),
              ...(agent.memory.search.rememberAcrossConversations !== undefined
                ? {
                    rememberAcrossConversations: agent.memory.search.rememberAcrossConversations,
                  }
                : {}),
              ...(agent.memory.search.sources?.length
                ? { sources: agent.memory.search.sources }
                : {}),
            },
          },
        }
      : {}),
    ...(agent.heartbeat
      ? {
          heartbeat: {
            ...(agent.heartbeat.every ? { every: agent.heartbeat.every } : {}),
            ...(agent.heartbeat.activeHours
              ? {
                  activeHours: {
                    ...(agent.heartbeat.activeHours.start
                      ? { start: agent.heartbeat.activeHours.start }
                      : {}),
                    ...(agent.heartbeat.activeHours.end
                      ? { end: agent.heartbeat.activeHours.end }
                      : {}),
                    ...(agent.heartbeat.activeHours.timezone
                      ? { timezone: agent.heartbeat.activeHours.timezone }
                      : {}),
                  },
                }
              : {}),
            ...(agent.heartbeat.lightContext !== undefined
              ? { lightContext: agent.heartbeat.lightContext }
              : {}),
            ...(agent.heartbeat.isolatedSession !== undefined
              ? { isolatedSession: agent.heartbeat.isolatedSession }
              : {}),
            ...(agent.heartbeat.timeoutSeconds !== undefined
              ? { timeoutSeconds: agent.heartbeat.timeoutSeconds }
              : {}),
          },
        }
      : {}),
    ...(agent.humanDelay
      ? {
          humanDelay: {
            ...(agent.humanDelay.mode ? { mode: agent.humanDelay.mode } : {}),
            ...(agent.humanDelay.minMs !== undefined ? { minMs: agent.humanDelay.minMs } : {}),
            ...(agent.humanDelay.maxMs !== undefined ? { maxMs: agent.humanDelay.maxMs } : {}),
          },
        }
      : {}),
  };
  if (extensions.length === 0 && Object.keys(settings).length === 0) {
    return undefined;
  }
  const parsed = parseGroveBranchProfile({ schemaVersion: 1, agent: settings, extensions });
  if (!parsed.ok) {
    throw new GroveExportError(
      "export_branch_profile_invalid",
      parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
    );
  }
  return parsed.profile;
}

function normalizedRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function comparePortableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isGroveBootstrapFileName(value: string): value is GroveBootstrapFileName {
  return (GROVE_BOOTSTRAP_FILE_NAMES as readonly string[]).includes(value);
}
async function readPortableAvatar(params: {
  config: BranchConfig;
  agent: AgentConfig;
  workspace: string;
}): Promise<{ source?: string; sidecar?: { path: string; content: Buffer } }> {
  const source = params.agent.identity?.avatar?.trim();
  if (!source) {
    return {};
  }
  if (isAvatarHttpUrl(source)) {
    return {};
  }
  if (isAvatarDataUrl(source)) {
    return isPortableGroveAvatar(source) ? { source } : {};
  }
  const prepared = await prepareLocalAgentAvatarFile({
    cfg: params.config,
    agentId: params.agent.id,
    source,
    readBody: true,
  });
  if (!prepared.ok || !prepared.file.body) {
    return {};
  }
  const path = normalizedRelativePath(relative(params.workspace, prepared.file.path));
  return { source: path, sidecar: { path, content: prepared.file.body } };
}

function derivativePackageVersion(manifest: GroveManifest, contents: ExportContent[]): string {
  const hash = createHash("sha256").update(JSON.stringify(manifest));
  for (const file of contents.toSorted((left, right) =>
    comparePortableText(left.path, right.path),
  )) {
    hash.update(file.path).update("\0").update(file.content).update("\0");
  }
  return `0.0.0-export.${hash.digest("hex")}`;
}

type ExportContent = { path: string; content: Buffer };

async function readAuthorBootstrap(path: string): Promise<Buffer> {
  const resolvedPath = resolve(resolveUserPath(path));
  try {
    const sourceRoot = await fsSafeRoot(dirname(resolvedPath));
    const read = await sourceRoot.read(basename(resolvedPath), {
      hardlinks: "reject",
      maxBytes: MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES,
      nonBlockingRead: true,
      symlinks: "reject",
    });
    const text = new TextDecoder("utf-8", { fatal: true }).decode(read.buffer);
    if (text.trim().length === 0) {
      throw new GroveExportError(
        "bootstrap_empty",
        "Export BOOTSTRAP.md must contain reviewed first-run instructions.",
      );
    }
    return read.buffer;
  } catch (error) {
    if (error instanceof GroveExportError) {
      throw error;
    }
    const tooLarge = error instanceof FsSafeError && error.code === "too-large";
    throw new GroveExportError(
      tooLarge ? "bootstrap_oversized" : "bootstrap_invalid",
      tooLarge
        ? `Export BOOTSTRAP.md exceeds ${MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES} bytes.`
        : `Could not read a safe UTF-8 BOOTSTRAP.md from ${JSON.stringify(resolvedPath)}: ${(error as Error).message}`,
    );
  }
}

function portableMcpServer(server: Record<string, unknown>): GroveMcpServer {
  const common = {
    ...(server.toolFilter && typeof server.toolFilter === "object"
      ? { toolFilter: server.toolFilter as GroveMcpServer["toolFilter"] }
      : {}),
    ...(typeof server.timeout === "number" ? { timeout: server.timeout } : {}),
    ...(typeof server.connectTimeout === "number" ? { connectTimeout: server.connectTimeout } : {}),
  };
  if (typeof server.url === "string") {
    if (server.transport !== "sse" && server.transport !== "streamable-http") {
      throw new Error("Managed remote MCP server has an unsupported transport.");
    }
    return {
      url: server.url,
      transport: server.transport,
      ...(server.auth === "oauth" ? { auth: "oauth" as const } : {}),
      ...common,
    };
  }
  if (typeof server.command !== "string") {
    throw new Error("Managed MCP server has neither a command nor a remote URL.");
  }
  return {
    command: server.command,
    ...(server.transport === "stdio" ? { transport: server.transport } : {}),
    ...(Array.isArray(server.args) ? { args: server.args as string[] } : {}),
    ...(server.env && typeof server.env === "object"
      ? { env: server.env as Record<string, string> }
      : {}),
    ...common,
  };
}

export async function exportGroveAgent(
  agentId: string,
  outputDirectory: string,
  options: BranchStateDatabaseOptions & {
    config: BranchConfig;
    packageDeps?: PackageRemovalDeps;
    packagePreflight?: ClawPackagePreflight;
    sourceMcpServers?: Record<string, Record<string, unknown>>;
    bootstrapPath?: string;
  },
): Promise<GroveExportResult> {
  const status = await readGroveStatus(agentId, options);
  const record = status.records.find((candidate) => candidate.install.agentId === agentId);
  if (!record) {
    throw new GroveExportError(
      "grove_not_found",
      `No installed Grove agent matches ${JSON.stringify(agentId)}.`,
    );
  }
  if (record.install.status !== "complete") {
    throw new GroveExportError(
      "install_incomplete",
      `Installed Grove agent ${JSON.stringify(agentId)} is in ${JSON.stringify(record.install.status)} state; finish or repair it before export.`,
    );
  }
  const agent = listAgentEntries(options.config).find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new GroveExportError(
      "agent_missing",
      `Installed Grove agent ${JSON.stringify(agentId)} is missing from config.`,
    );
  }
  const currentWorkspace = await realpath(
    resolve(resolveAgentWorkspaceDir(options.config, agentId)),
  ).catch(() => resolve(resolveAgentWorkspaceDir(options.config, agentId)));
  if (currentWorkspace !== record.install.workspace) {
    throw new GroveExportError(
      "workspace_changed",
      `Agent ${JSON.stringify(agentId)} now resolves to workspace ${JSON.stringify(currentWorkspace)} instead of its recorded Grove workspace ${JSON.stringify(record.install.workspace)}.`,
    );
  }
  if (record.agentState !== "present") {
    throw new GroveExportError(
      "agent_drifted",
      `Agent ${JSON.stringify(agentId)} no longer matches its recorded Grove configuration.`,
    );
  }
  const driftedFiles = record.workspaceFiles.filter((file) => file.state !== "unchanged");
  if (driftedFiles.length > 0) {
    throw new GroveExportError(
      "workspace_files_drifted",
      `Cannot export drifted managed files: ${driftedFiles.map((file) => `${file.path} (${file.state})`).join(", ")}.`,
    );
  }
  const driftedPackages = record.packages.filter(
    (pkg) =>
      pkg.state !== "present" ||
      (pkg.extensionCompatibility !== undefined &&
        pkg.extensionCompatibility.state !== "compatible"),
  );
  if (driftedPackages.length > 0) {
    throw new GroveExportError(
      "packages_drifted",
      `Cannot export drifted packages: ${driftedPackages.map((pkg) => `${pkg.kind}:${pkg.ref}@${pkg.version} (${pkg.extensionCompatibility?.state ?? pkg.state})`).join(", ")}.`,
    );
  }
  // A drifted package bootstrap is managed state like any other: exporting it
  // silently would publish a package with no BOOTSTRAP.md at all. An explicitly
  // reviewed --bootstrap replacement is the supported way through.
  if (
    record.install.bootstrap &&
    !options.bootstrapPath &&
    DRIFTED_BOOTSTRAP_STATES.has(record.bootstrapState)
  ) {
    throw new GroveExportError(
      "bootstrap_drifted",
      `Cannot export the package bootstrap ${JSON.stringify(record.bootstrap.path)} in ${JSON.stringify(record.bootstrapState)} state; restore the seeded file or pass a reviewed --bootstrap replacement.`,
    );
  }
  const unresolvedCronJobs = record.cronJobs.filter(
    (cron) => cron.status !== "complete" || !cron.schedulerJobId,
  );
  const unavailableMcpServers = record.mcpServers.filter((server) => server.state !== "present");
  if (unavailableMcpServers.length > 0) {
    throw new GroveExportError(
      "mcp_servers_unavailable",
      `Cannot export MCP servers with unresolved ownership or drift: ${unavailableMcpServers
        .map((server) => server.name)
        .join(", ")}.`,
    );
  }
  if (unresolvedCronJobs.length > 0) {
    throw new GroveExportError(
      "cron_jobs_unavailable",
      `Cannot export cron declarations with unresolved ownership: ${unresolvedCronJobs
        .map((cron) => cron.manifestId)
        .join(", ")}.`,
    );
  }

  const authorBootstrap = options.bootstrapPath
    ? await readAuthorBootstrap(options.bootstrapPath)
    : undefined;

  const workspace = await fsSafeRoot(record.install.workspace, {
    hardlinks: "reject",
    maxBytes: MAX_EXPORT_FILE_BYTES,
    symlinks: "reject",
  });
  const allContents: ExportContent[] = await Promise.all(
    record.workspaceFiles.map(async (file) => ({
      path: normalizedRelativePath(file.path),
      content: await workspace.readBytes(file.path, { maxBytes: MAX_EXPORT_FILE_BYTES }),
    })),
  );
  const soul = allContents.find((file) => file.path === "SOUL.md");
  const decodedSoul = soul ? decodeUtf8(soul.content) : undefined;
  let groveMarkdownBody =
    soul && decodedSoul !== undefined && decodedSoul.trim().length > 0 ? soul.content : undefined;
  const contents = allContents.filter((file) => file !== soul || !groveMarkdownBody);
  const avatar = await readPortableAvatar({
    config: options.config,
    agent,
    workspace: record.install.workspace,
  });
  const managedPaths = new Set(contents.map((file) => file.path));
  if (avatar.sidecar && !managedPaths.has(avatar.sidecar.path)) {
    contents.push(avatar.sidecar);
  }
  let pendingPackageBootstrap: Buffer | undefined;
  if (!authorBootstrap && record.install.bootstrap && record.bootstrapState === "pending") {
    try {
      pendingPackageBootstrap = await workspace.readBytes("BOOTSTRAP.md", {
        maxBytes: MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES,
      });
    } catch (error) {
      throw new GroveExportError(
        "bootstrap_drifted",
        `Cannot export the package bootstrap because BOOTSTRAP.md changed after inspection: ${(error as Error).message}`,
      );
    }
    const contentDigest = `sha256:${createHash("sha256")
      .update(pendingPackageBootstrap)
      .digest("hex")}`;
    if (contentDigest !== record.install.bootstrap.contentDigest) {
      throw new GroveExportError(
        "bootstrap_drifted",
        "Cannot export the package bootstrap because BOOTSTRAP.md changed after inspection.",
      );
    }
  }
  const exportedBootstrap = authorBootstrap ?? pendingPackageBootstrap;
  const bootstrapFiles: GroveManifest["workspace"]["bootstrapFiles"] = {};
  const files: GroveManifest["workspace"]["files"] = [];
  for (const file of contents) {
    const source = `workspace/${file.path}`;
    if (isGroveBootstrapFileName(file.path)) {
      bootstrapFiles[file.path] = { source };
    } else {
      files.push({ source, path: file.path });
    }
  }
  const configuredMcpServers = normalizeConfiguredMcpServers(
    options.sourceMcpServers ?? options.config.mcp?.servers,
  );
  const extensions = record.packages
    .filter((pkg) => pkg.extension)
    .map((pkg) => ({
      id: pkg.extension!.id,
      kind: "plugin" as const,
      format: pkg.extension!.format,
      source: pkg.source,
      ref: pkg.ref,
      version: pkg.version,
    }))
    .toSorted((left, right) => comparePortableText(left.id, right.id));
  const branchProfile = portableBranchProfile(agent, extensions);
  const branchProfilePath = "profiles/branch.yml";
  const branchProfileRaw = branchProfile
    ? Buffer.from(stringifyYaml(branchProfile))
    : undefined;
  const portablePackages = record.packages
    .filter((pkg) => !pkg.extension)
    .map((pkg) => ({
      kind: pkg.kind,
      source: pkg.source,
      ref: pkg.ref,
      version: pkg.version,
    }))
    .toSorted((left, right) => {
      const leftIdentity = `${left.kind}:${left.ref}:${left.version}`;
      const rightIdentity = `${right.kind}:${right.ref}:${right.version}`;
      return comparePortableText(leftIdentity, rightIdentity);
    });
  const manifest: GroveManifest = {
    schemaVersion: GROVE_SCHEMA_VERSION,
    agent: portableAgent(agent, avatar.source),
    workspace: { bootstrapFiles, files },
    packages: portablePackages,
    mcpServers: Object.fromEntries(
      record.mcpServers.map((ref) => [
        ref.name,
        portableMcpServer(configuredMcpServers[ref.name]!),
      ]),
    ),
    cronJobs: record.cronJobs
      .map((cron) => cron.job)
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  };
  const serializeGroveMarkdown = (body: Buffer | undefined) =>
    Buffer.concat([Buffer.from(`---\n${stringifyYaml(manifest)}---\n`), ...(body ? [body] : [])]);
  let groveMarkdownRaw = serializeGroveMarkdown(groveMarkdownBody);
  if (groveMarkdownBody && groveMarkdownRaw.byteLength > MAX_GROVE_MANIFEST_BYTES) {
    groveMarkdownBody = undefined;
    contents.push(soul!);
    bootstrapFiles["SOUL.md"] = { source: "workspace/SOUL.md" };
    groveMarkdownRaw = serializeGroveMarkdown(undefined);
  }
  if (groveMarkdownRaw.byteLength > MAX_GROVE_MANIFEST_BYTES) {
    throw new GroveExportError(
      "grove_manifest_oversized",
      `Exported GROVE.md exceeds ${MAX_GROVE_MANIFEST_BYTES} bytes.`,
    );
  }
  const aggregateBytes =
    contents.reduce((total, file) => total + file.content.byteLength, 0) +
    (groveMarkdownBody?.byteLength ?? 0);
  if (aggregateBytes > MAX_MANAGED_WORKSPACE_BYTES) {
    throw new GroveExportError(
      "workspace_files_oversized",
      `Exported workspace content exceeds ${MAX_MANAGED_WORKSPACE_BYTES} aggregate bytes.`,
    );
  }
  const parsed = parseGroveManifest(manifest);
  if (!parsed.ok) {
    throw new GroveExportError(
      "export_manifest_invalid",
      parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
    );
  }
  const target = resolve(resolveUserPath(outputDirectory));
  await mkdir(dirname(target), { recursive: true });
  try {
    await mkdir(target);
  } catch (error) {
    throw new GroveExportError(
      "output_collision",
      `Export directory ${JSON.stringify(target)} must not already exist: ${(error as Error).message}`,
    );
  }
  const filesWritten: string[] = [];
  try {
    const output = await fsSafeRoot(target, {
      hardlinks: "reject",
      maxBytes: MAX_EXPORT_FILE_BYTES,
      symlinks: "reject",
    });
    for (const file of contents) {
      const path = `workspace/${file.path}`;
      await output.write(path, file.content, { mkdir: true, overwrite: false });
      filesWritten.push(path);
    }
    if (branchProfileRaw) {
      await output.write(branchProfilePath, branchProfileRaw, {
        mkdir: true,
        overwrite: false,
      });
      filesWritten.push(branchProfilePath);
    }
    const packageJson = {
      name: `branch-grove-${record.install.agentId}`,
      version: derivativePackageVersion(manifest, [
        ...contents,
        ...(groveMarkdownBody ? [{ path: "GROVE.md#body", content: groveMarkdownBody }] : []),
        ...(branchProfileRaw ? [{ path: branchProfilePath, content: branchProfileRaw }] : []),
        ...(exportedBootstrap ? [{ path: "BOOTSTRAP.md", content: exportedBootstrap }] : []),
      ]),
      type: "module",
      branch: { grove: "GROVE.md" },
    };
    await output.write("package.json", Buffer.from(`${JSON.stringify(packageJson, null, 2)}\n`), {
      overwrite: false,
    });
    filesWritten.push("package.json");
    await output.write("GROVE.md", groveMarkdownRaw, { overwrite: false });
    filesWritten.push("GROVE.md");
    if (exportedBootstrap) {
      await output.write("BOOTSTRAP.md", exportedBootstrap, { overwrite: false });
      filesWritten.push("BOOTSTRAP.md");
    }
    const reread = await readGroveManifestFile(target);
    if (!reread.ok) {
      throw new GroveExportError(
        "export_package_invalid",
        reread.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      );
    }
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof GroveExportError) {
      throw error;
    }
    throw new GroveExportError("export_write_failed", coerceErrorMessage(error));
  }
  return {
    schemaVersion: GROVE_EXPORT_RESULT_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    agentId,
    outputDirectory: target,
    manifest,
    ...(branchProfile ? { branchProfile } : {}),
    filesWritten,
  };
}
