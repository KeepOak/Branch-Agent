import { filterImportantFiles } from "./important-files.js";

/** Classify only file paths already returned by the scoped listing. */
export function projectImportantSessionFilePaths(result: {
  files: readonly { path: string; missing?: boolean }[];
  browser?: { entries: readonly { path: string; kind: "file" | "directory" }[] };
}): string[] {
  const paths = [
    ...result.files.filter((file) => !file.missing).map((file) => file.path),
    ...(result.browser?.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path) ?? []),
  ];
  return filterImportantFiles(paths);
}
