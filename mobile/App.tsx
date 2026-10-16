import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, Linking, Platform } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { ApprovalAlerts, type AppStateSource, type Notifier, type NotificationPermission } from './src/approvals/approvalAlerts';
import { ApprovalInbox, trunkOf } from './src/approvals/approvals';
import { headline } from './src/approvals/approvalWords';
import { testApprovalsOn } from './src/approvals/testApproval';
import { useTestApproval } from './src/approvals/useTestApproval';
import { createExpoNotifier, noNotifier } from './src/approvals/expoNotifier';
import { AgentList, type AgentRow } from './src/agents/agentList';
import { appIdentity, type AppIdentity } from './src/build/appIdentity';
import { Conversation } from './src/chat/conversation';
import { ChatList, type ChatRow } from './src/chats/chatList';
import { ComputerList } from './src/computers/computerList';
import { messageSearcher } from './src/chats/messageSearch';
import { createDeviceSession } from './src/pairing/createDeviceSession';
import type { PairingSession } from './src/pairing/pairingSession';
import { gatewayHost, type SetupPayload } from './src/pairing/setupCode';
import { usePairingState } from './src/pairing/usePairingState';
import { AgentsScreen } from './src/screens/AgentsScreen';
import { ApprovalScreen } from './src/screens/ApprovalScreen';
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ChatsScreen } from './src/screens/ChatsScreen';
import { ComputersScreen } from './src/screens/ComputersScreen';
import { EnterCodeScreen } from './src/screens/EnterCodeScreen';
import { PairedScreen } from './src/screens/PairedScreen';
import { RefusedScreen } from './src/screens/RefusedScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { MoreScreen } from './src/screens/MoreScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { parseShowLevel, readShowLevel, writeShowLevel, type ShowLevel } from './src/settings/showLevel';
import { deviceStore, type KeyValueStore } from './src/storage/keyValueStore';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import type { ColorScheme } from './src/theme/tokens';
import { applyQuietJsUpdate } from './src/updates/ota';
import { SettingsUpdateCard, UpdateBanner } from './src/updates/UpdateBanner';
import { useApkUpdate } from './src/updates/useApkUpdate';

// The splash stays up until the saved pairing has been read, so the first frame is the right screen.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

type Route = 'welcome' | 'scan' | 'code';
type PairedRoute =
  | { name: 'chats' }
  | { name: 'computers'; from?: 'more' | 'profile'; profileRow?: AgentRow; profileFrom?: 'agents' | 'more' }
  | { name: 'computer'; from?: 'settings' | 'more'; settingsFrom?: 'more' }
  | { name: 'agents'; from?: 'more' }
  | { name: 'chat'; row: ChatRow }
  | { name: 'approvals'; focus?: string }
  | { name: 'settings'; from?: 'more' }
  | { name: 'more' }
  | { name: 'profile'; row: AgentRow; from?: 'agents' | 'more' };

const CHATS: PairedRoute = { name: 'chats' };

const deviceAppState: AppStateSource = {
  current: () => AppState.currentState,
  onChange: (listener) => {
    const sub = AppState.addEventListener('change', listener);
    return () => sub.remove();
  },
};

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
  return <ChatScreen row={row} conversation={conversation} online={online} onBack={onBack} hello={session.hello} />;
}

function pairedBack(route: PairedRoute): PairedRoute {
  if (route.name === 'computer' && route.from === 'settings') return { name: 'settings', from: route.settingsFrom };
  if (route.name === 'computer' && route.from === 'more') return { name: 'more' };
  if (route.name === 'settings' && route.from === 'more') return { name: 'more' };
  if (route.name === 'agents' && route.from === 'more') return { name: 'more' };
  if (route.name === 'profile') return { name: 'agents', from: route.from === 'more' ? 'more' : undefined };
  if (route.name === 'computers' && route.from === 'profile' && route.profileRow) {
    return { name: 'profile', row: route.profileRow, from: route.profileFrom };
  }
  if (route.name === 'computers' && route.from === 'more') return { name: 'more' };
  return CHATS;
}

