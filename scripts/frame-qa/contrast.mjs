// WCAG 2.x contrast for text, computed from the colours the browser reports.
// Semi-transparent text is blended over its background before the ratio is taken.

/** Parses "rgb(r, g, b)" or "rgba(r, g, b, a)" into { r, g, b, a }, or null. */
export function parseColor(text) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(String(text || ''));
  if (!match) return null;
  let a = 1;
  if (match[4] !== undefined) a = match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a };
}

/** Composites a foreground colour over an opaque background. */
export function blend(fg, bg) {
  const alpha = fg.a;
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
    a: 1,
  };
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque colour. */
export function luminance(color) {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio between two opaque colours (1 to 21). */
export function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG AA minimum: 3:1 for large text (24px, or 18.66px bold), 4.5:1 otherwise. */
export function requiredRatio({ fontSizePx, fontWeight }) {
  const size = Number(fontSizePx) || 0;
  const weight = Number(fontWeight) || 400;
  return size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
}

/**
 * Audits probe items { text, color, background, fontSizePx, fontWeight, opacity, disabled }.
 * Disabled controls are exempt, as WCAG allows. Returns failing items with their ratio.
 */
export function auditContrast(items) {
  const failures = [];
  for (const item of items) {
    if (item.disabled) continue;
    const fg0 = parseColor(item.color);
    const bg = parseColor(item.background);
    if (!fg0 || !bg) continue;
    const opaqueBg = { ...bg, a: 1 };
    const opacity = Number.isFinite(item.opacity) ? item.opacity : 1;
    const fg = blend({ ...fg0, a: fg0.a * opacity }, opaqueBg);
    const ratio = contrastRatio(fg, opaqueBg);
    const need = requiredRatio(item);
    if (ratio < need) failures.push({ text: item.text, ratio: Math.round(ratio * 100) / 100, need, fontSizePx: item.fontSizePx, fontWeight: item.fontWeight });
  }
  return failures;
}
