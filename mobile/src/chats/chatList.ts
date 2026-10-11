// The Chats list: the engine's sessions, read with sessions.subscribe and refreshed on every
// sessions.changed event, the way the window's ConversationList (window/src/connect/conversations.ts)
// does. The phone shows the conversations a person would open: the Trunks' own chats, the ones
// started in them and their rooms. System and helper conversations never show; archived, snoozed and
// automation chats wait behind their own filter, as in the preview's phone Chats.
import type { EngineLink } from '../pairing/pairingSession';

export type ChatRow = {
  key: string;
  /** The Trunk the chat belongs to, by id. */
  agentId?: string;
  /** When the chat was marked unread by hand, so opening it clears only that mark (sessions.patch). */
  markedUnreadAt?: number;
  /** What the row is called: the chat's own name, else its Trunk's name. */
  title: string;
  /** The Trunk it belongs to, when the title is the chat's own name. */
  trunkName?: string;
  /** The Trunk's emoji, else its first letter, for the avatar. */
  avatar: string;
  /** The last line said, on one line. */
  preview: string;
  /** When the chat was last active (ms): the later of the engine's updatedAt and lastActivityAt. */
  updatedAt: number;
  /** A Trunk is answering in it right now. */
  working: boolean;
  unread: boolean;
  pinned: boolean;
  /** A Trunk is waiting for the person (an approval, a question or a review). */
  needsYou: boolean;
  /** A room: several Trunks (or people) in one conversation. */
  room: boolean;
  archived: boolean;
  /** Hidden from All until this time (ms), when it comes back by itself. */
  snoozedUntil: number | null;
  /** Started by an automation (cron) rather than by a person. */
  automation: boolean;
};

/** The chips over the list, in the preview's order. */
export const CHAT_FILTERS = [
  ['all', 'All'],
  ['trunks', 'Trunks'],
  ['rooms', 'Rooms'],
  ['needsYou', 'Needs you'],
  ['snoozed', 'Snoozed'],
  ['archived', 'Archived'],
  ['automations', 'Automations'],
] as const;

export type ChatFilter = (typeof CHAT_FILTERS)[number][0];

const asleep = (row: ChatRow, now: number) => row.snoozedUntil !== null && row.snoozedUntil > now;

/** The rows a filter shows. All, Trunks, Rooms and Needs you leave out archived, snoozed and automation chats. */
export function filterRows(rows: ChatRow[], filter: ChatFilter, now: number): ChatRow[] {
  return rows.filter((row) => {
    if (filter === 'archived') return row.archived;
    if (row.archived) return false;
    if (filter === 'snoozed') return asleep(row, now);
    if (filter === 'automations') return row.automation;
    if (asleep(row, now) || row.automation) return false;
    if (filter === 'trunks') return !row.room;
    if (filter === 'rooms') return row.room;
    if (filter === 'needsYou') return row.needsYou;
    return true;
  });
}

/** How many chats in All are unread or need you, for the count beside the title. */
export function unreadCount(rows: ChatRow[], now: number): number {
  return filterRows(rows, 'all', now).filter((row) => row.unread || row.needsYou).length;
}

export type ChatListSnapshot = {
  rows: ChatRow[];
  /** A read has landed, on this connection or an earlier one. */
  loaded: boolean;
  error: string | null;
};

/** The params the window's sidebar sends (LIST_PARAMS in window/src/connect/conversations.ts). */
export const LIST_PARAMS = {
  includeGlobal: true,
  includeUnknown: true,
  configuredAgentsOnly: false,
  includeLastMessage: true,
  includeDerivedTitles: true,
  archived: 'all',
  limit: 200,
} as const;

