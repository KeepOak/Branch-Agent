import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import App from '../../App';
import { bytesToBase64Url, utf8ToBytes } from '../connect/base64url';
import { createFakeSession } from '../testing/fakeSession';
import { PairingTheme, ThemeProvider } from '../theme/ThemeProvider';
import { pairingTheme, themeFor } from '../theme/tokens';
import { contrastRatio } from '../theme/contrast';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { KEEPOAK_SIGN_IN_LATER, WelcomeScreen } from './WelcomeScreen';

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: true, status: 'undetermined' }, jest.fn()],
}));

const code = (value: unknown) => bytesToBase64Url(utf8ToBytes(JSON.stringify(value)));
const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });
jest.setTimeout(20_000);

describe('pairing chrome', () => {
  it('paints pairing with ink, not indigo, in both modes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const base = themeFor(scheme);
      const pairing = pairingTheme(base);
      expect(pairing.color.accent).toBe(base.color.ink);
      expect(pairing.color.accentInk).toBe(base.color.ink);
      expect(pairing.color.accent).not.toBe(base.color.accent);
      expect(contrastRatio(pairing.color.onAccent, pairing.color.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(pairing.color.ink, pairing.color.grouped)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('hides scrollbars on pairing screens while still scrolling', async () => {
    await render(
      <ThemeProvider scheme="light">
        <Screen testID="hidden-scroll">
          <Button title="Go" onPress={() => undefined} />
        </Screen>
      </ThemeProvider>,
    );
    const scroll = screen.getByTestId('hidden-scroll-scroll');
    expect(scroll.props.showsVerticalScrollIndicator).toBe(false);
    expect(scroll.props.showsHorizontalScrollIndicator).toBe(false);
  });

  it('draws the preview welcome: mark, promise, how pairing works, one pair button', async () => {
    await render(
      <ThemeProvider scheme="light">
        <PairingTheme>
          <WelcomeScreen onPair={() => undefined} />
        </PairingTheme>
      </ThemeProvider>,
    );
    expect(screen.getByRole('header')).toHaveTextContent('Branch');
    expect(screen.getByText('Your Trunks, in your pocket.')).toBeOnTheScreen();
    expect(screen.getByText('Your Trunks run on your own computer.')).toBeOnTheScreen();
    expect(screen.getByText('Connect this phone by scanning a code.')).toBeOnTheScreen();
    expect(screen.getByTestId('pairing-promise')).toBeOnTheScreen();
    expect(screen.getByText('How pairing works')).toBeOnTheScreen();
    expect(screen.getByTestId('pairing-steps')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pair with your computer' })).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByTestId('pair-button').props.style).backgroundColor).toBe(themeFor('light').color.ink);
    expect(screen.queryByTestId('keepoak-later')).toBeNull();
    expect(screen.queryByText(KEEPOAK_SIGN_IN_LATER)).toBeNull();
    expect(screen.queryByRole('button', { name: /Sign in with KeepOak/i })).toBeNull();
    expect(screen.queryByTestId('pairing-level')).toBeNull();
  });

  it('shows Sign in with KeepOak as a later update only at Advanced, and never as a working sign-in', async () => {
    expect(KEEPOAK_SIGN_IN_LATER).toBe('Sign in with KeepOak comes in a later update.');
    await render(
      <ThemeProvider scheme="light">
        <PairingTheme>
          <WelcomeScreen onPair={() => undefined} level={1} />
        </PairingTheme>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('keepoak-later')).toHaveTextContent(KEEPOAK_SIGN_IN_LATER);
    expect(screen.queryByRole('button', { name: /Sign in with KeepOak/i })).toBeNull();
    expect(screen.queryByText(/restores your linked setup/i)).toBeNull();
    expect(screen.queryByText(/KeepOak’s Devices/i)).toBeNull();
  });

  it('keeps the KeepOak later-update at Technical, still without a sign-in control', async () => {
    await render(
      <ThemeProvider scheme="light">
        <PairingTheme>
          <WelcomeScreen onPair={() => undefined} level={2} />
        </PairingTheme>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('keepoak-later')).toHaveTextContent(KEEPOAK_SIGN_IN_LATER);
    expect(screen.queryByRole('button', { name: /Sign in with KeepOak/i })).toBeNull();
  });

  it('pairs from the connect screen’s code field without leaving the camera step', async () => {
    const { session, engine } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('pair-button'));
    expect(screen.getByTestId('camera-permission')).toBeOnTheScreen();
    expect(screen.getByText('Connect to your Branch')).toBeOnTheScreen();
    expect(screen.getByText('Scan the square code on the computer, or type the code.')).toBeOnTheScreen();
    expect(screen.getByTestId('connect-code')).toBeOnTheScreen();
    expect(screen.getByTestId('allow-camera')).toBeOnTheScreen();
    expect(screen.getByTestId('enter-code')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('code-input'), code({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    await fireEvent.press(screen.getByTestId('submit-code'));
    await eventually(() => expect(screen.getByTestId('pairing-approval')).toBeOnTheScreen());
    engine.approve();
    await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
  });
});
