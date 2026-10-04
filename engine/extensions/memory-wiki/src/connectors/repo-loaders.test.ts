// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/__tests__/utils/extensions/RepoLoader/GiteaRepo.test.js, GitlabRepo.test.js, GithubRepo.test.js.
// The fake APIs key off the endpoint path only and are injected as the loader's fetch.
import { describe, expect, it, vi } from "vitest";
import type { ConnectorFetch } from "./fetch.js";
import { GiteaRepoLoader } from "./repo-gitea.js";
import { GitHubRepoLoader } from "./repo-github.js";
import { GitLabRepoLoader, issueToMarkdown } from "./repo-gitlab.js";
import type { GitlabIssue } from "./repo-types.js";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers });
const text = (body: string) => new Response(body, { status: 200 });
const error = (status: number) => new Response("", { status });

type FetchMock = ReturnType<typeof vi.fn<ConnectorFetch>>;
const requestedUrls = (fetchMock: FetchMock) => fetchMock.mock.calls.map(([url]) => url);
const requestedHeaders = (fetchMock: FetchMock) =>
  fetchMock.mock.calls.map(([, init]) => init?.headers ?? {});
const noWait = async () => {};

function mockGiteaApi(
  options: {
    branches?: Array<{ name: string }>;
    branchStatus?: number;
    tree?: Array<{ type: string; path: string }>;
    treeStatus?: number;
    files?: Record<string, string>;
    defaultBranch?: string;
    repoStatus?: number;
    userStatus?: number;
  } = {},
): FetchMock {
  const {
    branches = [{ name: "main" }],
    branchStatus = 200,
    tree = [],
    treeStatus = 200,
    files = {},
    defaultBranch = "main",
    repoStatus = 200,
    userStatus = 200,
  } = options;
  return vi.fn<ConnectorFetch>(async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/user") {
      return userStatus === 200 ? json({ login: "tester" }) : error(userStatus);
    }
    if (pathname.endsWith("/branches")) {
      if (branchStatus !== 200) {
        return error(branchStatus);
      }
      return json(Number(searchParams.get("page")) === 1 ? branches : []);
    }
    if (pathname.includes("/git/trees/")) {
      if (treeStatus !== 200) {
        return error(treeStatus);
      }
      const page = Number(searchParams.get("page"));
      return json({ tree: page === 1 ? tree : [], truncated: false, total_count: tree.length });
    }
    if (pathname.includes("/raw/")) {
      const filePath = decodeURIComponent(pathname.split("/raw/")[1] ?? "");
      return filePath in files ? text(files[filePath] ?? "") : error(404);
    }
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) {
      return repoStatus === 200 ? json({ default_branch: defaultBranch }) : error(repoStatus);
    }
    return error(404);
  });
}

