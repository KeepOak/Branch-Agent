import { LitElement, html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { ref } from "lit/directives/ref.js";
import { renderAgentPicker } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { normalizeDraftLabels } from "../../lib/canopy/card-state.ts";
import {
  getCanopyState,
  CANOPY_PRIORITIES,
  type CanopyCard,
} from "../../lib/canopy/index.ts";
import { updateCanopyCardProperties } from "../../lib/canopy/mutations.ts";
import { buildAssignableAgentPickerOptions } from "./agent-filter.ts";
import { moveCardToStatus } from "./view-card-actions.ts";
import {
  formatPriorityLabel,
  formatStatusLabel,
  renderPriorityIcon,
  type CanopyProps,
} from "./view-helpers.ts";
import { canopyPopoverRef } from "./view-popover.ts";

function closePropertyPicker(input: HTMLInputElement) {
  const panel = input.closest<HTMLElement>("[popover]");
  panel?.hidePopover();
  if (panel?.previousElementSibling instanceof HTMLElement) {
    panel.previousElementSibling.focus({ preventScroll: true });
  }
}

function renderPropertyPicker<T extends string>(params: {
  id: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon: TemplateResult; className?: string }[];
  className?: string;
  disabled: boolean;
  onSelect: (value: T) => void | Promise<unknown>;
}) {
  const selected = params.options.find((option) => option.value === params.value);
  return html`<div class="canopy-detail__property-control">
    <button
      type="button"
      class="canopy-detail__property-trigger ${params.className ?? ""}"
      aria-label=${`${params.label}: ${selected?.label ?? params.value}`}
      aria-haspopup="dialog"
      aria-expanded="false"
      popovertarget=${params.id}
      ?disabled=${params.disabled}
    >
      <span class="canopy-detail__property-icon" aria-hidden="true">${selected?.icon}</span>
      <span>${selected?.label ?? params.value}</span>
      <span class="canopy-detail__property-chevron" aria-hidden="true"
        >${icons.chevronDown}</span
      >
    </button>
    <div
      id=${params.id}
      popover="auto"
      class="canopy-detail__property-menu"
      role="dialog"
      aria-label=${params.label}
      ${ref(canopyPopoverRef())}
    >
      <div role="radiogroup" aria-label=${params.label}>
        ${params.options.map(
          (option) => html`<label
            class="canopy-detail__property-option ${option.className ?? ""}"
          >
            <input
              type="radio"
              name=${params.id}
              value=${option.value}
              .checked=${live(params.value === option.value)}
              ?autofocus=${params.value === option.value}
              ?disabled=${params.disabled}
              @click=${(event: MouseEvent) => {
                if (
                  params.value === option.value &&
                  event.currentTarget instanceof HTMLInputElement
                ) {
                  closePropertyPicker(event.currentTarget);
                }
              }}
              @change=${async (event: Event) => {
                const input = event.currentTarget;
                if (!(input instanceof HTMLInputElement)) {
                  return;
                }
                const trigger = input.closest("[popover]")?.previousElementSibling;
                closePropertyPicker(input);
                if (option.value !== params.value) {
                  await params.onSelect(option.value);
                }
                // A pending mutation disables the trigger. Restore keyboard position
                // after it renders enabled, unless the operator has focused elsewhere.
                requestAnimationFrame(() => {
                  if (
                    trigger instanceof HTMLElement &&
                    trigger.isConnected &&
                    document.activeElement === document.body
                  ) {
                    trigger.focus({ preventScroll: true });
                  }
                });
              }}
            />
            <span class="canopy-detail__property-icon" aria-hidden="true">${option.icon}</span>
            <span>${option.label}</span>
            <span class="canopy-detail__property-check" aria-hidden="true"
              >${params.value === option.value ? icons.check : nothing}</span
            >
          </label>`,
        )}
      </div>
    </div>
  </div>`;
}

export function renderInlinePriority(
  props: CanopyProps,
  card: CanopyCard,
  disabled: boolean,
) {
  return renderPropertyPicker({
    id: `canopy-detail-priority-${card.id}`,
    label: t("canopy.fieldPriority"),
    value: card.priority,
    options: CANOPY_PRIORITIES.map((priority) => ({
      value: priority,
      label: formatPriorityLabel(priority),
      icon: renderPriorityIcon(priority),
      className: `canopy-detail__priority--${priority}`,
    })),
    className: `canopy-detail__priority canopy-detail__priority--${card.priority}`,
    disabled: disabled || !props.connected || !props.client,
    onSelect: (priority) => {
      return updateCanopyCardProperties({
        host: props.host,
        client: props.client,
        card,
        patch: { priority },
        requestUpdate: props.onRequestUpdate,
      });
    },
  });
}

