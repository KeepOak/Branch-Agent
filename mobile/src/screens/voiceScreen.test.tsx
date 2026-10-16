import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { readApproval, type Approval } from '../approvals/approvals';
import { chatRows, readAgents } from '../chats/chatList';
import { createFakeEngine } from '../connect/fakeEngine';
import { approvalsAt } from '../testing/approvalFixtures';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { OFFLINE_VOICE } from '../voice/voiceCall';
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

async function renderVoice(opts: { online?: boolean; pending?: Approval[] } = {}) {
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
        onAnswer={onAnswer}
        onClose={onClose}
        onEnd={onEnd}
        onKeyboard={onKeyboard}
      />
    </ThemeProvider>,
  );
  return { engine, session, onClose, onEnd, onKeyboard, onAnswer, unmount: view.unmount };
}

describe('voice screen', () => {
  it('draws the Android Voice layout: title, on this phone, mute, speaker, end and keyboard', async () => {
    const { session } = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-caption')).toHaveTextContent('Listening…'));
    expect(screen.getByTestId('voice-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('voice-title')).toHaveTextContent('Branch Agent · voice');
    expect(screen.getByTestId('voice-on-phone')).toHaveTextContent('On this phone');
    expect(screen.getByLabelText('Close')).toBeOnTheScreen();
    expect(screen.getByLabelText('Voice')).toBeOnTheScreen();
    expect(screen.getByLabelText('Mute')).toBeOnTheScreen();
    expect(screen.getByLabelText('Speaker')).toBeOnTheScreen();
    expect(screen.getByLabelText('End')).toBeOnTheScreen();
    expect(screen.getByLabelText('Keyboard')).toBeOnTheScreen();
    session.dispose();
  });

  it('mutes, turns the speaker off, and picks Oak or Birch from Voice', async () => {
    const { session } = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-caption')).toHaveTextContent('Listening…'));
    await fireEvent.press(screen.getByTestId('voice-mute'));
    expect(screen.getByLabelText('Unmute')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('voice-speaker'));
    expect(screen.getByLabelText('Turn the speaker on')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('voice-more'));
    expect(screen.getByTestId('voice-menu')).toBeOnTheScreen();
    expect(screen.getByText('Changing it changes the voice everywhere.')).toBeOnTheScreen();
    expect(screen.getByTestId('voice-choice-Oak')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('voice-choice-Birch'));
    expect(screen.queryByTestId('voice-menu')).toBeNull();
    session.dispose();
  });

  it('Close, End and Keyboard each leave through their own callback', async () => {
    const first = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-caption')).toHaveTextContent('Listening…'));
    await fireEvent.press(screen.getByTestId('voice-close'));
    expect(first.onClose).toHaveBeenCalled();
    expect(first.onEnd).not.toHaveBeenCalled();
    first.unmount();
    first.session.dispose();

    const second = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-caption')).toHaveTextContent('Listening…'));
    await fireEvent.press(screen.getByTestId('voice-end'));
    expect(second.onEnd).toHaveBeenCalled();
    expect(second.onClose).not.toHaveBeenCalled();
    second.unmount();
    second.session.dispose();

    const third = await renderVoice();
    await eventually(() => expect(screen.getByTestId('voice-caption')).toHaveTextContent('Listening…'));
    await fireEvent.press(screen.getByTestId('voice-keyboard'));
    expect(third.onKeyboard).toHaveBeenCalled();
    third.unmount();
    third.session.dispose();
  });

  it('says no voice service is reachable when the computer is off, with only Close', async () => {
    const { session } = await renderVoice({ online: false });
    expect(screen.getByTestId('voice-caption')).toHaveTextContent(OFFLINE_VOICE);
    expect(screen.queryByLabelText('Mute')).toBeNull();
    expect(screen.queryByLabelText('Speaker')).toBeNull();
    expect(screen.queryByLabelText('Keyboard')).toBeNull();
    expect(screen.queryByLabelText('Voice')).toBeNull();
    expect(screen.getByTestId('voice-end')).toBeOnTheScreen();
    session.dispose();
  });

  it('shows this conversation’s approval as a say-it chip and answers on a tap', async () => {
    const { session, onAnswer } = await renderVoice({ pending: [pluginAt()] });
    const ask = screen.getByTestId('voice-ask');
    expect(ask).toHaveTextContent('Say “send it” to answer Branch Agent');
    await fireEvent.press(ask);
    expect(onAnswer).toHaveBeenCalledWith('plugin:mail-1', 'allow-once');
    session.dispose();
  });

  it('answers that approval when the person says a whole yes in the call', async () => {
    const { engine, session, onAnswer } = await renderVoice({ pending: [pluginAt()] });
    await eventually(() => expect(engine.requests.some((r) => r.method === 'talk.session.create')).toBe(true));
    await act(async () => {
      engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'transcript', role: 'user', text: 'send it' });
    });
    await eventually(() => expect(onAnswer).toHaveBeenCalledWith('plugin:mail-1', 'allow-once'));
    session.dispose();
  });

  it('opens from Chat through Talk and goes back through Keyboard, leaving Send in place', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
    const { session } = createFakeSession(engine);
    await render(<App scheme="light" session={session} />);
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
    await eventually(() => expect(screen.getByTestId('voice-caption')).toHaveTextContent('Listening…'));
    await fireEvent.press(screen.getByTestId('voice-keyboard'));
    expect(screen.getByTestId('chat-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('send')).toBeOnTheScreen();
    expect(screen.getByTestId('chat-talk')).toBeOnTheScreen();
    session.dispose();
  });
});
