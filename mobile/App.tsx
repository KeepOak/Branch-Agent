import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { createDeviceSession } from './src/pairing/createDeviceSession';
import type { PairingSession } from './src/pairing/pairingSession';
import type { SetupPayload } from './src/pairing/setupCode';
import { usePairingState } from './src/pairing/usePairingState';
import { ApprovalScreen } from './src/screens/ApprovalScreen';
import { EnterCodeScreen } from './src/screens/EnterCodeScreen';
import { PairedScreen } from './src/screens/PairedScreen';
import { RefusedScreen } from './src/screens/RefusedScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import type { ColorScheme } from './src/theme/tokens';

// The splash stays up until the saved pairing has been read, so the first frame is the right screen.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

type Route = 'welcome' | 'scan' | 'code';

function Shell({ session }: { session: PairingSession }) {
  const theme = useTheme();
  const state = usePairingState(session);
  const [route, setRoute] = useState<Route>('welcome');

  useEffect(() => {
    if (state.step !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
    if (state.step === 'unpaired') return;
    setRoute('welcome');
  }, [state.step]);

  const begin = (setup: SetupPayload) => session.begin(setup);
  const toWelcome = () => {
    session.cancel();
    setRoute('welcome');
  };
  const scanAgain = () => {
    session.cancel();
    setRoute('scan');
  };

  // A fresh pairing forgets the refused one (its device token no longer works) and opens the scanner.
  const pairAgain = () => {
    setRoute('scan');
    void session.unpair();
  };

  let screen = null;
  switch (state.step) {
    case 'loading':
      break;
    case 'unpaired':
      screen =
        route === 'scan' ? (
          <ScanScreen onCode={begin} onEnterCode={() => setRoute('code')} onCancel={toWelcome} />
        ) : route === 'code' ? (
          <EnterCodeScreen onCode={begin} onScan={() => setRoute('scan')} onCancel={toWelcome} />
        ) : (
          <WelcomeScreen onPair={() => setRoute('scan')} />
        );
      break;
    case 'connecting':
    case 'approval':
    case 'failed':
      screen = <ApprovalScreen state={state} onCancel={toWelcome} onScanAgain={scanAgain} />;
      break;
    case 'paired':
      screen = <PairedScreen state={state} onUnpair={() => void session.unpair()} />;
      break;
    case 'refused':
      screen = <RefusedScreen state={state} onPairAgain={pairAgain} onRetry={() => session.retry()} onForget={() => void session.unpair()} />;
  }

  return (
    <>
      <StatusBar style={route === 'scan' && state.step === 'unpaired' ? 'light' : theme.scheme === 'dark' ? 'light' : 'dark'} />
      {screen}
    </>
  );
}

export default function App({ scheme, session: given }: { scheme?: ColorScheme; session?: PairingSession }) {
  const [session] = useState(() => given ?? createDeviceSession());
  useEffect(() => {
    void session.restore();
    return () => session.dispose();
  }, [session]);
  return (
    // Starting from the window's known insets draws the first frame at once instead of a blank one.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider scheme={scheme}>
        <Shell session={session} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
