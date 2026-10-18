import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { NO_ATTACH_METHOD_NOTE, type PickedFile } from '../chat/attachments';
import { Conversation } from '../chat/conversation';
import { AttachProblem, CAMERA_OFF_MESSAGE, type AttachmentPickers } from '../chat/pickAttachment';
import { chatRows, readAgents } from '../chats/chatList';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ChatScreen, workedFor } from './ChatScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });
// pairedApp compiles the full App (welcome through chats). Jest's 5s default is too tight
// on a cold CI worker — same budget as pairingScreens.test.tsx and settingsScreen.test.tsx.
jest.setTimeout(20_000);
const KEY = 'agent:main:main';
const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);
const mainRow = rows.find((r) => r.key === KEY)!;

const history = [
  { role: 'user', content: [{ type: 'text', text: 'File my September expenses' }], timestamp: 1_000 },
  { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: {} }, { type: 'toolCall', id: 't2', name: 'exec', arguments: { command: 'ls' } }], timestamp: 2_000, stopReason: 'toolUse' },
  { role: 'toolResult', toolCallId: 't2', content: [{ type: 'text', text: 'ok' }], timestamp: 8_000 },
  { role: 'assistant', content: [{ type: 'text', text: 'Your expenses for September are filed.' }], timestamp: 13_000, stopReason: 'stop' },
];

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
  engine.setHistory(KEY, history);
  const { session } = createFakeSession(engine);
  await render(<App scheme="light" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chat-' + KEY)).toBeOnTheScreen());
  return { session, engine };
}

function pickersOf(next: () => Promise<PickedFile | null> | PickedFile | null): AttachmentPickers {
  const run = async () => {
    const value = await next();
    return value;
  };
  return { takePhoto: run, pickPhoto: run, pickFile: run };
}

async function renderChat(
  online: boolean,
  setup: (engine: ReturnType<typeof createFakeEngine>) => void = () => undefined,
  attach = true,
  extras: { pickers?: AttachmentPickers; engine?: ReturnType<typeof createFakeEngine> } = {},
) {
  const engine = extras.engine ?? createFakeEngine();
  setup(engine);
  const { session } = createFakeSession(engine);
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  const conversation = new Conversation(KEY, session, () => 'run-1');
  if (attach) conversation.attach();
  await render(
    <ThemeProvider scheme="dark">
      <ChatScreen row={mainRow} conversation={conversation} online={online} onBack={() => undefined} hello={session.hello} pickers={extras.pickers} />
    </ThemeProvider>,
  );
  return { engine, session, conversation };
}

