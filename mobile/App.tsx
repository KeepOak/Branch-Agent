import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BackHandler } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { Conversation } from './src/chat/conversation';
import { ChatList, type ChatRow } from './src/chats/chatList';
import { messageSearcher } from './src/chats/messageSearch';
import { createDeviceSession } from './src/pairing/createDeviceSession';
import type { PairingSession } from './src/pairing/pairingSession';
import type { SetupPayload } from './src/pairing/setupCode';
import { usePairingState } from './src/pairing/usePairingState';
import { ApprovalScreen } from './src/screens/ApprovalScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ChatsScreen } from './src/screens/ChatsScreen';
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
type PairedRoute = { name: 'chats' } | { name: 'computer' } | { name: 'chat'; row: ChatRow };

const CHATS: PairedRoute = { name: 'chats' };

/** One open chat. Keyed by the chat, so opening another one starts fresh. */
function OpenChat({ session, row, online, onBack }: { session: PairingSession; row: ChatRow; online: boolean; onBack: () => void }) {
  const [conversation] = useState(() => new Conversation(row.key, session, () => session.newId()));
  useEffect(() => {
    conversation.attach();
    return () => conversation.dispose();
  }, [conversation]);
  // Opening a chat reads it; the mark is cleared once, for the unread state it was opened with.
  const [opened] = useState(row);
  useEffect(() => {
    void conversation.markRead(opened);
  }, [conversation, opened]);
  return <ChatScreen row={row} conversation={conversation} online={online} onBack={onBack} />;
}

function Shell({ session }: { session: PairingSession }) {
  const theme = useTheme();
  const state = usePairingState(session);
  const [route, setRoute] = useState<Route>('welcome');
  const [pairedRoute, setPairedRoute] = useState<PairedRoute>(CHATS);
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
      setPairedRoute(CHATS);
      return;
    }
    setRoute('welcome');
  }, [state.step, chats]);

  // Android's back gesture leaves Your computer or a chat for Chats, like the on-screen back button.
  useEffect(() => {
    if (state.step !== 'paired' || pairedRoute.name === 'chats') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPairedRoute(CHATS);
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
      if (pairedRoute.name === 'computer') {
        screen = <PairedScreen state={state} onUnpair={() => void session.unpair()} onBack={() => setPairedRoute(CHATS)} />;
      } else if (pairedRoute.name === 'chat') {
        // The header follows the list live (a rename, the working dot); the row it was opened from fills in until then.
        const row = chatList.rows.find((r) => r.key === pairedRoute.row.key) ?? pairedRoute.row;
        screen = <OpenChat key={row.key} session={session} row={row} online={state.online} onBack={() => setPairedRoute(CHATS)} />;
      } else {
        screen = (
          <ChatsScreen
            list={chatList}
            online={state.online}
            searchMessages={searchMessages}
            onRefresh={() => chats.refresh()}
            onComputer={() => setPairedRoute({ name: 'computer' })}
            onOpen={(row) => setPairedRoute({ name: 'chat', row })}
          />
        );
      }
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
