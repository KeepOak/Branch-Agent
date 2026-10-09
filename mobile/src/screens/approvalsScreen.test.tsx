import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { readApproval, type Answered, type ApprovalsSnapshot } from '../approvals/approvals';
import { readAgents } from '../chats/chatList';
import { createFakeEngine } from '../connect/fakeEngine';
import { approvalsAt, fixtureApprovals } from '../testing/approvalFixtures';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ApprovalsScreen } from './ApprovalsScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
const MINUTE = 60_000;
const exec = readApproval(fixtureApprovals.exec[0], 'exec')!;
const plugin = readApproval(fixtureApprovals.plugin[0], 'plugin')!;
const trunks = Object.fromEntries(readAgents(fixtureAgents).agents);
const base: ApprovalsSnapshot = { pending: [exec, plugin], answered: [], trunks, loaded: true, error: null, sending: {}, failed: {} };

async function renderScreen(snapshot: Partial<ApprovalsSnapshot> = {}, extra: Partial<Parameters<typeof ApprovalsScreen>[0]> = {}) {
  const mocks = { onTurnOnNotifications: jest.fn(), onOpenSettings: jest.fn(), onAnswer: jest.fn(), onRetry: jest.fn(), onBack: jest.fn() };
  await render(
    <ThemeProvider scheme="light">
      <ApprovalsScreen snapshot={{ ...base, ...snapshot }} online permission="granted" now={FIXTURE_NOW} {...mocks} {...extra} />
    </ThemeProvider>,
  );
  return { props: mocks };
}

