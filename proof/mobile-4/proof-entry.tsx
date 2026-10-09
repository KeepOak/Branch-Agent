// Proof harness only (not part of the app): the real App on the in-memory fake engine with the test
// fixture chats, already paired, plus hooks the capture script uses to act "on the computer".
import { registerRootComponent } from 'expo';
import App from './App';
import { createFakeEngine } from './src/connect/fakeEngine';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from './src/testing/chatFixtures';
import { createFakeSession } from './src/testing/fakeSession';

const KEY = 'agent:main:main';
const now = Date.now();
const shift = now - FIXTURE_NOW;
const sessions = fixtureSessions.map((row) => ({ ...row, updatedAt: row.updatedAt + shift }));
const engine = createFakeEngine({ sessions, agents: fixtureAgents });
const text = (role: string, t: string, at: number, extra = {}) => ({ role, content: [{ type: 'text', text: t }], timestamp: at, ...extra });
let history: unknown[] = [
  text('user', 'Can you file my September expenses?', now - 9 * 60_000),
  { role: 'assistant', content: [{ type: 'text', text: 'Sure. I’ll pull the receipts from your mail first.' }, { type: 'toolCall', id: 't1', name: 'web_fetch', arguments: {} }], timestamp: now - 9 * 60_000 + 4_000, stopReason: 'toolUse' },
  { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: 'ok' }], timestamp: now - 9 * 60_000 + 9_000 },
  { role: 'assistant', content: [{ type: 'toolCall', id: 't2', name: 'read', arguments: {} }, { type: 'toolCall', id: 't3', name: 'exec', arguments: { command: 'expenses file' } }], timestamp: now - 9 * 60_000 + 12_000, stopReason: 'toolUse' },
  { role: 'toolResult', toolCallId: 't3', content: [{ type: 'text', text: 'ok' }], timestamp: now - 9 * 60_000 + 40_000 },
  text('assistant', 'Your expenses for September are filed: 14 receipts, $1,284.50 in total. The taxi on the 12th had no receipt, so I left it out.', now - 9 * 60_000 + 47_000, { stopReason: 'stop' }),
  text('user', 'Thanks! Anything else due?', now - 2 * 60_000),
  text('assistant', 'Nothing else this week. Anything else?', now - 2 * 60_000 + 3_000, { stopReason: 'stop' }),
];
engine.setHistory(KEY, history);
const { session } = createFakeSession(engine);
engine.approve();
session.begin({ url: 'ws://studio.local:19031', bootstrapToken: 'boot-1' });

const lastSend = () => {
  const send = [...engine.requests].reverse().find((r) => r.method === 'chat.send');
  return send?.params as { idempotencyKey: string; message: string };
};
let seq = 0;
(globalThis as { branchProof?: unknown }).branchProof = {
  drop: () => engine.drop(),
  phase: (phase: string) => engine.emit('chat', { runId: lastSend().idempotencyKey, sessionKey: KEY, seq: ++seq, state: 'status', phase }),
  delta: (deltaText: string) => engine.emit('chat', { runId: lastSend().idempotencyKey, sessionKey: KEY, seq: ++seq, state: 'delta', deltaText }),
  finish: (reply: string) => {
    const send = lastSend();
    history = [...history, text('user', send.message, Date.now() - 4_000, { idempotencyKey: send.idempotencyKey + ':user' }), text('assistant', reply, Date.now(), { stopReason: 'stop' })];
    engine.setHistory(KEY, history);
    engine.emit('chat', { runId: send.idempotencyKey, sessionKey: KEY, seq: ++seq, state: 'final' });
  },
  aborted: (partial: string) => {
    const send = lastSend();
    history = [...history, text('user', send.message, Date.now() - 3_000, { idempotencyKey: send.idempotencyKey + ':user' }), text('assistant', partial, Date.now(), { stopReason: 'aborted' })];
    engine.setHistory(KEY, history);
    engine.emit('chat', { runId: send.idempotencyKey, sessionKey: KEY, seq: ++seq, state: 'aborted' });
  },
};

registerRootComponent(() => <App session={session} />);
