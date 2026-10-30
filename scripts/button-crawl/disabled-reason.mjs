// The disabled-control rule's gate (Private #1093 item 7). The harness marks each visible greyed control that has no
// visible line saying why (window/scripts/button-crawl-reason.ts, collected as noReason). It fails the gate like dead.
//
// The rule gates Regular and Advanced, the levels a person sees by default. Coming controls (their only reason is "not
// built yet") show only at Technical, greyed with a tooltip, so Technical screens are not held to it.

export const DISABLED_WITHOUT_REASON = 'disabled-without-reason';
export const REASON_LEVELS = new Set(['regular', 'advanced']);

/** Greyed controls the rule allows, by region and name, each with its reason (as coverage.mjs NEVER_CLICKED_ALLOW). */
export const DISABLED_REASON_ALLOW = {
  'chrome :: Back': 'The header’s history arrow. Greyed, it says by itself that there is nowhere to go back to, as in every browser.',
  'chrome :: Forward': 'The header’s history arrow. Greyed, it says by itself that there is nowhere to go forward to, as in every browser.',
};

export const allowKey = (el) => `${el.region} :: ${el.name}`;

/** The collected controls on a screen at `level` that are greyed with no visible reason. */
export function disabledWithoutReason(elements, level) {
  if (!REASON_LEVELS.has(level)) return [];
  return (elements || []).filter((el) => el && el.disabled && el.noReason && !DISABLED_REASON_ALLOW[allowKey(el)]);
}
