// Proof harness only (not part of the app): the real App on the in-memory fake engine with the test
// fixture chats and approvals, already paired, plus hooks the capture script uses to act "on the computer".
import { registerRootComponent } from 'expo';
import App from './App';
import { createFakeEngine } from './src/connect/fakeEngine';
import { approvalsAt } from './src/testing/approvalFixtures';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from './src/testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from './src/testing/fakeNotifier';
import { createFakeSession } from './src/testing/fakeSession';

const now = Date.now();
const shift = now - FIXTURE_NOW;
const sessions = fixtureSessions.map((row) => ({ ...row, updatedAt: row.updatedAt + shift }));
const engine = createFakeEngine({ sessions, agents: fixtureAgents, approvals: approvalsAt(now) });
const { session } = createFakeSession(engine);
engine.approve();
session.begin({ url: 'ws://studio.local:19031', bootstrapToken: 'boot-1' });
const fake = createFakeNotifier('undetermined');
const appState = createFakeAppState('active');

(globalThis as { branchProof?: unknown }).branchProof = {
  drop: () => engine.drop(),
  answerOnComputer: (id: string, decision: string) => engine.resolveApproval(id, decision),
  request: () =>
    engine.requestApproval('exec', {
      id: 'exec-live',
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 90_000,
      request: {
        command: 'curl -s -H "Authorization: Bearer sk-live-4f9a2c" https://api.github.com/repos/KeepOak/Branch-Agent/pulls?state=open',
        cwd: '/Users/sam/Code/branch',
        agentId: 'researcher',
        sessionKey: 'agent:researcher:main',
        allowedDecisions: ['allow-once', 'deny'],
        commandAnalysis: { warningLines: ['Sends a saved key to a website'] },
      },
    }),
  resolves: () => engine.requests.filter((r) => r.method.endsWith('.approval.resolve')),
};

registerRootComponent(() => <App session={session} notifier={fake.notifier} appState={appState.source} />);
