// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 server/models/documentSyncQueue.js, server/jobs/sync-watched-documents.js, collector/extensions/resync/index.js.
// Branch watches a whole connector source rather than one document. Credentials are never stored:
// a source records the environment variable that holds its token and reads it again on resync.
import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedMemoryWikiConfig } from "../config.js";
import { loadConfluenceConnectorDocuments } from "./confluence.js";
import { loadDrupalWikiConnectorDocuments } from "./drupalwiki.js";
import { createGuardedConnectorFetch, type ConnectorFetch } from "./fetch.js";
import {
  importConnectorDocuments,
  type ConnectorDocument,
  type ConnectorImportResult,
  type ConnectorSource,
} from "./import.js";
import { loadLinkConnectorDocument } from "./link.js";
import { loadObsidianVault, readObsidianVaultFiles } from "./obsidian.js";
import { loadPaperlessConnectorDocuments } from "./paperless.js";
import { loadRepoConnectorDocuments } from "./repo.js";

export type ConnectorSpec =
  | {
      kind: "github" | "gitlab" | "gitea";
      repo: string;
      branch?: string;
      ignorePaths?: string[];
      fetchIssues?: boolean;
      fetchWikis?: boolean;
      tokenEnv?: string;
    }
  | { kind: "link"; url: string }
  | { kind: "obsidian"; path: string }
  | {
      kind: "confluence";
      baseUrl: string;
      spaceKey: string;
      cloud?: boolean;
      username?: string;
      tokenEnv?: string;
      personalAccessTokenEnv?: string;
    }
  | { kind: "paperless"; baseUrl: string; tokenEnv?: string }
  | { kind: "drupalwiki"; baseUrl: string; spaceIds: string; tokenEnv?: string };

/** Source kinds with an upstream resync handler (documentSyncQueue.validFileTypes plus paperless). */
const WATCHABLE_KINDS = new Set([
  "link",
  "confluence",
  "github",
  "gitlab",
  "gitea",
  "drupalwiki",
  "paperless",
]);

export const DEFAULT_STALE_AFTER_MS = 604_800_000; // 7 days
const MIN_STALE_AFTER_MS = 3_600_000; // 1 hour
export const MAX_REPEAT_FAILURES = 5;

/** 7 days unless DOCUMENT_SYNC_STALE_AFTER_MS sets another value (at least 1 hour). */
export function resolveDefaultStaleAfterMs(env: NodeJS.ProcessEnv = process.env): number {
  const envValue = Number(env.DOCUMENT_SYNC_STALE_AFTER_MS);
  if (Number.isNaN(envValue) || envValue <= 0) {
    return DEFAULT_STALE_AFTER_MS;
  }
  return Math.max(envValue, MIN_STALE_AFTER_MS);
}

export type ConnectorSourceRecord = {
  sourceId: string;
  label: string;
  spec: ConnectorSpec;
  watched: boolean;
  staleAfterMs: number;
  nextSyncAt?: number;
  lastSyncedAt?: number;
  failedRuns: number;
};

type ConnectorSourceRegistry = { version: 1; sources: ConnectorSourceRecord[] };

function registryPath(config: ResolvedMemoryWikiConfig): string {
  return path.join(config.vault.path, ".branch-wiki", "connector-sources.json");
}

export async function readConnectorSources(
  config: ResolvedMemoryWikiConfig,
): Promise<ConnectorSourceRecord[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(config), "utf8")) as ConnectorSourceRegistry;
    return Array.isArray(parsed?.sources) ? parsed.sources : [];
  } catch {
    return [];
  }
}

