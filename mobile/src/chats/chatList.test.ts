import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { ChatList, chatRows, filterRows, LIST_PARAMS, matchesSearch, readAgents, unreadCount, type ChatListSnapshot } from './chatList';
import { chatTime } from './chatTime';

const { agents, mainKey } = readAgents(fixtureAgents);

function until(list: ChatList, test: (s: ChatListSnapshot) => boolean): Promise<ChatListSnapshot> {
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
  const list = new ChatList(session);
  list.attach();
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await until(list, (s) => s.loaded);
  return { session, engine, list };
}

describe('chat rows', () => {
  it('shows the chats a person opens, pinned first then newest, named after their Trunk', () => {
    const rows = filterRows(chatRows({ sessions: fixtureSessions }, agents, mainKey), 'all', FIXTURE_NOW);
    expect(rows.map((r) => r.key)).toEqual(['agent:researcher:main', 'agent:oak:main', 'agent:main:main', 'agent:oak:room:launch', 'agent:oak:chat-1', 'agent:main:old']);
    expect(rows.map((r) => r.title)).toEqual(['Researcher', 'Oak', 'Branch Agent', 'Launch team', 'Fix the settings page', 'Trip to Lisbon']);
    expect(rows.find((r) => r.key === 'agent:oak:chat-1')).toMatchObject({ trunkName: 'Oak', avatar: 'O', needsYou: true, working: false });
    expect(rows.find((r) => r.key === 'agent:main:main')).toMatchObject({ avatar: '🌿', unread: true, preview: 'Your expenses for September are filed. Anything else?' });
    expect(rows.find((r) => r.key === 'agent:main:main')?.trunkName).toBeUndefined();
    expect(rows.find((r) => r.key === 'agent:oak:main')?.working).toBe(true);
  });

  it('puts each chip’s chats behind it, and never shows system, helper or child chats', () => {
    const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);
    const keys = (filter: Parameters<typeof filterRows>[1]) => filterRows(rows, filter, FIXTURE_NOW).map((r) => r.key);
    expect(keys('rooms')).toEqual(['agent:oak:room:launch']);
    expect(keys('trunks')).not.toContain('agent:oak:room:launch');
    expect(keys('needsYou')).toEqual(['agent:oak:chat-1']);
    expect(keys('snoozed')).toEqual(['agent:researcher:taxes']);
    expect(keys('archived')).toEqual(['agent:main:archived']);
    expect(keys('automations')).toEqual(['agent:main:cron:daily']);
    for (const hidden of ['agent:main:system', 'agent:oak:helper', 'agent:oak:child']) expect(rows.some((r) => r.key === hidden)).toBe(false);
    // A snooze that has run out brings the chat back to All by itself.
    expect(filterRows(rows, 'all', FIXTURE_NOW + 3 * 24 * 60 * 60_000).some((r) => r.key === 'agent:researcher:taxes')).toBe(true);
    expect(unreadCount(rows, FIXTURE_NOW)).toBe(2);
  });

  it('calls a chat “New chat” when the engine knows no names for it', () => {
    const [row] = chatRows({ sessions: [{ key: 'agent:ghost:x', updatedAt: 1 }] }, new Map(), 'main');
    expect(row).toMatchObject({ title: 'New chat', avatar: 'N', preview: '' });
    expect(chatRows({}, agents, mainKey)).toEqual([]);
  });

  it('searches the name, its Trunk and the last line', () => {
    const rows = filterRows(chatRows({ sessions: fixtureSessions }, agents, mainKey), 'all', FIXTURE_NOW);
    expect(rows.filter((r) => matchesSearch(r, 'oak')).map((r) => r.key)).toEqual(['agent:oak:main', 'agent:oak:room:launch', 'agent:oak:chat-1']);
    expect(rows.filter((r) => matchesSearch(r, 'PNPM')).map((r) => r.key)).toEqual(['agent:oak:chat-1']);
    expect(rows.filter((r) => matchesSearch(r, '  ')).length).toBe(rows.length);
  });

  it('dates a chat by its latest activity, so one whose updatedAt lags its last reply still reads as today', () => {
    const today = new Date(2026, 9, 8, 9, 40).getTime();
    const yesterday = new Date(2026, 9, 7, 18, 0).getTime();
    const [lagging, plain] = chatRows(
      { sessions: [{ key: 'agent:juniper:main', updatedAt: yesterday, lastActivityAt: today }, { key: 'agent:juniper:x', updatedAt: today, lastActivityAt: yesterday }] },
      new Map(),
      'main',
    );
    expect(lagging.updatedAt).toBe(today);
    expect(plain.updatedAt).toBe(today);
    expect(chatTime(lagging.updatedAt, FIXTURE_NOW)).toBe('9:40 AM');
  });

  it('says when, the way Messages does', () => {
    const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
    expect(chatTime(FIXTURE_NOW - 10_000, FIXTURE_NOW)).toBe('Now');
    expect(chatTime(at(8, 9, 5), FIXTURE_NOW)).toBe('9:05 AM');
    expect(chatTime(at(8, 0, 30), FIXTURE_NOW)).toBe('12:30 AM');
    expect(chatTime(at(7, 23, 59), FIXTURE_NOW)).toBe('Yesterday');
    expect(chatTime(at(4, 12, 0), FIXTURE_NOW)).toBe('Sunday');
    expect(chatTime(at(1, 12, 0), FIXTURE_NOW)).toBe('10/1/26');
    expect(chatTime(0, FIXTURE_NOW)).toBe('');
  });
});

