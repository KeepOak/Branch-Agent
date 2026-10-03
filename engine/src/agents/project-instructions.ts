// Continue rule colocation and matching, adapted from continuedev/continue
// 5522c6f44ca0ac3528b37244818fbfa39b5af470: loadCodebaseRules.ts,
// getWorkspaceContinueRuleDotFiles.ts, and getSystemMessageWithRules.ts.
import { createHash } from "node:crypto";
import path from "node:path";
import { minimatch } from "minimatch";
import { root as fsRoot } from "../infra/fs-safe.js";
import { copyAgentToolMetadata } from "./agent-tool-metadata.js";
import { getToolParamsRecord, normalizeFileToolPathParam } from "./agent-tools.params.js";
import type { SkillInstructionDeliveryCache } from "./agent-tools.read.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { extractApplyPatchPaths } from "./apply-patch.js";
import { relativePathInsideSandboxRoot, resolvePathFromInput } from "./path-policy.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.types.js";
import { parsePromptFrontmatter } from "./utils/frontmatter.js";

type Patterns = string | string[];
export type ProjectRule = {
  sourceFile: string;
  rule: string;
  alwaysApply?: boolean;
  globs?: Patterns;
  regex?: Patterns;
};

type RuleFiles = {
  read(filePath: string, signal?: AbortSignal): Promise<string | undefined>;
  list(directory: string, signal?: AbortSignal): Promise<string[]>;
};
type ToolResult = Awaited<ReturnType<AnyAgentTool["execute"]>>;
type ProjectInstructionOptions = {
  root: string;
  cwd: string;
  normalizationCwd?: string;
  bridge?: SandboxFsBridge;
  deliveryCache?: SkillInstructionDeliveryCache;
};

function patterns(value: unknown): Patterns | undefined {
  return typeof value === "string" ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
    ? value
    : undefined;
}

export function parseProjectRule(sourceFile: string, content: string): ProjectRule | undefined {
  const { frontmatter, body } = parsePromptFrontmatter(content);
  if (!body.trim() || frontmatter.invokable === true) {
    return undefined;
  }
  return {
    sourceFile,
    rule: body,
    alwaysApply: typeof frontmatter.alwaysApply === "boolean" ? frontmatter.alwaysApply : undefined,
    globs: patterns(frontmatter.globs),
    regex: patterns(frontmatter.regex),
  };
}

function matchesGlobs(filePath: string, globs: Patterns): boolean {
  const all = typeof globs === "string" ? [globs] : globs;
  const positive = all.filter((glob) => !glob.startsWith("!"));
  const negative = all.filter((glob) => glob.startsWith("!"));
  return (
    (positive.length === 0 || positive.some((glob) => minimatch(filePath, glob))) &&
    !negative.some((glob) => minimatch(filePath, glob.slice(1)))
  );
}

function matchesRegex(content: string | undefined, regex: Patterns): boolean {
  if (content === undefined) {
    return false;
  }
  const all = typeof regex === "string" ? [regex] : regex;
  return (
    all.length === 0 ||
    all.some((pattern) => {
      try {
        return new RegExp(pattern).test(content);
      } catch {
        return false;
      }
    })
  );
}

/** Match against workspace paths, preserving Continue's implicit global rules. */
export function projectRuleApplies(
  rule: ProjectRule,
  filePath: string,
  content?: string,
  directoryTarget = false,
): boolean {
  if (rule.alwaysApply === true) {
    return true;
  }
  const global = rule.sourceFile.startsWith(".continue/") || rule.sourceFile === ".continuerules";
  if (!global) {
    const directory = path.posix.dirname(rule.sourceFile);
    if (
      directory !== "." &&
      !filePath.startsWith(`${directory}/`) &&
      !(directoryTarget && filePath === directory)
    ) {
      return false;
    }
  }
  if (global && rule.alwaysApply === false && !rule.globs && !rule.regex) {
    return false;
  }
  return (
    (!rule.globs || matchesGlobs(filePath, rule.globs)) &&
    (!rule.regex || matchesRegex(content, rule.regex))
  );
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "not-found";
}

