// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/RepoLoader (RepoLoaderArgs typedefs).
import type { ConnectorFetch } from "./fetch.js";

export type RepoPlatform = "github" | "gitlab" | "gitea";

export type RepoLoaderArgs = {
  /** Repository URL (github.com, GitHub Enterprise, GHE.com, gitlab.com or self-hosted, Gitea). */
  repo: string;
  branch?: string;
  accessToken?: string | null;
  /** gitignore-style patterns to skip. */
  ignorePaths?: string[];
  /** GitLab only. */
  fetchIssues?: boolean;
  /** GitLab only. */
  fetchWikis?: boolean;
  fetchImpl: ConnectorFetch;
  /** Rate-limit backoff; injectable so tests do not sleep. */
  wait?: (ms: number) => Promise<void>;
};

export type RepoDocument = {
  pageContent?: string;
  issue?: GitlabIssue;
  wiki?: GitlabWikiPage;
  metadata: { source: string; url: string };
};

export type GitlabUser = { username: string; name?: string };

export type GitlabIssue = {
  iid: number;
  title: string;
  description?: string | null;
  web_url?: string;
  author?: GitlabUser;
  assignees?: GitlabUser[];
  closed_by?: GitlabUser | null;
  milestone?: { id: number; title: string } | null;
  time_stats?: Record<string, unknown> | null;
  discussions: Array<string | string[]>;
  [key: string]: unknown;
};

export type GitlabWikiPage = {
  slug: string;
  title: string;
  content?: string;
  format?: string;
};
