import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '../../../core/src/messages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, type Character } from '../office/types.js';
import type { DecodedAssets } from './assets.js';
import { BranchServer } from './branchServer.js';
import type { Storage } from './storage.js';
import type { BranchAgent, BranchLink, BranchSubagent, MountOptions } from './types.js';

type Msg = { type: string; [key: string]: unknown };

interface Rig {
  server: BranchServer;
  out: Msg[];
  chars: Map<number, Character>;
  headless: Array<[number, boolean]>;
}

/** A server whose webview is ready, with fake office characters for the given office numbers. */
function rig(charIds: number[] = [1, 2, 3]): Rig {
  const chars = new Map<number, Character>();
  for (const id of charIds) {
    chars.set(id, { id, state: CharacterState.IDLE, isActive: false, isSubagent: false, parentAgentId: null } as unknown as Character);
  }
  const headless: Array<[number, boolean]> = [];
  const office = {
    characters: chars,
    setHeadless: (id: number, on: boolean) => {
      headless.push([id, on]);
    },
  } as unknown as OfficeState;
  const storage = {
    load: () => ({ prefs: {}, seats: {}, looks: {}, layout: {} }),
    saveLayout: () => undefined,
  } as unknown as Storage;
  const server = new BranchServer({ agents: [] } as unknown as MountOptions, storage, {} as DecodedAssets, () => office, () => false);
  const out: Msg[] = [];
  server.onMessage((m) => out.push(m as unknown as Msg));
  server.send({ type: 'webviewReady' } as unknown as ClientMessage);
  return { server, out, chars, headless };
}

/** Runs one roster sync and returns the messages it sent. */
function step(r: Rig, agents: BranchAgent[], links: BranchLink[] = []): Msg[] {
  r.out.length = 0;
  r.server.update(agents, links);
  return [...r.out];
}

function agent(state: string, over: Partial<BranchAgent> = {}): BranchAgent {
  return { id: 'a1', name: 'Alpha', kind: 'trunk', state, ...over } as unknown as BranchAgent;
}

function sub(over: { id: string; label?: string; state?: string; activity?: string }): BranchSubagent {
  return { label: "Scout", ...over } as unknown as BranchSubagent;
}

const types = (msgs: Msg[]) => msgs.map((m) => m.type);
const ofType = (msgs: Msg[], type: string) => msgs.filter((m) => m.type === type);

