import { useState } from 'react';
import { View } from 'react-native';
import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
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

/** Paired: whether the computer is reachable right now, what this phone may do, and a way to unpair. */
export function PairedScreen({ state, onUnpair }: { state: Extract<PairingState, { step: 'paired' }>; onUnpair: () => void }) {
  const { color, space, radius } = useTheme();
  const [confirming, setConfirming] = useState(false);

  return (
    <Screen
      testID="paired-screen"
      footer={
        confirming ? (
          <>
            <ThemedText variant="footnote" tone="ink2" style={{ textAlign: 'center' }}>
              This phone stops getting chats and approvals. You can pair again any time.
            </ThemedText>
            <Button title="Unpair" kind="destructive" onPress={onUnpair} testID="confirm-unpair" />
            <Button title="Keep paired" kind="plain" onPress={() => setConfirming(false)} />
          </>
        ) : (
          <Button title="Unpair this phone" kind="plain" onPress={() => setConfirming(true)} testID="unpair" />
        )
      }
    >
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Branch
      </ThemedText>
      <Card testID="connection-card">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: state.online ? color.ok : color.warn, marginRight: space.sm }} />
          <ThemedText variant="headline">{state.online ? 'Connected to your computer' : 'Reconnecting to your computer…'}</ThemedText>
        </View>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          {state.online
            ? 'This phone is paired. It can read your chats, send messages and answer approvals.'
            : 'Your computer may be asleep or restarting. Branch keeps trying by itself.'}
        </ThemedText>
      </Card>
      <Card>
        <Row label="Computer" value={gatewayHost(state.url)} />
        <Row label="Branch" value={state.serverVersion ?? 'Checking…'} last />
      </Card>
    </Screen>
  );
}
