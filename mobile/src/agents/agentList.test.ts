import { PAUSE_METHOD, PAUSE_UNAVAILABLE, RESUME_METHOD, AgentList, canPauseResume, listFailureMessage, readAgentRows, type AgentListSnapshot } from './agentList';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';

const CONTROL = [PAUSE_METHOD, RESUME_METHOD];

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
  it('names each agent and marks running, paused and idle from agents.list and sessions', () => {
    const rows = readAgentRows(fixtureAgents, { sessions: fixtureSessions });
    expect(rows.map((r) => r.id)).toEqual(['main', 'oak', 'researcher']);
    expect(rows.find((r) => r.id === 'main')).toMatchObject({ name: 'Branch Agent', avatar: '🌿', status: 'idle' });
    expect(rows.find((r) => r.id === 'oak')).toMatchObject({ name: 'Oak', avatar: 'O', status: 'running' });
    expect(rows.find((r) => r.id === 'researcher')).toMatchObject({ name: 'Researcher', avatar: '🔎', status: 'paused' });
  });

  it('keeps paused ahead of a live run, and skips rows with no id', () => {
    const rows = readAgentRows(
      { agents: [{ id: 'oak', name: 'Oak', paused: true }, { name: 'ghost' }, { id: 'main', name: 'Branch Agent' }] },
      { sessions: [{ agentId: 'oak', hasActiveRun: true }, { agentId: 'main', activeRunIds: ['run-1'] }] },
    );
    expect(rows).toEqual([
      { id: 'oak', name: 'Oak', avatar: 'O', status: 'paused' },
      { id: 'main', name: 'Branch Agent', avatar: 'B', status: 'running' },
    ]);
  });

  it('treats pause and resume as missing unless the handshake named both methods', () => {
    expect(canPauseResume(null)).toBe(false);
    expect(canPauseResume({ type: 'hello-ok', protocol: 4, server: { version: '1' }, auth: { role: 'operator', scopes: [] } })).toBe(false);
    expect(canPauseResume({ type: 'hello-ok', protocol: 4, server: { version: '1' }, auth: { role: 'operator', scopes: [] }, features: { methods: [PAUSE_METHOD] } })).toBe(false);
    expect(canPauseResume({ type: 'hello-ok', protocol: 4, server: { version: '1' }, auth: { role: 'operator', scopes: [] }, features: { methods: CONTROL } })).toBe(true);
    expect(PAUSE_UNAVAILABLE).toMatch(/agents\.pause/);
  });
});

describe('agent list from the computer', () => {
  it('reads the roster and is read-only when the engine has not advertised pause and resume', async () => {
    const { session, engine, list } = await pairedList();
    expect(engine.requests.some((r) => r.method === 'agents.list')).toBe(true);
    expect(list.getSnapshot().canControl).toBe(false);
    expect(list.getSnapshot().rows.map((r) => [r.id, r.status])).toEqual([
      ['main', 'idle'],
      ['oak', 'running'],
      ['researcher', 'paused'],
    ]);
    await list.pause('oak');
    expect(engine.requests.some((r) => r.method === PAUSE_METHOD)).toBe(false);
    session.dispose();
    list.dispose();
  });

  it('pauses an agent after the engine advertises agents.pause', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, methods: CONTROL });
    const { session, list } = await pairedList(engine);
    expect(list.getSnapshot().canControl).toBe(true);
    await list.pause('oak');
    expect(engine.requests).toContainEqual({ method: PAUSE_METHOD, params: { agentId: 'oak' } });
    await until(list, (s) => s.rows.find((r) => r.id === 'oak')?.status === 'paused');
    session.dispose();
    list.dispose();
  });

  it('resumes a paused agent after the engine advertises agents.resume', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, methods: CONTROL });
    const { session, list } = await pairedList(engine);
    await list.resume('researcher');
    expect(engine.requests).toContainEqual({ method: RESUME_METHOD, params: { agentId: 'researcher' } });
    await until(list, (s) => s.rows.find((r) => r.id === 'researcher')?.status === 'idle');
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

  it('keeps the row and says why a pause failed, without the engine’s own text', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, methods: CONTROL });
    const { session, list } = await pairedList(engine);
    engine.failMethod(PAUSE_METHOD, 'missing scope: operator.admin', { code: 'MISSING_SCOPE', missingScope: 'operator.admin' }, 'FORBIDDEN');
    await list.pause('oak');
    const snap = list.getSnapshot();
    expect(snap.failed.oak).toBe('This phone isn’t allowed to pause or resume Trunks. Do that on your computer.');
    expect(snap.failed.oak).not.toMatch(/operator\.admin|missing scope/);
    expect(snap.rows.find((r) => r.id === 'oak')?.status).toBe('running');
    session.dispose();
    list.dispose();
  });

  it('says why a resume failed', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, methods: CONTROL });
    const { session, list } = await pairedList(engine);
    engine.failMethod(RESUME_METHOD, 'agent offline', { reason: 'DOWN' }, 'UNAVAILABLE');
    await list.resume('researcher');
    expect(list.getSnapshot().failed.researcher).toBe('Your computer is busy right now. Try again in a moment.');
    expect(list.getSnapshot().rows.find((r) => r.id === 'researcher')?.status).toBe('paused');
    session.dispose();
    list.dispose();
  });
});
