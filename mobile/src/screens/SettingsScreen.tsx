import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import type { NotificationPermission } from '../approvals/approvalAlerts';
import { appIdentity, versionLine, type AppIdentity } from '../build/appIdentity';
import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import {
  CYCLE_LABEL,
  LEND_ABILITIES,
  MIC_OPTIONS,
  NOTIF_KINDS,
  PHONE_PREFS_DEFAULT,
  TEXT_SIZES,
  lendSummary,
  nextCycle,
  notifKindsValue,
  readPhonePrefs,
  writePhonePrefs,
  type CyclePos,
  type PhonePrefs,
} from '../settings/phonePrefs';
import type { KeyValueStore } from '../storage/keyValueStore';
import { DESKTOP_THEMES, desktopThemeName } from '../theme/desktopThemes';
import { ThemedText } from '../theme/ThemedText';
import { useTheme, useThemePreference } from '../theme/ThemeProvider';
import { THEME_OPTIONS } from '../theme/preference';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import {
  APK_UPDATE_HELP,
  ASSISTANT_REASON,
  CHAT_APPS_HELP,
  HELP_PAGES,
  KEEPOAK_SIGN_IN,
  KEEPOAK_SIGN_IN_REASON,
  LANGUAGE_OPTIONS,
  MODELS_HELP,
  SKILLS_HELP,
  RUN_ON_PHONE,
  RUN_ON_PHONE_REASON,
  SETTINGS_GROUPS,
  SETTINGS_LEVELS,
  WAKE_WORDS_DEFAULT,
  showsAt,
  type SettingsGroup,
  type SettingsLevel,
} from './settingsExtras';

export { SETTINGS_GROUPS };
export type { SettingsGroup };

type Page =
  | 'main'
  | 'help'
  | 'language'
  | 'themes'
  | `help-${string}`
  | 'about'
  | 'accounts'
  | 'notif'
  | 'this-branch'
  | 'lend'
  | 'mic'
  | 'checks'
  | 'connection'
  | 'chatapps'
  | 'models'
  | 'skills';

function Group({
  title,
  testID,
  children,
}: {
  title?: string;
  testID?: string;
  children: ReactNode;
}) {
  const { color, space, radius, layout } = useTheme();
  return (
    <View testID={testID} style={{ marginTop: space.xxl }}>
      {title ? (
        <ThemedText
          variant="settingsLabel"
          tone="ink3"
          style={{ textTransform: 'uppercase', marginBottom: space.sm, marginLeft: space.sm }}
        >
          {title}
        </ThemedText>
      ) : null}
      <View
        testID={testID ? `${testID}-surface` : undefined}
        style={{
          backgroundColor: color.glass,
          borderRadius: radius.md,
          borderWidth: layout.hairline,
          borderColor: color.line,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Hairline({ last }: { last: boolean }) {
  const { color, layout } = useTheme();
  if (last) return null;
  return <View style={{ height: layout.hairline, backgroundColor: color.line, marginLeft: 14 }} />;
}

function Row({
  label,
  value,
  last = false,
  testID,
}: {
  label: string;
  value: string;
  last?: boolean;
  testID?: string;
}) {
  const { layout, space } = useTheme();
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          minHeight: layout.rowMinHeight,
          alignItems: 'center',
          paddingHorizontal: 14,
          gap: space.md,
        }}
      >
        <ThemedText variant="settingsBody">{label}</ThemedText>
        <ThemedText variant="settingsBody" tone="ink2" testID={testID} style={{ flexShrink: 1, textAlign: 'right' }}>
          {value}
        </ThemedText>
      </View>
      <Hairline last={last} />
    </View>
  );
}

function GoRow({
  title,
  value,
  detail,
  onPress,
  testID,
  last = false,
  accessibilityLabel,
}: {
  title: string;
  value?: string;
  detail?: string;
  onPress: () => void;
  testID: string;
  last?: boolean;
  accessibilityLabel?: string;
}) {
  const { layout, space } = useTheme();
  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: layout.rowMinHeight,
          paddingHorizontal: 14,
          paddingVertical: space.sm,
          gap: space.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText variant="settingsBody">{title}</ThemedText>
          {detail ? (
            <ThemedText variant="footnote" tone="ink3">
              {detail}
            </ThemedText>
          ) : null}
        </View>
        {value ? (
          <ThemedText variant="subhead" tone="ink2">
            {value}
          </ThemedText>
        ) : null}
        <ThemedText variant="body" tone="ink3">
          ›
        </ThemedText>
      </Pressable>
      <Hairline last={last} />
    </View>
  );
}

