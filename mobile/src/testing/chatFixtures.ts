// Engine rows for tests and screenshots: what sessions.list and agents.list return on a computer with
// two Trunks and a few chats, plus rows the phone must leave out.
const MINUTE = 60_000;

export const FIXTURE_NOW = new Date(2026, 9, 8, 21, 41).getTime();

export const fixtureAgents = {
  defaultId: 'main',
  mainKey: 'main',
  scope: 'per-sender',
  agents: [
    { id: 'main', name: 'Branch Agent', identity: { name: 'Branch Agent', emoji: '🌿' } },
    { id: 'oak', name: 'Oak' },
    { id: 'researcher', identity: { name: 'Researcher', emoji: '🔎' } },
  ],
};

export const fixtureSessions = [
  { key: 'agent:main:main', agentId: 'main', updatedAt: FIXTURE_NOW - 2 * MINUTE, lastMessagePreview: 'Your expenses for September are filed.\nAnything else?', unread: true },
  { key: 'agent:oak:main', agentId: 'oak', updatedAt: FIXTURE_NOW - 30 * 1000, lastMessagePreview: 'Running the window tests now', hasActiveRun: true },
  { key: 'agent:oak:room:launch', agentId: 'oak', kind: 'group', label: 'Launch team', updatedAt: FIXTURE_NOW - 3 * 60 * MINUTE, lastMessagePreview: 'Researcher: the store listing is ready' },
  { key: 'agent:researcher:taxes', agentId: 'researcher', label: 'Taxes', snoozedUntil: FIXTURE_NOW + 2 * 24 * 60 * MINUTE, updatedAt: FIXTURE_NOW - 5 * 60 * MINUTE, lastMessagePreview: 'Remind me after the weekend' },
  { key: 'agent:oak:chat-1', agentId: 'oak', label: 'Fix the settings page', updatedAt: FIXTURE_NOW - 26 * 60 * MINUTE, lastMessagePreview: 'Can I run pnpm install?', needsYou: true },
  { key: 'agent:researcher:main', agentId: 'researcher', updatedAt: FIXTURE_NOW - 4 * 24 * 60 * MINUTE, lastMessagePreview: 'Here are three phones under $500.', pinned: true },
  { key: 'agent:main:old', agentId: 'main', derivedTitle: 'Trip to Lisbon', updatedAt: FIXTURE_NOW - 40 * 24 * 60 * MINUTE, lastMessagePreview: '' },
  // Behind their chips: archived and an automation. Never shown: system, a helper and a child of a shown chat.
  { key: 'agent:main:archived', agentId: 'main', label: 'Archived chat', archived: true, updatedAt: FIXTURE_NOW },
  { key: 'agent:main:system', agentId: 'main', label: 'Heartbeat', classification: 'system', updatedAt: FIXTURE_NOW },
  { key: 'agent:main:cron:daily', agentId: 'main', label: 'Daily digest', updatedAt: FIXTURE_NOW },
  { key: 'agent:oak:helper', agentId: 'oak', label: 'Helper', spawnedBy: 'agent:oak:main', spawnDepth: 1, updatedAt: FIXTURE_NOW },
  { key: 'agent:oak:child', agentId: 'oak', label: 'Child', parentSessionKey: 'agent:oak:chat-1', updatedAt: FIXTURE_NOW },
];
