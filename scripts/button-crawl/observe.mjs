// What a click did, and which of those outcomes block a pull request.
// Preview-map differences are reported elsewhere and are not in this set.

export const SLOW_MS = 300;

export const GATED_PROBLEMS = [
  'dead',
  'toast-only',
  'error',
  'blank',
  'unimplemented',
  'empty-route',
  'slow',
  'console-error',
  'row-actions-inconsistent',
  'inconsistent-open',
  'internal-name-shown',
];

const GATED = new Set(GATED_PROBLEMS);

const UNIMPLEMENTED = /\b(coming soon|not implemented|not yet implemented|placeholder)\b/i;

/** Browser console noise that is not an app failure. */
export function isNoise(text) {
  return /favicon\.ico|Download the React DevTools|chrome-extension:\/\//.test(String(text || ''));
}

/**
 * A real result is a navigation, a dialog or panel opening (or a dialog closing),
 * or a visible change on the screen. A menu closing, a toast, and an RPC that only
 * returns ok are not results.
 */
export function classifyClick({ before, after, elapsedMs = 0, consoleErrors = [], failedCalls = [] }) {
  const problems = [];
  const requests = (after.requests || []).slice(before.requestCount || 0);
  const toastChanged = before.toast !== after.toast && Boolean(after.toast);
  const routeChanged = before.route !== after.route;
  const dialogOpened = Boolean(after.dialog) && after.dialog !== before.dialog;
  const dialogClosed = Boolean(before.dialog) && !after.dialog;
  const menuOpened = Boolean(after.menu) && after.menu !== before.menu;
  const panelOpened = Boolean(after.panel) && after.panel !== before.panel && !before.panel;
  const menuClosed = Boolean(before.menu) && !after.menu;
  // Both sides must still describe a control. A menu unmounting the clicked item is not a state change.
  const stateChanged = Boolean(before.control) && Boolean(after.control) && before.control !== after.control;
  const textChanged = (before.viewText ?? before.mainText) !== (after.viewText ?? after.mainText);
  const focusChanged = Boolean(after.focus) && before.focus !== after.focus && !menuClosed;
  const hashChanged = (before.hash || '') !== (after.hash || '');
  const chromeChanged = (before.chrome || '') !== (after.chrome || '');
  const real = routeChanged || dialogOpened || dialogClosed || menuOpened || panelOpened || stateChanged || textChanged || focusChanged || hashChanged || chromeChanged;

  if (!real && !after.alreadyCurrent) {
    if (toastChanged) problems.push('toast-only');
    else problems.push('dead');
  }

  if (after.alert && after.alert !== before.alert) problems.push('error');
  if (after.unimplemented && !before.unimplemented && UNIMPLEMENTED.test(after.mainText || '')) problems.push('unimplemented');
  if (after.blank && !before.blank) problems.push('blank');
  if (routeChanged && after.blank) problems.push('empty-route');
  if (real && elapsedMs > SLOW_MS) problems.push('slow');
  if (consoleErrors.filter((line) => !isNoise(line)).length) problems.push('console-error');
  // failedCalls stay on the click record. They block only when they also surface as a console error.

  const ledTo = {
    route: after.route || null,
    dialog: dialogOpened ? after.dialog : menuOpened ? after.menu : after.dialog || after.menu || null,
    panel: after.panel || null,
    toast: after.toast || null,
    menuItems: after.menuItems || [],
  };
  return {
    problems: [...new Set(problems)].filter((problem) => GATED.has(problem)).sort(),
    requests: requests.map((call) => call.method || call),
    failedCalls,
    ledTo,
    elapsedMs,
  };
}

export function elementKey(screenId, name) {
  return `${screenId} :: ${name}`;
}

export function screenOf(key) {
  const at = String(key).indexOf(' :: ');
  return at === -1 ? String(key) : String(key).slice(0, at);
}
