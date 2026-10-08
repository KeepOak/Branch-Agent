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

/** Problems a single click produced. Report-only notes are not included. */
export function classifyClick({ before, after, elapsedMs = 0, consoleErrors = [], failedCalls = [] }) {
  const problems = [];
  const requests = (after.requests || []).slice(before.requestCount || 0);
  const requestSent = requests.some((call) => call && call.ok !== false) || requests.length > 0;
  const toastChanged = before.toast !== after.toast && Boolean(after.toast);
  const routeChanged = before.route !== after.route;
  const dialogChanged = before.dialog !== after.dialog;
  const menuChanged = before.menu !== after.menu;
  const panelChanged = before.panel !== after.panel;
  const stateChanged = before.control !== after.control;
  const textChanged = before.mainText !== after.mainText;
  // Focus landing on the clicked control is the click itself. Focus moving to another element,
  // such as a skip link's target, is a result.
  const focusChanged = Boolean(after.focus) && before.focus !== after.focus;
  const hashChanged = (before.hash || '') !== (after.hash || '');
  const chromeChanged = (before.chrome || '') !== (after.chrome || '');
  const historyChanged = (before.historyMoves || 0) !== (after.historyMoves || 0);
  const observable = routeChanged || dialogChanged || menuChanged || panelChanged || stateChanged || textChanged || toastChanged || requestSent || focusChanged || hashChanged || chromeChanged || historyChanged;

  if (!observable && !after.alreadyCurrent) problems.push('dead');
  else if (toastChanged && !routeChanged && !dialogChanged && !menuChanged && !panelChanged && !stateChanged && !textChanged && !requestSent && !focusChanged && !hashChanged && !chromeChanged && !historyChanged) problems.push('toast-only');

  if (after.alert && after.alert !== before.alert) problems.push('error');
  if (after.unimplemented && !before.unimplemented && UNIMPLEMENTED.test(after.mainText || '')) problems.push('unimplemented');
  if (after.blank && !before.blank) problems.push('blank');
  if (routeChanged && after.blank) problems.push('empty-route');
  if (observable && elapsedMs > SLOW_MS) problems.push('slow');
  if (consoleErrors.filter((line) => !isNoise(line)).length) problems.push('console-error');
  // failedCalls stay on the click record. They block only when they also surface as a console error.

  const ledTo = {
    route: after.route || null,
    dialog: (dialogChanged ? after.dialog : null) || (menuChanged ? after.menu : null) || after.dialog || after.menu || null,
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
