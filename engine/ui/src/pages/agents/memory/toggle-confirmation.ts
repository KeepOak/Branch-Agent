import { html, nothing } from "lit";
import { t } from "../../../i18n/index.ts";
import "../../../components/modal-dialog.ts";
import { registerRingsEnglish } from "../../../i18n/locales/en-rings.ts";

registerRingsEnglish();

type RingsToggleConfirmationProps = {
  open: boolean;
  // Direction of the pending write. Copy differs because turning rings off
  // stops the sweep for every agent, not just the one this panel is showing.
  enabling: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  hasError: boolean;
};

export function renderRingsToggleConfirmation(props: RingsToggleConfirmationProps) {
  if (!props.open) {
    return nothing;
  }
  const titleId = "rings-toggle-confirmation-title";
  const descriptionId = "rings-toggle-confirmation-description";
  const title = props.enabling
    ? t("rings.toggleConfirmation.enableTitle")
    : t("rings.toggleConfirmation.disableTitle");
  const description = t("rings.toggleConfirmation.subtitle");
  const detail = props.enabling
    ? t("rings.toggleConfirmation.enableDetail")
    : t("rings.toggleConfirmation.disableDetail");
  const confirmLabel = props.enabling
    ? t("rings.toggleConfirmation.enableConfirm")
    : t("rings.toggleConfirmation.disableConfirm");
  const handleCancel = () => {
    if (!props.loading) {
      props.onCancel();
    }
  };

  return html`
    <branch-modal-dialog label=${title} description=${description} @modal-cancel=${handleCancel}>
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div id=${titleId} class="exec-approval-title">${title}</div>
            <div id=${descriptionId} class="exec-approval-sub">${description}</div>
          </div>
        </div>
        <div class="callout ${props.enabling ? "info" : "warn"}" style="margin-top: 12px;">
          ${detail}
        </div>
        ${
          props.hasError
            ? html`<div class="exec-approval-error">
                ${t("rings.toggleConfirmation.failed")}
              </div>`
            : nothing
        }
        <div class="exec-approval-actions">
          <button
            class="btn ${props.enabling ? "primary" : "danger"}"
            ?disabled=${props.loading}
            @click=${props.onConfirm}
          >
            ${props.loading ? t("rings.toggleConfirmation.saving") : confirmLabel}
          </button>
          <button class="btn" ?disabled=${props.loading} @click=${props.onCancel}>
            ${t("common.cancel")}
          </button>
        </div>
      </div>
    </branch-modal-dialog>
  `;
}
