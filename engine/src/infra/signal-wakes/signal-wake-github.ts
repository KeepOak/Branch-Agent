import { z } from "zod";
import type { CheckRunSummary } from "./signal-wake-classify.js";

export const GITHUB_REST_BASE = "https://api.github.com";
const CACHE_LIMIT = 500;
const PAGE_SIZE = 100;
const DEFAULT_MAX_PULL_PAGES = 10;
const COMMENT_PAGE_SIZE = 50;

export type RepoRef = { owner: string; name: string };
export type PullSummary = { number: number; authorLogin: string; headRef: string; headSha: string };
export type CommentSummary = {
  id: number;
  authorLogin: string;
  body: string;
  /** GitHub's author_association, for example OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR or NONE. */
  authorAssociation?: string;
  /** ISO time the comment was created. Set only when GitHub sends it. */
  createdAt?: string;
};

/** Read-only GitHub access for the signal poller. Conditional GETs that return 304 are served from cache. */
export type SignalWakeGitHub = {
  listOpenPulls(repo: RepoRef): Promise<PullSummary[]>;
  listCheckRuns(repo: RepoRef, headSha: string): Promise<CheckRunSummary[]>;
  listComments(repo: RepoRef, pullNumber: number): Promise<CommentSummary[]>;
};

/** The same client plus two reads the Gardener needs. They go through the same ETag cache. */
export type SignalWakeGitHubReads = SignalWakeGitHub & {
  /** Tip sha of heads/<branch>, or undefined when the ref body has no sha. */
  getBranchSha(repo: RepoRef, branch: string): Promise<string | undefined>;
  /** Committer time of a commit in epoch ms, or undefined when the body has no date. */
  getCommitTime(repo: RepoRef, sha: string): Promise<number | undefined>;
};

export type SignalWakeGitHubOptions = {
  fetchImpl: typeof fetch;
  token: string;
  apiBase?: string;
  /** Pages of 100 open PRs to read. Beyond this the list is refused rather than silently cut. */
  maxPullPages?: number;
};

export class SignalWakeGitHubError extends Error {
  constructor(readonly status: number) {
    super(`GitHub read failed with status ${status}`);
    this.name = "SignalWakeGitHubError";
  }
}

/** Thrown when open PRs exceed the page cap. The poll skips the repo rather than acting on a partial list. */
export class SignalWakePullListLimitError extends Error {
  constructor(readonly maxPulls: number) {
    super(
      `more than ${maxPulls} open PRs; signal wakes are paused for this repo until the cap is raised`,
    );
    this.name = "SignalWakePullListLimitError";
  }
}

const pullSchema = z.object({
  number: z.number().int(),
  user: z.object({ login: z.string() }).nullish(),
  head: z.object({ ref: z.string(), sha: z.string() }),
});
const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullish() }),
  ),
});
const commentSchema = z.object({
  id: z.number().int(),
  user: z.object({ login: z.string() }).nullish(),
  body: z.string().nullish(),
  author_association: z.string().nullish(),
  created_at: z.string().nullish(),
});
const refSchema = z.object({ object: z.object({ sha: z.string() }) });
const commitSchema = z.object({
  commit: z.object({ committer: z.object({ date: z.string() }).nullish() }),
});

/** Keeps well-formed items and drops the rest, so one odd item cannot blind the whole poll. */
function parseItems<T>(schema: z.ZodType<T>, items: unknown): T[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.flatMap((item: unknown) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

type CacheEntry = { etag: string; body: unknown };

async function conditionalGetJson(
  options: SignalWakeGitHubOptions,
  cache: Map<string, CacheEntry>,
  url: string,
): Promise<unknown> {
  const cached = cache.get(url);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${options.token}`,
  };
  if (cached) {
    headers["If-None-Match"] = cached.etag;
  }
  const response = await options.fetchImpl(url, { headers });
  if (response.status === 304 && cached) {
    return cached.body;
  }
  if (!response.ok) {
    throw new SignalWakeGitHubError(response.status);
  }
  const body: unknown = await response.json();
  const etag = response.headers.get("etag");
  cache.delete(url);
  if (etag) {
    cache.set(url, { etag, body });
  }
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  return body;
}

function repoPath(repo: RepoRef): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

function toPull(pull: z.infer<typeof pullSchema>): PullSummary {
  return {
    number: pull.number,
    authorLogin: pull.user?.login ?? "",
    headRef: pull.head.ref,
    headSha: pull.head.sha,
  };
}

function toComment(comment: z.infer<typeof commentSchema>): CommentSummary {
  const summary: CommentSummary = {
    id: comment.id,
    authorLogin: comment.user?.login ?? "",
    body: comment.body ?? "",
  };
  if (comment.author_association) {
    summary.authorAssociation = comment.author_association;
  }
  if (comment.created_at) {
    summary.createdAt = comment.created_at;
  }
  return summary;
}

export function createSignalWakeGitHub(options: SignalWakeGitHubOptions): SignalWakeGitHubReads {
  const cache = new Map<string, CacheEntry>();
  const base = options.apiBase ?? GITHUB_REST_BASE;
  const maxPages = options.maxPullPages ?? DEFAULT_MAX_PULL_PAGES;
  const getJson = (path: string) => conditionalGetJson(options, cache, `${base}${path}`);
  return {
    async listOpenPulls(repo) {
      const pulls: PullSummary[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const raw = await getJson(
          `${repoPath(repo)}/pulls?state=open&per_page=${PAGE_SIZE}&page=${page}`,
        );
        const rawCount = Array.isArray(raw) ? raw.length : 0;
        pulls.push(...parseItems(pullSchema, raw).map(toPull));
        if (rawCount < PAGE_SIZE) {
          return pulls;
        }
      }
      throw new SignalWakePullListLimitError(maxPages * PAGE_SIZE);
    },
    async listCheckRuns(repo, headSha) {
      const body = await getJson(
        `${repoPath(repo)}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=${PAGE_SIZE}`,
      );
      const parsed = checkRunsSchema.safeParse(body);
      return parsed.success
        ? parsed.data.check_runs.map((run) => ({
            name: run.name,
            status: run.status,
            conclusion: run.conclusion ?? null,
          }))
        : [];
    },
    async listComments(repo, pullNumber) {
      const comments = parseItems(
        commentSchema,
        await getJson(
          `${repoPath(repo)}/issues/${pullNumber}/comments?sort=created&direction=desc&per_page=${COMMENT_PAGE_SIZE}`,
        ),
      );
      return comments.map(toComment);
    },
    async getBranchSha(repo, branch) {
      const parsed = refSchema.safeParse(
        await getJson(`${repoPath(repo)}/git/ref/heads/${encodeURIComponent(branch)}`),
      );
      return parsed.success ? parsed.data.object.sha : undefined;
    },
    async getCommitTime(repo, sha) {
      const parsed = commitSchema.safeParse(
        await getJson(`${repoPath(repo)}/commits/${encodeURIComponent(sha)}`),
      );
      const date = parsed.success ? parsed.data.commit.committer?.date : undefined;
      return date === undefined ? undefined : Date.parse(date) || undefined;
    },
  };
}
