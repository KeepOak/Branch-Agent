import { waitFor } from '@testing-library/react-native';
import { Conversation, historyItems, phaseLabel, stepTitle } from './conversation';
import { createFakeEngine, type FakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import type { PairingSession } from '../pairing/pairingSession';

const KEY = 'agent:main:main';
const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });

const user = (text: string, timestamp: number, runId?: string) => ({ role: 'user', content: [{ type: 'text', text }], timestamp, ...(runId ? { idempotencyKey: `${runId}:user` } : {}) });
const reply = (text: string, timestamp: number) => ({ role: 'assistant', content: [{ type: 'text', text }], timestamp, stopReason: 'stop' });
async function paired(engine: FakeEngine = createFakeEngine()) {
  const { session } = createFakeSession(engine);
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  return { session, engine };
}

function open(session: PairingSession, ids: string[] = ['run-1', 'run-2']) {
  const queue = [...ids];
  const conversation = new Conversation(KEY, session, () => queue.shift() ?? 'run-x');
  conversation.attach();
  return conversation;
}

describe('chat history as the phone shows it', () => {
  it('keeps your messages and the replies, folds a turn’s tool calls into one line, and keeps notices and errors', () => {
    const { items, runKeys } = historyItems([
      user('Check the build', 1_000, 'run-a'),
      { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'toolCall', id: 't1', name: 'exec', arguments: { command: 'pnpm build' } }], timestamp: 2_000, stopReason: 'toolUse' },
      { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: 'ok' }], timestamp: 5_000 },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'toolCall', id: 't2', name: 'web_fetch', arguments: {} }], timestamp: 6_000, stopReason: 'toolUse' },
      reply('The build passes.', 13_000),
      { role: 'custom', customType: 'note', display: true, content: 'Chat was reset' },
      { role: 'custom', customType: 'hidden', content: 'not shown' },
      user('And again', 20_000),
      { role: 'assistant', content: [], timestamp: 21_000, stopReason: 'error', errorMessage: 'The model is busy.' },
      { role: 'user', content: [{ type: 'text', text: 'carry on' }], timestamp: 30_000, provenance: { kind: 'internal_system', sourceTool: 'main_session_restart_recovery' } },
    ]);
    expect(items.map((i) => [i.kind, 'text' in i ? i.text : i.steps.join(' / ')])).toEqual([
      ['user', 'Check the build'],
      ['assistant', 'Looking.'],
      ['work', 'Ran a command / Read a web page'],
      ['assistant', 'The build passes.'],
      ['notice', 'Chat was reset'],
      ['user', 'And again'],
      ['error', 'The model is busy.'],
      ['notice', 'Continued after an update'],
    ]);
    expect(items[2]).toMatchObject({ kind: 'work', durationMs: 12_000 });
    expect([...runKeys]).toEqual(['run-a']);
  });

  it('names steps plainly and says what a reply is doing before its first words', () => {
    expect(stepTitle('read')).toBe('Read a file');
    expect(stepTitle('github_pr_view')).toBe('Used github pr view');
    expect(phaseLabel('starting_model')).toBe('Starting the model…');
    expect(phaseLabel(null)).toBe('Thinking…');
  });
});

