// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBranchLayout } from './branchLayout';
import { BranchServer } from './branchServer';
import { defaultPrefs, Storage, type OfficeStore } from './storage';
import type { BranchAgent, BranchLink, MountOptions } from './types';
import { OfficeState } from '../office/engine/officeState';
import { type Character, CharacterState, Direction, type OfficeLayout } from '../office/types';

type Args = ConstructorParameters<typeof BranchServer>;
type Client = Parameters<BranchServer['send']>[0];
type Sent = { type: string } & Record<string, unknown>;
type Sub = NonNullable<BranchAgent['subagents']>[number];
interface Rig {
  server: BranchServer;
  office: OfficeState;
  sent: Sent[];
  saved: Array<[string, unknown]>;
}

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const SETUP_KINDS = [
  'providerCapabilities', 'characterSpritesLoaded', 'petSpritesLoaded', 'floorTilesLoaded',
  'wallTilesLoaded', 'carpetTilesLoaded', 'furnitureAssetsLoaded', 'areaMappingsLoaded',
  'settingsLoaded', 'layoutLoaded',
];
const ASSETS = new Proxy({}, { get: () => [] }) as unknown as Args[2];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const trunk = (id: string, extra: Partial<BranchAgent> = {}): BranchAgent =>
  ({ id, name: id, kind: 'trunk', state: 'resting', ...extra });
const guest = (id: string, extra: Partial<BranchAgent> = {}): BranchAgent =>
  ({ id, name: id, kind: 'grafted', state: 'resting', ...extra });
const group = (id: string, extra: Partial<BranchAgent> = {}): BranchAgent =>
  ({ id, name: id, kind: 'group', state: 'resting', ...extra });
const link = (from: string, to: string, at: number | string): BranchLink => ({ from, to, at });
const count = (agents: BranchAgent[], kind: BranchAgent['kind']): number =>
  agents.filter((a) => a.kind === kind).length;

function build(
  agents: BranchAgent[],
  opts: Partial<MountOptions> = {},
  init: Partial<OfficeStore> = {},
  reduced = false,
): Rig {
  const saved: Array<[string, unknown]> = [];
  const store: OfficeStore = { layout: null, seats: {}, looks: {}, prefs: defaultPrefs(), ...init };
  const storage = new Storage(store, (key, value) => { saved.push([key, value]); });
  const office = new OfficeState();
  const server = new BranchServer({ ...opts, agents, storage }, storage, ASSETS, () => office, () => reduced);
  const sent: Sent[] = [];
  server.onMessage((m) => { sent.push(m as unknown as Sent); });
  return { server, office, sent, saved };
}

function addCharacter(office: OfficeState, id: number, extra: Partial<Character> = {}): void {
  const base = {
    id, state: CharacterState.IDLE, dir: Direction.DOWN, x: 0, y: 0, tileCol: 0, tileRow: 0,
    path: [], moveProgress: 0, currentTool: null, palette: 0, hueShift: 0, frame: 0, frameTimer: 0,
    wanderTimer: 0, wanderCount: 0, wanderLimit: 0, isActive: false, seatId: null, bubbleType: null,
    bubbleTimer: 0, seatTimer: 0, isSubagent: false, parentAgentId: null, matrixEffect: null,
    matrixEffectTimer: 0, matrixEffectSeeds: [], contextTokens: 0, maxContextTokens: 0,
  };
  office.characters.set(id, { ...base, ...extra } as unknown as Character);
}

function char(rig: Rig, id: number): Character {
  return rig.office.characters.get(id) as Character;
}

function seatOffice(office: OfficeState, trunks: number, guests: number): void {
  const layout = generateBranchLayout({ trunks, guests, wide: true });
  for (const f of layout.furniture) {
    if (!/^(seat-|guest-sofa-)/.test(f.uid)) continue;
    office.seats.set(f.uid, { uid: f.uid, seatCol: f.col, seatRow: f.row, facingDir: Direction.DOWN, assigned: false });
  }
}

function seedAll(office: OfficeState, agents: BranchAgent[]): void {
  const n = agents.filter((a) => a.kind !== 'group').length;
  for (let id = 1; id <= n; id++) addCharacter(office, id);
}

function capture(rig: Rig, act: () => void): Sent[] {
  const from = rig.sent.length;
  act();
  return rig.sent.slice(from);
}

function handshake(rig: Rig): Sent[] {
  return capture(rig, () => rig.server.send({ type: 'webviewReady' }));
}

function readyRig(agents: BranchAgent[], opts: Partial<MountOptions> = {}, init: Partial<OfficeStore> = {}, reduced = false): Rig {
  const rig = build(agents, opts, init, reduced);
  seatOffice(rig.office, count(agents, 'trunk'), count(agents, 'grafted'));
  seedAll(rig.office, agents);
  handshake(rig);
  return rig;
}

function live(agents: BranchAgent[], opts: Partial<MountOptions> = {}, init: Partial<OfficeStore> = {}): Rig {
  const rig = readyRig(agents, opts, init);
  rig.sent.length = 0;
  return rig;
}

function upd(rig: Rig, agents: BranchAgent[], links?: BranchLink[]): Sent[] {
  return capture(rig, () => rig.server.update(agents, links));
}

const kinds = (msgs: Sent[]): string[] => msgs.map((m) => m.type);
const flagsOf = (m: Sent | undefined): boolean[] =>
  Object.values(m ?? {}).filter((v): v is boolean => typeof v === 'boolean');
const ofType = (msgs: Sent[], type: string): Sent[] => msgs.filter((m) => m.type === type);

function saved(rig: Rig, key: string): unknown {
  const hits = rig.saved.filter(([k]) => k === key);
  return hits[hits.length - 1]?.[1];
}

describe('tool label rule (sync spec B.1)', () => {
  const labelFor = (state: BranchAgent['state'], activity: string): unknown => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state, activity })]);
    return ofType(out, 'agentToolStart')[0]?.toolName;
  };

  it('a reading agent whose activity begins with search shows Grep', () => {
    expect(labelFor('reading', 'search the repo')).toBe('Grep');
  });

  it('the search check ignores letter case', () => {
    expect(labelFor('reading', 'SeArCh the logs')).toBe('Grep');
  });

  it('a reading agent whose activity contains look shows Grep wherever it appears', () => {
    expect(labelFor('reading', 'can you look at config')).toBe('Grep');
    expect(labelFor('reading', 'lookup table')).toBe('Grep');
  });

  it('the look check ignores letter case', () => {
    expect(labelFor('reading', 'LOOK at this')).toBe('Grep');
  });

  it('a reading agent with any other activity shows Read', () => {
    expect(labelFor('reading', 'open the config')).toBe('Read');
  });

  it('a reading agent with empty activity shows Read', () => {
    expect(labelFor('reading', '')).toBe('Read');
  });

  it('a working agent shows Write whatever its activity says', () => {
    expect(labelFor('working', 'search for x')).toBe('Write');
  });

  it('a needs-you agent shows Write whatever its activity says', () => {
    expect(labelFor('needs_you', 'look here')).toBe('Write');
  });
});

