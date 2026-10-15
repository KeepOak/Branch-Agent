// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '../../../core/src/messages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, type Character, Direction, type Seat } from '../office/types.js';
import type { DecodedAssets } from './assets.js';
import { BranchServer } from './branchServer.js';
import type { Storage } from './storage.js';
import type { BranchAgent, BranchLink, MountOptions } from './types.js';

type Msg = { type: string; [key: string]: unknown };

const ASSETS = {
  characters: [],
  pets: [],
  petNames: [],
  floorSprites: [],
  wallSets: [],
  carpetSets: [],
  furnitureCatalog: [],
  furnitureSprites: {},
} as unknown as DecodedAssets;

/** A truthy stored layout, so the server does not generate one. */
const STORED_LAYOUT = { version: 1, tiles: [], furniture: [] };

function fakeOffice(numbers: number[], seatIds: string[]) {
  const characters = new Map<number, Character>();
  for (const id of numbers) {
    characters.set(id, {
      id,
      state: CharacterState.IDLE,
      isActive: false,
      isSubagent: false,
      parentAgentId: null,
    } as unknown as Character);
  }
  const seats = new Map<string, Seat>(
    seatIds.map((uid) => [uid, { uid, seatCol: 0, seatRow: 0, facingDir: Direction.DOWN, assigned: false }]),
  );
  const headless: Array<[number, boolean]> = [];
  const visits: Array<[number, number]> = [];
  const raw = {
    characters,
    seats,
    setHeadless: (id: number, on: boolean) => headless.push([id, on]),
    startVisit: (from: number, to: number) => visits.push([from, to]),
    reassignSeat: vi.fn(),
    getPersistableSeats: vi.fn(() => ({})),
  };
  return { office: raw as unknown as OfficeState, raw, chars: characters, seats, headless, visits };
}

function fakeStorage(layout: unknown, seats: Record<string, string>) {
  return {
    load: vi.fn(() => ({
      layout,
      seats: { ...seats },
      looks: {},
      prefs: { soundEnabled: true, alwaysShowLabels: true, ghostOffline: true, showAreas: false },
    })),
    saveLayout: vi.fn(),
    saveSeats: vi.fn(),
    saveLooks: vi.fn(),
    savePrefs: vi.fn(),
  };
}

interface Rig {
  server: BranchServer;
  out: Msg[];
  fake: ReturnType<typeof fakeOffice>;
  storage: ReturnType<typeof fakeStorage>;
  onOpen: ReturnType<typeof vi.fn>;
  onNewAgent: ReturnType<typeof vi.fn>;
  onLayoutChange: ReturnType<typeof vi.fn>;
  onCustomize: ReturnType<typeof vi.fn>;
}

interface RigSetup {
  numbers?: number[];
  seatIds?: string[];
  layout?: unknown;
  seats?: Record<string, string>;
}

function rig(options: Partial<MountOptions> = {}, setup: RigSetup = {}): Rig {
  const fake = fakeOffice(setup.numbers ?? [], setup.seatIds ?? []);
  const layout = 'layout' in setup ? setup.layout : STORED_LAYOUT;
  const storage = fakeStorage(layout, setup.seats ?? {});
  const onOpen = vi.fn();
  const onNewAgent = vi.fn();
  const onLayoutChange = vi.fn();
  const onCustomize = vi.fn();
  const mount = { agents: [], onOpen, onNewAgent, onLayoutChange, onCustomize, ...options } as MountOptions;
  const server = new BranchServer(mount, storage as unknown as Storage, ASSETS, () => fake.office, () => false);
  const out: Msg[] = [];
  server.onMessage((m) => out.push(m as unknown as Msg));
  return { server, out, fake, storage, onOpen, onNewAgent, onLayoutChange, onCustomize };
}

/** Sends the webview ready message and returns what the server sent for it. */
function ready(r: Rig): Msg[] {
  r.out.length = 0;
  r.server.send({ type: 'webviewReady' } as ClientMessage);
  return [...r.out];
}

function trunk(id: string, over: Partial<BranchAgent> = {}): BranchAgent {
  return { id, name: id, kind: 'trunk', state: 'working', ...over } as unknown as BranchAgent;
}

