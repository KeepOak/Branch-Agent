// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/Confluence/ConfluenceLoader/index.js, Confluence/index.js.
// html-to-text is replaced by Branch's web-fetch htmlToMarkdown; SSL bypass is not carried over.
import { htmlToMarkdown } from "branch/plugin-sdk/web-content-extractor";
import type { ConnectorFetch } from "./fetch.js";
import type { ConnectorDocument, ConnectorSource } from "./import.js";

type ConfluencePage = {
  id: string;
  status?: string;
  title: string;
  type?: string;
  body: { storage: { value: string } };
  version?: { number?: number; by?: { displayName?: string }; when?: string };
};

type ConfluenceDocument = {
  pageContent: string;
  metadata: {
    id: string;
    status?: string;
    title: string;
    type?: string;
    url: string;
    version?: number;
    updated_by?: string;
    updated_at?: string;
  };
};

export type ConfluenceLoaderOptions = {
  baseUrl: string;
  spaceKey: string;
  username?: string | null;
  accessToken?: string | null;
  personalAccessToken?: string | null;
  limit?: number;
  expand?: string;
  cloud?: boolean;
  fetchImpl: ConnectorFetch;
};

export class ConfluencePagesLoader {
  readonly baseUrl: string;
  readonly spaceKey: string;
  private readonly username: string | null;
  private readonly accessToken: string | null;
  private readonly personalAccessToken: string | null;
  readonly limit: number;
  readonly expand: string;
  readonly cloud: boolean;
  private readonly fetchImpl: ConnectorFetch;

  constructor(options: ConfluenceLoaderOptions) {
    this.baseUrl = options.baseUrl;
    this.spaceKey = options.spaceKey;
    this.username = options.username ?? null;
    this.accessToken = options.accessToken ?? null;
    this.personalAccessToken = options.personalAccessToken ?? null;
    this.limit = options.limit ?? 25;
    this.expand = options.expand ?? "body.storage,version";
    this.cloud = options.cloud ?? true;
    this.fetchImpl = options.fetchImpl;
  }

  get authorizationHeader(): string | undefined {
    if (this.personalAccessToken) {
      return `Bearer ${this.personalAccessToken}`;
    }
    if (this.username && this.accessToken) {
      return `Basic ${Buffer.from(`${this.username}:${this.accessToken}`).toString("base64")}`;
    }
    return undefined;
  }

  async load(options?: { start?: number; limit?: number }): Promise<ConfluenceDocument[]> {
    const pages = await this.fetchAllPagesInSpace(options?.start, options?.limit);
    return pages.map((page) => this.createDocumentFromPage(page));
  }