describe('pose rule (sync spec B.2)', () => {
  const poseWith = (agents: BranchAgent[], setup: (rig: Rig) => void, num = 1): string | null => {
    const rig = live(agents);
    setup(rig);
    return rig.server.poseFor(num);
  };
  const typing = (rig: Rig, extra: Partial<Character> = {}): void => {
    Object.assign(char(rig, 1), { state: CharacterState.TYPE, isActive: true, ...extra });
  };
  const working = (activity: string): BranchAgent[] => [trunk('a', { state: 'working', activity })];

  it('a number with no office character has no pose', () => {
    expect(poseWith([trunk('a')], () => undefined, 5)).toBeNull();
  });

  it('a character whose number has no roster agent has no pose', () => {
    expect(poseWith([trunk('a')], (rig) => addCharacter(rig.office, 7), 7)).toBeNull();
  });

  it('a talking agent shows the talk pose', () => {
    expect(poseWith([trunk('a')], (rig) => Object.assign(char(rig, 1), { chatTimer: 2 }))).toBe('talk');
  });

  it('a talking sub-agent shows the talk pose', () => {
    const setup = (rig: Rig): void => addCharacter(rig.office, 2, { isSubagent: true, parentAgentId: 1, chatTimer: 1 });
    expect(poseWith([trunk('a')], setup, 2)).toBe('talk');
  });

  it('a sub-agent whose parent is unknown has no pose even while talking', () => {
    const setup = (rig: Rig): void => addCharacter(rig.office, 2, { isSubagent: true, parentAgentId: 9, chatTimer: 1 });
    expect(poseWith([trunk('a')], setup, 2)).toBeNull();
  });

  it('a sub-agent takes no pose from its parent state', () => {
    const setup = (rig: Rig): void => addCharacter(rig.office, 2, { isSubagent: true, parentAgentId: 1 });
    expect(poseWith([trunk('a', { state: 'needs_you' })], setup, 2)).toBeNull();
  });

  it('an offline agent shows the sleep pose', () => {
    expect(poseWith([trunk('a', { state: 'offline' })], () => undefined)).toBe('sleep');
  });

  it('the talk pose wins over the offline pose', () => {
    const setup = (rig: Rig): void => { Object.assign(char(rig, 1), { chatTimer: 2 }); };
    expect(poseWith([trunk('a', { state: 'offline' })], setup)).toBe('talk');
  });

  it('a needs-you agent shows the wait pose', () => {
    expect(poseWith([trunk('a', { state: 'needs_you' })], () => undefined)).toBe('wait');
  });

  it('a waiting agent shows the wait pose', () => {
    expect(poseWith([trunk('a', { state: 'waiting' })], () => undefined)).toBe('wait');
  });

  it('the wait pose wins over the typing rules', () => {
    const agents = [trunk('a', { state: 'needs_you', activity: 'think' })];
    expect(poseWith(agents, (rig) => typing(rig))).toBe('wait');
  });

  it('a typing, active agent thinking shows the think pose', () => {
    expect(poseWith(working('Thinking it over'), (rig) => typing(rig))).toBe('think');
  });

  it('the think check ignores letter case', () => {
    expect(poseWith(working('THINK about it'), (rig) => typing(rig))).toBe('think');
  });

  it('the think check needs the activity to begin with think', () => {
    expect(poseWith(working('I think so'), (rig) => typing(rig))).toBeNull();
  });

  it('a typing, active agent searching shows the search pose', () => {
    expect(poseWith(working('search the web'), (rig) => typing(rig))).toBe('search');
  });

  it('other activity on a typing, active agent has no pose', () => {
    expect(poseWith(working('writing tests'), (rig) => typing(rig))).toBeNull();
  });

  it('a typing agent that is not active shows the sleep pose', () => {
    expect(poseWith(working('writing tests'), (rig) => typing(rig, { isActive: false }))).toBe('sleep');
  });

  it('an idle character is not typing, so the think rule does not apply', () => {
    expect(poseWith(working('think'), () => undefined)).toBeNull();
  });

  it('a walking agent with no other match has no pose', () => {
    expect(poseWith(working('writing'), (rig) => { Object.assign(char(rig, 1), { state: CharacterState.WALK }); })).toBeNull();
  });
});

