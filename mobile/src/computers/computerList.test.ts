import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureEnvironments } from '../testing/computerFixtures';
import { ComputerList, computerName, computerRows, readComputer, type ComputerListSnapshot } from './computerList';

function until(list: ComputerList, test: (s: ComputerListSnapshot) => boolean): Promise<ComputerListSnapshot> {
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

async function pairedList(engine = createFakeEngine({ environments: fixtureEnvironments })) {
  const { session } = createFakeSession(engine);
  const list = new ComputerList(session);
  list.attach();
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await until(list, (s) => s.loaded);
  return { session, engine, list };
}

describe('computer rows', () => {
  it('names the host This computer and keeps the engine’s labels for the rest', () => {
    const rows = computerRows({ environments: fixtureEnvironments });
    expect(rows.map((r) => r.id)).toEqual(['gateway', 'node:home', 'node:studio']);
    expect(rows.map((r) => r.name)).toEqual(['This computer', 'Home server', 'Studio']);
    expect(rows[0]).toMatchObject({ status: 'online', statusLabel: 'Online', os: 'macOS' });
    expect(rows[1]).toMatchObject({ status: 'online', statusLabel: 'Online', os: 'Linux' });
    expect(rows[2]).toMatchObject({ status: 'offline', statusLabel: 'Offline', os: 'Windows', lastSeenAtMs: fixtureEnvironments[2].lastSeenAtMs });
    expect(computerName({ id: 'gateway', label: 'Studio host' })).toBe('This computer');
    expect(computerName({ id: 'w1' })).toBe('w1');
    expect(computerRows({})).toEqual([]);
  });

  it('puts the host first when the engine listed it later, and drops rows with no id', () => {
    const rows = computerRows({
      environments: [
        { id: 'node:home', type: 'node', label: 'Home server', status: 'available' },
        { type: 'host', status: 'available' },
        { id: 'gateway', type: 'host', status: 'starting', platform: 'linux' },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['gateway', 'node:home']);
    expect(rows[0]).toMatchObject({ status: 'starting', statusLabel: 'Starting', os: 'Linux' });
  });

  it('maps each engine status the window does, and an unknown one as offline', () => {
    expect(readComputer({ id: 'n', status: 'stopping' })).toMatchObject({ status: 'stopping', statusLabel: 'Stopping' });
    expect(readComputer({ id: 'n', status: 'error' })).toMatchObject({ status: 'error', statusLabel: 'Has a problem' });
    expect(readComputer({ id: 'n', status: 'mystery' })).toMatchObject({ status: 'offline', statusLabel: 'Offline' });
    expect(readComputer({})).toBeNull();
  });
});

describe('computer list from the computer', () => {
  it('reads environments.list with no extra params', async () => {
    const { session, engine, list } = await pairedList();
    expect(engine.requests.find((r) => r.method === 'environments.list')?.params).toEqual({});
    expect(list.getSnapshot().rows.map((r) => r.name)).toEqual(['This computer', 'Home server', 'Studio']);
    session.dispose();
    list.dispose();
  });

  it('reads again when a computer’s reachability changes', async () => {
    const { session, engine, list } = await pairedList();
    engine.setEnvironments(fixtureEnvironments.map((row) => (row.id === 'node:home' ? { ...row, status: 'unavailable' } : row)));
    engine.emit('node.presence', { nodeId: 'home' });
    const next = await until(list, (s) => s.rows.find((r) => r.id === 'node:home')?.status === 'offline');
    expect(next.rows.find((r) => r.id === 'node:home')?.statusLabel).toBe('Offline');
    session.dispose();
    list.dispose();
  });

  it('keeps the rows while the computer restarts and reads again on the new connection', async () => {
    const { session, engine, list } = await pairedList();
    const lists = () => engine.requests.filter((r) => r.method === 'environments.list').length;
    expect(lists()).toBe(1);
    engine.drop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(list.getSnapshot().rows).toHaveLength(3);
    await until(list, () => lists() === 2);
    session.dispose();
    list.dispose();
  });

  it('reports a failed read, and the next read clears it', async () => {
    const engine = createFakeEngine({ environments: fixtureEnvironments });
    engine.failMethod('environments.list', 'environments unavailable');
    const { session } = createFakeSession(engine);
    const list = new ComputerList(session);
    list.attach();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    expect(await until(list, (s) => s.error !== null)).toMatchObject({ loaded: false, error: "Can't reach Branch. Check your connection.", rows: [] });
    engine.failMethod('environments.list', null);
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ loaded: true, error: null });
    expect(list.getSnapshot().rows).toHaveLength(3);
    session.dispose();
    list.dispose();
  });
});
