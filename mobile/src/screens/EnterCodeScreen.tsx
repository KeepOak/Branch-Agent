import { useState } from 'react';
import { TextInput } from 'react-native';
import { decodeSetupCode, type SetupPayload } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';
import { setupCodeProblem } from './ScanScreen';

/**
 * For when the camera can't help: paste the pairing code the computer shows under its QR code. Pair stays
 * above the keyboard, and the keyboard's own done key pairs too.
 */
export function EnterCodeScreen({ onCode, onScan, onCancel }: { onCode: (setup: SetupPayload) => void; onScan: () => void; onCancel: () => void }) {
  const { color, space, radius, type } = useTheme();
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
      footer={
        <>
          <Button title="Pair" onPress={submit} disabled={!text.trim()} testID="submit-code" />
          <Button title="Scan instead" kind="secondary" onPress={onScan} />
          <Button title="Cancel" kind="plain" onPress={onCancel} />
        </>
      }
    >
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Enter the code
      </ThemedText>
      <ThemedText variant="body" tone="ink2" style={{ marginTop: space.xs }}>
        Copy the code under the QR code on your computer and paste it here.
      </ThemedText>
      <Card>
        <TextInput
          testID="code-input"
          value={text}
          onChangeText={(value) => {
            setText(value);
            setProblem(null);
          }}
          placeholder="Pairing code"
          placeholderTextColor={color.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          multiline
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => text.trim() && submit()}
          style={[type.body, { color: color.ink, minHeight: 88, padding: space.sm, backgroundColor: color.fill, borderRadius: radius.sm, textAlignVertical: 'top' }]}
        />
        {problem ? (
          <ThemedText testID="code-problem" variant="footnote" tone="bad" style={{ marginTop: space.sm }}>
            {problem}
          </ThemedText>
        ) : null}
      </Card>
    </Screen>
  );
}
