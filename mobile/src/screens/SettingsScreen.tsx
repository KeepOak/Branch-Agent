import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import type { NotificationPermission } from '../approvals/approvalAlerts';
import { appIdentity, versionLine, type AppIdentity } from '../build/appIdentity';
import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import { DESKTOP_THEMES, desktopThemeName } from '../theme/desktopThemes';
import { ThemedText } from '../theme/ThemedText';
import { useTheme, useThemePreference } from '../theme/ThemeProvider';
import { THEME_OPTIONS } from '../theme/preference';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import {
  APK_UPDATE_HELP,
  HELP_PAGES,
  LANGUAGE_OPTIONS,
  LATER_ROWS,
  SETTINGS_GROUPS,
  SETTINGS_LEVELS,
  laterRowsAt,
  laterUpdate,
  type LaterRow,
  type SettingsGroup,
  type SettingsLevel,
} from './settingsExtras';

export { LATER_ROWS, SETTINGS_GROUPS };

type Page = 'main' | 'help' | 'language' | 'themes' | `help-${string}`;

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

function LaterRowView({ row, last = false }: { row: LaterRow; last?: boolean }) {
  const { layout, space } = useTheme();
  const reason = laterUpdate(row.label);
  return (
    <View>
      <View
        testID={row.testID}
        accessibilityRole="text"
        accessibilityLabel={reason}
        style={{
          minHeight: layout.rowMinHeight,
          paddingHorizontal: 14,
          paddingVertical: space.sm,
          justifyContent: 'center',
        }}
      >
        <ThemedText variant="settingsBody">{row.label}</ThemedText>
        <ThemedText variant="footnote" tone="ink3" testID={`${row.testID}-reason`}>
          {reason}
        </ThemedText>
      </View>
      <Hairline last={last} />
    </View>
  );
}

function LaterRows({ group, level }: { group: SettingsGroup; level: SettingsLevel }) {
  const rows = laterRowsAt(level, group);
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((row, index) => (
        <LaterRowView key={row.testID} row={row} last={index === rows.length - 1} />
      ))}
    </>
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

