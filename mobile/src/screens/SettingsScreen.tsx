import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import type { NotificationPermission } from '../approvals/approvalAlerts';
import { appIdentity, versionLine, type AppIdentity } from '../build/appIdentity';
import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme, useThemePreference } from '../theme/ThemeProvider';
import { THEME_OPTIONS } from '../theme/preference';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import {
  ASSISTANT_EXTRAS,
  HELP_PAGES,
  LANGUAGE_DISABLED_REASON,
  LANGUAGE_OPTIONS,
  ON_PHONE_EXTRAS,
  SETTINGS_EXTRAS,
  TEXT_SIZE_DEFAULT,
  TEXT_SIZE_REASON,
  THIS_BRANCH_EXTRAS,
  VOICE_EXTRAS,
  type SettingsExtra,
} from './settingsExtras';

export { SETTINGS_EXTRAS };

type Page = 'main' | 'help' | 'language' | `help-${string}`;

function Group({
  title,
  testID,
  children,
}: {
  title?: string;
  testID?: string;
  children: ReactNode;
}) {
  const { color, space, radius } = useTheme();
  return (
    <View testID={testID} style={{ marginTop: space.xxl }}>
      {title ? (
        <ThemedText
          variant="caption1"
          tone="ink3"
          style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.sm, marginLeft: space.sm }}
        >
          {title}
        </ThemedText>
      ) : null}
      <View style={{ backgroundColor: color.raise, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, overflow: 'hidden' }}>
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
        <ThemedText variant="body">{label}</ThemedText>
        <ThemedText variant="body" tone="ink2" testID={testID} style={{ flexShrink: 1, textAlign: 'right' }}>
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
  destructive = false,
  accessibilityLabel,
}: {
  title: string;
  value?: string;
  detail?: string;
  onPress: () => void;
  testID: string;
  last?: boolean;
  destructive?: boolean;
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
          <ThemedText variant="body" tone={destructive ? 'bad' : 'ink'}>
            {title}
          </ThemedText>
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

/** Extra preview rows: shown, Off, and disabled with the reason they do not work yet. */
function ExtraRow({ extra, last = false }: { extra: SettingsExtra; last?: boolean }) {
  const { color, layout, space, radius } = useTheme();
  return (
    <View>
      <View
        testID={extra.testID}
        accessibilityRole="text"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={`${extra.title}, Off. ${extra.reason}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: layout.rowMinHeight,
          paddingHorizontal: 14,
          paddingVertical: space.sm,
          gap: space.md,
          opacity: 0.55,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText variant="body">{extra.title}</ThemedText>
          <ThemedText variant="footnote" tone="ink3">
            {extra.detail}
          </ThemedText>
          <ThemedText variant="caption1" tone="ink3" testID={`${extra.testID}-reason`}>
            {extra.reason}
          </ThemedText>
        </View>
        <View
          testID={`${extra.testID}-value`}
          style={{
            width: 44,
            height: 26,
            borderRadius: radius.pill,
            backgroundColor: color.fill,
            borderWidth: 1,
            borderColor: color.line,
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <View style={{ width: 20, height: 20, borderRadius: radius.pill, backgroundColor: color.raise, borderWidth: 1, borderColor: color.line }} />
        </View>
        <ThemedText variant="subhead" tone="ink3">
          Off
        </ThemedText>
      </View>
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
      <ThemedText variant="body">← {label}</ThemedText>
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

/** Android Settings: preview groups, every working control kept, extras Off until they are wired. */
export function SettingsScreen({
  state,
  permission,
  identity = appIdentity(),
  onThisPhone,
  onOpenSettings,
  onTurnOnNotifications,
  onBack,
}: {
  state: Extract<PairingState, { step: 'paired' }>;
  permission: NotificationPermission | null;
  identity?: AppIdentity;
  onThisPhone: () => void;
  onOpenSettings: () => void;
  onTurnOnNotifications?: () => void;
  onBack: () => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const { preference, setPreference } = useThemePreference();
  const [page, setPage] = useState<Page>('main');
  const host = gatewayHost(state.url);
  const connected = state.online ? 'Connected' : 'Reconnecting';
  const status = permissionLabel(permission);
  const canAsk = permission === 'undetermined' && onTurnOnNotifications;
  const helpPage = HELP_PAGES.find((item) => page === `help-${item.id}`);

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
        <ThemedText variant="title2" accessibilityRole="header">
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
                  accessibilityLabel={option.enabled ? option.value : `${option.value}. ${LANGUAGE_DISABLED_REASON}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: layout.rowMinHeight,
                    paddingHorizontal: 14,
                    opacity: option.enabled ? 1 : 0.45,
                  }}
                >
                  <ThemedText variant="body" style={{ flex: 1 }}>
                    {option.value}
                  </ThemedText>
                  {selected ? (
                    <ThemedText variant="body" testID="language-selected">
                      ✓
                    </ThemedText>
                  ) : null}
                </View>
                <Hairline last={last} />
              </View>
            );
          })}
        </Group>
        <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.md, marginHorizontal: space.sm }}>
          {LANGUAGE_DISABLED_REASON}
        </ThemedText>
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
        <ThemedText variant="title2" accessibilityRole="header">
          {topic ? topic.title : 'Help'}
        </ThemedText>
        {topic ? (
          <View testID={`help-page-${topic.id}`} style={{ marginTop: space.xl, gap: space.md }}>
            {topic.paragraphs.map((paragraph) => (
              <ThemedText key={paragraph} variant="body" tone="ink2">
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

  return (
    <Screen testID="settings-screen">
      <BackRow label="Chats" onPress={onBack} testID="settings-back" />
      <ThemedText variant="title2" accessibilityRole="header">
        Settings
      </ThemedText>

      <Group testID="app-card">
        <Row label="Version" value={identity.version} />
        <Row label="Build" value={identity.build ?? '—'} last />
      </Group>

      <Group title="This Branch" testID="computer-card">
        <View
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
          <ThemedText variant="headline" style={{ flex: 1 }}>
            {state.online ? 'Connected to your computer' : 'Reconnecting to your computer…'}
          </ThemedText>
        </View>
        <Hairline last={false} />
        <Row label="Computer" value={host} />
        <Row label="Branch" value={state.serverVersion ?? 'Checking…'} />
        <GoRow
          title="This phone"
          testID="this-phone"
          accessibilityLabel={`This phone, ${host}, ${connected}`}
          onPress={onThisPhone}
        />
        {THIS_BRANCH_EXTRAS.map((extra, index) => (
          <ExtraRow key={extra.testID} extra={extra} last={index === THIS_BRANCH_EXTRAS.length - 1} />
        ))}
      </Group>

      <Group title="Your assistant" testID="appearance-card">
        <View style={{ paddingHorizontal: 14, paddingTop: space.md, paddingBottom: space.sm }}>
          <ThemedText variant="body">Theme</ThemedText>
          <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.xxs, marginBottom: space.md }}>
            System follows this phone. Light and Dark stay on this phone.
          </ThemedText>
          <View
            testID="theme-picker"
            accessibilityRole="radiogroup"
            accessibilityLabel="Theme"
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
        <GoRow title="Language" value="Same as this phone" testID="settings-language" onPress={() => setPage('language')} />
        <View>
          <View style={{ paddingHorizontal: 14, paddingVertical: space.sm }}>
            <ThemedText variant="body">Text size</ThemedText>
            <ThemedText variant="footnote" tone="ink3" style={{ marginTop: space.xxs }}>
              {TEXT_SIZE_REASON}
            </ThemedText>
            <View
              testID="text-size-picker"
              accessibilityRole="radiogroup"
              accessibilityLabel="Text size"
              style={{ flexDirection: 'row', gap: space.xs, marginTop: space.sm }}
            >
              {['90%', '100%', '110%', '125%', '140%'].map((size) => {
                const on = size === TEXT_SIZE_DEFAULT;
                return (
                  <View
                    key={size}
                    testID={`text-size-${size}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: !on }}
                    style={{
                      flex: 1,
                      minHeight: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.sm,
                      backgroundColor: on ? color.ink : color.fill,
                      opacity: on ? 1 : 0.45,
                    }}
                  >
                    <ThemedText variant="caption1" style={{ color: on ? color.raise : color.ink }}>
                      {size}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </View>
          <Hairline last={false} />
        </View>
        {ASSISTANT_EXTRAS.map((extra, index) => (
          <ExtraRow key={extra.testID} extra={extra} last={index === ASSISTANT_EXTRAS.length - 1} />
        ))}
      </Group>

      <Group title="On this phone" testID="settings-notifications">
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
        <Hairline last={false} />
        {ON_PHONE_EXTRAS.map((extra, index) => (
          <ExtraRow key={extra.testID} extra={extra} last={index === ON_PHONE_EXTRAS.length - 1} />
        ))}
      </Group>

      <Group title="Voice" testID="settings-voice">
        {VOICE_EXTRAS.map((extra, index) => (
          <ExtraRow key={extra.testID} extra={extra} last={index === VOICE_EXTRAS.length - 1} />
        ))}
      </Group>

      <Group testID="settings-help-group">
        <GoRow title="Help" testID="settings-help" onPress={() => setPage('help')} last />
      </Group>

      <Group testID="about-card">
        <ThemedText variant="headline" style={{ paddingHorizontal: 14, paddingTop: space.md }}>
          About
        </ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs, paddingHorizontal: 14 }}>
          Your Trunks and Branch Agent, in your pocket.
        </ThemedText>
        <View style={{ marginTop: space.sm }}>
          <Row label="This app" value={versionLine(identity)} />
          <Row label="By" value="KeepOak" last />
        </View>
      </Group>
    </Screen>
  );
}
