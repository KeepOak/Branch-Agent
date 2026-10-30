import { AgentList, listFailureMessage, readAgentRows, type AgentListSnapshot } from './agentList';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';

function until(list: AgentList, test: (s: AgentListSnapshot) => boolean): Promise<AgentListSnapshot> {
  if (test(list.getSnapshot())) return Promise.resolve(list.getSnapshot());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out: ${JSON.stringify(list.getSnapshot())}`)), 3000);
    const off = list.subscribe(() => {
      if (!test(list.getSnapshot())) return;
      clearTimeout(timer);
      off();
      resolve(list.getSnapshot());
    });
  });
}

async function pairedList(engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents })) {
  const { session } = createFakeSession(engine);
  const list = new AgentList(session);
  list.attach();
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await until(list, (s) => s.loaded);
  return { session, engine, list };
}

describe('agent rows', () => {
  it('names each agent and marks running and idle from agents.list and sessions', () => {
    const rows = readAgentRows(fixtureAgents, { sessions: fixtureSessions });
    expect(rows.map((r) => r.id)).toEqual(['main', 'oak', 'researcher']);
    expect(rows.find((r) => r.id === 'main')).toMatchObject({ name: 'Branch Agent', avatar: '🌿', status: 'idle' });
    expect(rows.find((r) => r.id === 'oak')).toMatchObject({ name: 'Oak', avatar: 'O', status: 'running' });
    expect(rows.find((r) => r.id === 'researcher')).toMatchObject({ name: 'Researcher', avatar: '🔎', status: 'idle' });
  });

  it('takes running from hasActiveRun and activeRunIds, and skips rows with no id', () => {
    const rows = readAgentRows(
      { agents: [{ id: 'oak', name: 'Oak' }, { name: 'ghost' }, { id: 'main', name: 'Branch Agent' }] },
      { sessions: [{ agentId: 'oak', hasActiveRun: true }, { agentId: 'main', activeRunIds: ['run-1'] }] },
    );
    expect(rows).toEqual([
      { id: 'oak', name: 'Oak', avatar: 'O', status: 'running' },
      { id: 'main', name: 'Branch Agent', avatar: 'B', status: 'running' },
    ]);
  });

  it('ignores an invented paused field on the wire', () => {
    const rows = readAgentRows(
      { agents: [{ id: 'oak', name: 'Oak', paused: true }] },
      { sessions: [{ agentId: 'oak', hasActiveRun: true }] },
    );
    expect(rows).toEqual([{ id: 'oak', name: 'Oak', avatar: 'O', status: 'running' }]);
  });
});

describe('agent list from the computer', () => {
  it('reads the roster as running or idle and never sends pause or resume', async () => {
    const { session, engine, list } = await pairedList();
    expect(engine.requests.some((r) => r.method === 'agents.list')).toBe(true);
    expect(engine.requests.some((r) => r.method === 'sessions.list')).toBe(true);
    expect(list.getSnapshot().rows.map((r) => [r.id, r.status])).toEqual([
      ['main', 'idle'],
      ['oak', 'running'],
      ['researcher', 'idle'],
    ]);
    expect(engine.requests.some((r) => r.method === 'agents.pause' || r.method === 'agents.resume')).toBe(false);
    session.dispose();
    list.dispose();
  });

  it('says in plain words when the roster cannot be read, and the next read clears it', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
    engine.failMethod('agents.list', 'agents unavailable', { reason: 'NOPE' }, 'INVALID_REQUEST');
    const { session } = createFakeSession(engine);
    const list = new AgentList(session);
    list.attach();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    expect(await until(list, (s) => s.error !== null)).toMatchObject({ loaded: false, error: listFailureMessage({ code: 'INVALID_REQUEST' }), rows: [] });
    engine.failMethod('agents.list', null);
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ loaded: true, error: null });
    expect(list.getSnapshot().rows).toHaveLength(3);
    session.dispose();
    list.dispose();
  });

  it('fails the roster when sessions.list fails before any run state has been read', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
    engine.failMethod('sessions.list', 'sessions unavailable', { reason: 'NOPE' }, 'INVALID_REQUEST');
    const { session } = createFakeSession(engine);
    const list = new AgentList(session);
    list.attach();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    expect(await until(list, (s) => s.error !== null)).toMatchObject({ loaded: false, error: listFailureMessage({ code: 'INVALID_REQUEST' }), rows: [] });
    session.dispose();
    list.dispose();
  });

  it('keeps running when a later sessions.list fails', async () => {
    const { session, engine, list } = await pairedList();
    expect(list.getSnapshot().rows.find((r) => r.id === 'oak')?.status).toBe('running');
    engine.failMethod('sessions.list', 'sessions unavailable', { reason: 'NOPE' }, 'INVALID_REQUEST');
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ loaded: true, error: null });
    expect(list.getSnapshot().rows.find((r) => r.id === 'oak')?.status).toBe('running');
    session.dispose();
    list.dispose();
  });

  it('keeps the rows and records the error when a later agents.list fails', async () => {
    const { session, engine, list } = await pairedList();
    engine.failMethod('agents.list', 'agents unavailable', { reason: 'NOPE' }, 'INVALID_REQUEST');
    await list.refresh();
    const snap = list.getSnapshot();
    expect(snap.loaded).toBe(true);
    expect(snap.error).toBe(listFailureMessage({ code: 'INVALID_REQUEST' }));
    expect(snap.rows.find((r) => r.id === 'oak')?.status).toBe('running');
    session.dispose();
    list.dispose();
  });
});
