// Controls the crawl records and does not click.
// Destructive actions can delete data or leave the app. External links open another site.
// Sign-in buttons are recorded but not clicked: they start sign-in with outside services.
// "remove" is included with delete: in this window it drops a conversation, trunk, or account.

const DESTRUCTIVE = /\b(delete|remove|uninstall|erase|wipe|destroy|quit|sign[\s-]?out|log[\s-]?out)\b/i;
const EXTERNAL_SIGN_IN = /^(?:connect|sign in with|continue with)\s+(?!to\b)\S/i;

/** True when a link would leave this window for another site. */
export function isExternalHref(href) {
  const value = String(href || '').trim();
  if (!value || value.startsWith('#') || value.startsWith('/')) return false;
  if (/^(mailto:|javascript:)/i.test(value)) return true;
  try {
    const url = new URL(value, 'http://127.0.0.1');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname !== '127.0.0.1' && url.hostname !== 'localhost';
  } catch {
    return true;
  }
}

/** Why a control is skipped, or null when the crawl should click it. */
export function skipReason({ name = '', href = '', disabled = false } = {}) {
  if (disabled) return 'disabled';
  if (DESTRUCTIVE.test(name)) return 'destructive';
  if (isExternalHref(href)) return 'external-url';
  if (EXTERNAL_SIGN_IN.test(name)) return 'external-sign-in';
  return null;
}