describe("GiteaRepoLoader url parsing", () => {
  it("derives apiBase, author, and project from a self-hosted url", async () => {
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      fetchImpl: mockGiteaApi(),
    });
    await loader.init();
    expect(loader.ready).toBe(true);
    expect(loader.apiBase).toBe("https://git.example.com");
    expect(loader.scheme).toBe("https");
    expect(loader.author).toBe("acme");
    expect(loader.project).toBe("widgets");
    expect(loader.repo).toBe("https://git.example.com/acme/widgets");
  });

  it("preserves a non-standard port and the http scheme in apiBase", async () => {
    const fetchMock = mockGiteaApi();
    const loader = new GiteaRepoLoader({
      repo: "http://git.example.com:3000/acme/widgets",
      fetchImpl: fetchMock,
    });
    await loader.init();
    expect(loader.apiBase).toBe("http://git.example.com:3000");
    expect(loader.scheme).toBe("http");
    expect(requestedUrls(fetchMock).length).toBeGreaterThan(0);
    for (const url of requestedUrls(fetchMock)) {
      expect(url.startsWith("http://git.example.com:3000/api/v1/")).toBe(true);
    }
  });

  it("strips a .git suffix and extra path segments", async () => {
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets.git",
      fetchImpl: mockGiteaApi(),
    });
    await loader.init();
    expect(loader.project).toBe("widgets");
    const deep = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets/src/branch/main/README.md",
      fetchImpl: mockGiteaApi(),
    });
    await deep.init();
    expect(deep.repo).toBe("https://git.example.com/acme/widgets");
  });

  it.each(["not-a-url", "https://git.example.com/acme", "ssh://git.example.com/acme/widgets"])(
    "leaves the loader un-ready for %s without api calls",
    async (repo) => {
      const fetchMock = mockGiteaApi();
      const loader = new GiteaRepoLoader({ repo, fetchImpl: fetchMock });
      await loader.init();
      expect(loader.ready).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("GiteaRepoLoader branch resolution", () => {
  it("keeps an explicitly provided branch that exists and skips the metadata lookup", async () => {
    const fetchMock = mockGiteaApi({ branches: [{ name: "main" }, { name: "develop" }] });
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      branch: "develop",
      fetchImpl: fetchMock,
    });
    await loader.init();
    expect(loader.branch).toBe("develop");
    expect(requestedUrls(fetchMock)).not.toContain(
      "https://git.example.com/api/v1/repos/acme/widgets",
    );
  });

  it("auto-assigns the repository default branch when no branch is given", async () => {
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      fetchImpl: mockGiteaApi({ branches: [{ name: "main" }, { name: "trunk" }], defaultBranch: "trunk" }),
    });
    await loader.init();
    expect(loader.branch).toBe("trunk");
  });

  it("falls back to main, then master, when the metadata cannot be read", async () => {
    const main = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      fetchImpl: mockGiteaApi({ branches: [{ name: "main" }, { name: "legacy" }], repoStatus: 404 }),
    });
    await main.init();
    expect(main.branch).toBe("main");
    const master = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      fetchImpl: mockGiteaApi({ branches: [{ name: "master" }], repoStatus: 500 }),
    });
    await master.init();
    expect(master.branch).toBe("master");
  });

  it("getRepoBranches sorts main to the front and returns every branch", async () => {
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      fetchImpl: mockGiteaApi({
        branches: [{ name: "legacy" }, { name: "main" }, { name: "release" }],
      }),
    });
    const branches = await loader.getRepoBranches();
    expect(branches[0]).toBe("main");
    expect(branches.toSorted()).toEqual(["legacy", "main", "release"]);
  });
});

describe("GiteaRepoLoader authorization and files", () => {
  it("sends a Gitea token header on every request when a PAT is provided", async () => {
    const fetchMock = mockGiteaApi({
      tree: [{ type: "blob", path: "README.md" }],
      files: { "README.md": "# hello" },
    });
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      accessToken: "pat_abc123",
      fetchImpl: fetchMock,
    });
    await loader.init();
    await loader.recursiveLoader();
    expect(requestedUrls(fetchMock)).toContain("https://git.example.com/api/v1/user");
    for (const headers of requestedHeaders(fetchMock)) {
      expect(headers).toEqual({ Authorization: "token pat_abc123" });
    }
  });

  it("drops an access token the instance rejects", async () => {
    const fetchMock = mockGiteaApi({ userStatus: 401 });
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      accessToken: "pat_expired",
      fetchImpl: fetchMock,
    });
    await loader.init();
    expect(loader.accessToken).toBeNull();
    await loader.fetchSingleFile("README.md");
    expect(requestedHeaders(fetchMock).pop()).toEqual({});
  });

  it("loads every blob, skips ignored paths without requesting them, and encodes segments", async () => {
    const fetchMock = mockGiteaApi({
      tree: [
        { type: "tree", path: "src" },
        { type: "blob", path: "docs/my notes.md" },
        { type: "blob", path: "README.md" },
        { type: "blob", path: "yarn.lock" },
        { type: "blob", path: "node_modules/left-pad/index.js" },
      ],
      files: {
        "docs/my notes.md": "notes",
        "README.md": "# widgets",
        "yarn.lock": "lockfile",
        "node_modules/left-pad/index.js": "module.exports = {};",
      },
    });
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      branch: "main",
      ignorePaths: ["node_modules/**", "*.lock"],
      fetchImpl: fetchMock,
    });
    await loader.init();
    const docs = await loader.recursiveLoader();
    expect(docs.map((doc) => doc.metadata.source).toSorted()).toEqual([
      "README.md",
      "docs/my notes.md",
    ]);
    expect(docs.find((doc) => doc.metadata.source === "README.md")?.metadata.url).toBe(
      "https://git.example.com/acme/widgets/src/branch/main/README.md",
    );
    const rawRequests = requestedUrls(fetchMock).filter((url) => url.includes("/raw/"));
    expect(rawRequests).toHaveLength(2);
    expect(rawRequests).toContain(
      "https://git.example.com/api/v1/repos/acme/widgets/raw/docs/my%20notes.md?ref=main",
    );
  });

  it("turns failing requests into empty results instead of throwing", async () => {
    const loader = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      branch: "main",
      fetchImpl: mockGiteaApi({ treeStatus: 500 }),
    });
    await loader.init();
    await expect(loader.recursiveLoader()).resolves.toEqual([]);
    await expect(loader.fetchSingleFile("does-not-exist.md")).resolves.toBeNull();
    const offline = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      fetchImpl: vi.fn<ConnectorFetch>(async () => {
        throw new Error("ECONNREFUSED git.example.com");
      }),
    });
    await expect(offline.fetchJson("/repos/acme/widgets")).resolves.toBeNull();
    const notReady = new GiteaRepoLoader({
      repo: "https://git.example.com/acme/widgets",
      fetchImpl: mockGiteaApi(),
    });
    await expect(notReady.recursiveLoader()).rejects.toThrow("not in ready state");
  });
});

