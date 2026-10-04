// Ported from google-gemini/gemini-cli c6bccb7ecbf6d8368d995455dd725ed34466faad,
// packages/core/src/utils/memoryImportProcessor.ts and paths.ts.
import fs from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type InstructionImport = { start: number; end: number; path: string; inCode: boolean };
export type ImportPathSyntax = Pick<
  typeof path,
  "resolve" | "dirname" | "normalize" | "relative" | "sep" | "isAbsolute"
>;

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isImportPath(value: string): boolean {
  return value.length > 0 && (value[0] === "." || value[0] === "/" || /^[A-Za-z]/.test(value));
}

function codeRegions(content: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  const regex = /(`+)([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    regions.push([match.index, match.index + match[0].length]);
  }
  return regions;
}

export function scanInstructionImports(content: string): InstructionImport[] {
  const imports: InstructionImport[] = [];
  const regions = codeRegions(content);
  let index = 0;
  while (index < content.length) {
    index = content.indexOf("@", index);
    if (index === -1) {
      break;
    }
    if (index > 0 && !isWhitespace(content[index - 1])) {
      index++;
      continue;
    }
    let end = index + 1;
    while (end < content.length && !isWhitespace(content[end])) {
      end++;
    }
    const importPath = content.slice(index + 1, end);
    if (isImportPath(importPath)) {
      imports.push({
        start: index,
        end,
        path: importPath,
        inCode: regions.some(([start, stop]) => index >= start && index < stop),
      });
    }
    index = end + 1;
  }
  return imports;
}

function expectedMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "EISDIR" || code === "ENAMETOOLONG" || code === "ENOTDIR";
}

function stripExtendedLengthPrefix(value: string): string {
  return value.toUpperCase().startsWith("\\\\?\\UNC\\")
    ? `\\\\${value.slice(8)}`
    : value.startsWith("\\\\?\\")
      ? value.slice(4)
      : value;
}

function resolveMissingRealPath(filePath: string, visited: Set<string>): string {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      return robustRealPath(
        path.resolve(path.dirname(filePath), fs.readlinkSync(filePath)),
        visited,
      );
    }
  } catch (error) {
    if (!expectedMissing(error)) {
      throw error;
    }
  }
  const parent = path.dirname(filePath);
  return parent === filePath
    ? filePath
    : path.join(robustRealPath(parent, visited), path.basename(filePath));
}

function robustRealPath(filePath: string, visited = new Set<string>()): string {
  const key = process.platform === "win32" ? filePath.toLowerCase() : filePath;
  if (visited.has(key)) {
    throw new Error(`Infinite recursion detected in robustRealpath: ${filePath}`);
  }
  visited.add(key);
  try {
    const readRealPath = process.platform === "win32" ? fs.realpathSync.native : fs.realpathSync;
    return stripExtendedLengthPrefix(readRealPath(filePath));
  } catch (error) {
    if (!expectedMissing(error)) {
      throw error;
    }
    return resolveMissingRealPath(filePath, visited);
  }
}

function resolveRealPath(value: string): string {
  if (value.includes("\0")) {
    throw new Error(`Invalid path: ${value}`);
  }
  try {
    if (value.startsWith("file://")) {
      value = fileURLToPath(value);
    }
    value = decodeURIComponent(value);
  } catch {
    // Upstream retains the original spelling when URL decoding fails.
  }
  return robustRealPath(path.resolve(value));
}

export function importPathIsWithin(
  parent: string,
  child: string,
  syntax: ImportPathSyntax = path,
): boolean {
  if (syntax === path && process.platform === "darwin") {
    parent = parent.toLowerCase();
    child = child.toLowerCase();
  }
  const relative = syntax.relative(parent, child);
  return (
    relative !== ".." && !relative.startsWith(`..${syntax.sep}`) && !syntax.isAbsolute(relative)
  );
}

export function validateImportPath(
  importPath: string,
  basePath: string,
  allowedDirectories: string[],
): boolean {
  if (/^(file|https?):\/\//.test(importPath)) {
    return false;
  }
  try {
    const resolved = resolveRealPath(path.resolve(basePath, importPath));
    return allowedDirectories.some((directory) => {
      if (!directory.trim()) {
        return false;
      }
      try {
        return importPathIsWithin(resolveRealPath(directory.trim()), resolved);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export async function findInstructionProjectRoot(
  startDir: string,
  boundaryMarkers: readonly string[] = [".git"],
): Promise<string> {
  const start = path.resolve(startDir);
  let current = start;
  while (boundaryMarkers.length > 0) {
    for (const marker of boundaryMarkers) {
      if (path.isAbsolute(marker) || marker.includes("..")) {
        continue;
      }
      try {
        await access(path.join(current, marker));
        return current;
      } catch {
        // Missing markers do not interrupt the ancestor walk.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return start;
}