describe('agent sync (sync spec C.1)', () => {
  it('the first sync after ready sends a cleared tool list and an idle status for a resting agent', () => {
    const rig = readyRig([trunk('a')]);
    const out = rig.sent.slice(SETUP_KINDS.length);
    expect(kinds(out)).toEqual(['agentToolsClear', 'agentStatus']);
    expect(out[1]).toMatchObject({ id: 1, status: 'idle' });
  });

  it('an at-desk working agent opens a Write row and reports active', () => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state: 'working' })]);
    expect(kinds(out)).toEqual(['agentToolStart', 'agentStatus']);
    expect(out[0]).toMatchObject({ id: 1, toolName: 'Write', status: 'Working', permissionActive: false });
    expect(out[1]).toMatchObject({ id: 1, status: 'active' });
  });

  it('an at-desk agent uses its activity text as the status label', () => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state: 'working', activity: 'Refactoring auth' })]);
    expect(ofType(out, 'agentToolStart')[0]).toMatchObject({ status: 'Refactoring auth' });
  });

  it('an at-desk agent with empty activity uses the default label for its state', () => {
    const cases: Array<[BranchAgent['state'], string]> = [
      ['working', 'Working'], ['reading', 'Reading'], ['needs_you', 'Waiting for your yes'],
    ];
    for (const [state, label] of cases) {
      const rig = live([trunk('a')]);
      const out = upd(rig, [trunk('a', { state, activity: '' })]);
      expect(ofType(out, 'agentToolStart')[0]).toMatchObject({ status: label });
    }
  });

  it('a waiting agent clears its tool rows and reports waiting with awaiting input off', () => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state: 'waiting' })]);
    expect(kinds(out)).toEqual(['agentToolsClear', 'agentStatus']);
    expect(out[1]).toMatchObject({ id: 1, status: 'waiting', awaitingInput: false });
  });

  it('an offline agent clears its tool rows and reports idle', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = upd(rig, [trunk('a', { state: 'offline' })]);
    expect(kinds(out)).toEqual(['agentToolDone', 'agentToolsClear', 'agentStatus']);
    expect(out[2]).toMatchObject({ id: 1, status: 'idle' });
  });

  it('an unknown state or a missing state is reported as idle', () => {
    const unknown = live([trunk('a')]);
    expect(upd(unknown, [trunk('a', { state: 'mystery' as BranchAgent['state'] })]).at(-1))
      .toMatchObject({ status: 'idle' });
    const missing = live([trunk('a')]);
    const out = upd(missing, [{ ...trunk('a'), state: undefined } as unknown as BranchAgent]);
    expect(out.at(-1)).toMatchObject({ status: 'idle' });
  });

  it('activity text is ignored when the agent is not at the desk', () => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state: 'waiting', activity: 'hidden text' })]);
    expect(ofType(out, 'agentToolStart')).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('hidden text');
  });

  it('an unchanged state and activity sends nothing', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'working', activity: 'x' })]);
    expect(upd(rig, [trunk('a', { state: 'working', activity: 'x' })])).toEqual([]);
  });

  it('context usage is sent on every call with its token counts, even when nothing changed', () => {
    const rig = live([trunk('a')]);
    const agents = [trunk('a', { state: 'working', context: { used: 10, max: 200 } })];
    upd(rig, agents);
    const again = upd(rig, agents);
    expect(kinds(again)).toEqual([ 'agentContextUsage' ]);
    expect(again[0]).toMatchObject({ id: 1, contextTokens: 10, maxContextTokens: 200 });
  });

  it('a change of activity at the desk closes the old row before opening a new one', () => {
    const rig = live([trunk('a')]);
    const first = ofType(upd(rig, [trunk('a', { state: 'working', activity: 'one' })]), 'agentToolStart')[0];
    const out = upd(rig, [trunk('a', { state: 'working', activity: 'two' })]);
    expect(kinds(out)).toEqual(['agentToolDone', 'agentToolStart', 'agentStatus']);
    expect(out[0]).toMatchObject({ toolId: first?.toolId });
    expect(out[1]).toMatchObject({ status: 'two' });
    expect(out[1].toolId).not.toBe(first?.toolId);
  });

  it('a change of activity away from the desk sends only the clear and the status again', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'waiting', activity: 'a' })]);
    const out = upd(rig, [trunk('a', { state: 'waiting', activity: 'b' })]);
    expect(kinds(out)).toEqual(['agentToolsClear', 'agentStatus']);
  });

  it('pending approvals open a permission flag on the new row and send a permission request', () => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state: 'working', needsYou: 2 })]);
    expect(kinds(out)).toEqual(['agentToolStart', 'agentStatus', 'agentToolPermission']);
    expect(out[0]).toMatchObject({ permissionActive: true });
  });

  it('pending approvals rising from zero send only a permission request while the state is unchanged', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'working' })]);
    const out = upd(rig, [trunk('a', { state: 'working', needsYou: 1 })]);
    expect(kinds(out)).toEqual(['agentToolPermission']);
    expect(out[0]).toMatchObject({ id: 1 });
  });

  it('pending approvals dropping to zero send a permission clear', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'working', needsYou: 1 })]);
    const out = upd(rig, [trunk('a', { state: 'working', needsYou: 0 })]);
    expect(kinds(out)).toEqual(['agentToolPermissionClear']);
  });

  it('pending approvals moving between two non-zero counts send nothing for permission', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'working', needsYou: 2 })]);
    expect(upd(rig, [trunk('a', { state: 'working', needsYou: 3 })])).toEqual([]);
    expect(upd(rig, [trunk('a', { state: 'working', needsYou: 2 })])).toEqual([]);
  });

  it('a permission request is still sent for a waiting agent', () => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state: 'waiting', needsYou: 1 })]);
    expect(kinds(out)).toContain('agentToolPermission');
  });

  it('a negative or missing pending count counts as zero', () => {
    const negative = live([trunk('a')]);
    const out = upd(negative, [trunk('a', { state: 'working', needsYou: -3 })]);
    expect(kinds(out)).not.toContain('agentToolPermission');
    expect(ofType(out, 'agentToolStart')[0]).toMatchObject({ permissionActive: false });
    const missing = live([trunk('a')]);
    expect(kinds(upd(missing, [trunk('a', { state: 'working' })]))).not.toContain('agentToolPermission');
  });

  it('team info is sent on the first sync, not repeated when unchanged, and sent again after a change', () => {
    const team = { name: 'Crew', role: 'Dev', lead: true };
    const rig = readyRig([trunk('a', { team })]);
    const first = ofType(rig.sent, 'agentTeamInfo')[0];
    expect(first).toMatchObject({ teamName: 'Crew', agentName: 'Dev', isTeamLead: true });
    expect(first?.leadAgentId).toBeUndefined();
    expect(ofType(upd(rig, [trunk('a', { team })]), 'agentTeamInfo')).toEqual([]);
    expect(ofType(upd(rig, [trunk('a', { team, state: 'waiting' })]), 'agentTeamInfo')).toHaveLength(1);
  });

  it('a teammate reports the office number of its lead', () => {
    const rig = readyRig([trunk('a'), trunk('b', { team: { name: 'Crew', role: 'QA', leadId: 'a' } })]);
    const info = ofType(rig.sent, 'agentTeamInfo').find((m) => m.id === 2);
    expect(info).toMatchObject({ leadAgentId: 1 });
  });

  it('a lead reference that was unknown is not corrected until the agent next changes', () => {
    const team = { name: 'Crew', role: 'QA', leadId: 'a' };
    const rig = readyRig([trunk('b', { team })]);
    addCharacter(rig.office, 2);
    expect(ofType(upd(rig, [trunk('b', { team }), trunk('a')]), 'agentTeamInfo')).toEqual([]);
    const after = upd(rig, [trunk('b', { team, state: 'working' }), trunk('a')]);
    expect(ofType(after, 'agentTeamInfo')[0]).toMatchObject({ id: 1, leadAgentId: 2 });
  });

  it('team info that disappears is not cleared and is not sent again when it returns unchanged', () => {
    const team = { name: 'Crew', role: 'Dev' };
    const rig = readyRig([trunk('a', { team })]);
    expect(kinds(upd(rig, [trunk('a')]))).toEqual([]);
    expect(upd(rig, [trunk('a', { team })])).toEqual([]);
  });

  it('the character step records the pending count on the office character', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'working', needsYou: 4 })]);
    expect(char(rig, 1).needsCount).toBe(4);
  });

  it('the character step marks the character sticky while waiting and caps the waiting bubble when it leaves', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'waiting' })]);
    expect(char(rig, 1).waitingSticky).toBe(true);
    Object.assign(char(rig, 1), { bubbleType: 'waiting', bubbleTimer: 2 });
    upd(rig, [trunk('a', { state: 'working' })]);
    expect(char(rig, 1).waitingSticky).toBe(false);
    expect(char(rig, 1).bubbleTimer).toBe(0.3);
  });

  it('the character step never lengthens a waiting bubble that already has less time left', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'waiting' })]);
    Object.assign(char(rig, 1), { bubbleType: 'waiting', bubbleTimer: 0.1 });
    upd(rig, [trunk('a', { state: 'working' })]);
    expect(char(rig, 1).bubbleTimer).toBe(0.1);
  });

  it('the character step marks an offline agent offline and clears the mark when it returns', () => {
    const rig = live([trunk('a')]);
    upd(rig, [trunk('a', { state: 'offline' })]);
    expect(char(rig, 1).offline).toBe(true);
    upd(rig, [trunk('a', { state: 'working' })]);
    expect(char(rig, 1).offline).toBe(false);
  });

  it('with no office character every message still goes out and no character is created by the sync', () => {
    const rig = build([trunk('a')]);
    handshake(rig);
    const out = upd(rig, [trunk('a', { state: 'working' })]);
    expect(kinds(out)).toContain('agentToolStart');
    expect(rig.office.characters.has(1)).toBe(false);
  });

  it('sub-agent messages go out before the parent messages in the same call', () => {
    const rig = live([trunk('a')]);
    const out = upd(rig, [trunk('a', { state: 'working', subagents: [{ id: 's1', label: 'S1', state: 'working' }] })]);
    const lastSub = out.map((m) => m.type).lastIndexOf('subagentToolStart');
    const parentRow = out.findIndex((m) => m.type === 'agentToolStart' && m.runInBackground !== true);
    expect(lastSub).toBeLessThan(parentRow);
  });

  it('a new sub-agent refreshes the parent tool row even when the parent did not change', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = upd(rig, [trunk('a', { state: 'working', subagents: [{ id: 's1', label: 'S1', state: 'working' }] })]);
    expect(kinds(out)).toEqual(expect.arrayContaining(['agentToolDone', 'agentToolStart', 'agentStatus']));
    expect(out.find((m) => m.type === 'agentToolStart' && m.runInBackground !== true))
      .toMatchObject({ id: 1, toolName: 'Write' });
  });
});

