import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import type { KeyValueStore } from '../storage/keyValueStore';
import { DEFAULT_THEME_ID } from './desktopThemes';
import { paletteSliceFor } from './desktopThemes';
import {
  parseLookTheme,
  parseThemePreference,
  readLookTheme,
  readThemePreference,
  writeLookTheme,
  writeThemePreference,
  type ThemePreference,
} from './preference';
import { themeFor, type ColorScheme, type Theme } from './tokens';

type PreferenceApi = {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  lookId: string;
  setLookId: (next: string) => void;
};

const ThemeContext = createContext<Theme>(themeFor('light'));
const PreferenceContext = createContext<PreferenceApi>({
  preference: 'system',
  setPreference: () => undefined,
  lookId: DEFAULT_THEME_ID,
  setLookId: () => undefined,
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
  lookId: pinnedLook,
  store,
}: {
  children: ReactNode;
  scheme?: ColorScheme;
  preference?: ThemePreference;
  lookId?: string;
  store?: KeyValueStore;
}) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(pinned ?? 'system');
  const [lookId, setLookIdState] = useState(pinnedLook ?? DEFAULT_THEME_ID);

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
    if (pinnedLook !== undefined || !store) return;
    let live = true;
    void readLookTheme(store).then((saved) => {
      if (live) setLookIdState(saved);
    });
    return () => {
      live = false;
    };
  }, [pinnedLook, store]);

  useEffect(() => {
    if (pinned !== undefined) setPreferenceState(pinned);
  }, [pinned]);

  useEffect(() => {
    if (pinnedLook !== undefined) setLookIdState(parseLookTheme(pinnedLook));
  }, [pinnedLook]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(parseThemePreference(next));
      if (store && pinned === undefined) void writeThemePreference(store, next);
    },
    [store, pinned],
  );

  const setLookId = useCallback(
    (next: string) => {
      const id = parseLookTheme(next);
      setLookIdState(id);
      if (store && pinnedLook === undefined) void writeLookTheme(store, id);
    },
    [store, pinnedLook],
  );

  const resolved: ColorScheme = scheme ?? resolveScheme(preference, system);
  const theme = useMemo(() => themeFor(resolved, paletteSliceFor(lookId, resolved)), [resolved, lookId]);
  const api = useMemo(() => ({ preference, setPreference, lookId, setLookId }), [preference, setPreference, lookId, setLookId]);

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