describe('chat list from the computer', () => {
  it('subscribes to session changes with the window’s list params and reads the Trunks', async () => {
    const { session, engine, list } = await pairedList();
    expect(engine.requests.find((r) => r.method === 'sessions.subscribe')?.params).toEqual(LIST_PARAMS);
    expect(engine.requests.some((r) => r.method === 'agents.list')).toBe(true);
    expect(list.getSnapshot().rows.map((r) => r.title)).toContain('Branch Agent');
    session.dispose();
    list.dispose();
  });

  it('reads again when a session changes or a reply finishes', async () => {
    const { session, engine, list } = await pairedList();
    engine.setSessions([...fixtureSessions, { key: 'agent:oak:new', agentId: 'oak', label: 'New idea', updatedAt: FIXTURE_NOW + 1 }]);
    engine.emit('sessions.changed', { sessionKey: 'agent:oak:new' });
    await until(list, (s) => s.rows.some((r) => r.key === 'agent:oak:new'));

    engine.setSessions(fixtureSessions.map((r) => (r.key === 'agent:oak:main' ? { ...r, hasActiveRun: false, lastMessagePreview: 'All 312 tests passed' } : r)));
    engine.emit('chat', { sessionKey: 'agent:oak:main', state: 'delta' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(list.getSnapshot().rows.find((r) => r.key === 'agent:oak:main')?.working).toBe(true);
    engine.emit('chat', { sessionKey: 'agent:oak:main', state: 'final' });
    const done = await until(list, (s) => s.rows.find((r) => r.key === 'agent:oak:main')?.working === false);
    expect(done.rows.find((r) => r.key === 'agent:oak:main')?.preview).toBe('All 312 tests passed');
    session.dispose();
    list.dispose();
  });

  it('keeps the rows while the computer restarts and subscribes again on the new connection', async () => {
    const { session, engine, list } = await pairedList();
    const subscribes = () => engine.requests.filter((r) => r.method === 'sessions.subscribe').length;
    expect(subscribes()).toBe(1);
    engine.drop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(filterRows(list.getSnapshot().rows, 'all', FIXTURE_NOW)).toHaveLength(6);
    await until(list, () => subscribes() === 2);
    session.dispose();
    list.dispose();
  });

  it('reports a failed read, and the next read clears it', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
    engine.failMethod('sessions.subscribe', 'sessions unavailable');
    const { session } = createFakeSession(engine);
    const list = new ChatList(session);
    list.attach();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    expect(await until(list, (s) => s.error !== null)).toMatchObject({ loaded: false, error: 'sessions unavailable', rows: [] });
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ loaded: true, error: null });
    expect(filterRows(list.getSnapshot().rows, 'all', FIXTURE_NOW)).toHaveLength(6);
    session.dispose();
    list.dispose();
  });
});
