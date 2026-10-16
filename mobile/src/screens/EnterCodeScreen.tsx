import { useState } from 'react';
import { decodeSetupCode, type SetupPayload } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';
import { PairingCodeField } from './pairingFields';
import { setupCodeProblem } from './ScanScreen';

/**
 * For when the camera can't help: paste the pairing code the computer shows under its QR code. Pair stays
 * above the keyboard, and the keyboard's own done key pairs too.
 */
export function EnterCodeScreen({ onCode, onScan, onCancel }: { onCode: (setup: SetupPayload) => void; onScan: () => void; onCancel: () => void }) {
  const { space } = useTheme();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    try {
      onCode(decodeSetupCode(text));
    } catch (error) {
      setProblem(setupCodeProblem(error));
    }
  };

  return (
    <Screen
      testID="enter-code-screen"
      avoidKeyboard
      hideScrollbars
      footer={
        <>
          <Button title="Pair" onPress={submit} disabled={!text.trim()} testID="submit-code" />
          <Button title="Scan instead" kind="secondary" onPress={onScan} />
          <Button title="Cancel" kind="plain" onPress={onCancel} />
        </>
      }
    >
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Connect to your Branch
      </ThemedText>
      <ThemedText variant="body" tone="ink2" style={{ marginTop: space.xs }}>
        Scan the square code on the computer, or paste the code it shows.
      </ThemedText>
      <Card>
        <PairingCodeField
          value={text}
          onChange={(value) => {
            setText(value);
            setProblem(null);
          }}
          problem={problem}
          onSubmit={submit}
          autoFocus
        />
      </Card>
    </Screen>
  );
}
