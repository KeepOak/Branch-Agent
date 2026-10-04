// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/RepoLoader/GitlabRepo/RepoLoader/index.js, GitlabRepo/index.js (issueToMarkdown).
import ignore, { type Ignore } from "ignore";
import type { ConnectorFetch } from "./fetch.js";
import type { GitlabIssue, GitlabWikiPage, RepoDocument, RepoLoaderArgs } from "./repo-types.js";

const MAX_RETRIES = 3;

type PageRequest = {
  endpoint: string;
  perPage?: number;
  queryParams?: Record<string, string>;
  page?: number;
};

type GitlabNote = { body: string; author: { username: string }; created_at: string };

export class GitLabRepoLoader {
  ready = false;
  repo: string;
  branch: string | undefined;
  accessToken: string | null;
  readonly ignorePaths: string[];
  private readonly ignoreFilter: Ignore;
  readonly withIssues: boolean;
  readonly withWikis: boolean;
  projectId: string | null = null;
  apiBase = "https://gitlab.com";
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
    this.withIssues = args.fetchIssues ?? false;
    this.withWikis = args.fetchWikis ?? false;
    this.fetchImpl = args.fetchImpl;
    this.wait = args.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private headers(): Record<string, string> {
    return this.accessToken ? { "PRIVATE-TOKEN": this.accessToken } : {};
  }