describe('one chat, live', () => {
  it('reads the chat, streams a reply as it is written, and keeps it on screen until the saved copy lands', async () => {
    const { session, engine } = await paired();
    engine.setHistory(KEY, [user('Hi', 1_000), reply('Hello!', 2_000)]);
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    expect(chat.getSnapshot().items.map((i) => ('text' in i ? i.text : ''))).toEqual(['Hi', 'Hello!']);

    await chat.send('  What is on today?  ');
    expect(engine.requests.find((r) => r.method === 'chat.send')?.params).toEqual({ sessionKey: KEY, message: 'What is on today?', idempotencyKey: 'run-1' });
    expect(chat.getSnapshot().sends).toMatchObject([{ id: 'run-1', text: 'What is on today?', state: 'sent' }]);
    expect(chat.getSnapshot().live).toMatchObject({ runId: 'run-1', text: '' });

    engine.emit('chat', { runId: 'run-1', sessionKey: KEY, seq: 1, state: 'status', phase: 'starting_model' });
    await eventually(() => expect(chat.getSnapshot().live?.phase).toBe('starting_model'));
    engine.streamReply(KEY, 'run-1', 'Two ');
    engine.streamReply(KEY, 'run-1', 'Two meetings.');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Two meetings.'));
    // A rewrite of the reply replaces its words.
    engine.streamReply(KEY, 'run-1', 'Two meetings and lunch.');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Two meetings and lunch.'));

    engine.setHistory(KEY, [user('Hi', 1_000), reply('Hello!', 2_000), user('What is on today?', 3_000, 'run-1'), reply('Two meetings and lunch.', 4_000)]);
    const seen: Array<[number, boolean]> = [];
    chat.subscribe(() => seen.push([chat.getSnapshot().items.length, chat.getSnapshot().live !== null]));
    engine.emit('chat', { runId: 'run-1', sessionKey: KEY, seq: 5, state: 'final' });
    await eventually(() => expect(chat.getSnapshot().live).toBeNull());
    // The live reply only went once the saved one was in the list: never a frame with neither.
    expect(seen.every(([items, live]) => items === 4 || live)).toBe(true);
    expect(chat.getSnapshot().items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Two meetings and lunch.' });
    expect(chat.getSnapshot().sends).toEqual([]);
    // A late event for the finished run can't bring it back.
    engine.streamReply(KEY, 'run-1', 'late');
    await new Promise((r) => setTimeout(r, 20));
    expect(chat.getSnapshot().live).toBeNull();
    chat.dispose();
    session.dispose();
  });

  it('keeps a message the history doesn’t hold yet, even when an earlier message said the same words', async () => {
    const { session, engine } = await paired();
    engine.setHistory(KEY, [user('Hello', 1_000, 'run-0'), reply('Hi!', 2_000)]);
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    await chat.send('Hello');
    expect(chat.getSnapshot().sends).toMatchObject([{ id: 'run-1', text: 'Hello', state: 'sent' }]);

    // A read that lands before the engine has saved this send: only the earlier "Hello" is in it.
    await chat.load();
    expect(chat.getSnapshot().sends).toMatchObject([{ id: 'run-1', text: 'Hello', state: 'sent' }]);
    expect(chat.getSnapshot().live).toMatchObject({ runId: 'run-1' });

    // Once the history holds this send (by its key), the history draws it.
    engine.setHistory(KEY, [user('Hello', 1_000, 'run-0'), reply('Hi!', 2_000), user('Hello', 3_000, 'run-1')]);
    await chat.load();
    expect(chat.getSnapshot().sends).toEqual([]);
    chat.dispose();
    session.dispose();
  });

  it('keeps a message that didn’t go with its reason, and sends it again under the same key', async () => {
    const { session, engine } = await paired();
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    engine.failMethod('chat.send', 'The engine is busy');
    await chat.send('Book the table');
    expect(chat.getSnapshot().sends).toMatchObject([{ id: 'run-1', state: 'failed', error: 'The engine is busy' }]);
    expect(chat.getSnapshot().live).toBeNull();
    engine.failMethod('chat.send', null);
    await chat.retry('run-1');
    const sends = engine.requests.filter((r) => r.method === 'chat.send').map((r) => (r.params as { idempotencyKey: string }).idempotencyKey);
    expect(sends).toEqual(['run-1', 'run-1']);
    expect(chat.getSnapshot().sends).toMatchObject([{ id: 'run-1', state: 'sent' }]);
    chat.dispose();
    session.dispose();
  });

  it('stops a reply, and says how a reply ended when it didn’t finish', async () => {
    const { session, engine } = await paired();
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    await chat.send('Write a long essay');
    engine.streamReply(KEY, 'run-1', 'Once');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Once'));
    await chat.stop();
    expect(engine.requests.find((r) => r.method === 'chat.abort')?.params).toEqual({ sessionKey: KEY, runId: 'run-1' });
    engine.emit('chat', { runId: 'run-1', sessionKey: KEY, seq: 2, state: 'aborted' });
    await eventually(() => expect(chat.getSnapshot().ended).toEqual({ runId: 'run-1', text: 'Stopped.', failed: false }));

    await chat.send('Try once more');
    expect(chat.getSnapshot().ended).toBeNull();
    engine.emit('chat', { runId: 'run-2', sessionKey: KEY, seq: 1, state: 'error', errorMessage: 'Rate limited. Try again in a minute.' });
    await eventually(() => expect(chat.getSnapshot().ended).toEqual({ runId: 'run-2', text: 'Rate limited. Try again in a minute.', failed: true }));
    await eventually(() => expect(chat.getSnapshot().live).toBeNull());
    chat.dispose();
    session.dispose();
  });

  it('follows a reply started on the computer, ignores other chats, and picks a running reply back up after a reconnect', async () => {
    const { session, engine } = await paired();
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    engine.streamReply('agent:oak:main', 'other', 'not here');
    engine.streamReply(KEY, 'desk-1', 'From the desk');
    await eventually(() => expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'From the desk' }));

    engine.setHistory(KEY, [user('Summarise my mail', 1_000)], { runId: 'desk-1', text: 'From the desk, three emails', startedAt: 900 });
    engine.drop();
    await eventually(() => expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'From the desk, three emails', startedAt: 900 }));
    expect(chat.getSnapshot().items).toMatchObject([{ kind: 'user', text: 'Summarise my mail' }]);
    chat.dispose();
    session.dispose();
  });

  it('takes the history’s words for a reply after a reconnect, even when they are shorter than what streamed before', async () => {
    const { session, engine } = await paired();
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    engine.streamReply(KEY, 'desk-1', 'Three emails, all about the long offsite plan');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Three emails, all about the long offsite plan'));

    // While the phone was away the reply rewrote itself shorter; the new connection's read is the newest word on it.
    engine.setHistory(KEY, [user('Summarise my mail', 1_000)], { runId: 'desk-1', text: 'Two emails.', startedAt: 900 });
    engine.drop();
    await eventually(() => expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Two emails.', startedAt: 900 }));
    engine.streamReply(KEY, 'desk-1', 'Two emails. Both');
    engine.streamReply(KEY, 'desk-1', 'Two emails. Both about lunch.');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Two emails. Both about lunch.'));
    chat.dispose();
    session.dispose();
  });

  it('keeps a reply from the computer that started while a history read was on its way', async () => {
    const { session, engine } = await paired();
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));

    // A read starts (a reconnect, a change on the computer), then the computer starts a reply.
    engine.setHistory(KEY, [user('Summarise my mail', 1_000)]);
    const release = engine.hold('chat.history');
    const reading = chat.load();
    engine.streamReply(KEY, 'desk-1', 'From the desk');
    await eventually(() => expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'From the desk' }));
    // The read was answered before that run began, so it has no inFlightRun.
    release();
    await reading;
    expect(chat.getSnapshot().items).toMatchObject([{ kind: 'user', text: 'Summarise my mail' }]);
    expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'From the desk' });

    // A read started after the reply's last words, and still without it, is the newer word: the reply is over.
    await chat.load();
    expect(chat.getSnapshot().live).toBeNull();
    chat.dispose();
    session.dispose();
  });

  it('keeps a shorter rewrite of the same reply that came while a history read naming that reply was on its way', async () => {
    const { session, engine } = await paired();
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    engine.streamReply(KEY, 'desk-1', 'Three emails, all about the long offsite plan');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Three emails, all about the long offsite plan'));

    // A read starts, naming the reply with its words so far; then the reply rewrites itself shorter before the answer arrives.
    engine.setHistory(KEY, [user('Summarise my mail', 1_000)], { runId: 'desk-1', text: 'Three emails, all about the long offsite plan', startedAt: 900 });
    const release = engine.hold('chat.history');
    const reading = chat.load();
    engine.streamReply(KEY, 'desk-1', 'Two emails.');
    await eventually(() => expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Two emails.' }));
    release();
    await reading;
    expect(chat.getSnapshot().items).toMatchObject([{ kind: 'user', text: 'Summarise my mail' }]);
    expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Two emails.', startedAt: 900 });
    chat.dispose();
    session.dispose();
  });
});

