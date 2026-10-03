import { html, type TemplateResult } from "lit";
import "./tooltip.ts";

/** Keep a reason-blocked control focusable so keyboard and touch users can discover why. */
export function renderReasonedDisabledControl(
  reason: string | null | undefined,
  control: TemplateResult,
): TemplateResult {
  return reason
    ? html`<branch-tooltip open-on-click .content=${reason}>${control}</branch-tooltip>`
    : control;
}
