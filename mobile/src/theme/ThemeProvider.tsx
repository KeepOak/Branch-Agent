import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import type { KeyValueStore } from '../storage/keyValueStore';
import { parseThemePreference, readThemePreference, writeThemePreference, type ThemePreference } from './preference';
import { themeFor, type ColorScheme, type Theme } from './tokens';

type PreferenceApi = {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<Theme>(themeFor('light'));
const PreferenceContext = createContext<PreferenceApi>({
  preference: 'system',
  setPreference: () => undefined,
});

function resolveScheme(preference: ThemePreference, system: string | null | undefined): ColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

/** Follows the saved choice, or the phone's light or dark setting; `scheme` pins one (tests and screenshots). */
export function ThemeProvider({
  children,
  scheme,
  preference: pinned,
  store,
}: {
  children: ReactNode;
  scheme?: ColorScheme;
  preference?: ThemePreference;
  store?: KeyValueStore;
}) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(pinned ?? 'system');

  useEffect(() => {
    if (pinned !== undefined || !store) return;
    let live = true;
    void readThemePreference(store).then((saved) => {
      if (live) setPreferenceState(saved);
    });
    return () => {
      live = false;
    };
  }, [pinned, store]);

  useEffect(() => {
    if (pinned !== undefined) setPreferenceState(pinned);
  }, [pinned]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(parseThemePreference(next));
      if (store && pinned === undefined) void writeThemePreference(store, next);
    },
    [store, pinned],
  );

  const resolved: ColorScheme = scheme ?? resolveScheme(preference, system);
  const theme = useMemo(() => themeFor(resolved), [resolved]);
  const api = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return (
    <PreferenceContext.Provider value={api}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </PreferenceContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useThemePreference(): PreferenceApi {
  return useContext(PreferenceContext);
}
