import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';

/**
 * First screen of the empty app. It says plainly what Branch on the phone is and that pairing comes
 * next. It has no buttons yet: pairing lands in the next pull request, and a control that does
 * nothing is never shown.
 */
export function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { color, space, layout, radius } = theme;

  return (
    <View
      testID="welcome-screen"
      style={[
        styles.screen,
        {
          backgroundColor: color.grouped,
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xl,
          paddingHorizontal: layout.screenInset,
        },
      ]}
    >
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Branch
      </ThemedText>
      <ThemedText variant="body" tone="ink2" style={{ marginTop: space.xs }}>
        Your Trunks and Branch Agent, in your pocket.
      </ThemedText>

      <View
        testID="pairing-status"
        style={[
          { backgroundColor: color.raise, borderRadius: radius.md, marginTop: space.xxxl, padding: layout.cardInset },
        ]}
      >
        <View style={styles.row}>
          <View
            style={[styles.dot, { backgroundColor: color.warn, borderRadius: radius.pill, marginRight: space.sm }]}
          />
          <ThemedText variant="headline">Not paired with a computer yet</ThemedText>
        </View>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          Pairing with the Branch app on your computer comes in the next update. After that, your chats,
          approvals and Trunk status show up here live.
        </ThemedText>
      </View>

      <View style={styles.spacer} />
      <ThemedText variant="footnote" tone="ink3" style={styles.center}>
        Talks only to your own computer. No passwords, no keys.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8 },
  spacer: { flex: 1 },
  center: { textAlign: 'center' },
});
