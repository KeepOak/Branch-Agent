// The conversation list (DESIGN-SPEC §4.1.1): the engine's sessions, read with sessions.subscribe and
// sessions.list and refreshed on every sessions.changed event, the way OpenClaw's ui/src/lib/sessions does.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { agentIdOf } from "./session";
import type { RoomPick } from "../rooms/RoomFaces";

/** Heartbeat check-ins are engine prompts, not messages a person wrote; they never show as a preview. */
const HEARTBEAT_PROMPT = /^\[Branch Agent heartbeat poll\]/i;
function previewText(value: unknown): string {
  const text = str(value).replace(/\s+/g, " ").trim();
  return HEARTBEAT_PROMPT.test(text) ? "" : text;
}
export type Conversation = {
  key: string;
  title: string;
  agentId?: string;
  isMain: boolean;
  pinned: boolean;
  archived: boolean;
  unread: boolean;
  snoozedUntil: number | null;
  done?: boolean;
  createdAt: number;
  updatedAt: number;
  preview: string;
  working: boolean;
  /** Run ids reported by sessions.list for a live conversation. */
  activeRunIds?: string[];
  kind: string;
  system: boolean;
  automation: boolean;
  needsYou?: boolean;
  /** Classification retained for the contact projection. */
  classification?: string;
  spawnDepth?: number;
  helper?: boolean;
  groupChat?: boolean;
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
  /** Real room members for the stacked group face. */
  roomPicks?: RoomPick[];
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
  configuredAgentsOnly: false,
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
  const activeRunIds = Array.isArray(r.activeRunIds) ? r.activeRunIds.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
  const classification = str(r.classification);
  const participants = Array.isArray(r.participants) ? r.participants : [];
  return {
    key,
    title,
    agentId: str(r.agentId) || agentIdOf(key),
    isMain: key === mainKey || r.isMain === true,
    pinned: r.pinned === true,
    archived: r.archived === true,
    unread: r.unread === true,
    snoozedUntil: num(r.snoozedUntil) || null,
    done: r.done === true,
    createdAt: num(r.createdAt) || num(r.updatedAt),
    updatedAt: num(r.updatedAt),
    preview: previewText(r.lastMessagePreview),
    working: r.hasActiveRun === true || activeRunIds.length > 0,
    activeRunIds,
    kind: str(r.kind),
    system: classification === "system" || str(r.createdVia) === "system",
    automation: classification === "cron" || key.includes(":cron:"),
    classification,
    spawnDepth: num(r.spawnDepth),
    helper: Boolean(r.spawnedBy) || num(r.spawnDepth) > 0,
    groupChat: str(r.kind) === "group" || participants.some((p) => str(rec(rec(p).identity).type) === "profile"),
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
  // Same waiting flags the Gateway contacts projection uses for desktop "is waiting for you".
  if (r.needsYou === true || Boolean(r.providerReview) || digest.health === "waiting-on-user") out.needsYou = true;
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
  private inFlight: Promise<void> | null = null;
  private again = false;
  private selectedContact: { key: string; agentId: string } | null = null;

  private readonly request: Request;
  private mainKey: string | null;

  constructor(request: Request, mainKey: string | null, selectedKey: string | null = null) {
    this.request = request;
    this.mainKey = mainKey;
    const agentId = selectedKey ? agentIdOf(selectedKey) : "";
    if (selectedKey && agentId) this.selectedContact = { key: selectedKey, agentId };
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

  /** Subscribes to session changes and reads the first page. Each start is a new connection, so rows
   * shown until that read lands claim no running work: the engine's live registry says what runs. */
  async start(): Promise<void> {
    if (this.snapshot.rows.some((row) => row.working)) {
      this.set({ rows: this.snapshot.rows.map((row) => (row.working ? { ...row, working: false } : row)) });
    }
    try {
      const result = rec(await this.request("sessions.subscribe", LIST_PARAMS));
      await this.apply(result.list);
    } catch (error) {
      this.set({ loaded: false, error: error instanceof Error ? error.message : String(error) });
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
      return this.inFlight;
    }
    const read = async () => {
      // Assign the shared promise before even a synchronously refused request can settle it.
      await Promise.resolve();
      try {
        do {
          this.again = false;
          try { await this.apply(await this.request("sessions.list", LIST_PARAMS)); }
          catch (error) { this.set({ error: error instanceof Error ? error.message : String(error) }); }
        } while (this.again);
      } finally { this.inFlight = null; }
    };
    this.inFlight = read();
    return this.inFlight;
  }

  /** An exact authorized read is the absence authority; the paged sidebar is only a projection. */
  private async describeContact(key: string, agentId: string): Promise<Conversation | null> {
    try {
      const result = rec(await this.request("sessions.describe", { key, agentId, includeDerivedTitles: true, includeLastMessage: true }));
      if (!Object.hasOwn(result, "session")) throw new Error("The engine did not describe the contact conversation");
      if (result.session === null) return null;
      const row = projectConversation(result.session, this.mainKey);
      if (row.key !== key || row.agentId !== agentId || !row.sessionId) throw new Error("The engine returned a different or incomplete contact conversation");
      return row;
    } catch (error) {
      this.set({ rows: this.snapshot.rows.filter((row) => row.key !== key), loaded: false });
      throw error;
    }
  }

  /** Retains one actual described contact, including one outside the first sidebar page. */
  async selectContact(key: string, agentId: string): Promise<Conversation | null> {
    const row = await this.describeContact(key, agentId);
    if (!row) {
      if (this.selectedContact?.key === key) this.selectedContact = null;
      this.set({ rows: this.snapshot.rows.filter((item) => item.key !== key), loaded: true, error: null });
      return null;
    }
    this.selectedContact = { key, agentId };
    this.set({ rows: [...this.snapshot.rows.filter((item) => item.key !== key), row], loaded: true, error: null });
    return row;
  }

  private async apply(list: unknown): Promise<void> {
    const sessions = rec(list).sessions;
    const rows = Array.isArray(sessions) ? sessions.map((s) => projectConversation(s, this.mainKey)) : [];
    const contact = this.selectedContact;
    if (contact && !rows.some((row) => row.key === contact.key)) {
      let selected: Conversation | null;
      try { selected = await this.describeContact(contact.key, contact.agentId); }
      catch (error) {
        // Hide stale retained data immediately, but retain the key for an authorized retry.
        // A failed read is not an authoritative deletion and must not trigger saved-route fallback.
        if (this.selectedContact === contact) this.set({ rows: rows.filter((row) => row.key && row.key !== contact.key), loaded: false });
        throw error;
      }
      if (this.selectedContact !== contact) { this.again = true; return; }
      if (selected) rows.push(selected);
      else this.selectedContact = null;
    }
    this.set({ rows: rows.filter((r) => r.key), loaded: true, error: null });
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
