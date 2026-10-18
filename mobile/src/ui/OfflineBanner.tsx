import { View } from 'react-native';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';

/** Amber bar while the phone is retrying the computer. Hidden by the caller once the connection is back. */
export function OfflineBanner({ message, testID }: { message: string; testID: string }) {
  const { color, space, radius } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, backgroundColor: color.warnTint, borderRadius: radius.md, padding: space.md }}
    >
      <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.warn }} />
      <ThemedText variant="footnote" tone="ink2" style={{ flex: 1 }}>
        {message}
      </ThemedText>
    </View>
  );
}