function CycleRow({
  title,
  detail,
  value,
  onPress,
  testID,
  last = false,
}: {
  title: string;
  detail: string;
  value: CyclePos;
  onPress: () => void;
  testID: string;
  last?: boolean;
}) {
  const { layout, space } = useTheme();
  const label = CYCLE_LABEL[value];
  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${label}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: layout.rowMinHeight,
          paddingHorizontal: 14,
          paddingVertical: space.sm,
          gap: space.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText variant="settingsBody">{title}</ThemedText>
          <ThemedText variant="footnote" tone="ink3">
            {detail}
          </ThemedText>
        </View>
        <ThemedText variant="subhead" tone="ink2" testID={`${testID}-value`}>
          {label}
        </ThemedText>
      </Pressable>
      <Hairline last={last} />
    </View>
  );
}

function SwitchRow({
  title,
  detail,
  extra,
  on,
  onPress,
  testID,
  last = false,
}: {
  title: string;
  detail?: string;
  extra?: string;
  on: boolean;
  onPress: () => void;
  testID: string;
  last?: boolean;
}) {
  const { color, layout, space, radius } = useTheme();
  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel={title}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: layout.rowMinHeight,
          paddingHorizontal: 14,
          paddingVertical: space.sm,
          gap: space.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText variant="settingsBody">{title}</ThemedText>
          {detail ? (
            <ThemedText variant="footnote" tone="ink3">
              {detail}
            </ThemedText>
          ) : null}
          {extra ? (
            <ThemedText variant="footnote" tone="ink2" testID={`${testID}-extra`}>
              {extra}
            </ThemedText>
          ) : null}
        </View>
        <View
          testID={`${testID}-track`}
          style={{
            width: 48,
            height: 28,
            borderRadius: radius.pill,
            backgroundColor: on ? color.ink : color.fill,
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: radius.pill,
              backgroundColor: on ? color.raise : color.ink3,
              alignSelf: on ? 'flex-end' : 'flex-start',
            }}
          />
        </View>
      </Pressable>
      <Hairline last={last} />
    </View>
  );
}

function BackRow({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const { layout, space } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        minHeight: layout.rowMinHeight,
        justifyContent: 'center',
        marginTop: -space.xl,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ThemedText variant="settingsBody">← {label}</ThemedText>
    </Pressable>
  );
}

function ConfirmCard({
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
  testID,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID: string;
}) {
  const { space } = useTheme();
  return (
    <View testID={testID} style={{ marginTop: space.xxl, gap: space.sm }}>
      <ThemedText variant="headline">{title}</ThemedText>
      <ThemedText variant="subhead" tone="ink2">
        {body}
      </ThemedText>
      <Button title={confirm} kind="destructive" onPress={onConfirm} testID={`${testID}-yes`} />
      <Button title="Cancel" kind="plain" onPress={onCancel} testID={`${testID}-no`} />
    </View>
  );
}

export function permissionLabel(permission: NotificationPermission | null): string {
  switch (permission) {
    case 'granted':
      return 'On';
    case 'denied':
      return 'Off';
    case 'undetermined':
      return 'Not yet';
    case 'unavailable':
      return 'Need the installed app';
    default:
      return 'Checking…';
  }
}

/**
 * Android Settings from the r50 phone preview: This Branch, Your assistant, On this phone,
 * Voice. Regular shows the essentials; Advanced adds the fine controls. Every row is a real
 * control or is shown disabled with its reason — never “coming soon” or “later update”.
 */
