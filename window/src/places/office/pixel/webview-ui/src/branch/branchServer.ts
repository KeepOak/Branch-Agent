/**
 * The office's "server", in memory. Upstream's webview talks to a server (VS Code extension or the
 * standalone CLI) over a MessageTransport; this class is that transport and plays the server's part
 * for Branch: it sends the same ServerMessages upstream's agentRuntime would (assets, layout, settings,
 * agentCreated / agentToolStart / agentStatus / agentToolPermission / subagent* / agentClosed) from the
 * Branch roster, and answers the webview's ClientMessages (saveLayout, saveAgentSeats, focusAgent, ...)
 * with Branch callbacks and browser storage.
 *
 * State mapping (Branch → upstream). The OpenClaw dashboards map the same way: SweetSophia
 * openclaw-pixel-agents src/game/GameEngine.ts (typing/running_command → typing, reading/thinking →
 * reading, waiting_input → idle) and jaffer1979 server/openclawParser.ts.
 *   working    agentToolStart(Write, activity)         → walks to its desk and types, monitor on
 *   reading    agentToolStart(Read, activity)          → reads at its desk
 *   waiting    agentToolsClear + agentStatus(waiting)  → waiting bubble that stays up, wanders
 *   needs_you  agentToolStart + agentToolPermission    → stays at the desk under the amber bubble
 *   resting    agentToolsClear + agentStatus(idle)     → upstream idle: wanders, rests at its seat
 *   offline    agentToolsClear + headless              → dimmed ghost, seated, still
 *   needsYou>0 agentToolPermission (any state)         → amber "!" bubble with the count
 *   subagents  agentToolStart(Task, background) + subagentToolStart/Done/Clear → extra characters
 */
import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout } from '../office/types.js';
import { CharacterState } from '../office/types.js';
import type { MessageTransport, TransportState } from '../transport/types.js';
import type { DecodedAssets } from './assets.js';
import { BRANCH_AREA_MAPPINGS, generateBranchLayout, type LayoutPlan, planSize } from './branchLayout.js';
import { fitZoom } from './fit.js';
import type { OfficeStore, Storage, TrunkLook } from './storage.js';
import { defaultSpriteKey } from './trunkSprites.js';
import type { BranchAgent, BranchLink, BranchSubagent, Customization, MountOptions } from './types.js';

const READING_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];
const SUBAGENT_TOOLS = ['Task', 'Agent'];

interface Snapshot {
  state: string;
  activity: string;
  needs: number;
  toolId: string | null;
  subs: Map<string, { state: string; activity: string; toolId: string | null }>;
  team?: boolean;
}

function hashIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

/** Hue (degrees, rounded to 15°) of a #rrggbb colour; 0 for none or a grey. */
function hueOf(hex: string | undefined): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (Math.round((h * 60 + 360) / 15) * 15) % 360;
}

function planKey(p: LayoutPlan): string {
  return `${p.wide}|${p.perRow}|${p.trunks}|${p.guests}`;
}

function linkKey(l: BranchLink): string {
  return `${l.from}|${l.to}|${String(l.at)}`;
}

function linkTime(l: BranchLink): number {
  return typeof l.at === 'number' ? l.at : Date.parse(l.at) || 0;
}