describe('agent sync', () => {
  it('sends a tools-clear and idle status on the first call for a resting agent', () => {
    const msgs = step(rig(), [agent('resting')]);
    expect(types(msgs)).toEqual(['agentToolsClear', 'agentStatus']);
    expect(msgs[1]).toMatchObject({ id: 1, status: 'idle' });
  });

  it('opens a Write row and an active status for a working agent', () => {
    const msgs = step(rig(), [agent('working')]);
    expect(types(msgs)).toEqual(['agentToolStart', 'agentStatus']);
    expect(msgs[0]).toMatchObject({ id: 1, toolName: 'Write', status: 'Working', permissionActive: false });
    expect(msgs[1]).toMatchObject({ status: 'active' });
  });

  it.each([
    ['search the repo', 'Grep'],
    ['take a look', 'Grep'],
    ['open the file', 'Read'],
    ['', 'Read'],
  ])('labels a reading agent from its activity text (%j)', (activity, tool) => {
    const msgs = step(rig(), [agent('reading', { activity })]);
    expect(msgs[0]).toMatchObject({ toolName: tool });
  });

  it('uses the needs-you label as status when the activity text is empty', () => {
    const msgs = step(rig(), [agent('needs_you')]);
    expect(msgs[0]).toMatchObject({ toolName: 'Write', status: 'Waiting for your yes' });
  });

  it('shows the activity text as the status at desk', () => {
    const msgs = step(rig(), [agent('working', { activity: 'Editing parser' })]);
    expect(msgs[0]).toMatchObject({ status: 'Editing parser' });
  });

  it('sends nothing for an identical second call', () => {
    const r = rig();
    step(r, [agent('working', { activity: 'Editing' })]);
    expect(step(r, [agent('working', { activity: 'Editing' })])).toEqual([]);
  });

  it('replaces the tool row when the activity changes at desk', () => {
    const r = rig();
    const first = step(r, [agent('working', { activity: 'a' })]);
    const second = step(r, [agent('working', { activity: 'b' })]);
    expect(types(second)).toEqual(['agentToolDone', 'agentToolStart', 'agentStatus']);
    expect(second[0]).toMatchObject({ toolId: first[0].toolId });
    expect(second[1]).toMatchObject({ status: 'b' });
  });

  it('re-sends clear and status but no row when the activity changes off desk', () => {
    const r = rig();
    step(r, [agent('waiting', { activity: 'x' })]);
    const second = step(r, [agent('waiting', { activity: 'y' })]);
    expect(types(second)).toEqual(['agentToolsClear', 'agentStatus']);
  });

  it.each([
    ['waiting', { status: 'waiting', awaitingInput: false }],
    ['offline', { status: 'idle' }],
  ])('sends the right status for a %s agent', (state, expected) => {
    const msgs = step(rig(), [agent(state)]);
    expect(msgs[msgs.length - 1]).toMatchObject(expected);
  });

  it('sends a permission request when the count rises from zero and a clear when it falls back', () => {
    const r = rig();
    expect(ofType(step(r, [agent('working', { needsYou: 0 })]), 'agentToolPermission')).toHaveLength(0);
    const raised = step(r, [agent('working', { needsYou: 2 })]);
    expect(ofType(raised, 'agentToolPermission')).toHaveLength(1);
    expect(ofType(raised, 'agentToolPermissionClear')).toHaveLength(0);
    const cleared = step(r, [agent('working', { needsYou: 0 })]);
    expect(ofType(cleared, 'agentToolPermissionClear')).toHaveLength(1);
  });

  it('sends nothing for permission when the count moves between two non-zero values', () => {
    const r = rig();
    step(r, [agent('working', { needsYou: 2 })]);
    expect(step(r, [agent('working', { needsYou: 3 })])).toEqual([]);
  });

  it('sends a permission request on a non-desk state too', () => {
    const msgs = step(rig(), [agent('waiting', { needsYou: 1 })]);
    expect(ofType(msgs, 'agentToolPermission')).toHaveLength(1);
  });

  it('sends team info once, with the lead resolved to its office number', () => {
    const r = rig();
    const lead = agent('working', { id: 'lead', name: 'Lead' });
    const member = agent('working', { id: 'a1', team: { name: 'Crew', role: 'Builder', leadId: 'lead' } });
    const first = step(r, [lead, member]);
    expect(ofType(first, 'agentTeamInfo')).toEqual([
      expect.objectContaining({ id: 2, teamName: 'Crew', agentName: 'Builder', isTeamLead: false, leadAgentId: 1 }),
    ]);
    expect(ofType(step(r, [lead, member]), 'agentTeamInfo')).toHaveLength(0);
  });

  it('reports the lead flag and no lead reference for the lead itself', () => {
    const msgs = step(rig(), [agent('working', { team: { name: 'Crew', lead: true, role: 'Lead' } })]);
    const info = ofType(msgs, 'agentTeamInfo')[0];
    expect(info).toMatchObject({ isTeamLead: true, agentName: 'Lead' });
    expect(info.leadAgentId).toBeUndefined();
  });

  it('re-sends context usage on every call, even for identical input', () => {
    const r = rig();
    const a = agent('working', { context: { used: 10, max: 100 } });
    expect(ofType(step(r, [a]), 'agentContextUsage')).toEqual([expect.objectContaining({ contextTokens: 10, maxContextTokens: 100 })]);
    expect(ofType(step(r, [a]), 'agentContextUsage')).toHaveLength(1);
  });

  it('mirrors the pending count onto the character, never below zero', () => {
    const r = rig();
    step(r, [agent('working', { needsYou: 2 })]);
    expect(r.chars.get(1)?.needsCount).toBe(2);
    step(r, [agent('working', { needsYou: -3 })]);
    expect(r.chars.get(1)?.needsCount).toBe(0);
  });

  it('switches the character headless when the agent goes offline and back', () => {
    const r = rig();
    step(r, [agent('working')]);
    step(r, [agent('offline')]);
    expect(r.chars.get(1)?.offline).toBe(true);
    step(r, [agent('working')]);
    expect(r.headless).toEqual([[1, true], [1, false]]);
    expect(r.chars.get(1)?.offline).toBe(false);
  });

  it('caps a dropped waiting bubble at 0.3 seconds and never raises it', () => {
    const r = rig();
    const ch = () => r.chars.get(1)!;
    step(r, [agent('waiting')]);
    Object.assign(ch(), { bubbleType: 'waiting', bubbleTimer: 2 });
    step(r, [agent('working')]);
    expect(ch().bubbleTimer).toBe(0.3);
    step(r, [agent('waiting')]);
    Object.assign(ch(), { bubbleType: 'waiting', bubbleTimer: 0.1 });
    step(r, [agent('working')]);
    expect(ch().bubbleTimer).toBe(0.1);
  });
});

