// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/DrupalWiki/DrupalWiki/index.js, DrupalWiki/index.js.
// Pages are imported; attachments (upstream's file converters) are not. html-to-text is replaced
// by Branch's htmlToMarkdown, which keeps tables as markdown tables.
import { htmlToMarkdown } from "branch/plugin-sdk/web-content-extractor";
import type { ConnectorFetch } from "./fetch.js";
import type { ConnectorDocument, ConnectorSource } from "./import.js";

export type DrupalWikiPage = {
  id: number;
  title: string;
  created: string;
  type?: string;
  processedBody: string;
  url: string;
  spaceId?: number;
};

export class DrupalWiki {
  readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetchImpl: ConnectorFetch;

  constructor(params: { baseUrl: string; accessToken: string; fetchImpl: ConnectorFetch }) {
    this.baseUrl = params.baseUrl;
    this.accessToken = params.accessToken;
    this.fetchImpl = params.fetchImpl;
  }

  /** Loads every page of a space; a page that fails is skipped, an index failure is fatal. */
  async loadAllPagesForSpace(spaceId: number): Promise<DrupalWikiPage[]> {
    const pages: DrupalWikiPage[] = [];
    for (const pageId of await this.getPageIndexForSpace(spaceId)) {
      try {
        const page = await this.loadPage(pageId);
        // Pages with an empty body lead to embedding issues.
        if (page.processedBody.trim() !== "") {
          pages.push({ ...page, spaceId });
        }
      } catch {
        // Skip this page and continue, as upstream does.
      }
    }
    return pages;
  }

  async loadPage(pageId: number): Promise<DrupalWikiPage> {
    const data = (await this.doFetch(`${this.baseUrl}/api/rest/scope/api/page/${pageId}`)) as {
      id: number;
      title: string;
      lastModified: string;
      type?: string;
      body: string;
    };
    const url = `${this.baseUrl}/node/${data.id}`;
    return {
      id: data.id,
      title: data.title,
      created: data.lastModified,
      ...(data.type ? { type: data.type } : {}),
      processedBody: this.processPageBody({ body: data.body, title: data.title }),
      url,
    };
  }

  private async getPageIndexForSpace(spaceId: number): Promise<number[]> {
    let hasNext = true;
    let pageIds: number[] = [];
    let pageNr = 0;
    do {
      const data = (await this.doFetch(
        `${this.baseUrl}/api/rest/scope/api/page?size=100&space=${spaceId}&page=${pageNr}`,
      )) as { content: Array<{ id: number | string }>; last: boolean };
      hasNext = !data.last;
      pageNr++;
      pageIds = pageIds.concat(data.content.map((page) => Number(page.id)));
    } while (hasNext);
    return pageIds;
  }

  private async doFetch(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return await response.json();
  }

  private processPageBody(params: { body: string; title: string }): string {
    const textContent = params.body.trim() !== "" ? params.body : params.title;
    return htmlToMarkdown(textContent).text.replace(/\n{3,}/g, "\n\n");
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

export type DrupalWikiConnectorLoad =
  | { success: true; source: ConnectorSource; documents: ConnectorDocument[] }
  | { success: false; reason: string };

export async function loadDrupalWikiConnectorDocuments(params: {
  baseUrl: string;
  spaceIds: string;
  accessToken?: string | null;
  fetchImpl: ConnectorFetch;
}): Promise<DrupalWikiConnectorLoad> {
  if (!params.baseUrl) {
    return {
      success: false,
      reason: "Please provide your baseUrl like https://mywiki.drupal-wiki.net.",
    };
  }
  if (!validBaseUrl(params.baseUrl)) {
    return { success: false, reason: "Provided base URL is not a valid URL." };
  }
  if (!params.spaceIds) {
    return {
      success: false,
      reason: "Please provide a list of spaceIds like 21,56,67 you want to extract",
    };
  }
  if (!params.accessToken) {
    return { success: false, reason: "Please provide a REST API-Token." };
  }
  const drupalWiki = new DrupalWiki({
    baseUrl: params.baseUrl,
    accessToken: params.accessToken,
    fetchImpl: params.fetchImpl,
  });
  const spaceIds = params.spaceIds.split(",").map((idStr) => Number(idStr.trim()));
  const pages: DrupalWikiPage[] = [];
  for (const spaceId of spaceIds) {
    try {
      pages.push(...(await drupalWiki.loadAllPagesForSpace(spaceId)));
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  const { hostname } = new URL(params.baseUrl);
  return {
    success: true,
    source: {
      kind: "drupalwiki",
      id: `drupalwiki:${params.baseUrl}#${spaceIds.join(",")}`,
      label: `${params.baseUrl} DrupalWiki`,
    },
    documents: pages.map((page) => ({
      // Upstream dedupes re-imports by host, space, page and modification time.
      key: `${hostname}.${page.spaceId}.${page.id}`,
      title: page.title,
      content: page.processedBody,
      url: page.url,
      ...(page.created ? { updatedAtMs: Date.parse(page.created) || 0 } : {}),
    })),
  };
}
