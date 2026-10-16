import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import App from '../../App';
import { memoryStore } from '../storage/keyValueStore';
import { createFakeSession } from '../testing/fakeSession';
import { contrastRatio } from './contrast';
import { parseThemePreference, THEME_PREFERENCE_KEY } from './preference';
import { ThemeProvider, useTheme, useThemePreference } from './ThemeProvider';
import { pairingTheme, palettes, themeFor, type ColorScheme } from './tokens';

const schemes: ColorScheme[] = ['light', 'dark'];
const hex = /^#[0-9a-f]{6}$/i;

describe('theme tokens', () => {
  it('gives light and dark the same colour names', () => {
    expect(Object.keys(palettes.dark).sort()).toEqual(Object.keys(palettes.light).sort());
  });

  it.each(schemes)('keeps every %s text colour readable (WCAG AA 4.5:1)', scheme => {
    const c = palettes[scheme];
    for (const ink of [c.ink, c.ink2, c.ink3, c.accentInk]) {
      for (const surface of [c.bg, c.grouped, c.raise]) {
        expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrastRatio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(schemes)('keeps pairing %s text readable after swapping indigo for ink', scheme => {
    const pairing = pairingTheme(themeFor(scheme)).color;
    for (const ink of [pairing.ink, pairing.ink2, pairing.ink3, pairing.accentInk]) {
      for (const surface of [pairing.bg, pairing.grouped, pairing.raise]) {
        expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrastRatio(pairing.onAccent, pairing.accent)).toBeGreaterThanOrEqual(4.5);
    expect(pairing.accent).toBe(palettes[scheme].ink);
  });

  it.each(schemes)('uses plain #rrggbb for every solid %s colour', scheme => {
    const { scrim, glass, ...solid } = palettes[scheme];
    expect(scrim).toMatch(/^rgba\(/);
    expect(glass).toMatch(/^rgba\(/);
    for (const value of Object.values(solid)) expect(value).toMatch(hex);
  });
});

describe('app shell', () => {
  it.each(schemes)('draws the welcome screen from the %s tokens', async scheme => {
    await render(<App scheme={scheme} session={createFakeSession().session} />);
    const theme = themeFor(scheme);
    expect(await screen.findByRole('header')).toHaveTextContent('Branch');
    expect(StyleSheet.flatten(screen.getByTestId('welcome-screen').props.style).backgroundColor).toBe(
      theme.color.grouped,
    );
    expect(StyleSheet.flatten(screen.getByTestId('pairing-steps').props.style).backgroundColor).toBe(
      theme.color.raise,
    );
    expect(screen.getByRole('button', { name: 'Pair with your computer' })).toBeOnTheScreen();
  });
});

describe('theme preference', () => {
  it('treats anything but light or dark as follow the phone', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('other')).toBe('system');
  });

  it('reads a saved choice and writes it back, dropping the key for System', async () => {
    const store = memoryStore({ [THEME_PREFERENCE_KEY]: 'dark' });
    function Probe() {
      const theme = useTheme();
      const { preference, setPreference } = useThemePreference();
      return (
        <View testID="probe" accessibilityLabel={`${preference}:${theme.scheme}`}>
          <Pressable testID="pick-light" accessibilityRole="button" onPress={() => setPreference('light')} />
          <Pressable testID="pick-system" accessibilityRole="button" onPress={() => setPreference('system')} />
        </View>
      );
    }
    await render(
      <ThemeProvider store={store}>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveProp('accessibilityLabel', 'dark:dark'));
    await fireEvent.press(screen.getByTestId('pick-light'));
    expect(store.dump()[THEME_PREFERENCE_KEY]).toBe('light');
    await fireEvent.press(screen.getByTestId('pick-system'));
    expect(store.dump()[THEME_PREFERENCE_KEY]).toBeUndefined();
  });
});
