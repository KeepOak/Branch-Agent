/**
 * Office server for the Branch webview. It holds the roster, the office numbers and the
 * stored layout, seats, looks and preferences, and it sends office messages to the webview.
 */
import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, type OfficeLayout } from '../office/types.js';
import type { MessageTransport, TransportState } from '../transport/types.js';
import type { DecodedAssets } from './assets.js';
import { BRANCH_AREA_MAPPINGS, type LayoutPlan, generateBranchLayout, planSize } from './branchLayout.js';
import { fitZoom } from './fit.js';
import type { OfficePrefs, OfficeStore, Storage, TrunkLook } from './storage.js';
import { defaultSpriteKey } from './trunkSprites.js';
import type { BranchAgent, BranchLink, BranchSubagent, Customization, MountOptions } from './types.js';

const DEFAULT_PANE_WIDTH = 1280;
const DEFAULT_PANE_HEIGHT = 800;
const WIDE_RATIO = 1.15;
const WIDE_PLAN_PER_ROW = { min: 3, max: 8 };
const NARROW_PLAN_PER_ROW = { min: 2, max: 4 };
const ZOOM_WEIGHT = 1000000;
const SHAPE_BONUS = 100000;
const WAITING_BUBBLE_CAP_SEC = 0.3;
const GUEST_PALETTE_COUNT = 6;
const GREY_SPREAD = 0.08;
const HUE_STEP_DEG = 15;
const READING_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];
const SUBAGENT_TOOLS = ['Task', 'Agent'];
const DESK_STATES = ['working', 'reading', 'needs_you'];
const DESK_LABELS: Record<string, string> = {
  working: 'Working',
  reading: 'Reading',
  needs_you: 'Waiting for your yes',
};
const HUMAN_SPRITE = /^human:(\d)$/;

type TeamInfo = NonNullable<BranchAgent['team']>;

interface SubMemory {
  state: string;
  activity: string;
  open: string | null;
}

/** What the server last sent for one roster agent, used to send only changes. */
interface Snapshot {
  known: boolean;
  state: string;
  activity: string;
  pending: number;
  toolRow: string | null;
  teamSent: boolean;
  subs: Map<string, SubMemory>;
}

interface LookInfo {
  spriteKey?: string;
  palette: number;
  hueShift: number;
}

/** Maps text to a stable index from zero to count minus one. */
function hashIndex(text: string, count: number): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % count;
}

