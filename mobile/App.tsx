import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, Linking, Platform } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApprovalAlerts, type AppStateSource, type Notifier, type NotificationPermission } from './src/approvals/approvalAlerts';
import { ApprovalInbox, trunkOf, type Approval, type ApprovalDecision } from './src/approvals/approvals';
import { headline } from './src/approvals/approvalWords';
import { testApprovalsOn } from './src/approvals/testApproval';
import { useTestApproval } from './src/approvals/useTestApproval';
import { createExpoNotifier, noNotifier } from './src/approvals/expoNotifier';
import { AgentList, type AgentRow } from './src/agents/agentList';
import { appIdentity, type AppIdentity } from './src/build/appIdentity';
import { Conversation } from './src/chat/conversation';
import { ChatList, filterRows, type ChatRow } from './src/chats/chatList';
import { ComputerList, computerName, type ComputerRow } from './src/computers/computerList';
import { messageSearcher } from './src/chats/messageSearch';
import { createDeviceSession } from './src/pairing/createDeviceSession';
import type { PairingSession } from './src/pairing/pairingSession';
import type { SetupPayload } from './src/pairing/setupCode';
import { usePairingState } from './src/pairing/usePairingState';
import { AgentsScreen } from './src/screens/AgentsScreen';
import { ApprovalScreen } from './src/screens/ApprovalScreen';
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ChatsScreen } from './src/screens/ChatsScreen';
import { ComputersScreen } from './src/screens/ComputersScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { TakeControlScreen } from './src/screens/TakeControlScreen';
import { EnterCodeScreen } from './src/screens/EnterCodeScreen';
import { PairedScreen } from './src/screens/PairedScreen';
import { RefusedScreen } from './src/screens/RefusedScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { MoreScreen } from './src/screens/MoreScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import type { SettingsLevel } from './src/screens/settingsExtras';
import { VoiceScreen } from './src/screens/VoiceScreen';
import { parseShowLevel, readShowLevel, settingsLevelOf, showLevelOf, writeShowLevel, type ShowLevel } from './src/settings/showLevel';
import { deviceStore, type KeyValueStore } from './src/storage/keyValueStore';
import { PairingTheme, ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import type { ColorScheme } from './src/theme/tokens';
import { PhoneShell } from './src/ui/PhoneShell';
import { placesBarHeight, type Place } from './src/ui/PlacesBar';
import { applyQuietJsUpdate } from './src/updates/ota';
import { SettingsUpdateCard, UpdateBanner } from './src/updates/UpdateBanner';
import { useApkUpdate } from './src/updates/useApkUpdate';

// The splash stays up until the saved pairing has been read, so the first frame is the right screen.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

type Route = 'scan' | 'code';
type ComputerOrigin = {
  from?: 'more' | 'profile';
  profileRow?: AgentRow;
  profileFrom?: 'agents' | 'more';
};
type PairedRoute =
  | { name: 'home' }
  | { name: 'chats' }
  | ({ name: 'computers' } & ComputerOrigin)
  | ({ name: 'take-control'; computer: ComputerRow } & ComputerOrigin)
  | { name: 'computer'; from?: 'settings' | 'more'; settingsFrom?: 'more' }
  | { name: 'agents'; from?: 'more' }
  | { name: 'chat'; row: ChatRow }
  | { name: 'voice'; row: ChatRow }
  | { name: 'scan' }
  | { name: 'code' }
  | { name: 'approvals'; focus?: string }
  | { name: 'settings'; from?: 'more' }
  | { name: 'more' }
  | { name: 'profile'; row: AgentRow; from?: 'agents' | 'more' };

const CHATS: PairedRoute = { name: 'chats' };
const HOME: PairedRoute = { name: 'home' };
const SCAN: PairedRoute = { name: 'scan' };
const CODE: PairedRoute = { name: 'code' };

/** New chat from Home or Chats: the main conversation, else the first non-room chat. */
function chatForNew(rows: ChatRow[]): ChatRow | undefined {
  const shown = filterRows(rows, 'all', Date.now());
  return shown.find((row) => !row.room && row.key.endsWith(':main')) ?? shown.find((row) => !row.room);
}

/** Talk from Home: the most recent chat, else the same pick New chat uses. */
function chatForTalk(rows: ChatRow[]): ChatRow | undefined {
  const shown = filterRows(rows, 'all', Date.now());
  const recent = [...shown].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return recent ?? chatForNew(rows);
}

const deviceAppState: AppStateSource = {
  current: () => AppState.currentState,
  onChange: (listener) => {
    const sub = AppState.addEventListener('change', listener);
    return () => sub.remove();
  },
};

/** One open chat. Keyed by the chat, so opening another one starts fresh. */
function OpenChat({
  session,
  row,
  online,
  onBack,
  onTalk,
  onTakeControl,
  computerName,
  pending,
  sending,
  failed,
  onAnswer,
}: {
  session: PairingSession;
  row: ChatRow;
  online: boolean;
  onBack: () => void;
  onTalk: () => void;
  onTakeControl: () => void;
  computerName: string;
  pending: readonly Approval[];
  sending: Record<string, ApprovalDecision>;
  failed: Record<string, string>;
  onAnswer: (id: string, decision: ApprovalDecision) => void;
}) {
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
  return (
    <ChatScreen
      row={row}
      conversation={conversation}
      online={online}
      onBack={onBack}
      onTalk={onTalk}
      hello={session.hello}
      onTakeControl={onTakeControl}
      computerName={computerName}
      pending={pending}
      sending={sending}
      failed={failed}
      onAnswer={onAnswer}
    />
  );
}

function pairedBack(route: PairedRoute): PairedRoute {
  if (route.name === 'take-control') {
    return { name: 'computers', from: route.from, profileRow: route.profileRow, profileFrom: route.profileFrom };
  }
  if (route.name === 'voice') return { name: 'chat', row: route.row };
  if (route.name === 'scan' || route.name === 'code') return HOME;
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
  store,
  showLevel,
  onShowLevel,
}: {
  session: PairingSession;
  notifier: Notifier;
  appState: AppStateSource;
  identity: AppIdentity;
  store?: KeyValueStore;
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
  const [route, setRoute] = useState<Route>('scan');
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
    setRoute('scan');
  }, [state.step, chats, agents, computers, inbox]);

  // Android's back gesture leaves take-control for Computers, Voice for its chat, Scan or Enter code for Home, and Computers, Agents, Your computer, Settings, More, Profile, a chat or Approvals, like the on-screen back button. Home is a root, like Chats.
  useEffect(() => {
    if (state.step !== 'paired' || pairedRoute.name === 'chats' || pairedRoute.name === 'home') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPairedRoute(pairedBack(pairedRoute));
      return true;
    });
    return () => sub.remove();
  }, [state.step, pairedRoute]);

  const insets = useSafeAreaInsets();
  const look = Platform.OS === 'ios' ? 'ios' : 'android';
  const tabPad = placesBarHeight(look, insets.bottom);
  // Android's Places bar is in-flow, so extra list padding would double it.
  const extraPad = look === 'ios' ? tabPad : 0;
  const hostComputer = computerList.rows.find((row) => row.id === 'gateway');
  const computerTitle = hostComputer ? [hostComputer.name, hostComputer.os].filter(Boolean).join(' · ') : undefined;
  const goPlace = (place: Place) => {
    if (place === 'home') setPairedRoute({ name: 'home' });
    else if (place === 'chats') setPairedRoute(CHATS);
    else if (place === 'inbox') setPairedRoute({ name: 'approvals' });
    else setPairedRoute({ name: 'more' });
  };

  const begin = (setup: SetupPayload) => session.begin(setup);
  // A new pairing from Home replaces this computer only once a code is submitted (that is the confirm).
  const beginNewPair = (setup: SetupPayload) => {
    void session.unpair().then(() => session.begin(setup));
  };
  const toPair = () => {
    session.cancel();
    setRoute('scan');
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

  const computerOrigin = (route: Extract<PairedRoute, { name: 'computers' | 'take-control' }>): ComputerOrigin => ({
    from: route.from,
    profileRow: route.profileRow,
    profileFrom: route.profileFrom,
  });

  let screen = null;
  switch (state.step) {
    case 'loading':
      break;
    case 'unpaired':
      screen =
        route === 'code' ? (
          <PairingTheme>
            <EnterCodeScreen onCode={begin} onScan={() => setRoute('scan')} onCancel={toPair} />
          </PairingTheme>
        ) : (
          <PairingTheme>
            <ScanScreen onCode={begin} onEnterCode={() => setRoute('code')} updateBanner={updateBanner} />
          </PairingTheme>
        );
      break;
    case 'connecting':
    case 'approval':
    case 'failed':
      screen = (
        <PairingTheme>
          <ApprovalScreen state={state} onCancel={toPair} onScanAgain={scanAgain} />
        </PairingTheme>
      );
      break;
    case 'paired':
      if (pairedRoute.name === 'computers') {
        const origin = computerOrigin(pairedRoute);
        screen = (
          <ComputersScreen
            list={computerList}
            online={state.online}
            onRefresh={() => computers.refresh()}
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
            onThisPhone={() => setPairedRoute({ name: 'computer', from: pairedRoute.from === 'more' ? 'more' : undefined })}
            onOpenComputer={(computer) => setPairedRoute({ name: 'take-control', computer, ...origin })}
            backTo={pairedRoute.from === 'profile' ? 'Profile' : pairedRoute.from === 'more' ? 'More' : 'Chats'}
          />
        );
      } else if (pairedRoute.name === 'take-control') {
        screen = (
          <TakeControlScreen
            computer={pairedRoute.computer}
            link={session}
            newId={() => session.newId()}
            store={store}
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
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
      } else if (pairedRoute.name === 'home') {
        screen = (
          <HomeScreen
            chats={chatList}
            approvals={approvals}
            online={state.online}
            accessLevel={showLevel}
            look={look}
            onNewChat={() => {
              const row = chatForNew(chatList.rows);
              if (row) setPairedRoute({ name: 'chat', row });
              else setPairedRoute(CHATS);
            }}
            onTalk={() => {
              const row = chatForTalk(chatList.rows);
              if (row) setPairedRoute({ name: 'voice', row });
              else setPairedRoute(CHATS);
            }}
            onComputer={() => setPairedRoute({ name: 'computers' })}
            onScan={() => setPairedRoute(SCAN)}
            onAnswer={(id, decision) => void inbox.answer(id, decision)}
            onLookFirst={(_id, sessionKey) => {
              const row = sessionKey ? chatList.rows.find((r) => r.key === sessionKey) : undefined;
              if (row) setPairedRoute({ name: 'chat', row });
              else setPairedRoute({ name: 'approvals', focus: _id });
            }}
            onPlace={goPlace}
            onOpenChat={(row) => setPairedRoute({ name: 'chat', row })}
            updateBanner={updateBanner}
          />
        );
      } else if (pairedRoute.name === 'more') {
        screen = (
          <PhoneShell current="more" inboxCount={approvals.pending.length} onPlace={goPlace} look={look}>
            <MoreScreen
              level={showLevel}
              trunkCount={agentList.rows.length}
              workingCount={agentList.rows.filter((row) => row.status === 'running').length}
              onSettings={() => setPairedRoute({ name: 'settings', from: 'more' })}
              onTrunks={() => setPairedRoute({ name: 'agents', from: 'more' })}
              onBack={() => setPairedRoute(CHATS)}
              bottomExtra={extraPad}
            />
          </PhoneShell>
        );
      } else if (pairedRoute.name === 'profile') {
        const row = agentList.rows.find((item) => item.id === pairedRoute.row.id) ?? pairedRoute.row;
        const host = computerList.rows.find((item) => item.id === 'gateway');
        screen = (
          <ProfileScreen
            row={row}
            level={showLevel}
            computer={host ? computerName(host) : 'This computer'}
            onComputer={() =>
              setPairedRoute({ name: 'computers', from: 'profile', profileRow: row, profileFrom: pairedRoute.from })
            }
            onBack={() => setPairedRoute(pairedBack(pairedRoute))}
            backTo={pairedRoute.from === 'more' ? 'More' : 'Agents'}
          />
        );
      } else if (pairedRoute.name === 'settings') {
        screen = (
          <PhoneShell current="more" inboxCount={approvals.pending.length} onPlace={goPlace} look={look}>
            <SettingsScreen
              state={state}
              permission={permission}
              identity={identity}
              computerTitle={computerTitle}
              onThisPhone={() => setPairedRoute({ name: 'computer', from: 'settings', settingsFrom: pairedRoute.from })}
              onOpenSettings={() => void Linking.openSettings().catch(() => undefined)}
              onTurnOnNotifications={turnOnNotifications}
              onConnectAnother={() => setPairedRoute(SCAN)}
              onForget={() => void session.unpair()}
              onSetupTalk={() => {
                const row = chatForTalk(chatList.rows);
                if (row) setPairedRoute({ name: 'voice', row });
              }}
              onAskHelp={() => {
                const row = chatForTalk(chatList.rows);
                if (row) setPairedRoute({ name: 'chat', row });
              }}
              onBack={() => setPairedRoute(pairedBack(pairedRoute))}
              onLevel={(next: SettingsLevel) => onShowLevel(showLevelOf(next))}
              updateCard={updateCard}
              level={settingsLevelOf(showLevel)}
              backTo={pairedRoute.from === 'more' ? 'More' : 'Chats'}
              bottomExtra={extraPad}
              store={store}
            />
          </PhoneShell>
        );
      } else if (pairedRoute.name === 'scan') {
        screen = (
          <PairingTheme>
            <ScanScreen
              onCode={beginNewPair}
              onEnterCode={() => setPairedRoute(CODE)}
              onCancel={() => setPairedRoute(HOME)}
              updateBanner={updateBanner}
            />
          </PairingTheme>
        );
      } else if (pairedRoute.name === 'code') {
        screen = (
          <PairingTheme>
            <EnterCodeScreen onCode={beginNewPair} onScan={() => setPairedRoute(SCAN)} onCancel={() => setPairedRoute(HOME)} />
          </PairingTheme>
        );
      } else if (pairedRoute.name === 'voice') {
        const row = chatList.rows.find((r) => r.key === pairedRoute.row.key) ?? pairedRoute.row;
        const toChat = () => setPairedRoute({ name: 'chat', row });
        screen = (
          <VoiceScreen
            row={row}
            online={state.online}
            link={session}
            pending={approvals.pending}
            level={showLevel}
            onAnswer={(id, decision) => void inbox.answer(id, decision)}
            onClose={toChat}
            onEnd={toChat}
            onKeyboard={toChat}
          />
        );
      } else if (pairedRoute.name === 'chat') {
        // The header follows the list live (a rename, the working dot); the row it was opened from fills in until then.
        const row = chatList.rows.find((r) => r.key === pairedRoute.row.key) ?? pairedRoute.row;
        screen = (
          <OpenChat
            key={row.key}
            session={session}
            row={row}
            online={state.online}
            onBack={() => setPairedRoute(CHATS)}
            onTalk={() => setPairedRoute({ name: 'voice', row })}
            onTakeControl={() => setPairedRoute({ name: 'computers' })}
            computerName="This computer"
            pending={approvals.pending}
            sending={approvals.sending}
            failed={approvals.failed}
            onAnswer={(id, decision) => void inbox.answer(id, decision)}
          />
        );
      } else if (pairedRoute.name === 'approvals') {
        const chatFor = (key: string) => chatList.rows.find((r) => r.key === key);
        screen = (
          <PhoneShell current="inbox" inboxCount={approvals.pending.length} onPlace={goPlace} look={look}>
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
              bottomExtra={extraPad}
            />
          </PhoneShell>
        );
      } else {
        const first = approvals.pending[0];
        const more = approvals.pending.length - 1;
        const goPlace = (place: Place) => {
          if (place === 'chats') return;
          if (place === 'home') setPairedRoute({ name: 'home' });
          else if (place === 'inbox') setPairedRoute({ name: 'approvals' });
          else setPairedRoute({ name: 'more' });
        };
        screen = (
          <PhoneShell current="chats" inboxCount={approvals.pending.length} onPlace={goPlace} look={look}>
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
              onNewChat={() => {
                const row = chatForNew(chatList.rows);
                if (row) setPairedRoute({ name: 'chat', row });
              }}
              needsYou={first ? { count: approvals.pending.length, line: `${trunkOf(first, approvals.trunks).name} · ${headline(first)}${more > 0 ? ` and ${more} more` : ''}` } : null}
              onNeedsYou={() => setPairedRoute({ name: 'approvals' })}
              updateBanner={updateBanner}
              look={look}
              level={showLevel}
              bottomExtra={extraPad}
            />
          </PhoneShell>
        );
      }
      break;
    case 'refused':
      screen = (
        <PairingTheme>
          <RefusedScreen state={state} onPairAgain={pairAgain} onRetry={() => session.retry()} onForget={() => void session.unpair()} />
        </PairingTheme>
      );
  }

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
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
  // Keep one store for the life of this App so a render cannot mint a new device store and reload the saved level.
  const [store] = useState(() => themeStore ?? (given ? undefined : deviceStore()));
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
          store={store}
          showLevel={showLevel}
          onShowLevel={onShowLevel}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
