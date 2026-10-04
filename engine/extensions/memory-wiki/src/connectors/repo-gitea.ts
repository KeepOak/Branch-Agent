// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/RepoLoader/GiteaRepo/RepoLoader/index.js.
import ignore, { type Ignore } from "ignore";
import type { ConnectorFetch } from "./fetch.js";
import type { RepoDocument, RepoLoaderArgs } from "./repo-types.js";

const MAX_RETRIES = 3;

type FileTreeObject = { path: string; type: "blob" | "tree"; sha?: string; size?: number };
type TreePage = { tree?: FileTreeObject[]; truncated?: boolean; total_count?: number };

/** Loads a Gitea repository. Gitea is always self-hosted, so the API base comes from the URL. */
export class GiteaRepoLoader {
  ready = false;
  repo: string;
  branch: string | undefined;
  accessToken: string | null;
  readonly ignorePaths: string[];
  private readonly ignoreFilter: Ignore;
  apiBase: string | null = null;
  scheme: string | null = null;
  author: string | null = null;
  project: string | null = null;
  branches: string[] = [];
  private readonly fetchImpl: ConnectorFetch;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(args: RepoLoaderArgs) {
    this.repo = args.repo;
    this.branch = args.branch;
    this.accessToken = args.accessToken || null;
    this.ignorePaths = args.ignorePaths ?? [];
    this.ignoreFilter = ignore().add(this.ignorePaths);
    this.fetchImpl = args.fetchImpl;
    this.wait = args.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Gitea accepts a personal access token via the `token` scheme; none for public repos. */
  private headers(): Record<string, string> {
    return this.accessToken ? { Authorization: `token ${this.accessToken}` } : {};
  }

  /** Validates `{host}/{author}/{project}` and normalizes the repo URL (no view paths, no .git). */
  private validGiteaUrl(): boolean {
    try {
      const url = new URL(this.repo);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return false;
      }
      const [author, project] = url.pathname.slice(1).split("/");
      if (!author || !project) {
        return false;
      }
      this.scheme = url.protocol.replace(":", "");
      this.apiBase = url.origin;
      this.author = author;
      this.project = project.endsWith(".git") ? project.slice(0, -4) : project;
      this.repo = `${url.origin}/${this.author}/${this.project}`;
      return true;
    } catch {
      return false;
    }
  }

  /** Keeps an existing branch, else the repository default, else main/master. */
  private async validBranch(): Promise<void> {
    await this.getRepoBranches();
    if (this.branch && this.branches.includes(this.branch)) {
      return;
    }
    const defaultBranch = await this.fetchDefaultBranch();
    if (defaultBranch && this.branches.includes(defaultBranch)) {
      this.branch = defaultBranch;
    } else {
      this.branch = this.branches.includes("main") ? "main" : "master";
    }
  }

  private async validateAccessToken(): Promise<void> {
    if (!this.accessToken) {
      return;
    }
    const valid = await this.fetchImpl(`${this.apiBase}/api/v1/user`, {
      method: "GET",
      headers: this.headers(),
    })
      .then((res) => res.ok)
      .catch(() => false);
    if (!valid) {
      this.accessToken = null;
    }
  }

  async init(): Promise<this | undefined> {
    if (!this.validGiteaUrl()) {
      return undefined;
    }
    await this.validBranch();
    await this.validateAccessToken();
    this.ready = true;
    return this;
  }

  async recursiveLoader(): Promise<RepoDocument[]> {
    if (!this.ready) {
      throw new Error("[Gitea Loader]: not in ready state!");
    }
    const docs: RepoDocument[] = [];
    for (const file of await this.fetchFilesRecursive()) {
      if (this.ignoreFilter.ignores(file.path)) {
        continue;
      }
      docs.push({
        pageContent: file.content,
        metadata: {
          source: file.path,
          url: `${this.repo}/src/branch/${this.branch}/${file.path}`,
        },
      });
    }
    return docs;
  }

