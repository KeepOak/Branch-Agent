// The conversation list (DESIGN-SPEC §4.1.1): the engine's sessions, read with sessions.subscribe and
// sessions.list and refreshed on every sessions.changed event, the way OpenClaw's ui/src/lib/sessions does.
import { agentIdOf } from "./session";

export type Conversation = {
  key: string;
  title: string;
  agentId?: string;
  isMain: boolean;
  pinned: boolean;
  archived: boolean;
  unread: boolean;
  snoozedUntil: number | null;
  createdAt: number;
  updatedAt: number;
  preview: string;
  working: boolean;
  kind: string;
  system: boolean;
  automation: boolean;
  label?: string;
  /** The conversation's room: tokens used now and the model's window (sessions.list totalTokens, contextTokens). */
  totalTokens: number;
  contextTokens: number;
  /** The transcript id; lifecycle patches (archive, snooze) must name it (engine sessions-patch.ts). */
  sessionId?: string;
  /** When the person marked it unread by hand (the unread guard's marker). */
  markedUnreadAt?: number;
  /** The project it belongs to (sessions.list projectId), for the sidebar's Projects. */
  projectId?: string;
  /** The last run's lifecycle when it is a mark on the row (sessions.list status): queued, failed, timeout, stopped. */
  runMark?: RunMark;
  /** Why the last run failed (sessions.list lastRunError). */
  runError?: string;
  /** The conversation that started this one (parentSessionKey, else spawnedBy): it shows under that row. */
  parentKey?: string;
  /** The conversation it was copied from (forkSource.sessionKey). */
  forkOf?: string;
  /** Its icon (an engine glyph id, one emoji or an SVG data URL) and colour name (SESSION_COLOR_IDS). */
  icon?: string;
  color?: string;
  /** Who owns it (owner.actor, else the person who started it). */
  ownerId?: string;
  ownerName?: string;
  /** Its folder (workspaceDir, else the spawned or exec folder). */
  folder?: string;
  /** What a working Trunk is doing, in a few words (observerDigest.headline, else activitySummary.text). */
  headline?: string;
  /** "repo ⎇ branch" when it works in a repository or worktree. */
  repoBranch?: string;
  /** The computer it runs on when that isn't the gateway (execNode). */
  execNode?: string;
  /** The person hid it from "Involving me" (hiddenFromInvolvingMe). */
  hiddenFromMe?: boolean;
  /** People in it (participants' identity ids). */
  participantIds?: string[];
};

export type RunMark = "queued" | "failed" | "timeout" | "stopped";

export type ConversationsSnapshot = {
  rows: Conversation[];
  loaded: boolean;
  error: string | null;
};

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The params OpenClaw's sidebar sends (ui/src/lib/sessions/session-requests.ts buildSessionListParams), with every status. */
export const LIST_PARAMS = {
  includeGlobal: true,
  includeUnknown: true,
  configuredAgentsOnly: true,
  includeLastMessage: true,
  includeDerivedTitles: true,
  archived: "all",
  limit: 200,
} as const;

/** One engine row (a sessions.list `sessions[]` item) as the sidebar reads it. */
export function projectConversation(raw: unknown, mainKey: string | null): Conversation {
  const r = rec(raw);
  const key = str(r.key);
  const label = str(r.label) || undefined;
  const title = label || str(r.displayName) || str(r.derivedTitle) || "";
  const activeRunIds = Array.isArray(r.activeRunIds) ? r.activeRunIds : [];
  const classification = str(r.classification);
  return {
    key,
    title,
    agentId: str(r.agentId) || agentIdOf(key),
    isMain: key === mainKey || r.isMain === true,
    pinned: r.pinned === true,
    archived: r.archived === true,
    unread: r.unread === true,
    snoozedUntil: num(r.snoozedUntil) || null,
    createdAt: num(r.createdAt) || num(r.updatedAt),
    updatedAt: num(r.updatedAt),
    preview: str(r.lastMessagePreview).replace(/\s+/g, " ").trim(),
    working: r.hasActiveRun === true || activeRunIds.length > 0,
    kind: str(r.kind),
    system: classification === "system" || str(r.createdVia) === "system",
    automation: classification === "cron" || key.includes(":cron:"),
    label,
    ...(str(r.sessionId) ? { sessionId: str(r.sessionId) } : {}),
    ...(typeof r.markedUnreadAt === "number" ? { markedUnreadAt: r.markedUnreadAt } : {}),
    ...(str(r.projectId) ? { projectId: str(r.projectId) } : {}),
    totalTokens: num(r.totalTokens),
    contextTokens: num(r.contextTokens),
    ...rowExtras(r),
  };
}

