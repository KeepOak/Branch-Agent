import { Pressable, View } from 'react-native';
import type { NotificationPermission } from '../approvals/approvalAlerts';
import { appIdentity, versionLine, type AppIdentity } from '../build/appIdentity';
import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme, useThemePreference } from '../theme/ThemeProvider';
import { THEME_OPTIONS } from '../theme/preference';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const { color, space, layout } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        minHeight: layout.rowMinHeight,
        alignItems: 'center',
        borderBottomWidth: last ? 0 : layout.hairline,
        borderBottomColor: color.line,
        gap: space.md,
      }}
    >
      <ThemedText variant="body">{label}</ThemedText>
      <ThemedText variant="body" tone="ink2" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </ThemedText>
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

/** Inset grouped Settings: this phone, the paired computer, notifications, appearance, About. */
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
  const host = gatewayHost(state.url);
  const connected = state.online ? 'Connected' : 'Reconnecting';
  const status = permissionLabel(permission);
  const canAsk = permission === 'undetermined' && onTurnOnNotifications;

  return (
    <Screen testID="settings-screen">
      <Pressable
        testID="settings-back"
        accessibilityRole="button"
        accessibilityLabel="Back to Chats"
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
          ‹ Chats
        </ThemedText>
      </Pressable>
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Settings
      </ThemedText>

      <Card testID="app-card">
        <Row label="Version" value={identity.version} />
        <Row label="Build" value={identity.build ?? '—'} last />
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
        <Row label="Computer" value={host} />
        <Row label="Branch" value={state.serverVersion ?? 'Checking…'} />
        <Pressable
          testID="this-phone"
          accessibilityRole="button"
          accessibilityLabel={`This phone, ${host}, ${connected}`}
          onPress={onThisPhone}
          style={({ pressed }) => ({
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            minHeight: layout.rowMinHeight,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ThemedText variant="body" tone="accentInk">
            This phone
          </ThemedText>
          <ThemedText variant="body" tone="ink3">
            ›
          </ThemedText>
        </Pressable>
      </Card>

      <Card testID="settings-notifications">
        <ThemedText variant="headline">Notifications</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          Approvals can reach you on the lock screen when they are on.
        </ThemedText>
        <Row label="Status" value={status} last={permission === 'unavailable'} />
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

      <Card testID="about-card">
        <ThemedText variant="headline">About</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          Your Trunks and Branch Agent, in your pocket.
        </ThemedText>
        <View style={{ marginTop: space.sm }}>
          <Row label="This app" value={versionLine(identity)} />
          <Row label="By" value="KeepOak" last />
        </View>
      </Card>
    </Screen>
  );
}
