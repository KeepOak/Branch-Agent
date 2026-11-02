// What a click did, and which of those outcomes block a pull request.
// Preview-map differences are reported elsewhere and are not in this set.

export const SLOW_MS = 300;

// Text that changes with time alone: a clock, an elapsed or countdown timer, a relative age. A menu or dialog whose only
// change is this text did not do anything, so the classifier strips it before it compares the open overlay.
const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?\b/gi;
const ELAPSED = /\b\d+(?:\.\d+)?\s?(?:ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b(?:\s+ago)?/gi;

/** The overlay text with its time-only parts removed, so a ticking clock or timer compares equal. */
export function stableText(text) {
  return String(text || '').replace(CLOCK, '').replace(ELAPSED, '').replace(/\s+/g, ' ').trim();
}

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
  // A visible greyed control with no visible line saying why, at Regular or Advanced (disabled-reason.mjs).
  'disabled-without-reason',
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
  const windowOpened = (after.popups ?? 0) > (before.popups ?? 0) || (after.downloads ?? 0) > (before.downloads ?? 0);
  // A scroll is a result only when the control is an in-page jump; a sidebar scroll by any other control is not.
  const scrolled = after.jump === true && (after.scroll ?? '') !== (before.scroll ?? '') && after.scroll !== undefined;
  // A saved setting is a result even when the menu that changed it closes: the engine kept the new value.
  const settingSaved = (after.configRevision ?? '') !== (before.configRevision ?? '') && after.configRevision !== undefined;
  // A change inside a menu or dialog that stays open (a sub-view, a popover result) and a typed field are results. A menu
  // that closes is not: its before/after digests differ only because it is gone.
  const overlayChanged = Boolean(before.overlay) && Boolean(after.overlay) && stableText(before.overlay) !== stableText(after.overlay);
  const valuesChanged = (before.values ?? '') !== (after.values ?? '') && after.values !== undefined;
  // The side layout (Collapse the list, a side panel) is a result. An empty value is a window with no R1 frame.
  const frameChanged = Boolean(after.frame) && before.frame !== after.frame;
  // A disclosure's content (aria-controls) that shows or hides is a result, as the click that opened it is.
  // A ticking timer inside an expanded panel is not a result: the content compares with its time-only parts removed.
  const controlledChanged = after.controlled !== undefined && stableText(before.controlled ?? '') !== stableText(after.controlled);
  const real = frameChanged || overlayChanged || valuesChanged || routeChanged || dialogOpened || dialogClosed || menuOpened || panelOpened || stateChanged || controlledChanged || textChanged || focusChanged || hashChanged || chromeChanged || windowOpened || scrolled || settingSaved;

  if (!real && !after.alreadyCurrent) {
    if (toastChanged) problems.push('toast-only');
    else problems.push('dead');
  }

  if (after.alert && after.alert !== before.alert) problems.push('error');
  if (after.unimplemented && !before.unimplemented && UNIMPLEMENTED.test(after.mainText || '')) problems.push('unimplemented');
  if (after.blank && !before.blank) problems.push('blank');
  if (routeChanged && after.blank) problems.push('empty-route');
  // A smooth scroll to a section takes longer than a click should; only other results are timed.
  const changedBesidesScroll = controlledChanged || frameChanged || overlayChanged || valuesChanged || routeChanged || dialogOpened || dialogClosed || menuOpened || panelOpened || stateChanged || textChanged || focusChanged || hashChanged || chromeChanged || windowOpened || settingSaved;
  if (changedBesidesScroll && elapsedMs > SLOW_MS) problems.push('slow');
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
