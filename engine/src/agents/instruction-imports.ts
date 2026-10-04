// Ported from google-gemini/gemini-cli c6bccb7ecbf6d8368d995455dd725ed34466faad,
// packages/core/src/utils/memoryImportProcessor.ts.
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  findInstructionProjectRoot,
  scanInstructionImports,
  validateImportPath,
  type InstructionImport,
  type ImportPathSyntax,
} from "./instruction-imports.scan.js";

export { validateImportPath } from "./instruction-imports.scan.js";
export const instructionImportLogger = createSubsystemLogger("agents/instruction-imports");
export type InstructionImportFormat = "flat" | "tree";
export type InstructionImportState = {
  processedFiles: Set<string>;
  maxDepth: number;
  currentDepth: number;
  currentFile?: string;
};
export type MemoryFile = { path: string; imports?: MemoryFile[] };
export type ProcessImportsResult = { content: string; importTree: MemoryFile };
export type InstructionImportFileSystem = {
  syntax?: ImportPathSyntax;
  signal?: AbortSignal;
  readFile(filePath: string): Promise<string>;
  validatePath(importPath: string, basePath: string, allowedDirectories: string[]): boolean;
};
type ImportContext = {
  debugMode: boolean;
  state: InstructionImportState;
  projectRoot: string;
  boundaryMarkers: readonly string[];
  filesystem: InstructionImportFileSystem;
};

const hostFileSystem: InstructionImportFileSystem = {
  readFile: async (filePath) => {
    await access(filePath);
    return readFile(filePath, "utf-8");
  },
  validatePath: validateImportPath,
};

function errorMessage(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : typeof error === "string"
      ? error
      : "Unknown error";
}

async function processTreeImport(
  token: InstructionImport,
  basePath: string,
  context: ImportContext,
): Promise<ProcessImportsResult> {
  const syntax = context.filesystem.syntax ?? path;
  const fullPath = syntax.resolve(basePath, token.path);
  const fileContent = await context.filesystem.readFile(fullPath);
  const state = {
    ...context.state,
    processedFiles: new Set(context.state.processedFiles),
    currentDepth: context.state.currentDepth + 1,
    currentFile: fullPath,
  };
  state.processedFiles.add(fullPath);
  return processImports(
    fileContent,
    syntax.dirname(fullPath),
    context.debugMode,
    state,
    context.projectRoot,
    "tree",
    context.boundaryMarkers,
    context.filesystem,
  );
}

async function expandTreeToken(
  token: InstructionImport,
  basePath: string,
  context: ImportContext,
): Promise<{ content: string; tree?: MemoryFile }> {
  if (token.inCode) {
    return { content: `@${token.path}` };
  }
  if (!context.filesystem.validatePath(token.path, basePath, [context.projectRoot])) {
    return { content: `<!-- Import failed: ${token.path} - Path traversal attempt -->` };
  }
  try {
    const fullPath = (context.filesystem.syntax ?? path).resolve(basePath, token.path);
    if (context.state.processedFiles.has(fullPath)) {
      return { content: `<!-- File already processed: ${token.path} -->` };
    }
    const imported = await processTreeImport(token, basePath, context);
    return {
      content: `<!-- Imported from: ${token.path} -->\n${imported.content}\n<!-- End of import from: ${token.path} -->`,
      tree: imported.importTree,
    };
  } catch (error) {
    context.filesystem.signal?.throwIfAborted();
    const message = errorMessage(error);
    instructionImportLogger.error(`Failed to import ${token.path}: ${message}`);
    return { content: `<!-- Import failed: ${token.path} - ${message} -->` };
  }
}

async function processTree(
  content: string,
  basePath: string,
  context: ImportContext,
): Promise<ProcessImportsResult> {
  let result = "";
  let lastIndex = 0;
  const imports: MemoryFile[] = [];
  for (const token of scanInstructionImports(content)) {
    context.filesystem.signal?.throwIfAborted();
    result += content.substring(lastIndex, token.start);
    lastIndex = token.end;
    const expanded = await expandTreeToken(token, basePath, context);
    result += expanded.content;
    if (expanded.tree) {
      imports.push(expanded.tree);
    }
  }
  return {
    content: result + content.substring(lastIndex),
    importTree: {
      path: context.state.currentFile ?? "unknown",
      imports: imports.length > 0 ? imports : undefined,
    },
  };
}

type FlatFile = { path: string; content: string };
async function visitFlat(
  content: string,
  basePath: string,
  filePath: string,
  context: ImportContext,
  files: FlatFile[],
  processed: Set<string>,
): Promise<void> {
  const syntax = context.filesystem.syntax ?? path;
  const normalized = syntax.normalize(filePath);
  if (processed.has(normalized)) {
    return;
  }
  processed.add(normalized);
  files.push({ path: normalized, content });
  // Upstream flat traversal processes import occurrences in reverse order.
  for (const token of scanInstructionImports(content).toReversed()) {
    context.filesystem.signal?.throwIfAborted();
    if (
      token.inCode ||
      !context.filesystem.validatePath(token.path, basePath, [context.projectRoot])
    ) {
      continue;
    }
    const target = syntax.normalize(syntax.resolve(basePath, token.path));
    if (processed.has(target)) {
      continue;
    }
    try {
      const imported = await context.filesystem.readFile(target);
      await visitFlat(imported, syntax.dirname(target), target, context, files, processed);
    } catch (error) {
      context.filesystem.signal?.throwIfAborted();
      if (context.debugMode) {
        instructionImportLogger.warn(`Failed to import ${target}: ${errorMessage(error)}`);
      }
    }
  }
}

async function processFlat(
  content: string,
  basePath: string,
  context: ImportContext,
): Promise<ProcessImportsResult> {
  const syntax = context.filesystem.syntax ?? path;
  const rootPath = syntax.normalize(context.state.currentFile ?? syntax.resolve(basePath));
  const files: FlatFile[] = [];
  await visitFlat(content, basePath, rootPath, context, files, new Set());
  return {
    content: files
      .map(
        (file) =>
          `--- File: ${file.path} ---\n${file.content.trim()}\n--- End of File: ${file.path} ---`,
      )
      .join("\n\n"),
    importTree: { path: rootPath },
  };
}

/** Gemini defaults and output shapes are retained; backend readers keep their admission. */
export async function processImports(
  content: string,
  basePath: string,
  debugMode = false,
  importState: InstructionImportState = { processedFiles: new Set(), maxDepth: 5, currentDepth: 0 },
  projectRoot?: string,
  importFormat: InstructionImportFormat = "tree",
  boundaryMarkers: readonly string[] = [".git"],
  filesystem = hostFileSystem,
): Promise<ProcessImportsResult> {
  filesystem.signal?.throwIfAborted();
  if (importState.currentDepth >= importState.maxDepth) {
    if (debugMode) {
      instructionImportLogger.warn(
        `Maximum import depth (${importState.maxDepth}) reached. Stopping import processing.`,
      );
    }
    return { content, importTree: { path: importState.currentFile ?? "unknown" } };
  }
  const context: ImportContext = {
    debugMode,
    state: importState,
    projectRoot: projectRoot ?? (await findInstructionProjectRoot(basePath, boundaryMarkers)),
    boundaryMarkers,
    filesystem,
  };
  return importFormat === "flat"
    ? processFlat(content, basePath, context)
    : processTree(content, basePath, context);
}
