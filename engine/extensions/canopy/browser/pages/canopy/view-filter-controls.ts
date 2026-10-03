import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { renderSelectPicker } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import type {
  CanopyCard,
  CanopyStatus,
  CanopyUiState,
} from "../../lib/canopy/index.ts";
import { formatStatusLabel } from "./view-helpers.ts";
import { canopyPopoverRef } from "./view-popover.ts";
import type { CanopySelectOption } from "./canopy-select.ts";

export type ActiveFilter = {
  id: string;
  label: string;
  clear: () => void;
  mobileOnly?: boolean;
};

export function multiFilterLabel<Value extends string>(
  field: string,
  values: ReadonlySet<Value>,
  options: readonly { value: Value; label: string }[],
  allowExclusion = false,
) {
  const excluded = options.filter((option) => !values.has(option.value));
  const excludeOne = allowExclusion && values.size > 1 && excluded.length === 1;
  const labels = excludeOne ? excluded : options.filter((option) => values.has(option.value));
  return t(excludeOne ? "canopy.filterChipExcludes" : "canopy.filterChipValue", {
    field,
    value: labels.map((option) => option.label).join(", "),
  });
}

export function renderActiveFilters(
  filters: ActiveFilter[],
  requestUpdate: (() => void) | undefined,
) {
  return html`<div
    class="canopy-active-filters ${
      filters.every((filter) => filter.mobileOnly) ? "canopy-active-filters--mobile" : ""
    }"
    aria-label=${t("canopy.activeFilters")}
  >
    ${repeat(
      filters,
      (filter) => filter.id,
      (filter) => html` <span
        class="canopy-filter-chip ${filter.mobileOnly ? "canopy-filter-chip--mobile" : ""}"
      >
        <span class="canopy-filter-chip__label">${filter.label}</span>
        <button
          class="canopy-filter-chip__remove"
          type="button"
          aria-label=${t("canopy.removeFilter", { filter: filter.label })}
          @click=${(event: MouseEvent) => {
            const button = event.currentTarget;
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }
            const toolbar = button.closest(".canopy-toolbar");
            const buttons = [
              ...(toolbar?.querySelectorAll<HTMLElement>(".canopy-filter-chip__remove") ?? []),
            ].filter((candidate) => candidate.getClientRects().length > 0);
            const index = buttons.indexOf(button);
            filter.clear();
            requestUpdate?.();
            if (event.detail === 0) {
              queueMicrotask(() => {
                const remaining = [
                  ...(toolbar?.querySelectorAll<HTMLButtonElement>(
                    ".canopy-filter-chip__remove",
                  ) ?? []),
                ].filter((candidate) => candidate.getClientRects().length > 0);
                (
                  remaining?.[Math.min(index, remaining.length - 1)] ??
                  toolbar?.querySelector<HTMLButtonElement>(".canopy-filter-trigger")
                )?.focus();
              });
            }
          }}
        >
          ${icons.x}
        </button>
      </span>`,
    )}
  </div>`;
}

function toggleStatus(state: CanopyUiState, status: CanopyStatus) {
  if (state.statusFilter.has(status)) {
    state.statusFilter.delete(status);
  } else {
    state.statusFilter.add(status);
  }
}

export function renderStatusTabs(state: CanopyUiState, requestUpdate: (() => void) | undefined) {
  return html`<div
    class="canopy-status-tabs"
    role="group"
    aria-label=${t("canopy.fieldStatus")}
  >
    <button
      type="button"
      aria-pressed=${state.statusFilter.size === 0}
      @click=${() => {
        state.statusFilter.clear();
        requestUpdate?.();
      }}
    >
      ${t("canopy.allStatuses")}
    </button>
    ${state.statuses.map(
      (status) => html`<button
        type="button"
        aria-pressed=${state.statusFilter.has(status)}
        @click=${() => {
          toggleStatus(state, status);
          requestUpdate?.();
        }}
      >
        ${formatStatusLabel(status)}
      </button>`,
    )}
  </div>`;
}

