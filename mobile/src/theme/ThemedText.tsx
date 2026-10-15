import { Platform, Text, type TextProps } from 'react-native';
import { useTheme } from './ThemeProvider';
import type { Palette, TypeName } from './tokens';

// The system font is SF Pro on iPhone and Roboto on Android; the web preview asks for the same stack.
const family = Platform.select({ web: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif' });

type InkName = 'ink' | 'ink2' | 'ink3' | 'accentInk' | 'onAccent' | 'ok' | 'warn' | 'bad';

export function ThemedText({
  variant = 'body',
  tone = 'ink',
  style,
  ...rest
}: TextProps & { variant?: TypeName; tone?: InkName & keyof Palette }) {
  const theme = useTheme();
  return (
    <Text
      {...rest}
      style={[theme.type[variant], { color: theme.color[tone], fontFamily: family }, style]}
    />
  );
}