  async fetchConfluenceData(url: string): Promise<{ size: number; results: ConfluencePage[] }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const authHeader = this.authorizationHeader;
    if (authHeader) {
      headers.Authorization = authHeader;
    }
    const response = await this.fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} from Confluence: ${response.status}`);
    }
    return (await response.json()) as { size: number; results: ConfluencePage[] };
  }

  async fetchAllPagesInSpace(start = 0, limit = this.limit): Promise<ConfluencePage[]> {
    const url = `${this.baseUrl}${this.cloud ? "/wiki" : ""}/rest/api/content?spaceKey=${this.spaceKey}&limit=${limit}&start=${start}&expand=${this.expand}`;
    const data = await this.fetchConfluenceData(url);
    if (data.size === 0) {
      return [];
    }
    const nextPageResults = await this.fetchAllPagesInSpace(start + data.size, limit);
    return data.results.concat(nextPageResults);
  }

  createDocumentFromPage(page: ConfluencePage): ConfluenceDocument {
    // Code macros become fenced blocks; they are swapped back in after the HTML conversion
    // so the converter cannot reflow them.
    const codeBlocks: string[] = [];
    const extractCodeBlocks = (content: string) => {
      const codeBlockRegex =
        /<ac:structured-macro[^>]*\sac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g;
      const languageRegex = /<ac:parameter ac:name="language">(.*?)<\/ac:parameter>/;
      return content.replace(codeBlockRegex, (match) => {
        const language = match.match(languageRegex)?.[1] || "";
        const code =
          match.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/)?.[1] ||
          "";
        codeBlocks.push(`\n\`\`\`${language}\n${code.trim()}\n\`\`\`\n`);
        return `<p>BRANCHCODEBLOCK${codeBlocks.length - 1}</p>`;
      });
    };
    const contentWithCodeBlocks = extractCodeBlocks(page.body.storage.value);
    const text = htmlToMarkdown(contentWithCodeBlocks)
      .text.replace(/BRANCHCODEBLOCK(\d+)/g, (_match, index: string) => codeBlocks[Number(index)] ?? "")
      .replace(/\n{3,}/g, "\n\n");
    const pageUrl = `${this.baseUrl}${this.cloud ? "/wiki" : ""}/spaces/${this.spaceKey}/pages/${page.id}`;
    return {
      pageContent: text,
      metadata: {
        id: page.id,
        ...(page.status ? { status: page.status } : {}),
        title: page.title,
        ...(page.type ? { type: page.type } : {}),
        url: pageUrl,
        ...(page.version?.number !== undefined ? { version: page.version.number } : {}),
        ...(page.version?.by?.displayName ? { updated_by: page.version.by.displayName } : {}),
        ...(page.version?.when ? { updated_at: page.version.when } : {}),
      },
    };
  }
}

export function resolveConfluenceBaseUrl(baseUrl: string, cloud = true): string {
  const url = new URL(baseUrl);
  // Cloud URLs use just the origin; self-hosted may have a context path like /confluence.
  if (cloud) {
    return url.origin;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function validBaseUrl(baseUrl: string): boolean {
  try {
    new URL(baseUrl);
    return true;
  } catch {
    return false;
  }
}

export type ConfluenceConnectorLoad =
  | { success: true; source: ConnectorSource; documents: ConnectorDocument[] }
  | { success: false; reason: string };

export async function loadConfluenceConnectorDocuments(params: {
  baseUrl: string;
  spaceKey: string;
  username?: string | null;
  accessToken?: string | null;
  personalAccessToken?: string | null;
  cloud?: boolean;
  fetchImpl: ConnectorFetch;
}): Promise<ConfluenceConnectorLoad> {
  if (!params.personalAccessToken && (!params.username || !params.accessToken)) {
    return {
      success: false,
      reason:
        "You need either a personal access token (PAT), or a username and access token to use the Confluence connector.",
    };
  }
  if (!params.baseUrl || !validBaseUrl(params.baseUrl)) {
    return { success: false, reason: "Provided base URL is not a valid URL." };
  }
  if (!params.spaceKey) {
    return { success: false, reason: "You need to provide a Confluence space key." };
  }
  const cloud = params.cloud ?? true;
  const normalizedBaseUrl = resolveConfluenceBaseUrl(params.baseUrl, cloud);
  const loader = new ConfluencePagesLoader({ ...params, baseUrl: normalizedBaseUrl, cloud });
  let docs: ConfluenceDocument[];
  try {
    docs = await loader.load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, reason: message.split("Error:")[1] || message };
  }
  if (!docs.length) {
    return { success: false, reason: "No pages found for that Confluence space." };
  }
  return {
    success: true,
    source: {
      kind: "confluence",
      id: `confluence:${normalizedBaseUrl}#${params.spaceKey}`,
      label: `${normalizedBaseUrl} Confluence space ${params.spaceKey}`,
    },
    documents: docs.map((doc) => ({
      key: doc.metadata.id,
      title: doc.metadata.title,
      content: doc.pageContent,
      url: doc.metadata.url,
      ...(doc.metadata.updated_at ? { updatedAtMs: Date.parse(doc.metadata.updated_at) || 0 } : {}),
      details: doc.metadata.updated_by ? [`- Updated by: ${doc.metadata.updated_by}`] : [],
    })),
  };
}
