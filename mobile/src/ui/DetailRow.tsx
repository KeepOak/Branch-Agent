import { Pressable, View } from 'react-native';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';

/** A Settings-style row: title, a short line under it saying what it does, optional value and chevron. */
export function DetailRow({
  label,
  detail,
  value,
  onPress,
  last = false,
  testID,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const { color, space, layout } = useTheme();
  const spoken = accessibilityLabel ?? [label, detail, value].filter(Boolean).join(', ');
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: layout.rowMinHeight,
        paddingVertical: space.sm,
        borderBottomWidth: last ? 0 : layout.hairline,
        borderBottomColor: color.line,
        gap: space.md,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
        <ThemedText variant="body">{label}</ThemedText>
        {detail ? (
          <ThemedText variant="footnote" tone="ink2">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {value ? (
        <ThemedText variant="body" tone="ink2" style={{ flexShrink: 1, textAlign: 'right', maxWidth: '42%' }}>
          {value}
        </ThemedText>
      ) : null}
      {onPress ? (
        <ThemedText variant="body" tone="ink3">
          ›
        </ThemedText>
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View testID={testID} accessibilityLabel={spoken}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}