const MARKS: Record<string, RunMark> = { queued: "queued", failed: "failed", timeout: "timeout", killed: "stopped", interrupted: "stopped" };

function actor(v: unknown): { id: string; name: string } | null {
  const a = rec(v);
  return str(a.type) === "human" && str(a.id) ? { id: str(a.id), name: str(a.label) || str(rec(a.identity).label) } : null;
}

function repoWords(r: Record<string, unknown>): string {
  const repo = rec(r.repository);
  const tree = rec(r.worktree);
  const branch = str(repo.branch) || str(tree.branch);
  if (!branch) return "";
  const name = (str(repo.url) || str(tree.repoRoot)).replace(/\.git$/, "").split(/[\\/:]/).filter(Boolean).pop() ?? "";
  return name ? `${name} ⎇ ${branch}` : `⎇ ${branch}`;
}

/** The optional facts the row marks, the hover card and Filter and sort read (all from the same sessions.list row). */
function rowExtras(r: Record<string, unknown>): Partial<Conversation> {
  const out: Partial<Conversation> = {};
  const mark = MARKS[str(r.status)];
  if (mark) out.runMark = mark;
  if (str(r.lastRunError)) out.runError = str(r.lastRunError);
  const parent = str(r.parentSessionKey) || str(r.spawnedBy);
  if (parent && parent !== str(r.key)) out.parentKey = parent;
  if (str(rec(r.forkSource).sessionKey)) out.forkOf = str(rec(r.forkSource).sessionKey);
  if (str(r.icon)) out.icon = str(r.icon);
  if (str(r.color)) out.color = str(r.color);
  const owner = actor(rec(r.owner).actor) ?? actor(r.createdActor);
  if (owner) {
    out.ownerId = owner.id;
    if (owner.name) out.ownerName = owner.name;
  }
  const folder = str(r.workspaceDir) || str(r.spawnedCwd) || str(r.execCwd);
  if (folder) out.folder = folder;
  const digest = rec(r.observerDigest);
  const summary = rec(r.activitySummary);
  const headline = str(digest.headline) || (str(summary.state) === "current" ? str(summary.text) : "");
  if (headline) out.headline = headline.replace(/\s+/g, " ").trim();
  const repo = repoWords(r);
  if (repo) out.repoBranch = repo;
  if (str(r.execNode)) out.execNode = str(r.execNode);
  if (r.hiddenFromInvolvingMe === true) out.hiddenFromMe = true;
  const ids = (Array.isArray(r.participants) ? r.participants : []).map((p) => str(rec(rec(p).identity).id)).filter(Boolean);
  if (ids.length) out.participantIds = ids;
  return out;
}

export class ConversationList {
  private snapshot: ConversationsSnapshot = { rows: [], loaded: false, error: null };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private again = false;

  private readonly request: Request;
  private mainKey: string | null;

  constructor(request: Request, mainKey: string | null) {
    this.request = request;
    this.mainKey = mainKey;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConversationsSnapshot => this.snapshot;

  private set(patch: Partial<ConversationsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Subscribes to session changes and reads the first page. */
  async start(): Promise<void> {
    try {
      const result = rec(await this.request("sessions.subscribe", LIST_PARAMS));
      this.apply(result.list);
    } catch (error) {
      this.set({ loaded: true, error: error instanceof Error ? error.message : String(error) });
    }
  }

  setMainKey(mainKey: string | null): void {
    this.mainKey = mainKey;
  }

  /** Called for every engine event; a sessions.changed or a finished chat refreshes the list. */
  onEvent(event: string, payload: unknown): void {
    const state = str(rec(payload).state);
    if (event === "sessions.changed" || (event === "chat" && ["final", "error", "aborted"].includes(state))) {
      this.refreshSoon();
    }
  }

  refreshSoon(delayMs = 150): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delayMs);
  }

  /** Reads the list again; overlapping calls collapse into one trailing read. */
  async refresh(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    try {
      this.apply(await this.request("sessions.list", LIST_PARAMS));
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.inFlight = false;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    }
  }

  private apply(list: unknown): void {
    const sessions = rec(list).sessions;
    const rows = Array.isArray(sessions) ? sessions.map((s) => projectConversation(s, this.mainKey)) : [];
    this.set({ rows: rows.filter((r) => r.key), loaded: true, error: null });
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