describe('needs you screen', () => {
  it('shows each request in plain words: who, what, where, what was noticed and how long is left', async () => {
    await renderScreen();
    expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
    const card = within(screen.getByTestId('approval-exec-1'));
    expect(card.getByText('Oak')).toBeOnTheScreen();
    expect(card.getByText('Run a command')).toBeOnTheScreen();
    expect(card.getByText('pnpm install --frozen-lockfile')).toBeOnTheScreen();
    expect(card.getByText('This computer')).toBeOnTheScreen();
    expect(card.getByText('~/Code/branch/window')).toBeOnTheScreen();
    expect(card.getByText('Noticed: Downloads packages from the internet')).toBeOnTheScreen();
    expect(card.getByText('Expires in 27 min')).toBeOnTheScreen();
    expect(card.getByText('Allow')).toBeOnTheScreen();
    expect(card.getByText('Deny')).toBeOnTheScreen();
    const mail = within(screen.getByTestId('approval-plugin:mail-1'));
    expect(mail.getByText('Branch Agent')).toBeOnTheScreen();
    expect(mail.getByText('Send an email to Dana?')).toBeOnTheScreen();
    expect(mail.getByText('Dana Whitfield')).toBeOnTheScreen();
    expect(mail.getByText('Expires in 4:12')).toBeOnTheScreen();
    expect(mail.getByText('Send it')).toBeOnTheScreen();
    expect(mail.getByText('Don’t send')).toBeOnTheScreen();
    // Always allow only where the engine offers it.
    expect(screen.getByTestId('always-ask-exec-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('always-ask-plugin:mail-1')).toBeNull();
  });

  it('answers with Allow, Deny, and Always allow only after saying what it covers', async () => {
    const { props } = await renderScreen();
    await fireEvent.press(screen.getByTestId('allow-exec-1'));
    await fireEvent.press(screen.getByTestId('deny-plugin:mail-1'));
    expect(props.onAnswer.mock.calls).toEqual([['exec-1', 'allow-once'], ['plugin:mail-1', 'deny']]);
    await fireEvent.press(screen.getByTestId('always-ask-exec-1'));
    expect(screen.getByText('Oak may run this exact command again without asking, until you take it back on your computer.')).toBeOnTheScreen();
    expect(screen.queryByTestId('allow-exec-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('always-exec-1'));
    expect(props.onAnswer).toHaveBeenLastCalledWith('exec-1', 'allow-always');
  });

  it('holds the buttons while an answer is on its way, and says why one failed', async () => {
    await renderScreen({ sending: { 'exec-1': 'allow-once' }, failed: { 'plugin:mail-1': 'Your computer isn’t connected right now. Try again when it’s back.' } });
    expect(screen.getByTestId('deny-exec-1')).toBeDisabled();
    expect(screen.getByTestId('allow-exec-1')).toBeDisabled();
    expect(screen.getByTestId('failed-plugin:mail-1')).toHaveTextContent('Your computer isn’t connected right now. Try again when it’s back.');
    expect(screen.getByTestId('allow-plugin:mail-1')).toBeEnabled();
  });

  it('a request that ran out of time can’t be allowed any more', async () => {
    await renderScreen({}, { now: FIXTURE_NOW + 5 * MINUTE });
    expect(screen.getByTestId('expired-plugin:mail-1')).toHaveTextContent('This request ran out of time, so nothing ran. Branch Agent can ask again.');
    expect(screen.queryByTestId('allow-plugin:mail-1')).toBeNull();
    expect(screen.getByTestId('allow-exec-1')).toBeOnTheScreen();
    expect(screen.getByTestId('approvals-count')).toHaveTextContent('1');
  });

  it('warns when a command mixes alphabets that look alike', async () => {
    const tricky = readApproval({ id: 'exec-9', request: { command: 'curl https://p\u0430ypal.com/login', agentId: 'oak' } }, 'exec')!;
    await renderScreen({ pending: [tricky] });
    expect(screen.getByTestId('mixed-exec-9')).toBeOnTheScreen();
  });

  it('says when nothing is waiting, while it checks, and why it couldn’t', async () => {
    await renderScreen({ pending: [] });
    expect(screen.getByTestId('approvals-empty')).toHaveTextContent(/Nothing is waiting for you.*Trunks show up here when they need a yes\./);
    expect(screen.queryByTestId('approvals-count')).toBeNull();
    await renderScreen({ pending: [], loaded: false });
    expect(screen.getByTestId('approvals-loading')).toBeOnTheScreen();
    const failed = await renderScreen({ pending: [], loaded: false, error: 'Your computer is busy right now. Try again in a moment.' });
    expect(screen.getByTestId('approvals-error')).toHaveTextContent(/Couldn’t check for approvals.*Your computer is busy right now\. Try again in a moment\./);
    await fireEvent.press(screen.getByTestId('approvals-error-action'));
    expect(failed.props.onRetry).toHaveBeenCalledTimes(1);
    await renderScreen({ pending: [], loaded: false, error: 'not connected' }, { online: false });
    expect(screen.getByTestId('approvals-waiting')).toBeOnTheScreen();
    // It promises only what answer() does: wait RECONNECT_WAIT_MS (15 s) for the computer, then give up.
    expect(screen.getByTestId('approvals-offline')).toHaveTextContent('Reconnecting to your computer… An answer sent now waits up to 15 seconds for it, then asks you to try again.');
  });

  it('asks for notifications in context, and leads to Settings when they are off', async () => {
    const first = await renderScreen({}, { permission: 'undetermined' });
    await fireEvent.press(screen.getByTestId('notifications-turn-on'));
    expect(first.props.onTurnOnNotifications).toHaveBeenCalledTimes(1);
    const off = await renderScreen({}, { permission: 'denied' });
    expect(screen.getByText('Notifications are off for Branch')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('notifications-settings'));
    expect(off.props.onOpenSettings).toHaveBeenCalledTimes(1);
    await renderScreen({}, { permission: 'granted' });
    expect(screen.queryByTestId('notifications-card')).toBeNull();
  });

  it('lists what was answered lately, and where', async () => {
    const answered: Answered[] = [
      { ...exec, outcome: 'allowed', always: false, by: 'phone', at: FIXTURE_NOW },
      { ...plugin, outcome: 'allowed', always: false, by: 'elsewhere', at: FIXTURE_NOW },
    ];
    await renderScreen({ pending: [], answered });
    expect(within(screen.getByTestId('answered-exec-1')).getByText('Allowed on this phone')).toBeOnTheScreen();
    expect(within(screen.getByTestId('answered-plugin:mail-1')).getByText('Sent somewhere else')).toBeOnTheScreen();
  });

  it('puts the approval a notification was tapped for first', async () => {
    await renderScreen({}, { focusId: 'plugin:mail-1' });
    const ids = screen.getAllByTestId(/^approval-/).map((n) => n.props.testID);
    expect(ids[0]).toBe('approval-plugin:mail-1');
  });
});

describe('approvals in the app', () => {
  async function pairedApp() {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, approvals: approvalsAt(Date.now()) });
    const { session } = createFakeSession(engine);
    const fake = createFakeNotifier('undetermined');
    const appState = createFakeAppState('active');
    await render(<App scheme="dark" session={session} notifier={fake.notifier} appState={appState.source} />);
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    engine.approve();
    await eventually(() => expect(screen.getByTestId('needs-you-banner')).toBeOnTheScreen());
    return { session, engine, fake, appState };
  }

  it('Chats shows what needs a yes; Allow there answers it on the computer', async () => {
    const { session, engine } = await pairedApp();
    expect(screen.getByTestId('needs-you-banner')).toHaveProp('accessibilityLabel', '2 approvals need your yes. Oak · Run a command and 1 more');
    await fireEvent.press(screen.getByTestId('needs-you-banner'));
    expect(screen.getByText('Needs you')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('allow-exec-1'));
    await eventually(() => expect(within(screen.getByTestId('answered-exec-1')).getByText('Allowed on this phone')).toBeOnTheScreen());
    expect(engine.requests).toContainEqual({ method: 'exec.approval.resolve', params: { id: 'exec-1', decision: 'allow-once' } });

    // The computer answers the other one: it moves to Answered here too.
    engine.resolveApproval('plugin:mail-1', 'deny');
    await eventually(() => expect(within(screen.getByTestId('answered-plugin:mail-1')).getByText('Not sent somewhere else')).toBeOnTheScreen());
    expect(screen.getByTestId('approvals-empty')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('approvals-back'));
    expect(screen.queryByTestId('needs-you-banner')).toBeNull();
    session.dispose();
  });

  it('asks for notifications from the Needs you screen, and opens the chat behind a request', async () => {
    const { session, fake } = await pairedApp();
    await fireEvent.press(screen.getByTestId('needs-you-banner'));
    await eventually(() => expect(screen.getByTestId('notifications-turn-on')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('notifications-turn-on'));
    await eventually(() => expect(screen.queryByTestId('notifications-card')).toBeNull());
    fake.setPermission('granted');
    // The mail request's chat (agent:main:main) is on the computer; this one opens it.
    await fireEvent.press(screen.getByTestId('open-chat-plugin:mail-1'));
    await eventually(() => expect(screen.getByTestId('chat-screen')).toBeOnTheScreen());
    session.dispose();
  });

  it('says in plain words when the computer won’t list its approvals, and Try again reads it again', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, approvals: approvalsAt(Date.now()) });
    engine.failMethod('exec.approval.list', 'missing scope: operator.approvals', { code: 'MISSING_SCOPE', missingScope: 'operator.approvals' }, 'FORBIDDEN');
    const { session } = createFakeSession(engine);
    const fake = createFakeNotifier('granted');
    const appState = createFakeAppState('active');
    await render(<App scheme="dark" session={session} notifier={fake.notifier} appState={appState.source} />);
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    engine.approve();
    await eventually(() => expect(session.hello).not.toBeNull());
    await act(async () => fake.respond({ approvalId: 'exec-1', action: 'open' }));
    await eventually(() => expect(screen.getByTestId('approvals-error')).toBeOnTheScreen());
    expect(screen.getByTestId('approvals-error')).toHaveTextContent(/This phone isn’t allowed to see approvals any more\. Pair it again from Branch on your computer\./);
    expect(screen.getByTestId('approvals-error')).not.toHaveTextContent(/missing scope|operator\.approvals/);
    engine.failMethod('exec.approval.list', null);
    await fireEvent.press(screen.getByTestId('approvals-error-action'));
    await eventually(() => expect(screen.getByTestId('approval-exec-1')).toBeOnTheScreen());
    session.dispose();
  });

  it('a tap on a notification opens Needs you at that approval', async () => {
    const { session, fake } = await pairedApp();
    await act(async () => fake.respond({ approvalId: 'plugin:mail-1', action: 'open' }));
    await eventually(() => expect(screen.getByTestId('approvals-screen')).toBeOnTheScreen());
    expect(screen.getAllByTestId(/^approval-/)[0]).toHaveProp('testID', 'approval-plugin:mail-1');
    session.dispose();
  });
});
