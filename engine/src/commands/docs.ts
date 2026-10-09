import fs from "node:fs";
import path from "node:path";
import { resolveBranchReferencePaths } from "../agents/docs-path.js";
import { formatDocsLink } from "../../packages/terminal-core/src/links.js";
import { isRich, theme } from "../../packages/terminal-core/src/theme.js";
import { formatCliCommand } from "../cli/command-format.js";
// Implements docs link/search output for `branch docs`. Search runs over the docs bundled with this install.
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";

const DOCS_REPO_BLOB_URL = "https://github.com/KeepOak/Branch-Agent/blob/main/engine/docs";
const DOCS_FILE_MAX_BYTES = 512 * 1024;
const DOCS_MAX_RESULTS = 20;
const DOCS_SNIPPET_MAX_CHARS = 200;

type DocResult = {
  title: string;
  link: string;
  snippet?: string;
};

type DocsSearchResponse = {
  results?: unknown;
};

function escapeMarkdown(text: string): string {
  return text.replace(/[()[\]]/g, "\\$&");
}

function buildMarkdown(query: string, results: DocResult[]): string {
  const lines: string[] = [`# Docs search: ${escapeMarkdown(query)}`, ""];
  if (results.length === 0) {
    lines.push("_No results._");
    return lines.join("\n");
  }
  for (const item of results) {
    const title = escapeMarkdown(item.title);
    const snippet = item.snippet ? escapeMarkdown(item.snippet) : "";
    const suffix = snippet ? ` - ${snippet}` : "";
    lines.push(`- [${title}](${item.link})${suffix}`);
  }
  return lines.join("\n");
}

function formatLinkLabel(link: string): string {
  return link.replace(/^https?:\/\//i, "");
}

function renderRichResults(query: string, results: DocResult[], runtime: RuntimeEnv) {
  runtime.log(`${theme.heading("Docs search:")} ${theme.info(query)}`);
  if (results.length === 0) {
    runtime.log(theme.muted("No results."));
    return;
  }
  for (const item of results) {
    const linkLabel = formatLinkLabel(item.link);
    const link = formatDocsLink(item.link, linkLabel);
    runtime.log(
      `${theme.muted("-")} ${theme.command(item.title)} ${theme.muted("(")}${link}${theme.muted(")")}`,
    );
    if (item.snippet) {
      runtime.log(`  ${theme.muted(item.snippet)}`);
    }
  }
}

function listMarkdownFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(root, full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

function pageTitle(text: string, fallback: string): string {
  const heading = /^#\s+(.+)$/mu.exec(text);
  return heading?.[1]?.trim() || fallback;
}

function matchingSnippet(text: string, token: string): string | undefined {
  const line = text.split("\n").find((candidate) => candidate.toLowerCase().includes(token));
  const trimmed = line?.replace(/\s+/gu, " ").trim();
  return trimmed ? trimmed.slice(0, DOCS_SNIPPET_MAX_CHARS) : undefined;
}

/** Ranks the bundled docs pages that contain every query word; the title match counts more. */
export function searchBundledDocs(query: string, docsRoot: string, limit = DOCS_MAX_RESULTS): DocResult[] {
  const tokens = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }
  const scored: Array<DocResult & { score: number }> = [];
  for (const rel of listMarkdownFiles(docsRoot)) {
    const full = path.join(docsRoot, rel);
    if (fs.statSync(full).size > DOCS_FILE_MAX_BYTES) {
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    const lower = text.toLowerCase();
    if (!tokens.every((token) => lower.includes(token))) {
      continue;
    }
    const title = pageTitle(text, rel.replace(/\.md$/u, ""));
    const titleLower = title.toLowerCase();
    const score =
      tokens.reduce((total, token) => total + Math.min(lower.split(token).length - 1, 20), 0) +
      tokens.reduce((total, token) => total + (titleLower.includes(token) ? 10 : 0), 0);
    scored.push({
      title,
      link: `${DOCS_REPO_BLOB_URL}/${rel}`,
      snippet: matchingSnippet(text, tokens[0] ?? ""),
      score,
    });
  }
  return scored
    .toSorted((left, right) => right.score - left.score || left.link.localeCompare(right.link))
    .slice(0, Math.max(0, limit))
    .map(({ score: _score, ...result }) => result);
}

async function searchDocs(query: string): Promise<DocResult[]> {
  const { docsPath } = await resolveBranchReferencePaths({ moduleUrl: import.meta.url });
  if (!docsPath) {
    throw new Error("the docs bundled with this install were not found");
  }
  return searchBundledDocs(query, docsPath);
}

/** Search the docs bundled with this install, or print the docs homepage when no query is provided. */
export async function docsSearchCommand(
  queryParts: string[],
  runtime: RuntimeEnv,
  options: { json?: boolean; limit?: number } = {},
) {
  const query = queryParts.join(" ").trim();
  if (!query) {
    if (options.json) {
      writeRuntimeJson(runtime, {
        query: null,
        url: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs",
        results: [],
      });
      return;
    }
    const docs = formatDocsLink("/");
    if (isRich()) {
      runtime.log(`${theme.muted("Docs:")} ${docs}`);
      runtime.log(`${theme.muted("Search:")} ${formatCliCommand('branch docs "your query"')}`);
    } else {
      runtime.log("Docs: https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs");
      runtime.log(`Search: ${formatCliCommand('branch docs "your query"')}`);
    }
    return;
  }

  let results: DocResult[];
  try {
    results = await searchDocs(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Docs search failed: ${message}`, { cause: error });
  }
  if (options.limit !== undefined) {
    results = results.slice(0, options.limit);
  }

  if (options.json) {
    writeRuntimeJson(runtime, { query, results });
    return;
  }

  if (isRich()) {
    renderRichResults(query, results, runtime);
    return;
  }
  runtime.log(buildMarkdown(query, results).trimEnd());
}