describe('sub-agent sync', () => {
  it('opens a background Task row with the Subtask label, then the sub-agent row', () => {
    const msgs = step(rig(), [agent('resting', { subagents: [sub({ id: 's1', state: 'reading', activity: 'open files' })] })]);
    const task = msgs.find((m) => m.toolId === 'sub:s1');
    const row = ofType(msgs, 'subagentToolStart')[0];
    expect(task).toMatchObject({ type: 'agentToolStart', id: 1, toolName: 'Task', status: 'Subtask: Scout', runInBackground: true });
    expect(row).toMatchObject({ id: 1, parentToolId: 'sub:s1', status: 'Reading open files' });
    expect(msgs.indexOf(task as Msg)).toBeLessThan(msgs.indexOf(row));
  });

  it('keeps a reading status that already starts with Read', () => {
    const msgs = step(rig(), [agent('resting', { subagents: [sub({ id: 's1', state: 'reading', activity: 'Reading docs' })] })]);
    expect(ofType(msgs, 'subagentToolStart')[0]).toMatchObject({ status: 'Reading docs' });
  });

  it('uses Writing for a working sub-agent, and a permission request when it needs you', () => {
    const r = rig();
    const first = step(r, [agent('resting', { subagents: [sub({ id: 's1', state: 'working' })] })]);
    expect(ofType(first, 'subagentToolStart')[0]).toMatchObject({ status: 'Writing' });
    const second = step(r, [agent('resting', { subagents: [sub({ id: 's1', state: 'needs_you' })] })]);
    expect(types(second)).toEqual(['subagentToolDone', 'subagentToolStart', 'subagentToolPermission']);
    expect(second[2]).toMatchObject({ parentToolId: 'sub:s1' });
  });

  it('closes a resting sub-agent row at once and sends nothing for it afterwards', () => {
    const r = rig();
    const msgs = step(r, [agent('resting', { subagents: [sub({ id: 's1', state: 'done' })] })]);
    const start = ofType(msgs, 'subagentToolStart')[0];
    expect(ofType(msgs, 'subagentToolDone')[0]).toMatchObject({ toolId: start.toolId });
    expect(step(r, [agent('resting', { subagents: [sub({ id: 's1', state: 'done' })] })])).toEqual([]);
  });

  it('sends only the task row for a sub-agent whose state is an empty string', () => {
    const msgs = step(rig(), [agent('resting', { subagents: [sub({ id: 's1', state: '' })] })]);
    expect(ofType(msgs, 'agentToolStart').some((m) => m.toolId === 'sub:s1')).toBe(true);
    expect(ofType(msgs, 'subagentToolStart')).toHaveLength(0);
  });

  it('uses Subtask: undefined when the label is missing', () => {
    const msgs = step(rig(), [agent('resting', { subagents: [{ id: 's1' } as BranchSubagent] })]);
    expect(msgs.find((m) => m.toolId === 'sub:s1')).toMatchObject({ status: 'Subtask: undefined' });
  });

  it('treats a missing sub-agent state as working', () => {
    const msgs = step(rig(), [agent('resting', { subagents: [{ id: 's1', label: 'Scout' } as BranchSubagent] })]);
    expect(ofType(msgs, 'subagentToolStart')[0]).toMatchObject({ status: 'Writing' });
  });

  it('clears a removed sub-agent, and opens a new task row if it comes back', () => {
    const r = rig();
    step(r, [agent('resting', { subagents: [sub({ id: 's1', state: 'working' })] })]);
    expect(ofType(step(r, [agent('resting', { subagents: [] })]), 'subagentClear')).toEqual([
      expect.objectContaining({ id: 1, parentToolId: 'sub:s1' }),
    ]);
    const back = step(r, [agent('resting', { subagents: [sub({ id: 's1', state: 'working' })] })]);
    expect(back.some((m) => m.type === 'agentToolStart' && m.toolId === 'sub:s1')).toBe(true);
  });

  it('clears every remembered sub-agent when the list goes missing', () => {
    const r = rig();
    step(r, [agent('resting', { subagents: [sub({ id: 's1' }), sub({ id: 's2' })] })]);
    const msgs = step(r, [agent('resting')]);
    expect(ofType(msgs, 'subagentClear').map((m) => m.parentToolId)).toEqual(['sub:s1', 'sub:s2']);
  });

  it('makes the parent a changed row when a sub-agent first appears', () => {
    const r = rig();
    const first = step(r, [agent('working')]);
    const second = step(r, [agent('working', { subagents: [sub({ id: 's1', state: 'resting' })] })]);
    expect(ofType(second, 'agentToolDone')).toEqual([expect.objectContaining({ toolId: first[0].toolId })]);
    expect(ofType(second, 'agentToolStart').some((m) => m.toolName === 'Write')).toBe(true);
  });
});