/** Hue in steps of 15 degrees for a #rrggbb colour; grey or invalid colours give zero. */
function hueFromColor(color: string | undefined): number {
  const text = color ?? '';
  if (!/^#[0-9a-f]{6}$/i.test(text)) return 0;
  const r = Number.parseInt(text.slice(1, 3), 16) / 255;
  const g = Number.parseInt(text.slice(3, 5), 16) / 255;
  const b = Number.parseInt(text.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta < GREY_SPREAD) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  let degrees = h * 60;
  if (degrees < 0) degrees += 360;
  return (Math.round(degrees / HUE_STEP_DEG) * HUE_STEP_DEG) % 360;
}

/** Milliseconds for a link time; numbers are used as given, text is parsed as a date. */
function linkTime(link: BranchLink): number {
  if (typeof link.at === 'number') return Number.isFinite(link.at) ? link.at : 0;
  const parsed = Date.parse(String(link.at));
  return Number.isFinite(parsed) ? parsed : 0;
}

function linkKey(link: BranchLink): string {
  return `${link.from}|${link.to}|${String(link.at)}`;
}

function planKey(plan: LayoutPlan): string {
  return [plan.wide, plan.perRow, plan.trunks, plan.guests].join('|');
}

function isDesk(state: string): boolean {
  return DESK_STATES.includes(state);
}

/** Status text for a sub-agent row. */
function subStatus(state: string, activity: string): string {
  if (state === 'reading') {
    if (!activity) return 'Reading';
    return activity.startsWith('Read') ? activity : `Reading ${activity}`;
  }
  if (isDesk(state)) return activity || 'Writing';
  return activity || 'Idle';
}

function taskRowId(key: string): string {
  return `sub:${key}`;
}

/** Pose for a character that is typing and active, from the parent's activity text. */
function thinkOrSearch(activity: string): string | null {
  if (/^think/i.test(activity)) return 'think';
  if (/^search/i.test(activity)) return 'search';
  return null;
}

export class BranchServer implements MessageTransport {
  readonly state: TransportState = 'connected';
  readonly ready: Promise<void> = Promise.resolve();
  store: OfficeStore;
  private agents: BranchAgent[] = [];
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  private readonly idByNum = new Map<number, string>();
  private readonly numById = new Map<string, number>();
  private readonly memory = new Map<string, Snapshot>();
  private readonly shown = new Set<string>();
  private readonly mountedAt = Date.now();
  private nextNum = 1;
  private rowSeq = 0;
  private webviewReady = false;
  private disposed = false;
  private pane = { width: DEFAULT_PANE_WIDTH, height: DEFAULT_PANE_HEIGHT };
  private generatedKey: string | null = null;
  private readonly opts: MountOptions;
  private readonly storage: Storage;
  private readonly assets: DecodedAssets;
  private readonly getOffice: () => OfficeState;
  private readonly isReducedMotion: () => boolean;

  constructor(
    opts: MountOptions,
    storage: Storage,
    assets: DecodedAssets,
    getOffice: () => OfficeState,
    isReducedMotion: () => boolean,
  ) {
    this.opts = opts;
    this.storage = storage;
    this.assets = assets;
    this.getOffice = getOffice;
    this.isReducedMotion = isReducedMotion;
    this.store = storage.load();
    if (typeof opts.soundEnabled === 'boolean') this.store.prefs.soundEnabled = opts.soundEnabled;
    this.agents = opts.agents;
    for (const link of opts.links ?? []) {
      if (linkTime(link) < this.mountedAt) this.shown.add(linkKey(link));
    }
  }

  onMessage(handler: (m: ServerMessage) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  onStateChange(): () => void {
    return () => undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private deliver(m: Record<string, unknown>): void {
    if (this.disposed) return;
    const message = m as unknown as ServerMessage;
    for (const listener of [...this.listeners]) listener(message);
  }

  send(msg: ClientMessage): void {
    switch (msg.type) {
      case 'webviewReady':
        this.onWebviewReady();
        return;
      case 'saveLayout':
        this.onSaveLayout(msg.layout as OfficeLayout | null);
        return;
      case 'saveAgentSeats':
        this.onSaveSeats(msg.seats);
        return;
      case 'focusAgent':
        this.focusAgent(msg.id);
        return;
      case 'launchAgent':
        this.opts.onNewAgent?.();
        return;
      case 'setSoundEnabled':
        this.setPref('soundEnabled', msg.enabled);
        return;
      case 'setAlwaysShowLabels':
        this.setPref('alwaysShowLabels', msg.enabled);
        return;
      case 'setGhostHeadlessAgents':
        this.setPref('ghostOffline', msg.enabled);
        return;
      case 'setShowAreas':
        this.setPref('showAreas', msg.enabled);
        return;
      default:
        return;
    }
  }

  private onSaveLayout(layout: OfficeLayout | null): void {
    this.store.layout = layout;
    this.storage.saveLayout(layout);
    this.opts.onLayoutChange?.(layout);
  }

  private focusAgent(num: number): void {
    const id = this.branchIdOf(num);
    if (id !== undefined) this.opts.onOpen?.(id);
  }

  private setPref(key: keyof OfficePrefs, value: boolean): void {
    this.store.prefs[key] = value;
    this.storage.savePrefs({ ...this.store.prefs });
  }

  branchIdOf(num: number): string | undefined {
    return this.idByNum.get(num);
  }

  numIdOf(id: string): number | undefined {
    return this.numById.get(id);
  }

  agentFor(num: number): BranchAgent | undefined {
    const id = this.idByNum.get(num);
    return id === undefined ? undefined : this.agentById(id);
  }

  groups(): BranchAgent[] {
    return this.agents.filter((a) => a.kind === 'group');
  }

  isCustomLayout(): boolean {
    return this.store.layout !== null;
  }

  private agentById(id: string): BranchAgent | undefined {
    return this.agents.find((a) => a.id === id);
  }

  private onWebviewReady(): void {
    this.sendAssetMessages();
    const p = this.store.prefs;
    this.deliver({
      type: 'settingsLoaded',
      soundEnabled: p.soundEnabled,
      alwaysShowLabels: p.alwaysShowLabels,
      ghostHeadlessAgents: p.ghostOffline,
      showAreas: p.showAreas,
    });
    this.deliver({ type: 'layoutLoaded', layout: this.layoutToLoad() });
    this.webviewReady = true;
    this.sync(true);
  }

  private sendAssetMessages(): void {
    const a = this.assets;
    this.deliver({ type: 'providerCapabilities', readingTools: READING_TOOLS, subagentToolNames: SUBAGENT_TOOLS });
    this.deliver({ type: 'characterSpritesLoaded', characters: a.characters });
    this.deliver({ type: 'petSpritesLoaded', pets: a.pets, petNames: a.petNames });
    this.deliver({ type: 'floorTilesLoaded', sprites: a.floorSprites });
    this.deliver({ type: 'wallTilesLoaded', sets: a.wallSets });
    this.deliver({ type: 'carpetTilesLoaded', sets: a.carpetSets });
    this.deliver({ type: 'furnitureAssetsLoaded', catalog: a.furnitureCatalog, sprites: a.furnitureSprites });
    this.deliver({ type: 'areaMappingsLoaded', mappings: BRANCH_AREA_MAPPINGS });
  }

  /** The stored layout when there is one, otherwise a generated layout for the best plan. */
  private layoutToLoad(): OfficeLayout {
    const stored = this.store.layout;
    if (stored) return stored;
    const plan = this.bestPlan();
    this.generatedKey = planKey(plan);
    return generateBranchLayout(plan);
  }

  private bestPlan(): LayoutPlan {
    const { trunks, guests } = this.countKinds();
    const paneWide = this.pane.width / Math.max(this.pane.height, 1) >= WIDE_RATIO;
    const candidates: LayoutPlan[] = [];
    for (let perRow = WIDE_PLAN_PER_ROW.min; perRow <= WIDE_PLAN_PER_ROW.max; perRow++) {
      candidates.push({ trunks, guests, wide: true, perRow });
    }
    for (let perRow = NARROW_PLAN_PER_ROW.min; perRow <= NARROW_PLAN_PER_ROW.max; perRow++) {
      candidates.push({ trunks, guests, wide: false, perRow });
    }
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const plan of candidates) {
      const score = this.planScore(plan, paneWide);
      if (score > bestScore) {
        best = plan;
        bestScore = score;
      }
    }
    return best;
  }

  private planScore(plan: LayoutPlan, paneWide: boolean): number {
    const { cols, rows } = planSize(plan);
    const zoom = fitZoom(this.pane.width, this.pane.height, cols, rows);
    const shapeBonus = plan.wide === paneWide ? SHAPE_BONUS : 0;
    return zoom * ZOOM_WEIGHT + shapeBonus - cols * rows;
  }

  private countKinds(): { trunks: number; guests: number } {
    let trunks = 0;
    let guests = 0;
    for (const agent of this.agents) {
      if (agent.kind === 'trunk') trunks++;
      else if (agent.kind === 'grafted') guests++;
    }
    return { trunks, guests };
  }

  /** Sends a regenerated layout only when no custom layout is stored and the best plan changed. */
  private maybeRelayout(): void {
    if (!this.webviewReady || this.isCustomLayout()) return;
    if (planKey(this.bestPlan()) === this.generatedKey) return;
    this.deliver({ type: 'layoutLoaded', layout: this.layoutToLoad() });
  }

  setViewport(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (width === this.pane.width && height === this.pane.height) return;
    this.pane = { width, height };
    this.maybeRelayout();
  }

  applyLayout(layout: OfficeLayout | null): void {
    this.store.layout = layout;
    this.storage.saveLayout(layout);
    this.deliver({ type: 'layoutLoaded', layout: this.layoutToLoad() });
    this.opts.onLayoutChange?.(layout);
  }

  update(agents: BranchAgent[], links: BranchLink[] | undefined): void {
    this.agents = agents;
    if (!this.webviewReady) return;
    this.maybeRelayout();
    this.sync(false);
    this.runLinks(links ?? []);
  }

  private onSaveSeats(seats: Record<number, { seatId: string | null }>): void {
    const stored = { ...this.store.seats };
    for (const [num, record] of Object.entries(seats)) {
      const id = this.idByNum.get(Number(num));
      if (id === undefined) continue;
      if (record.seatId) stored[id] = record.seatId;
      else delete stored[id];
    }
    this.store.seats = stored;
    this.storage.saveSeats(stored);
  }

  customization(id: string): Customization | null {
    const entry = this.agentById(id);
    if (!entry) return null;
    const look = this.lookFor(entry);
    return {
      sprite: look.spriteKey ?? `human:${look.palette}`,
      hueShift: look.hueShift,
      seatId: this.seatIdFor(id),
    };
  }

  private seatIdFor(id: string): string | null {
    const num = this.numIdOf(id);
    const live = num === undefined ? undefined : this.getOffice().characters.get(num);
    return live?.seatId || this.store.seats[id] || null;
  }

  customize(id: string, c: Partial<Customization>): void {
    const current = this.customization(id);
    if (!current) return;
    if ('sprite' in c || 'hueShift' in c) this.saveLook(id, { ...current, ...c });
    if (c.seatId && c.seatId !== current.seatId) this.moveSeat(id, c.seatId);
    const fresh = this.customization(id);
    if (fresh) this.opts.onCustomize?.(id, fresh);
  }

  private saveLook(id: string, merged: Customization): void {
    const human = HUMAN_SPRITE.exec(merged.sprite);
    const look: TrunkLook = human
      ? { palette: Number(human[1]), hueShift: merged.hueShift }
      : { spriteKey: merged.sprite, hueShift: merged.hueShift };
    this.store.looks = { ...this.store.looks, [id]: look };
    this.storage.saveLooks({ ...this.store.looks });
    this.applyLook(id);
  }

  private moveSeat(id: string, seat: string): void {
    const num = this.numIdOf(id);
    const office = this.getOffice();
    const target = office.seats.get(seat);
    if (num === undefined || !target || target.assigned) return;
    office.reassignSeat(num, seat);
    this.onSaveSeats(office.getPersistableSeats());
  }

  resetLook(id: string): void {
    const looks = { ...this.store.looks };
    delete looks[id];
    this.store.looks = looks;
    this.storage.saveLooks({ ...looks });
    this.applyLook(id);
    const fresh = this.customization(id);
    this.opts.onCustomize?.(id, fresh as Customization);
  }

  /** Pushes the agent's look onto every office character for its number and its sub-agents. */
  private applyLook(id: string): void {
    const entry = this.agentById(id);
    const num = this.numIdOf(id);
    if (!entry || num === undefined) return;
    const look = this.lookFor(entry);
    for (const ch of this.getOffice().characters.values()) {
      if (ch.id !== num && ch.parentAgentId !== num) continue;
      ch.spriteKey = look.spriteKey;
      ch.palette = look.palette;
      ch.hueShift = look.hueShift;
    }
  }

  /** The saved look, else the guest default, else the Trunk default. */
  private lookFor(entry: BranchAgent): LookInfo {
    const saved = this.store.looks[entry.id];
    if (saved) {
      return { spriteKey: saved.spriteKey, palette: saved.palette ?? 0, hueShift: saved.hueShift ?? 0 };
    }
    if (entry.kind === 'grafted') {
      return { palette: hashIndex(entry.id, GUEST_PALETTE_COUNT), hueShift: hueFromColor(entry.colorHint) };
    }
    return { spriteKey: defaultSpriteKey(entry), palette: 0, hueShift: 0 };
  }

  /** The seat for a new agent: its kind's seat at its index among the same kind, if free. */
  private defaultSeat(agent: BranchAgent): string | undefined {
    const index = this.agents.filter((a) => a.kind === agent.kind).indexOf(agent);
    const candidate = agent.kind === 'grafted' ? `guest-sofa-${index}` : `seat-${index}`;
    const seat = this.getOffice().seats.get(candidate);
    return seat && !seat.assigned ? candidate : undefined;
  }

  /** Roster sync: numbers, creation or look repair, per-agent sync, then closings. */
  private sync(initial: boolean): void {
    for (const agent of this.agents) {
      if (agent.kind === 'group') continue;
      const num = this.ensureNumber(agent.id);
      this.ensureCharacter(agent, num, initial);
      this.syncAgent(agent, num);
    }
    this.closeMissing();
  }

  private ensureNumber(id: string): number {
    const known = this.numById.get(id);
    if (known !== undefined) return known;
    const num = this.nextNum++;
    this.numById.set(id, num);
    this.idByNum.set(num, id);
    return num;
  }

  private ensureCharacter(agent: BranchAgent, num: number, initial: boolean): void {
    const look = this.lookFor(agent);
    const ch = this.getOffice().characters.get(num);
    if (!ch) {
      this.sendCreated(agent, num, look, initial);
      this.memory.delete(agent.id);
      return;
    }
    if (ch.spriteKey !== look.spriteKey || ch.palette !== look.palette || ch.hueShift !== look.hueShift) {
      this.applyLook(agent.id);
    }
  }

  private sendCreated(agent: BranchAgent, num: number, look: LookInfo, initial: boolean): void {
    const message: Record<string, unknown> = {
      type: 'agentCreated',
      id: num,
      palette: look.palette,
      hueShift: look.hueShift,
      folderName: agent.kind === 'grafted' ? 'Grafted' : 'Trunks',
      skipSpawnEffect: initial || this.isReducedMotion(),
    };
    if (look.spriteKey !== undefined) message.spriteKey = look.spriteKey;
    const seat = this.store.seats[agent.id] ?? this.defaultSeat(agent);
    if (seat !== undefined) message.seatId = seat;
    this.deliver(message);
  }

  private closeMissing(): void {
    const live = new Set(this.agents.map((a) => a.id));
    for (const [id, num] of [...this.numById]) {
      if (live.has(id)) continue;
      this.deliver({ type: 'agentClosed', id: num });
      this.numById.delete(id);
      this.idByNum.delete(num);
      this.memory.delete(id);
    }
  }

  private snapshotFor(id: string): Snapshot {
    const existing = this.memory.get(id);
    if (existing) return existing;
    const fresh: Snapshot = {
      known: false,
      state: '',
      activity: '',
      pending: 0,
      toolRow: null,
      teamSent: false,
      subs: new Map(),
    };
    this.memory.set(id, fresh);
    return fresh;
  }

  /** Per-agent sync: the tool row, permission, team info, context and the character. */
  private syncAgent(agent: BranchAgent, id: number): void {
    const state: string = agent.state ?? '';
    const activity = agent.activity ?? '';
    const pending = Math.max(0, agent.needsYou ?? 0);
    const snap = this.snapshotFor(agent.id);
    const prevPending = snap.pending;
    const newSub = this.syncSubagents(agent, id, snap);
    const changed = !snap.known || state !== snap.state || activity !== snap.activity || newSub;
    if (changed) this.restateTool(snap, id, state, activity, pending);
    this.syncPermission(id, pending, prevPending, changed);
    if (agent.team && (changed || !snap.teamSent)) this.sendTeam(agent.team, id, snap);
    if (agent.context) {
      this.deliver({ type: 'agentContextUsage', id, contextTokens: agent.context.used, maxContextTokens: agent.context.max });
    }
    this.updateCharacter(id, state, pending);
    snap.state = state;
    snap.activity = activity;
    snap.pending = pending;
    snap.known = true;
  }

  private restateTool(snap: Snapshot, id: number, state: string, activity: string, pending: number): void {
    if (snap.toolRow) {
      this.deliver({ type: 'agentToolDone', id, toolId: snap.toolRow });
      snap.toolRow = null;
    }
    if (isDesk(state)) {
      this.openToolRow(snap, id, state, activity, pending);
      return;
    }
    this.deliver({ type: 'agentToolsClear', id });
    if (state === 'waiting') {
      this.deliver({ type: 'agentStatus', id, status: 'waiting', awaitingInput: false });
    } else {
      this.deliver({ type: 'agentStatus', id, status: 'idle' });
    }
  }

  private openToolRow(snap: Snapshot, id: number, state: string, activity: string, pending: number): void {
    const toolId = `tool-${++this.rowSeq}`;
    this.deliver({
      type: 'agentToolStart',
      id,
      toolId,
      status: activity || DESK_LABELS[state],
      toolName: this.toolFor(state, activity),
      permissionActive: pending > 0,
    });
    this.deliver({ type: 'agentStatus', id, status: 'active' });
    snap.toolRow = toolId;
  }

  /** Tool label for an at-desk agent: Grep for search or look text while reading, Read otherwise, Write for the rest. */
  private toolFor(state: string, activity: string): string {
    if (state === 'reading') {
      return /^search/i.test(activity) || /look/i.test(activity) ? 'Grep' : 'Read';
    }
    return 'Write';
  }

  private syncPermission(id: number, pending: number, prevPending: number, changed: boolean): void {
    if (pending > 0 && (changed || prevPending === 0)) {
      this.deliver({ type: 'agentToolPermission', id });
    } else if (pending === 0 && prevPending > 0) {
      this.deliver({ type: 'agentToolPermissionClear', id });
    }
  }

  private sendTeam(team: TeamInfo, id: number, snap: Snapshot): void {
    const leadUnknown = Boolean(team.lead) || team.leadId === undefined;
    this.deliver({
      type: 'agentTeamInfo',
      id,
      teamName: team.name,
      agentName: team.role,
      isTeamLead: Boolean(team.lead),
      leadAgentId: leadUnknown ? undefined : this.numIdOf(team.leadId ?? ''),
    });
    snap.teamSent = true;
  }

  /** Writes the character's pending count, waiting flags and offline presentation. */
  private updateCharacter(id: number, state: string, pending: number): void {
    const office = this.getOffice();
    const ch = office.characters.get(id);
    if (!ch) return;
    ch.needsCount = pending;
    const wasSticky = ch.waitingSticky === true;
    const sticky = state === 'waiting';
    ch.waitingSticky = sticky;
    if (wasSticky && !sticky && ch.bubbleType === 'waiting') {
      ch.bubbleTimer = Math.min(ch.bubbleTimer, WAITING_BUBBLE_CAP_SEC);
    }
    const offline = state === 'offline';
    if ((ch.offline === true) !== offline) {
      ch.offline = offline;
      office.setHeadless(id, offline);
    }
  }

  /** Sub-agent sync. Returns true when a sub-agent appears for the first time. */
  private syncSubagents(agent: BranchAgent, id: number, snap: Snapshot): boolean {
    const list = agent.subagents ?? [];
    let firstSight = false;
    for (const sub of list) {
      let mem = snap.subs.get(sub.id);
      if (!mem) {
        firstSight = true;
        mem = this.openSubtask(sub, id, snap);
      }
      const state = sub.state ?? 'working';
      const activity = sub.activity ?? '';
      if (state !== mem.state || activity !== mem.activity) this.restateSub(id, sub.id, mem, state, activity);
    }
    this.closeSubtasks(id, list, snap);
    return firstSight;
  }

  private openSubtask(sub: BranchSubagent, id: number, snap: Snapshot): SubMemory {
    this.deliver({
      type: 'agentToolStart',
      id,
      toolId: taskRowId(sub.id),
      toolName: 'Task',
      status: `Subtask: ${sub.label}`,
      runInBackground: true,
    });
    const mem: SubMemory = { state: '', activity: '', open: null };
    snap.subs.set(sub.id, mem);
    return mem;
  }

  private restateSub(id: number, key: string, mem: SubMemory, state: string, activity: string): void {
    const parentToolId = taskRowId(key);
    if (mem.open) {
      this.deliver({ type: 'subagentToolDone', id, parentToolId, toolId: mem.open });
      mem.open = null;
    }
    const toolId = `sub-${++this.rowSeq}`;
    this.deliver({ type: 'subagentToolStart', id, parentToolId, toolId, status: subStatus(state, activity) });
    if (isDesk(state)) mem.open = toolId;
    else this.deliver({ type: 'subagentToolDone', id, parentToolId, toolId });
    if (state === 'needs_you') this.deliver({ type: 'subagentToolPermission', id, parentToolId });
    mem.state = state;
    mem.activity = activity;
  }

  private closeSubtasks(id: number, list: BranchSubagent[], snap: Snapshot): void {
    const live = new Set(list.map((s) => s.id));
    for (const key of [...snap.subs.keys()]) {
      if (live.has(key)) continue;
      this.deliver({ type: 'subagentClear', id, parentToolId: taskRowId(key) });
      snap.subs.delete(key);
    }
  }

  /** Replays links that are new to this server, so the sender walks to the recipient. */
  private runLinks(links: BranchLink[]): void {
    for (const link of links) {
      const key = linkKey(link);
      if (this.shown.has(key)) continue;
      this.shown.add(key);
      const from = this.numIdOf(link.from);
      const to = this.numIdOf(link.to);
      if (from === undefined || to === undefined) continue;
      this.getOffice().startVisit(from, to);
    }
  }

  /** Visible pose for a character, or null for none. */
  poseFor(num: number): string | null {
    const ch = this.getOffice().characters.get(num);
    if (!ch) return null;
    const agentNum = ch.isSubagent && typeof ch.parentAgentId === 'number' ? ch.parentAgentId : num;
    const agent = this.agentFor(agentNum);
    if (!agent) return null;
    if ((ch.chatTimer ?? 0) > 0) return 'talk';
    if (ch.isSubagent) return null;
    if (agent.state === 'offline') return 'sleep';
    if (agent.state === 'needs_you' || agent.state === 'waiting') return 'wait';
    if (ch.state !== CharacterState.TYPE) return null;
    if (!ch.isActive) return 'sleep';
    return thinkOrSearch(agent.activity ?? '');
  }
}