describe('chat screen', () => {
  it('opens a chat from Chats, sends, shows the reply as it is written, and goes back', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('chat-' + KEY));
    expect(screen.getByTestId('chat-screen')).toBeOnTheScreen();
    expect(screen.getByText('Branch Agent')).toBeOnTheScreen();
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    expect(screen.getByText('File my September expenses')).toBeOnTheScreen();
    // The row was unread: opening it clears the mark on the computer.
    expect(engine.requests.filter((r) => r.method === 'sessions.patch').map((r) => r.params)).toEqual([{ key: KEY, unread: false, agentId: 'main', expectedMarkedUnreadAt: null }]);

    expect(screen.getByTestId('send')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('composer'), 'Anything due this week?');
    await fireEvent.press(screen.getByTestId('send'));
    expect(screen.getByTestId('composer')).toHaveProp('value', '');
    await eventually(() => expect(screen.getByText('Anything due this week?')).toBeOnTheScreen());
    const sent = engine.requests.find((r) => r.method === 'chat.send')?.params as { idempotencyKey: string };
    expect(sent).toMatchObject({ sessionKey: KEY, message: 'Anything due this week?' });
    await eventually(() => expect(screen.getByTestId('live-reply')).toHaveTextContent('Thinking…'));
    expect(screen.getByTestId('stop-reply')).toBeOnTheScreen();

    const runId = sent.idempotencyKey;
    await act(async () => engine.streamReply(KEY, runId, 'The rent, '));
    await eventually(() => expect(screen.getByTestId('live-reply')).toHaveTextContent('The rent,'));
    expect(screen.getByTestId('chat-status')).toHaveTextContent('Typing…');
    await act(async () => engine.streamReply(KEY, runId, 'The rent, on Friday.'));
    await eventually(() => expect(screen.getByTestId('live-reply')).toHaveTextContent('The rent, on Friday.'));

    engine.setHistory(KEY, [
      ...history,
      { role: 'user', content: [{ type: 'text', text: 'Anything due this week?' }], timestamp: 20_000, idempotencyKey: runId + ':user' },
      { role: 'assistant', content: [{ type: 'text', text: 'The rent, on Friday.' }], timestamp: 21_000, stopReason: 'stop' },
    ]);
    await act(async () => engine.emit('chat', { runId, sessionKey: KEY, seq: 3, state: 'final' }));
    await eventually(() => expect(screen.queryByTestId('live-reply')).toBeNull());
    expect(screen.getByText('The rent, on Friday.')).toBeOnTheScreen();
    expect(screen.getByTestId('send')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('chat-back'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    // The computer cleared the mark, so the row reads as read.
    await eventually(() => expect(screen.queryByTestId('unread-' + KEY)).toBeNull());
    session.dispose();
  });

  it('folds a turn’s steps into one line that opens to list them', async () => {
    const { conversation, session } = await renderChat(true, (engine) => engine.setHistory(KEY, history));
    await eventually(() => expect(screen.getByText('Worked for 12s · 2 steps ›')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('work-h:1:work'));
    const steps = within(screen.getByTestId('steps-h:1:work'));
    expect(steps.getByText('1. Read a file')).toBeOnTheScreen();
    expect(steps.getByText('2. Ran a command')).toBeOnTheScreen();
    expect(workedFor(95_000)).toBe('2 min');
    expect(workedFor(3_900_000)).toBe('1 h 5 min');
    conversation.dispose();
    session.dispose();
  });

  it('shows grey bubbles before the first read, then a greeting for an empty chat', async () => {
    const { conversation, session } = await renderChat(true, undefined, false);
    expect(screen.getByTestId('chat-loading')).toBeOnTheScreen();
    await act(async () => conversation.attach());
    await eventually(() => expect(screen.getByTestId('chat-empty')).toHaveTextContent(/Say hello to Branch Agent/));
    conversation.dispose();
    session.dispose();
  });

  it('says why a chat couldn’t load, with Try again', async () => {
    const { conversation, session, engine } = await renderChat(true, (e) => e.failMethod('chat.history', 'history unavailable'));
    await eventually(() => expect(screen.getByTestId('chat-error')).toHaveTextContent(/Can't reach Branch/));
    engine.failMethod('chat.history', null);
    engine.setHistory(KEY, history);
    await fireEvent.press(screen.getByTestId('chat-error-action'));
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    conversation.dispose();
    session.dispose();
  });

  it('keeps a message that didn’t go, with the reason, and tries again on a tap', async () => {
    const { conversation, session, engine } = await renderChat(true, (e) => e.setHistory(KEY, history));
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    engine.failMethod('chat.send', 'The engine is busy');
    await fireEvent.changeText(screen.getByTestId('composer'), 'Pay the rent');
    await fireEvent.press(screen.getByTestId('send'));
    await eventually(() => expect(screen.getByTestId('retry-run-1')).toHaveTextContent("Not sent: Can't reach Branch. Check your connection. Tap to try again."));
    engine.failMethod('chat.send', null);
    await fireEvent.press(screen.getByTestId('retry-run-1'));
    await eventually(() => expect(screen.queryByTestId('retry-run-1')).toBeNull());
    expect(engine.requests.filter((r) => r.method === 'chat.send')).toHaveLength(2);
    conversation.dispose();
    session.dispose();
  });

  it('waits for the computer before sending, and keeps what you typed', async () => {
    const { conversation, session } = await renderChat(false, (e) => e.setHistory(KEY, history));
    expect(screen.getByTestId('chat-status')).toHaveTextContent('Reconnecting…');
    expect(screen.getByTestId('chat-offline')).toHaveTextContent('Reconnecting to your computer… This chat may be out of date.');
    expect(screen.getByTestId('composer')).toHaveProp('placeholder', 'Waiting for your computer…');
    await fireEvent.changeText(screen.getByTestId('composer'), 'Later please');
    expect(screen.getByTestId('send')).toBeDisabled();
    expect(screen.getByTestId('composer')).toHaveProp('value', 'Later please');
    conversation.dispose();
    session.dispose();
  });
});

describe('chat attachments', () => {
  const photo: PickedFile = { fileName: 'shot.png', mimeType: 'image/png', sizeBytes: 3, content: 'AAA' };
  const notes: PickedFile = { fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, content: 'BBBB' };

  it('picks a photo from the library, shows a preview chip, and sends it on chat.send', async () => {
    const { conversation, session, engine } = await renderChat(true, (e) => e.setHistory(KEY, history), true, {
      pickers: pickersOf(() => photo),
    });
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    expect(screen.getByTestId('attach')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('attach'));
    await fireEvent.press(screen.getByTestId('attach-library'));
    await eventually(() => expect(screen.getByTestId('file-chip')).toHaveTextContent(/shot\.png/));
    expect(screen.getByTestId('file-chip')).toHaveTextContent(/3 B/);
    await fireEvent.changeText(screen.getByTestId('composer'), 'Look at this');
    await fireEvent.press(screen.getByTestId('send'));
    expect(screen.queryByTestId('file-chip')).toBeNull();
    await eventually(() => expect(screen.getByText('Look at this')).toBeOnTheScreen());
    expect(engine.requests.find((r) => r.method === 'chat.send')?.params).toEqual({
      sessionKey: KEY,
      message: 'Look at this',
      idempotencyKey: 'run-1',
      attachments: [{ type: 'image', mimeType: 'image/png', fileName: 'shot.png', origin: 'file', content: 'AAA' }],
    });
    conversation.dispose();
    session.dispose();
  });

  it('picks a photo from the camera or a file, and sends a file with no words', async () => {
    let next: PickedFile = photo;
    const { conversation, session, engine } = await renderChat(true, (e) => e.setHistory(KEY, history), true, {
      pickers: pickersOf(() => next),
    });
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('attach'));
    await fireEvent.press(screen.getByTestId('attach-photo'));
    await eventually(() => expect(screen.getByTestId('file-chip')).toHaveTextContent(/shot\.png/));
    await fireEvent.press(screen.getByTestId('remove-file-f1'));
    expect(screen.queryByTestId('file-chip')).toBeNull();
    next = notes;
    await fireEvent.press(screen.getByTestId('attach'));
    await fireEvent.press(screen.getByTestId('attach-file'));
    await eventually(() => expect(screen.getByTestId('file-chip')).toHaveTextContent(/notes\.txt/));
    expect(screen.getByTestId('send')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('send'));
    await eventually(() => expect(screen.getByText('notes.txt')).toBeOnTheScreen());
    expect(engine.requests.find((r) => r.method === 'chat.send')?.params).toMatchObject({
      message: '',
      attachments: [{ type: 'file', mimeType: 'text/plain', fileName: 'notes.txt', content: 'BBBB' }],
    });
    conversation.dispose();
    session.dispose();
  });

  it('keeps a chip that is too large, and shows why a pick failed', async () => {
    let fail = false;
    const { conversation, session } = await renderChat(
      true,
      (e) => e.setHistory(KEY, history),
      true,
      {
        engine: createFakeEngine({ attachmentPolicy: { maxBytes: 100, maxImageBytes: 2 } }),
        pickers: pickersOf(() => {
          if (fail) throw new AttachProblem(CAMERA_OFF_MESSAGE);
          return photo;
        }),
      },
    );
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('attach'));
    await fireEvent.press(screen.getByTestId('attach-library'));
    await eventually(() => expect(screen.getByTestId('file-chip')).toHaveTextContent(/Too large to send: shot\.png/));
    expect(screen.getByTestId('send')).toBeDisabled();
    fail = true;
    await fireEvent.press(screen.getByTestId('attach'));
    await fireEvent.press(screen.getByTestId('attach-photo'));
    await eventually(() => expect(screen.getByTestId('attach-error')).toHaveTextContent(CAMERA_OFF_MESSAGE));
    conversation.dispose();
    session.dispose();
  });

  it('disables attach when the hello does not offer chat.send', async () => {
    const { conversation, session } = await renderChat(true, (e) => e.setHistory(KEY, history), true, {
      engine: createFakeEngine({ methods: ['chat.history'] }),
    });
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    expect(screen.getByTestId('attach')).toBeDisabled();
    expect(screen.getByTestId('attach-unavailable')).toHaveTextContent(NO_ATTACH_METHOD_NOTE);
    conversation.dispose();
    session.dispose();
  });
});