describe('pose', () => {
  it('returns null when no character exists for the number', () => {
    expect(rig().server.poseFor(99)).toBeNull();
  });

  it('returns null when the character has no agent', () => {
    const r = rig([1, 3]);
    step(r, [agent('working')]);
    expect(r.server.poseFor(3)).toBeNull();
  });

  it('shows talk while speech time is left, sub-agents included', () => {
    const r = rig();
    step(r, [agent('working')]);
    Object.assign(r.chars.get(1)!, { chatTimer: 1 });
    Object.assign(r.chars.get(2)!, { isSubagent: true, parentAgentId: 1, chatTimer: 0.5 });
    expect(r.server.poseFor(1)).toBe('talk');
    expect(r.server.poseFor(2)).toBe('talk');
  });

  it('shows no pose for a sub-agent without speech time, whatever the parent is doing', () => {
    const r = rig();
    step(r, [agent('needs_you')]);
    Object.assign(r.chars.get(2)!, { isSubagent: true, parentAgentId: 1, state: CharacterState.TYPE, isActive: true });
    expect(r.server.poseFor(2)).toBeNull();
  });

  it.each([
    ['offline', 'sleep'],
    ['needs_you', 'wait'],
    ['waiting', 'wait'],
  ])('shows the pose for a %s agent', (state, pose) => {
    const r = rig();
    step(r, [agent(state)]);
    expect(r.server.poseFor(1)).toBe(pose);
  });

  it.each([
    ['Thinking it through', 'think'],
    ['searching the web', 'search'],
    ['Editing the file', null],
  ])('reads a typing, active character from its activity text (%j)', (activity, pose) => {
    const r = rig();
    step(r, [agent('working', { activity })]);
    Object.assign(r.chars.get(1)!, { state: CharacterState.TYPE, isActive: true });
    expect(r.server.poseFor(1)).toBe(pose);
  });

  it('shows sleep for a typing character that is not active', () => {
    const r = rig();
    step(r, [agent('working')]);
    Object.assign(r.chars.get(1)!, { state: CharacterState.TYPE, isActive: false });
    expect(r.server.poseFor(1)).toBe('sleep');
  });

  it('shows no pose for a standing character', () => {
    const r = rig();
    step(r, [agent('working')]);
    Object.assign(r.chars.get(1)!, { state: CharacterState.IDLE, isActive: true });
    expect(r.server.poseFor(1)).toBeNull();
  });

  it('shows no pose for a typing sub-agent, because the sub-agent rule comes first', () => {
    const r = rig();
    step(r, [agent('working', { activity: 'Thinking hard' })]);
    Object.assign(r.chars.get(2)!, { isSubagent: true, parentAgentId: 1, state: CharacterState.TYPE, isActive: true });
    expect(r.server.poseFor(2)).toBeNull();
  });
});
