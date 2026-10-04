// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/RepoLoader/GithubRepo/RepoLoader/index.js.
// Upstream lists files with @langchain/community's GithubRepoLoader; Branch walks the same REST
// contents API itself (recursive only with a token, as upstream configures that loader).
import ignore, { type Ignore } from "ignore";
import type { ConnectorFetch } from "./fetch.js";
import type { RepoDocument, RepoLoaderArgs } from "./repo-types.js";

const GITHUB_API_VERSION = "2022-11-28";
const LIST_CONCURRENCY = 5;

type ContentsEntry = { type: string; path: string };

export class GitHubRepoLoader {
  ready = false;
  repo: string;
  branch: string | undefined;
  accessToken: string | null;
  readonly ignorePaths: string[];
  private readonly ignoreFilter: Ignore;
  apiBase = "https://api.github.com";
  author: string | null = null;
  project: string | null = null;
  branches: string[] = [];
  private readonly fetchImpl: ConnectorFetch;

  constructor(args: RepoLoaderArgs) {
    this.repo = GitHubRepoLoader.processRepoUrl(args.repo);
    this.branch = args.branch;
    this.accessToken = args.accessToken || null;
    this.ignorePaths = args.ignorePaths ?? [];
    this.ignoreFilter = ignore().add(this.ignorePaths);
    this.fetchImpl = args.fetchImpl;
  }

  /** Removes a `.git` suffix; leaves invalid URLs for validation to reject. */
  private static processRepoUrl(repoUrl: string): string {
    if (!repoUrl) {
      return repoUrl;
    }
    try {
      const url = new URL(repoUrl);
      if (url.pathname.endsWith(".git")) {
        url.pathname = url.pathname.slice(0, -4);
      }
      return url.toString();
    } catch {
      return repoUrl;
    }
  }

  /** github.com, GHE.com data residency, or Enterprise Server `/api/v3`. */
  private resolveApiBase(url: URL): string {
    if (["github.com", "www.github.com"].includes(url.hostname)) {
      return "https://api.github.com";
    }
    if (url.hostname.startsWith("api.")) {
      return url.origin;
    }
    if (url.hostname.endsWith(".ghe.com")) {
      return `${url.protocol}//api.${url.host}`;
    }
    return `${url.origin}/api/v3`;
  }

  private validGithubUrl(): boolean {
    try {
      const url = new URL(this.repo);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return false;
      }
      const [author, project] = url.pathname.slice(1).split("/");
      if (!author || !project) {
        return false;
      }
      this.apiBase = this.resolveApiBase(url);
      this.author = author;
      this.project = project;
      return true;
    } catch {
      return false;
    }
  }

  private authHeaders(): Record<string, string> {
    return this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {};
  }

  private async validBranch(): Promise<void> {
    await this.getRepoBranches();
    if (this.branch && this.branches.includes(this.branch)) {
      return;
    }
    this.branch = this.branches.includes("main") ? "main" : "master";
  }

  private async validateAccessToken(): Promise<void> {
    if (!this.accessToken) {
      return;
    }
    const valid = await this.fetchImpl(`${this.apiBase}/octocat`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    })
      .then((res) => res.ok)
      .catch(() => false);
    if (!valid) {
      this.accessToken = null;
    }
  }

  async init(): Promise<this | undefined> {
    if (!this.validGithubUrl()) {
      return undefined;
    }
    await this.validBranch();
    await this.validateAccessToken();
    this.ready = true;
    return this;
  }

  async recursiveLoader(): Promise<RepoDocument[]> {
    if (!this.ready) {
      throw new Error("[GitHub Loader]: not in ready state!");
    }
    const browseBase = `${new URL(this.repo).origin}/${this.author}/${this.project}/blob/${this.branch}`;
    const paths = await this.listFiles("", Boolean(this.accessToken));
    const docs: RepoDocument[] = [];
    for (let index = 0; index < paths.length; index += LIST_CONCURRENCY) {
      const batch = await Promise.all(
        paths.slice(index, index + LIST_CONCURRENCY).map(async (filePath) => ({
          filePath,
          content: await this.fetchSingleFile(filePath),
        })),
      );
      for (const { filePath, content } of batch) {
        if (content) {
          docs.push({
            pageContent: content,
            metadata: { source: filePath, url: `${browseBase}/${filePath}` },
          });
        }
      }
    }
    return docs;
  }

  private async listFiles(dirPath: string, recursive: boolean): Promise<string[]> {
    const suffix = dirPath ? `/${dirPath}` : "";
    const entries = await this.fetchImpl(
      `${this.apiBase}/repos/${this.author}/${this.project}/contents${suffix}?ref=${this.branch}`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          ...this.authHeaders(),
        },
      },
    )
      .then(async (res) => (res.ok ? ((await res.json()) as unknown) : []))
      .catch(() => []);
    if (!Array.isArray(entries)) {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries as ContentsEntry[]) {
      if (this.ignoreFilter.ignores(entry.type === "dir" ? `${entry.path}/` : entry.path)) {
        continue;
      }
      if (entry.type === "file") {
        files.push(entry.path);
      } else if (entry.type === "dir" && recursive) {
        files.push(...(await this.listFiles(entry.path, recursive)));
      }
    }
    return files;
  }

  private branchPrefSort(branches: string[]): string[] {
    const preferredSort = ["main", "master"];
    return branches.reduce<string[]>(
      (acc, branch) => (preferredSort.includes(branch) ? [branch, ...acc] : [...acc, branch]),
      [],
    );
  }

  async getRepoBranches(): Promise<string[]> {
    if (!this.validGithubUrl() || !this.author || !this.project) {
      return [];
    }
    await this.validateAccessToken();
    let page = 0;
    let polling = true;
    const branches: string[][] = [];
    while (polling) {
      try {
        const res = await this.fetchImpl(
          `${this.apiBase}/repos/${this.author}/${this.project}/branches?per_page=100&page=${page}`,
          {
            method: "GET",
            headers: { ...this.authHeaders(), "X-GitHub-Api-Version": GITHUB_API_VERSION },
          },
        );
        if (!res.ok) {
          throw new Error(`Invalid request to Github API: ${res.statusText}`);
        }
        const branchObjects = (await res.json()) as Array<{ name: string }>;
        polling = branchObjects.length > 0;
        branches.push(branchObjects.map((branch) => branch.name));
        page++;
      } catch {
        polling = false;
      }
    }
    this.branches = [...new Set(branches.flat())];
    return this.branchPrefSort(this.branches);
  }

  async fetchSingleFile(sourceFilePath: string): Promise<string | null> {
    try {
      const res = await this.fetchImpl(
        `${this.apiBase}/repos/${this.author}/${this.project}/contents/${sourceFilePath}?ref=${this.branch}`,
        {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            ...this.authHeaders(),
          },
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch from Github API: ${res.statusText}`);
      }
      const json = (await res.json()) as { status?: unknown; content?: string; message?: string };
      if (Object.hasOwn(json, "status") || typeof json.content !== "string") {
        throw new Error(json?.message || "missing content");
      }
      return new TextDecoder("utf-8").decode(Buffer.from(json.content, "base64"));
    } catch {
      return null;
    }
  }
}
