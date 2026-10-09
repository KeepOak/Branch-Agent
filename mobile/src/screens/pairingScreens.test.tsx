import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { bytesToBase64Url, utf8ToBytes } from '../connect/base64url';
import { PAIRING_RECORD_KEY } from '../pairing/pairingSession';
import { createFakeSession } from '../testing/fakeSession';

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
    await eventually(() => expect(screen.getByText('Connected to your computer')).toBeOnTheScreen());
    expect(screen.getByText('computer.local:19031')).toBeOnTheScreen();
    expect(screen.getByText('2026.10.8')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('unpair'));
    await fireEvent.press(screen.getByTestId('confirm-unpair'));
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
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
    const { session, engine } = createFakeSession();
    engine.reject();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    await eventually(() => expect(screen.getByTestId('pairing-failed')).toBeOnTheScreen());
    expect(screen.getByText(/turned this phone away/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Scan a new code'));
    expect(screen.getByTestId('camera-permission')).toBeOnTheScreen();
  });
});