export function renderInlineStatus(props: CanopyProps, card: CanopyCard, disabled: boolean) {
  const state = getCanopyState(props.host);
  const statuses = state.statuses.includes(card.status)
    ? state.statuses
    : [card.status, ...state.statuses];
  return renderPropertyPicker({
    id: `canopy-detail-status-${card.id}`,
    label: t("canopy.fieldStatus"),
    value: card.status,
    options: statuses.map((status) => ({
      value: status,
      label: formatStatusLabel(status),
      icon: html`<span class="canopy-status-dot canopy-status-dot--${status}"></span>`,
    })),
    disabled: disabled || !props.connected || !props.client,
    onSelect: (status) => moveCardToStatus(props, card, status),
  });
}

export function renderInlineAgent(props: CanopyProps, card: CanopyCard, disabled: boolean) {
  const defaultAgentId = props.agentsList?.defaultId ?? props.defaultAgentId ?? "";
  const options = buildAssignableAgentPickerOptions(
    props.agentsList,
    card.agentId ?? "",
    defaultAgentId,
  );
  return renderAgentPicker(
    {
      options,
      value: card.agentId ?? "",
      accessibleLabel: t("canopy.fieldAgent"),
      disabled: disabled || !props.connected || !props.client,
      onSelect: (agentId) => {
        if (agentId !== (card.agentId ?? "")) {
          void updateCanopyCardProperties({
            host: props.host,
            client: props.client,
            card,
            patch: { agentId },
            requestUpdate: props.onRequestUpdate,
          });
        }
      },
    },
    "canopy-detail__property-control canopy-detail__agent-picker",
  );
}

type InlineTextField = "title" | "notes" | "labels";
type InlineTextProps = {
  owner: CanopyProps;
  card: CanopyCard;
  field: InlineTextField;
  disabled: boolean;
  readOnly: boolean;
};

export class CanopyInlineText extends LitElement {
  static override properties = {
    props: { attribute: false },
    editing: { state: true },
    value: { state: true },
    saving: { state: true },
  };
  declare props: InlineTextProps;
  declare private editing: boolean;
  declare private value: string;
  declare private saving: boolean;
  private base?: CanopyCard;