export function renderMobileStatusPicker(
  state: CanopyUiState,
  cards: readonly CanopyCard[],
  requestUpdate: (() => void) | undefined,
) {
  const counts = new Map<CanopyStatus, number>();
  for (const card of cards) {
    counts.set(card.status, (counts.get(card.status) ?? 0) + 1);
  }
  const selected = state.statuses.filter((status) => state.statusFilter.has(status));
  const label = selected.length
    ? selected.map(formatStatusLabel).join(", ")
    : t("canopy.allWork");
  const popoverId = "canopy-status-popover";
  return html`<div class="canopy-mobile-status">
    <button
      class="btn canopy-mobile-status__trigger"
      type="button"
      popovertarget=${popoverId}
      aria-haspopup="dialog"
      aria-expanded="false"
      title=${label}
      aria-label=${t("canopy.filterChipValue", {
        field: t("canopy.fieldStatus"),
        value: label,
      })}
    >
      <span class="canopy-mobile-status__label">${label}</span>
      <span class="canopy-mobile-status__chevron" aria-hidden="true"
        >${icons.chevronsUpDown}</span
      >
    </button>
    <div
      class="canopy-status-popover"
      id=${popoverId}
      popover="auto"
      role="dialog"
      aria-label=${t("canopy.fieldStatus")}
      ${ref(canopyPopoverRef("start"))}
    >
      <button
        class="canopy-status-option"
        type="button"
        aria-pressed=${selected.length === 0}
        @click=${() => {
          state.statusFilter.clear();
          requestUpdate?.();
        }}
      >
        <span class="canopy-status-option__icon" aria-hidden="true">${icons.kanban}</span>
        <span>${t("canopy.allWork")}</span>
        <span class="canopy-mobile-status__count">${cards.length}</span>
        <span class="canopy-status-option__check" aria-hidden="true">${icons.check}</span>
      </button>
      ${state.statuses.map(
        (status) => html`<button
          class="canopy-status-option"
          type="button"
          aria-pressed=${state.statusFilter.has(status)}
          @click=${() => {
            toggleStatus(state, status);
            requestUpdate?.();
          }}
        >
          <span class="canopy-status-option__icon" aria-hidden="true">
            <span class="canopy-status-dot canopy-status-dot--${status}"></span>
          </span>
          <span>${formatStatusLabel(status)}</span>
          <span class="canopy-mobile-status__count">${counts.get(status) ?? 0}</span>
          <span class="canopy-status-option__check" aria-hidden="true">${icons.check}</span>
        </button>`,
      )}
    </div>
  </div>`;
}

export function renderFilterSelect<Value extends string>(params: {
  label: string;
  value: Value;
  options: readonly CanopySelectOption<Value>[];
  onChange: (value: Value) => void;
}) {
  return html`<div class="canopy-filter-row">
    <span>${params.label}</span>
    ${renderSelectPicker({
      value: params.value,
      options: params.options,
      accessibleLabel: params.label,
      onSelect: (value) => {
        const option = params.options.find((candidate) => candidate.value === value);
        if (option && !option.disabled) {
          params.onChange(option.value);
        }
      },
    })}
  </div>`;
}

export function renderFilterChoices<Value extends string>(params: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string; icon: keyof typeof icons; title?: string }[];
  onChange: (value: Value) => void;
}) {
  return html`<div class="canopy-filter-choice">
    <span class="canopy-filter-section__label">${params.label}</span>
    <div class="canopy-view-toggle" role="group" aria-label=${params.label}>
      ${params.options.map(
        (option) => html`<button
          class="btn ${params.value === option.value ? "is-active" : ""}"
          type="button"
          aria-pressed=${params.value === option.value}
          aria-label=${option.title ?? option.label}
          title=${option.title ?? option.label}
          @click=${() => params.onChange(option.value)}
        >
          <span aria-hidden="true">${icons[option.icon]}</span>
          <span>${option.label}</span>
        </button>`,
      )}
    </div>
  </div>`;
}

export function renderMultiFilter<Value extends string>(params: {
  label: string;
  values: Set<Value>;
  options: readonly {
    value: Value;
    label: string;
    count: number;
    title?: string;
    icon?: unknown;
  }[];
  wide?: boolean;
  onChange: () => void;
}) {
  return html`<div class="canopy-filter-section">
    <div class="canopy-filter-section__heading">
      <span class="canopy-filter-section__label">${params.label}</span>
    </div>
    <div
      class="canopy-filter-section__options ${
        params.wide ? "canopy-filter-section__options--wide" : ""
      }"
      role="group"
      aria-label=${params.label}
    >
      ${params.options.map(
        (option) => html`<label
          class="canopy-filter-option ${params.values.has(option.value) ? "active" : ""}"
          title=${option.title ?? option.label}
        >
          <input
            type="checkbox"
            .checked=${params.values.has(option.value)}
            @change=${(event: Event) => {
              if (!(event.currentTarget instanceof HTMLInputElement)) {
                return;
              }
              if (event.currentTarget.checked) {
                params.values.add(option.value);
              } else {
                params.values.delete(option.value);
              }
              params.onChange();
            }}
          />
          <span class="canopy-filter-option__copy"
            >${
              option.icon ? html`<i aria-hidden="true">${option.icon}</i>` : nothing
            }${option.label}</span
          >
          <span
            class="canopy-filter-option__count"
            aria-label=${t(
              option.count === 1 ? "canopy.viewPresetCountOne" : "canopy.viewPresetCount",
              { count: String(option.count) },
            )}
            >${option.count}</span
          >
        </label>`,
      )}
    </div>
  </div>`;
}
