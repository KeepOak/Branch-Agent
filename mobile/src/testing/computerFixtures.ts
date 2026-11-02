// Engine rows for tests: what environments.list returns for a host and two other computers.
import { FIXTURE_NOW } from './chatFixtures';

export const fixtureEnvironments = [
  { id: 'gateway', type: 'host', status: 'available', platform: 'darwin', desktop: true },
  { id: 'node:home', type: 'node', label: 'Home server', status: 'available', platform: 'linux', desktop: true },
  {
    id: 'node:studio',
    type: 'node',
    label: 'Studio',
    status: 'unavailable',
    platform: 'win32',
    lastSeenAtMs: new Date(2026, 9, 4, 12, 0).getTime(),
  },
];

export { FIXTURE_NOW };