function mockGitlabApi(
  options: {
    branches?: Array<{ name: string }>;
    tree?: Array<{ type: string; path: string }>;
    files?: Record<string, string>;
    userStatus?: number;
    issues?: Array<Record<string, unknown>>;
    discussions?: Record<string, unknown[]>;
    wikis?: unknown;
    wikiStatus?: number;
    rateLimitOnce?: string[];
    rateLimitAlways?: string[];
  } = {},
): FetchMock {
  const {
    branches = [{ name: "main" }],
    tree = [],
    files = {},
    userStatus = 200,
    issues = [],
    discussions = {},
    wikis = [],
    wikiStatus = 200,
    rateLimitOnce = [],
    rateLimitAlways = [],
  } = options;
  const pending = new Set(rateLimitOnce);
  return vi.fn<ConnectorFetch>(async (url) => {
    const { pathname, searchParams } = new URL(url);
    const firstPage = Number(searchParams.get("page")) === 1;
    const rateLimited = () => new Response("", { status: 429, headers: { "retry-after": "0.001" } });
    if (rateLimitAlways.some((suffix) => pathname.endsWith(suffix))) {
      return rateLimited();
    }
    const limited = [...pending].find((suffix) => pathname.endsWith(suffix));
    if (limited) {
      pending.delete(limited);
      return rateLimited();
    }
    if (pathname === "/api/v4/user") {
      return userStatus === 200 ? json({ username: "tester" }) : error(userStatus);
    }
    if (pathname.endsWith("/repository/branches")) {
      return json(firstPage ? branches : []);
    }
    if (pathname.endsWith("/repository/tree")) {
      return json(firstPage ? tree : []);
    }
    const discussion = pathname.match(/\/issues\/(\d+)\/discussions$/);
    if (discussion) {
      return json(firstPage ? (discussions[discussion[1] ?? ""] ?? []) : []);
    }
    if (pathname.endsWith("/issues")) {
      return json(firstPage ? issues : []);
    }
    if (pathname.endsWith("/wikis")) {
      return wikiStatus === 200 ? json(wikis) : error(wikiStatus);
    }
    const raw = pathname.match(/\/repository\/files\/(.+)\/raw$/);
    if (raw) {
      const filePath = decodeURIComponent(raw[1] ?? "");
      return filePath in files ? text(files[filePath] ?? "") : error(404);
    }
    return error(404);
  });
}

