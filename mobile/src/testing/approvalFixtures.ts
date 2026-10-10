// Pending approvals for tests and screenshots, as exec.approval.list and plugin.approval.list return them:
// Oak wants to run a command in its chat, and the mail plugin wants to send an email for Branch Agent.
import type { FakeApproval } from '../connect/fakeEngine';
import { FIXTURE_NOW } from './chatFixtures';

const MINUTE = 60_000;

export const fixtureExecApproval: FakeApproval = {
  id: 'exec-1',
  createdAtMs: FIXTURE_NOW - 3 * MINUTE,
  expiresAtMs: FIXTURE_NOW + 27 * MINUTE,
  request: {
    command: 'pnpm install --frozen-lockfile',
    cwd: '/Users/sam/Code/branch/window',
    host: 'gateway',
    agentId: 'oak',
    sessionKey: 'agent:oak:chat-1',
    allowedDecisions: ['allow-once', 'allow-always', 'deny'],
    commandAnalysis: { warningLines: ['Downloads packages from the internet'] },
  },
};

export const fixturePluginApproval: FakeApproval = {
  id: 'plugin:mail-1',
  createdAtMs: FIXTURE_NOW - MINUTE,
  expiresAtMs: FIXTURE_NOW + 4 * MINUTE + 12_000,
  request: {
    title: 'Send an email to Dana?',
    description: 'To: Dana Whitfield\nSubject: September expenses\nHi Dana, the September expenses are filed. The report is attached.',
    agentId: 'main',
    sessionKey: 'agent:main:main',
    allowedDecisions: ['allow-once', 'deny'],
  },
};

export const fixtureApprovals = { exec: [fixtureExecApproval], plugin: [fixturePluginApproval] };

/** The same approvals, asked as many minutes before `now` as before FIXTURE_NOW, so they haven't run out of time. */
export function approvalsAt(now: number) {
  const shift = (a: FakeApproval): FakeApproval => ({ ...a, createdAtMs: a.createdAtMs - FIXTURE_NOW + now, expiresAtMs: a.expiresAtMs - FIXTURE_NOW + now });
  return { exec: fixtureApprovals.exec.map(shift), plugin: fixtureApprovals.plugin.map(shift) };
}