describe('sub-agent sync (sync spec C.2)', () => {
  const sub = (id: string, extra: Partial<Sub> = {}): Sub => ({ id, label: id.toUpperCase(), ...extra });
  const parent = (subs: Sub[] | undefined): BranchAgent => trunk('a', { state: 'working', subagents: subs });
  const withSubs = (rig: Rig, subs: Sub[] | undefined): Sent[] => upd(rig, [parent(subs)]);
  const subMsgs = (out: Sent[]): Sent[] => out.filter((m) => m.type.startsWith('subagent'));
  const taskRow = (out: Sent[]): Sent | undefined => out.find((m) => m.runInBackground === true);

  it('a new sub-agent gets a background task row before its own row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = withSubs(rig, [sub('s1', { label: 'Scout', state: 'working' })]);
    const task = taskRow(out);
    const row = ofType(subMsgs(out), 'subagentToolStart')[0];
    expect(task).toMatchObject({ id: 1, status: 'Subtask: Scout' });
    expect(row).toMatchObject({ id: 1, status: 'Writing', parentToolId: task?.toolId });
    expect(out.indexOf(task as Sent)).toBeLessThan(out.indexOf(row as Sent));
  });

  it('a working sub-agent with no activity shows Writing, and an unchanged one sends nothing on the next call', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    expect(subMsgs(withSubs(rig, [sub('s1', { state: 'working' })]))[0]).toMatchObject({ status: 'Writing' });
    expect(subMsgs(withSubs(rig, [sub('s1', { state: 'working' })]))).toEqual([]);
  });

  it('a reading sub-agent shows Reading by default', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = withSubs(rig, [sub('s1', { state: 'reading' })]);
    expect(ofType(subMsgs(out), 'subagentToolStart')[0]).toMatchObject({ status: 'Reading' });
  });

  it('a reading sub-agent activity is appended to Reading unless it begins with Read', () => {
    const appended = live([trunk('a', { state: 'working' })]);
    const a = withSubs(appended, [sub('s1', { state: 'reading', activity: 'reading files' })]);
    expect(ofType(subMsgs(a), 'subagentToolStart')[0]).toMatchObject({ status: 'Reading reading files' });
    const kept = live([trunk('a', { state: 'working' })]);
    const b = withSubs(kept, [sub('s1', { state: 'reading', activity: 'Read the spec' })]);
    expect(ofType(subMsgs(b), 'subagentToolStart')[0]).toMatchObject({ status: 'Read the spec' });
  });

  it('a working sub-agent shows its activity text as its status', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = withSubs(rig, [sub('s1', { state: 'working', activity: 'Patching' })]);
    expect(ofType(subMsgs(out), 'subagentToolStart')[0]).toMatchObject({ status: 'Patching' });
  });

  it('a needs-you sub-agent sends a sub-agent permission request after its row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = withSubs(rig, [sub('s1', { state: 'needs_you' })]);
    expect(kinds(subMsgs(out))).toEqual(['subagentToolStart', 'subagentToolPermission']);
    expect(ofType(subMsgs(out), 'subagentToolPermission')[0]).toMatchObject({ id: 1 });
  });

  it('a resting sub-agent gets a one-shot Idle row that is finished at once', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const msgs = subMsgs(withSubs(rig, [sub('s1', { state: 'resting' })]));
    expect(kinds(msgs)).toEqual(['subagentToolStart', 'subagentToolDone']);
    expect(msgs[0]).toMatchObject({ status: 'Idle' });
    expect(msgs[1]).toMatchObject({ toolId: msgs[0]?.toolId });
  });

  it('a resting sub-agent with activity shows the activity in its one-shot row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = subMsgs(withSubs(rig, [sub('s1', { state: 'resting', activity: 'Waiting' })]));
    expect(out[0]).toMatchObject({ status: 'Waiting' });
  });

  it('a sub-agent with an empty state sends only its task row on first sight', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = withSubs(rig, [sub('s1', { state: '' as Sub['state'] })]);
    expect(taskRow(out)).toMatchObject({ status: 'Subtask: S1' });
    expect(subMsgs(out)).toEqual([]);
  });

  it('a sub-agent with no state is treated as working', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const msgs = subMsgs(withSubs(rig, [sub('s1', { state: undefined })]));
    expect(kinds(msgs)).toEqual(['subagentToolStart']);
    expect(msgs[0]).toMatchObject({ status: 'Writing' });
  });

  it('a sub-agent with no label shows the text undefined in its task row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = withSubs(rig, [{ id: 's1', label: undefined, state: 'working' } as unknown as Sub]);
    expect(taskRow(out)).toMatchObject({ status: 'Subtask: undefined' });
  });

  it('an unchanged sub-agent sends nothing, not even its task row again', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'working' })]);
    expect(withSubs(rig, [sub('s1', { state: 'working' })])).toEqual([]);
  });

  it('a sub-agent that stops working finishes its open row before its one-shot idle row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'working' })]);
    const msgs = subMsgs(withSubs(rig, [sub('s1', { state: 'resting' })]));
    expect(kinds(msgs)).toEqual(['subagentToolDone', 'subagentToolStart', 'subagentToolDone']);
  });

  it('a sub-agent changing activity at the desk replaces its row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'working', activity: 'one' })]);
    const msgs = subMsgs(withSubs(rig, [sub('s1', { state: 'working', activity: 'two' })]));
    expect(kinds(msgs)).toEqual(['subagentToolDone', 'subagentToolStart']);
    expect(msgs[1]).toMatchObject({ status: 'two' });
  });

  it('a resting sub-agent gets a new one-shot row for each activity change', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'resting', activity: 'a' })]);
    const msgs = subMsgs(withSubs(rig, [sub('s1', { state: 'resting', activity: 'b' })]));
    expect(kinds(msgs)).toEqual(['subagentToolStart', 'subagentToolDone']);
    expect(msgs[0]).toMatchObject({ status: 'b' });
  });

  it('a needs-you sub-agent sends its permission request again on each change', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'needs_you', activity: 'x' })]);
    const msgs = subMsgs(withSubs(rig, [sub('s1', { state: 'needs_you', activity: 'y' })]));
    expect(kinds(msgs)).toEqual(['subagentToolDone', 'subagentToolStart', 'subagentToolPermission']);
  });

  it('a sub-agent that leaves is cleared under its task row id without finishing that row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const task = taskRow(withSubs(rig, [sub('s1', { state: 'working' })]));
    const out = withSubs(rig, []);
    expect(kinds(subMsgs(out))).toEqual(['subagentClear']);
    expect(subMsgs(out)[0]).toMatchObject({ id: 1, parentToolId: task?.toolId });
    expect(ofType(out, 'agentToolDone')).toEqual([]);
  });

  it('an unchanged needs-you sub-agent does not get its permission request again', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'needs_you', activity: 'x' })]);
    expect(subMsgs(withSubs(rig, [sub('s1', { state: 'needs_you', activity: 'x' })]))).toEqual([]);
  });

  it('a needs-you sub-agent that leaves gets no permission clear', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'needs_you' })]);
    expect(kinds(subMsgs(withSubs(rig, [])))).toEqual(['subagentClear']);
  });

  it('a sub-agent that returns after leaving gets a new task row', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    withSubs(rig, [sub('s1', { state: 'working' })]);
    withSubs(rig, []);
    expect(taskRow(withSubs(rig, [sub('s1', { state: 'working' })]))).toMatchObject({ status: 'Subtask: S1' });
  });

  it('a missing or empty sub-agent list clears every remembered sub-agent', () => {
    const missing = live([trunk('a', { state: 'working' })]);
    withSubs(missing, [sub('s1', { state: 'working' })]);
    expect(kinds(withSubs(missing, undefined))).toEqual(['subagentClear']);
    const empty = live([trunk('a', { state: 'working' })]);
    withSubs(empty, [sub('s1', { state: 'working' })]);
    expect(kinds(withSubs(empty, []))).toEqual(['subagentClear']);
  });

  it('sub-agent messages carry the parent office number', () => {
    const rig = live([trunk('a', { state: 'working' })]);
    const out = subMsgs(withSubs(rig, [sub('s1', { state: 'needs_you' })]));
    expect(out.every((m) => m.id === 1)).toBe(true);
  });
});