describe('constructor', () => {
  it('sends nothing before the webview is ready', () => {
    const r = rig({ agents: [trunk('a1')] });
    expect(r.out).toEqual([]);
  });

  it('applies a boolean sound setting from the options in memory only', () => {
    const r = rig({ soundEnabled: false });
    const settings = ready(r).find((m) => m.type === 'settingsLoaded');
    expect(settings?.soundEnabled).toBe(false);
    expect(r.storage.savePrefs).not.toHaveBeenCalled();
  });

  it('ignores a sound setting that is not a boolean', () => {
    const r = rig({ soundEnabled: 'no' as unknown as boolean });
    const settings = ready(r).find((m) => m.type === 'settingsLoaded');
    expect(settings?.soundEnabled).toBe(true);
  });

  it('marks links older than the mount time as shown and replays newer ones once', () => {
    const past: BranchLink = { from: 'a1', to: 'a2', at: 1 };
    const future: BranchLink = { from: 'a1', to: 'a2', at: Date.now() + 60000 };
    const agents = [trunk('a1'), trunk('a2')];
    const r = rig({ agents, links: [past, future] }, { numbers: [1, 2], seatIds: ['seat-0', 'seat-1'] });
    ready(r);
    r.server.update(agents, [past, future]);
    expect(r.fake.visits).toEqual([[1, 2]]);
    r.server.update(agents, [past, future]);
    expect(r.fake.visits).toEqual([[1, 2]]);
  });
});

describe('send path', () => {
  it('sends the handshake in order, then creates the roster', () => {
    const r = rig({ agents: [trunk('a1')] }, { seatIds: ['seat-0'] });
    const types = ready(r).map((m) => m.type);
    expect(types.slice(0, 11)).toEqual([
      'providerCapabilities',
      'characterSpritesLoaded',
      'petSpritesLoaded',
      'floorTilesLoaded',
      'wallTilesLoaded',
      'carpetTilesLoaded',
      'furnitureAssetsLoaded',
      'areaMappingsLoaded',
      'settingsLoaded',
      'layoutLoaded',
      'agentCreated',
    ]);
  });

  it('creates a Trunk in the Trunks folder at its default seat with a pebble look', () => {
    const r = rig({ agents: [trunk('a1', { colorHint: '#ff0000' })] }, { seatIds: ['seat-0'] });
    const created = ready(r).find((m) => m.type === 'agentCreated');
    expect(created).toMatchObject({
      id: 1,
      folderName: 'Trunks',
      seatId: 'seat-0',
      spriteKey: 'pebble:0:round:#ff0000',
      palette: 0,
      hueShift: 0,
      skipSpawnEffect: true,
    });
  });

  it('creates a guest in the Grafted folder with a palette index and no sprite key', () => {
    const guest = trunk('g1', { kind: 'grafted' } as Partial<BranchAgent>);
    const r = rig({ agents: [guest] }, { seatIds: ['guest-sofa-0'] });
    const created = ready(r).find((m) => m.type === 'agentCreated');
    expect(created?.folderName).toBe('Grafted');
    expect(created?.seatId).toBe('guest-sofa-0');
    expect('spriteKey' in (created ?? {})).toBe(false);
    expect(created?.palette).toBeGreaterThanOrEqual(0);
    expect(created?.palette).toBeLessThan(6);
  });

  it('never numbers a group, and lists it through groups()', () => {
    const group = trunk('m1', { kind: 'group' } as Partial<BranchAgent>);
    const r = rig({ agents: [group] });
    expect(ready(r).some((m) => m.type === 'agentCreated')).toBe(false);
    expect(r.server.groups().map((a) => a.id)).toEqual(['m1']);
    expect(r.server.numIdOf('m1')).toBeUndefined();
  });

  it('closes a departed agent and gives a returning agent a new number', () => {
    const r = rig({ agents: [trunk('a1')] }, { seatIds: ['seat-0'] });
    ready(r);
    r.out.length = 0;
    r.server.update([], []);
    expect(r.out).toContainEqual({ type: 'agentClosed', id: 1 });
    r.out.length = 0;
    r.server.update([trunk('a1')], []);
    expect(r.out.find((m) => m.type === 'agentCreated')?.id).toBe(2);
  });

  it('focusAgent opens the roster id for a known number and ignores others', () => {
    const r = rig({ agents: [trunk('a1')] }, { numbers: [1] });
    ready(r);
    r.server.send({ type: 'focusAgent', id: 1 } as ClientMessage);
    r.server.send({ type: 'focusAgent', id: 9 } as ClientMessage);
    expect(r.onOpen.mock.calls).toEqual([['a1']]);
  });

  it('launchAgent calls onNewAgent', () => {
    const r = rig();
    r.server.send({ type: 'launchAgent' } as ClientMessage);
    expect(r.onNewAgent).toHaveBeenCalledOnce();
  });

  it('setSoundEnabled stores the flag and sends no message', () => {
    const r = rig();
    ready(r);
    r.out.length = 0;
    r.server.send({ type: 'setSoundEnabled', enabled: false } as ClientMessage);
    expect(r.storage.savePrefs).toHaveBeenCalledWith(expect.objectContaining({ soundEnabled: false }));
    expect(r.out).toEqual([]);
  });

  it('ignores message kinds outside the receive set', () => {
    const r = rig();
    ready(r);
    r.out.length = 0;
    r.server.send({ type: 'closeAgent', id: 1 } as ClientMessage);
    expect(r.out).toEqual([]);
    expect(r.storage.savePrefs).not.toHaveBeenCalled();
    expect(r.storage.saveLayout).not.toHaveBeenCalled();
  });

  it('saveLayout stores the layout, writes it and calls onLayoutChange without a message', () => {
    const r = rig();
    ready(r);
    r.out.length = 0;
    const layout = { version: 1, tiles: [1], furniture: [] };
    r.server.send({ type: 'saveLayout', layout } as unknown as ClientMessage);
    expect(r.storage.saveLayout).toHaveBeenCalledWith(layout);
    expect(r.onLayoutChange).toHaveBeenCalledWith(layout);
    expect(r.out).toEqual([]);
    expect(r.server.isCustomLayout()).toBe(true);
  });

  it('saveAgentSeats keeps seats for known numbers and drops empty ones', () => {
    const r = rig({ agents: [trunk('a1'), trunk('a2')] }, { numbers: [1, 2], seatIds: ['seat-1'] });
    ready(r);
    r.server.send({
      type: 'saveAgentSeats',
      seats: {
        1: { palette: 0, hueShift: 0, seatId: 'seat-1' },
        2: { palette: 0, hueShift: 0, seatId: null },
        9: { palette: 0, hueShift: 0, seatId: 'seat-2' },
      },
    } as unknown as ClientMessage);
    expect(r.storage.saveSeats).toHaveBeenLastCalledWith({ a1: 'seat-1' });
  });
});