describe('opening a chat part-way through a reply', () => {
  /** The words added to a reply in each `chat` frame the phone was sent, and whether the frame carried the whole text. */
  const framesFor = (engine: FakeEngine, runId: string) =>
    engine.delivered
      .filter((f) => f.event === 'chat' && (f.payload as { runId?: string }).runId === runId)
      .map((f) => [(f.payload as { deltaText?: string }).deltaText, 'message' in (f.payload as object)]);

  /**
   * The phone is on Chats (or another chat) while the computer replies, so this connection already holds the run's
   * frames when the chat opens. The engine read `historyText` for the history; the read's answer waits.
   */
  async function openMidReply(streamedBefore: string[], historyText: string) {
    const { session, engine } = await paired();
    for (const text of streamedBefore) engine.streamReply(KEY, 'desk-1', text);
    await new Promise((r) => setTimeout(r, 20));
    engine.setHistory(KEY, [user('Say hello', 1_000)], { runId: 'desk-1', text: historyText, startedAt: 900 });
    const release = engine.hold('chat.history');
    const chat = open(session);
    return { session, engine, chat, release };
  }

  it('keeps every word that came after the engine read the reply for the history, and never doubles one', async () => {
    const { session, engine, chat, release } = await openMidReply(['Hello', 'Hello world'], 'Hello world');
    // More words after the engine's read and before its answer lands. This connection holds the frames before, so
    // the engine sends the addition alone.
    engine.streamReply(KEY, 'desk-1', 'Hello world!');
    await eventually(() => expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Hello world!' }));
    expect(framesFor(engine, 'desk-1')).toEqual([['Hello', true], [' world', false], ['!', false]]);
    release();
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Hello world!', startedAt: 900 });
    engine.streamReply(KEY, 'desk-1', 'Hello world! How are you?');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Hello world! How are you?'));
    expect(framesFor(engine, 'desk-1').at(-1)).toEqual([' How are you?', false]);
    chat.dispose();
    session.dispose();
  });

  it('keeps a repeated word that streamed while the first read was on its way', async () => {
    const { session, engine, chat, release } = await openMidReply(['Hello', 'Hello world'], 'Hello world');
    engine.streamReply(KEY, 'desk-1', 'Hello world world');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Hello world world'));
    release();
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Hello world world', startedAt: 900 });
    engine.streamReply(KEY, 'desk-1', 'Hello world world world');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Hello world world world'));
    chat.dispose();
    session.dispose();
  });

  it('keeps the words written before the chat opened when only a status came during the first read', async () => {
    const { session, engine, chat, release } = await openMidReply(['Hello'], 'Hello');
    engine.emit('chat', { runId: 'desk-1', sessionKey: KEY, seq: 2, state: 'status', phase: 'preparing_context' });
    release();
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Hello' });
    engine.streamReply(KEY, 'desk-1', 'Hello there');
    await eventually(() => expect(chat.getSnapshot().live?.text).toBe('Hello there'));
    expect(framesFor(engine, 'desk-1').at(-1)).toEqual([' there', false]);
    chat.dispose();
    session.dispose();
  });

  it('starts a new connection when an addition comes for words this connection never had', async () => {
    const { session, engine } = await paired();
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().loaded).toBe(true));
    engine.setHistory(KEY, [user('Say hello', 1_000)], { runId: 'desk-1', text: 'Hello there', startedAt: 900 });
    const connects = engine.connects.length;
    // The engine believes this connection holds the run's frames, but the phone never had them.
    engine.emit('chat', { runId: 'desk-1', sessionKey: KEY, seq: 4, state: 'delta', deltaText: ' there' });
    await eventually(() => expect(engine.connects).toHaveLength(connects + 1));
    // No bare words reach the chat; the new connection's read has the whole reply.
    await eventually(() => expect(chat.getSnapshot().live).toMatchObject({ runId: 'desk-1', text: 'Hello there', startedAt: 900 }));
    chat.dispose();
    session.dispose();
  });
});

describe('one chat, around the reply', () => {
  it('says why the chat couldn’t be read, and clears the unread mark once when opened', async () => {
    const { session, engine } = await paired();
    engine.failMethod('chat.history', 'history unavailable');
    const chat = open(session);
    await eventually(() => expect(chat.getSnapshot().error).toBe('history unavailable'));
    expect(chat.getSnapshot().loaded).toBe(false);
    engine.failMethod('chat.history', null);
    await chat.load();
    expect(chat.getSnapshot()).toMatchObject({ loaded: true, error: null });

    await chat.markRead({ unread: false });
    expect(engine.requests.filter((r) => r.method === 'sessions.patch')).toEqual([]);
    await chat.markRead({ unread: true, agentId: 'main', markedUnreadAt: 123 });
    expect(engine.requests.filter((r) => r.method === 'sessions.patch').map((r) => r.params)).toEqual([{ key: KEY, unread: false, agentId: 'main', expectedMarkedUnreadAt: 123 }]);
    chat.dispose();
    session.dispose();
  });
});
