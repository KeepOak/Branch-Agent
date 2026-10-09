import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { DeviceEventEmitter, StyleSheet } from 'react-native';
import App from '../../App';
import { bytesToBase64Url, utf8ToBytes } from '../connect/base64url';
import { PAIRING_RECORD_KEY } from '../pairing/pairingSession';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ApprovalScreen, timeLeft } from './ApprovalScreen';
import { EnterCodeScreen } from './EnterCodeScreen';

// The test runner has no camera: the scanner reports that permission hasn't been given yet.
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: true, status: 'undetermined' }, jest.fn()],
}));

const code = (value: unknown) => bytesToBase64Url(utf8ToBytes(JSON.stringify(value)));

const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });

describe('pairing screens', () => {
  it('walks from welcome through approval to paired, and back out with unpair', async () => {
    const { session, engine } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    expect(screen.getAllByRole('button').map((b) => b.props.testID)).toEqual(['pair-button']);

    await fireEvent.press(screen.getByTestId('pair-button'));
    expect(screen.getByTestId('camera-permission')).toBeOnTheScreen();
    expect(screen.getByText('Allow camera')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('enter-code'));
    expect(screen.getByTestId('enter-code-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('submit-code')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('code-input'), 'not a code');
    await fireEvent.press(screen.getByTestId('submit-code'));
    expect(screen.getByTestId('code-problem')).toHaveTextContent(/isn’t a Branch pairing code/);

    await fireEvent.changeText(screen.getByTestId('code-input'), code({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    await fireEvent.press(screen.getByTestId('submit-code'));
    await eventually(() => expect(screen.getByTestId('pairing-approval')).toBeOnTheScreen());
    expect(screen.getByText('Allow on your computer')).toBeOnTheScreen();

    engine.approve();
    await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('computer-button'));
    expect(screen.getByText('Connected to your computer')).toBeOnTheScreen();
    expect(screen.getByText('computer.local:19031')).toBeOnTheScreen();
    expect(screen.getByText('2026.10.8')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('unpair'));
    await fireEvent.press(screen.getByTestId('confirm-unpair'));
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
  });

  it('keeps Pair above the keyboard, pairs from the keyboard’s done key, and calls a mangled code damaged', async () => {
    const onCode = jest.fn();
    await render(
      <ThemeProvider scheme="light">
        <EnterCodeScreen onCode={onCode} onScan={jest.fn()} onCancel={jest.fn()} />
      </ThemeProvider>,
    );
    // When the keyboard comes up over the bottom 300 points, the screen pads itself by that much, so Pair
    // (inside it, at the bottom) sits above the keyboard.
    const root = screen.getByTestId('enter-code-screen');
    expect(within(root).getByTestId('submit-code')).toBeOnTheScreen();
    const paddingBottom = () => StyleSheet.flatten(screen.getByTestId('enter-code-screen').props.style).paddingBottom ?? 0;
    expect(paddingBottom()).toBe(0);
    await fireEvent(root, 'layout', { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } });
    await act(() => {
      DeviceEventEmitter.emit('keyboardWillShow', { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 552, width: 393, height: 300 } });
    });
    await eventually(() => expect(paddingBottom()).toBe(300));

    const good = code({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    await fireEvent.changeText(screen.getByTestId('code-input'), `${good.slice(0, 25)}q${good.slice(25)}`);
    await fireEvent(screen.getByTestId('code-input'), 'submitEditing');
    expect(screen.getByTestId('code-problem')).toHaveTextContent('This code looks damaged. Copy it again from Branch on your computer.');
    expect(onCode).not.toHaveBeenCalled();

    // A copy broken across lines, with a trailing newline, still pairs.
    await fireEvent.changeText(screen.getByTestId('code-input'), `${good.slice(0, 25)}\n${good.slice(25)}\n`);
    await fireEvent(screen.getByTestId('code-input'), 'submitEditing');
    expect(onCode).toHaveBeenCalledWith({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  });

  it('shows the computer’s check code and the time left on the code while waiting for Allow', async () => {
    const { session } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1', expiresAtMs: Date.now() + 4 * 60_000 + 30_000 }));
    await eventually(() => expect(screen.getByTestId('pairing-approval')).toBeOnTheScreen());
    // The fake engine's request is "request-1"; the window shows pairingCheckCode of it: EST1.
    expect(screen.getByTestId('check-code-value')).toHaveTextContent('EST1');
    expect(screen.getByText('Your computer shows the same code. Choose Allow only if they match.')).toBeOnTheScreen();
    expect(screen.getByTestId('time-left')).toHaveTextContent(/^The code works for another 4:(30|29)\.$/);
    await fireEvent.press(screen.getByText('Cancel'));
  });

  it('counts the time left down each second, and says when the code has run out', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      await render(
        <ThemeProvider scheme="dark">
          <ApprovalScreen state={{ step: 'approval', url: 'ws://computer.local:19031', requestId: 'f00d-c0de', expiresAtMs: 1_000_000 + 65_000 }} onCancel={jest.fn()} onScanAgain={jest.fn()} />
        </ThemeProvider>,
      );
      expect(screen.getByTestId('time-left')).toHaveTextContent('The code works for another 1:05.');
      expect(screen.getByTestId('check-code-value')).toHaveTextContent('C0DE');
      await act(() => jest.advanceTimersByTime(6_000));
      expect(screen.getByTestId('time-left')).toHaveTextContent('The code works for another 0:59.');
      await act(() => jest.advanceTimersByTime(60_000));
      expect(screen.getByTestId('time-left')).toHaveTextContent('The code has run out. Make a new one on your computer.');
    } finally {
      jest.useRealTimers();
    }
    expect([timeLeft(0), timeLeft(-5), timeLeft(1), timeLeft(600_000)]).toEqual(['0:00', '0:00', '0:01', '10:00']);
  });

  it('after Deny on the computer, says so and offers only a new code', async () => {
    const { session, engine } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1', expiresAtMs: Date.now() + 300_000 }));
    await eventually(() => expect(screen.getByTestId('pairing-approval')).toBeOnTheScreen());
    engine.reject();
    await eventually(() => expect(screen.getByTestId('pairing-failed')).toBeOnTheScreen());
    expect(screen.getByText('Your computer said no.')).toBeOnTheScreen();
    expect(screen.queryByText(/ask again/i)).toBeNull();
    expect(screen.queryByTestId('ask-again')).toBeNull();
    await fireEvent.press(screen.getByText('Scan a new code'));
    expect(screen.getByTestId('camera-permission')).toBeOnTheScreen();
  });

  it('turns away a typed code whose address carries a user name or password, and never shows them', async () => {
    const { session, engine } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('pair-button'));
    await fireEvent.press(screen.getByTestId('enter-code'));
    await fireEvent.changeText(screen.getByTestId('code-input'), code({ url: 'ws://user:secret@computer.local:19031', bootstrapToken: 'boot-1' }));
    await fireEvent.press(screen.getByTestId('submit-code'));
    expect(screen.getByTestId('code-problem')).toHaveTextContent(/isn’t a Branch pairing code/);
    expect(screen.queryByText(/secret/)).toBeNull();
    expect(screen.queryByTestId('pairing-connecting')).toBeNull();
    expect(engine.urls).toEqual([]);
  });

  it('a saved computer that stops accepting this phone says so and pairs again, not “reconnecting”', async () => {
    const first = createFakeSession();
    first.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    first.engine.approve();
    await eventually(() => expect(first.session.getState()).toMatchObject({ step: 'paired', online: true }));
    first.session.dispose();
    first.engine.revoke();

    const { session, store } = createFakeSession(first.engine, first.store);
    await render(<App scheme="dark" session={session} />);
    await eventually(() => expect(screen.getByTestId('pairing-refused')).toBeOnTheScreen());
    expect(screen.getByTestId('refused-message')).toHaveTextContent(/no longer recognises this phone/);
    expect(screen.getByText('Computer: computer.local:19031')).toBeOnTheScreen();
    expect(screen.queryByText('Reconnecting to your computer…')).toBeNull();
    expect(screen.queryByText(/keeps trying/)).toBeNull();
    expect(screen.queryByText(/unauthorized|token/i)).toBeNull();
    expect(screen.queryByTestId('retry')).toBeNull();

    await fireEvent.press(screen.getByTestId('pair-again'));
    await eventually(() => expect(screen.getByTestId('camera-permission')).toBeOnTheScreen());
    expect(store.dump()[PAIRING_RECORD_KEY]).toBeUndefined();
    expect(Object.keys(store.dump()).some((key) => key.startsWith('branch.device-token.v1.'))).toBe(false);
  });

  it('cancelling while the computer decides goes back to the welcome', async () => {
    const { session } = createFakeSession();
    await render(<App scheme="dark" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    await eventually(() => expect(screen.getByTestId('pairing-approval')).toBeOnTheScreen());
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen();
  });

  it('shows why pairing stopped and offers a fresh scan', async () => {
    const { session } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'old-code' }));
    await eventually(() => expect(screen.getByTestId('pairing-failed')).toBeOnTheScreen());
    expect(screen.getByText('This code no longer works. Make a new one on your computer.')).toBeOnTheScreen();
    expect(screen.queryByTestId('ask-again')).toBeNull();
    await fireEvent.press(screen.getByText('Scan a new code'));
    expect(screen.getByTestId('camera-permission')).toBeOnTheScreen();
  });
});