describe('layout', () => {
  it('applyLayout(null) sends a generated layout, writes null and reports the reset', () => {
    const r = rig({ agents: [] }, { layout: null });
    ready(r);
    r.out.length = 0;
    r.server.applyLayout(null);
    const sent = r.out.find((m) => m.type === 'layoutLoaded');
    expect(typeof (sent?.layout as { cols?: unknown } | undefined)?.cols).toBe('number');
    expect(r.storage.saveLayout).toHaveBeenCalledWith(null);
    expect(r.onLayoutChange).toHaveBeenCalledWith(null);
    expect(r.server.isCustomLayout()).toBe(false);
  });

  it('applyLayout sends the given layout back as it was given', () => {
    const r = rig();
    ready(r);
    r.out.length = 0;
    const layout = { version: 1, tiles: [], furniture: [] } as unknown as Parameters<BranchServer['applyLayout']>[0];
    r.server.applyLayout(layout);
    expect(r.out.find((m) => m.type === 'layoutLoaded')?.layout).toBe(layout);
  });

  it('a stored custom layout is never regenerated on resize', () => {
    const r = rig({ agents: [trunk('a1')] }, { numbers: [1], seatIds: ['seat-0'] });
    ready(r);
    r.out.length = 0;
    r.server.setViewport(300, 2000);
    expect(r.out.some((m) => m.type === 'layoutLoaded')).toBe(false);
  });

  it('setViewport ignores a zero size and an unchanged size', () => {
    const r = rig({}, { layout: null });
    ready(r);
    r.out.length = 0;
    r.server.setViewport(0, 800);
    r.server.setViewport(1280, 800);
    expect(r.out).toEqual([]);
  });
});