/** Android Settings: desktop Regular groups plus Appearance. Working controls stay; unfinished rows wait for Advanced. */
export function SettingsScreen({
  state,
  permission,
  identity = appIdentity(),
  onThisPhone,
  onOpenSettings,
  onTurnOnNotifications,
  onBack,
  updateCard,
  level: pinnedLevel,
}: {
  state: Extract<PairingState, { step: 'paired' }>;
  permission: NotificationPermission | null;
  identity?: AppIdentity;
  onThisPhone: () => void;
  onOpenSettings: () => void;
  onTurnOnNotifications?: () => void;
  onBack: () => void;
  updateCard?: ReactNode;
  level?: SettingsLevel;
}) {
  const { color, space, radius, layout } = useTheme();
  const { preference, setPreference, lookId, setLookId } = useThemePreference();
  const [page, setPage] = useState<Page>('main');
  const [level, setLevel] = useState<SettingsLevel>(pinnedLevel ?? 0);
  const host = gatewayHost(state.url);
  const connected = state.online ? 'Connected' : 'Reconnecting';
  const status = permissionLabel(permission);
  const canAsk = permission === 'undetermined' && onTurnOnNotifications;
  const helpPage = HELP_PAGES.find((item) => page === `help-${item.id}`);

  useEffect(() => {
    if (pinnedLevel !== undefined) setLevel(pinnedLevel);
  }, [pinnedLevel]);

  useEffect(() => {
    if (page === 'main') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPage(page.startsWith('help-') && page !== 'help' ? 'help' : 'main');
      return true;
    });
    return () => sub.remove();
  }, [page]);

  if (page === 'language') {
    return (
      <Screen testID="settings-screen">
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-language-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Language
        </ThemedText>
        <Group testID="language-card">
          {LANGUAGE_OPTIONS.map((option, index) => {
            const selected = option.value === 'Same as this phone';
            const last = index === LANGUAGE_OPTIONS.length - 1;
            return (
              <View key={option.value}>
                <View
                  testID={`language-${option.value}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !option.enabled }}
                  accessibilityLabel={option.value}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: layout.rowMinHeight,
                    paddingHorizontal: 14,
                    opacity: option.enabled ? 1 : 0.45,
                  }}
                >
                  <ThemedText variant="settingsBody" style={{ flex: 1 }}>
                    {option.value}
                  </ThemedText>
                  {selected ? (
                    <ThemedText variant="settingsBody" testID="language-selected">
                      ✓
                    </ThemedText>
                  ) : null}
                </View>
                <Hairline last={last} />
              </View>
            );
          })}
        </Group>
      </Screen>
    );
  }

  if (page === 'themes') {
    return (
      <Screen testID="settings-screen">
        <BackRow label="Settings" onPress={() => setPage('main')} testID="settings-themes-back" />
        <ThemedText variant="settingsTitle" accessibilityRole="header">
          Theme
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
      <Screen testID="settings-screen">
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
        )}
      </Screen>
    );
  }

  const generalLater = laterRowsAt(level, 'General');
  const computerLater = laterRowsAt(level, 'Computer');
  const usageLater = laterRowsAt(level, 'Usage');
  const updatesLater = laterRowsAt(level, 'Updates');
  const appearanceLater = laterRowsAt(level, 'Appearance');

  return (
    <Screen testID="settings-screen">
      <BackRow label="Chats" onPress={onBack} testID="settings-back" />
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
              onPress={() => setLevel(option.v)}
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

      <Group title="General" testID="general-card">
        <View testID="app-card">
          <Row label="Version" value={identity.version} />
          <Row label="Build" value={identity.build ?? '—'} />
        </View>
        <View testID="settings-notifications">
          <ThemedText variant="headline" style={{ paddingHorizontal: 14, paddingTop: space.md }}>
            Notifications
          </ThemedText>
          <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs, paddingHorizontal: 14 }}>
            Approvals can reach you on the lock screen when they are on.
          </ThemedText>
          <Row label="Status" value={status} testID="settings-notifications-status" last={permission === 'unavailable'} />
          {permission === 'unavailable' ? (
            <ThemedText testID="settings-notifications-unavailable" variant="footnote" tone="ink2" style={{ margin: space.md }}>
              Notifications need the installed Branch app. Approvals still show up in the app.
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
        </View>
        <Hairline last={false} />
        <View testID="about-card">
          <ThemedText variant="headline" style={{ paddingHorizontal: 14, paddingTop: space.md }}>
            About
          </ThemedText>
          <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs, paddingHorizontal: 14 }}>
            Your Trunks and Branch Agent, in your pocket.
          </ThemedText>
          <Row label="This app" value={versionLine(identity)} />
          <Row label="By" value="KeepOak" />
        </View>
        <GoRow title="Help" testID="settings-help" onPress={() => setPage('help')} last={generalLater.length === 0} />
        <LaterRows group="General" level={level} />
      </Group>

      <Group title="Computer" testID="computer-card">
        <View
          testID="this-branch"
          accessibilityRole="text"
          accessibilityLabel={`This Branch, ${host}, ${connected}`}
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
            <ThemedText variant="headline">This Branch</ThemedText>
            <ThemedText variant="footnote" tone="ink3">
              {state.online ? 'Connected to your computer' : 'Reconnecting to your computer…'}
            </ThemedText>
          </View>
        </View>
        <Hairline last={false} />
        <Row label="Computer" value={host} />
        <Row label="Branch" value={state.serverVersion ?? 'Checking…'} />
        <GoRow
          title="This phone"
          testID="this-phone"
          accessibilityLabel={`This phone, ${host}, ${connected}`}
          onPress={onThisPhone}
          last={computerLater.length === 0}
        />
        <LaterRows group="Computer" level={level} />
      </Group>

      <Group title="Usage" testID="usage-card">
        {usageLater.length === 0 ? (
          <ThemedText variant="footnote" tone="ink3" style={{ paddingHorizontal: 14, paddingVertical: space.md }}>
            Accounts, models and sign-ins live on the paired computer.
          </ThemedText>
        ) : (
          <LaterRows group="Usage" level={level} />
        )}
      </Group>

      <Group title="Updates" testID="updates-card">
        <View style={{ paddingHorizontal: 14, paddingTop: space.md, paddingBottom: space.sm }}>
          {updateCard}
          <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md }} testID="apk-update-help">
            {APK_UPDATE_HELP}
          </ThemedText>
        </View>
        {updatesLater.length > 0 ? <Hairline last={false} /> : null}
        <LaterRows group="Updates" level={level} />
      </Group>

      <Group title="Appearance" testID="appearance-card">
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
        <Hairline last={false} />
        <GoRow title="Theme" value={desktopThemeName(lookId)} testID="settings-themes" onPress={() => setPage('themes')} />
        <GoRow
          title="Language"
          value="Same as this phone"
          testID="settings-language"
          onPress={() => setPage('language')}
          last={appearanceLater.length === 0}
        />
        <LaterRows group="Appearance" level={level} />
      </Group>
    </Screen>
  );
}
