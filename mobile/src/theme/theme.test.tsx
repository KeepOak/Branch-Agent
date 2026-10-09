import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import App from '../../App';
import { createFakeSession } from '../testing/fakeSession';
import { contrastRatio } from './contrast';
import { palettes, themeFor, type ColorScheme } from './tokens';

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

  it.each(schemes)('uses plain #rrggbb for every solid %s colour', scheme => {
    const { scrim, ...solid } = palettes[scheme];
    expect(scrim).toMatch(/^rgba\(/);
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
