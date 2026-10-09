import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, View } from 'react-native';
import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';

type Waiting = Extract<PairingState, { step: 'connecting' | 'approval' | 'failed' }>;

/** A soft ring that breathes while the computer decides, so the wait reads as alive, not stuck. */
function Breathing() {
  const { color } = useTheme();
  const scale = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.85, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', height: 120 }}>
      <Animated.View style={{ position: 'absolute', width: 112, height: 112, borderRadius: 56, backgroundColor: color.accentTint, transform: [{ scale }] }} />
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: color.accent }} />
    </View>
  );
}

/** Between scanning and paired: reaching the computer, waiting for its yes, or why it didn't finish. */
export function ApprovalScreen({ state, onCancel, onScanAgain }: { state: Waiting; onCancel: () => void; onScanAgain: () => void }) {
  const { color, space } = useTheme();
  const host = gatewayHost(state.url);

  if (state.step === 'failed') {
    return (
      <Screen
        testID="pairing-failed"
        footer={
          <>
            <Button title="Scan a new code" onPress={onScanAgain} />
            <Button title="Back" kind="plain" onPress={onCancel} />
          </>
        }
      >
        <ThemedText variant="largeTitle" accessibilityRole="header">
          Pairing didn’t finish
        </ThemedText>
        <Card>
          <ThemedText variant="body">{state.message}</ThemedText>
        </Card>
      </Screen>
    );
  }

  const approval = state.step === 'approval';
  return (
    <Screen testID={approval ? 'pairing-approval' : 'pairing-connecting'} footer={<Button title="Cancel" kind="secondary" onPress={onCancel} />}>
      <ThemedText variant="largeTitle" accessibilityRole="header">
        {approval ? 'Allow on your computer' : 'Reaching your computer'}
      </ThemedText>
      <View style={{ marginTop: space.xxxl }}>
        {approval ? <Breathing /> : <ActivityIndicator size="large" color={color.accent} style={{ height: 120 }} />}
      </View>
      <Card>
        <ThemedText variant="headline">{approval ? 'Branch is asking about this phone' : `Looking for Branch at ${host}`}</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          {approval
            ? 'Choose Allow in Branch on your computer. This screen moves on by itself.'
            : 'Keep this phone on the same network as your computer.'}
        </ThemedText>
      </Card>
    </Screen>
  );
}
