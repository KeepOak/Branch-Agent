// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/files (writeToServerDocuments) as used by the data connectors.
// Connector documents become wiki source pages through the shared imported-source sync (unchanged-skip, prune, notes kept).
import { createHash } from "node:crypto";
import { refreshMemoryWikiIndexesAfterImport } from "../compile.js";
import type { ResolvedMemoryWikiConfig } from "../config.js";
import { createWikiPageFilename, slugifyWikiSegment } from "../markdown.js";
import { withMemoryWikiVaultMutation } from "../mutation-coordinator.js";
import { syncImportedSourcePages, type BridgeMemoryWikiResult } from "../source-import.js";
import { renderImportedSourcePage, writeImportedSourcePage } from "../source-page-shared.js";
import { assertMemoryWikiSourceSyncStateCapacity } from "../source-sync-state.js";

export const CONNECTOR_KINDS = [
  "github",
  "gitlab",
  "gitea",
  "link",
  "obsidian",
  "confluence",
  "paperless",
  "drupalwiki",
] as const;

export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/** One fetched document. Never carries credentials. */
export type ConnectorDocument = {
  /** Stable identity inside the source (repo path, page id, ...). */
  key: string;
  title: string;
  content: string;
  /** Browsable location of the document (no tokens). */
  url?: string;
  language?: string;
  updatedAtMs?: number;
  details?: string[];
};

/** A connector source; `id` is its stable, credential-free identity. */
export type ConnectorSource = {
  kind: ConnectorKind;
  id: string;
  label: string;
};

export type ConnectorImportResult = BridgeMemoryWikiResult & {
  sourceId: string;
  indexesRefreshed: boolean;
};

function hashText(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function connectorSyncKey(sourceId: string, documentKey: string): string {
  return `${sourceId}#${documentKey}`;
}

function connectorPagePath(source: ConnectorSource, document: ConnectorDocument): string {
  const syncKey = connectorSyncKey(source.id, document.key);
  const stem = `${source.kind}-${slugifyWikiSegment(document.title)}-${hashText(syncKey, 10)}`;
  return `sources/${createWikiPageFilename(stem)}`;
}

function renderConnectorPage(params: {
  source: ConnectorSource;
  document: ConnectorDocument;
  pageId: string;
  raw: string;
  updatedAt: string;
}): string {
  const { source, document } = params;
  return renderImportedSourcePage({
    frontmatter: {
      pageType: "source",
      id: params.pageId,
      title: document.title,
      sourceType: source.kind,
      connectorSource: source.id,
      ...(document.url ? { sourcePath: document.url } : {}),
      status: "active",
      updatedAt: params.updatedAt,
    },
    sourceHeading: "Source",
    sourceDetails: [
      `- Type: \`${source.kind}\``,
      `- Source: ${source.label}`,
      ...(document.url ? [`- Location: ${document.url}`] : []),
      ...(document.details ?? []),
      `- Updated: ${params.updatedAt}`,
    ],
    content: params.raw,
    language: document.language ?? "markdown",
  });
}

/**
 * Writes the connector's documents as wiki source pages, removes pages for documents the
 * source no longer has (when `complete`), and refreshes the wiki indexes once.
 */
export async function importConnectorDocuments(params: {
  config: ResolvedMemoryWikiConfig;
  source: ConnectorSource;
  documents: readonly ConnectorDocument[];
  /** True when `documents` is the full listing, so missing documents can be pruned. */
  complete: boolean;
  signal?: AbortSignal;
}): Promise<ConnectorImportResult> {
  const documents = params.documents.filter((document) => document.content.trim().length > 0);
  const prefix = connectorSyncKey(params.source.id, "");
  return await withMemoryWikiVaultMutation(params.config.vault.path, async () => {
    const syncResult = await syncImportedSourcePages({
      config: params.config,
      group: "connector",
      ...(params.signal ? { signal: params.signal } : {}),
      canPrune: () => params.complete,
      logDetails: () => ({ documentCount: documents.length }),
      writeSources: async ({ state, prepareWrite }) => {
        // Other connector sources stay active; only this source's missing documents prune.
        const activeKeys = new Set(
          Object.entries(state.entries)
            .filter(([key, entry]) => entry.group === "connector" && !key.startsWith(prefix))
            .map(([key]) => key),
        );
        const incoming = documents.map((document) =>
          connectorSyncKey(params.source.id, document.key),
        );
        assertMemoryWikiSourceSyncStateCapacity({
          state,
          group: "connector",
          incomingCount: new Set([...incoming, ...activeKeys]).size,
        });
        const results: Awaited<ReturnType<typeof writeImportedSourcePage>>[] = [];
        for (const document of documents) {
          params.signal?.throwIfAborted();
          const syncKey = connectorSyncKey(params.source.id, document.key);
          activeKeys.add(syncKey);
          const pageId = `source.${params.source.kind}.${hashText(syncKey, 16)}`;
          results.push(
            await writeImportedSourcePage({
              vaultRoot: params.config.vault.path,
              syncKey,
              sourcePath: document.url ?? syncKey,
              sourceContent: document.content,
              sourceUpdatedAtMs: document.updatedAtMs ?? 0,
              sourceSize: Buffer.byteLength(document.content),
              renderFingerprint: hashText(
                JSON.stringify([document.title, document.content, document.details ?? []]),
                40,
              ),
              pagePath: connectorPagePath(params.source, document),
              group: "connector",
              state,
              prepareWrite,
              buildRendered: (raw, updatedAt) =>
                renderConnectorPage({
                  source: params.source,
                  document,
                  pageId,
                  raw,
                  updatedAt: document.updatedAtMs ? updatedAt : new Date().toISOString(),
                }),
            }),
          );
        }
        return { results, activeKeys, artifactCount: documents.length, workspaces: 1 };
      },
    });
    const refresh = await refreshMemoryWikiIndexesAfterImport({
      config: params.config,
      syncResult,
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return { ...syncResult, sourceId: params.source.id, indexesRefreshed: refresh.refreshed };
  });
}