describe('customization', () => {
  it('reports the default look, the seat, and null for an unknown id', () => {
    const r = rig({ agents: [trunk('a1', { colorHint: '#ff0000' })] }, { numbers: [1], seatIds: ['seat-0'] });
    ready(r);
    expect(r.server.customization('a1')).toEqual({ sprite: 'pebble:0:round:#ff0000', hueShift: 0, seatId: null });
    expect(r.server.customization('nope')).toBeNull();
  });

  it('saves a human sprite as a palette and reads it back', () => {
    const r = rig({ agents: [trunk('a1')] }, { numbers: [1] });
    ready(r);
    r.server.customize('a1', { sprite: 'human:2' });
    expect(r.storage.saveLooks).toHaveBeenCalled();
    expect(r.server.customization('a1')?.sprite).toBe('human:2');
    expect(r.onCustomize).toHaveBeenLastCalledWith('a1', expect.objectContaining({ sprite: 'human:2' }));
  });

  it('saves other sprites with their hue shift and pushes the look onto the character', () => {
    const r = rig({ agents: [trunk('a1')] }, { numbers: [1] });
    ready(r);
    r.server.customize('a1', { sprite: 'look:ember', hueShift: 45 });
    expect(r.server.customization('a1')).toMatchObject({ sprite: 'look:ember', hueShift: 45 });
    expect(r.fake.chars.get(1)?.spriteKey).toBe('look:ember');
    expect(r.fake.chars.get(1)?.hueShift).toBe(45);
  });

  it('saves a hue shift set to undefined and reads it back as 0', () => {
    const r = rig({ agents: [trunk('a1')] }, { numbers: [1] });
    ready(r);
    r.server.customize('a1', { sprite: 'look:ember', hueShift: 90 });
    r.server.customize('a1', { hueShift: undefined });
    expect(r.server.customization('a1')?.hueShift).toBe(0);
  });

  it('moves an agent to a free seat and writes the seat map, but not onto a taken seat', () => {
    const r = rig({ agents: [trunk('a1')] }, { numbers: [1], seatIds: ['seat-0', 'seat-1'] });
    ready(r);
    r.server.customize('a1', { seatId: 'seat-1' });
    expect(r.fake.raw.reassignSeat).toHaveBeenCalledWith(1, 'seat-1');
    expect(r.storage.saveSeats).toHaveBeenCalled();
    r.fake.seats.get('seat-0')!.assigned = true;
    r.server.customize('a1', { seatId: 'seat-0' });
    expect(r.fake.raw.reassignSeat).toHaveBeenCalledTimes(1);
  });

  it('ignores a seat change for an agent with no office number yet, but still fires the callback', () => {
    const r = rig({ agents: [trunk('a1')] }, { seatIds: ['seat-1'] });
    r.server.customize('a1', { seatId: 'seat-1' });
    expect(r.fake.raw.reassignSeat).not.toHaveBeenCalled();
    expect(r.storage.saveSeats).not.toHaveBeenCalled();
    expect(r.onCustomize).toHaveBeenCalledWith('a1', expect.objectContaining({ seatId: null }));
  });

  it('ignores an unknown id', () => {
    const r = rig({ agents: [trunk('a1')] }, { numbers: [1] });
    ready(r);
    r.server.customize('nope', { sprite: 'human:1' });
    expect(r.storage.saveLooks).not.toHaveBeenCalled();
    expect(r.onCustomize).not.toHaveBeenCalled();
  });

  it('resetLook removes the saved look and reports the default, and reports none for an unknown id', () => {
    const r = rig({ agents: [trunk('a1', { colorHint: '#00ff00' })] }, { numbers: [1] });
    ready(r);
    r.server.customize('a1', { sprite: 'look:ember' });
    r.server.resetLook('a1');
    expect(r.onCustomize).toHaveBeenLastCalledWith(
      'a1',
      expect.objectContaining({ sprite: 'pebble:0:round:#00ff00' }),
    );
    r.server.resetLook('nope');
    expect(r.onCustomize).toHaveBeenLastCalledWith('nope', null);
  });
});

describe('observation', () => {
  it('keeps the id and number maps in step with the roster sync', () => {
    const r = rig({ agents: [trunk('a1'), trunk('a2')] }, { numbers: [1, 2] });
    ready(r);
    expect(r.server.branchIdOf(2)).toBe('a2');
    expect(r.server.numIdOf('a1')).toBe(1);
    expect(r.server.agentFor(1)?.id).toBe('a1');
    expect(r.server.branchIdOf(9)).toBeUndefined();
  });

  it('shows wait for a waiting Trunk, sleep for a typing idle one, and none for a standing one', () => {
    const r = rig({ agents: [trunk('a1', { state: 'waiting' }), trunk('a2', { state: 'resting' })] }, {
      numbers: [1, 2],
    });
    ready(r);
    r.fake.chars.get(2)!.state = CharacterState.TYPE;
    expect(r.server.poseFor(1)).toBe('wait');
    expect(r.server.poseFor(2)).toBe('sleep');
    expect(r.server.poseFor(9)).toBeNull();
  });
});

describe('disconnect', () => {
  it('dispose stops delivery to every listener and is harmless twice', () => {
    const r = rig({ agents: [trunk('a1')] });
    const spy = vi.fn();
    r.server.onMessage(spy);
    r.server.dispose();
    r.server.dispose();
    ready(r);
    expect(spy).not.toHaveBeenCalled();
    expect(r.out).toEqual([]);
  });

  it('an unsubscribed listener gets nothing more, and removing it twice is harmless', () => {
    const r = rig({ agents: [trunk('a1')] });
    const spy = vi.fn();
    const off = r.server.onMessage(spy);
    off();
    off();
    ready(r);
    expect(spy).not.toHaveBeenCalled();
    expect(r.out.length).toBeGreaterThan(0);
  });

  it('a listener added after dispose is kept but never called', () => {
    const r = rig({ agents: [trunk('a1')] });
    r.server.dispose();
    const spy = vi.fn();
    r.server.onMessage(spy);
    ready(r);
    expect(spy).not.toHaveBeenCalled();
  });

  it('onStateChange returns a removal function and the state stays connected', () => {
    const r = rig();
    const off = r.server.onStateChange();
    expect(typeof off).toBe('function');
    off();
    expect(r.server.state).toBe('connected');
  });
});