describe('office server: constructor, subscriptions and dispose (server spec C.1 to C.5)', () => {
  it('reports the connection as connected and resolves ready at once', async () => {
    const rig = build([trunk('a')]);
    expect(rig.server.state).toBe('connected');
    await expect(rig.server.ready).resolves.toBeUndefined();
  });

  it('a connection listener is accepted and its remover does nothing', () => {
    const rig = build([trunk('a')]);
    const remove = rig.server.onStateChange();
    expect(() => remove()).not.toThrow();
  });

  it('lists group entries from the roster before the webview is ready', () => {
    const rig = build([trunk('a'), group('g1')]);
    expect(rig.server.groups().map((g) => g.id)).toEqual(['g1']);
  });

  it('a stored layout at construction makes the layout custom', () => {
    expect(build([trunk('a')], {}, { layout: {} as OfficeLayout }).server.isCustomLayout()).toBe(true);
    expect(build([trunk('a')]).server.isCustomLayout()).toBe(false);
  });

  it('a boolean sound option overrides the stored sound setting and is not saved', () => {
    const rig = build([trunk('a')], { soundEnabled: false });
    const out = handshake(rig);
    expect(ofType(out, 'settingsLoaded')[0]).toMatchObject({ soundEnabled: false });
    expect(rig.saved).toEqual([]);
  });

  it('a sound option that is not a boolean is ignored', () => {
    const rig = build([trunk('a')], { soundEnabled: 'no' as unknown as boolean });
    expect(ofType(handshake(rig), 'settingsLoaded')[0]).toMatchObject({ soundEnabled: true });
  });

  it('stored preferences are merged over the defaults', () => {
    const init = { prefs: { soundEnabled: false } as OfficeStore['prefs'] };
    const settings = ofType(handshake(build([trunk('a')], {}, init)), 'settingsLoaded')[0];
    expect(settings).toMatchObject({ soundEnabled: false, alwaysShowLabels: true });
  });

  it('a link stamped before the mount time is never replayed', () => {
    const pair = [trunk('a'), trunk('b')];
    const old = link('a', 'b', NOW - 5000);
    const rig = live(pair, { links: [old] });
    upd(rig, pair, [old]);
    expect(char(rig, 1).chatTimer ?? 0).toBe(0);
  });

  it('a link stamped exactly at the mount time is replayed on the first ready update', () => {
    const pair = [trunk('a'), trunk('b')];
    const at = link('a', 'b', NOW);
    const rig = live(pair, { links: [at] });
    upd(rig, pair, [at]);
    expect(char(rig, 1).chatTimer ?? 0).toBeGreaterThan(0);
  });

  it('a link with no time or an unreadable time counts as old', () => {
    const pair = [trunk('a'), trunk('b')];
    const rig = live(pair, { links: [{ from: 'a', to: 'b' } as BranchLink, link('a', 'b', 'soon')] });
    upd(rig, pair, [{ from: 'a', to: 'b' } as BranchLink, link('a', 'b', 'soon')]);
    expect(char(rig, 1).chatTimer ?? 0).toBe(0);
  });

  it('the same listener added twice receives each message once', () => {
    const rig = build([trunk('a')]);
    const twice = vi.fn();
    rig.server.onMessage(twice);
    rig.server.onMessage(twice);
    handshake(rig);
    expect(twice).toHaveBeenCalledTimes(rig.sent.length);
  });

  it('a removed listener receives nothing more, and removing twice is harmless', () => {
    const rig = build([trunk('a')]);
    const seen = vi.fn();
    const remove = rig.server.onMessage(seen);
    remove();
    remove();
    handshake(rig);
    expect(seen).not.toHaveBeenCalled();
  });

  it('dispose stops delivery to every listener while public calls still change stored state', () => {
    const onLayoutChange = vi.fn();
    const rig = readyRig([trunk('a')], { onLayoutChange });
    rig.sent.length = 0;
    rig.server.dispose();
    const after = vi.fn();
    rig.server.onMessage(after);
    rig.server.applyLayout(null);
    expect(onLayoutChange).toHaveBeenCalledWith(null);
    expect(saved(rig, 'layout')).toBeNull();
    expect(rig.sent).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('listeners are called in the order they were added', () => {
    const rig = build([trunk('a')]);
    const order: string[] = [];
    rig.server.onMessage(() => { order.push('first'); });
    rig.server.onMessage(() => { order.push('second'); });
    rig.server.send({ type: 'webviewReady' });
    expect(order.slice(0, 2)).toEqual(['first', 'second']);
    expect(order.length % 2).toBe(0);
  });

  it('disposing twice does not throw', () => {
    const rig = build([trunk('a')]);
    rig.server.dispose();
    expect(() => rig.server.dispose()).not.toThrow();
  });

  it('an error thrown by a listener reaches the sender and skips the listeners after it', () => {
    const rig = build([trunk('a')]);
    const later = vi.fn();
    rig.server.onMessage(() => { throw new Error('listener failed'); });
    rig.server.onMessage(later);
    expect(() => rig.server.send({ type: 'webviewReady' })).toThrow('listener failed');
    expect(later).not.toHaveBeenCalled();
  });
});

describe('office server: client messages (server spec C.6 and E)', () => {
  it('saving a layout stores it, persists it and reports it to the host without replying', () => {
    const onLayoutChange = vi.fn();
    const rig = readyRig([trunk('a')], { onLayoutChange });
    const out = capture(rig, () => rig.server.send({ type: 'saveLayout', layout: { furniture: [] } }));
    expect(out).toEqual([]);
    expect(onLayoutChange).toHaveBeenCalledWith({ furniture: [] });
    expect(saved(rig, 'layout')).toEqual({ furniture: [] });
    expect(rig.server.isCustomLayout()).toBe(true);
  });

  it('saving a null layout clears the custom layout and reports none to the host', () => {
    const onLayoutChange = vi.fn();
    const rig = readyRig([trunk('a')], { onLayoutChange });
    rig.server.send({ type: 'saveLayout', layout: null as unknown as Record<string, unknown> });
    expect(onLayoutChange).toHaveBeenCalledWith(null);
    expect(saved(rig, 'layout')).toBeNull();
    expect(rig.server.isCustomLayout()).toBe(false);
  });

  it('focusing an agent calls open with its roster id, and an unknown number does nothing', () => {
    const onOpen = vi.fn();
    const rig = readyRig([trunk('a')], { onOpen });
    rig.server.send({ type: 'focusAgent', id: 1 });
    expect(onOpen).toHaveBeenCalledWith('a');
    rig.server.send({ type: 'focusAgent', id: 9 });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('launching calls the new-agent callback when one is given and does nothing otherwise', () => {
    const onNewAgent = vi.fn();
    readyRig([trunk('a')], { onNewAgent }).server.send({ type: 'launchAgent' });
    expect(onNewAgent).toHaveBeenCalledTimes(1);
    const bare = readyRig([trunk('a')]);
    expect(() => bare.server.send({ type: 'launchAgent' })).not.toThrow();
  });

  it('the preference messages store their flags and write all preferences each time', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.send({ type: 'setSoundEnabled', enabled: false });
    rig.server.send({ type: 'setAlwaysShowLabels', enabled: false });
    rig.server.send({ type: 'setGhostHeadlessAgents', enabled: false });
    rig.server.send({ type: 'setShowAreas', enabled: true });
    expect(saved(rig, 'prefs')).toEqual({
      soundEnabled: false, alwaysShowLabels: false, ghostOffline: false, showAreas: true,
    });
  });

  it('a preference message stores its flag exactly as given', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.send({ type: 'setShowAreas', enabled: 'yes' as unknown as boolean });
    expect(saved(rig, 'prefs')).toMatchObject({ showAreas: 'yes' });
  });

  it('the ignored message kinds change nothing, store nothing and call nothing', () => {
    const onOpen = vi.fn();
    const onNewAgent = vi.fn();
    const rig = readyRig([trunk('a')], { onOpen, onNewAgent });
    rig.sent.length = 0;
    const saves = rig.saved.length;
    const ignored = [
      { type: 'closeAgent', id: 1 },
      { type: 'requestDiagnostics' },
      { type: 'saveAreaMappings', mappings: {} },
      { type: 'mystery' },
    ];
    for (const msg of ignored) rig.server.send(msg as unknown as Client);
    expect(rig.sent).toEqual([]);
    expect(rig.saved.length).toBe(saves);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onNewAgent).not.toHaveBeenCalled();
  });
});

describe('office server: lookups (server spec C.7)', () => {
  it('maps numbers and roster ids only after the first sync', () => {
    const rig = build([trunk('a')]);
    expect(rig.server.numIdOf('a')).toBeUndefined();
    expect(rig.server.branchIdOf(1)).toBeUndefined();
    handshake(rig);
    expect(rig.server.numIdOf('a')).toBe(1);
    expect(rig.server.branchIdOf(1)).toBe('a');
  });

  it('returns the current roster entry for an office number', () => {
    const rig = build([trunk('a')]);
    expect(rig.server.agentFor(1)).toBeUndefined();
    handshake(rig);
    expect(rig.server.agentFor(1)?.id).toBe('a');
  });

  it('returns group entries in roster order', () => {
    const rig = build([trunk('a'), group('g2'), group('g1')]);
    expect(rig.server.groups().map((g) => g.id)).toEqual(['g2', 'g1']);
  });

  it('an unknown roster id or office number has no mapping', () => {
    const rig = readyRig([trunk('a')]);
    expect(rig.server.numIdOf('zz')).toBeUndefined();
    expect(rig.server.branchIdOf(99)).toBeUndefined();
  });
});

describe('office server: ready handshake (server spec C.8 and C.9)', () => {
  it('sends the ten setup messages in order before any agent message', () => {
    const out = handshake(build([trunk('a'), group('g'), guest('b')]));
    expect(kinds(out).slice(0, 10)).toEqual(SETUP_KINDS);
    expect(ofType(out, 'agentCreated').map((m) => [m.id, m.folderName]))
      .toEqual([[1, 'Trunks'], [2, 'Grafted']]);
  });

  it('the provider capabilities message lists the reading and sub-agent tool names', () => {
    const out = handshake(build([trunk('a')]));
    expect(ofType(out, 'providerCapabilities')[0]).toMatchObject({
      readingTools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
      subagentToolNames: ['Task', 'Agent'],
    });
  });

  it('a second ready replays the setup and creates only agents still missing a character', () => {
    const rig = build([trunk('a'), trunk('b')]);
    addCharacter(rig.office, 1);
    handshake(rig);
    const again = handshake(rig);
    expect(kinds(again).slice(0, 10)).toEqual(SETUP_KINDS);
    expect(ofType(again, 'agentCreated').map((m) => m.id)).toEqual([2]);
  });

  it('agents created by the first sync skip the spawn effect', () => {
    expect(flagsOf(ofType(handshake(build([trunk('a')])), 'agentCreated')[0])).toEqual([true]);
  });

  it('agents created later spawn normally unless reduced motion is on', () => {
    const normal = readyRig([trunk('a')]);
    const created = ofType(upd(normal, [trunk('a'), trunk('b')]), 'agentCreated')[0];
    expect(created?.id).toBe(2);
    expect(flagsOf(created)).toEqual([false]);
    const calm = readyRig([trunk('a')], {}, {}, true);
    expect(flagsOf(ofType(upd(calm, [trunk('a'), trunk('b')]), 'agentCreated')[0])).toEqual([true]);
  });

  it('with no stored layout the handshake sends a generated layout with furniture', () => {
    const out = handshake(build([trunk('a')]));
    expect(ofType(out, 'layoutLoaded')[0]?.layout).toHaveProperty('furniture');
  });

  it('a stored layout is sent back exactly as it was stored', () => {
    const stored = { furniture: [], marker: 'kept' };
    const out = handshake(build([trunk('a')], {}, { layout: stored as unknown as OfficeLayout }));
    expect(ofType(out, 'layoutLoaded')[0]?.layout).toEqual(stored);
  });

  it('a stored empty layout object is treated as a real layout', () => {
    const out = handshake(build([trunk('a')], {}, { layout: {} as OfficeLayout }));
    expect(ofType(out, 'layoutLoaded')[0]?.layout).toEqual({});
  });

  it('the area mapping message sends trunks to the office and guests to the guest area', () => {
    const out = handshake(build([trunk('a')]));
    expect(ofType(out, 'areaMappingsLoaded')[0]?.mappings)
      .toEqual({ Trunks: ['Office'], Grafted: ['Guests'] });
  });

  it('the settings message reports the four stored preferences', () => {
    const out = handshake(build([trunk('a')]));
    expect(ofType(out, 'settingsLoaded')[0]).toMatchObject({
      soundEnabled: true, alwaysShowLabels: true, ghostHeadlessAgents: true, showAreas: false,
    });
  });
});

describe('office server: pane size and layout (server spec C.10 to C.13)', () => {
  it('a pane resize that changes the best plan sends a regenerated layout', () => {
    const rig = readyRig([trunk('a'), trunk('b')]);
    const before = ofType(rig.sent, 'layoutLoaded')[0]?.layout;
    const out = capture(rig, () => rig.server.setViewport(300, 2000));
    const after = ofType(out, 'layoutLoaded')[0]?.layout;
    expect(after).toBeDefined();
    expect(after).not.toEqual(before);
  });

  it('a pane size that is unchanged sends nothing', () => {
    const rig = readyRig([trunk('a')]);
    expect(capture(rig, () => rig.server.setViewport(1280, 800))).toEqual([]);
  });

  it('zero or negative pane sizes are ignored', () => {
    const rig = readyRig([trunk('a')]);
    expect(capture(rig, () => rig.server.setViewport(0, 800))).toEqual([]);
    expect(capture(rig, () => rig.server.setViewport(1000, -4))).toEqual([]);
  });

  it('a custom layout is never regenerated when the pane size changes', () => {
    const rig = readyRig([trunk('a')], {}, { layout: {} as OfficeLayout });
    expect(ofType(capture(rig, () => rig.server.setViewport(300, 2000)), 'layoutLoaded')).toEqual([]);
  });

  it('a pane resize before the webview is ready sends no layout', () => {
    const rig = build([trunk('a')]);
    expect(capture(rig, () => rig.server.setViewport(300, 2000))).toEqual([]);
  });

  it('applying a layout sends it and reports it to the host even before ready', () => {
    const onLayoutChange = vi.fn();
    const rig = build([trunk('a')], { onLayoutChange });
    const layout = { furniture: [] } as unknown as OfficeLayout;
    const out = capture(rig, () => rig.server.applyLayout(layout));
    expect(ofType(out, 'layoutLoaded')[0]?.layout).toEqual({ furniture: [] });
    expect(onLayoutChange).toHaveBeenCalledWith(layout);
    expect(saved(rig, 'layout')).toEqual({ furniture: [] });
  });

  it('resetting the layout sends a generated layout and reports no custom layout', () => {
    const onLayoutChange = vi.fn();
    const rig = readyRig([trunk('a')], { onLayoutChange });
    const out = capture(rig, () => rig.server.applyLayout(null));
    expect(ofType(out, 'layoutLoaded')[0]?.layout).toHaveProperty('furniture');
    expect(onLayoutChange).toHaveBeenCalledWith(null);
    expect(rig.server.isCustomLayout()).toBe(false);
  });
});

describe('office server: roster and links (server spec C.14, C.21, C.23)', () => {
  it('a roster update before ready is stored with no messages and no office numbers', () => {
    const rig = build([]);
    expect(upd(rig, [trunk('a')])).toEqual([]);
    expect(rig.server.numIdOf('a')).toBeUndefined();
    expect(ofType(handshake(rig), 'agentCreated')[0]).toMatchObject({ id: 1 });
  });

  it('links in a roster update see the office numbers assigned in that same update', () => {
    const pair = [trunk('a'), trunk('b')];
    const rig = readyRig([trunk('a')]);
    addCharacter(rig.office, 2);
    upd(rig, pair, [link('a', 'b', NOW)]);
    expect(char(rig, 1).chatTimer ?? 0).toBeGreaterThan(0);
  });

  it('links given before ready are dropped for that call and replayed by a later update', () => {
    const pair = [trunk('a'), trunk('b')];
    const rig = build(pair);
    seedAll(rig.office, pair);
    upd(rig, pair, [link('a', 'b', NOW)]);
    expect(char(rig, 1).chatTimer ?? 0).toBe(0);
    handshake(rig);
    upd(rig, pair, [link('a', 'b', NOW)]);
    expect(char(rig, 1).chatTimer ?? 0).toBeGreaterThan(0);
  });

  it('a closed agent frees its office number, and a returning agent gets a new number', () => {
    const rig = readyRig([trunk('a'), trunk('b')]);
    expect(ofType(upd(rig, [trunk('b')]), 'agentClosed')[0]).toMatchObject({ id: 1 });
    const back = upd(rig, [trunk('b'), trunk('a')]);
    expect(ofType(back, 'agentCreated')[0]).toMatchObject({ id: 3 });
    expect(rig.server.numIdOf('a')).toBe(3);
  });

  it('closing messages are sent after the remaining agents, in number order', () => {
    const rig = readyRig([trunk('a'), trunk('b')]);
    const out = upd(rig, [trunk('c')]);
    expect(ofType(out, 'agentClosed').map((m) => m.id)).toEqual([1, 2]);
    expect(kinds(out).slice(-2)).toEqual(['agentClosed', 'agentClosed']);
  });

  it('an agent whose office character was removed is created again with the same number', () => {
    const rig = readyRig([trunk('a')]);
    rig.office.characters.delete(1);
    const out = upd(rig, [trunk('a')]);
    expect(ofType(out, 'agentCreated')[0]).toMatchObject({ id: 1 });
    expect(kinds(out)).toContain('agentStatus');
  });

  it('groups never get an office number or a character', () => {
    const rig = build([group('g')]);
    expect(ofType(handshake(rig), 'agentCreated')).toEqual([]);
    expect(rig.server.numIdOf('g')).toBeUndefined();
  });

  it('an entry of an unknown kind gets a number and is treated as a trunk', () => {
    const odd = { id: 'x', name: 'x', kind: 'mystery', state: 'resting' } as unknown as BranchAgent;
    expect(ofType(handshake(build([odd])), 'agentCreated')[0]).toMatchObject({ id: 1, folderName: 'Trunks' });
  });

  it('a link replays as a visit from the sender to the recipient', () => {
    const pair = [trunk('a'), trunk('b')];
    const rig = live(pair);
    upd(rig, pair, [link('a', 'b', NOW)]);
    expect(char(rig, 1).chatTimer ?? 0).toBeGreaterThan(0);
  });

  it('a repeated link is replayed only once', () => {
    const pair = [trunk('a'), trunk('b')];
    const rig = live(pair);
    upd(rig, pair, [link('a', 'b', NOW)]);
    char(rig, 1).chatTimer = 0;
    upd(rig, pair, [link('a', 'b', NOW)]);
    expect(char(rig, 1).chatTimer ?? 0).toBe(0);
  });

  it('a numeric time and its text form count as the same link', () => {
    const pair = [trunk('a'), trunk('b')];
    const rig = live(pair);
    upd(rig, pair, [link('a', 'b', NOW)]);
    char(rig, 1).chatTimer = 0;
    upd(rig, pair, [link('a', 'b', String(NOW))]);
    expect(char(rig, 1).chatTimer ?? 0).toBe(0);
  });

  it('a link to an unknown roster id is consumed and never replayed later', () => {
    const pair = [trunk('a'), trunk('b')];
    const rig = live(pair);
    const ghost = link('a', 'ghost', NOW);
    upd(rig, pair, [ghost]);
    upd(rig, [...pair, trunk('ghost')], [ghost]);
    expect(char(rig, 1).chatTimer ?? 0).toBe(0);
  });

  it('a link to a group is never replayed', () => {
    const agents = [trunk('a'), group('g')];
    const rig = live(agents);
    upd(rig, agents, [link('a', 'g', NOW)]);
    expect(char(rig, 1).chatTimer ?? 0).toBe(0);
  });
});

describe('office server: seats (server spec C.15, C.17, C.22)', () => {
  it('saving seats stores each seat under the roster id of its office number', () => {
    const rig = readyRig([trunk('a'), trunk('b')]);
    rig.server.send({
      type: 'saveAgentSeats',
      seats: {
        1: { palette: 0, hueShift: 0, seatId: 'seat-3' },
        2: { palette: 1, hueShift: 15, seatId: 'seat-4' },
      },
    });
    expect(saved(rig, 'seats')).toEqual({ a: 'seat-3', b: 'seat-4' });
  });

  it('an empty seat removes the stored seat, and unknown numbers are skipped', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.send({ type: 'saveAgentSeats', seats: { 1: { palette: 0, hueShift: 0, seatId: 'seat-3' } } });
    rig.server.send({
      type: 'saveAgentSeats',
      seats: { 1: { palette: 0, hueShift: 0, seatId: null }, 9: { palette: 0, hueShift: 0, seatId: 'seat-0' } },
    });
    expect(saved(rig, 'seats')).toEqual({});
  });

  it('saving seats writes storage even when the seat map is empty', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.send({ type: 'saveAgentSeats', seats: {} });
    expect(saved(rig, 'seats')).toEqual({});
  });

  it('a seat message with no seat map throws', () => {
    const rig = readyRig([trunk('a')]);
    expect(() => rig.server.send({ type: 'saveAgentSeats' } as unknown as Client)).toThrow();
  });

  it('a stored seat is offered when the agent is created again, even if the seat is taken', () => {
    const rig = build([trunk('a')], {}, { seats: { a: 'seat-3' } });
    rig.office.seats.set('seat-3', { uid: 'seat-3', seatCol: 0, seatRow: 0, facingDir: Direction.DOWN, assigned: true });
    expect(ofType(handshake(rig), 'agentCreated')[0]).toMatchObject({ seatId: 'seat-3' });
  });

  it('a closed agent keeps its stored seat for its return', () => {
    const rig = readyRig([trunk('a'), trunk('b')]);
    rig.server.send({ type: 'saveAgentSeats', seats: { 1: { palette: 0, hueShift: 0, seatId: 'seat-3' } } });
    upd(rig, [trunk('b')]);
    expect(ofType(upd(rig, [trunk('b'), trunk('a')]), 'agentCreated')[0]).toMatchObject({ seatId: 'seat-3' });
  });

  it('the readout of an unknown roster id is null', () => {
    const rig = readyRig([trunk('a')]);
    expect(rig.server.customization('zz')).toBeNull();
  });

  it('the readout reports the seat of the office character', () => {
    const rig = readyRig([trunk('a')]);
    char(rig, 1).seatId = 'seat-0';
    expect(rig.server.customization('a')).toMatchObject({ seatId: 'seat-0' });
  });

  it('a character without a seat falls back to the stored seat', () => {
    const rig = readyRig([trunk('a')], {}, { seats: { a: 'seat-5' } });
    expect(rig.server.customization('a')).toMatchObject({ seatId: 'seat-5' });
  });

  it('before the first sync only the stored seat is reported', () => {
    const rig = build([trunk('a')], {}, { seats: { a: 'seat-5' } });
    expect(rig.server.customization('a')).toMatchObject({ seatId: 'seat-5' });
  });

  it('a trunk gets the first desk seat when it is free', () => {
    const rig = build([trunk('a'), trunk('b')]);
    seatOffice(rig.office, 2, 0);
    const out = handshake(rig);
    expect(ofType(out, 'agentCreated').map((m) => m.seatId)).toEqual(['seat-0', 'seat-1']);
  });

  it('a trunk gets no default seat when its desk is already taken', () => {
    const rig = build([trunk('a')]);
    seatOffice(rig.office, 1, 0);
    rig.office.seats.get('seat-0')!.assigned = true;
    expect(ofType(handshake(rig), 'agentCreated')[0]?.seatId).toBeUndefined();
  });

  it('the first guest gets the first lounge sofa and a guest past the sofa count gets none', () => {
    const guests = [guest('g1'), guest('g2'), guest('g3'), guest('g4')];
    const rig = build(guests);
    seatOffice(rig.office, 0, 4);
    const created = ofType(handshake(rig), 'agentCreated');
    expect(created[0]?.seatId).toBe('guest-sofa-0');
    expect(created[1]?.seatId).toBe('guest-sofa-1');
    expect(created[2]?.seatId).toBeUndefined();
  });

  it('choosing a free seat moves the character there and stores the seat', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { seatId: 'seat-1' });
    expect(rig.server.customization('a')).toMatchObject({ seatId: 'seat-1' });
    expect(saved(rig, 'seats')).toEqual({ a: 'seat-1' });
  });

  it('a seat that is already taken is ignored', () => {
    const rig = readyRig([trunk('a')]);
    rig.office.seats.get('seat-1')!.assigned = true;
    rig.server.customize('a', { seatId: 'seat-1' });
    expect(rig.server.customization('a')).toMatchObject({ seatId: null });
    expect(saved(rig, 'seats')).toBeUndefined();
  });

  it('a seat that is not in the office is ignored', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { seatId: 'seat-99' });
    expect(rig.server.customization('a')).toMatchObject({ seatId: null });
  });

  it('an empty seat is ignored, so a seat cannot be cleared here', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { seatId: 'seat-1' });
    rig.server.customize('a', { seatId: null });
    expect(rig.server.customization('a')).toMatchObject({ seatId: 'seat-1' });
  });

  it('a seat change for an agent with no office number is dropped and not stored', () => {
    const rig = build([trunk('a')]);
    seatOffice(rig.office, 1, 0);
    rig.server.customize('a', { seatId: 'seat-1' });
    expect(rig.server.customization('a')).toMatchObject({ seatId: null });
    expect(saved(rig, 'seats')).toBeUndefined();
  });
});