describe("GitLabRepoLoader", () => {
  it("resolves gitlab.com and self-hosted urls (port and scheme kept, views stripped)", async () => {
    const hosted = new GitLabRepoLoader({
      repo: "https://gitlab.com/acme/widgets",
      fetchImpl: mockGitlabApi(),
    });
    await hosted.init();
    expect(hosted.ready).toBe(true);
    expect(hosted.apiBase).toBe("https://gitlab.com");
    expect(hosted.projectId).toBe(encodeURIComponent("acme/widgets"));

    const fetchMock = mockGitlabApi();
    const selfHosted = new GitLabRepoLoader({
      repo: "http://gitlab.example.com:8080/acme/sub/widgets.git/-/tree/main",
      fetchImpl: fetchMock,
    });
    await selfHosted.init();
    expect(selfHosted.apiBase).toBe("http://gitlab.example.com:8080");
    expect(selfHosted.project).toBe("sub/widgets");
    expect(selfHosted.repo).toBe("http://gitlab.example.com:8080/acme/sub/widgets");
    for (const url of requestedUrls(fetchMock)) {
      expect(url.startsWith("http://gitlab.example.com:8080/api/v4/")).toBe(true);
    }
  });

  it.each(["not-a-url", "https://gitlab.example.com/acme", "ssh://gitlab.example.com/acme/widgets"])(
    "leaves the loader un-ready for %s",
    async (repo) => {
      const fetchMock = mockGitlabApi();
      const loader = new GitLabRepoLoader({ repo, fetchImpl: fetchMock });
      await loader.init();
      expect(loader.ready).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("keeps an existing branch, else main, else master", async () => {
    const develop = new GitLabRepoLoader({
      repo: "https://gitlab.com/acme/widgets",
      branch: "develop",
      fetchImpl: mockGitlabApi({ branches: [{ name: "main" }, { name: "develop" }] }),
    });
    await develop.init();
    expect(develop.branch).toBe("develop");
    const master = new GitLabRepoLoader({
      repo: "https://gitlab.com/acme/widgets",
      branch: "nope",
      fetchImpl: mockGitlabApi({ branches: [{ name: "master" }] }),
    });
    await master.init();
    expect(master.branch).toBe("master");
  });

  it("sends the PAT as PRIVATE-TOKEN and drops a token rejected with 401", async () => {
    const fetchMock = mockGitlabApi();
    const loader = new GitLabRepoLoader({
      repo: "https://gitlab.com/acme/widgets",
      accessToken: "glpat-abc",
      fetchImpl: fetchMock,
    });
    await loader.init();
    for (const headers of requestedHeaders(fetchMock)) {
      expect(headers).toEqual({ "PRIVATE-TOKEN": "glpat-abc" });
    }
    const rejected = new GitLabRepoLoader({
      repo: "https://gitlab.com/acme/widgets",
      accessToken: "glpat-old",
      fetchImpl: mockGitlabApi({ userStatus: 401 }),
    });
    await rejected.init();
    expect(rejected.ready).toBe(true);
    expect(rejected.accessToken).toBeNull();
  });

  it("loads every blob with a browsable url and honours ignorePaths", async () => {
    const fetchMock = mockGitlabApi({
      tree: [
        { type: "blob", path: "README.md" },
        { type: "blob", path: "dist/app.js" },
      ],
      files: { "README.md": "# widgets", "dist/app.js": "bundle" },
    });
    const loader = new GitLabRepoLoader({
      repo: "https://gitlab.example.com/acme/widgets",
      branch: "main",
      ignorePaths: ["dist/"],
      fetchImpl: fetchMock,
    });
    await loader.init();
    const docs = await loader.recursiveLoader();
    expect(docs).toEqual([
      {
        pageContent: "# widgets",
        metadata: {
          source: "README.md",
          url: "https://gitlab.example.com/acme/widgets/-/blob/main/README.md",
        },
      },
    ]);
    expect(requestedUrls(fetchMock).some((url) => url.includes("dist%2Fapp.js"))).toBe(false);
  });

  const issue = {
    iid: 7,
    title: "Widgets fall over",
    description: "They should not.",
    web_url: "https://gitlab.example.com/acme/widgets/-/issues/7",
    state: "opened",
    author: { username: "alice" },
  };
  const discussions = {
    7: [
      {
        notes: [
          { body: "Reproduced on main.", author: { username: "bob" }, created_at: "2024-01-01T00:00:00Z" },
          { body: "Fix incoming.", author: { username: "alice" }, created_at: "2024-01-02T00:00:00Z" },
        ],
      },
    ],
  };

  it("requests issues only with fetchIssues and attaches every discussion note", async () => {
    const without = mockGitlabApi({ issues: [issue], discussions });
    const plain = new GitLabRepoLoader({
      repo: "https://gitlab.example.com/acme/widgets",
      branch: "main",
      fetchImpl: without,
    });
    await plain.init();
    expect(await plain.recursiveLoader()).toEqual([]);
    expect(requestedUrls(without).some((url) => url.includes("/issues"))).toBe(false);

    const loader = new GitLabRepoLoader({
      repo: "https://gitlab.example.com/acme/widgets",
      branch: "main",
      fetchIssues: true,
      fetchImpl: mockGitlabApi({ issues: [issue], discussions }),
    });
    await loader.init();
    const docs = await loader.recursiveLoader();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.pageContent).toBeUndefined();
    expect(docs[0]?.issue?.discussions.flat()).toEqual([
      "bob at 2024-01-01T00:00:00Z:\nReproduced on main.",
      "alice at 2024-01-02T00:00:00Z:\nFix incoming.",
    ]);
    expect(docs[0]?.metadata).toEqual({
      source: "issue-https://gitlab.example.com/acme/widgets-7",
      url: "https://gitlab.example.com/acme/widgets/-/issues/7",
    });
  });

  it("wraps wiki pages by slug and treats odd or unauthorized wiki responses as empty", async () => {
    const loader = new GitLabRepoLoader({
      repo: "https://gitlab.example.com/acme/widgets",
      branch: "main",
      fetchWikis: true,
      fetchImpl: mockGitlabApi({
        wikis: [{ slug: "home", title: "Home", content: "Welcome", format: "markdown" }],
      }),
    });
    await loader.init();
    const docs = await loader.recursiveLoader();
    expect(docs[0]?.metadata).toEqual({
      source: "wiki-https://gitlab.example.com/acme/widgets-home",
      url: "https://gitlab.example.com/acme/widgets/-/wikis/home",
    });
    for (const fetchImpl of [mockGitlabApi({ wikis: { pages: [] } }), mockGitlabApi({ wikiStatus: 401 })]) {
      const odd = new GitLabRepoLoader({ repo: "https://gitlab.example.com/acme/widgets", fetchImpl });
      await odd.init();
      expect(await odd.fetchWiki()).toEqual([]);
    }
  });

  it("retries a single 429 and gives up after the retry budget", async () => {
    const wait = vi.fn(noWait);
    const once = new GitLabRepoLoader({
      repo: "https://gitlab.example.com/acme/widgets",
      branch: "main",
      wait,
      fetchImpl: mockGitlabApi({ files: { "README.md": "# widgets" }, rateLimitOnce: ["/raw"] }),
    });
    await once.init();
    await expect(once.fetchSingleFileContents("README.md")).resolves.toBe("# widgets");
    expect(wait).toHaveBeenCalledTimes(1);

    const always = new GitLabRepoLoader({
      repo: "https://gitlab.example.com/acme/widgets",
      branch: "main",
      wait: noWait,
      fetchImpl: mockGitlabApi({ files: { "README.md": "# widgets" }, rateLimitAlways: ["/raw"] }),
    });
    await always.init();
    await expect(always.fetchSingleFileContents("README.md")).resolves.toBeNull();
  });
});

describe("issueToMarkdown", () => {
  const base: GitlabIssue = {
    iid: 7,
    title: "Widgets fall over",
    description: "They should not.",
    web_url: "https://gitlab.example.com/acme/widgets/-/issues/7",
    state: "opened",
    created_at: "2024-01-01T00:00:00Z",
    discussions: [],
  };

  it("renders the title, description and scalar metadata", () => {
    const markdown = issueToMarkdown(base);
    expect(markdown.startsWith("# Widgets fall over (7)\n\nThey should not.\n")).toBe(true);
    expect(markdown).toContain("- web url: https://gitlab.example.com/acme/widgets/-/issues/7");
    expect(markdown).toContain("- created at: 2024-01-01T00:00:00Z");
    expect(markdown).not.toContain("## Activity");
  });

  it("collapses users to usernames, lists arrays, and omits empty values", () => {
    const markdown = issueToMarkdown({
      ...base,
      author: { username: "alice", name: "Alice" },
      assignees: [{ username: "bob" }, { username: "carol" }],
      closed_by: { username: "dave" },
      closed_at: null,
      labels: [],
    });
    expect(markdown).toContain("- author: alice");
    expect(markdown).toContain("- assignees:\n  - bob\n  - carol");
    expect(markdown).toContain("- closed by: dave");
    expect(markdown).not.toContain("Alice");
    expect(markdown).not.toContain("closed at");
    expect(markdown).not.toContain("labels");
  });

  it("includes milestone and human time stats, and discussions under Activity", () => {
    const markdown = issueToMarkdown({
      ...base,
      milestone: { id: 3, title: "v1.0" },
      time_stats: { time_estimate: 3600, human_time_estimate: "1h", human_total_time_spent: "30m" },
      discussions: ["bob at 2024-01-01T00:00:00Z:\nReproduced on main.", "alice at 2024-01-02T00:00:00Z:\nFix incoming."],
    });
    expect(markdown).toContain("- milestone: v1.0 (3)");
    expect(markdown).toContain("- time estimate: 1h");
    expect(markdown).toContain("- total time_spent: 30m");
    expect(markdown).not.toContain("3600");
    expect(markdown).toContain(
      "## Activity\n\nbob at 2024-01-01T00:00:00Z:\nReproduced on main.\n\nalice at 2024-01-02T00:00:00Z:\nFix incoming.",
    );
  });
});

function mockGithubApi(
  options: {
    branches?: Array<{ name: string }>;
    files?: Record<string, string>;
    dirs?: Record<string, Array<{ type: string; path: string }>>;
    octocatStatus?: number;
  } = {},
): FetchMock {
  const { branches = [{ name: "main" }], files = {}, dirs = {}, octocatStatus = 200 } = options;
  return vi.fn<ConnectorFetch>(async (url) => {
    const { pathname, searchParams } = new URL(url);
    const endpoint = pathname.replace(/^\/api\/v3/, "");
    if (endpoint === "/octocat") {
      return octocatStatus === 200 ? json({}) : error(octocatStatus);
    }
    if (endpoint.endsWith("/branches")) {
      return json(Number(searchParams.get("page")) === 0 ? branches : []);
    }
    const contents = endpoint.match(/\/repos\/[^/]+\/[^/]+\/contents\/?(.*)$/);
    if (contents) {
      const target = decodeURIComponent(contents[1] ?? "");
      if (target in dirs) {
        return json(dirs[target]);
      }
      if (target in files) {
        // The contents API wraps base64 at 60 characters.
        return json({
          content: Buffer.from(files[target] ?? "")
            .toString("base64")
            .replace(/.{60}/g, "$&\n"),
        });
      }
      return error(404);
    }
    return error(404);
  });
}

describe("GitHubRepoLoader", () => {
  it.each([
    ["https://github.com/Mintplex-Labs/anything-llm", "https://api.github.com"],
    ["https://www.github.com/org/repo", "https://api.github.com"],
    ["https://github.acme.corp/org/repo", "https://github.acme.corp/api/v3"],
    ["http://github.acme.corp:8080/org/repo", "http://github.acme.corp:8080/api/v3"],
    ["https://octo.ghe.com/org/repo", "https://api.octo.ghe.com"],
    ["https://api.github.acme.corp/org/repo", "https://api.github.acme.corp"],
  ])("resolves %s to the %s api root", async (repo, apiBase) => {
    const loader = new GitHubRepoLoader({ repo, fetchImpl: mockGithubApi() });
    await loader.init();
    expect(loader.ready).toBe(true);
    expect(loader.apiBase).toBe(apiBase);
  });

  it("strips .git and ignores extra path segments", async () => {
    const loader = new GitHubRepoLoader({
      repo: "https://github.acme.corp/org/repo.git",
      fetchImpl: mockGithubApi(),
    });
    await loader.init();
    expect(loader.project).toBe("repo");
    const deep = new GitHubRepoLoader({
      repo: "https://github.com/org/repo/tree/main/docs",
      fetchImpl: mockGithubApi(),
    });
    await deep.init();
    expect([deep.author, deep.project]).toEqual(["org", "repo"]);
  });

  it.each(["https://github.com/org", "ftp://github.com/org/repo", "not a url"])(
    "leaves the loader un-ready for %s",
    async (repo) => {
      const fetchMock = mockGithubApi();
      const loader = new GitHubRepoLoader({ repo, fetchImpl: fetchMock });
      await loader.init();
      expect(loader.ready).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("drops a rejected token and validates nothing without one", async () => {
    const rejected = new GitHubRepoLoader({
      repo: "https://github.acme.corp/org/repo",
      accessToken: "ghp_old",
      fetchImpl: mockGithubApi({ octocatStatus: 401 }),
    });
    await rejected.init();
    expect(rejected.ready).toBe(true);
    expect(rejected.accessToken).toBeNull();
    const fetchMock = mockGithubApi();
    const anonymous = new GitHubRepoLoader({ repo: "https://github.com/org/repo", fetchImpl: fetchMock });
    await anonymous.init();
    expect(requestedUrls(fetchMock).some((url) => url.endsWith("/octocat"))).toBe(false);
  });

  it.each([
    ["accented, CJK, and astral characters", "café 日本語 😀"],
    ["a multi-byte character straddling a base64 line break", `${"a".repeat(44)}é${"b".repeat(40)}`],
    ["plain ascii", "hello world"],
  ])("decodes %s from the contents api", async (_label, content) => {
    const loader = new GitHubRepoLoader({
      repo: "https://github.com/org/repo",
      fetchImpl: mockGithubApi({ files: { "a.md": content } }),
    });
    await loader.init();
    expect(await loader.fetchSingleFile("a.md")).toBe(content);
  });

  it("drops a leading byte order mark", async () => {
    const loader = new GitHubRepoLoader({
      repo: "https://github.com/org/repo",
      fetchImpl: mockGithubApi({ files: { "a.md": "\uFEFFhello" } }),
    });
    await loader.init();
    expect(await loader.fetchSingleFile("a.md")).toBe("hello");
  });

  it("lists top-level files without a token and recurses with one, honouring ignorePaths", async () => {
    const options = {
      dirs: {
        "": [
          { type: "file", path: "README.md" },
          { type: "dir", path: "src" },
          { type: "file", path: "yarn.lock" },
        ],
        src: [{ type: "file", path: "src/index.ts" }],
      },
      files: { "README.md": "# repo", "src/index.ts": "export {};", "yarn.lock": "lock" },
    };
    const anonymous = new GitHubRepoLoader({
      repo: "https://github.com/org/repo",
      ignorePaths: ["*.lock"],
      fetchImpl: mockGithubApi(options),
    });
    await anonymous.init();
    expect((await anonymous.recursiveLoader()).map((doc) => doc.metadata.source)).toEqual([
      "README.md",
    ]);
    const withToken = new GitHubRepoLoader({
      repo: "https://github.com/org/repo",
      accessToken: "ghp_ok",
      ignorePaths: ["*.lock"],
      fetchImpl: mockGithubApi(options),
    });
    await withToken.init();
    const docs = await withToken.recursiveLoader();
    expect(docs.map((doc) => doc.metadata.source)).toEqual(["README.md", "src/index.ts"]);
    expect(docs[1]?.metadata.url).toBe("https://github.com/org/repo/blob/main/src/index.ts");
  });
});