  constructor() {
    super();
    this.editing = false;
    this.value = "";
    this.saving = false;
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate() {
    if (this.base && this.base.id !== this.props.card.id) {
      this.base = undefined;
      this.editing = false;
      this.value = "";
    }
  }

  discardDraft() {
    this.finish(false);
  }

  get pendingSave() {
    return this.saving;
  }

  get hasUnsavedChanges() {
    if (!this.base) {
      return false;
    }
    const field = this.props.field;
    return field === "labels"
      ? JSON.stringify(normalizeDraftLabels(this.value)) !== JSON.stringify(this.base.labels)
      : this.value.trim() !== (this.base[field] ?? "").trim();
  }

  private finish = (restoreFocus = true) => {
    this.base = undefined;
    const document = this.ownerDocument;
    const previousFocus = document.activeElement;
    this.querySelector<HTMLElement>(".canopy-detail__labels-popover")?.hidePopover();
    this.editing = false;
    void this.updateComplete.then(() => {
      if (
        restoreFocus &&
        this.isConnected &&
        (document.activeElement === previousFocus || document.activeElement === document.body)
      ) {
        this.querySelector<HTMLButtonElement>(".canopy-detail__text-trigger")?.focus();
      }
    });
  };

  private save = async () => {
    if (
      this.saving ||
      this.props.disabled ||
      !this.base ||
      (this.props.field === "title" && !this.value.trim())
    ) {
      return;
    }
    const document = this.ownerDocument;
    let restoreFocus = this.contains(document.activeElement);
    const trackFocus = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && target !== document.body && !this.contains(target)) {
        restoreFocus = false;
      }
    };
    const trackPointer = (event: Event) => {
      if (event.target instanceof Node && !this.contains(event.target)) {
        restoreFocus = false;
      }
    };
    document.addEventListener("focusin", trackFocus);
    document.addEventListener("pointerdown", trackPointer);
    this.saving = true;
    const { owner, field } = this.props;
    const base = this.base;
    const patch =
      field === "labels" ? { labels: normalizeDraftLabels(this.value) } : { [field]: this.value };
    const saved = await updateCanopyCardProperties({
      host: owner.host,
      client: owner.client,
      card: base,
      patch,
      requestUpdate: owner.onRequestUpdate,
    });
    document.removeEventListener("focusin", trackFocus);
    document.removeEventListener("pointerdown", trackPointer);
    this.saving = false;
    if (this.base?.id !== base.id) {
      return;
    }
    if (saved) {
      this.finish(restoreFocus);
    } else {
      this.base = getCanopyState(owner.host).cards.find((card) => card.id === base.id) ?? base;
    }
  };

  override render() {
    const { card, field, disabled, readOnly } = this.props;
    if (readOnly && !this.editing && !this.hasUnsavedChanges) {
      if (field === "labels") {
        return html`<div class="canopy-detail__labels">
          ${card.labels.map((label) => html`<span>${label}</span>`)}
        </div>`;
      }
      return field === "title"
        ? card.title
        : card.notes
          ? html`<p class="canopy-detail__description">${card.notes}</p>`
          : nothing;
    }
    const label = t(
      field === "title"
        ? "canopy.fieldTitle"
        : field === "notes"
          ? "canopy.fieldNotes"
          : "canopy.fieldLabels",
    );
    const labelsPopoverId = `canopy-detail-labels-${card.id}`;
    const content =
      field === "labels"
        ? card.labels.length
          ? html`<span class="canopy-detail__labels"
              >${card.labels.map((value) => html`<span>${value}</span>`)}</span
            >`
          : t("canopy.inlineAddLabels")
        : card[field] || t("canopy.inlineAddDescription");
    const trigger = html`<button
      type="button"
      class="canopy-detail__text-trigger canopy-detail__text-trigger--${field}"
      aria-description=${label}
      aria-haspopup=${field === "labels" ? "dialog" : nothing}
      aria-controls=${field === "labels" ? labelsPopoverId : nothing}
      aria-expanded=${field === "labels" ? String(this.editing) : nothing}
      ?disabled=${disabled && !(field === "labels" && this.hasUnsavedChanges && !this.saving)}
      @click=${() => {
        if (!this.base || !this.hasUnsavedChanges) {
          this.base = card;
          this.value = field === "labels" ? card.labels.join(", ") : (card[field] ?? "");
        }
        this.editing = true;
        void this.updateComplete.then(() => {
          if (!this.isConnected || !this.editing) {
            return;
          }
          if (field === "labels") {
            this.querySelector<HTMLElement>(".canopy-detail__labels-popover")?.showPopover();
          }
          this.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")?.focus();
        });
      }}
    >
      <span class="canopy-detail__text-value">${content}</span>
    </button>`;
    if (!this.editing && field !== "labels") {
      return trigger;
    }
    const locked = disabled || this.saving;
    const input = (event: InputEvent) => {
      const target = event.currentTarget;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        this.value = target.value;
      }
    };
    const editor = html`<span
      class="canopy-detail__text-editor canopy-detail__text-editor--${field}"
      @keydown=${(event: KeyboardEvent) => {
        if (event.isComposing) {
          if (field === "labels") {
            event.stopPropagation();
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!this.saving) {
            this.finish();
          }
        } else if (
          event.key === "Enter" &&
          (event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement) &&
          (field !== "notes" || event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          event.stopPropagation();
          void this.save();
        }
      }}
    >
      ${
        field === "notes"
          ? html`<textarea
              class="settings-input"
              aria-label=${label}
              rows="3"
              .value=${this.value}
              ?disabled=${this.saving || (disabled && !readOnly)}
              ?readonly=${readOnly}
              @input=${input}
            ></textarea>`
          : html`<input
              class="settings-input"
              aria-label=${label}
              .value=${this.value}
              ?disabled=${this.saving || (disabled && !readOnly)}
              ?readonly=${readOnly}
              @input=${input}
            />`
      }
      <span class="canopy-detail__text-actions">
        <button
          type="button"
          class="btn"
          ?disabled=${locked || (field === "title" && !this.value.trim())}
          @click=${this.save}
        >
          ${t("common.save")}
        </button>
        <button type="button" class="btn" ?disabled=${this.saving} @click=${() => this.finish()}>
          ${t("common.cancel")}
        </button>
      </span>
    </span>`;
    return field === "labels"
      ? html`${trigger}
          <div
            id=${labelsPopoverId}
            class="canopy-detail__labels-popover"
            popover="auto"
            role="dialog"
            aria-label=${label}
            ${ref(canopyPopoverRef())}
            @toggle=${(event: Event) => {
              if (
                event.currentTarget instanceof HTMLElement &&
                !event.currentTarget.matches(":popover-open")
              ) {
                this.editing = false;
              }
            }}
          >
            ${this.editing ? editor : nothing}
          </div>`
      : editor;
  }
}
if (!customElements.get("canopy-inline-text")) {
  customElements.define("canopy-inline-text", CanopyInlineText);
}

export function renderInlineText(
  owner: CanopyProps,
  card: CanopyCard,
  field: InlineTextField,
  disabled: boolean,
  readOnly = false,
) {
  return html`<canopy-inline-text
    .props=${{ owner, card, field, readOnly, disabled: disabled || readOnly || !owner.connected || !owner.client }}
  ></canopy-inline-text>`;
}
