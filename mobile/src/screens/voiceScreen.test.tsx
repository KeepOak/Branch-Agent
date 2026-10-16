import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { readApproval, type Approval } from '../approvals/approvals';
import { chatRows, readAgents } from '../chats/chatList';
import { createFakeEngine } from '../connect/fakeEngine';
import { approvalsAt } from '../testing/approvalFixtures';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { later, type Level } from '../voice/level';
import { MUTED, NOT_CONNECTED, OFFLINE_VOICE } from '../voice/voiceCall';
import { VoiceScreen } from './VoiceScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

const KEY = 'agent:main:main';
const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);
const mainRow = rows.find((r) => r.key === KEY)!;
const pluginAt = () => readApproval(approvalsAt(Date.now()).plugin[0], 'plugin')!;

async function pairedLink() {
  const engine = createFakeEngine();
  const { session } = createFakeSession(engine);
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  return { engine, session };
}

async function renderVoice(opts: { online?: boolean; pending?: Approval[]; level?: Level } = {}) {
  const { engine, session } = await pairedLink();
  const onClose = jest.fn();
  const onEnd = jest.fn();
  const onKeyboard = jest.fn();
  const onAnswer = jest.fn();
  const view = await render(
    <ThemeProvider scheme="dark">
      <VoiceScreen
        row={mainRow}
        online={opts.online ?? true}
        link={session}
        pending={opts.pending ?? []}
        level={opts.level}
        onAnswer={onAnswer}
        onClose={onClose}
        onEnd={onEnd}
        onKeyboard={onKeyboard}
      />
    </ThemeProvider>,
  );
  const finish = async () => {
    await view.unmount();
    session.dispose();
  };
  return { engine, session, onClose, onEnd, onKeyboard, onAnswer, unmount: view.unmount, finish };
}

