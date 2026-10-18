import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Vibration } from 'react-native';
import App from '../../App';
import { readApproval, type Approval, type ApprovalDecision } from '../approvals/approvals';
import { NO_ATTACH_METHOD_NOTE, type PickedFile } from '../chat/attachments';
import { Conversation } from '../chat/conversation';
import { AttachProblem, CAMERA_OFF_MESSAGE, type AttachmentPickers } from '../chat/pickAttachment';
import { chatRows, readAgents, type ChatRow } from '../chats/chatList';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureApprovals } from '../testing/approvalFixtures';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { fixtureEnvironments } from '../testing/computerFixtures';
import { createFakeSession } from '../testing/fakeSession';
import { PHONE_PREFS_DEFAULT, resetLivePhonePrefs, setLivePhonePrefs } from '../settings/phonePrefs';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ChatScreen, takeControlCopy, takeControlDetail, threadApprovals, workedFor } from './ChatScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });

beforeEach(() => {
  resetLivePhonePrefs();
});
// pairedApp compiles the full App (pairing through chats). Jest's 5s default is too tight
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
  extras: {
    pickers?: AttachmentPickers;
    engine?: ReturnType<typeof createFakeEngine>;
    row?: ChatRow;
    computerName?: string;
    pending?: Approval[];
    sending?: Record<string, ApprovalDecision>;
    failed?: Record<string, string>;
    onAnswer?: (id: string, decision: ApprovalDecision) => void;
    now?: number;
  } = {},
) {
  const engine = extras.engine ?? createFakeEngine();
  setup(engine);
  const { session } = createFakeSession(engine);
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  const conversation = new Conversation(KEY, session, () => 'run-1');
  if (attach) conversation.attach();
  const onTakeControl = jest.fn();
  const onAnswer = extras.onAnswer ?? jest.fn();
  await render(
    <ThemeProvider scheme="dark">
      <ChatScreen
        row={extras.row ?? mainRow}
        conversation={conversation}
        online={online}
        onBack={() => undefined}
        hello={session.hello}
        pickers={extras.pickers}
        onTakeControl={onTakeControl}
        computerName={extras.computerName ?? 'This computer'}
        pending={extras.pending}
        sending={extras.sending}
        failed={extras.failed}
        onAnswer={onAnswer}
        now={extras.now}
      />
    </ThemeProvider>,
  );
  return { engine, session, conversation, onTakeControl, onAnswer };
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

const computerHistory = [
  { role: 'user', content: [{ type: 'text', text: 'Find the invoice in Outlook' }], timestamp: 1_000 },
  {
    role: 'assistant',
    content: [
      { type: 'toolCall', id: 't1', name: 'read', arguments: {} },
      { type: 'toolCall', id: 't2', name: 'computer', arguments: {} },
      { type: 'toolCall', id: 't3', name: 'browser', arguments: {} },
    ],
    timestamp: 2_000,
    stopReason: 'toolUse',
  },
  { role: 'assistant', content: [{ type: 'text', text: 'Signing in to Outlook so I can search your mail' }], timestamp: 13_000, stopReason: 'stop' },
];

describe('thread parity', () => {
  it('names the Take control strip from the preview, and hides it on a room', () => {
    expect(takeControlCopy({ room: true, working: true, live: false, online: true })).toBeNull();
    expect(takeControlCopy({ room: false, working: true, live: false, online: true })).toEqual({ state: 'Working on its computer', liveOn: true });
    expect(takeControlCopy({ room: false, working: false, live: false, online: true })).toEqual({ state: 'Computer ready', liveOn: false });
    expect(takeControlCopy({ room: false, working: false, live: false, online: false })).toEqual({ state: 'Computer idle', liveOn: false });
    expect(takeControlCopy({ room: false, working: false, live: false, online: true, yours: true })).toEqual({ state: 'You have the computer', liveOn: false });
    expect(takeControlDetail([{ kind: 'work', key: 'w', steps: ['Read a file', 'Ran a command'], durationMs: 12_000 }], true)).toBe('');
    expect(threadApprovals([readApproval(fixtureApprovals.plugin[0], 'plugin')!], KEY, 1)).toHaveLength(1);
    expect(threadApprovals([readApproval(fixtureApprovals.plugin[0], 'plugin')!], 'agent:oak:chat-1', 1)).toHaveLength(0);
  });

  it('shows the Take control strip and opens Computers, the existing route', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, environments: fixtureEnvironments });
    engine.setHistory(KEY, history);
    const { session } = createFakeSession(engine);
    await render(<App scheme="light" session={session} />);
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    engine.approve();
    await eventually(() => expect(screen.getByTestId('chat-' + KEY)).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('chat-' + KEY));
    expect(screen.getByTestId('take-control-strip')).toBeOnTheScreen();
    expect(screen.getByText('Computer ready')).toBeOnTheScreen();
    expect(screen.getByText('This computer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('take-control'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('keeps the strip off a room', async () => {
    const roomRow = rows.find((r) => r.room)!;
    const { conversation, session } = await renderChat(true, (engine) => engine.setHistory(KEY, history), true, { row: roomRow });
    await eventually(() => expect(screen.getByText('Your expenses for September are filed.')).toBeOnTheScreen());
    expect(screen.queryByTestId('take-control-strip')).toBeNull();
    conversation.dispose();
    session.dispose();
  });

  it('says Working on its computer while a Trunk works', async () => {
    const { conversation, session, onTakeControl } = await renderChat(true, (engine) => engine.setHistory(KEY, history), true, {
      row: { ...mainRow, working: true },
    });
    await eventually(() => expect(screen.getByText('Working on its computer')).toBeOnTheScreen());
    expect(screen.getByTestId('take-control-live')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('take-control'));
    expect(onTakeControl).toHaveBeenCalledTimes(1);
    conversation.dispose();
    session.dispose();
  });

  it('shows a computer message with its steps and Watch, and keeps the quiet work line', async () => {
    const { conversation, session, onTakeControl } = await renderChat(true, (engine) => engine.setHistory(KEY, computerHistory), true, {
      row: { ...mainRow, working: true },
    });
    await eventually(() => expect(screen.getByText('Used computer')).toBeOnTheScreen());
    expect(screen.getByText('2 actions')).toBeOnTheScreen();
    expect(screen.getByText('This computer · Used the browser')).toBeOnTheScreen();
    expect(screen.getByText('Used the computer')).toBeOnTheScreen();
    expect(screen.getByText('Used the browser')).toBeOnTheScreen();
    expect(screen.getByText('Worked for 12s · 1 step ›')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('computer-open-h:1:computer'));
    expect(onTakeControl).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Watch')).toBeOnTheScreen();
    conversation.dispose();
    session.dispose();
  });

  it('shows an approval card in the thread and answers it here', async () => {
    const plugin = readApproval(fixtureApprovals.plugin[0], 'plugin')!;
    const { conversation, session, onAnswer } = await renderChat(true, (engine) => engine.setHistory(KEY, history), true, {
      pending: [plugin],
      now: 1,
    });
    await eventually(() => expect(screen.getByTestId('approval-plugin:mail-1')).toBeOnTheScreen());
    expect(screen.getByText('Send an email to Dana?')).toBeOnTheScreen();
    expect(screen.getByText('Dana Whitfield')).toBeOnTheScreen();
    expect(screen.getByTestId('ask-body-plugin:mail-1')).toHaveTextContent('Hi Dana, the September expenses are filed. The report is attached.');
    expect(screen.getByText('Send it')).toBeOnTheScreen();
    expect(screen.getByText('Don’t send')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('allow-plugin:mail-1'));
    expect(onAnswer).toHaveBeenCalledWith('plugin:mail-1', 'allow-once');
    conversation.dispose();
    session.dispose();
  });

  it('shows a plugin prose body and keeps Allow off until that body is on the card', async () => {
    const plugin = readApproval(
      {
        id: 'plugin:prose-1',
        createdAtMs: 1,
        expiresAtMs: 60_000,
        request: {
          title: 'Post a note to the board?',
          description: 'This will post the September summary to the shared board for the team.',
          sessionKey: KEY,
          allowedDecisions: ['allow-once', 'deny'],
        },
      },
      'plugin',
    )!;
    const blank = { ...plugin, id: 'plugin:blank-1', description: '', title: 'Do something on your computer' };
    const { conversation, session, onAnswer } = await renderChat(true, (engine) => engine.setHistory(KEY, history), true, {
      pending: [plugin, blank],
      now: 1,
    });
    await eventually(() => expect(screen.getByTestId('approval-plugin:prose-1')).toBeOnTheScreen());
    expect(screen.getByTestId('ask-body-plugin:prose-1')).toHaveTextContent('This will post the September summary to the shared board for the team.');
    expect(screen.getByTestId('allow-plugin:prose-1')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('allow-plugin:prose-1'));
    expect(onAnswer).toHaveBeenCalledWith('plugin:prose-1', 'allow-once');
    expect(screen.queryByTestId('ask-body-plugin:blank-1')).toBeNull();
    expect(screen.getByTestId('allow-plugin:blank-1')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('allow-plugin:blank-1'));
    expect(onAnswer).not.toHaveBeenCalledWith('plugin:blank-1', 'allow-once');
    conversation.dispose();
    session.dispose();
  });

  it('expands a long exec command and keeps Allow off when the command is empty', async () => {
    const exec = readApproval(fixtureApprovals.exec[0], 'exec')!;
    const long = {
      ...exec,
      id: 'exec-long',
      sessionKey: KEY,
      command: `${'pnpm install --frozen-lockfile && '.repeat(8)}echo done`,
    };
    const empty = { ...exec, id: 'exec-empty', sessionKey: KEY, command: '' };
    const { conversation, session, onAnswer } = await renderChat(true, (engine) => engine.setHistory(KEY, history), true, {
      pending: [long, empty],
      now: 1,
    });
    await eventually(() => expect(screen.getByTestId('approval-exec-long')).toBeOnTheScreen());
    expect(screen.getByTestId('command-more-exec-long')).toHaveTextContent('Show the whole command');
    expect(screen.getByTestId('allow-exec-long')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('command-more-exec-long'));
    expect(screen.getByTestId('command-more-exec-long')).toHaveTextContent('Show less');
    await fireEvent.press(screen.getByTestId('allow-exec-long'));
    expect(onAnswer).toHaveBeenCalledWith('exec-long', 'allow-once');
    expect(screen.getByTestId('allow-exec-empty')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('allow-exec-empty'));
    expect(onAnswer).not.toHaveBeenCalledWith('exec-empty', 'allow-once');
    conversation.dispose();
    session.dispose();
  });

  it('buzzes on send when Vibrate on taps is on, and stays still when it is off', async () => {
      const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
    try {
      setLivePhonePrefs({ ...PHONE_PREFS_DEFAULT, haptics: true });
      const on = await renderChat(true, (engine) => engine.setHistory(KEY, history));
      await fireEvent.changeText(screen.getByTestId('composer'), 'Hello');
      await fireEvent.press(screen.getByTestId('send'));
      expect(vibrate).toHaveBeenCalled();
      on.conversation.dispose();
      on.session.dispose();
      vibrate.mockClear();
      setLivePhonePrefs({ ...PHONE_PREFS_DEFAULT, haptics: false });
      const off = await renderChat(true, (engine) => engine.setHistory(KEY, history));
      await fireEvent.changeText(screen.getByTestId('composer'), 'Hello again');
      await fireEvent.press(screen.getByTestId('send'));
      expect(vibrate).not.toHaveBeenCalled();
      off.conversation.dispose();
      off.session.dispose();
    } finally {
      vibrate.mockRestore();
    }
  });
});
