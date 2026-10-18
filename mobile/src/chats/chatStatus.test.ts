import { fixtureAgents, fixtureSessions, FIXTURE_NOW } from '../testing/chatFixtures';
import { chatRows, readAgents } from './chatList';
import { rowStatus, statusChip, unreadBadge } from './chatStatus';

const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);
const byKey = (key: string) => rows.find((row) => row.key === key)!;

describe('chat status chips', () => {
  it('labels Working, Waiting for you and Done, and skips a room', () => {
    expect(rowStatus(byKey('agent:oak:main'))).toBe('working');
    expect(statusChip(byKey('agent:oak:main'))).toMatchObject({ label: 'Working', dot: 'ok' });
    expect(statusChip(byKey('agent:oak:chat-1'))).toMatchObject({ label: 'Waiting for you', dot: 'warn' });
    expect(statusChip(byKey('agent:main:main'))).toMatchObject({ label: 'Done', dot: 'ink3' });
    expect(statusChip(byKey('agent:oak:room:launch'))).toBeNull();
    expect(unreadBadge(byKey('agent:main:main'))).toBe(1);
    expect(unreadBadge(byKey('agent:oak:main'))).toBe(0);
    expect(byKey('agent:researcher:main').updatedAt).toBeLessThan(FIXTURE_NOW);
  });
});