  /** main/master first. */
  private branchPrefSort(branches: string[]): string[] {
    const preferredSort = ["main", "master"];
    return branches.reduce<string[]>(
      (acc, branch) => (preferredSort.includes(branch) ? [branch, ...acc] : [...acc, branch]),
      [],
    );
  }

  async fetchDefaultBranch(): Promise<string | null> {
    const metadata = (await this.fetchJson(`/repos/${this.author}/${this.project}`)) as {
      default_branch?: string;
    } | null;
    return metadata?.default_branch ?? null;
  }

  async getRepoBranches(): Promise<string[]> {
    if (!this.validGiteaUrl() || !this.author || !this.project) {
      return [];
    }
    await this.validateAccessToken();
    this.branches = [];
    const perPage = 50;
    let page = 1;
    let polling = true;
    while (polling) {
      const branchesPage = await this.fetchJson(
        `/repos/${this.author}/${this.project}/branches?page=${page}&limit=${perPage}`,
      );
      if (!Array.isArray(branchesPage) || !branchesPage.length) {
        break;
      }
      this.branches.push(...branchesPage.map((branch: { name: string }) => branch.name));
      polling = branchesPage.length >= perPage;
      page++;
    }
    this.branches = [...new Set(this.branches)];
    return this.branchPrefSort(this.branches);
  }

  async fetchTreePage(page = 1, perPage = 1000): Promise<TreePage | null> {
    return (await this.fetchJson(
      `/repos/${this.author}/${this.project}/git/trees/${encodeURIComponent(
        this.branch ?? "",
      )}?recursive=true&per_page=${perPage}&page=${page}`,
    )) as TreePage | null;
  }

  async fetchFilesRecursive(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    const perPage = 1000;
    let page = 1;
    let polling = true;
    while (polling) {
      const treePage = await this.fetchTreePage(page, perPage);
      if (!treePage) {
        break;
      }
      const tree = Array.isArray(treePage.tree) ? treePage.tree : [];
      if (!tree.length) {
        break;
      }
      const pageFiles = await Promise.all(
        tree
          .filter((object) => object.type === "blob" && !this.ignoreFilter.ignores(object.path))
          .map(async (object) => {
            const content = await this.fetchSingleFile(object.path);
            return content ? { path: object.path, content } : null;
          }),
      );
      files.push(...pageFiles.filter((item) => item !== null));
      polling = treePage.truncated === true || tree.length >= perPage;
      page++;
    }
    return files;
  }

  async fetchSingleFile(sourceFilePath: string, retries = 0): Promise<string | null> {
    try {
      // Each segment is encoded on its own so the path separators survive.
      const encodedFilePath = String(sourceFilePath)
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      const url = `${this.apiBase}/api/v1/repos/${this.author}/${this.project}/raw/${encodedFilePath}?ref=${encodeURIComponent(this.branch ?? "")}`;
      const response = await this.fetchImpl(url, { method: "GET", headers: this.headers() });
      if (response.status === 429) {
        if (retries >= MAX_RETRIES) {
          return null;
        }
        const retryAfter = Number(response.headers.get("retry-after")) || 60;
        await this.wait(retryAfter * 1000);
        return await this.fetchSingleFile(sourceFilePath, retries + 1);
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch single file ${sourceFilePath} - ${response.status}`);
      }
      return await response.text();
    } catch {
      return null;
    }
  }

  async fetchJson(endpoint: string, retries = 0): Promise<unknown> {
    try {
      const response = await this.fetchImpl(`${this.apiBase}/api/v1${endpoint}`, {
        method: "GET",
        headers: this.headers(),
      });
      if (response.status === 429) {
        if (retries >= MAX_RETRIES) {
          return null;
        }
        const retryAfter = Number(response.headers.get("retry-after")) || 60;
        await this.wait(retryAfter * 1000);
        return await this.fetchJson(endpoint, retries + 1);
      }
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch {
      return null;
    }
  }
}
