// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/RepoLoader/index.js, GithubRepo/index.js, GitlabRepo/index.js, GiteaRepo/index.js.
// The per-platform load functions become one repository connector that yields wiki source documents.
import type { ConnectorDocument, ConnectorSource } from "./import.js";
import { GiteaRepoLoader } from "./repo-gitea.js";
import { GitHubRepoLoader } from "./repo-github.js";
import { GitLabRepoLoader, issueToMarkdown } from "./repo-gitlab.js";
import type { RepoLoaderArgs, RepoPlatform } from "./repo-types.js";

export type RepoLoader = GitHubRepoLoader | GitLabRepoLoader | GiteaRepoLoader;

/** Loads the right repository loader for a platform; GitHub by default. */
export function resolveRepoLoader(platform: RepoPlatform = "github", args: RepoLoaderArgs): RepoLoader {
  switch (platform) {
    case "gitlab":
      return new GitLabRepoLoader(args);
    case "gitea":
      return new GiteaRepoLoader(args);
    default:
      return new GitHubRepoLoader(args);
  }
}

const PLATFORM_LABELS: Record<RepoPlatform, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
};

export type RepoConnectorLoad =
  | { success: true; source: ConnectorSource; documents: ConnectorDocument[]; branch: string }
  | { success: false; reason: string };

/** Loads every document of a repository (files; GitLab issues and wikis when asked). */
export async function loadRepoConnectorDocuments(
  platform: RepoPlatform,
  args: RepoLoaderArgs,
): Promise<RepoConnectorLoad> {
  const repo = resolveRepoLoader(platform, args);
  await repo.init();
  if (!repo.ready) {
    return {
      success: false,
      reason: `Could not prepare ${PLATFORM_LABELS[platform]} repo for loading! Check URL`,
    };
  }
  const docs = await repo.recursiveLoader();
  if (!docs.length) {
    return { success: false, reason: "No files were found for those settings." };
  }
  const documents: ConnectorDocument[] = [];
  for (const doc of docs) {
    if (doc.pageContent) {
      documents.push({
        key: doc.metadata.source,
        title: doc.metadata.source,
        content: doc.pageContent,
        url: doc.metadata.url,
        language: "text",
        details: [`- Author: ${repo.author}`],
      });
    } else if (doc.issue) {
      documents.push({
        key: doc.metadata.source,
        title: `Issue ${doc.issue.iid}: ${doc.issue.title}`,
        content: issueToMarkdown(doc.issue),
        url: doc.metadata.url,
        details: [`- Author: ${doc.issue.author?.username ?? repo.author}`],
      });
    } else if (doc.wiki?.content) {
      documents.push({
        key: doc.metadata.source,
        title: doc.wiki.title,
        content: doc.wiki.content,
        url: doc.metadata.url,
        details: [
          `- Description: ${doc.wiki.format === "markdown" ? "GitLab Wiki Page (Markdown)" : "GitLab Wiki Page"}`,
        ],
      });
    }
  }
  const branch = repo.branch ?? "";
  const repoUrl = `${new URL(repo.repo).origin}/${repo.author}/${repo.project}`;
  return {
    success: true,
    branch,
    source: {
      kind: platform,
      id: `${platform}:${repoUrl}@${branch}`,
      label: `${PLATFORM_LABELS[platform]} ${repo.author}/${repo.project}:${branch}`,
    },
    documents,
  };
}