function Shell({
  session,
  notifier,
  appState,
  identity,
  showLevel,
  onShowLevel,
}: {
  session: PairingSession;
  notifier: Notifier;
  appState: AppStateSource;
  identity: AppIdentity;
  showLevel: ShowLevel;
  onShowLevel: (next: ShowLevel) => void;
}) {
  const theme = useTheme();
  const state = usePairingState(session);
  const update = useApkUpdate();
  const installed = {
    version: Constants.expoConfig?.version ?? '0.1.0',
    versionCode: Constants.expoConfig?.android?.versionCode ?? 1,
  };
  const updateBanner = (
    <UpdateBanner state={update.state} onUpdate={update.startUpdate} onAllowInstalls={() => update.allowInstalls()} />
  );
  const updateCard = (
    <SettingsUpdateCard
      version={installed.version}
      versionCode={installed.versionCode}
      state={update.state}
      onCheck={update.check}
      onUpdate={update.startUpdate}
      onAllowInstalls={() => update.allowInstalls()}
      apkUpdates={Platform.OS === 'android'}
    />
  );
  const [route, setRoute] = useState<Route>('welcome');
  const [pairedRoute, setPairedRoute] = useState<PairedRoute>(CHATS);
  // One list for the whole session, so going to Computers, Agents or Your computer and back doesn't reload it.
  const [chats] = useState(() => new ChatList(session));
  const chatList = useSyncExternalStore(chats.subscribe, chats.getSnapshot);
  const [agents] = useState(() => new AgentList(session));
  const agentList = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
  const [computers] = useState(() => new ComputerList(session));
  const computerList = useSyncExternalStore(computers.subscribe, computers.getSnapshot);
  const [searchMessages] = useState(() => messageSearcher((method, params) => session.request(method, params)));

  useEffect(() => {
    chats.attach();
    agents.attach();
    computers.attach();
    return () => {
      chats.dispose();
      agents.dispose();
      computers.dispose();
    };
  }, [chats, agents, computers]);

  // Approvals are followed for the whole session, on every screen, so a notification can go out while
  // Branch is in the background and its buttons can answer.
  const [inbox] = useState(() => new ApprovalInbox(session));
  const approvals = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  useEffect(() => {
    inbox.attach();
    const alerts = new ApprovalAlerts(inbox, notifier, appState, (focus) => setPairedRoute({ name: 'approvals', focus }));
    alerts.attach();
    return () => {
      alerts.dispose();
      inbox.dispose();
    };
  }, [inbox, notifier, appState]);
  useEffect(() => {
    if (state.step !== 'paired') return;
    let live = true;
    const read = () => {
      notifier.permission().then(
        (p) => live && setPermission(p),
        () => live && setPermission('unavailable'),
      );
    };
    read();
    const stop = appState.onChange((next) => {
      if (next === 'active') read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [state.step, notifier, appState]);
  const [testTools] = useState(testApprovalsOn);
  const [refreshApprovals] = useState(() => () => inbox.refresh());
  const testApproval = useTestApproval(session, refreshApprovals);
  const turnOnNotifications = () => {
    notifier.requestPermission().then(setPermission, () => setPermission('unavailable'));
  };

  useEffect(() => {
    if (state.step !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
    if (state.step === 'unpaired') {
      chats.reset();
      agents.reset();
      computers.reset();
      inbox.reset();
      setPairedRoute(CHATS);
      return;
    }
    setRoute('welcome');
  }, [state.step, chats, agents, computers, inbox]);

  // Android's back gesture leaves Computers, Agents, Your computer, Settings, More, Profile, a chat or Approvals, like the on-screen back button.
  useEffect(() => {
    if (state.step !== 'paired' || pairedRoute.name === 'chats') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPairedRoute(pairedBack(pairedRoute));
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
          <WelcomeScreen onPair={() => setRoute('scan')} updateBanner={updateBanner} />
        );
      break;
    case 'connecting':
    case 'approval':
    case 'failed':
      screen = <ApprovalScreen state={state} onCancel={toWelcome} onScanAgain={scanAgain} />;
      break;
    case 'paired':
      if (pairedRoute.name === 'computers') {
        screen = (
          <ComputersScreen
            list={computerList}
            online={state.online}
            onRefresh={() => computers.refresh()}
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
            onThisPhone={() => setPairedRoute({ name: 'computer', from: pairedRoute.from === 'more' ? 'more' : undefined })}
            backTo={pairedRoute.from === 'profile' ? 'Profile' : pairedRoute.from === 'more' ? 'More' : 'Chats'}
          />
        );
      } else if (pairedRoute.name === 'computer') {
        const fromSettings = pairedRoute.from === 'settings';
        const fromMore = pairedRoute.from === 'more';
        screen = (
          <PairedScreen
            state={state}
            onUnpair={() => void session.unpair()}
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
            backTo={fromSettings ? 'Settings' : fromMore ? 'More' : 'Chats'}
            updateCard={updateCard}
          />
        );
      } else if (pairedRoute.name === 'agents') {
        screen = (
          <AgentsScreen
            list={agentList}
            online={state.online}
            onRefresh={() => agents.refresh()}
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
            onOpen={(row) => setPairedRoute({ name: 'profile', row, from: pairedRoute.from === 'more' ? 'more' : 'agents' })}
            backTo={pairedRoute.from === 'more' ? 'More' : 'Chats'}
          />
        );
      } else if (pairedRoute.name === 'more') {
        screen = (
          <MoreScreen
            level={showLevel}
            trunkCount={agentList.rows.length}
            workingCount={agentList.rows.filter((row) => row.status === 'running').length}
            onSettings={() => setPairedRoute({ name: 'settings', from: 'more' })}
            onTrunks={() => setPairedRoute({ name: 'agents', from: 'more' })}
            onBack={() => setPairedRoute(CHATS)}
          />
        );
      } else if (pairedRoute.name === 'profile') {
        screen = (
          <ProfileScreen
            row={pairedRoute.row}
            level={showLevel}
            computer={gatewayHost(state.url)}
            onComputer={() =>
              setPairedRoute({ name: 'computers', from: 'profile', profileRow: pairedRoute.row, profileFrom: pairedRoute.from })
            }
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
            backTo={pairedRoute.from === 'more' ? 'More' : 'Agents'}
          />
        );
      } else if (pairedRoute.name === 'settings') {
        screen = (
          <SettingsScreen
            state={state}
            permission={permission}
            identity={identity}
            showLevel={showLevel}
            onShowLevel={onShowLevel}
            onThisPhone={() => setPairedRoute({ name: 'computer', from: 'settings', settingsFrom: pairedRoute.from })}
            onOpenSettings={() => void Linking.openSettings().catch(() => undefined)}
            onTurnOnNotifications={turnOnNotifications}
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
            backTo={pairedRoute.from === 'more' ? 'More' : 'Chats'}
          />
        );
      } else if (pairedRoute.name === 'chat') {
        // The header follows the list live (a rename, the working dot); the row it was opened from fills in until then.
        const row = chatList.rows.find((r) => r.key === pairedRoute.row.key) ?? pairedRoute.row;
        screen = <OpenChat key={row.key} session={session} row={row} online={state.online} onBack={() => setPairedRoute(CHATS)} />;
      } else if (pairedRoute.name === 'approvals') {
        const chatFor = (key: string) => chatList.rows.find((r) => r.key === key);
        screen = (
          <ApprovalsScreen
            snapshot={approvals}
            online={state.online}
            permission={permission}
            onTurnOnNotifications={turnOnNotifications}
            onOpenSettings={() => void Linking.openSettings().catch(() => undefined)}
            onAnswer={(id, decision) => void inbox.answer(id, decision)}
            onRetry={() => void inbox.refresh()}
            onBack={() => setPairedRoute(CHATS)}
            canOpenChat={(key) => Boolean(chatFor(key))}
            onOpenChat={(key) => {
              const row = chatFor(key);
              if (row) setPairedRoute({ name: 'chat', row });
            }}
            focusId={pairedRoute.focus}
            test={testTools ? { state: testApproval.state, onSend: testApproval.send, onCancel: testApproval.cancel } : undefined}
          />
        );
      } else {
        const first = approvals.pending[0];
        const more = approvals.pending.length - 1;
        screen = (
          <ChatsScreen
            list={chatList}
            online={state.online}
            searchMessages={searchMessages}
            onRefresh={() => chats.refresh()}
            onComputer={() => setPairedRoute({ name: 'computers' })}
            onAgents={() => setPairedRoute({ name: 'agents' })}
            onSettings={() => setPairedRoute({ name: 'settings' })}
            onMore={() => setPairedRoute({ name: 'more' })}
            onOpen={(row) => setPairedRoute({ name: 'chat', row })}
            needsYou={first ? { count: approvals.pending.length, line: `${trunkOf(first, approvals.trunks).name} · ${headline(first)}${more > 0 ? ` and ${more} more` : ''}` } : null}
            onNeedsYou={() => setPairedRoute({ name: 'approvals' })}
            updateBanner={updateBanner}
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

export default function App({
  scheme,
  session: given,
  notifier: givenNotifier,
  appState = deviceAppState,
  identity: givenIdentity,
  themeStore,
  showLevel: givenLevel,
}: {
  scheme?: ColorScheme;
  session?: PairingSession;
  notifier?: Notifier;
  appState?: AppStateSource;
  identity?: AppIdentity;
  themeStore?: KeyValueStore;
  showLevel?: ShowLevel;
}) {
  const [session] = useState(() => given ?? createDeviceSession());
  const [notifier] = useState(() => givenNotifier ?? (Platform.OS === 'web' ? noNotifier : createExpoNotifier()));
  const [identity] = useState(() => givenIdentity ?? appIdentity());
  const store = themeStore ?? (given ? undefined : deviceStore());
  const [showLevel, setShowLevel] = useState<ShowLevel>(() => parseShowLevel(givenLevel));
  useEffect(() => {
    if (givenLevel !== undefined) {
      setShowLevel(givenLevel);
      return;
    }
    if (!store) return;
    let live = true;
    void readShowLevel(store).then((saved) => {
      if (live) setShowLevel(saved);
    });
    return () => {
      live = false;
    };
  }, [givenLevel, store]);
  const onShowLevel = (next: ShowLevel) => {
    setShowLevel(next);
    if (store && givenLevel === undefined) void writeShowLevel(store, next);
  };
  useEffect(() => {
    void session.restore();
    return () => session.dispose();
  }, [session]);
  useEffect(() => {
    void applyQuietJsUpdate();
  }, []);
  return (
    // Starting from the window's known insets draws the first frame at once instead of a blank one.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider scheme={scheme} store={store}>
        <Shell
          session={session}
          notifier={notifier}
          appState={appState}
          identity={identity}
          showLevel={showLevel}
          onShowLevel={onShowLevel}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
