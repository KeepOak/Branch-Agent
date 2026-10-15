// Two-way sync between one Canopy board and one GitHub repository's issues.
//
// Canopy is the Board the user sees (Automations > Board and Canopy > Cards);
// GitHub Issues is the shared copy every device reads, so two Gateways synced
// to the same repository show the same work. The Trunk queue stays the owner of
// claimed work: a queue job whose brief links an issue decides that card's
// status and Trunk, and is never written back from here.
import type { CanopyCard, CanopyPriority, CanopyStatus } from "@branch/canopy-contract";

export type GitHubSyncIssue = {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels: string[];
  htmlUrl: string;
  updatedAt: number;
};

export type GitHubSyncQueueJob = {
  id: string;
  status: string;
  briefText: string;
  claimedBy?: string;
};

export type GitHubIssuePatch = {
  number: number;
  state?: "open" | "closed";
  labels?: string[];
};

export type CanopyCardCreate = {
  title: string;
  notes?: string;
  status: CanopyStatus;
  priority: CanopyPriority;
  labels: string[];
  sourceUrl: string;
  agentId?: string;
  idempotencyKey: string;
};

export type CanopyCardSyncUpdate = {
  id: string;
  expectedUpdatedAt: number;
  patch: { status?: CanopyStatus; title?: string; agentId?: string };
};

export type CanopyGitHubSyncPlan = {
  createCards: CanopyCardCreate[];
  updateCards: CanopyCardSyncUpdate[];
  patchIssues: GitHubIssuePatch[];
};

/** The sync-visible status: Canopy's nine statuses collapse to what an issue can carry. */
export type CanopySyncStatus = "triage" | "todo" | "running" | "review" | "blocked" | "done";

const STATUS_LABEL_PREFIX = "status:";
const STATUS_LABEL: Record<Exclude<CanopySyncStatus, "triage" | "done">, string> = {
  todo: "status:ready",
  running: "status:claimed",
  review: "status:review",
  blocked: "status:blocked",
};
const PRIORITY_LABELS: Record<string, CanopyPriority> = {
  "prio:p0": "urgent",
  "prio:p1": "high",
  "prio:p2": "normal",
  "prio:p3": "low",
};
const MAX_CARD_LABELS = 12;
const MAX_LABEL_LENGTH = 40;
const MAX_NOTES_LENGTH = 4000;

function syncStatusOfCard(status: CanopyStatus): CanopySyncStatus {
  switch (status) {
    case "backlog":
    case "todo":
    case "scheduled":
    case "ready":
      return "todo";
    case "running":
    case "review":
    case "blocked":
    case "done":
    case "triage":
      return status;
  }
  return "triage";
}

/** Issue to status. A closed issue is done; otherwise the most advanced status label wins. */
export function canopyStatusFromIssue(
  issue: Pick<GitHubSyncIssue, "state" | "labels">,
): CanopySyncStatus {
  if (issue.state === "closed") {
    return "done";
  }
  const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
  if (labels.has("status:blocked") || labels.has("status:stuck")) {
    return "blocked";
  }
  if (labels.has("status:review") || labels.has("status:to-check")) {
    return "review";
  }
  if (labels.has("status:claimed") || labels.has("status:in-progress")) {
    return "running";
  }
  if (labels.has("status:ready") || labels.has("status:todo")) {
    return "todo";
  }
  return "triage";
}

/** Queue job to status for the card it names. Queued and released jobs do not own the card. */
function queueStatus(job: GitHubSyncQueueJob): CanopySyncStatus | undefined {
  switch (job.status) {
    case "claimed":
      return "running";
    case "needs_attention":
    case "blocked":
      return "blocked";
    case "done":
      return "review";
    default:
      return undefined;
  }
}

/** The issue patch that makes an issue read as a status, keeping every non-status label. */
export function issuePatchForStatus(
  issue: Pick<GitHubSyncIssue, "number" | "state" | "labels">,
  status: CanopySyncStatus,
): GitHubIssuePatch {
  const kept = issue.labels.filter((label) => !label.toLowerCase().startsWith(STATUS_LABEL_PREFIX));
  const statusLabel = status === "triage" || status === "done" ? undefined : STATUS_LABEL[status];
  const patch: GitHubIssuePatch = {
    number: issue.number,
    labels: statusLabel ? [...kept, statusLabel] : kept,
  };
  const state = status === "done" ? "closed" : "open";
  if (state !== issue.state) {
    patch.state = state;
  }
  return patch;
}

function cardLabelsFromIssue(labels: readonly string[]): string[] {
  const kept: string[] = [];
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (
      lower.startsWith(STATUS_LABEL_PREFIX) ||
      lower.startsWith("claimed:") ||
      label.length > MAX_LABEL_LENGTH ||
      kept.includes(label)
    ) {
      continue;
    }
    kept.push(label);
    if (kept.length >= MAX_CARD_LABELS) {
      break;
    }
  }
  return kept;
}

