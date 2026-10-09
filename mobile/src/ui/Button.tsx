import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';

type Kind = 'primary' | 'secondary' | 'plain' | 'destructive';

/** One button style for the whole app: filled accent, quiet fill, text-only, or red for undoable loss. */
export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled = false,
  busy = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const { color, radius, layout, space } = useTheme();
  const fill = kind === 'primary' ? color.accent : kind === 'secondary' ? color.accentTint : kind === 'destructive' ? color.badTint : 'transparent';
  const tone = kind === 'primary' ? 'onAccent' : kind === 'destructive' ? 'bad' : 'accentInk';
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: fill,
          borderRadius: radius.md,
          minHeight: layout.rowMinHeight + 6,
          paddingHorizontal: space.lg,
          opacity: off ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={color[tone]} style={{ marginRight: space.sm }} /> : null}
        <ThemedText variant="headline" tone={tone}>
          {title}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