export function SettingsScreen({
  state,
  permission,
  identity = appIdentity(),
  computerTitle,
  onThisPhone,
  onOpenSettings,
  onTurnOnNotifications,
  onConnectAnother,
  onForget,
  onSetupTalk,
  onAskHelp,
  onBack,
  onLevel,
  updateCard,
  level: pinnedLevel,
  bottomExtra = 0,
  backTo = 'Chats',
  store,
  prefs: pinnedPrefs,
}: {
  state: Extract<PairingState, { step: 'paired' }>;
  permission: NotificationPermission | null;
  identity?: AppIdentity;
  computerTitle?: string;
  onThisPhone: () => void;
  onOpenSettings: () => void;
  onTurnOnNotifications?: () => void;
  onConnectAnother?: () => void;
  onForget?: () => void;
  onSetupTalk?: () => void;
  onAskHelp?: () => void;
  onBack: () => void;
  onLevel?: (next: SettingsLevel) => void;
  updateCard?: ReactNode;
  level?: SettingsLevel;
  bottomExtra?: number;
  backTo?: 'Chats' | 'More';
  store?: KeyValueStore;
  prefs?: PhonePrefs;
}) {
  const { color, space, radius, layout } = useTheme();
  const { preference, setPreference, lookId, setLookId } = useThemePreference();
  const [page, setPage] = useState<Page>('main');
  const [level, setLevel] = useState<SettingsLevel>(pinnedLevel ?? 0);
  const [prefs, setPrefs] = useState<PhonePrefs>(pinnedPrefs ?? PHONE_PREFS_DEFAULT);
  const [played, setPlayed] = useState(false);
  const [forgetAsk, setForgetAsk] = useState(false);
  const [resetAsk, setResetAsk] = useState(false);
  const [language, setLanguage] = useState('Same as this phone');
  const chooseLevel = (next: SettingsLevel) => {
    setLevel(next);
    onLevel?.(next);
  };
  const host = gatewayHost(state.url);
  const connected = state.online ? 'Connected' : 'Reconnecting';
  const status = permissionLabel(permission);
  const canAsk = permission === 'undetermined' && onTurnOnNotifications;
  const helpPage = HELP_PAGES.find((item) => page === `help-${item.id}`);
  const branchTitle = computerTitle || host;
  const advanced = showsAt(level, 1);

  const setPref = (next: PhonePrefs) => {
    setPrefs(next);
    if (store && !pinnedPrefs) void writePhonePrefs(store, next);
  };

  useEffect(() => {
    if (pinnedLevel !== undefined) setLevel(pinnedLevel);
  }, [pinnedLevel]);

  useEffect(() => {
    if (pinnedPrefs) {
      setPrefs(pinnedPrefs);
      return;
    }
    if (!store) return;
    let live = true;
    void readPhonePrefs(store).then((saved) => {
      if (live) setPrefs(saved);
    });
    return () => {
      live = false;
    };
  }, [store, pinnedPrefs]);

  useEffect(() => {
    if (page === 'main') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page.startsWith('help-') && page !== 'help') setPage('help');
      else if (page === 'checks' || page === 'connection') setPage('this-branch');
      else setPage('main');
      return true;
    });
    return () => sub.remove();
  }, [page]);

  if (page === 'language') {
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-language-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Language
        </ThemedText>
        <Group testID="language-card">
          {LANGUAGE_OPTIONS.map((option, index) => {
            const selected = option.value === language;
            const last = index === LANGUAGE_OPTIONS.length - 1;
            return (
              <View key={option.value}>
                <Pressable
                  testID={`language-${option.value}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !option.enabled }}
                  accessibilityLabel={option.value}
                  disabled={!option.enabled}
                  onPress={() => setLanguage(option.value)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: layout.rowMinHeight,
                    paddingHorizontal: 14,
                    opacity: option.enabled ? (pressed ? 0.6 : 1) : 0.45,
                  })}
                >
                  <ThemedText variant="settingsBody" style={{ flex: 1 }}>
                    {option.value}
                  </ThemedText>
                  {selected ? (
                    <ThemedText variant="settingsBody" testID="language-selected">
                      ✓
                    </ThemedText>
                  ) : null}
                </Pressable>
                <Hairline last={last} />
              </View>
            );
          })}
        </Group>
        <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md, marginHorizontal: space.sm }}>
          Changes the app’s words at once.
        </ThemedText>
      </Screen>
    );
  }

  if (page === 'themes') {
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-themes-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Theme
        </ThemedText>
        <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md }}>
          Pick on the phone and every surface changes: the window, the terminal and keepoak.com.
        </ThemedText>
        <Group testID="themes-card">
          {DESKTOP_THEMES.map((theme, index) => {
            const selected = lookId === theme.id;
            const last = index === DESKTOP_THEMES.length - 1;
            return (
              <View key={theme.id}>
                <Pressable
                  testID={`desktop-theme-${theme.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={theme.name}
                  onPress={() => setLookId(theme.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: layout.rowMinHeight,
                    paddingHorizontal: 14,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <ThemedText variant="settingsBody" style={{ flex: 1 }}>
                    {theme.name}
                  </ThemedText>
                  {selected ? (
                    <ThemedText variant="settingsBody" testID="desktop-theme-selected">
                      ✓
                    </ThemedText>
                  ) : null}
                </Pressable>
                <Hairline last={last} />
              </View>
            );
          })}
        </Group>
      </Screen>
    );
  }

  if (page === 'help' || helpPage) {
    const topic = helpPage;
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow
          label={topic ? 'Help' : 'Settings'}
          onPress={() => setPage(topic ? 'help' : 'main')}
          testID={topic ? 'settings-help-page-back' : 'settings-help-back'}
        />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          {topic ? topic.title : 'Help'}
        </ThemedText>
        {topic ? (
          <View testID={`help-page-${topic.id}`} style={{ marginTop: space.xl, gap: space.md }}>
            {topic.paragraphs.map((paragraph) => (
              <ThemedText key={paragraph} variant="settingsBody" tone="ink2">
                {paragraph}
              </ThemedText>
            ))}
          </View>
        ) : (
          <>
            <Group testID="help-card">
              {HELP_PAGES.map((item, index) => (
                <GoRow
                  key={item.id}
                  title={item.title}
                  testID={`help-${item.id}`}
                  onPress={() => setPage(`help-${item.id}`)}
                  last={index === HELP_PAGES.length - 1}
                />
              ))}
            </Group>
            {onAskHelp ? (
              <View style={{ marginTop: space.xl }}>
                <Button title="Ask a Trunk" kind="inkSecondary" onPress={onAskHelp} testID="settings-ask-help" />
              </View>
            ) : null}
          </>
        )}
      </Screen>
    );
  }

  if (page === 'about') {
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-about-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          About
        </ThemedText>
        <Group testID="about-card">
          <ThemedText variant="headline" style={{ paddingHorizontal: 14, paddingTop: space.md }}>
            About
          </ThemedText>
          <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs, paddingHorizontal: 14 }}>
            Your Trunks and Branch Agent, in your pocket.
          </ThemedText>
          <Row label="Branch Agent" value={state.serverVersion ?? 'Checking…'} />
          <Row label="This app" value={versionLine(identity)} />
          <Row label="By" value="KeepOak" last />
        </Group>
        <Group testID="app-card">
          <Row label="Version" value={identity.version} />
          <Row label="Build" value={identity.build ?? '—'} last />
        </Group>
        <Group testID="updates-card">
          <View style={{ paddingHorizontal: 14, paddingTop: space.md, paddingBottom: space.md }}>
            {updateCard}
            <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md }} testID="apk-update-help">
              {APK_UPDATE_HELP}
            </ThemedText>
          </View>
        </Group>
      </Screen>
    );
  }

  if (page === 'accounts' || page === 'chatapps' || page === 'models' || page === 'skills') {
    const copy =
      page === 'accounts'
        ? { title: 'Accounts', testID: 'accounts-card', body: 'Add accounts on the computer: Settings › Accounts.' }
        : page === 'chatapps'
          ? { title: 'Chat apps', testID: 'chatapps-card', body: CHAT_APPS_HELP }
          : page === 'models'
            ? { title: 'Models on this computer', testID: 'models-card', body: MODELS_HELP }
            : { title: 'Skills', testID: 'skills-card', body: SKILLS_HELP };
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID={`settings-${page}-back`} />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          {copy.title}
        </ThemedText>
        <Group testID={copy.testID}>
          <ThemedText variant="footnote" tone="ink3" style={{ paddingHorizontal: 14, paddingVertical: space.md }}>
            {copy.body}
          </ThemedText>
        </Group>
      </Screen>
    );
  }

  if (page === 'notif') {
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-notif-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Notifications
        </ThemedText>
        <View testID="settings-notifications">
          <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.md }}>
            Approvals, finished replies, mentions and updates can reach you on the lock screen when they are on.
          </ThemedText>
          <Group>
            <Row label="Status" value={status} testID="settings-notifications-status" last={permission === 'unavailable'} />
            {permission === 'unavailable' ? (
              <ThemedText testID="settings-notifications-unavailable" variant="footnote" tone="ink2" style={{ margin: space.md }}>
                Notifications need the installed Branch Agent app. Approvals still show up in the app.
              </ThemedText>
            ) : (
              <View style={{ margin: space.md, gap: space.sm }}>
                {canAsk ? (
                  <Button title="Turn on notifications" kind="ink" onPress={onTurnOnNotifications} testID="settings-notifications-turn-on" />
                ) : null}
                <Button
                  title="Open Settings"
                  kind={canAsk ? 'inkSecondary' : 'ink'}
                  onPress={onOpenSettings}
                  testID="notifications-system-settings"
                />
              </View>
            )}
          </Group>
        </View>
        <Group testID="notif-kinds">
          {NOTIF_KINDS.map((kind, index) => (
            <SwitchRow
              key={kind}
              title={kind}
              detail=""
              on={Boolean(prefs.notifKinds[index])}
              onPress={() => {
                const kinds = [...prefs.notifKinds];
                kinds[index] = !kinds[index];
                setPref({ ...prefs, notifKinds: kinds });
              }}
              testID={`notif-kind-${index}`}
              last={index === NOTIF_KINDS.length - 1}
            />
          ))}
        </Group>
        <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md, marginHorizontal: space.sm }}>
          Answers work right on the notification: Send it, Don’t send, or Reply.
        </ThemedText>
      </Screen>
    );
  }

  if (page === 'this-branch') {
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-thisbranch-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          This Branch
        </ThemedText>
        <Group testID="this-branch-page">
          <View
            testID="this-branch-status"
            accessibilityRole="text"
            accessibilityLabel={`${branchTitle}, ${connected}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: layout.rowMinHeight,
              paddingHorizontal: 14,
              gap: space.sm,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: radius.pill,
                backgroundColor: state.online ? color.ink : color.ink3,
              }}
            />
            <View style={{ flex: 1 }}>
              <ThemedText variant="headline">{branchTitle}</ThemedText>
              <ThemedText variant="footnote" tone="ink3">
                {state.online ? 'Connected to your computer' : 'Reconnecting to your computer…'}
              </ThemedText>
            </View>
          </View>
          <Hairline last={false} />
          <Row label="Computer" value={host} />
          <Row label="Branch Agent" value={state.serverVersion ?? 'Checking…'} last />
        </Group>
        <Group>
          <GoRow title="This phone" testID="this-phone" accessibilityLabel={`This phone, ${host}, ${connected}`} onPress={onThisPhone} last />
        </Group>
        {advanced ? (
          <>
            <Group title="Advanced" testID="this-branch-advanced">
              <SwitchRow
                title="Connect when Branch Agent opens"
                detail={`Reconnects to ${host} each time you open the app.`}
                on={prefs.autoConn}
                onPress={() => setPref({ ...prefs, autoConn: !prefs.autoConn })}
                testID="settings-auto-conn"
              />
              <Row label="Access" value="Full" />
              <GoRow title="Check the connection" value="Not run" testID="settings-checks" onPress={() => setPage('checks')} />
              <GoRow title="Connection details" testID="settings-connection" onPress={() => setPage('connection')} last />
            </Group>
          </>
        ) : null}
      </Screen>
    );
  }

  if (page === 'checks') {
    const link = state.online ? 'Connected' : 'Not checked';
    const voice = state.online ? 'Ready' : 'Not checked';
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="This Branch" onPress={() => setPage('this-branch')} testID="settings-checks-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Checks
        </ThemedText>
        <Group testID="checks-card">
          <Row label={`Link to ${host}`} value={link} />
          <Row label="Finding Branch Agent nearby" value="Not checked" />
          <Row label="Voice set-up" value={voice} />
          <Row label="Notifications" value={status} />
          <Row label="Screen sharing" value="idle" />
          <Row label="Wake word" value={prefs.wake ? 'on' : 'off'} last />
        </Group>
        <Group title="This phone">
          <Row label="App version" value={identity.version} last />
        </Group>
      </Screen>
    );
  }

  if (page === 'connection') {
    const url = (() => {
      try {
        return new URL(state.url.replace(/^ws/i, 'http'));
      } catch {
        return null;
      }
    })();
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="This Branch" onPress={() => setPage('this-branch')} testID="settings-connection-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Connection details
        </ThemedText>
        <Group testID="connection-card">
          <Row label="Address" value={url?.hostname || host} />
          <Row label="Port" value={url?.port || '—'} />
          <Row label="Connection" value={state.url.startsWith('wss') ? 'Secure' : 'On your network'} last />
        </Group>
      </Screen>
    );
  }

  if (page === 'lend') {
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-lend-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Lend this phone
        </ThemedText>
        <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md }}>
          {prefs.lendOn
            ? 'Branch Agent can ask this phone for the things switched on below. Each use shows here and on the lock screen.'
            : 'This phone isn’t lent. Branch Agent can still message you here.'}
        </ThemedText>
        <Group testID="lend-card">
          {LEND_ABILITIES.map((row, index) => (
            <CycleRow
              key={row.id}
              title={row.label}
              detail={row.detail}
              value={prefs.lendOn && prefs.lend[row.id] ? 'on' : 'off'}
              onPress={() => {
                if (!prefs.lendOn) return;
                setPref({ ...prefs, lend: { ...prefs.lend, [row.id]: !prefs.lend[row.id] } });
              }}
              testID={`lend-${row.id}`}
              last={index === LEND_ABILITIES.length - 1}
            />
          ))}
        </Group>
        <Group>
          <GoRow
            title={prefs.lendOn ? 'Stop lending this phone' : 'Lend this phone to Branch Agent'}
            testID="lend-toggle"
            onPress={() => setPref({ ...prefs, lendOn: !prefs.lendOn })}
            last
          />
        </Group>
      </Screen>
    );
  }

  if (page === 'mic') {
    return (
      <Screen testID="settings-screen" bottomExtra={bottomExtra}>
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-mic-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Microphone
        </ThemedText>
        <Group testID="mic-card">
          {MIC_OPTIONS.map((option, index) => {
            const selected = prefs.mic === option;
            const last = index === MIC_OPTIONS.length - 1;
            return (
              <View key={option}>
                <Pressable
                  testID={`mic-${option}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option}
                  onPress={() => setPref({ ...prefs, mic: option })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: layout.rowMinHeight,
                    paddingHorizontal: 14,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <ThemedText variant="settingsBody" style={{ flex: 1 }}>
                    {option}
                  </ThemedText>
                  {selected ? (
                    <ThemedText variant="settingsBody" testID="mic-selected">
                      ✓
                    </ThemedText>
                  ) : null}
                </Pressable>
                <Hairline last={last} />
              </View>
            );
          })}
        </Group>
        <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md, marginHorizontal: space.sm }}>
          Used for the Talk button and live voice.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen testID="settings-screen" bottomExtra={bottomExtra}>
      <BackRow label={backTo} onPress={onBack} testID="settings-back" />
      <ThemedText variant="settingsTitle" accessibilityRole="header">
        Settings
      </ThemedText>

      <View
        testID="settings-level"
        accessibilityRole="radiogroup"
        accessibilityLabel="How much to show"
        style={{
          marginTop: space.xl,
          flexDirection: 'row',
          backgroundColor: color.fill,
          borderRadius: radius.md,
          borderWidth: layout.hairline,
          borderColor: color.line,
          padding: space.xs,
          gap: space.xs,
        }}
      >
        {SETTINGS_LEVELS.map((option) => {
          const on = level === option.v;
          return (
            <Pressable
              key={option.label}
              testID={`settings-level-${option.label.toLowerCase()}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={option.label}
              onPress={() => chooseLevel(option.v)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: layout.rowMinHeight,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm,
                backgroundColor: on ? color.ink : 'transparent',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <ThemedText variant="subhead" style={{ fontWeight: on ? '600' : '400', color: on ? color.raise : color.ink }}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.sm, marginHorizontal: space.sm }}>
        {SETTINGS_LEVELS[level]?.line}
      </ThemedText>

      <Group testID="keepoak-card">
        <View
          testID="later-keepoak"
          accessibilityRole="text"
          accessibilityLabel={`${KEEPOAK_SIGN_IN}. ${KEEPOAK_SIGN_IN_REASON}`}
          style={{ minHeight: layout.rowMinHeight, paddingHorizontal: 14, paddingVertical: space.sm, justifyContent: 'center', opacity: 0.45 }}
        >
          <ThemedText variant="settingsBody">{KEEPOAK_SIGN_IN}</ThemedText>
          <ThemedText variant="footnote" tone="ink3" testID="later-keepoak-reason">
            {KEEPOAK_SIGN_IN_REASON}
          </ThemedText>
        </View>
      </Group>

      <Group title="This Branch" testID="this-branch">
        <Pressable
          testID="this-branch-row"
          accessibilityRole="button"
          accessibilityLabel={`${branchTitle}, ${connected}`}
          onPress={() => setPage('this-branch')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: layout.rowMinHeight,
            paddingHorizontal: 14,
            gap: space.sm,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: radius.pill,
              backgroundColor: state.online ? color.ink : color.ink3,
            }}
          />
          <View style={{ flex: 1 }}>
            <ThemedText variant="headline">{branchTitle}</ThemedText>
            <ThemedText variant="footnote" tone="ink3">
              {state.online ? 'Connected to your computer' : 'Reconnecting to your computer…'}
            </ThemedText>
          </View>
          {state.online ? (
            <ThemedText variant="settingsBody" tone="ink2">
              ●
            </ThemedText>
          ) : (
            <ThemedText variant="subhead" tone="ink2">
              {connected}
            </ThemedText>
          )}
          <ThemedText variant="body" tone="ink3">
            ›
          </ThemedText>
        </Pressable>
        <Hairline last={false} />
        <GoRow
          title="Connect another Branch"
          testID="settings-connect-another"
          onPress={() => onConnectAnother?.()}
          last
        />
      </Group>

      <Group testID="setup-talk-card">
        <GoRow
          title="Set up and fix by talking"
          detail="Talk it through with a Trunk."
          testID="settings-setup-talk"
          onPress={() => onSetupTalk?.()}
          last
        />
      </Group>

      <Group title="Your assistant" testID="assistant-card">
        <GoRow title="Accounts" testID="settings-accounts" onPress={() => setPage('accounts')} />
        <GoRow title="Theme" value={desktopThemeName(lookId)} testID="settings-themes" onPress={() => setPage('themes')} />
        <GoRow title="Language" value={language} testID="settings-language" onPress={() => setPage('language')} />
        <View
          style={{
            minHeight: layout.rowMinHeight,
            paddingHorizontal: 14,
            paddingVertical: space.sm,
          }}
        >
          <ThemedText variant="settingsBody">Text size</ThemedText>
          <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.xxs, marginBottom: space.sm }}>
            Only on this phone. The system’s own text size still applies on top.
          </ThemedText>
          <View
            testID="text-size"
            accessibilityRole="radiogroup"
            accessibilityLabel="Text size"
            style={{ flexDirection: 'row', backgroundColor: color.fill, borderRadius: radius.md, padding: space.xs, gap: space.xs }}
          >
            {TEXT_SIZES.map((size) => {
              const on = prefs.textSize === size;
              return (
                <Pressable
                  key={size}
                  testID={`text-size-${size}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={size}
                  onPress={() => setPref({ ...prefs, textSize: size })}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: layout.rowMinHeight,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.sm,
                    backgroundColor: on ? color.ink : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <ThemedText variant="caption1" style={{ fontWeight: on ? '600' : '400', color: on ? color.raise : color.ink }}>
                    {size}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <GoRow
          title="Notifications"
          value={notifKindsValue(prefs)}
          testID="settings-notif"
          onPress={() => setPage('notif')}
          last
        />
      </Group>

      <Group title="Connections" testID="connections-card">
        <GoRow title="Chat apps" testID="settings-chatapps" onPress={() => setPage('chatapps')} />
        <GoRow title="Models on this computer" testID="settings-models" onPress={() => setPage('models')} />
        <GoRow title="Skills" testID="settings-skills" onPress={() => setPage('skills')} last />
      </Group>

      <Group testID="appearance-card">
        <View style={{ paddingHorizontal: 14, paddingTop: space.md, paddingBottom: space.sm }}>
          <ThemedText variant="settingsBody">Light or dark</ThemedText>
          <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.xxs, marginBottom: space.md }}>
            Match this phone follows the phone. Light and Dark stay on this phone.
          </ThemedText>
          <View
            testID="theme-picker"
            accessibilityRole="radiogroup"
            accessibilityLabel="Light or dark"
            style={{
              flexDirection: 'row',
              backgroundColor: color.fill,
              borderRadius: radius.md,
              padding: space.xs,
              gap: space.xs,
            }}
          >
            {THEME_OPTIONS.map((option) => {
              const on = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  testID={`theme-${option.value}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={option.label}
                  onPress={() => setPreference(option.value)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: layout.rowMinHeight,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.sm,
                    backgroundColor: on ? color.ink : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <ThemedText variant="subhead" style={{ fontWeight: on ? '600' : '400', color: on ? color.raise : color.ink }}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Group>

      <Group title="On this phone" testID="on-phone-card">
        <CycleRow
          title="Lock with fingerprint"
          detail="Ask before showing Branch Agent. When needed: only after five minutes away."
          value={prefs.lock}
          onPress={() => setPref({ ...prefs, lock: nextCycle(prefs.lock) })}
          testID="settings-lock"
        />
        <CycleRow
          title="Tell me when a task needs me"
          detail="Checks your Branch Agent for questions."
          value={prefs.tellMe}
          onPress={() => setPref({ ...prefs, tellMe: nextCycle(prefs.tellMe) })}
          testID="settings-tell-me"
        />
        <CycleRow
          title="Send to Branch Agent from other apps"
          detail="Puts Branch Agent in the share sheet."
          value={prefs.share}
          onPress={() => setPref({ ...prefs, share: nextCycle(prefs.share) })}
          testID="settings-share"
        />
        <CycleRow
          title="Alerts while the app is closed"
          detail="Needs a store account first."
          value={prefs.push}
          onPress={() => setPref({ ...prefs, push: nextCycle(prefs.push) })}
          testID="settings-push"
        />
        <SwitchRow
          title="Keep the screen awake"
          detail="Keeps the screen on while Branch Agent is open and a Trunk is working."
          on={prefs.awake}
          onPress={() => setPref({ ...prefs, awake: !prefs.awake })}
          testID="settings-awake"
          last={!advanced}
        />
        {advanced ? (
          <>
            <GoRow title="Microphone" value={prefs.mic} testID="settings-mic" onPress={() => setPage('mic')} />
            <GoRow
              title="Use as the phone’s assistant"
              detail={ASSISTANT_REASON}
              testID="settings-assistant"
              onPress={onOpenSettings}
            />
          </>
        ) : null}
        <GoRow
          title="Lend this phone to Branch Agent"
          detail={lendSummary(prefs)}
          testID="later-lend"
          onPress={() => setPage('lend')}
          last
        />
      </Group>

      <Group title="This phone, more" testID="phone-more-card">
        <SwitchRow
          title="Vibrate on taps"
          detail="A light buzz when you send, allow or switch."
          on={prefs.haptics}
          onPress={() => setPref({ ...prefs, haptics: !prefs.haptics })}
          testID="settings-haptics"
        />
        <View
          testID="settings-run-on-phone"
          accessibilityRole="text"
          accessibilityLabel={`${RUN_ON_PHONE}. ${RUN_ON_PHONE_REASON}`}
          style={{
            minHeight: layout.rowMinHeight,
            paddingHorizontal: 14,
            paddingVertical: space.sm,
            justifyContent: 'center',
            opacity: 0.45,
          }}
        >
          <ThemedText variant="settingsBody">{RUN_ON_PHONE}</ThemedText>
          <ThemedText variant="footnote" tone="ink3" testID="settings-run-on-phone-reason">
            {RUN_ON_PHONE_REASON}
          </ThemedText>
        </View>
      </Group>

      <Group title="Voice" testID="voice-card">
        <CycleRow
          title="Talk button"
          detail="Shows the button that turns what you say into a message."
          value={prefs.talk}
          onPress={() => setPref({ ...prefs, talk: nextCycle(prefs.talk) })}
          testID="settings-talk"
        />
        <SwitchRow
          title="Listen for the wake word"
          detail="Heard on this phone, only while Branch Agent is open."
          extra={prefs.wake ? 'Listening' : undefined}
          on={prefs.wake}
          onPress={() => setPref({ ...prefs, wake: !prefs.wake })}
          testID="settings-wake"
        />
        {prefs.wake ? <Row label="Wake words" value={WAKE_WORDS_DEFAULT} /> : null}
        {advanced ? (
          <SwitchRow
            title="Keep talking in the background"
            detail="Off until you choose: the microphone stays on while you use other apps."
            on={prefs.talkBg}
            onPress={() => setPref({ ...prefs, talkBg: !prefs.talkBg })}
            testID="settings-talk-bg"
          />
        ) : null}
        <SwitchRow
          title="Use speakerphone"
          detail="Plays the Trunk’s voice from the loudspeaker, not the earpiece."
          on={prefs.speaker}
          onPress={() => setPref({ ...prefs, speaker: !prefs.speaker })}
          testID="settings-speaker"
        />
        <View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: layout.rowMinHeight,
              paddingHorizontal: 14,
              paddingVertical: space.sm,
              gap: space.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <ThemedText variant="settingsBody">Test sound</ThemedText>
              <ThemedText variant="footnote" tone="ink3">
                Check that Branch Agent speaks clearly on this phone.
              </ThemedText>
              {played ? (
                <ThemedText variant="footnote" tone="ink2" testID="settings-test-sound-played">
                  Played on this phone.
                </ThemedText>
              ) : null}
            </View>
            <Pressable
              testID="settings-test-sound"
              accessibilityRole="button"
              accessibilityLabel="Play"
              onPress={() => setPlayed(true)}
              style={({ pressed }) => ({
                minHeight: layout.rowMinHeight,
                justifyContent: 'center',
                paddingHorizontal: space.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <ThemedText variant="subhead">Play</ThemedText>
            </Pressable>
          </View>
          <Hairline last={!advanced} />
        </View>
        {advanced ? (
          <>
            <Row label="Push to talk from Branch Agent" value="Allowed" />
            <Row label="Live talk" value={state.online ? 'Ready' : 'Not checked'} />
            <Row label="Dictation" value={state.online ? 'Ready' : 'Not checked'} last />
          </>
        ) : null}
      </Group>

      <Group testID="help-entry">
        <GoRow title="Help" testID="settings-help" onPress={() => setPage('help')} last />
      </Group>
      <Group testID="version-entry">
        <GoRow title="Version" value={identity.version} testID="settings-about" onPress={() => setPage('about')} last />
      </Group>

      {forgetAsk ? (
        <ConfirmCard
          title="Forget this Branch Agent?"
          body={`This phone stops reaching ${host}, and ${host} takes it off its list of devices. Pair again with a new code.`}
          confirm="Forget"
          onConfirm={() => onForget?.()}
          onCancel={() => setForgetAsk(false)}
          testID="forget-ask"
        />
      ) : (
        <Group testID="forget-card">
          <GoRow title="Forget this Branch Agent" testID="settings-forget" onPress={() => setForgetAsk(true)} last />
        </Group>
      )}

      {advanced ? (
        resetAsk ? (
          <ConfirmCard
            title="Reset this app?"
            body="This disconnects, removes every saved Branch Agent, key, offline chat and waiting message from this phone, and opens setup again. Nothing is deleted on your computers."
            confirm="Reset"
            onConfirm={() => {
              setPref({ ...PHONE_PREFS_DEFAULT, notifKinds: [...PHONE_PREFS_DEFAULT.notifKinds], lend: { ...PHONE_PREFS_DEFAULT.lend } });
              setResetAsk(false);
              onForget?.();
            }}
            onCancel={() => setResetAsk(false)}
            testID="reset-ask"
          />
        ) : (
          <Group testID="reset-card">
            <GoRow title="Reset this app" testID="settings-reset" onPress={() => setResetAsk(true)} last />
          </Group>
        )
      ) : null}
    </Screen>
  );
}