describe('voice screen', () => {
  it('draws the Android Voice layout: title, on this phone, mute, speaker, end and keyboard', async () => {
    const { finish } = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    expect(screen.getByTestId('voice-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('voice-title')).toHaveTextContent('Branch Agent · voice');
    expect(screen.getByTestId('voice-on-phone')).toHaveTextContent('On this phone');
    expect(screen.getByLabelText('Close')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Voice')).toBeNull();
    expect(screen.getByLabelText('Mute')).toBeOnTheScreen();
    expect(screen.getByLabelText('Speaker')).toBeOnTheScreen();
    expect(screen.getByLabelText('End')).toBeOnTheScreen();
    expect(screen.getByLabelText('Keyboard')).toBeOnTheScreen();
    expect(screen.queryByTestId('voice-transcript')).toBeNull();
    await finish();
  });

  it('mutes to Muted, turns the speaker off, and keeps the Voice menu off at Regular', async () => {
    const { finish } = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    await fireEvent.press(screen.getByTestId('voice-mute'));
    expect(screen.getByLabelText('Unmute')).toBeOnTheScreen();
    expect(screen.getByTestId('voice-state')).toHaveTextContent(MUTED);
    await fireEvent.press(screen.getByTestId('voice-speaker'));
    expect(screen.getByLabelText('Turn the speaker on')).toBeOnTheScreen();
    expect(screen.queryByTestId('voice-more')).toBeNull();
    expect(screen.queryByTestId('voice-menu')).toBeNull();
    await finish();
  });

  it('shows Voice as a later update at Advanced, not a working picker', async () => {
    const { finish } = await renderVoice({ level: 'advanced' });
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    expect(screen.getByLabelText('Voice')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('voice-more'));
    expect(screen.getByTestId('voice-menu')).toBeOnTheScreen();
    expect(screen.getByTestId('voice-later')).toHaveTextContent(later('Voice'));
    expect(screen.queryByTestId('voice-choice-Oak')).toBeNull();
    expect(screen.queryByTestId('voice-choice-Birch')).toBeNull();
    await finish();
  });

  it('Close, End and Keyboard each leave through their own callback', async () => {
    const first = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    await fireEvent.press(screen.getByTestId('voice-close'));
    expect(first.onClose).toHaveBeenCalled();
    expect(first.onEnd).not.toHaveBeenCalled();
    await first.finish();

    const second = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    await fireEvent.press(screen.getByTestId('voice-end'));
    expect(second.onEnd).toHaveBeenCalled();
    expect(second.onClose).not.toHaveBeenCalled();
    await second.finish();

    const third = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    await fireEvent.press(screen.getByTestId('voice-keyboard'));
    expect(third.onKeyboard).toHaveBeenCalled();
    await third.finish();
  });

  it('says Not connected when the computer is off, with only Close, and no later-update note at Regular', async () => {
    const { finish } = await renderVoice({ online: false });
    expect(screen.getByTestId('voice-state')).toHaveTextContent(NOT_CONNECTED);
    expect(screen.queryByTestId('voice-note')).toBeNull();
    expect(screen.queryByText(OFFLINE_VOICE)).toBeNull();
    expect(screen.queryByLabelText('Mute')).toBeNull();
    expect(screen.queryByLabelText('Speaker')).toBeNull();
    expect(screen.queryByLabelText('Keyboard')).toBeNull();
    expect(screen.queryByLabelText('Voice')).toBeNull();
    expect(screen.getByTestId('voice-end')).toBeOnTheScreen();
    await finish();
  });

  it('adds the longer offline note at Advanced', async () => {
    const { finish } = await renderVoice({ online: false, level: 'advanced' });
    expect(screen.getByTestId('voice-state')).toHaveTextContent(NOT_CONNECTED);
    expect(screen.getByTestId('voice-note')).toHaveTextContent(OFFLINE_VOICE);
    await finish();
  });

  it('keeps the state word apart from the transcript, and maps Thinking and Speaking', async () => {
    const { engine, finish } = await renderVoice();
    await eventually(() => expect(engine.requests.some((r) => r.method === 'talk.session.create')).toBe(true));
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    await act(async () => {
      engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'toolCall', name: 'branch_agent_consult' });
    });
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Thinking'));
    await act(async () => {
      engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'transcript', role: 'user', text: 'Is the invoice right?' });
    });
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    expect(screen.getByTestId('voice-transcript')).toHaveTextContent('Is the invoice right?');
    await act(async () => {
      engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'transcript', role: 'assistant', text: 'It looks like the late fee.' });
    });
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Speaking'));
    expect(screen.getByText('Is the invoice right?')).toBeOnTheScreen();
    expect(screen.getByText('It looks like the late fee.')).toBeOnTheScreen();
    await finish();
  });

  it('shows this conversation’s approval as a say-it chip and answers on a tap', async () => {
    const { finish, onAnswer } = await renderVoice({ pending: [pluginAt()] });
    const ask = screen.getByTestId('voice-ask');
    expect(ask).toHaveTextContent('Say “send it” to answer Branch Agent');
    await fireEvent.press(ask);
    expect(onAnswer).toHaveBeenCalledWith('plugin:mail-1', 'allow-once');
    await finish();
  });

  it('answers that approval when the person says a whole yes in the call', async () => {
    const { engine, finish, onAnswer } = await renderVoice({ pending: [pluginAt()] });
    await eventually(() => expect(engine.requests.some((r) => r.method === 'talk.session.create')).toBe(true));
    await act(async () => {
      engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'transcript', role: 'user', text: 'send it' });
    });
    await eventually(() => expect(onAnswer).toHaveBeenCalledWith('plugin:mail-1', 'allow-once'));
    await finish();
  });

  it('opens from Chat through Talk and goes back through Keyboard, leaving Send in place', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
    const { session } = createFakeSession(engine);
    const view = await render(<App scheme="light" session={session} />);
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    engine.approve();
    await eventually(() => expect(screen.getByTestId('chat-' + KEY)).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('chat-' + KEY));
    expect(screen.getByTestId('chat-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('send')).toBeOnTheScreen();
    expect(screen.getByTestId('chat-talk')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('chat-talk'));
    expect(screen.getByTestId('voice-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('voice-title')).toHaveTextContent('Branch Agent · voice');
    await eventually(() => expect(screen.getByTestId('voice-state')).toHaveTextContent('Listening'));
    expect(screen.queryByLabelText('Voice')).toBeNull();
    await fireEvent.press(screen.getByTestId('voice-keyboard'));
    expect(screen.getByTestId('chat-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('send')).toBeOnTheScreen();
    expect(screen.getByTestId('chat-talk')).toBeOnTheScreen();
    await view.unmount();
    session.dispose();
  });
});