type RuleFileAccess = {
  root: string;
  host: () => ReturnType<typeof fsRoot>;
  bridge?: SandboxFsBridge;
};

function runtimeRulePath(root: string, filePath: string): string {
  if (!filePath.startsWith("/") && path.win32.isAbsolute(filePath)) {
    return path.win32.normalize(filePath);
  }
  return (root.startsWith("/") ? path.posix : path.win32).resolve(root, filePath);
}

async function readRuleFile(
  access: RuleFileAccess,
  filePath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  try {
    if (access.bridge) {
      const runtimePath = runtimeRulePath(access.root, filePath);
      const stat = await access.bridge.stat({ filePath: runtimePath, cwd: access.root, signal });
      return stat?.type === "file"
        ? (
            await access.bridge.readFile({ filePath: runtimePath, cwd: access.root, signal })
          ).toString("utf8")
        : undefined;
    }
    return (
      await (
        await access.host()
      ).read(`./${filePath}`, {
        symlinks: "follow-within-root",
        nonBlockingRead: true,
      })
    ).buffer.toString("utf8");
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

async function listRuleFiles(
  access: RuleFileAccess,
  directory: string,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  const { bridge, root } = access;
  const runtimePath = runtimeRulePath(root, directory);
  try {
    if (
      bridge &&
      (await bridge.stat({ filePath: runtimePath, cwd: root, signal }))?.type !== "directory"
    ) {
      return [];
    }
    const entries = bridge?.readDirectory
      ? await bridge.readDirectory({ filePath: runtimePath, cwd: root, signal })
      : bridge
        ? []
        : await (await access.host()).list(`./${directory}`, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.isDirectory && entry.name.endsWith(".md"))
      .map((entry) => `${directory}/${entry.name}`)
      .sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
}

function createRuleFiles(root: string, bridge?: SandboxFsBridge): RuleFiles {
  let rootHandle: ReturnType<typeof fsRoot> | undefined;
  const access = { root, bridge, host: () => (rootHandle ??= fsRoot(root)) };
  return {
    read: (filePath, signal) => readRuleFile(access, filePath, signal),
    list: (directory, signal) => listRuleFiles(access, directory, signal),
  };
}

function rulePaths(filePath: string, directory: boolean): string[] {
  const folders = (directory ? filePath : path.posix.dirname(filePath))
    .split("/")
    .filter((folder) => folder && folder !== ".");
  const paths = ["rules.md"];
  for (let index = 1; index <= folders.length; index++) {
    paths.push(`${folders.slice(0, index).join("/")}/rules.md`);
  }
  return paths;
}

/** Loads only ancestors of the touched file; sibling instructions stay out. */
export async function loadTouchedProjectRules(params: {
  filePath: string;
  directory?: boolean;
  files: RuleFiles;
  signal?: AbortSignal;
  warn?: (message: string) => void;
}): Promise<ProjectRule[]> {
  let globalPaths: string[] = [];
  try {
    globalPaths = await params.files.list(".continue/rules", params.signal);
  } catch (error) {
    params.signal?.throwIfAborted();
    params.warn?.(`Could not load project instructions .continue/rules: ${String(error)}`);
  }
  const paths = [
    ".continuerules",
    ...globalPaths,
    ...rulePaths(params.filePath, params.directory ?? false),
  ];
  const rules: ProjectRule[] = [];
  for (const sourceFile of paths) {
    try {
      const content = await params.files.read(sourceFile, params.signal);
      if (content !== undefined) {
        const rule =
          sourceFile === ".continuerules"
            ? { sourceFile, rule: content }
            : parseProjectRule(sourceFile, content);
        if (rule?.rule.trim()) {
          rules.push(rule);
        }
      }
    } catch (error) {
      params.signal?.throwIfAborted();
      params.warn?.(`Could not load project instructions ${sourceFile}: ${String(error)}`);
    }
  }
  return rules;
}

function resultFileContent(result: ToolResult): string | undefined {
  const details = result.details;
  return details &&
    typeof details === "object" &&
    "content" in details &&
    typeof details.content === "string"
    ? details.content
    : undefined;
}

function touchedPaths(name: string, params: unknown): string[] {
  const record = getToolParamsRecord(params);
  if (name === "apply_patch") {
    return typeof record?.input === "string"
      ? extractApplyPatchPaths(
          record.input,
          typeof record.path === "string" ? record.path : undefined,
        )
      : [];
  }
  if (!["read", "write", "edit", "ls"].includes(name)) {
    return [];
  }
  const input = record?.path ?? record?.file_path ?? (name === "ls" ? "." : undefined);
  return typeof input === "string" ? [input] : [];
}

async function relativeTouchedPath(
  input: string,
  options: ProjectInstructionOptions,
): Promise<string | null> {
  const normalized = await normalizeFileToolPathParam(
    input,
    options.normalizationCwd ?? options.cwd,
    options.bridge,
  );
  const absolute = options.bridge
    ? options.bridge.resolvePath({
        filePath: runtimeRulePath(options.cwd, normalized),
        cwd: options.cwd,
      }).containerPath
    : resolvePathFromInput(normalized, options.cwd);
  const relative = relativePathInsideSandboxRoot(options.root, absolute);
  return relative === null
    ? null
    : options.root.startsWith("/")
      ? relative
      : relative.replaceAll("\\", "/");
}

async function appendTouchedInstructions(
  result: ToolResult,
  params: {
    filePath: string;
    directory: boolean;
    content?: string;
    files: RuleFiles;
    delivered: SkillInstructionDeliveryCache;
    deliveryPrefix: string;
    signal?: AbortSignal;
  },
): Promise<ToolResult> {
  const warnings: string[] = [];
  const rules = await loadTouchedProjectRules({
    ...params,
    warn: (message) => warnings.push(message),
  });
  const key = (rule: ProjectRule) =>
    `${params.deliveryPrefix}\0${rule.sourceFile}\0${createHash("sha256").update(rule.rule).digest("hex")}`;
  const additions = rules.filter(
    (rule) =>
      projectRuleApplies(rule, params.filePath, params.content, params.directory) &&
      rule.sourceFile !== params.filePath &&
      !params.delivered.has(key(rule)),
  );
  if (additions.length === 0 && warnings.length === 0) {
    return result;
  }
  additions.forEach((rule) => params.delivered.set(key(rule), Promise.resolve(true)));
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: "text" as const,
        text: [
          ...additions.map((rule) => `Project instructions (${rule.sourceFile}):\n${rule.rule}`),
          ...warnings,
        ].join("\n\n"),
      },
    ],
  };
}

/** Tool-local delivery keeps cached startup system instructions unchanged. */
export function wrapToolsWithProjectInstructions(
  tools: AnyAgentTool[],
  options: ProjectInstructionOptions,
): AnyAgentTool[] {
  const files = createRuleFiles(options.root, options.bridge);
  // The runner clears this shared delivery cache whenever context is replaced.
  const delivered = options.deliveryCache ?? new Map<string, Promise<boolean>>();
  return tools.map((tool) =>
    copyAgentToolMetadata(tool, {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const inputs = touchedPaths(tool.name, params);
        let result = await tool.execute(toolCallId, params, signal, onUpdate);
        const record = getToolParamsRecord(params);
        const content =
          resultFileContent(result) ??
          (typeof record?.content === "string" ? record.content : undefined);
        for (const input of inputs) {
          const filePath = await relativeTouchedPath(input, options);
          if (filePath !== null) {
            result = await appendTouchedInstructions(result, {
              filePath,
              directory: tool.name === "ls",
              content,
              files,
              delivered,
              signal,
              deliveryPrefix: `project-instructions:${options.root}`,
            });
          }
        }
        return result;
      },
    }),
  );
}
