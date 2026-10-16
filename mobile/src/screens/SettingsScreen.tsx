import { Pressable, View } from 'react-native';
import type { NotificationPermission } from '../approvals/approvalAlerts';
import { appIdentity, versionLine, type AppIdentity } from '../build/appIdentity';
import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import { SHOW_LEVEL_OPTIONS, type ShowLevel } from '../settings/showLevel';
import { ThemedText } from '../theme/ThemedText';
import { useTheme, useThemePreference } from '../theme/ThemeProvider';
import { THEME_OPTIONS } from '../theme/preference';
import { Button } from '../ui/Button';
import { DetailRow } from '../ui/DetailRow';
import { Card, Screen } from '../ui/Screen';

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

/** Inset grouped Settings: this phone, the paired computer, notifications, appearance, About. */
export function SettingsScreen({
  state,
  permission,
  identity = appIdentity(),
  showLevel = 'regular',
  onShowLevel,
  onThisPhone,
  onOpenSettings,
  onTurnOnNotifications,
  onBack,
  backTo = 'Chats',
}: {
  state: Extract<PairingState, { step: 'paired' }>;
  permission: NotificationPermission | null;
  identity?: AppIdentity;
  showLevel?: ShowLevel;
  onShowLevel?: (next: ShowLevel) => void;
  onThisPhone: () => void;
  onOpenSettings: () => void;
  onTurnOnNotifications?: () => void;
  onBack: () => void;
  backTo?: 'Chats' | 'More';
}) {
  const { color, space, radius, layout } = useTheme();
  const { preference, setPreference } = useThemePreference();
  const host = gatewayHost(state.url);
  const connected = state.online ? 'Connected' : 'Reconnecting';
  const status = permissionLabel(permission);
  const canAsk = permission === 'undetermined' && onTurnOnNotifications;
  const levelHint = SHOW_LEVEL_OPTIONS.find((option) => option.value === showLevel)?.hint ?? SHOW_LEVEL_OPTIONS[0].hint;

  return (
    <Screen testID="settings-screen">
      <Pressable
        testID="settings-back"
        accessibilityRole="button"
        accessibilityLabel={`Back to ${backTo}`}
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: layout.rowMinHeight,
          justifyContent: 'center',
          marginTop: -space.xl,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <ThemedText variant="body" tone="accentInk">
          {`‹ ${backTo}`}
        </ThemedText>
      </Pressable>
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Settings
      </ThemedText>

      <Card testID="app-card">
        <DetailRow label="Version" detail="This install of Branch on this phone" value={identity.version} />
        <DetailRow label="Build" detail="The build number of this install" value={identity.build ?? '—'} last />
      </Card>

      <Card testID="computer-card">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: radius.pill,
              backgroundColor: state.online ? color.ok : color.warn,
              marginRight: space.sm,
            }}
          />
          <ThemedText variant="headline">{state.online ? 'Connected to your computer' : 'Reconnecting to your computer…'}</ThemedText>
        </View>
        <DetailRow label="Computer" detail="The computer this phone is paired with" value={host} />
        <DetailRow label="Branch" detail="The Branch version on that computer" value={state.serverVersion ?? 'Checking…'} />
        <DetailRow
          testID="this-phone"
          label="This phone"
          detail="This phone’s pairing, updates and unpair"
          value={connected}
          last
          onPress={onThisPhone}
          accessibilityLabel={`This phone, ${host}, ${connected}`}
        />
      </Card>

      <Card testID="settings-notifications">
        <ThemedText variant="headline">Notifications</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          Approvals can reach you on the lock screen when they are on.
        </ThemedText>
        <DetailRow label="Status" detail="Whether approvals can reach the lock screen" value={status} last={permission === 'unavailable'} />
        {permission === 'unavailable' ? (
          <ThemedText testID="settings-notifications-unavailable" variant="footnote" tone="ink2" style={{ marginTop: space.sm }}>
            Notifications need the installed Branch app. Approvals still show up in the app.
          </ThemedText>
        ) : (
          <View style={{ marginTop: space.md, gap: space.sm }}>
            {canAsk ? (
              <Button title="Turn on notifications" onPress={onTurnOnNotifications} testID="settings-notifications-turn-on" />
            ) : null}
            <Button
              title="Open Settings"
              kind={canAsk ? 'secondary' : 'primary'}
              onPress={onOpenSettings}
              testID="notifications-system-settings"
            />
          </View>
        )}
      </Card>

      <Card testID="appearance-card">
        <ThemedText variant="headline">Appearance</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs, marginBottom: space.md }}>
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
                  backgroundColor: on ? color.raise : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <ThemedText variant="subhead" style={{ fontWeight: on ? '600' : '400' }}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card testID="show-level-card">
        <ThemedText variant="headline">How much to show</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs, marginBottom: space.md }}>
          {levelHint}
        </ThemedText>
        <View
          testID="show-level-picker"
          accessibilityRole="radiogroup"
          accessibilityLabel="How much to show"
          style={{
            flexDirection: 'row',
            backgroundColor: color.fill,
            borderRadius: radius.md,
            padding: space.xs,
            gap: space.xs,
          }}
        >
          {SHOW_LEVEL_OPTIONS.map((option) => {
            const on = showLevel === option.value;
            return (
              <Pressable
                key={option.value}
                testID={`show-level-${option.value}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={option.label}
                onPress={() => onShowLevel?.(option.value)}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: layout.rowMinHeight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.sm,
                  backgroundColor: on ? color.raise : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <ThemedText variant="subhead" style={{ fontWeight: on ? '600' : '400' }}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card testID="about-card">
        <ThemedText variant="headline">About</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          Your Trunks and Branch Agent, in your pocket.
        </ThemedText>
        <View style={{ marginTop: space.sm }}>
          <DetailRow label="This app" detail="The version of Branch on this phone" value={versionLine(identity)} />
          <DetailRow label="By" detail="Who makes Branch" value="KeepOak" last />
        </View>
      </Card>
    </Screen>
  );
}