async function writeConnectorSources(
  config: ResolvedMemoryWikiConfig,
  sources: ConnectorSourceRecord[],
): Promise<void> {
  const file = registryPath(config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const registry: ConnectorSourceRegistry = { version: 1, sources };
  await fs.writeFile(file, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export type ConnectorRuntime = {
  env?: NodeJS.ProcessEnv;
  /** Builds the network fetch for a connector; the instance base URL is allowed by the SSRF guard. */
  createFetch?: (allowedBaseUrl?: string) => ConnectorFetch;
  now?: () => number;
};

type ConnectorLoad =
  | { success: true; source: ConnectorSource; documents: ConnectorDocument[]; complete: boolean }
  | { success: false; reason: string };

function readToken(env: NodeJS.ProcessEnv, name: string | undefined): string | null {
  return name ? env[name]?.trim() || null : null;
}

/** Runs the connector a spec describes (the collector's per-type load/resync handlers). */
export async function loadConnectorSpec(
  spec: ConnectorSpec,
  runtime: ConnectorRuntime = {},
): Promise<ConnectorLoad> {
  const env = runtime.env ?? process.env;
  const createFetch = runtime.createFetch ?? createGuardedConnectorFetch;
  switch (spec.kind) {
    case "github":
    case "gitlab":
    case "gitea": {
      const loaded = await loadRepoConnectorDocuments(spec.kind, {
        repo: spec.repo,
        ...(spec.branch ? { branch: spec.branch } : {}),
        accessToken: readToken(env, spec.tokenEnv),
        ignorePaths: spec.ignorePaths ?? [],
        fetchIssues: spec.fetchIssues ?? false,
        fetchWikis: spec.fetchWikis ?? false,
        fetchImpl: createFetch(spec.repo),
      });
      return loaded.success ? { ...loaded, complete: true } : loaded;
    }
    case "link": {
      const loaded = await loadLinkConnectorDocument({ link: spec.url, fetchImpl: createFetch() });
      return loaded.success ? { ...loaded, complete: true } : loaded;
    }
    case "obsidian": {
      const loaded = loadObsidianVault(await readObsidianVaultFiles(spec.path), spec.path);
      return loaded.success ? { ...loaded, complete: true } : loaded;
    }
    case "confluence": {
      const loaded = await loadConfluenceConnectorDocuments({
        baseUrl: spec.baseUrl,
        spaceKey: spec.spaceKey,
        cloud: spec.cloud ?? true,
        username: spec.username ?? null,
        accessToken: readToken(env, spec.tokenEnv),
        personalAccessToken: readToken(env, spec.personalAccessTokenEnv),
        fetchImpl: createFetch(spec.baseUrl),
      });
      return loaded.success ? { ...loaded, complete: true } : loaded;
    }
    case "paperless": {
      const loaded = await loadPaperlessConnectorDocuments({
        baseUrl: spec.baseUrl,
        apiToken: readToken(env, spec.tokenEnv),
        fetchImpl: createFetch(spec.baseUrl),
      });
      return loaded.success ? { ...loaded, complete: true } : loaded;
    }
    case "drupalwiki": {
      const loaded = await loadDrupalWikiConnectorDocuments({
        baseUrl: spec.baseUrl,
        spaceIds: spec.spaceIds,
        accessToken: readToken(env, spec.tokenEnv),
        fetchImpl: createFetch(spec.baseUrl),
      });
      return loaded.success ? { ...loaded, complete: true } : loaded;
    }
  }
}

export type ConnectorRunResult =
  | (ConnectorImportResult & { success: true; watched: boolean })
  | { success: false; reason: string };

/** Imports a connector source into the wiki and records it (optionally watched for resync). */
export async function runConnectorImport(params: {
  config: ResolvedMemoryWikiConfig;
  spec: ConnectorSpec;
  watch?: boolean;
  runtime?: ConnectorRuntime;
}): Promise<ConnectorRunResult> {
  const now = params.runtime?.now ?? Date.now;
  if (params.watch && !WATCHABLE_KINDS.has(params.spec.kind)) {
    return { success: false, reason: `${params.spec.kind} sources cannot be watched for resync.` };
  }
  const loaded = await loadConnectorSpec(params.spec, params.runtime);
  if (!loaded.success) {
    return loaded;
  }
  const imported = await importConnectorDocuments({
    config: params.config,
    source: loaded.source,
    documents: loaded.documents,
    complete: loaded.complete,
  });
  const sources = await readConnectorSources(params.config);
  const existing = sources.find((record) => record.sourceId === loaded.source.id);
  const staleAfterMs = existing?.staleAfterMs ?? resolveDefaultStaleAfterMs(params.runtime?.env);
  const watched = params.watch ?? existing?.watched ?? false;
  const record: ConnectorSourceRecord = {
    sourceId: loaded.source.id,
    label: loaded.source.label,
    spec: params.spec,
    watched,
    staleAfterMs,
    lastSyncedAt: now(),
    ...(watched ? { nextSyncAt: now() + staleAfterMs } : {}),
    failedRuns: 0,
  };
  await writeConnectorSources(params.config, [
    ...sources.filter((entry) => entry.sourceId !== record.sourceId),
    record,
  ]);
  return { ...imported, success: true, watched };
}

export type ConnectorResyncResult = {
  checked: number;
  synced: Array<{ sourceId: string; importedCount: number; updatedCount: number; removedCount: number }>;
  failed: Array<{ sourceId: string; reason: string; attempt: number }>;
  unwatched: string[];
};

/** Re-syncs watched sources whose next sync time has passed (all watched ones with `force`). */
export async function resyncConnectorSources(params: {
  config: ResolvedMemoryWikiConfig;
  force?: boolean;
  sourceId?: string;
  runtime?: ConnectorRuntime;
}): Promise<ConnectorResyncResult> {
  const now = params.runtime?.now ?? Date.now;
  const sources = await readConnectorSources(params.config);
  const result: ConnectorResyncResult = { checked: 0, synced: [], failed: [], unwatched: [] };
  for (const record of sources) {
    const selected = params.sourceId ? record.sourceId === params.sourceId : record.watched;
    const due = params.force || params.sourceId || (record.nextSyncAt ?? 0) <= now();
    if (!selected || !due) {
      continue;
    }
    result.checked += 1;
    const loaded = await loadConnectorSpec(record.spec, params.runtime).catch(
      (error: unknown) =>
        ({ success: false, reason: error instanceof Error ? error.message : String(error) }) as const,
    );
    if (!loaded.success) {
      // Upstream drops a source from the watched set once it already failed this many runs in a row.
      if (record.failedRuns >= MAX_REPEAT_FAILURES) {
        record.watched = false;
        delete record.nextSyncAt;
        result.unwatched.push(record.sourceId);
      } else {
        record.failedRuns += 1;
        result.failed.push({ sourceId: record.sourceId, reason: loaded.reason, attempt: record.failedRuns });
      }
      continue;
    }
    const imported = await importConnectorDocuments({
      config: params.config,
      source: loaded.source,
      documents: loaded.documents,
      complete: loaded.complete,
    });
    record.failedRuns = 0;
    record.lastSyncedAt = now();
    if (record.watched) {
      record.nextSyncAt = now() + record.staleAfterMs;
    }
    result.synced.push({
      sourceId: record.sourceId,
      importedCount: imported.importedCount,
      updatedCount: imported.updatedCount,
      removedCount: imported.removedCount,
    });
  }
  await writeConnectorSources(params.config, sources);
  return result;
}

/** Turns watching on or off for a recorded source. */
export async function setConnectorSourceWatch(params: {
  config: ResolvedMemoryWikiConfig;
  sourceId: string;
  watched: boolean;
  now?: () => number;
}): Promise<ConnectorSourceRecord> {
  const sources = await readConnectorSources(params.config);
  const record = sources.find((entry) => entry.sourceId === params.sourceId);
  if (!record) {
    throw new Error(`Connector source not found: ${params.sourceId}`);
  }
  if (params.watched && !WATCHABLE_KINDS.has(record.spec.kind)) {
    throw new Error(`${record.spec.kind} sources cannot be watched for resync.`);
  }
  record.watched = params.watched;
  record.failedRuns = 0;
  if (params.watched) {
    record.nextSyncAt = (params.now ?? Date.now)() + record.staleAfterMs;
  } else {
    delete record.nextSyncAt;
  }
  await writeConnectorSources(params.config, sources);
  return record;
}
