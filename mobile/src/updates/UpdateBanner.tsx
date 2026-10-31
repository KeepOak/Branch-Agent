import { View } from 'react-native';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { plainError } from '../ui/plainError';
import { NEEDS_PERMISSION_MESSAGE } from './updateFlow';
import type { UpdateFlowState } from './updateFlow';

function progressOf(state: UpdateFlowState): number | null {
  return state.status === 'downloading' ? state.progress : state.status === 'verifying' || state.status === 'installing' ? 1 : null;
}

function copy(state: UpdateFlowState): { title: string; body: string; action?: 'update' | 'allow' } | null {
  switch (state.status) {
    case 'available':
      return { title: 'Update available', body: `Branch ${state.offer.version} is ready to install.`, action: 'update' };
    case 'needsPermission':
      return { title: 'Allow installs', body: NEEDS_PERMISSION_MESSAGE, action: 'allow' };
    case 'downloading':
      return { title: 'Downloading the update', body: `${Math.round(state.progress * 100)}%` };
    case 'verifying':
      return { title: 'Checking the update', body: 'Making sure this file is the one Branch published.' };
    case 'installing':
      return { title: 'Install the update', body: 'Android is ready. Confirm the install when it asks.' };
    case 'error':
      return {
        title: 'Couldn’t update',
        body: plainError(state.message),
        action: state.offer ? 'update' : undefined,
      };
    default:
      return null;
  }
}

function ProgressBar({ value }: { value: number }) {
  const { color, radius } = useTheme();
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <View testID="update-progress" accessibilityValue={{ now: pct, min: 0, max: 100 }} style={{ height: 4, backgroundColor: color.fill, borderRadius: radius.pill, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: 4, backgroundColor: color.ink }} />
    </View>
  );
}

/** Quiet banner on Chats and Welcome when a sideloaded Android APK is ready or in flight. */
export function UpdateBanner({
  state,
  onUpdate,
  onAllowInstalls,
}: {
  state: UpdateFlowState;
  onUpdate: () => void;
  onAllowInstalls: () => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const shown = copy(state);
  if (!shown) return null;
  const progress = progressOf(state);
  const busy = state.status === 'downloading' || state.status === 'verifying' || state.status === 'installing';
  const failed = state.status === 'error';
  return (
    <View
      testID="update-banner"
      style={{
        marginTop: space.sm,
        backgroundColor: failed ? color.fill : color.accentTint,
        borderColor: failed ? color.line : 'transparent',
        borderWidth: failed ? layout.hairline : 0,
        borderRadius: radius.md,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <ThemedText variant="headline">{shown.title}</ThemedText>
      <ThemedText variant="footnote" tone="ink2">
        {shown.body}
      </ThemedText>
      {progress != null ? <ProgressBar value={progress} /> : null}
      {shown.action === 'update' ? (
        <Button title="Update" kind="primary" onPress={onUpdate} busy={busy} testID="update-button" />
      ) : shown.action === 'allow' ? (
        <Button title="Allow installs" kind="primary" onPress={onAllowInstalls} testID="update-allow-installs" />
      ) : null}
    </View>
  );
}

/** Settings card: version, a manual check, and the same Update / Allow installs controls. */
export function SettingsUpdateCard({
  version,
  versionCode,
  state,
  onCheck,
  onUpdate,
  onAllowInstalls,
  apkUpdates = true,
}: {
  version: string;
  versionCode: number;
  state: UpdateFlowState;
  onCheck: () => void;
  onUpdate: () => void;
  onAllowInstalls: () => void;
  /** Sideloaded APK updates are Android-only. */
  apkUpdates?: boolean;
}) {
  const { color, space, layout } = useTheme();
  const shown = copy(state);
  const progress = progressOf(state);
  const checking = state.status === 'checking';
  const busy = state.status === 'downloading' || state.status === 'verifying' || state.status === 'installing';
  const statusLine =
    state.status === 'upToDate'
      ? 'This phone is up to date.'
      : state.status === 'checking'
        ? 'Checking for an update…'
        : shown?.body;
  return (
    <View testID="update-settings-card">
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          minHeight: layout.rowMinHeight,
          alignItems: 'center',
          borderBottomWidth: layout.hairline,
          borderBottomColor: color.line,
          gap: space.md,
        }}
      >
        <ThemedText variant="body">Version</ThemedText>
        <ThemedText variant="body" tone="ink2" testID="update-installed-version">
          {version} ({versionCode})
        </ThemedText>
      </View>
      {apkUpdates && statusLine ? (
        <ThemedText variant="footnote" tone="ink2" style={{ marginTop: space.md }} testID="update-settings-status">
          {statusLine}
        </ThemedText>
      ) : null}
      {!apkUpdates ? (
        <ThemedText variant="footnote" tone="ink2" style={{ marginTop: space.md }} testID="update-settings-status">
          Pairing stays on this phone across updates.
        </ThemedText>
      ) : null}
      {apkUpdates && progress != null ? (
        <View style={{ marginTop: space.md }}>
          <ProgressBar value={progress} />
        </View>
      ) : null}
      {apkUpdates ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          {state.status === 'needsPermission' ? (
            <Button title="Allow installs" kind="ink" onPress={onAllowInstalls} testID="update-allow-installs" />
          ) : state.status === 'available' || (state.status === 'error' && state.offer) ? (
            <Button title="Update" kind="ink" onPress={onUpdate} busy={busy} testID="update-button" />
          ) : null}
          <Button title="Check for update" kind="inkSecondary" onPress={onCheck} busy={checking} disabled={busy} testID="update-check" />
        </View>
      ) : null}
    </View>
  );
}