type Agent = { name: string; avatar: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function agentIdOf(sessionKey: string): string | undefined {
  return /^agent:([^:]+):/.exec(sessionKey)?.[1];
}

/** The first letter, upper-cased, for an avatar with no emoji. */
function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

/** The Trunks by id, from agents.list. */
export function readAgents(result: unknown): { agents: Map<string, Agent>; mainKey: string } {
  const r = rec(result);
  const agents = new Map<string, Agent>();
  for (const raw of Array.isArray(r.agents) ? r.agents : []) {
    const a = rec(raw);
    const id = str(a.id);
    if (!id) continue;
    const identity = rec(a.identity);
    const name = str(identity.name) || str(a.name) || id;
    agents.set(id, { name, avatar: str(identity.emoji) || initial(name) });
  }
  return { agents, mainKey: str(r.mainKey) || 'main' };
}

/** Whether a sessions.list row belongs in the phone's Chats (the window's sidebar filter at its defaults). */
function shown(r: Record<string, unknown>, keys: Set<string>): boolean {
  const key = str(r.key);
  if (!key) return false;
  const classification = str(r.classification);
  if (classification === 'system' || str(r.createdVia) === 'system') return false;
  if (Boolean(r.spawnedBy) || num(r.spawnDepth) > 0) return false;
  const parent = str(r.parentSessionKey);
  return !(parent && parent !== key && keys.has(parent));
}

/** One sessions.list row as a Chats row. */
export function projectChat(raw: unknown, agents: Map<string, Agent>, mainKey: string): ChatRow {
  const r = rec(raw);
  const key = str(r.key);
  const agentId = str(r.agentId) || agentIdOf(key) || '';
  const agent = agents.get(agentId);
  const trunk = agent?.name ?? '';
  const isAgentMain = Boolean(agentId) && (key === 'agent:' + agentId + ':' + mainKey || r.isMain === true);
  const own = str(r.label) || str(r.displayName) || str(r.derivedTitle);
  const title = (isAgentMain ? trunk || own : own || trunk) || 'New chat';
  const activeRunIds = Array.isArray(r.activeRunIds) ? r.activeRunIds.filter((id) => typeof id === 'string' && id) : [];
  const digest = rec(r.observerDigest);
  return {
    key,
    ...(agentId ? { agentId } : {}),
    ...(num(r.markedUnreadAt) ? { markedUnreadAt: num(r.markedUnreadAt) } : {}),
    title,
    ...(trunk && title !== trunk ? { trunkName: trunk } : {}),
    avatar: agent?.avatar ?? initial(title),
    preview: oneLine(str(r.lastMessagePreview)),
    // A finished reply sets lastActivityAt; a row whose updatedAt lags it still reads as active then.
    updatedAt: Math.max(num(r.updatedAt), num(r.lastActivityAt)),
    working: r.hasActiveRun === true || activeRunIds.length > 0,
    unread: r.unread === true,
    pinned: r.pinned === true,
    needsYou: r.needsYou === true || Boolean(r.providerReview) || digest.health === 'waiting-on-user',
    room: str(r.kind) === 'group' || key.includes(':room:'),
    archived: r.archived === true,
    snoozedUntil: num(r.snoozedUntil) || null,
    automation: str(r.classification) === 'cron' || key.includes(':cron:'),
  };
}

/** Every row Chats can show, pinned first, then the most recent; filterRows picks a chip's rows. */
export function chatRows(list: unknown, agents: Map<string, Agent>, mainKey: string): ChatRow[] {
  const sessions = rec(list).sessions;
  const raw = Array.isArray(sessions) ? sessions.map(rec) : [];
  const keys = new Set(raw.map((r) => str(r.key)));
  return raw
    .filter((r) => shown(r, keys))
    .map((r) => projectChat(r, agents, mainKey))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** Search: the name, its Trunk and the last line, ignoring case. */
export function matchesSearch(row: ChatRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.title, row.trunkName ?? '', row.preview].some((text) => text.toLowerCase().includes(q));
}

export class ChatList {
  private snapshot: ChatListSnapshot = { rows: [], loaded: false, error: null };
  private readonly listeners = new Set<() => void>();
  private agents = new Map<string, Agent>();
  private mainKey = 'main';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private readonly offs: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly link: EngineLink) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ChatListSnapshot => this.snapshot;

  /** Reads now if the computer is connected, and again on every reconnect and every change. */
  attach(): void {
    this.disposed = false;
    this.offs.push(
      this.link.onConnected(() => void this.start()),
      this.link.onEvent((event, payload) => this.onEvent(event, payload)),
    );
    if (this.link.hello) void this.start();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Forgets every row, after the phone unpairs. */
  reset(): void {
    this.set({ rows: [], loaded: false, error: null });
  }

  /** Subscribes this connection to session changes and reads the first page, with the Trunks' names. */
  async start(): Promise<void> {
    // A new connection: nothing is known to be running until the engine says so.
    if (this.snapshot.rows.some((row) => row.working)) {
      this.set({ rows: this.snapshot.rows.map((row) => (row.working ? { ...row, working: false } : row)) });
    }
    try {
      const [subscribed, agents] = await Promise.all([
        this.link.request('sessions.subscribe', LIST_PARAMS),
        this.link.request('agents.list', {}).catch(() => null),
      ]);
      if (agents) ({ agents: this.agents, mainKey: this.mainKey } = readAgents(agents));
      this.apply(rec(subscribed).list);
    } catch (error) {
      this.set({ error: messageOf(error) });
    }
  }

  /** A changed session or a finished reply reads the list again. */
  onEvent(event: string, payload: unknown): void {
    const state = str(rec(payload).state);
    if (event === 'sessions.changed' || (event === 'chat' && ['final', 'error', 'aborted'].includes(state))) {
      this.refreshSoon();
    }
  }

  refreshSoon(delayMs = 150): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delayMs);
  }

  /** Reads the list again; overlapping calls collapse into one trailing read. */
  refresh(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const read = async () => {
      await Promise.resolve();
      try {
        do {
          this.again = false;
          try {
            this.apply(await this.link.request('sessions.list', LIST_PARAMS));
          } catch (error) {
            this.set({ error: messageOf(error) });
          }
        } while (this.again && !this.disposed);
      } finally {
        this.inFlight = null;
      }
    };
    this.inFlight = read();
    return this.inFlight;
  }

  private apply(list: unknown): void {
    this.set({ rows: chatRows(list, this.agents, this.mainKey), loaded: true, error: null });
  }

  private set(patch: Partial<ChatListSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
