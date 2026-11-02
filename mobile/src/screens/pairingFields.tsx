import { TextInput } from 'react-native';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';

/** The pairing code field from the preview: paste the computer’s code, with a plain problem line. */
export function PairingCodeField({
  value,
  onChange,
  problem,
  onSubmit,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  problem: string | null;
  onSubmit: () => void;
  autoFocus?: boolean;
}) {
  const { color, space, radius, type } = useTheme();
  return (
    <>
      <ThemedText variant="subhead" tone="ink2" style={{ marginBottom: space.sm }}>
        The code from the computer
      </ThemedText>
      <TextInput
        testID="code-input"
        value={value}
        onChangeText={onChange}
        placeholder="Pairing code"
        placeholderTextColor={color.ink3}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        multiline
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onSubmitEditing={() => value.trim() && onSubmit()}
        style={[type.body, { color: color.ink, minHeight: 88, padding: space.sm, backgroundColor: color.fill, borderRadius: radius.sm, textAlignVertical: 'top' }]}
      />
      {problem ? (
        <ThemedText testID="code-problem" variant="footnote" tone="bad" style={{ marginTop: space.sm }}>
          {problem}
        </ThemedText>
      ) : null}
    </>
  );
}
