import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A screen with the iOS large-title margins: scrolling content above, actions pinned to the bottom. With
 * `avoidKeyboard`, the actions ride above the on-screen keyboard instead of sitting under it, so a tap meant
 * for them never lands on a key. Padding works on both platforms now that Android draws edge to edge and no
 * longer resizes the window for the keyboard.
 */
export function Screen({ children, footer, testID, avoidKeyboard = false }: { children: ReactNode; footer?: ReactNode; testID?: string; avoidKeyboard?: boolean }) {
  const { color, space, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const Root = avoidKeyboard ? KeyboardAvoidingView : View;
  return (
    <Root testID={testID} {...(avoidKeyboard ? { behavior: 'padding' as const } : {})} style={[styles.fill, { backgroundColor: color.grouped }]}>
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
    </Root>
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
