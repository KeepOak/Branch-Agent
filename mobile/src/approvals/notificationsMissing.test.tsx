import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { approvalsAt } from '../testing/approvalFixtures';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState } from '../testing/fakeNotifier';
import { expoNotificationsMock } from '../testing/expoNotificationsMock';
import { createFakeSession } from '../testing/fakeSession';
import { createExpoNotifier, loadNotifications, noNotifier } from './expoNotifier';

// Expo Go on Android: expo-notifications' native side is gone, and requiring it gives nothing usable.
jest.mock('expo-notifications', () => undefined);

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });

describe('when the phone has no expo-notifications', () => {
  it('finds nothing usable in Expo Go on Android, a module that throws, or one missing a function', () => {
    const full = expoNotificationsMock();
    expect(loadNotifications('android', 'storeClient', () => full)).toBeNull();
    expect(loadNotifications('android', 'bare', () => full)).toBe(full);
    expect(loadNotifications('ios', 'storeClient', () => full)).toBe(full);
    expect(
      loadNotifications('android', 'bare', () => {
        throw new Error('Cannot find native module');
      }),
    ).toBeNull();
    expect(loadNotifications('android', 'bare', () => undefined)).toBeNull();
    const { addNotificationResponseReceivedListener: _gone, ...partial } = full;
    expect(loadNotifications('ios', 'bare', () => partial)).toBeNull();
    const { setNotificationChannelAsync: _noChannel, ...noChannel } = full;
    expect(loadNotifications('android', 'bare', () => noChannel)).toBeNull();
    expect(loadNotifications('ios', 'bare', () => noChannel)).toBe(noChannel);
    expect(createExpoNotifier(() => null)).toBe(noNotifier);
  });

  it('the app still opens, says notifications need the installed app, and Allow still answers on the computer', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, approvals: approvalsAt(Date.now()) });
    const { session } = createFakeSession(engine);
    // No notifier given: the app makes its own from the (missing) module, as on a phone.
    await render(<App scheme="light" session={session} appState={createFakeAppState('background').source} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    engine.approve();
    await eventually(() => expect(screen.getByTestId('needs-you-banner')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('needs-you-banner'));
    await eventually(() => expect(screen.getByTestId('notifications-unavailable')).toHaveTextContent('Notifications need the installed Branch app. Approvals still show up here.'));
    expect(screen.queryByTestId('notifications-card')).toBeNull();
    await fireEvent.press(screen.getByTestId('allow-exec-1'));
    await eventually(() => expect(within(screen.getByTestId('answered-exec-1')).getByText('Allowed on this phone')).toBeOnTheScreen());
    expect(engine.requests).toContainEqual({ method: 'exec.approval.resolve', params: { id: 'exec-1', decision: 'allow-once' } });
    session.dispose();
  });
});
