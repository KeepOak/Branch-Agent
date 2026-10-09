import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BackHandler } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatList } from './src/chats/chatList';
import { messageSearcher } from './src/chats/messageSearch';
import { createDeviceSession } from './src/pairing/createDeviceSession';
import type { PairingSession } from './src/pairing/pairingSession';
import type { SetupPayload } from './src/pairing/setupCode';
import { usePairingState } from './src/pairing/usePairingState';
import { ApprovalScreen } from './src/screens/ApprovalScreen';
import { ChatsScreen } from './src/screens/ChatsScreen';
import { EnterCodeScreen } from './src/screens/EnterCodeScreen';
import { PairedScreen } from './src/screens/PairedScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import type { ColorScheme } from './src/theme/tokens';

// The splash stays up until the saved pairing has been read, so the first frame is the right screen.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

type Route = 'welcome' | 'scan' | 'code';
type PairedRoute = 'chats' | 'computer';

function Shell({ session }: { session: PairingSession }) {
  const theme = useTheme();
  const state = usePairingState(session);
  const [route, setRoute] = useState<Route>('welcome');
  const [pairedRoute, setPairedRoute] = useState<PairedRoute>('chats');
  // One list for the whole session, so going to Your computer and back doesn't reload it.
  const [chats] = useState(() => new ChatList(session));
  const chatList = useSyncExternalStore(chats.subscribe, chats.getSnapshot);
  const [searchMessages] = useState(() => messageSearcher((method, params) => session.request(method, params)));

  useEffect(() => {
    chats.attach();
    return () => chats.dispose();
  }, [chats]);

  useEffect(() => {
    if (state.step !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
    if (state.step === 'unpaired') {
      chats.reset();
      setPairedRoute('chats');
      return;
    }
    setRoute('welcome');
  }, [state.step, chats]);

  // Android's back gesture leaves Your computer for Chats, like the on-screen back button.
  useEffect(() => {
    if (state.step !== 'paired' || pairedRoute !== 'computer') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPairedRoute('chats');
      return true;
    });
    return () => sub.remove();
  }, [state.step, pairedRoute]);

  const begin = (setup: SetupPayload) => session.begin(setup);
  const toWelcome = () => {
    session.cancel();
    setRoute('welcome');
  };
  const scanAgain = () => {
    session.cancel();
    setRoute('scan');
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
      screen =
        pairedRoute === 'computer' ? (
          <PairedScreen state={state} onUnpair={() => void session.unpair()} onBack={() => setPairedRoute('chats')} />
        ) : (
          <ChatsScreen list={chatList} online={state.online} searchMessages={searchMessages} onRefresh={() => chats.refresh()} onComputer={() => setPairedRoute('computer')} />
        );
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
