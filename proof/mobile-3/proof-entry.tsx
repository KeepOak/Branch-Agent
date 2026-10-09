// Proof harness only (not part of the app): the real App on the in-memory fake engine with the test
// fixture chats, already paired, plus hooks the capture script uses to act "on the computer".
import { registerRootComponent } from 'expo';
import App from './App';
import { createFakeEngine } from './src/connect/fakeEngine';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from './src/testing/chatFixtures';
import { createFakeSession } from './src/testing/fakeSession';

const shift = Date.now() - FIXTURE_NOW;
const sessions = fixtureSessions.map((row) => ({ ...row, updatedAt: row.updatedAt + shift }));
const engine = createFakeEngine({ sessions, agents: fixtureAgents });
const { session } = createFakeSession(engine);
engine.approve();
session.begin({ url: 'ws://studio.local:19031', bootstrapToken: 'boot-1' });
(globalThis as { branchProof?: unknown }).branchProof = {
  drop: () => engine.drop(),
  addChat: () => {
    engine.setSessions([{ key: 'agent:oak:launch', agentId: 'oak', label: 'Plan the launch', updatedAt: Date.now(), lastMessagePreview: 'On it. First draft in a few minutes.', hasActiveRun: true }, ...sessions]);
    engine.emit('sessions.changed', {});
  },
};

registerRootComponent(() => <App session={session} />);