describe('office server: looks and customization (server spec C.16, C.18 to C.20, C.24, C.25)', () => {
  it('a guest without a saved look gets a human sprite with a palette from 0 to 5', () => {
    const rig = readyRig([guest('g1')]);
    expect(rig.server.customization('g1')?.sprite).toMatch(/^human:[0-5]$/);
    const created = ofType(handshake(build([guest('g2')])), 'agentCreated')[0];
    expect(created?.palette).toBeGreaterThanOrEqual(0);
    expect(created?.palette).toBeLessThanOrEqual(5);
  });

  it('a guest palette is stable for the same roster id', () => {
    const first = readyRig([guest('g1')]).server.customization('g1')?.sprite;
    const second = readyRig([guest('g1')]).server.customization('g1')?.sprite;
    expect(second).toBe(first);
  });

  it('a guest hue comes from its colour hint', () => {
    const agents = [guest('g1', { colorHint: '#0000ff' })];
    expect(readyRig(agents).server.customization('g1')).toMatchObject({ hueShift: 240 });
    expect(ofType(handshake(build(agents)), 'agentCreated')[0]).toMatchObject({ hueShift: 240 });
  });

  it('a grey, named or short colour hint gives hue zero', () => {
    for (const colorHint of ['#808080', 'blue', '#fff']) {
      const rig = readyRig([guest('g1', { colorHint })]);
      expect(rig.server.customization('g1')).toMatchObject({ hueShift: 0 });
    }
  });

  it('a green colour hint gives hue 120', () => {
    const rig = readyRig([guest('g1', { colorHint: '#00ff00' })]);
    expect(rig.server.customization('g1')).toMatchObject({ hueShift: 120 });
  });

  it('a trunk with the classic look shows a pebble sprite on palette 0 with no hue shift', () => {
    const agents = [trunk('a', { look: 'classic', colorHint: '#00ff00' })];
    expect(readyRig(agents).server.customization('a')?.sprite).toMatch(/^pebble:/);
    expect(ofType(handshake(build(agents)), 'agentCreated')[0]).toMatchObject({ palette: 0, hueShift: 0 });
  });

  it('a trunk with no usable colour hint gets the default pebble colour', () => {
    expect(readyRig([trunk('a')]).server.customization('a')?.sprite).toBe('pebble:0:round:#56616B');
  });

  it('a group gets a readout', () => {
    const rig = readyRig([group('g')]);
    expect(rig.server.customization('g')).not.toBeNull();
  });

  it('a human sprite is stored as a palette number with no sprite key', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { sprite: 'human:3' });
    expect(saved(rig, 'looks')).toEqual({ a: { palette: 3, hueShift: 0 } });
    expect(rig.server.customization('a')?.sprite).toBe('human:3');
  });

  it('a pebble sprite is stored as its key with no palette', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { sprite: 'pebble:0:round:#ff0000' });
    const look = (saved(rig, 'looks') as Record<string, unknown>).a as Record<string, unknown>;
    expect(look).toMatchObject({ spriteKey: 'pebble:0:round:#ff0000' });
    expect(look).not.toHaveProperty('palette');
  });

  it('a human sprite with two digits is stored as a key and not as a palette', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { sprite: 'human:12' });
    const look = (saved(rig, 'looks') as Record<string, unknown>).a as Record<string, unknown>;
    expect(look).toMatchObject({ spriteKey: 'human:12' });
    expect(look).not.toHaveProperty('palette');
    expect(rig.server.customization('a')?.sprite).toBe('human:12');
  });

  it('a patch that sets only the sprite keeps the current hue shift', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { hueShift: 30 });
    rig.server.customize('a', { sprite: 'human:1' });
    expect(rig.server.customization('a')).toMatchObject({ hueShift: 30 });
  });

  it('a hue shift set to undefined reads back as zero', () => {
    const rig = readyRig([trunk('a')]);
    rig.server.customize('a', { hueShift: 30 });
    rig.server.customize('a', { hueShift: undefined });
    expect(rig.server.customization('a')).toMatchObject({ hueShift: 0 });
  });

  it('a customization is reported to the host with the id and a fresh readout', () => {
    const onCustomize = vi.fn();
    const rig = readyRig([trunk('a')], { onCustomize });
    rig.server.customize('a', { sprite: 'human:2' });
    expect(onCustomize).toHaveBeenCalledWith('a', expect.objectContaining({ sprite: 'human:2' }));
  });

  it('a customization with no effective change still calls the host', () => {
    const onCustomize = vi.fn();
    const rig = readyRig([trunk('a')], { onCustomize });
    rig.server.customize('a', {});
    expect(onCustomize).toHaveBeenCalledTimes(1);
  });

  it('customizing an unknown roster id does nothing', () => {
    const onCustomize = vi.fn();
    const rig = readyRig([trunk('a')], { onCustomize });
    rig.server.customize('zz', { sprite: 'human:2' });
    expect(onCustomize).not.toHaveBeenCalled();
    expect(saved(rig, 'looks')).toBeUndefined();
  });

  it('customizing a group saves a look and changes no character', () => {
    const onCustomize = vi.fn();
    const rig = readyRig([group('g')], { onCustomize });
    rig.server.customize('g', { sprite: 'human:2' });
    expect(onCustomize).toHaveBeenCalledWith('g', expect.any(Object));
    expect(saved(rig, 'looks')).toEqual({ g: { palette: 2, hueShift: 0 } });
  });

  it('a look change is applied to the agent character and to its sub-agent characters', () => {
    const rig = readyRig([trunk('a')]);
    addCharacter(rig.office, 2, { isSubagent: true, parentAgentId: 1 });
    rig.server.customize('a', { sprite: 'pebble:1:wide:#00ff00' });
    expect(char(rig, 1).spriteKey).toBe('pebble:1:wide:#00ff00');
    expect(char(rig, 2).spriteKey).toBe('pebble:1:wide:#00ff00');
  });

  it('resetting the look restores the default readout and keeps the seat', () => {
    const onCustomize = vi.fn();
    const rig = readyRig([trunk('a')], { onCustomize });
    const before = rig.server.customization('a');
    rig.server.customize('a', { sprite: 'human:4', hueShift: 30, seatId: 'seat-1' });
    rig.server.resetLook('a');
    const after = rig.server.customization('a');
    expect(after?.sprite).toBe(before?.sprite);
    expect(after).toMatchObject({ hueShift: 0, seatId: 'seat-1' });
    expect(onCustomize).toHaveBeenLastCalledWith('a', expect.objectContaining({ hueShift: 0 }));
  });

  it('resetting the look of an unknown id reports none and still writes storage', () => {
    const onCustomize = vi.fn();
    const rig = readyRig([trunk('a')], { onCustomize });
    rig.server.resetLook('zz');
    expect(onCustomize).toHaveBeenCalledWith('zz', null);
    expect(saved(rig, 'looks')).toEqual({});
  });

  it('a customization before the first sync does not touch office characters', () => {
    const rig = build([trunk('a')]);
    addCharacter(rig.office, 1, { spriteKey: 'kept' });
    rig.server.customize('a', { sprite: 'human:2' });
    expect(char(rig, 1).spriteKey).toBe('kept');
  });

  it('a stored look is applied when the agent is created', () => {
    const rig = build([trunk('a')], {}, { looks: { a: { palette: 2, hueShift: 45 } } });
    expect(ofType(handshake(rig), 'agentCreated')[0]).toMatchObject({ palette: 2, hueShift: 45 });
  });

  it('a closed agent keeps its stored look for its return', () => {
    const rig = readyRig([trunk('a'), trunk('b')]);
    rig.server.customize('a', { sprite: 'human:5' });
    upd(rig, [trunk('b')]);
    expect(ofType(upd(rig, [trunk('b'), trunk('a')]), 'agentCreated')[0]).toMatchObject({ palette: 5 });
  });

  it('an existing character is brought in line with the stored look during sync', () => {
    const rig = build([trunk('a')], {}, { looks: { a: { palette: 2, hueShift: 45 } } });
    addCharacter(rig.office, 1, { palette: 0, hueShift: 0 });
    handshake(rig);
    expect(char(rig, 1)).toMatchObject({ palette: 2, hueShift: 45 });
  });
});