export class BranchServer implements MessageTransport {
  readonly state: TransportState = 'connected';
  readonly ready: Promise<void> = Promise.resolve();
  private handlers = new Set<(m: ServerMessage) => void>();
  private ids = new Map<string, number>();
  private branchIds = new Map<number, string>();
  private nextId = 1;
  private seq = 0;
  private snaps = new Map<string, Snapshot>();
  private agents: BranchAgent[] = [];
  private seenLinks = new Set<string>();
  private readonly mountedAt = Date.now();
  private webviewReady = false;
  private viewport = { w: 1280, h: 800 };
  private generatedFor = '';
  private disposed = false;
  store: OfficeStore;

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
    for (const l of opts.links ?? []) if (linkTime(l) < this.mountedAt) this.seenLinks.add(linkKey(l));
  }

  // ── MessageTransport ────────────────────────────────────────────

  onMessage(handler: (m: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStateChange(): () => void {
    return () => {};
  }

  dispose(): void {
    this.disposed = true;
    this.handlers.clear();
  }

  private deliver(m: Record<string, unknown>): void {
    if (this.disposed) return;
    for (const h of [...this.handlers]) h(m as unknown as ServerMessage);
  }

  send(msg: ClientMessage): void {
    const m = msg as unknown as Record<string, unknown>;
    switch (m.type) {
      case 'webviewReady':
        this.onWebviewReady();
        break;
      case 'saveLayout':
        this.store.layout = m.layout as unknown as OfficeLayout;
        this.storage.saveLayout(this.store.layout);
        this.opts.onLayoutChange?.(this.store.layout);
        break;
      case 'saveAgentSeats':
        this.onSaveSeats(m.seats as Record<number, { seatId: string | null }>);
        break;
      case 'focusAgent': {
        const bid = this.branchIds.get(m.id as number);
        if (bid) this.opts.onOpen?.(bid);
        break;
      }
      case 'launchAgent':
        this.opts.onNewAgent?.();
        break;
      case 'setSoundEnabled':
        this.store.prefs.soundEnabled = m.enabled as boolean;
        this.storage.savePrefs(this.store.prefs);
        break;
      case 'setAlwaysShowLabels':
        this.store.prefs.alwaysShowLabels = m.enabled as boolean;
        this.storage.savePrefs(this.store.prefs);
        break;
      case 'setGhostHeadlessAgents':
        this.store.prefs.ghostOffline = m.enabled as boolean;
        this.storage.savePrefs(this.store.prefs);
        break;
      case 'setShowAreas':
        this.store.prefs.showAreas = m.enabled as boolean;
        this.storage.savePrefs(this.store.prefs);
        break;
      default:
        // closeAgent, requestDiagnostics, hooks/consent/version/asset-directory messages have no
        // Branch counterpart (see INTEGRATION.md).
        break;
    }
  }

  // ── Server side ─────────────────────────────────────────────────

  branchIdOf(num: number): string | undefined {
    return this.branchIds.get(num);
  }

  numIdOf(id: string): number | undefined {
    return this.ids.get(id);
  }

  agentFor(num: number): BranchAgent | undefined {
    const bid = this.branchIds.get(num);
    return bid ? this.agents.find((a) => a.id === bid) : undefined;
  }

  groups(): BranchAgent[] {
    return this.agents.filter((a) => a.kind === 'group');
  }

  isCustomLayout(): boolean {
    return this.store.layout !== null;
  }

  private onWebviewReady(): void {
    const a = this.assets;
    this.deliver({ type: 'providerCapabilities', readingTools: READING_TOOLS, subagentToolNames: SUBAGENT_TOOLS });
    this.deliver({ type: 'characterSpritesLoaded', characters: a.characters });
    this.deliver({ type: 'petSpritesLoaded', pets: a.pets, petNames: a.petNames });
    this.deliver({ type: 'floorTilesLoaded', sprites: a.floorSprites });
    this.deliver({ type: 'wallTilesLoaded', sets: a.wallSets });
    this.deliver({ type: 'carpetTilesLoaded', sets: a.carpetSets });
    this.deliver({ type: 'furnitureAssetsLoaded', catalog: a.furnitureCatalog, sprites: a.furnitureSprites });
    this.deliver({ type: 'areaMappingsLoaded', mappings: BRANCH_AREA_MAPPINGS });
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

  private layoutToLoad(): OfficeLayout {
    if (this.store.layout) return this.store.layout;
    const plan = this.bestPlan();
    this.generatedFor = planKey(plan);
    return generateBranchLayout(plan);
  }

  /**
   * The default office for this pane: every wide and narrow arrangement is tried and the one with the
   * largest integer zoom wins (ties go to the arrangement that matches the pane's shape, then the
   * smaller office), so the office fills its pane however many Trunks there are.
   */
  private bestPlan(): LayoutPlan {
    const trunks = this.agents.filter((x) => x.kind === 'trunk').length;
    const guests = this.agents.filter((x) => x.kind === 'grafted').length;
    const { w, h } = this.viewport;
    const wideish = w / Math.max(1, h) >= 1.15;
    const options: LayoutPlan[] = [];
    for (let perRow = 3; perRow <= 8; perRow++) options.push({ trunks, guests, wide: true, perRow });
    for (let perRow = 2; perRow <= 4; perRow++) options.push({ trunks, guests, wide: false, perRow });
    let best = options[0];
    let bestScore = -Infinity;
    for (const plan of options) {
      const { cols, rows } = planSize(plan);
      const zoom = fitZoom(w, h, cols, rows);
      const score = zoom * 1e6 + (plan.wide === wideish ? 1e5 : 0) - cols * rows;
      if (score > bestScore) {
        bestScore = score;
        best = plan;
      }
    }
    return best;
  }

  /** Re-generate the default office when the pane or the roster changes its best arrangement. */
  private maybeRelayout(): void {
    if (!this.webviewReady || this.store.layout) return;
    if (planKey(this.bestPlan()) === this.generatedFor) return;
    this.deliver({ type: 'layoutLoaded', layout: this.layoutToLoad() });
  }

  setViewport(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (width === this.viewport.w && height === this.viewport.h) return;
    this.viewport = { w: width, h: height };
    this.maybeRelayout();
  }

  /** Apply a layout the owner imported or reset to (null = back to the generated default). */
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
    for (const [num, s] of Object.entries(seats)) {
      const bid = this.branchIds.get(Number(num));
      if (!bid) continue;
      if (s.seatId) this.store.seats[bid] = s.seatId;
      else delete this.store.seats[bid];
    }
    this.storage.saveSeats(this.store.seats);
  }

  // ── Looks / customization ───────────────────────────────────────

  lookOf(agent: BranchAgent): { spriteKey: string | undefined; palette: number; hueShift: number } {
    const saved: TrunkLook | undefined = this.store.looks[agent.id];
    if (saved) return { spriteKey: saved.spriteKey, palette: saved.palette ?? 0, hueShift: saved.hueShift ?? 0 };
    if (agent.kind === 'grafted') {
      // Upstream office workers; the agent's own colour (if the app gives one) seeds the hue shift,
      // the way upstream hue-shifts repeated palettes.
      return { spriteKey: undefined, palette: hashIndex(agent.id, 6), hueShift: hueOf(agent.colorHint) };
    }
    return { spriteKey: defaultSpriteKey(agent), palette: 0, hueShift: 0 };
  }

  customization(id: string): Customization | null {
    const agent = this.agents.find((a) => a.id === id);
    if (!agent) return null;
    const look = this.lookOf(agent);
    const num = this.ids.get(id);
    const ch = num !== undefined ? this.getOffice().characters.get(num) : undefined;
    return {
      sprite: look.spriteKey ?? `human:${look.palette}`,
      hueShift: look.hueShift,
      seatId: ch?.seatId ?? this.store.seats[id] ?? null,
    };
  }

  customize(id: string, c: Partial<Customization>): void {
    const agent = this.agents.find((a) => a.id === id);
    if (!agent) return;
    const cur = this.customization(id)!;
    const next: Customization = { ...cur, ...c };
    if (c.sprite !== undefined || c.hueShift !== undefined) {
      const human = /^human:(\d)$/.exec(next.sprite);
      const look: TrunkLook = human
        ? { palette: Number(human[1]), hueShift: next.hueShift }
        : { spriteKey: next.sprite, hueShift: next.hueShift };
      this.store.looks[id] = look;
      this.storage.saveLooks(this.store.looks);
      this.applyLook(id);
    }
    const os = this.getOffice();
    const num = this.ids.get(id);
    if (c.seatId !== undefined && num !== undefined && c.seatId !== cur.seatId) {
      if (c.seatId && os.seats.get(c.seatId) && !os.seats.get(c.seatId)!.assigned) {
        os.reassignSeat(num, c.seatId);
        this.onSaveSeats(os.getPersistableSeats());
      }
    }
    this.opts.onCustomize?.(id, this.customization(id)!);
  }

  /** Reset a Trunk to the look it has in the app (its colour hint / app look). */
  resetLook(id: string): void {
    delete this.store.looks[id];
    this.storage.saveLooks(this.store.looks);
    this.applyLook(id);
    this.opts.onCustomize?.(id, this.customization(id)!);
  }

  private applyLook(id: string): void {
    const agent = this.agents.find((a) => a.id === id);
    const num = this.ids.get(id);
    if (!agent || num === undefined) return;
    const look = this.lookOf(agent);
    const os = this.getOffice();
    for (const ch of os.characters.values()) {
      if (ch.id === num || ch.parentAgentId === num) {
        ch.spriteKey = look.spriteKey;
        ch.palette = look.palette;
        ch.hueShift = look.hueShift;
      }
    }
  }

  // ── Roster → upstream messages ──────────────────────────────────

  private sync(initial: boolean): void {
    const os = this.getOffice();
    const live = new Set<string>();
    for (const agent of this.agents) {
      if (agent.kind === 'group') continue;
      live.add(agent.id);
      let num = this.ids.get(agent.id);
      if (num === undefined) {
        num = this.nextId++;
        this.ids.set(agent.id, num);
        this.branchIds.set(num, agent.id);
      }
      if (!os.characters.has(num)) {
        const look = this.lookOf(agent);
        this.deliver({
          type: 'agentCreated',
          id: num,
          palette: look.palette,
          hueShift: look.hueShift,
          spriteKey: look.spriteKey,
          seatId: this.store.seats[agent.id] ?? this.defaultSeat(agent),
          folderName: agent.kind === 'grafted' ? 'Grafted' : 'Trunks',
          skipSpawnEffect: initial || this.isReducedMotion(),
        });
        this.snaps.delete(agent.id);
      }
      this.syncAgent(agent, num);
    }
    for (const [bid, num] of [...this.ids]) {
      if (live.has(bid)) continue;
      this.deliver({ type: 'agentClosed', id: num });
      this.ids.delete(bid);
      this.branchIds.delete(num);
      this.snaps.delete(bid);
    }
  }

  /** First visit: Trunks take the desks in roster order, guests one sofa each (upstream would pick
   *  randomly; a stable order keeps every Trunk at the same desk on every device). */
  private defaultSeat(agent: BranchAgent): string | undefined {
    const same = this.agents.filter((a) => a.kind === agent.kind);
    const i = same.findIndex((a) => a.id === agent.id);
    const uid = agent.kind === 'grafted' ? `guest-sofa-${i}` : `seat-${i}`;
    const seat = this.getOffice().seats.get(uid);
    return seat && !seat.assigned ? uid : undefined;
  }

  private toolFor(state: string, activity: string): string {
    if (state === 'reading') return /^search|look/i.test(activity) ? 'Grep' : 'Read';
    return 'Write';
  }

  private syncAgent(agent: BranchAgent, id: number): void {
    const os = this.getOffice();
    const needs = Math.max(0, agent.needsYou ?? 0);
    const activity = agent.activity ?? '';
    let snap = this.snaps.get(agent.id);
    if (!snap) {
      snap = { state: '', activity: '', needs: 0, toolId: null, subs: new Map() };
      this.snaps.set(agent.id, snap);
    }
    const subsChanged = this.syncSubagents(agent, id, snap);
    const stateChanged = snap.state !== agent.state || snap.activity !== activity || subsChanged;

    if (stateChanged) {
      const atDesk = agent.state === 'working' || agent.state === 'reading' || agent.state === 'needs_you';
      if (snap.toolId) this.deliver({ type: 'agentToolDone', id, toolId: snap.toolId });
      snap.toolId = null;
      if (atDesk) {
        const toolId = `b${++this.seq}`;
        const status =
          activity ||
          (agent.state === 'reading' ? 'Reading' : agent.state === 'needs_you' ? 'Waiting for your yes' : 'Working');
        this.deliver({
          type: 'agentToolStart',
          id,
          toolId,
          status,
          toolName: this.toolFor(agent.state, activity),
          permissionActive: needs > 0,
        });
        this.deliver({ type: 'agentStatus', id, status: 'active' });
        snap.toolId = toolId;
      } else {
        this.deliver({ type: 'agentToolsClear', id });
        if (agent.state === 'waiting') {
          // A finished turn (not awaitingInput) so upstream shows the waiting bubble; Branch keeps it up.
          this.deliver({ type: 'agentStatus', id, status: 'waiting', awaitingInput: false });
        } else {
          this.deliver({ type: 'agentStatus', id, status: 'idle' });
        }
      }
    }
    if (needs > 0 && (stateChanged || snap.needs === 0)) {
      this.deliver({ type: 'agentToolPermission', id });
    } else if (needs === 0 && snap.needs > 0) {
      this.deliver({ type: 'agentToolPermissionClear', id });
    }
    if (agent.team && (stateChanged || !snap.team)) {
      const lead = agent.team.lead ? undefined : this.ids.get(agent.team.leadId ?? '');
      this.deliver({
        type: 'agentTeamInfo',
        id,
        teamName: agent.team.name,
        agentName: agent.team.role,
        isTeamLead: !!agent.team.lead,
        leadAgentId: lead,
      });
      snap.team = true;
    }
    if (agent.context) {
      this.deliver({
        type: 'agentContextUsage',
        id,
        contextTokens: agent.context.used,
        maxContextTokens: agent.context.max,
      });
    }

    const ch = os.characters.get(id);
    if (ch) {
      const wasWaiting = ch.waitingSticky;
      ch.needsCount = needs;
      ch.waitingSticky = agent.state === 'waiting';
      if (wasWaiting && !ch.waitingSticky && ch.bubbleType === 'waiting') ch.bubbleTimer = Math.min(ch.bubbleTimer, 0.3);
      const offline = agent.state === 'offline';
      if (ch.offline !== offline) {
        ch.offline = offline;
        os.setHeadless(id, offline);
      }
    }
    snap.state = agent.state;
    snap.activity = activity;
    snap.needs = needs;
  }

  /** Returns true when sub-agent characters were created (their Task tool start re-activates the parent). */
  private syncSubagents(agent: BranchAgent, id: number, snap: Snapshot): boolean {
    const subs: BranchSubagent[] = agent.subagents ?? [];
    const live = new Set(subs.map((s) => s.id));
    let created = false;
    for (const sub of subs) {
      const parentToolId = `sub:${sub.id}`;
      let s = snap.subs.get(sub.id);
      if (!s) {
        this.deliver({
          type: 'agentToolStart',
          id,
          toolId: parentToolId,
          status: `Subtask: ${sub.label}`,
          toolName: 'Task',
          runInBackground: true,
        });
        s = { state: '', activity: '', toolId: null };
        snap.subs.set(sub.id, s);
        created = true;
      }
      const st = sub.state ?? 'working';
      const act = sub.activity ?? '';
      if (s.state === st && s.activity === act) continue;
      if (s.toolId) this.deliver({ type: 'subagentToolDone', id, parentToolId, toolId: s.toolId });
      s.toolId = null;
      if (st === 'working' || st === 'reading' || st === 'needs_you') {
        const toolId = `s${++this.seq}`;
        const status = act || (st === 'reading' ? 'Reading' : 'Writing');
        this.deliver({
          type: 'subagentToolStart',
          id,
          parentToolId,
          toolId,
          status: st === 'reading' && !/^Read/.test(status) ? `Reading ${status}` : status,
        });
        s.toolId = toolId;
      } else {
        // A resting sub-agent: one finished row, so upstream's sub-agent idle rule stops its typing.
        const toolId = `s${++this.seq}`;
        this.deliver({ type: 'subagentToolStart', id, parentToolId, toolId, status: act || 'Idle' });
        this.deliver({ type: 'subagentToolDone', id, parentToolId, toolId });
      }
      if (st === 'needs_you') this.deliver({ type: 'subagentToolPermission', id, parentToolId });
      s.state = st;
      s.activity = act;
    }
    for (const subId of [...snap.subs.keys()]) {
      if (live.has(subId)) continue;
      this.deliver({ type: 'subagentClear', id, parentToolId: `sub:${subId}` });
      snap.subs.delete(subId);
    }
    return created;
  }

  // ── A2A links ───────────────────────────────────────────────────

  private runLinks(links: BranchLink[]): void {
    const os = this.getOffice();
    for (const l of links) {
      const key = linkKey(l);
      if (this.seenLinks.has(key)) continue;
      this.seenLinks.add(key);
      const from = this.ids.get(l.from);
      const to = this.ids.get(l.to);
      if (from === undefined || to === undefined) continue;
      os.startVisit(from, to);
    }
  }

  /** Pose for Trunk looks this frame (upstream humans have no poses and ignore it). */
  poseFor(num: number): string | null {
    const ch = this.getOffice().characters.get(num);
    if (!ch) return null;
    const agentNum = ch.isSubagent && ch.parentAgentId !== null ? ch.parentAgentId : num;
    const agent = this.agentFor(agentNum);
    if (!agent) return null;
    if (ch.chatTimer && ch.chatTimer > 0) return 'talk';
    if (ch.isSubagent) return null;
    if (agent.state === 'offline') return 'sleep';
    if (agent.state === 'needs_you' || agent.state === 'waiting') return 'wait';
    if (ch.state === CharacterState.TYPE) {
      if (ch.isActive) return /^think/i.test(agent.activity ?? '') ? 'think' : /^search/i.test(agent.activity ?? '') ? 'search' : null;
      return 'sleep';
    }
    return null; // standing: upstream's walk frame for the direction it faces
  }
}
