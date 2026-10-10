import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { themeFor, type ColorScheme, type Theme } from './tokens';

const ThemeContext = createContext<Theme>(themeFor('light'));

/** Follows the phone's light or dark setting; `scheme` pins one (tests and screenshots). */
export function ThemeProvider({ children, scheme }: { children: ReactNode; scheme?: ColorScheme }) {
  const system = useColorScheme();
  const resolved: ColorScheme = scheme ?? (system === 'dark' ? 'dark' : 'light');
  return <ThemeContext.Provider value={themeFor(resolved)}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