function priorityFromIssue(labels: readonly string[]): CanopyPriority {
  for (const label of labels) {
    const priority = PRIORITY_LABELS[label.toLowerCase()];
    if (priority) {
      return priority;
    }
  }
  return "normal";
}

/** Card status a sync status lands on; keeps the card's own status when it already reads the same. */
function cardStatusFor(card: CanopyCard, status: CanopySyncStatus): CanopyStatus {
  return syncStatusOfCard(card.status) === status ? card.status : status;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/u, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Stable per-repository key, so concurrent syncs from two devices cannot create the same card twice. */
export function issueIdempotencyKey(repo: string, issueNumber: number): string {
  return "github-issue:" + repo.toLowerCase() + "#" + issueNumber;
}

/** First owning queue job whose brief links this issue by its exact URL. */
function queueJobForIssue(
  jobs: readonly GitHubSyncQueueJob[],
  issueUrl: string,
): GitHubSyncQueueJob | undefined {
  const pattern = new RegExp(escapeRegExp(normalizeUrl(issueUrl)) + "(?![0-9])", "u");
  return jobs.find((job) => queueStatus(job) && pattern.test(job.briefText.toLowerCase()));
}

/**
 * Plans one pass. For each issue: no card yet, create one; a queue job owns it, the card follows
 * the queue; otherwise when card and issue disagree, the side changed last wins.
 */
export function planCanopyGitHubSync(params: {
  repo: string;
  issues: readonly GitHubSyncIssue[];
  cards: readonly CanopyCard[];
  queueJobs?: readonly GitHubSyncQueueJob[];
}): CanopyGitHubSyncPlan {
  const plan: CanopyGitHubSyncPlan = { createCards: [], updateCards: [], patchIssues: [] };
  const cardsByUrl = new Map<string, CanopyCard>();
  for (const card of params.cards) {
    if (card.sourceUrl && !card.metadata?.archivedAt) {
      cardsByUrl.set(normalizeUrl(card.sourceUrl), card);
    }
  }
  for (const issue of params.issues) {
    const card = cardsByUrl.get(normalizeUrl(issue.htmlUrl));
    const job = queueJobForIssue(params.queueJobs ?? [], issue.htmlUrl);
    const owned = job ? queueStatus(job) : undefined;
    const issueStatus = canopyStatusFromIssue(issue);
    if (!card) {
      plan.createCards.push({
        title: issue.title,
        ...(issue.body ? { notes: issue.body.slice(0, MAX_NOTES_LENGTH) } : {}),
        status: owned ?? issueStatus,
        priority: priorityFromIssue(issue.labels),
        labels: cardLabelsFromIssue(issue.labels),
        sourceUrl: issue.htmlUrl,
        ...(owned && job?.claimedBy ? { agentId: job.claimedBy } : {}),
        idempotencyKey: issueIdempotencyKey(params.repo, issue.number),
      });
      continue;
    }
    const patch: CanopyCardSyncUpdate["patch"] = {};
    const cardStatus = syncStatusOfCard(card.status);
    if (owned) {
      if (cardStatus !== owned) {
        patch.status = cardStatusFor(card, owned);
      }
      if (job?.claimedBy && card.agentId !== job.claimedBy) {
        patch.agentId = job.claimedBy;
      }
    } else if (cardStatus !== issueStatus) {
      if (issue.updatedAt > card.updatedAt) {
        patch.status = cardStatusFor(card, issueStatus);
      } else {
        plan.patchIssues.push(issuePatchForStatus(issue, cardStatus));
      }
    }
    if (issue.title !== card.title && issue.updatedAt > card.updatedAt) {
      patch.title = issue.title;
    }
    if (Object.keys(patch).length > 0) {
      plan.updateCards.push({ id: card.id, expectedUpdatedAt: card.updatedAt, patch });
    }
  }
  return plan;
}

export type CanopyGitHubSyncPorts = {
  listIssues(): Promise<GitHubSyncIssue[]>;
  listCards(): Promise<CanopyCard[]>;
  listQueueJobs(): Promise<GitHubSyncQueueJob[]>;
  createCard(input: CanopyCardCreate): Promise<void>;
  updateCard(input: CanopyCardSyncUpdate): Promise<void>;
  patchIssue(patch: GitHubIssuePatch): Promise<void>;
};

export type CanopyGitHubSyncResult = {
  created: number;
  updated: number;
  pushed: number;
  failures: string[];
  plan: CanopyGitHubSyncPlan;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads all three sources, plans, and applies. One failed write never stops the rest. */
export async function runCanopyGitHubSync(params: {
  repo: string;
  ports: CanopyGitHubSyncPorts;
  dryRun?: boolean;
}): Promise<CanopyGitHubSyncResult> {
  const { ports } = params;
  const [issues, cards, queueJobs] = await Promise.all([
    ports.listIssues(),
    ports.listCards(),
    // The queue lives on one Gateway; when it cannot be read only the Trunk overlay is skipped.
    ports.listQueueJobs().catch(() => []),
  ]);
  const plan = planCanopyGitHubSync({ repo: params.repo, issues, cards, queueJobs });
  const result: CanopyGitHubSyncResult = { created: 0, updated: 0, pushed: 0, failures: [], plan };
  if (params.dryRun) {
    return result;
  }
  for (const create of plan.createCards) {
    try {
      await ports.createCard(create);
      result.created += 1;
    } catch (error) {
      result.failures.push("create " + create.sourceUrl + ": " + errorText(error));
    }
  }
  for (const update of plan.updateCards) {
    try {
      await ports.updateCard(update);
      result.updated += 1;
    } catch (error) {
      result.failures.push("update card " + update.id + ": " + errorText(error));
    }
  }
  for (const patch of plan.patchIssues) {
    try {
      await ports.patchIssue(patch);
      result.pushed += 1;
    } catch (error) {
      result.failures.push("update issue #" + patch.number + ": " + errorText(error));
    }
  }
  return result;
}

const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/u;

export function parseGitHubRepo(value: string): string {
  const repo = value.trim();
  if (!REPO_PATTERN.test(repo) || [".", ".."].includes(repo.split("/")[1] ?? "")) {
    throw new Error("--repo must look like owner/name.");
  }
  return repo;
}

function labelName(label: unknown): string {
  if (typeof label === "string") {
    return label;
  }
  if (label && typeof label === "object") {
    const name = (label as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

function issueFromApi(value: unknown): GitHubSyncIssue | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  // The issues endpoint also returns pull requests; those stay off the Board.
  if (row.pull_request || typeof row.number !== "number" || typeof row.title !== "string") {
    return undefined;
  }
  const updatedAt = Date.parse(String(row.updated_at));
  if (typeof row.html_url !== "string" || !Number.isFinite(updatedAt)) {
    return undefined;
  }
  return {
    number: row.number,
    title: row.title,
    body: typeof row.body === "string" ? row.body : null,
    state: row.state === "closed" ? "closed" : "open",
    labels: Array.isArray(row.labels) ? row.labels.map(labelName).filter(Boolean) : [],
    htmlUrl: row.html_url,
    updatedAt,
  };
}

/** Minimal REST client for one repository's issues. */
export function createGitHubIssuesClient(params: {
  repo: string;
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}): Pick<CanopyGitHubSyncPorts, "listIssues" | "patchIssue"> {
  const base = (params.apiBaseUrl ?? "https://api.github.com").replace(/\/+$/u, "");
  const doFetch = params.fetchImpl ?? fetch;
  const maxPages = params.maxPages ?? 10;
  const request = async (path: string, init?: { method: string; body: string }) => {
    const response = await doFetch(base + "/repos/" + params.repo + path, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + params.token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(
        "GitHub " + (init?.method ?? "GET") + " " + path + " failed: HTTP " + response.status,
      );
    }
    return (await response.json()) as unknown;
  };
  return {
    async listIssues() {
      const issues: GitHubSyncIssue[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const rows = await request(
          "/issues?state=all&sort=updated&direction=desc&per_page=100&page=" + page,
        );
        if (!Array.isArray(rows)) {
          throw new Error("GitHub returned an unexpected issue list.");
        }
        for (const row of rows) {
          const issue = issueFromApi(row);
          if (issue) {
            issues.push(issue);
          }
        }
        if (rows.length < 100) {
          break;
        }
      }
      return issues;
    },
    async patchIssue(patch) {
      const body: Record<string, unknown> = {};
      if (patch.state) {
        body.state = patch.state;
      }
      if (patch.labels) {
        body.labels = patch.labels;
      }
      await request("/issues/" + patch.number, { method: "PATCH", body: JSON.stringify(body) });
    },
  };
}

/** Queue rows as trunks.queue.list returns them. */
export function queueJobsFromGateway(value: unknown): GitHubSyncQueueJob[] {
  const items =
    value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  const jobs: GitHubSyncQueueJob[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.status !== "string") {
      continue;
    }
    jobs.push({
      id: item.id,
      status: item.status,
      briefText: typeof item.brief_text === "string" ? item.brief_text : "",
      ...(typeof item.claimed_by === "string" ? { claimedBy: item.claimed_by } : {}),
    });
  }
  return jobs;
}
