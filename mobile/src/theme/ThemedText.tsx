import { Platform, Text, type TextProps } from 'react-native';
import { useTheme } from './ThemeProvider';
import type { Palette, TypeName } from './tokens';

// Desktop --sans on web; the installed app keeps the platform UI font.
const family = Platform.select({
  web: '"Geist", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
});

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
