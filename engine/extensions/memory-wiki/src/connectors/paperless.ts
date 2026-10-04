// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/PaperlessNgx/PaperlessNgxLoader/index.js, PaperlessNgx/index.js.
// pdf-parse is not a Branch dependency: PDF downloads use the text Paperless-ngx already extracted
// (the document's `content` field); html-to-text is replaced by Branch's htmlToMarkdown.
import { htmlToMarkdown } from "branch/plugin-sdk/web-content-extractor";
import type { ConnectorFetch } from "./fetch.js";
import type { ConnectorDocument, ConnectorSource } from "./import.js";

type PaperlessListedDocument = {
  id: number;
  original_file_name?: string;
  title?: string;
  created?: string;
  modified?: string;
  added?: string;
  tags?: number[];
  correspondent?: number | string | null;
  document_type?: number | string | null;
  content?: string;
};

type PaperlessDocument = {
  pageContent: string;
  metadata: {
    id: number;
    title: string;
    created?: string;
    modified?: string;
    correspondent?: number | string | null;
    url: string;
  };
};

export class PaperlessNgxLoader {
  readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly fetchImpl: ConnectorFetch;

  constructor(params: { baseUrl: string; apiToken: string; fetchImpl: ConnectorFetch }) {
    const url = new URL(params.baseUrl);
    this.baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    this.apiToken = params.apiToken;
    this.fetchImpl = params.fetchImpl;
  }

  private get baseHeaders(): Record<string, string> {
    return { Authorization: `Token ${this.apiToken}` };
  }

  async load(): Promise<PaperlessDocument[]> {
    const documents = await this.fetchAllDocuments();
    return documents.map((doc) => this.createDocumentFromPage(doc));
  }

  async fetchAllDocuments(): Promise<Array<PaperlessListedDocument & { content: string }>> {
    const documents: PaperlessListedDocument[] = [];
    let nextUrl: string | null = `${this.baseUrl}/api/documents/`;
    while (nextUrl) {
      try {
        const res: Response = await this.fetchImpl(nextUrl, {
          headers: { "Content-Type": "application/json", ...this.baseHeaders },
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch documents from Paperless-ngx: ${res.status}`);
        }
        const data = (await res.json()) as {
          results: PaperlessListedDocument[];
          next?: string | null;
        };
        const validResults = data.results.filter((doc) => doc?.id);
        if (!validResults.length) {
          break;
        }
        documents.push(...validResults);
        if (data.next === nextUrl) {
          break;
        }
        nextUrl = data.next || null;
      } catch {
        break;
      }
    }
    const documentsWithContent = await Promise.all(
      documents.map(async (doc) => ({ ...doc, content: await this.fetchDocumentContent(doc) })),
    );
    return documentsWithContent.filter((doc) => !!doc.content);
  }

  async fetchDocumentContent(doc: PaperlessListedDocument): Promise<string> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/documents/${doc.id}/download/`, {
        headers: this.baseHeaders,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch document content: ${response.status}`);
      }
      if (response.headers.get("content-type") === "application/pdf") {
        return doc.content ?? "";
      }
      return await response.text();
    } catch {
      return "";
    }
  }

  createDocumentFromPage(doc: PaperlessListedDocument & { content: string }): PaperlessDocument {
    const plainTextContent = htmlToMarkdown(doc.content || "").text;
    return {
      pageContent: plainTextContent,
      metadata: {
        id: doc.id,
        title: doc.original_file_name ?? doc.title ?? `Document ${doc.id}`,
        ...(doc.created ? { created: doc.created } : {}),
        ...(doc.modified ? { modified: doc.modified } : {}),
        correspondent: doc.correspondent ?? null,
        url: `${this.baseUrl}/documents/${doc.id}`,
      },
    };
  }
}

function validBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type PaperlessConnectorLoad =
  | { success: true; source: ConnectorSource; documents: ConnectorDocument[] }
  | { success: false; reason: string };

export async function loadPaperlessConnectorDocuments(params: {
  baseUrl: string;
  apiToken?: string | null;
  fetchImpl: ConnectorFetch;
}): Promise<PaperlessConnectorLoad> {
  if (!params.baseUrl || !validBaseUrl(params.baseUrl)) {
    return { success: false, reason: "Provided base URL is not a valid URL." };
  }
  if (!params.apiToken) {
    return {
      success: false,
      reason: "You need to provide an API token to use the Paperless-ngx connector.",
    };
  }
  const loader = new PaperlessNgxLoader({
    baseUrl: params.baseUrl,
    apiToken: params.apiToken,
    fetchImpl: params.fetchImpl,
  });
  const docs = (await loader.load()).filter((doc) => doc.pageContent);
  if (!docs.length) {
    return { success: false, reason: "No parseable documents found in that Paperless-ngx instance." };
  }
  return {
    success: true,
    source: {
      kind: "paperless",
      id: `paperless:${loader.baseUrl}`,
      label: `Paperless-ngx instance at ${loader.baseUrl}`,
    },
    documents: docs.map((doc) => ({
      key: String(doc.metadata.id),
      title: doc.metadata.title,
      content: doc.pageContent,
      url: doc.metadata.url,
      ...(doc.metadata.modified ? { updatedAtMs: Date.parse(doc.metadata.modified) || 0 } : {}),
      details: [
        `- Author: ${doc.metadata.correspondent ?? "Unknown"}`,
        ...(doc.metadata.created ? [`- Created: ${doc.metadata.created}`] : []),
      ],
    })),
  };
}