  private validGitlabUrl(): boolean {
    const validPatterns = [
      /https:\/\/gitlab\.com\/(?<author>[^/]+)\/(?<project>.*)/,
      /(http|https):\/\/[^/]+\/(?<author>[^/]+)\/(?<project>.*)/,
    ];
    const match = validPatterns
      .find((pattern) => this.repo.match(pattern)?.groups)
      ?.exec(this.repo);
    if (!match?.groups) {
      return false;
    }
    const author = match.groups.author ?? "";
    const project = match.groups.project ?? "";
    // GitLab puts `/-/` between a project path and its views and forbids a `.git` suffix.
    const segments = project.replace(/[?#].*$/, "").split("/");
    const separator = segments.indexOf("-");
    const projectPath = (separator === -1 ? segments : segments.slice(0, separator))
      .filter(Boolean)
      .join("/")
      .replace(/\.git$/, "");
    if (!projectPath) {
      return false;
    }
    const { origin } = new URL(this.repo);
    this.repo = `${origin}/${author}/${projectPath}`;
    this.projectId = encodeURIComponent(`${author}/${projectPath}`);
    this.apiBase = origin;
    this.author = author;
    this.project = projectPath;
    return true;
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
    try {
      const res = await this.fetchImpl(`${this.apiBase}/api/v4/user`, {
        method: "GET",
        headers: this.headers(),
      });
      if (!res.ok) {
        throw new Error(res.statusText || `HTTP ${res.status}`);
      }
    } catch {
      this.accessToken = null;
    }
  }

  async init(): Promise<this | undefined> {
    if (!this.validGitlabUrl()) {
      return undefined;
    }
    await this.validBranch();
    await this.validateAccessToken();
    this.ready = true;
    return this;
  }

  async recursiveLoader(): Promise<RepoDocument[]> {
    if (!this.ready) {
      throw new Error("[Gitlab Loader]: not in ready state!");
    }
    const docs: RepoDocument[] = [];
    for (const file of await this.fetchFilesRecursive()) {
      if (this.ignoreFilter.ignores(file.path)) {
        continue;
      }
      docs.push({
        pageContent: file.content,
        metadata: { source: file.path, url: `${this.repo}/-/blob/${this.branch}/${file.path}` },
      });
    }
    if (this.withIssues) {
      const issues = await this.fetchIssues();
      docs.push(
        ...issues.map((issue) => ({
          issue,
          metadata: { source: `issue-${this.repo}-${issue.iid}`, url: issue.web_url ?? "" },
        })),
      );
    }
    if (this.withWikis) {
      const wiki = await this.fetchWiki();
      docs.push(
        ...wiki.map((page) => ({
          wiki: page,
          metadata: {
            source: `wiki-${this.repo}-${page.slug}`,
            url: `${this.repo}/-/wikis/${page.slug}`,
          },
        })),
      );
    }
    return docs;
  }

  private branchPrefSort(branches: string[]): string[] {
    const preferredSort = ["main", "master"];
    return branches.reduce<string[]>(
      (acc, branch) => (preferredSort.includes(branch) ? [branch, ...acc] : [...acc, branch]),
      [],
    );
  }

  async getRepoBranches(): Promise<string[]> {
    if (!this.validGitlabUrl() || !this.projectId) {
      return [];
    }
    await this.validateAccessToken();
    this.branches = [];
    const request: PageRequest = {
      endpoint: `/api/v4/projects/${this.projectId}/repository/branches`,
    };
    let branchesPage: unknown[] | null;
    while ((branchesPage = await this.fetchNextPage(request))) {
      if (!Array.isArray(branchesPage) || !branchesPage.length) {
        break;
      }
      this.branches.push(...branchesPage.map((branch) => (branch as { name: string }).name));
    }
    return this.branchPrefSort(this.branches);
  }

  async fetchFilesRecursive(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    const request: PageRequest = {
      endpoint: `/api/v4/projects/${this.projectId}/repository/tree`,
      queryParams: { ref: this.branch ?? "", recursive: "true" },
    };
    let filesPage: unknown[] | null;
    while ((filesPage = await this.fetchNextPage(request))) {
      if (!Array.isArray(filesPage) || !filesPage.length) {
        break;
      }
      const pageFiles = await Promise.all(
        (filesPage as Array<{ type: string; path: string }>)
          .filter((file) => file.type === "blob" && !this.ignoreFilter.ignores(file.path))
          .map(async (file) => {
            const content = await this.fetchSingleFileContents(file.path);
            return content ? { path: file.path, content } : null;
          }),
      );
      files.push(...pageFiles.filter((item) => item !== null));
    }
    return files;
  }

  private async fetchIssueDiscussions(issueId: number | string): Promise<string[][]> {
    const request: PageRequest = {
      endpoint: `/api/v4/projects/${this.projectId}/issues/${issueId}/discussions`,
    };
    const discussions: string[][] = [];
    let discussionPage: unknown[] | null;
    while ((discussionPage = await this.fetchNextPage(request))) {
      if (!Array.isArray(discussionPage) || !discussionPage.length) {
        break;
      }
      discussions.push(
        ...(discussionPage as Array<{ notes: GitlabNote[] }>).map(({ notes }) =>
          notes.map(
            ({ body, author, created_at }) => `${author.username} at ${created_at}:\n${body}`,
          ),
        ),
      );
    }
    return discussions;
  }

  async fetchIssues(): Promise<GitlabIssue[]> {
    const issues: GitlabIssue[] = [];
    const request: PageRequest = { endpoint: `/api/v4/projects/${this.projectId}/issues` };
    let issuesPage: unknown[] | null;
    while ((issuesPage = await this.fetchNextPage(request))) {
      if (!Array.isArray(issuesPage) || !issuesPage.length) {
        break;
      }
      const pageIssues = await Promise.all(
        (issuesPage as GitlabIssue[]).map(async (issue) => ({
          ...issue,
          discussions: await this.fetchIssueDiscussions(issue.iid),
        })),
      );
      issues.push(...pageIssues);
    }
    return issues;
  }

  async fetchSingleIssue(issueId: number | string): Promise<GitlabIssue | null> {
    try {
      const url = `${this.apiBase}/api/v4/projects/${this.projectId}/issues/${issueId}`;
      const response = await this.fetchImpl(url, { method: "GET", headers: this.headers() });
      if (!response.ok) {
        throw new Error(`Failed to fetch single issue ${issueId}`);
      }
      const issue = (await response.json()) as GitlabIssue;
      return { ...issue, discussions: await this.fetchIssueDiscussions(issueId) };
    } catch {
      return null;
    }
  }

  async fetchWiki(): Promise<GitlabWikiPage[]> {
    const wikiPages = await this.fetchNextPage({
      endpoint: `/api/v4/projects/${this.projectId}/wikis`,
      queryParams: { with_content: "1" },
    });
    return Array.isArray(wikiPages) ? (wikiPages as GitlabWikiPage[]) : [];
  }

  async fetchSingleFileContents(sourceFilePath: string, retries = 0): Promise<string | null> {
    try {
      const url = `${this.apiBase}/api/v4/projects/${this.projectId}/repository/files/${encodeURIComponent(sourceFilePath)}/raw?ref=${this.branch}`;
      const response = await this.fetchImpl(url, { method: "GET", headers: this.headers() });
      if (response.status === 429) {
        if (retries >= MAX_RETRIES) {
          return null;
        }
        const retryAfter = Number(response.headers.get("retry-after")) || 60;
        await this.wait(retryAfter * 1000);
        return await this.fetchSingleFileContents(sourceFilePath, retries + 1);
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch single file ${sourceFilePath}`);
      }
      return await response.text();
    } catch {
      return null;
    }
  }

  async fetchNextPage(requestData: PageRequest, retries = 0): Promise<unknown[] | null> {
    try {
      if (requestData.page === -1) {
        return null;
      }
      if (!requestData.page) {
        requestData.page = 1;
      }
      const { endpoint, perPage = 100, queryParams = {} } = requestData;
      const params = new URLSearchParams({
        ...queryParams,
        per_page: String(perPage),
        page: String(requestData.page),
      });
      const response = await this.fetchImpl(`${this.apiBase}${endpoint}?${params.toString()}`, {
        method: "GET",
        headers: this.headers(),
      });
      if (response.status === 429) {
        if (retries >= MAX_RETRIES) {
          return null;
        }
        const retryAfter = Number(response.headers.get("retry-after")) || 60;
        await this.wait(retryAfter * 1000);
        return await this.fetchNextPage(requestData, retries + 1);
      }
      if (response.status === 401 || !response.ok) {
        return null;
      }
      const data: unknown = await response.json();
      if (!Array.isArray(data)) {
        return [];
      }
      // GitLab omits x-total-pages for large repos; x-next-page is empty on the last page.
      const nextPage = response.headers.get("x-next-page");
      requestData.page = nextPage?.trim() ? Number(nextPage) : -1;
      return data;
    } catch {
      return null;
    }
  }
}

export function issueToMarkdown(issue: GitlabIssue): string {
  const metadata: Record<string, unknown> = {};
  const userToUsername = ({ username }: { username: string }) => username;
  for (const userField of ["author", "assignees", "closed_by"] as const) {
    const value = issue[userField];
    if (value) {
      metadata[userField] = Array.isArray(value)
        ? value.map(userToUsername)
        : userToUsername(value as { username: string });
    }
  }
  const singleValueFields = [
    "web_url",
    "state",
    "created_at",
    "updated_at",
    "closed_at",
    "due_date",
    "type",
    "merge_request_count",
    "upvotes",
    "downvotes",
    "labels",
    "has_tasks",
    "task_status",
    "confidential",
    "severity",
  ];
  for (const field of singleValueFields) {
    metadata[field] = issue[field];
  }
  if (issue.milestone) {
    metadata.milestone = `${issue.milestone.title} (${issue.milestone.id})`;
  }
  if (issue.time_stats) {
    for (const timeField of ["time_estimate", "total_time_spent"]) {
      const value = issue.time_stats[`human_${timeField}`];
      if (value) {
        metadata[timeField] = value;
      }
    }
  }
  const metadataString = Object.entries(metadata)
    .map(([name, value]) => {
      if (!value || (Array.isArray(value) && value.length < 1)) {
        return null;
      }
      const label = `- ${name.replace("_", " ")}:`;
      return Array.isArray(value)
        ? `${label}\n${value.map((entry) => `  - ${String(entry)}`).join("\n")}`
        : `${label} ${String(value)}`;
    })
    .filter((item) => item !== null)
    .join("\n");
  let markdown = `# ${issue.title} (${issue.iid})\n\n${issue.description}\n\n## Metadata\n\n${metadataString}`;
  if (issue.discussions.length > 0) {
    markdown += `\n\n## Activity\n\n${issue.discussions.map(String).join("\n\n")}\n`;
  }
  return markdown;
}
