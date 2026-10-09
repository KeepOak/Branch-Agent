import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

/** A screen with the iOS large-title margins: scrolling content above, actions pinned to the bottom. */
export function Screen({ children, footer, testID }: { children: ReactNode; footer?: ReactNode; testID?: string }) {
  const { color, space, layout } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={[styles.fill, { backgroundColor: color.grouped }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingTop: insets.top + space.xxl, paddingHorizontal: layout.screenInset, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={{ paddingHorizontal: layout.screenInset, paddingBottom: insets.bottom + space.lg, paddingTop: space.sm, gap: space.sm }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/** Inset grouped card, the iOS Settings look. */
export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const { color, radius, layout, space } = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: color.raise, borderRadius: radius.md, padding: layout.cardInset, marginTop: space.xxl }}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
