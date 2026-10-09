// Proof harness only (not part of the app): the real App on the in-memory fake engine with the test
// fixture chats, already paired and with nothing waiting, plus hooks the capture script uses to act "on the computer".
import { registerRootComponent } from 'expo';
import App from './App';
import { createFakeEngine } from './src/connect/fakeEngine';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from './src/testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from './src/testing/fakeNotifier';
import { createFakeSession } from './src/testing/fakeSession';

const now = Date.now();
const shift = now - FIXTURE_NOW;
const sessions = fixtureSessions.map((row) => ({ ...row, updatedAt: row.updatedAt + shift }));
const engine = createFakeEngine({ sessions, agents: fixtureAgents });
const { session } = createFakeSession(engine);
engine.approve();
session.begin({ url: 'ws://studio.local:19031', bootstrapToken: 'boot-1' });
const fake = createFakeNotifier('granted');
const appState = createFakeAppState('active');

(globalThis as { branchProof?: unknown }).branchProof = {
  request: () =>
    engine.requestApproval('exec', {
      id: 'exec-live',
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 20 * 60_000,
      request: { command: 'pnpm install --frozen-lockfile', cwd: '/Users/sam/Code/branch/window', agentId: 'oak', sessionKey: 'agent:oak:chat-1', allowedDecisions: ['allow-once', 'allow-always', 'deny'] },
    }),
  answerOnComputer: (id: string, decision: string) => engine.resolveApproval(id, decision),
  closeWindow: () => engine.setWindowOpen(false),
  asked: () => engine.requests.filter((r) => r.method === 'plugin.approval.request' || r.method.endsWith('.approval.resolve')),
};

registerRootComponent(() => <App session={session} notifier={fake.notifier} appState={appState.source} />);
