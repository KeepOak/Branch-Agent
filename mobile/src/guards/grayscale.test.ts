import fs from 'node:fs';
import path from 'node:path';
import { DESKTOP_THEMES, paletteSliceFor } from '../theme/desktopThemes';
import { palettes, toGrayscale } from '../theme/tokens';
import { colorLiterals, formatHits, isGrayscaleColor, KEEP_COLOR_ASSETS, mobileRoot, readMobileFile, srcPaintFiles } from './sourceScan';

const TOKEN_FILE = 'src/theme/tokens.ts';

describe('grayscale theme tokens', () => {
  it('treats black, white and equal-channel greys as grayscale, and rejects hue', () => {
    expect(isGrayscaleColor('#000000')).toBe(true);
    expect(isGrayscaleColor('#fff')).toBe(true);
    expect(isGrayscaleColor('#b4b4b4')).toBe(true);
    expect(isGrayscaleColor('rgba(19, 19, 19, 0.3)')).toBe(true);
    expect(isGrayscaleColor('hsl(0, 0%, 40%)')).toBe(true);
    expect(isGrayscaleColor('#484ce5')).toBe(false);
    expect(isGrayscaleColor('rgb(47, 143, 91)')).toBe(false);
    expect(isGrayscaleColor('hsl(220, 80%, 50%)')).toBe(false);
  });

  it('flags hex, rgb/rgba, hsl and named colour literals in screen source', () => {
    const sample = `
      const styles = { color: '#ff0000', bg: 'rgb(0, 128, 0)', wash: 'hsl(200, 80%, 50%)', ink: 'black' };
      const ok = { empty: 'transparent', token: color.ink };
    `;
    expect(colorLiterals(sample).map((hit) => hit.value).sort()).toEqual(['#ff0000', "'black'", 'hsl(200, 80%, 50%)', 'rgb(0, 128, 0)'].sort());
  });

  it('fails on any colour literal in mobile/src outside the token file, or on a non-grayscale token value', () => {
    expect(KEEP_COLOR_ASSETS).toEqual(['assets/icon.png', 'assets/adaptive-icon.png', 'assets/splash-icon.png']);
    for (const asset of KEEP_COLOR_ASSETS) {
      expect(fs.existsSync(path.join(mobileRoot, asset))).toBe(true);
    }
    expect(srcPaintFiles()).not.toContain(TOKEN_FILE);
    const literalHits = srcPaintFiles().flatMap((file) => {
      const values = colorLiterals(readMobileFile(file)).map((hit) => hit.value);
      return values.length ? [formatHits(file, values)] : [];
    });
    expect(literalHits).toEqual([]);

    const tokenHits: string[] = [];
    for (const [scheme, palette] of Object.entries(palettes)) {
      for (const [name, value] of Object.entries(palette)) {
        if (!isGrayscaleColor(value)) tokenHits.push(`${TOKEN_FILE} ${scheme}.${name}=${value}`);
      }
    }
    expect(tokenHits).toEqual([]);
  });

  it('maps a hue to equal-channel grey and leaves greys alone', () => {
    expect(toGrayscale('#484ce5')).toMatch(/^#[0-9a-f]{6}$/);
    expect(isGrayscaleColor(toGrayscale('#484ce5'))).toBe(true);
    expect(toGrayscale('#1c1c1c')).toBe('#1c1c1c');
    expect(toGrayscale('rgba(19, 19, 19, 0.3)')).toBe('rgba(19, 19, 19, 0.3)');
  });

  it('keeps every desktop look grayscale at runtime, including the default token slice', () => {
    const hits: string[] = [];
    for (const theme of DESKTOP_THEMES) {
      for (const scheme of ['light', 'dark'] as const) {
        for (const [name, value] of Object.entries(paletteSliceFor(theme.id, scheme))) {
          if (!isGrayscaleColor(value)) hits.push(`${theme.id} ${scheme}.${name}=${value}`);
        }
      }
    }
    expect(hits).toEqual([]);
    expect(paletteSliceFor('grove', 'light').grouped).toBe(palettes.light.grouped);
    expect(paletteSliceFor('grove', 'dark').ink).toBe(palettes.dark.ink);
  });
});
