import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/places/settings/kit.css', 'utf8');

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

describe('settings group readability over wallpaper', () => {
  it.each(['<div class="theme-now">Theme preview</div>', '<div class="scenes12">Scene picker</div>', ''])('protects headings, hints and descriptions in mixed and row-only groups (%s)', (extra) => {
    const style = document.createElement('style');
    // jsdom does not resolve custom properties in background shorthands.
    style.textContent = css.replaceAll('var(--raise)', 'rgb(22, 29, 34)').replaceAll('var(--ink-2)', 'rgb(181, 196, 206)');
    document.head.append(style);
    document.body.innerHTML = `<main class="set-col"><section class="sec"><h2>Theme</h2><p class="hint">Choose your look</p>${extra}<div class="ctl"><b>Accent colour</b><small>Used for highlights</small><div class="right">Pick</div></div></section></main>`;
    const section = document.querySelector<HTMLElement>('.sec')!;
    // The group itself must shield all its content, not only row-only controls.
    expect(getComputedStyle(section).backgroundColor).toBe('rgb(22, 29, 34)');
    expect(parseFloat(getComputedStyle(section).paddingTop)).toBeGreaterThanOrEqual(12);
    expect(getComputedStyle(document.querySelector('.hint')!).color).toBe('rgb(181, 196, 206)');
    expect(getComputedStyle(document.querySelector('.ctl > small')!).color).toBe('rgb(181, 196, 206)');
  });
});
