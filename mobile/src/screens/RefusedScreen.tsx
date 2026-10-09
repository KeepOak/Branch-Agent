import type { PairingState } from '../pairing/pairingSession';
import { gatewayHost } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';

/**
 * The computer this phone paired with stopped accepting it, and the engine's client has stopped asking.
 * Says why in plain words and offers a fresh pairing, never a reconnect that won't happen.
 */
export function RefusedScreen({
  state,
  onPairAgain,
  onRetry,
  onForget,
}: {
  state: Extract<PairingState, { step: 'refused' }>;
  onPairAgain: () => void;
  onRetry: () => void;
  onForget: () => void;
}) {
  const { space } = useTheme();
  return (
    <Screen
      testID="pairing-refused"
      footer={
        <>
          <Button title="Pair again" onPress={onPairAgain} testID="pair-again" />
          {state.canRetry ? <Button title="Try again" kind="secondary" onPress={onRetry} testID="retry" /> : null}
          <Button title="Forget this computer" kind="plain" onPress={onForget} testID="forget" />
        </>
      }
    >
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Not connected
      </ThemedText>
      <Card>
        <ThemedText variant="headline">Your computer stopped letting this phone in</ThemedText>
        <ThemedText variant="body" style={{ marginTop: space.xs }} testID="refused-message">
          {state.message}
        </ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.sm }}>
          {`Computer: ${gatewayHost(state.url)}`}
        </ThemedText>
      </Card>
    </Screen>
  );
}
